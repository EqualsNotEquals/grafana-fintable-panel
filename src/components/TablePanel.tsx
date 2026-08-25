import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { PanelProps, FieldType, formattedValueToString, reduceField } from '@grafana/data';
import { AgGridReact } from 'ag-grid-react';
import { ColDef, ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import { css, cx } from '@emotion/css';
import { useStyles2, Modal, Button, Input, Field, Select, Icon } from '@grafana/ui';
import { TableOptions, TableFieldConfig } from '../types';
import { decimalToThirtySeconds } from '../utils/bondPrice';
import { pickNewAlertIds } from '../utils/alerts';
import { renderSqlTemplate } from '../utils/sqlTemplate';
import { runSql, runSelectQuery } from '../utils/runQuery';
import { frameToRecords } from '../utils/frame';
import { getNotificationPermission, requestNotificationPermission, showDesktopNotification } from '../utils/desktopNotify';
import { playAlertSound } from '../utils/sound';

ModuleRegistry.registerModules([AllCommunityModule]);

// Hard cap on how many rows a single alert evaluation will ever act on —
// applies to *both* toast rendering and (especially) desktop notification
// calls. Without this, a rule matching a large first-ever-seen result set
// (e.g. a fresh session against a ~1000-row table with nothing marked
// "seen" yet) would try to create hundreds of real OS Notification objects
// or render hundreds of toast elements in one go, which is heavy enough to
// hang the tab. Every matching row still gets marked "seen" in the dedup
// store regardless — this only limits how many get *announced* at once.
const MAX_ALERT_BATCH = 15;

// Separate, smaller cap on how many rows get the brief flash highlight —
// flashing a large burst all at once reads as noise rather than a signal,
// so this stays well under MAX_ALERT_BATCH even though popups still fire
// for the full batch.
const MAX_FLASH_BATCH = 8;

interface Props extends PanelProps<TableOptions> {}

interface RowRecord {
  __rowId: string;
  [key: string]: any;
}

interface ToastItem {
  id: string;
  row: RowRecord;
  kind: 'row' | 'query';
}

interface EditNotice {
  type: 'error' | 'success';
  message: string;
}

const getStyles = () => ({
  wrapper: css`
    display: flex;
    flex-direction: column;
    position: relative;
  `,
  toolbar: css`
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-bottom: 4px;
  `,
  grid: css`
    flex: 1;
    min-height: 0;

    /* AG Grid's flashCells() (used for the new-row highlight) reads this
       CSS variable for its flash color — neither the legacy structural CSS
       nor the Quartz theme file defines it, so without this the flash
       class toggles correctly but renders invisible. */
    --ag-value-change-value-highlight-background-color: rgba(245, 166, 35, 0.55);

    .ag-row-odd {
      background-color: rgba(127, 127, 127, 0.06);
    }
    .ag-row {
      font-size: 12px;
    }
    .rfq-row-selected {
      background-color: rgba(66, 133, 244, 0.15) !important;
    }
    .rfq-col-selected {
      background-color: rgba(66, 133, 244, 0.1) !important;
    }
    .rfq-row-alert {
      box-shadow: inset 3px 0 0 0 #e02f44;
    }
    .ag-row-pinned {
      font-weight: 600;
      border-top: 2px solid rgba(127, 127, 127, 0.4);
    }

    /* AG Grid scrolls via dedicated .ag-body-vertical-scroll/-horizontal-scroll
       elements using the browser's native scrollbar (not a custom-drawn one),
       so it inherits the OS/browser default thumb color — barely visible
       against Grafana's dark theme. Neutral gray works against both themes. */
    .ag-body-vertical-scroll-viewport,
    .ag-body-horizontal-scroll-viewport {
      scrollbar-color: rgba(150, 150, 150, 0.6) transparent;
    }
    .ag-body-vertical-scroll-viewport::-webkit-scrollbar,
    .ag-body-horizontal-scroll-viewport::-webkit-scrollbar {
      width: 12px;
      height: 12px;
    }
    .ag-body-vertical-scroll-viewport::-webkit-scrollbar-thumb,
    .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-thumb {
      background-color: rgba(150, 150, 150, 0.6);
      border-radius: 6px;
      border: 3px solid transparent;
      background-clip: content-box;
    }
    .ag-body-vertical-scroll-viewport::-webkit-scrollbar-thumb:hover,
    .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-thumb:hover {
      background-color: rgba(150, 150, 150, 0.9);
    }
  `,
  toastStack: css`
    position: absolute;
    top: 8px;
    right: 8px;
    max-height: calc(100% - 16px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 1000;
  `,
  noticeStack: css`
    position: absolute;
    bottom: 8px;
    right: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 1000;
  `,
  toast: css`
    background: #e02f44;
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    max-width: 320px;
  `,
  notice: css`
    color: white;
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 12px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    max-width: 320px;
  `,
  dismiss: css`
    float: right;
    margin-left: 8px;
  `,
  addError: css`
    color: #e02f44;
    margin-bottom: 8px;
  `,
  warningBanner: css`
    background: #f5a623;
    color: #1a1a1a;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
  `,
});

export const TablePanel: React.FC<Props> = ({ options, data, width, height, id, timeRange }) => {
  const styles = useStyles2(getStyles);

  const [selected, setSelected] = useState<{ rowId: string | null; col: string | null }>({
    rowId: null,
    col: null,
  });
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [modalRow, setModalRow] = useState<RowRecord | null>(null);
  const [footerRow, setFooterRow] = useState<RowRecord | null>(null);
  const [editNotice, setEditNotice] = useState<EditNotice | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addValues, setAddValues] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState<string | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [notifPermission, setNotifPermission] = useState(getNotificationPermission());
  const [quickFilterText, setQuickFilterText] = useState('');
  const [saveFilterOpen, setSaveFilterOpen] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState('');
  const [selectedPresetName, setSelectedPresetName] = useState<string | null>(null);
  // Panel `id` alone is only unique *within* a single dashboard — Grafana
  // reuses small integer ids across dashboards (and across copy-pasted
  // panels), so keying localStorage on `id` alone let filters/presets from
  // one dashboard's panel bleed into an unrelated panel that happened to
  // land on the same id. Fold in the dashboard UID so persistence is scoped
  // to this exact panel instance. Falls back to just `id` if the UID isn't
  // available (e.g. panel edit preview, which has no saved dashboard yet).
  const dashboardUid: string | undefined = (data.request as any)?.dashboardUID;
  const storageScope = dashboardUid ? `${dashboardUid}-${id}` : String(id);

  // Plain localStorage (per-browser) — usePluginUserStorage was tried here
  // but its backend API 404s in this Grafana install (alpha/experimental
  // feature, evidently not enabled), and its internal lock-serialization
  // logic appears not to recover cleanly from that, which correlated with
  // real page hangs. Reverted for reliability.
  const [savedFilters, setSavedFilters] = useState<Record<string, any>>(() => {
    try {
      const raw = localStorage.getItem(`rfqtable-filter-presets-${storageScope}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  // Ticks every few seconds so the client-side rules (simple rule, ticker
  // rule) re-evaluate even when nothing about this panel's own query
  // changed — e.g. the user just changed a watched-list variable, which
  // isn't referenced in the SQL and so doesn't necessarily trigger a data
  // refresh on its own.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(interval);
  }, []);

  // Shared across both row-based rules (popup-for-all, popup-on-filtered)
  // so a given row only ever pops once total, even if it satisfies both at
  // once. The alert-query mechanism keeps its own key since its ids aren't
  // necessarily this table's own row ids at all.
  const rowAlertStorageKeyRef = useRef(`rfqtable-seen-rowalert-ids-${storageScope}`);
  const queryStorageKeyRef = useRef(`rfqtable-seen-queryalert-ids-${storageScope}`);
  const filterStorageKeyRef = useRef(`rfqtable-filter-model-${storageScope}`);
  const filterPresetsStorageKeyRef = useRef(`rfqtable-filter-presets-${storageScope}`);
  const gridApiRef = useRef<any>(null);
  const isRevertingRef = useRef(false);

  const frame = data.series[0];
  const datasourceUid: string | undefined = (data.request?.targets?.[0] as any)?.datasource?.uid;

  // A stable signature of the field *schema* (names/types/config) — used
  // instead of `frame` itself as the colDefs memo key below. Grafana hands
  // us a brand-new `frame` object every refresh even when only cell values
  // changed, and passing a new `columnDefs` array to AG Grid on every
  // refresh makes it treat the grid as structurally changed, which resets
  // any in-progress filter popup (e.g. picking "Greater than" snapping back
  // to "Equals" mid-interaction on an auto-refreshing panel). Keying colDefs
  // on this signature instead means they only get rebuilt when the schema
  // actually changes, not on every data tick.
  const schemaSignature = useMemo(() => {
    if (!frame) {
      return '';
    }
    return frame.fields
      .map((f) => `${f.name}:${f.type}:${JSON.stringify(f.config?.custom)}:${f.config?.displayName ?? ''}`)
      .join('|');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  const { colDefs, fieldFormatters, fieldDisplayNames } = useMemo(() => {
    if (!frame) {
      return {
        colDefs: [] as ColDef[],
        fieldFormatters: new Map<string, (raw: any) => string>(),
        fieldDisplayNames: new Map<string, string>(),
      };
    }

    const fieldFormatterMap = new Map<string, (raw: any) => string>();
    const fieldDisplayNameMap = new Map<string, string>();

    const defs: ColDef[] = frame.fields.map((field) => {
      const custom = field.config?.custom as TableFieldConfig | undefined;
      // Some datasource query paths (seen with certain postgres-wire-protocol
      // query modes) mis-tag a genuinely numeric column (e.g. a plain
      // DOUBLE) as a non-number field type — sometimes even delivering its
      // values as numeric-looking strings ("123.45") rather than real
      // numbers. Left alone, this silently downgrades the column to a text
      // "contains" filter with no Greater than/Between. Fall back to
      // sniffing the actual values when the declared type disagrees.
      const declaredNumeric = field.type === FieldType.number;
      const sampledValues = (field.values as any[]).filter((v) => v != null).slice(0, 20);
      const isNumericString = (v: any) => typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v));
      const looksNumeric =
        !declaredNumeric &&
        sampledValues.length > 0 &&
        sampledValues.every((v) => (typeof v === 'number' && !Number.isNaN(v)) || isNumericString(v));
      const isNumericType = declaredNumeric || looksNumeric;
      // If the sniffed values are strings, AG Grid's sort/number-filter need
      // an actual number to compare against — coerce it wherever a raw
      // value is read, rather than relying on the string already sitting in
      // the row record.
      const needsNumericCoercion = looksNumeric && sampledValues.some((v) => typeof v === 'string');
      const isPriceField = Boolean(custom?.thirtySecondsFormat);
      // Numeric fields keep the min/max/</> number filter; everything else
      // (including price fields, which need text-style "contains" search
      // against "99-16+" rather than a numeric comparison) uses text filter.
      const useNumericFilter = isNumericType && !isPriceField;

      // Whether the user has explicitly picked a Unit for this field
      // (Standard options / Overrides) — when they have, Grafana's own
      // display pipeline below already knows how to format it (currency,
      // percent, SI-prefixed "short", etc.) and takes precedence. When they
      // haven't, the "none" unit's default formatter just stringifies the
      // raw number with no thousands separators (e.g. "1000000"), which
      // reads poorly for anything but tiny values — so plain numeric
      // columns without an explicit unit get locale-formatted (1,000,000)
      // instead.
      const hasExplicitUnit = Boolean(field.config?.unit) && field.config.unit !== 'none';

      const formatValue = (raw: any): string => {
        if (raw == null) {
          return '';
        }
        const value = needsNumericCoercion && isNumericString(raw) ? Number(raw) : raw;
        if (isPriceField && typeof value === 'number') {
          return decimalToThirtySeconds(value);
        }
        if (isNumericType && typeof value === 'number' && !hasExplicitUnit) {
          const decimals = field.config?.decimals;
          return value.toLocaleString(
            undefined,
            decimals != null
              ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
              : { maximumFractionDigits: 6 }
          );
        }
        // Runs the value through Grafana's standard display pipeline, so
        // per-field Unit/Decimals overrides (set in the Overrides section,
        // same as the native Table panel) are respected — this is also
        // what turns a time field's raw epoch number into a readable date.
        if (field.display) {
          return formattedValueToString(field.display(value));
        }
        return String(value);
      };

      fieldFormatterMap.set(field.name, formatValue);
      fieldDisplayNameMap.set(field.name, field.config?.displayName || field.name);

      // Right-align numeric and price columns (even though a price cell's
      // rendered text is the "99-16+" string, the underlying value is a
      // real number, so it reads more naturally right-aligned like the
      // rest of the numeric columns).
      const alignRight = isNumericType || isPriceField;

      const def: ColDef = {
        field: field.name,
        headerName: field.config?.displayName || field.name,
        sortable: true,
        filter: useNumericFilter ? 'agNumberColumnFilter' : 'agTextColumnFilter',
        floatingFilter: options.showFloatingFilters,
        resizable: true,
        editable: Boolean(custom?.editable),
        valueFormatter: (p) => formatValue(p.value),
        cellClass: alignRight ? 'ag-right-aligned-cell' : undefined,
        headerClass: alignRight ? 'ag-right-aligned-header' : undefined,
        cellClassRules: {
          'rfq-col-selected': () => selected.col === field.name,
        },
      };
      if (!useNumericFilter) {
        // Floating filter text search matches what's on screen (e.g. the
        // formatted date, or "99-16" for a bond price) rather than the raw
        // underlying value.
        def.filterValueGetter = (p) => formatValue(p.data?.[field.name]);
      } else if (needsNumericCoercion) {
        def.valueGetter = (p) => {
          const raw = p.data?.[field.name];
          if (raw == null) {
            return null;
          }
          return isNumericString(raw) ? Number(raw) : raw;
        };
      }

      // Cell display mode — colored background/text reuse whatever color
      // field.display() already computed from Value mappings/Thresholds
      // (Standard options); pill/gauge/sparkline need a custom renderer.
      const cellDisplayMode = custom?.cellDisplayMode || 'none';
      const getDisplayColor = (raw: any): string | undefined => {
        if (raw == null || !field.display) {
          return undefined;
        }
        return field.display(raw).color;
      };

      if (cellDisplayMode === 'colorBackground') {
        def.cellStyle = (p: any) => {
          const color = getDisplayColor(p.value);
          return color ? { backgroundColor: color, color: '#fff' } : undefined;
        };
      } else if (cellDisplayMode === 'colorText') {
        def.cellStyle = (p: any) => {
          const color = getDisplayColor(p.value);
          return color ? { color, fontWeight: 600 } : undefined;
        };
      } else if (cellDisplayMode === 'pill') {
        def.cellRenderer = (p: any) => {
          if (p.value == null) {
            return null;
          }
          const color = getDisplayColor(p.value) || '#6b7280';
          return (
            <span
              style={{
                background: color,
                color: '#fff',
                borderRadius: 12,
                padding: '1px 10px',
                fontSize: 11,
                fontWeight: 600,
                display: 'inline-block',
                lineHeight: '16px',
              }}
            >
              {formatValue(p.value)}
            </span>
          );
        };
      } else if (cellDisplayMode === 'gauge') {
        // Reuses Standard options' Min/Max if set; otherwise auto-ranges
        // from this field's own values.
        let min = field.config?.min;
        let max = field.config?.max;
        if (min == null || max == null) {
          const numericVals = (field.values as any[]).filter((v) => typeof v === 'number');
          if (numericVals.length > 0) {
            if (min == null) {
              min = Math.min(...numericVals);
            }
            if (max == null) {
              max = Math.max(...numericVals);
            }
          }
        }
        const rangeMin = min ?? 0;
        const rangeMax = max ?? 1;
        def.cellRenderer = (p: any) => {
          if (typeof p.value !== 'number') {
            return formatValue(p.value);
          }
          const pct =
            rangeMax > rangeMin ? Math.max(0, Math.min(100, ((p.value - rangeMin) / (rangeMax - rangeMin)) * 100)) : 0;
          const barColor = getDisplayColor(p.value) || '#3B82F6';
          return (
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: 16,
                background: 'rgba(127,127,127,0.15)',
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: barColor }}
              />
              <span style={{ position: 'relative', fontSize: 11, paddingLeft: 4, lineHeight: '16px' }}>
                {formatValue(p.value)}
              </span>
            </div>
          );
        };
      } else if (cellDisplayMode === 'sparkline') {
        def.cellRenderer = (p: any) => {
          const arr = Array.isArray(p.value) ? p.value.filter((v: any) => typeof v === 'number') : null;
          if (!arr || arr.length < 2) {
            return arr ? arr.join(', ') : '';
          }
          const w = 90;
          const h = 22;
          const seriesMin = Math.min(...arr);
          const seriesMax = Math.max(...arr);
          const range = seriesMax - seriesMin || 1;
          const points = arr
            .map((v: number, i: number) => {
              const x = (i / (arr.length - 1)) * w;
              const y = h - ((v - seriesMin) / range) * h;
              return `${x},${y}`;
            })
            .join(' ');
          const trendColor = arr[arr.length - 1] >= arr[0] ? '#37872d' : '#e02f44';
          return (
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
              <polyline points={points} fill="none" stroke={trendColor} strokeWidth={1.5} />
            </svg>
          );
        };
        // An array-valued field isn't meaningfully text-filterable or
        // sortable in the usual scalar sense.
        def.filter = false;
        def.sortable = false;
        def.floatingFilter = false;
      }

      return def;
    });

    return { colDefs: defs, fieldFormatters: fieldFormatterMap, fieldDisplayNames: fieldDisplayNameMap };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaSignature, selected.col, options.showFloatingFilters]);

  // Row data, by contrast, is meant to refresh every tick — kept as its own
  // memo keyed on the real `frame` object so new/changed rows show up
  // immediately, without touching `colDefs` (see schemaSignature comment
  // above) or resetting AG Grid's column/filter state.
  const { rows, rowById } = useMemo(() => {
    if (!frame) {
      return { rows: [] as RowRecord[], rowById: new Map<string, RowRecord>() };
    }
    const rowCount = frame.length;
    const nextRows: RowRecord[] = [];
    const nextRowById = new Map<string, RowRecord>();
    for (let i = 0; i < rowCount; i++) {
      const record: RowRecord = { __rowId: '' };
      frame.fields.forEach((field) => {
        record[field.name] = field.values[i];
      });
      const rfqId =
        options.uniqueIdFields && options.uniqueIdFields.length > 0
          ? options.uniqueIdFields.map((f) => String(record[f] ?? '')).join('|')
          : String(i);
      record.__rowId = rfqId;
      nextRows.push(record);
      nextRowById.set(rfqId, record);
    }
    return { rows: nextRows, rowById: nextRowById };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, options.uniqueIdFields?.join(',')]);

  // Totals row reacts to AG Grid's actual filtered rows (not just the raw
  // query result), so e.g. Count matches what's currently on screen.
  const recomputeFooter = useCallback(() => {
    const api = gridApiRef.current;
    if (!api || !frame) {
      return;
    }
    const fieldsWithCalc = frame.fields.filter((f) => (f.config?.custom as TableFieldConfig | undefined)?.footerCalc);
    if (fieldsWithCalc.length === 0) {
      setFooterRow(null);
      return;
    }
    const filtered: RowRecord[] = [];
    api.forEachNodeAfterFilter((node: any) => {
      if (node.data) {
        filtered.push(node.data);
      }
    });
    const rec: RowRecord = { __rowId: '__footer__' };
    fieldsWithCalc.forEach((field) => {
      const calc = (field.config?.custom as TableFieldConfig).footerCalc as string;
      const values = filtered.map((r) => r[field.name]);
      rec[field.name] = reduceField({ field: { values, config: field.config } as any, reducers: [calc] })[calc];
    });
    setFooterRow(rec);
  }, [frame]);

  // Builds the "field: value" detail text shown in a popup/notification for
  // a given row, from whatever fields the user picked in "Popup detail
  // fields" — same formatting pipeline as the grid itself.
  const buildPopupDetailText = useCallback(
    (row: RowRecord): string => {
      const fields = options.popupFields ?? [];
      return fields
        .map((f) => {
          const label = fieldDisplayNames.get(f) ?? f;
          const value = fieldFormatters.get(f)?.(row[f]) ?? String(row[f] ?? '');
          return `${label}: ${value}`;
        })
        .join(' — ');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.popupFields?.join(','), fieldFormatters, fieldDisplayNames]
  );

  // Popup on filtered rows — no SQL, no variables: whatever's currently
  // matching the grid's own floating filters is the criteria. Fires once
  // per row id the first time it appears in the filtered view, whether
  // because it's genuinely new data or because a filter just changed to
  // newly include it.
  const checkFilteredRowsForAlerts = useCallback(() => {
    const api = gridApiRef.current;
    // Without a real unique id, "new row" detection falls back to row
    // position, which is unreliable — refuse to fire rather than produce
    // misleading pops/silent misses (see the in-panel warning banner).
    if (!api || !options.popupOnFilteredRows || !options.uniqueIdFields?.length) {
      return;
    }
    const filteredIds: string[] = [];
    const filteredRowById = new Map<string, RowRecord>();
    api.forEachNodeAfterFilter((node: any) => {
      if (node.data) {
        filteredIds.push(node.data.__rowId);
        filteredRowById.set(node.data.__rowId, node.data);
      }
    });

    const newIds = pickNewAlertIds(rowAlertStorageKeyRef.current, filteredIds);
    if (newIds.length === 0) {
      return;
    }
    flashRows(newIds);

    const newToasts: ToastItem[] = newIds
      .slice(0, MAX_ALERT_BATCH)
      .map((rid) => filteredRowById.get(rid))
      .filter((r): r is RowRecord => !!r)
      .map((row) => ({ id: row.__rowId, row, kind: 'row' }));

    if (options.useDesktopNotifications && notifPermission === 'granted') {
      newToasts.forEach((t) => {
        showDesktopNotification(`New row: ${t.id}`, buildPopupDetailText(t.row), () => setModalRow(t.row));
      });
    } else {
      addToasts(newToasts);
    }
  }, [options.popupOnFilteredRows, options.uniqueIdFields?.join(','), options.useDesktopNotifications, buildPopupDetailText, notifPermission]);

  // Persist the header (floating) filters across sessions — localStorage,
  // per-browser (see the comment on savedFilters above for why this isn't
  // usePluginUserStorage).
  const saveFilterModel = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) {
      return;
    }
    try {
      localStorage.setItem(filterStorageKeyRef.current, JSON.stringify(api.getFilterModel()));
    } catch {
      // localStorage unavailable (e.g. private browsing) — filters just
      // won't persist, no functional impact otherwise.
    }
  }, []);

  const restoreFilterModel = useCallback(async () => {
    const api = gridApiRef.current;
    if (!api) {
      return;
    }
    try {
      const raw = localStorage.getItem(filterStorageKeyRef.current);
      if (raw) {
        api.setFilterModel(JSON.parse(raw));
      }
    } catch {
      // ignore malformed/unavailable storage — grid just starts unfiltered
    }
  }, []);

  // Named filter presets — save the current header-filter state under a
  // name, reload it later from a dropdown. Separate from the automatic
  // last-used-filter persistence above.
  const saveNamedFilter = useCallback((name: string) => {
    const api = gridApiRef.current;
    const trimmed = name.trim();
    if (!api || !trimmed) {
      return;
    }
    const model = api.getFilterModel();
    setSavedFilters((prev) => {
      const next = { ...prev, [trimmed]: model };
      try {
        localStorage.setItem(filterPresetsStorageKeyRef.current, JSON.stringify(next));
      } catch {
        // localStorage unavailable — preset just won't survive this session
      }
      return next;
    });
    setSelectedPresetName(trimmed);
  }, []);

  const applyNamedFilter = useCallback(
    (name: string) => {
      const api = gridApiRef.current;
      const model = savedFilters[name];
      if (!api || !model) {
        return;
      }
      api.setFilterModel(model);
      setSelectedPresetName(name);
    },
    [savedFilters]
  );

  const deleteNamedFilter = useCallback((name: string) => {
    setSavedFilters((prev) => {
      const next = { ...prev };
      delete next[name];
      try {
        localStorage.setItem(filterPresetsStorageKeyRef.current, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    setSelectedPresetName((current) => (current === name ? null : current));
  }, []);

  const onGridReady = useCallback(
    (event: any) => {
      gridApiRef.current = event.api;
      recomputeFooter();
      restoreFilterModel().then(() => {
        // Deferred to the next tick: right after new rowData lands, AG Grid
        // may not have finished re-applying the active filter to the newly
        // arrived rows yet — reading forEachNodeAfterFilter synchronously
        // here could catch that transient, not-yet-filtered state.
        setTimeout(checkFilteredRowsForAlerts, 0);
      });
    },
    [restoreFilterModel, recomputeFooter, checkFilteredRowsForAlerts]
  );

  const onModelUpdated = useCallback(() => {
    recomputeFooter();
    setTimeout(checkFilteredRowsForAlerts, 0);
  }, [recomputeFooter, checkFilteredRowsForAlerts]);

  const onFilterChanged = useCallback(() => {
    saveFilterModel();
  }, [saveFilterModel]);

  // Safety net: also re-check on the same tick interval the other
  // client-side rules use, in case a model-updated event was ever missed.
  useEffect(() => {
    checkFilteredRowsForAlerts();
  }, [checkFilteredRowsForAlerts, tick]);

  // Popup for every row — no criteria at all. Meant for a dedicated second
  // panel pointed at an already-filtered query, so "what fires a popup" is
  // just whatever that query returns, no SQL templating needed here.
  useEffect(() => {
    if (!options.popupForAllRows || !options.uniqueIdFields?.length) {
      return;
    }

    const newIds = pickNewAlertIds(
      rowAlertStorageKeyRef.current,
      rows.map((r) => r.__rowId)
    );
    if (newIds.length === 0) {
      return;
    }
    flashRows(newIds);

    const newToasts: ToastItem[] = newIds
      .slice(0, MAX_ALERT_BATCH)
      .map((rfqId) => rowById.get(rfqId))
      .filter((r): r is RowRecord => !!r)
      .map((row) => ({ id: row.__rowId, row, kind: 'row' }));

    if (options.useDesktopNotifications && notifPermission === 'granted') {
      newToasts.forEach((t) => {
        showDesktopNotification(`New row: ${t.id}`, buildPopupDetailText(t.row), () => setModalRow(t.row));
      });
    } else {
      addToasts(newToasts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Alert query — a second, independent alert source: an arbitrary SELECT,
  // re-run every time the panel refreshes (piggybacks on the same [rows]
  // trigger as the simple rule above, since a new `frame` reference means a
  // refresh happened regardless of whether the main table's content
  // actually changed). Can express relative/cross-row conditions or
  // conditions from a completely unrelated query, since it isn't limited to
  // this table's own displayed rows.
  useEffect(() => {
    if (!options.enableAlertQuery || !options.alertQuerySql || !datasourceUid) {
      return;
    }

    let cancelled = false;
    runSelectQuery(datasourceUid, options.alertQuerySql, timeRange)
      .then((frames) => {
        if (cancelled) {
          return;
        }
        const resultFrame = frames[0];
        if (!resultFrame) {
          return;
        }
        const records = frameToRecords(resultFrame);
        const idField = options.alertQueryIdField;
        const withIds = records.map((record, index) => ({
          id: idField && record[idField] != null ? String(record[idField]) : `row-${index}-${JSON.stringify(record)}`,
          record,
        }));

        const newIds = pickNewAlertIds(
          queryStorageKeyRef.current,
          withIds.map((r) => r.id)
        );
        if (newIds.length === 0) {
          return;
        }

        const newIdSet = new Set(newIds.slice(0, MAX_ALERT_BATCH));
        const newToasts: ToastItem[] = withIds
          .filter((r) => newIdSet.has(r.id))
          .map((r) => ({ id: r.id, row: { __rowId: r.id, ...r.record }, kind: 'query' }));

        if (options.useDesktopNotifications && notifPermission === 'granted') {
          newToasts.forEach((t) => {
            const summary = Object.entries(t.row)
              .filter(([k]) => k !== '__rowId' && k !== idField)
              .slice(0, 3)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ');
            showDesktopNotification(`Alert: ${t.id}`, summary, () => setModalRow(t.row));
          });
        } else {
          addToasts(newToasts);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setEditNotice({ type: 'error', message: `Alert query failed: ${err?.message ?? err}` });
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Auto-clear edit/add success/error notices.
  useEffect(() => {
    if (!editNotice) {
      return;
    }
    const t = setTimeout(() => setEditNotice(null), 4000);
    return () => clearTimeout(t);
  }, [editNotice]);

  const dismissToast = useCallback((toastId: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, []);

  const dismissAllToasts = useCallback(() => {
    setToasts([]);
  }, []);

  // Guaranteed backstop: several independent alert mechanisms can each
  // decide a row is newly-qualifying and try to toast it — this ensures
  // the toast list itself never ends up with two entries for the same id,
  // regardless of how many of them fired for it. Each caller already caps
  // its own batch at MAX_ALERT_BATCH before calling this, but the combined
  // total across multiple mechanisms is capped again here too.
  // Briefly flashes newly-arrived matching rows in-grid, alongside whichever
  // popup mechanism fired — reuses AG Grid's built-in cell flash (all
  // columns, so the whole row appears to flash) rather than hand-rolled
  // timers/CSS classes. Only meaningful for row-based rules (popup-for-all,
  // popup-on-filtered): the alert query's ids don't necessarily correspond
  // to any row in this grid at all.
  const flashRows = useCallback((ids: string[]) => {
    const api = gridApiRef.current;
    if (!api || ids.length === 0 || ids.length > MAX_FLASH_BATCH) {
      return;
    }
    const rowNodes = ids.map((id) => api.getRowNode(id)).filter(Boolean);
    if (rowNodes.length > 0) {
      api.flashCells({ rowNodes, flashDuration: 1500, fadeDuration: 500 });
    }
  }, []);

  const addToasts = useCallback(
    (newToasts: ToastItem[]) => {
      if (newToasts.length === 0) {
        return;
      }
      if (options.playSoundOnAlert) {
        playAlertSound();
      }
      setToasts((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const deduped = newToasts.filter((t) => !existingIds.has(t.id));
        if (deduped.length === 0) {
          return prev;
        }
        const combined = [...prev, ...deduped];
        return combined.length > MAX_ALERT_BATCH ? combined.slice(combined.length - MAX_ALERT_BATCH) : combined;
      });
    },
    [options.playSoundOnAlert]
  );

  const openToastDetail = useCallback(
    (toast: ToastItem) => {
      setModalRow(toast.row);
      dismissToast(toast.id);
    },
    [dismissToast]
  );

  const onCellClicked = useCallback((event: any) => {
    const rowId = event.data?.__rowId ?? null;
    const col = event.colDef?.field ?? null;
    setSelected({ rowId, col });
  }, []);

  // Inline editing: a cell with an "Update SQL" override runs that template
  // (${value} = new value, ${row.fieldName} = other fields) against the
  // panel's own datasource on commit. Reverts the cell on failure.
  const onCellValueChanged = useCallback(
    (event: any) => {
      if (isRevertingRef.current || !frame) {
        return;
      }
      const fieldName: string | undefined = event.colDef?.field;
      if (!fieldName) {
        return;
      }
      const field = frame.fields.find((f) => f.name === fieldName);
      const template = (field?.config?.custom as TableFieldConfig | undefined)?.editSql;
      if (!template) {
        return;
      }
      if (!datasourceUid) {
        isRevertingRef.current = true;
        event.node.setDataValue(fieldName, event.oldValue);
        isRevertingRef.current = false;
        setEditNotice({ type: 'error', message: "No datasource found for this panel's query — cannot save edit." });
        return;
      }

      const sql = renderSqlTemplate(template, event.data, event.newValue);
      runSql(datasourceUid, sql, timeRange)
        .then(() => {
          setEditNotice({ type: 'success', message: `Saved ${fieldName} on ${event.data.__rowId}.` });
        })
        .catch((err: any) => {
          isRevertingRef.current = true;
          event.node.setDataValue(fieldName, event.oldValue);
          isRevertingRef.current = false;
          setEditNotice({ type: 'error', message: `Edit failed: ${err?.message ?? err}` });
        });
    },
    [frame, datasourceUid, timeRange]
  );

  const getRowClass = useCallback(
    (params: any) => {
      const classes: string[] = [];
      if (params.data?.__rowId === selected.rowId) {
        classes.push('rfq-row-selected');
      }
      if (
        options.highlightAmountField &&
        Number(params.data?.[options.highlightAmountField]) > options.alertSizeThreshold &&
        (!options.highlightConditionField || Number(params.data?.[options.highlightConditionField]) !== 0)
      ) {
        classes.push('rfq-row-alert');
      }
      return classes;
    },
    [selected.rowId, options.highlightAmountField, options.highlightConditionField, options.alertSizeThreshold]
  );

  const editableFields = useMemo(
    () => (frame ? frame.fields.filter((f) => (f.config?.custom as TableFieldConfig | undefined)?.editable) : []),
    [frame]
  );

  const enableDesktopNotifications = useCallback(() => {
    // Must run from a real click handler — browsers silently ignore (or
    // never show the prompt for) requestPermission() called from a
    // background effect.
    requestNotificationPermission().then(setNotifPermission);
  }, []);

  const openAdd = useCallback(() => {
    setAddValues({});
    setAddError(null);
    setAddOpen(true);
  }, []);

  const submitAdd = useCallback(async () => {
    if (!datasourceUid) {
      setAddError("No datasource found for this panel's query.");
      return;
    }
    setAddSubmitting(true);
    setAddError(null);
    try {
      const rowContext: Record<string, any> = {};
      editableFields.forEach((field) => {
        const raw = addValues[field.name] ?? '';
        rowContext[field.name] = field.type === FieldType.number ? Number(raw) : raw;
      });
      const sql = renderSqlTemplate(options.addRowSql, rowContext);
      await runSql(datasourceUid, sql, timeRange);
      setAddOpen(false);
      setEditNotice({ type: 'success', message: 'Row added — it will appear on the next data refresh.' });
    } catch (err: any) {
      setAddError(err?.message ?? String(err));
    } finally {
      setAddSubmitting(false);
    }
  }, [datasourceUid, timeRange, editableFields, addValues, options.addRowSql]);

  if (!frame || rows.length === 0) {
    return (
      <div className={styles.wrapper} style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        No data
      </div>
    );
  }

  const popupsNeedUniqueId = (options.popupForAllRows || options.popupOnFilteredRows) && !options.uniqueIdFields?.length;

  return (
    <div className={styles.wrapper} style={{ width, height }}>
      {popupsNeedUniqueId && (
        <div className={styles.warningBanner}>
          Popups are disabled: set "Unique row ID field(s)" in the panel's Field mapping options to enable them.
        </div>
      )}
      <div className={styles.toastStack}>
        {toasts.length > 1 && (
          <Button size="sm" variant="secondary" onClick={dismissAllToasts}>
            Dismiss all ({toasts.length})
          </Button>
        )}
        {toasts.map((t) => (
          <div key={t.id} className={styles.toast} onClick={() => openToastDetail(t)}>
            {t.kind === 'row' ? (
              <>
                New row: {t.id}
                {options.popupFields?.length ? ` — ${buildPopupDetailText(t.row)}` : ''}
              </>
            ) : (
              <>
                Alert: {t.id}
                {Object.entries(t.row)
                  .filter(([k]) => k !== '__rowId' && k !== options.alertQueryIdField)
                  .slice(0, 2)
                  .map(([k, v]) => ` — ${k}: ${v}`)
                  .join('')}
              </>
            )}
            <span
              className={styles.dismiss}
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(t.id);
              }}
            >
              ✕
            </span>
          </div>
        ))}
      </div>

      {editNotice && (
        <div className={styles.noticeStack}>
          <div
            className={styles.notice}
            style={{ background: editNotice.type === 'error' ? '#e02f44' : '#37872d' }}
          >
            {editNotice.message}
          </div>
        </div>
      )}

      <div className={styles.toolbar}>
        <Input
          width={28}
          prefix={<Icon name="search" />}
          placeholder="Search all columns..."
          value={quickFilterText}
          onChange={(e) => setQuickFilterText((e.target as HTMLInputElement).value)}
        />
        <Select
          width={22}
          placeholder="Load saved filter..."
          value={selectedPresetName ? { label: selectedPresetName, value: selectedPresetName } : null}
          options={Object.keys(savedFilters).map((name) => ({ label: name, value: name }))}
          onChange={(opt: any) => {
            if (opt?.value) {
              applyNamedFilter(opt.value);
            } else {
              // Cleared via the "x" — also clears the table's actual
              // filters, not just the dropdown's own selection.
              gridApiRef.current?.setFilterModel(null);
              setSelectedPresetName(null);
            }
          }}
          isClearable
        />
        {selectedPresetName && (
          <Button
            size="sm"
            variant="destructive"
            icon="trash-alt"
            onClick={() => deleteNamedFilter(selectedPresetName)}
          >
            Delete
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          icon="save"
          onClick={() => {
            setSaveFilterName('');
            setSaveFilterOpen(true);
          }}
        >
          Save filter...
        </Button>
      </div>

      {((options.useDesktopNotifications && notifPermission === 'default') || (options.enableAddRow && options.addRowSql)) && (
        <div className={styles.toolbar}>
          {options.useDesktopNotifications && notifPermission === 'default' && (
            <Button size="sm" variant="secondary" icon="bell" onClick={enableDesktopNotifications}>
              Enable desktop notifications
            </Button>
          )}
          {options.enableAddRow && options.addRowSql && (
            <Button size="sm" icon="plus" onClick={openAdd}>
              Add row
            </Button>
          )}
        </div>
      )}

      <div className={cx('ag-theme-quartz', styles.grid)}>
        <AgGridReact
          rowData={rows}
          columnDefs={colDefs}
          quickFilterText={quickFilterText}
          theme="legacy"
          multiSortKey="ctrl"
          animateRows={false}
          rowHeight={24}
          headerHeight={28}
          floatingFiltersHeight={28}
          enableCellTextSelection={true}
          ensureDomOrder={true}
          pinnedBottomRowData={footerRow ? [footerRow] : undefined}
          onGridReady={onGridReady}
          onModelUpdated={onModelUpdated}
          onFilterChanged={onFilterChanged}
          onCellClicked={onCellClicked}
          onCellValueChanged={onCellValueChanged}
          getRowClass={getRowClass}
          getRowId={(p) => p.data.__rowId}
        />
      </div>

      {modalRow && (
        <Modal isOpen title={`Detail: ${modalRow.__rowId}`} onDismiss={() => setModalRow(null)}>
          <table>
            <tbody>
              {Object.entries(modalRow)
                .filter(([k]) => k !== '__rowId')
                .map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ fontWeight: 600, paddingRight: 12 }}>{k}</td>
                    <td>{v == null ? '' : (fieldFormatters.get(k)?.(v) ?? String(v))}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Modal>
      )}

      {addOpen && (
        <Modal isOpen title="Add row" onDismiss={() => setAddOpen(false)}>
          {editableFields.map((field) => (
            <Field key={field.name} label={field.config?.displayName || field.name}>
              <Input
                value={addValues[field.name] ?? ''}
                onChange={(e) =>
                  setAddValues((prev) => ({ ...prev, [field.name]: (e.target as HTMLInputElement).value }))
                }
              />
            </Field>
          ))}
          {addError && <div className={styles.addError}>{addError}</div>}
          <Button onClick={submitAdd} disabled={addSubmitting}>
            {addSubmitting ? 'Adding…' : 'Add'}
          </Button>
        </Modal>
      )}

      {saveFilterOpen && (
        <Modal isOpen title="Save filter" onDismiss={() => setSaveFilterOpen(false)}>
          <Field label="Name">
            <Input
              value={saveFilterName}
              onChange={(e) => setSaveFilterName((e.target as HTMLInputElement).value)}
              placeholder="e.g. CEDAR watch"
              autoFocus
            />
          </Field>
          <Button
            onClick={() => {
              saveNamedFilter(saveFilterName);
              setSaveFilterOpen(false);
            }}
            disabled={!saveFilterName.trim()}
          >
            Save
          </Button>
        </Modal>
      )}
    </div>
  );
};
