/**
 * exportCsv — generate and trigger a browser CSV download.
 *
 * Accepts an array of records and a list of column definitions.  Each column
 * definition maps a header label to a getter function that extracts the value
 * from a record.  Values are automatically quoted and escaped so that commas,
 * double-quotes, and newlines inside values do not break the CSV.
 */

export interface CsvColumn<T> {
  /** Column header text written on the first row. */
  header: string;
  /** Extract the string value for this column from a record. */
  value: (row: T) => string;
}

/**
 * Wrap a cell value in double-quotes and escape any embedded double-quotes
 * per RFC 4180.
 */
function escapeCell(raw: string): string {
  // If the value contains a comma, double-quote, or newline, wrap in quotes
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/**
 * Convert an array of records to a CSV string.
 *
 * @param rows      The data rows to export.
 * @param columns   Column definitions (header + value getter).
 * @returns         A UTF-8 CSV string with a BOM prefix so Excel opens it
 *                  correctly without mis-encoding non-ASCII characters.
 */
export function toCsvString<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((col) => escapeCell(col.header)).join(',');
  const body = rows
    .map((row) => columns.map((col) => escapeCell(col.value(row))).join(','))
    .join('\n');
  // BOM (\uFEFF) ensures Excel detects UTF-8 encoding on Windows
  return `\uFEFF${header}\n${body}`;
}

/**
 * Trigger a browser file-download for a CSV string.
 *
 * @param csv       The CSV string to download.
 * @param filename  The suggested file name (e.g. "loans-2025-09-26.csv").
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Build a date-stamped filename for the CSV export.
 *
 * @param prefix  A short prefix, e.g. "loans".
 * @returns       e.g. "loans-2025-09-26.csv"
 */
export function csvFilename(prefix: string): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${prefix}-${today}.csv`;
}
