/**
 * Safe CSV formatting (#1332).
 *
 * Two separate hazards, both handled here:
 *
 * 1. RFC 4180 escaping — a value containing a comma, double quote, or
 *    newline must be quoted, with embedded quotes doubled. Skipping this
 *    corrupts the CSV structure (a comma in a value silently creates an
 *    extra column).
 *
 * 2. CSV / formula injection — when a cell's content starts with `=`, `+`,
 *    `-`, `@`, a tab, or a carriage return, Excel, Google Sheets, and
 *    LibreOffice Calc treat it as a formula on open, not as text. A stored
 *    value an attacker can influence (a token symbol, a memo, an alias)
 *    could otherwise execute `=IMPORTXML(...)`/DDE payloads on whichever
 *    machine opens the export. The standard mitigation (OWASP CSV
 *    Injection guidance) is to prefix such a value with a leading `'`
 *    before quoting, which spreadsheet applications render as plain text.
 */

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const NEEDS_QUOTING = /[",\n\r]/;

/** Formats one value as a single, injection-safe CSV cell. */
export function toSafeCsvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);

  const neutralized = FORMULA_TRIGGER.test(raw) ? `'${raw}` : raw;

  if (NEEDS_QUOTING.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

/** Formats a full row (array of cells) as one CSV line, CRLF-terminated per RFC 4180. */
export function toCsvRow(values: Array<string | number | null | undefined>): string {
  return values.map(toSafeCsvCell).join(",") + "\r\n";
}
