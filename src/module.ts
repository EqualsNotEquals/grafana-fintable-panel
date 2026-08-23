import { PanelPlugin, fieldReducers } from '@grafana/data';
import { TableOptions, TableFieldConfig, defaultTableOptions } from './types';
import { TablePanel } from './components/TablePanel';
import { MultiFieldPicker } from './components/MultiFieldPicker';

// Same reducer functions the native Table panel's column footer uses
// (Sum, Mean, Count, Min, Max, ...) — reused rather than hand-rolled.
const footerCalcOptions = [
  { value: '', label: 'None' },
  ...fieldReducers.list().map((r) => ({ value: r.id, label: r.name })),
];

export const plugin = new PanelPlugin<TableOptions, TableFieldConfig>(TablePanel)
  .useFieldConfig({
    useCustomConfig: (builder) => {
      builder
        .addBooleanSwitch({
          path: 'thirtySecondsFormat',
          name: 'Show as bond price (32nds+8ths)',
          description: 'Render this field as handle-32nds+eighths, e.g. 99-16+, instead of a plain decimal.',
          defaultValue: false,
          category: ['FinTable'],
        })
        .addSelect({
          path: 'footerCalc',
          name: 'Totals row function',
          description: 'Aggregation function shown for this field in the totals row at the bottom of the table.',
          defaultValue: '',
          category: ['FinTable'],
          settings: { options: footerCalcOptions },
        })
        .addBooleanSwitch({
          path: 'editable',
          name: 'Editable',
          description: 'Allow inline editing of this field (double-click a cell).',
          defaultValue: false,
          category: ['FinTable'],
        })
        .addTextInput({
          path: 'editSql',
          name: 'Update SQL',
          description:
            'SQL run when a cell in this field is edited. Use ${value} for the new value and ' +
            '${row.fieldName} for other fields in the row, e.g.: ' +
            'UPDATE rfqs SET price = ${value} WHERE rfq_id = ${row.rfq_id}',
          defaultValue: '',
          category: ['FinTable'],
          settings: { useTextarea: true, rows: 3 },
        })
        .addSelect({
          path: 'cellDisplayMode',
          name: 'Cell display mode',
          description:
            'Colored modes use whatever Value mappings/Thresholds are set above in Standard options. ' +
            'Sparkline expects this field\'s value to be an array of numbers per row, not a plain scalar.',
          defaultValue: 'none',
          category: ['FinTable'],
          settings: {
            options: [
              { value: 'none', label: 'None' },
              { value: 'colorBackground', label: 'Colored background' },
              { value: 'colorText', label: 'Colored text' },
              { value: 'pill', label: 'Pill' },
              { value: 'gauge', label: 'Bar gauge' },
              { value: 'sparkline', label: 'Sparkline' },
            ],
          },
        });
    },
  })
  .setPanelOptions((builder) => {
    return builder
    .addBooleanSwitch({
      path: 'showFloatingFilters',
      name: 'Show floating filters',
      description: 'The per-column filter row below the header. Turn off to give the grid more vertical room for data rows.',
      defaultValue: defaultTableOptions.showFloatingFilters,
      category: ['Display'],
    })
    .addCustomEditor({
      id: 'uniqueIdFields',
      path: 'uniqueIdFields',
      name: 'Unique row ID field(s)',
      description:
        'One or more fields whose combined value uniquely identifies each row — pick more than one if no ' +
        'single field is unique on its own (e.g. a trade_id that resets daily needs a date field alongside ' +
        'it). Required to de-duplicate alert popups. Mandatory if either popup option below (in Alert rule) ' +
        'is enabled; a warning banner shows on the panel until it\'s set.',
      defaultValue: defaultTableOptions.uniqueIdFields,
      category: ['Field mapping'],
      editor: MultiFieldPicker,
      settings: { placeholder: 'Select field(s) — combined, they must be unique per row' },
    })
    .addFieldNamePicker({
      path: 'highlightAmountField',
      name: 'Highlight amount field',
      description:
        'Optional. Numeric field compared against the Alert size threshold (below, in Alert rule) to ' +
        'visually highlight a row. Leave blank to disable the highlight.',
      defaultValue: defaultTableOptions.highlightAmountField,
      category: ['Field mapping'],
    })
    .addFieldNamePicker({
      path: 'highlightConditionField',
      name: 'Highlight condition field',
      description:
        'Optional. Only highlight when this field\'s value is non-zero (e.g. a "position" column). Leave ' +
        'blank to highlight on the amount field alone.',
      defaultValue: defaultTableOptions.highlightConditionField,
      category: ['Field mapping'],
    })
    .addCustomEditor({
      id: 'popupFields',
      path: 'popupFields',
      name: 'Popup detail fields',
      description:
        'Optional. Which fields (and in what order) appear in alert popup/notification text, alongside the ' +
        'row\'s own id — e.g. price, symbol, salesperson. Leave empty to show just the id.',
      defaultValue: defaultTableOptions.popupFields,
      category: ['Field mapping'],
      editor: MultiFieldPicker,
      settings: { placeholder: 'Select field(s) to show in popups, in order' },
    })
    .addNumberInput({
      path: 'alertSizeThreshold',
      name: 'Alert size threshold (visual only)',
      description:
        'Highlights a row (red left edge) when the Highlight amount field is above this value (and the ' +
        'Highlight condition field, if set, is non-zero). Not tied to any popup.',
      defaultValue: defaultTableOptions.alertSizeThreshold,
      category: ['Alert rule'],
    })
    .addBooleanSwitch({
      path: 'popupForAllRows',
      name: 'Popup for every row',
      description:
        'Simplest possible rule: every row this panel\'s query returns fires a popup, no criteria needed. ' +
        'Useful for a dedicated second copy of this panel pointed at a query already filtered to whatever ' +
        'you care about (e.g. WHERE salesperson = \'R. Patel\') — avoids writing any alert SQL at all.',
      defaultValue: defaultTableOptions.popupForAllRows,
      category: ['Alert rule'],
    })
    .addBooleanSwitch({
      path: 'popupOnFilteredRows',
      name: 'Popup on filtered rows',
      description:
        'No SQL, no variables: fires for any row that newly appears in this grid\'s own currently-filtered ' +
        'view — just type into the column floating filters (e.g. ticker "northco", side "sell") and enable ' +
        'this.',
      defaultValue: defaultTableOptions.popupOnFilteredRows,
      category: ['Alert rule'],
    })
    .addBooleanSwitch({
      path: 'useDesktopNotifications',
      name: 'Use desktop notifications',
      description:
        'Show OS-level desktop notifications for new qualifying RFQs instead of the in-panel popup ' +
        '(the browser will ask for notification permission the first time).',
      defaultValue: defaultTableOptions.useDesktopNotifications,
      category: ['Alert rule'],
    })
    .addBooleanSwitch({
      path: 'playSoundOnAlert',
      name: 'Play sound on alert',
      description: 'Plays a short tone alongside each new in-panel popup (desktop notifications already have their own OS sound).',
      defaultValue: defaultTableOptions.playSoundOnAlert,
      category: ['Alert rule'],
    })
    .addBooleanSwitch({
      path: 'enableAddRow',
      name: 'Enable "Add row"',
      description: 'Show a toolbar button to insert a new row, using the fields marked Editable in Overrides.',
      defaultValue: defaultTableOptions.enableAddRow,
      category: ['Editing'],
    })
    .addTextInput({
      path: 'addRowSql',
      name: 'Add row SQL',
      description:
        'SQL run when a new row is submitted. Use ${row.fieldName} for each editable field\'s entered ' +
        'value, e.g.: INSERT INTO rfqs (rfq_id, bond, salesperson, size) VALUES ' +
        '(${row.rfq_id}, ${row.bond}, ${row.salesperson}, ${row.size})',
      defaultValue: defaultTableOptions.addRowSql,
      category: ['Editing'],
      settings: { useTextarea: true, rows: 3 },
      showIf: (opts) => opts.enableAddRow,
    })
    .addBooleanSwitch({
      path: 'enableAlertQuery',
      name: 'Enable alert query',
      description:
        'A second, independent alert source: an arbitrary SQL query, re-run every time the panel refreshes. ' +
        'Every row it returns fires one popup. Unlike the other rules (which only see this table\'s own rows), ' +
        'this can express relative/cross-row conditions (e.g. a self-join checking bid on one exchange against ' +
        'ask on another) or conditions from a totally unrelated query (e.g. an aggregate risk view).',
      defaultValue: defaultTableOptions.enableAlertQuery,
      category: ['Alert query'],
    })
    .addTextInput({
      path: 'alertQuerySql',
      name: 'Alert query SQL',
      description:
        'Arbitrary SELECT. Dashboard variables ($my_var) are interpolated the same as in the main panel ' +
        'query. Example (cross-exchange arbitrage): SELECT a.rfq_id || \'-\' || b.rfq_id AS alert_id, ' +
        'a.exchange AS bid_exchange, a.bid, b.exchange AS ask_exchange, b.ask FROM quotes a JOIN quotes b ' +
        'ON a.bond = b.bond AND a.exchange != b.exchange WHERE a.bid > b.ask',
      defaultValue: defaultTableOptions.alertQuerySql,
      category: ['Alert query'],
      settings: { useTextarea: true, rows: 4 },
      showIf: (opts) => opts.enableAlertQuery,
    })
    .addTextInput({
      path: 'alertQueryIdField',
      name: 'Alert query id field',
      description: 'Column in the alert query\'s result that uniquely identifies an alert instance (for de-dup).',
      defaultValue: defaultTableOptions.alertQueryIdField,
      category: ['Alert query'],
      showIf: (opts) => opts.enableAlertQuery,
    });
  });
