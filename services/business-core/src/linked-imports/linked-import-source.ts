import { createHash } from "node:crypto";
import { Dec } from "../catalog-core/decimal";

/**
 * A spreadsheet as read: each tab's cells as text, the way the sheet shows them. `links` holds the cell
 * hyperlinks ("row:column", 0-based, http(s) only); `titles` the category title above each heading row (by
 * the heading row's index) when the browser trimmed the file and so worked them out itself; `hidden` a tab
 * the sheet hides.
 */
export type SourceSheet = { name: string; rows: string[][]; links?: Record<string, string>; titles?: Record<string, string>; hidden?: boolean };
export type ImportTarget = "stock" | "catalog" | "suppliers";

/** The Wodana fields a column can fill; "attribute" keeps the column as an attribute (of the catalog item, or the supplier) named by its heading. */
export const TARGET_FIELDS = {
  stock: ["code", "name", "category", "unit", "quantity", "usedQuantity", "size", "colour", "location", "cost"],
  catalog: ["code", "name", "category", "unit", "type", "description", "cost", "price", "productionDays", "technicalDrawing", "height", "width", "depth", "attribute"],
  suppliers: ["code", "name", "legalName", "contactName", "phone", "contact", "email", "address", "taxNumber", "paymentTerms", "categories", "approval", "notes", "attribute"],
} as const satisfies Record<ImportTarget, readonly string[]>;
export type ImportField = (typeof TARGET_FIELDS)[ImportTarget][number];
type ValueField = Exclude<ImportField, "attribute">;

/**
 * Configuration: each column heading (as written) and the field it fills; unmapped columns are ignored. A field
 * may be filled from several headings (tabs that spell it differently); in one row the first filled one wins.
 * `tabs` limits the import to the tabs chosen; suppliers: `entities` names the company each tab's suppliers sell
 * to, and `fillOnly` only fills what a known supplier is missing.
 */
export type ColumnMapping = { columns: Record<string, string>; tabs?: string[]; entities?: Record<string, string>; fillOnly?: boolean };

export type SourceRow = {
  sheet: string; line: number; key: string;
  values: Partial<Record<ValueField, string>>;
  /** Columns kept as attributes, by their heading. */
  attributes: Record<string, string>;
  /** A field's cell link, when the cell has one. */
  links?: Partial<Record<ValueField, string>>;
  /** The heading each field was read from. */
  headings?: Partial<Record<ValueField, string>>;
};

export const LIMITS = { sheets: 50, rowsPerSheet: 5000, rows: 10000, columns: 100, cell: 2000, links: 5000 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const URL_TEXT = /^https?:\/\/\S+$/i;
/** An http(s) link as a cell holds it, or null. */
export const linkOf = (text: unknown) => (typeof text === "string" && text.trim().length <= LIMITS.cell && URL_TEXT.test(text.trim()) ? text.trim() : null);

export class SourceError extends Error {}

export const headingKey = (text: string) => text.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
const clean = (text: unknown) => (text === null || text === undefined ? "" : String(text)).replace(/\s+/g, " ").trim();

/** The field rows are matched by first: the code when a column holds it, else the name. */
export function keyField(_target: ImportTarget, mapping: ColumnMapping): "code" | "name" {
  return Object.values(mapping.columns).includes("code") ? "code" : "name";
}

/** Checks a mapping against its target: known fields, a code or name column, and the chosen tabs and companies. */
export function checkMapping(target: ImportTarget, mapping: unknown): ColumnMapping {
  const raw = mapping as ColumnMapping | null;
  const columns = raw?.columns;
  if (!columns || typeof columns !== "object" || Array.isArray(columns)) throw new SourceError("Map the sheet's columns first.");
  const fields: readonly string[] = TARGET_FIELDS[target];
  const result: Record<string, string> = {};
  const used = new Set<string>();
  for (const [heading, field] of Object.entries(columns)) {
    const text = clean(heading);
    if (!text || text.length > 200) throw new SourceError("A column heading is empty or too long.");
    if (field === "" || field === null || field === undefined) continue;
    if (typeof field !== "string" || !fields.includes(field)) throw new SourceError(`"${text}" maps to a field Wodana doesn't know.`);
    used.add(field);
    result[text] = field;
  }
  if (Object.keys(result).length > LIMITS.columns) throw new SourceError(`Map at most ${LIMITS.columns} columns.`);
  if (!used.has("code") && !used.has("name")) throw new SourceError(target === "suppliers" ? "Choose the column with the supplier's code or name: rows are matched by it."
    : "Choose the column with the item code or name: rows are matched by it.");
  const checked: ColumnMapping = { columns: result };
  if (raw!.tabs !== undefined && raw!.tabs !== null) {
    if (!Array.isArray(raw!.tabs) || raw!.tabs.length > LIMITS.sheets || raw!.tabs.some((tab) => typeof tab !== "string" || !clean(tab) || clean(tab).length > 200))
      throw new SourceError("Choose the tabs to import.");
    checked.tabs = [...new Set(raw!.tabs.map(clean))];
    if (!checked.tabs.length) throw new SourceError("Choose the tabs to import.");
  }
  if (target === "suppliers" && raw!.entities !== undefined && raw!.entities !== null) {
    const entries = typeof raw!.entities === "object" && !Array.isArray(raw!.entities) ? Object.entries(raw!.entities) : null;
    if (!entries || entries.length > LIMITS.sheets || entries.some(([tab, id]) => !clean(tab) || clean(tab).length > 200 || typeof id !== "string" || !UUID.test(id)))
      throw new SourceError("Choose one of your companies for each tab.");
    if (entries.length) checked.entities = Object.fromEntries(entries.map(([tab, id]) => [clean(tab), id]));
  }
  if (target === "suppliers" && raw!.fillOnly === true) checked.fillOnly = true;
  return checked;
}

/** Bounds and tidies a source as received (a file the browser read, or a linked sheet). */
export function checkSheets(value: unknown): SourceSheet[] {
  if (!Array.isArray(value) || !value.length) throw new SourceError("The file has no sheets to import.");
  if (value.length > LIMITS.sheets) throw new SourceError(`Use at most ${LIMITS.sheets} tabs.`);
  let total = 0;
  return value.map((sheet) => {
    const source = sheet as SourceSheet;
    const name = clean(source?.name).slice(0, 200);
    const rows = source?.rows;
    if (!Array.isArray(rows)) throw new SourceError("A tab could not be read.");
    if (rows.length > LIMITS.rowsPerSheet) throw new SourceError(`${name}: use at most ${LIMITS.rowsPerSheet} rows a tab.`);
    total += rows.length;
    if (total > LIMITS.rows) throw new SourceError(`Use at most ${LIMITS.rows} rows in all.`);
    const checked: SourceSheet = { name, rows: rows.map((row) => (Array.isArray(row) ? row.slice(0, 200).map((cell) => clean(cell).slice(0, LIMITS.cell)) : [])) };
    // Links and titles are optional: what isn't one is dropped, never an error.
    const links = cellMap(source.links, (cell) => linkOf(cell), /^\d{1,5}:\d{1,3}$/);
    if (links) checked.links = links;
    // Titles the browser worked out (even none) replace the reading of title rows.
    if (source.titles && typeof source.titles === "object" && !Array.isArray(source.titles))
      checked.titles = cellMap(source.titles, (cell) => clean(cell).slice(0, 200) || null, /^\d{1,5}$/) ?? {};
    if (source.hidden === true) checked.hidden = true;
    return checked;
  });
}

function cellMap(value: unknown, read: (cell: unknown) => string | null, key: RegExp) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kept: Record<string, string> = {};
  let count = 0;
  for (const [at, cell] of Object.entries(value)) {
    if (count >= LIMITS.links) break;
    const text = key.test(at) ? read(cell) : null;
    if (text) { kept[at] = text; count += 1; }
  }
  return count ? kept : null;
}

const filled = (row: string[]) => row.reduce((count, cell) => count + (cell.trim() ? 1 : 0), 0);

/**
 * A tab's heading rows (a row naming the code or name column and, when more than one column is mapped, at least
 * two mapped columns: a heading repeated lower down starts a new block) and the title of each block: the one
 * filled cell of the nearest row above its heading row ("SOFA"), unless the browser worked them out already.
 */
export function sheetBlocks(sheet: SourceSheet, mapping: ColumnMapping) {
  const byHeading = new Map(Object.entries(mapping.columns).map(([heading, field]) => [headingKey(heading), field]));
  const needed = Math.min(2, byHeading.size);
  const headers: number[] = [];
  sheet.rows.forEach((row, index) => {
    const matched = new Set<string>();
    let key = false;
    for (const cell of row) {
      const field = byHeading.get(headingKey(cell));
      if (!field) continue;
      matched.add(headingKey(cell));
      if (field === "code" || field === "name") key = true;
    }
    if (key && matched.size >= needed) headers.push(index);
  });
  const titles = new Map<number, string>();
  const titleRows = new Set<number>();
  if (sheet.titles) {
    for (const [at, title] of Object.entries(sheet.titles)) if (headers.includes(Number(at))) titles.set(Number(at), title);
  } else {
    for (const header of headers) {
      let above = header - 1;
      while (above >= 0 && !filled(sheet.rows[above])) above -= 1;
      if (above < 0 || headers.includes(above) || filled(sheet.rows[above]) !== 1) continue;
      titles.set(header, sheet.rows[above].find((cell) => cell.trim())!.trim().slice(0, 200));
      titleRows.add(above);
    }
  }
  return { headers, titles, titleRows, byHeading };
}

/**
 * The rows of every chosen tab that has a heading row, read through the mapping (see sheetBlocks). Blank rows,
 * title rows and notes or sub-headings (one filled mapped cell, outside the code and name columns) are skipped.
 * A catalog or stock row's category is the mapped column's; without one, its block's title (a stock list's only
 * when the tab has several blocks), or (several tabs) the tab's name. Rows match by their code; a row without one by its name: a catalog row's name within its category (with
 * its size, when two rows share both), a stock row's name with its size and colour.
 */
export function readRows(target: ImportTarget, sheets: SourceSheet[], mapping: ColumnMapping): { rows: SourceRow[]; skippedTabs: string[] } {
  const chosen = mapping.tabs ? sheets.filter((sheet) => mapping.tabs!.includes(sheet.name)) : sheets;
  const mappedFields = new Set(Object.values(mapping.columns));
  const categoryMapped = mappedFields.has("category");
  const rows: SourceRow[] = [];
  const skippedTabs: string[] = [];
  for (const sheet of chosen) {
    const { headers, titles, titleRows, byHeading } = sheetBlocks(sheet, mapping);
    if (!headers.length) { if (sheet.rows.some((row) => row.some(Boolean))) skippedTabs.push(sheet.name); continue; }
    headers.forEach((header, block) => {
      const end = headers[block + 1] ?? sheet.rows.length;
      const columns = sheet.rows[header].map((cell, column) => ({ column, heading: cell.trim(), field: byHeading.get(headingKey(cell)) }))
        .filter((entry): entry is { column: number; heading: string; field: string } => Boolean(entry.field));
      const keyColumns = new Set(columns.filter((entry) => entry.field === "code" || entry.field === "name").map((entry) => entry.column));
      const title = titles.get(header) ?? "";
      for (let index = header + 1; index < end; index++) {
        if (titleRows.has(index)) continue;
        const cells = sheet.rows[index];
        const filledColumns = columns.filter((entry) => (cells[entry.column] ?? "").trim());
        if (!filledColumns.length) continue;
        // A note or a sub-heading ("Need to be added…", "MARBLE"): one filled cell outside the code and name.
        if (filledColumns.length === 1 && !keyColumns.has(filledColumns[0].column)) continue;
        const row: SourceRow = { sheet: sheet.name, line: index + 1, key: "", values: {}, attributes: {}, links: {}, headings: {} };
        for (const { column, heading, field } of columns) {
          const value = cells[column] ?? "";
          if (field === "attribute") { if (value && row.attributes[heading] === undefined) row.attributes[heading] = value; continue; }
          const name = field as ValueField;
          if (row.values[name] === undefined || (!row.values[name] && value)) { row.values[name] = value; row.headings![name] = heading; }
          const link = sheet.links?.[`${index}:${column}`];
          if (link && !row.links![name]) row.links![name] = link;
        }
        if ((target === "catalog" || target === "stock") && !categoryMapped) {
          // A stock list's one title is the sheet's own ("Materials stock list"), not a category.
          const category = (target === "catalog" || headers.length > 1 ? title : "") || (chosen.length > 1 ? sheet.name : "");
          if (category) row.values.category = category;
        }
        if (!Object.keys(row.links!).length) delete row.links;
        rows.push(row);
      }
    });
  }
  // The key: the code, else the name (a supplier list without codes keeps the name as written).
  const byName = (row: SourceRow) => target === "catalog" ? [row.values.category, row.values.name].map((part) => (part ?? "").trim()).filter(Boolean).join(" / ")
    : target === "stock" ? [row.values.name, row.values.size, row.values.colour].map((part) => (part ?? "").trim()).filter(Boolean).join(" · ")
    : (row.values.name ?? "");
  for (const row of rows) {
    const code = (row.values.code ?? "").trim();
    row.key = target === "suppliers" ? (mappedFields.has("code") ? row.values.code ?? "" : row.values.name ?? "")
      : code || ((row.values.name ?? "").trim() ? byName(row) : "");
  }
  if (target === "catalog") {
    // Two rows of one name in one category are told apart by their size.
    const count = new Map<string, number>();
    for (const row of rows) if (!(row.values.code ?? "").trim() && row.key) count.set(row.key.toLocaleLowerCase(), (count.get(row.key.toLocaleLowerCase()) ?? 0) + 1);
    for (const row of rows) {
      if ((row.values.code ?? "").trim() || (count.get(row.key.toLocaleLowerCase()) ?? 0) < 2) continue;
      const size = [row.values.width, row.values.depth, row.values.height].map((part) => (part ?? "").trim()).filter(Boolean).join(" × ");
      if (size) row.key = `${row.key} · ${size}`;
    }
  }
  return { rows, skippedTabs };
}

/** A fingerprint of what an import reads: the mapped cells, so a re-run of the same data can be recognised. */
export function fingerprint(target: ImportTarget, mapping: ColumnMapping, rows: SourceRow[], settings: Record<string, unknown> = {}) {
  const hash = createHash("sha256");
  // Stored mappings come back with their keys reordered: compare them in one order.
  hash.update(JSON.stringify({ target, columns: Object.entries(mapping.columns).sort(([a], [b]) => a.localeCompare(b)), settings: Object.entries(settings).sort(([a], [b]) => a.localeCompare(b)),
    tabs: mapping.tabs ?? null, entities: Object.entries(mapping.entities ?? {}).sort(([a], [b]) => a.localeCompare(b)), fillOnly: mapping.fillOnly ?? false }));
  for (const row of rows) hash.update(JSON.stringify([row.sheet, row.line, row.key, row.values, row.attributes, row.links ?? {}]));
  return hash.digest("hex");
}

/**
 * A number as a sheet writes it: thousands separators, spaces, a currency code or symbol around it, or
 * a percent sign are dropped. Empty is null. Anything else that isn't a plain decimal is refused.
 */
export function sheetNumber(text: string | undefined, label: string, options: { places: number; whole?: boolean; max?: string } = { places: 4 }): string | null {
  const raw = clean(text);
  if (!raw || raw === "-" || raw === "—") return null;
  let stripped = raw.replace(/^[^\d.,+-]+|[^\d.,]+$/g, "").replace(/[\s  ']/g, "");
  // A comma after the last point is the decimal mark ("1.234,5", "12,5"), unless it groups thousands ("1,234").
  const comma = stripped.lastIndexOf(","), point = stripped.lastIndexOf(".");
  stripped = comma > point && (point >= 0 || stripped.length - comma - 1 !== 3) ? stripped.replace(/\./g, "").replace(",", ".") : stripped.replace(/,/g, "");
  if (!/^[+]?\d+(\.\d+)?$/.test(stripped)) {
    if (/^-/.test(stripped)) throw new SourceError(`${label} can't be below zero (${raw}).`);
    throw new SourceError(`${label} isn't a number (${raw}).`);
  }
  const value = Dec.of(stripped.replace(/^\+/, ""));
  if (options.whole && value.cmp(value.floor(0)) !== 0) throw new SourceError(`${label} is whole days (${raw}).`);
  if (options.max && value.cmp(options.max) > 0) throw new SourceError(`${label} is too large (${raw}).`);
  return value.round(options.places).toString();
}

export const sameNumber = (a: string | null | undefined, b: string | null | undefined) =>
  (a === null || a === undefined || a === "") ? (b === null || b === undefined || b === "") : (b !== null && b !== undefined && b !== "" && Dec.of(a).cmp(b) === 0);

/** One row of the plan: what applying would do to it and why. */
export type PlanOutcome = "added" | "changed" | "unchanged" | "error";
export type PlannedRow = {
  sheet: string; line: number; key: string; name: string; outcome: PlanOutcome;
  /** What changes, in words ("On hand 10 → 12"). */
  changes: string[];
  message: string;
};
