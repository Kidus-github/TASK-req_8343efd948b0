// Minimal UTF-8 CSV reader/writer. Sufficient for cohort bulk import/export
// and report export. Does not support multi-line quoted cells with embedded
// newlines beyond RFC 4180 single-pass parsing.

export function stringifyCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = columns.map(csvCell).join(',');
  const body = rows
    .map((row) => columns.map((c) => csvCell(row[c])).join(','))
    .join('\n');
  return body ? `${header}\n${body}\n` : `${header}\n`;
}

export function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(text: string): CsvParseResult {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = splitCsvLines(normalized);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvRow(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    const cells = parseCsvRow(line);
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = cells[c] ?? '';
    }
    rows.push(row);
  }
  return { headers, rows };
}

function splitCsvLines(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      buf += ch;
    } else if (ch === '\n' && !inQuotes) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  cells.push(cur);
  return cells;
}
