function sqlLiteral(value: any): string {
  if (value === null || value === undefined || value === '') {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Renders an "Update SQL" / "Add row SQL" template. Supports ${value} (the
// new cell value, update templates only) and ${row.<fieldName>} (any other
// field's value for that row) — values are literal-quoted/escaped by type.
export function renderSqlTemplate(template: string, row: Record<string, any>, newValue?: any): string {
  return template.replace(/\$\{(value|row\.[a-zA-Z0-9_]+)\}/g, (_match, token: string) => {
    if (token === 'value') {
      return sqlLiteral(newValue);
    }
    const fieldName = token.slice('row.'.length);
    return sqlLiteral(row[fieldName]);
  });
}
