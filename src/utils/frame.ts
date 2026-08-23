import { DataFrame } from '@grafana/data';

// Expands a Grafana DataFrame (columnar: fields[].values) into row objects
// (record-per-row) — used both for the main table and for alert-query results.
export function frameToRecords(frame: DataFrame): Array<Record<string, any>> {
  const records: Array<Record<string, any>> = [];
  for (let i = 0; i < frame.length; i++) {
    const record: Record<string, any> = {};
    frame.fields.forEach((field) => {
      record[field.name] = field.values[i];
    });
    records.push(record);
  }
  return records;
}
