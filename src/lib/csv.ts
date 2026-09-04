/**
 * A small RFC 4180 CSV parser.
 *
 * Splitting on commas is not sufficient for real Google Sheets exports: player notes
 * contain commas, score summaries are literally comma-separated ("6-4, 7-5"), and any
 * cell may contain quotes or embedded newlines. This parser handles quoted fields,
 * doubled quotes as escapes, embedded newlines, and CRLF / LF / CR line endings.
 */

export type CsvRow = string[];

export function parseCsv(input: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let row: CsvRow = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  // Strip a UTF-8 BOM, which Google Sheets includes on some export endpoints.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const endField = () => {
    // Unquoted fields get trimmed; quoted fields keep their exact contents, since a
    // coach may deliberately pad a name or note.
    row.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };

  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      fieldWasQuoted = true;
      continue;
    }
    if (ch === ',') {
      endField();
      continue;
    }
    if (ch === '\r') {
      // Treat CRLF and a bare CR as one line ending.
      if (text[i + 1] === '\n') i++;
      endRow();
      continue;
    }
    if (ch === '\n') {
      endRow();
      continue;
    }
    field += ch;
  }

  // Flush the trailing field/row unless the file ended exactly on a line break.
  if (field !== '' || fieldWasQuoted || row.length > 0) endRow();

  // Drop rows that are entirely empty - trailing blank lines are extremely common in
  // sheets where a coach has cleared cells rather than deleting rows.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** A CSV parsed into a header row plus objects keyed by (normalized) header name. */
export interface CsvTable {
  headers: string[];
  /** Header names lowercased and stripped of punctuation, for tolerant matching. */
  normalizedHeaders: string[];
  rows: CsvRow[];
  /** 1-based sheet row number for `rows[i]`, accounting for the header row. */
  sheetRowFor(index: number): number;
}

export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toTable(rows: CsvRow[]): CsvTable {
  const headers = (rows[0] ?? []).map((h) => h.trim());
  const body = rows.slice(1);
  return {
    headers,
    normalizedHeaders: headers.map(normalizeHeader),
    rows: body,
    sheetRowFor: (index: number) => index + 2, // +1 for the header, +1 for 1-based rows
  };
}
