/**
 * Neutralize spreadsheet formula injection (a.k.a. CSV injection). When a file is
 * opened in Excel / Google Sheets / LibreOffice, a cell whose first character is
 * one of `= + @ -` or a leading TAB/CR is interpreted as a FORMULA — so
 * user-controlled text (tenant names, descriptions, references) could execute on
 * the operator's machine (data exfil via `=HYPERLINK`/`=WEBSERVICE`, or legacy
 * `=cmd|…` DDE). Prefixing a single apostrophe forces the cell to plain text and
 * is stripped on display.
 *
 * A plain negative number ("-50.00") is a legitimate value, not a formula, so it
 * is exempt (otherwise every credit/negative balance would gain a stray quote).
 *
 * PURE — no I/O, unit-tested. Shared by EVERY spreadsheet export so the rule is
 * identical everywhere: the CSV serializer (`lib/services/reports` `toCsv`, used
 * by both report and audit-log CSV) and the .xlsx renderer
 * (`lib/services/report-render` `renderReportXlsx`).
 */
export function neutralizeSpreadsheetValue(value: string): string {
  // Dangerous leading characters per OWASP CSV-injection guidance, incl. the
  // TAB (0x09) / CR (0x0D) lead-ins some importers treat as formula starts.
  if (/^[=+@\t\r]/.test(value)) return `'${value}`;
  // A leading "-" is dangerous UNLESS the whole cell is a plain negative number.
  if (/^-/.test(value) && !/^-\d+(\.\d+)?$/.test(value)) return `'${value}`;
  return value;
}
