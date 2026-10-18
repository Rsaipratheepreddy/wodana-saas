import { tKey } from "@/lib/i18n/keys";

export type CsvTable = { headers: string[]; rows: string[][] };

/** Errors are i18n keys: show them with `translateKnown`. */
export function parseLeadCsv(text: string): CsvTable {
  const cells: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !field) quoted = true;
    else if (char === ',') { row.push(field.trim()); field = ""; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      row.push(field.trim()); field = "";
      if (row.some(value => value)) cells.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error(tKey("The CSV has an unclosed quoted field."));
  row.push(field.trim());
  if (row.some(value => value)) cells.push(row);
  const [headers = [], ...rows] = cells;
  if (!headers.length || headers.some(header => !header)) throw new Error(tKey("The CSV needs a header for every column."));
  if (new Set(headers.map(header => header.toLocaleLowerCase())).size !== headers.length) throw new Error(tKey("CSV column names must be unique."));
  if (!rows.length) throw new Error(tKey("The CSV has no enquiry rows."));
  if (rows.length > 5000) throw new Error(tKey("Import up to 5,000 enquiries at a time."));
  if (rows.some(values => values.length !== headers.length)) throw new Error(tKey("Every CSV row must have the same number of columns as the header."));
  return { headers, rows };
}

export function matchCsvHeader(headers: string[], names: string[]) {
  const canonical = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  return headers.find(header => names.some(name => canonical(name) === canonical(header))) ?? "";
}
