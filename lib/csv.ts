function cell(value: unknown) {
  const raw = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const safe = /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  return [
    columns.map(cell).join(','),
    ...rows.map(row => columns.map(column => cell(row[column])).join(','))
  ].join('\r\n');
}
