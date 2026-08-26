export interface TableOptions {
  // Display — off by default is `true` (shown), since floating filters are
  // the panel's headline feature; this exists for cases where the extra
  // row isn't wanted (e.g. a compact secondary panel) and every bit of
  // vertical space should go to data rows instead.
  showFloatingFilters: boolean;

  // Field mapping — generic, works against any query's result set (not
  // specific to the RFQ blotter use case). Fields are chosen from whatever
  // columns the panel's own query actually returns.

  // Uniquely identifies each row — a compound key (one or more fields,
  // joined together) since a single field is often only unique within some
  // other scope (e.g. a trade_id that resets daily). Required to
  // de-duplicate alert popups — without it, "new row" detection falls back
  // to the row's position in the result set, which is unreliable (a query
  // with no stable ORDER BY can shuffle an already-seen row into a new
  // position, silently swallowing its popup, or vice versa). Enforced as
  // mandatory whenever either popup option below is enabled — see the
  // in-panel warning banner.
  uniqueIdFields: string[];

  // Optional: numeric field compared against alertSizeThreshold below to
  // visually highlight a row (red left edge). Leave blank to disable the
  // highlight entirely.
  highlightAmountField: string;
  // Optional: only highlight when this field's value is non-zero (e.g. a
  // "position" column — highlight large trades only where you're still
  // holding something). Leave blank to highlight on highlightAmountField
  // alone.
  highlightConditionField: string;

  // Optional: which fields' values appear (as "Header: value", in this
  // order) in alert popup/notification text, alongside the row's own
  // unique id. Leave empty to show just the id. Independent of the field
  // mapping fields above — pick anything, e.g. price, symbol, salesperson.
  popupFields: string[];

  // Visual-only: highlights a row (red left edge) when highlightAmountField
  // > alertSizeThreshold (and highlightConditionField, if set, != 0). Not
  // tied to any popup — purely a glance indicator.
  alertSizeThreshold: number;

  // "Popup for every row" — the simplest possible rule, and a way to avoid
  // writing any SQL/criteria at all: point a second copy of this panel at a
  // query that's already pre-filtered to whatever you personally care about
  // (e.g. WHERE salesperson = 'R. Patel', or any filter at all), enable
  // this, and every row that shows up in *that* panel pops. Independent of
  // — and can be used alongside — the other rules above.
  popupForAllRows: boolean;

  // "Popup on filtered rows" — fires whenever a row newly appears in the
  // grid's own currently-filtered view (the floating filter boxes you're
  // already typing into). No SQL, no dashboard variable, no separate panel
  // — just type e.g. "northco" + "sell" into the column filters and enable
  // this. Catches both a brand-new row that already matches, and an
  // existing row you haven't seen before that newly matches because you
  // just changed the filter.
  popupOnFilteredRows: boolean;

  // Fire OS-level desktop notifications for new qualifying RFQs instead of
  // the in-panel popup. Requires a one-time browser permission grant.
  useDesktopNotifications: boolean;

  // Plays a short generated tone alongside each new in-panel toast (not
  // desktop notifications, which already have their own OS sound).
  playSoundOnAlert: boolean;

  // "Add row" — inserts a new row via a SQL template using the fields
  // marked Editable in Overrides (see TableFieldConfig.editable).
  enableAddRow: boolean;
  addRowSql: string;

  // Alert query — a second, independent alert source. An arbitrary SELECT,
  // re-run every time the panel refreshes; every row it returns fires one
  // popup. Unlike the other rules (which only see this table's own rows),
  // this can express relative/cross-row conditions (self-joins, e.g. "bid
  // on one exchange > ask on another") or conditions from a completely
  // unrelated query (e.g. an aggregate risk view), since it isn't tied to
  // this panel's own displayed data at all. Grafana dashboard variables
  // ($my_var) are interpolated the same as in the main panel query.
  enableAlertQuery: boolean;
  alertQuerySql: string;
  // Which column in the alert query's result uniquely identifies an alert
  // instance, for edge-triggered de-dup (fire once per id, not every
  // refresh).
  alertQueryIdField: string;
}

export const defaultTableOptions: TableOptions = {
  showFloatingFilters: true,
  uniqueIdFields: [],
  highlightAmountField: '',
  highlightConditionField: '',
  popupFields: [],
  alertSizeThreshold: 500000,
  popupForAllRows: false,
  popupOnFilteredRows: false,
  useDesktopNotifications: false,
  playSoundOnAlert: false,
  enableAddRow: false,
  addRowSql: '',
  enableAlertQuery: false,
  alertQuerySql: '',
  alertQueryIdField: '',
};

// Per-field override (set via the panel editor's "Overrides" section, same
// as the native Table panel) rather than a global option, so it can target
// individual fields regardless of which query produced them.
export interface TableFieldConfig {
  thirtySecondsFormat?: boolean;

  // Opt-in per-field: render a plain number with locale thousands
  // separators (e.g. 1,000,000) instead of Grafana's raw "none"-unit
  // formatting. Off by default — auto-applying this to every numeric field
  // used to also catch encoded-integer columns that aren't really
  // quantities (e.g. a yyyyMMdd date stored as a number, or a timestamp
  // column whose type got misdetected), which mangled them into nonsense
  // like "20,260,825". Turn this on per-field for actual quantity columns
  // (size, notional, etc).
  thousandsSeparator?: boolean;
  // A @grafana/data ReducerID string (e.g. 'sum', 'mean', 'count'), or empty
  // for no totals-row entry on this field.
  footerCalc?: string;

  // Inline editing (VolkovLabs Business Table-style): editable cells run a
  // per-field SQL template on commit. Template supports ${value} (the new
  // cell value) and ${row.<fieldName>} (any other field's original value
  // for that row), e.g.:
  //   UPDATE rfqs SET price = ${value} WHERE rfq_id = ${row.rfq_id}
  editable?: boolean;
  editSql?: string;

  // Cell display mode — same idea as the native Table panel's "Cell type"
  // override. Colored modes reuse whatever Value mappings/Thresholds are
  // configured in Standard options for this field. Sparkline expects the
  // field's value to be an array of numbers per row (e.g. a price history),
  // not a plain scalar.
  cellDisplayMode?: 'none' | 'colorBackground' | 'colorText' | 'pill' | 'gauge' | 'sparkline';
}
