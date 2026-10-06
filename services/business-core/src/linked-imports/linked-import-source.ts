import { createHash } from "node:crypto";
import { Dec } from "../catalog-core/decimal";

/** A spreadsheet as read: each tab's cells as text, the way the sheet shows them. */
export type SourceSheet = { name: string; rows: string[][] };
export type ImportTarget = "stock" | "catalog" | "suppliers";

/** The Wodana fields a column can fill; "attribute" keeps the column as an attribute (of the catalog item, or the supplier) named by its heading. */
export const TARGET_FIELDS = {
  stock: ["code", "name", "unit", "quantity", "location", "cost"],
  catalog: ["code", "name", "category", "unit", "type", "description", "cost", "price", "productionDays", "attribute"],
  suppliers: ["code", "name", "legalName", "contactName", "phone", "email", "address", "taxNumber", "paymentTerms", "categories", "notes", "attribute"],
} as const satisfies Record<ImportTarget, readonly string[]>;
export type ImportField = (typeof TARGET_FIELDS)[ImportTarget][number];

/** Configuration: each column heading (as written) and the field it fills. Unmapped columns are ignored. */
export type ColumnMapping = { columns: Record<string, string> };

export type SourceRow = {
  sheet: string; line: number; key: string;
  values: Partial<Record<Exclude<ImportField, "attribute">, string>>;
  /** Columns kept as attributes, by their heading. */
  attributes: Record<string, string>;
};

export const LIMITS = { sheets: 50, rowsPerSheet: 5000, rows: 10000, columns: 100, cell: 2000 };

export class SourceError extends Error {}

export const headingKey = (text: string) => text.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
const clean = (text: unknown) => (text === null || text === undefined ? "" : String(text)).replace(/\s+/g, " ").trim();

/** The field rows are matched by: the code, or (a supplier list without codes) the name. */
export function keyField(target: ImportTarget, mapping: ColumnMapping): "code" | "name" {
  const fields = Object.values(mapping.columns);
  return target === "suppliers" && !fields.includes("code") ? "name" : "code";
}

/** Checks a mapping against its target: known fields, one column per field (attributes aside) and a key column. */
export function checkMapping(target: ImportTarget, mapping: unknown): ColumnMapping {
  const columns = (mapping as ColumnMapping | null)?.columns;
  if (!columns || typeof columns !== "object" || Array.isArray(columns)) throw new SourceError("Map the sheet's columns first.");
  const fields: readonly string[] = TARGET_FIELDS[target];
  const result: Record<string, string> = {};
  const used = new Set<string>();
  for (const [heading, field] of Object.entries(columns)) {
    const text = clean(heading);
    if (!text || text.length > 200) throw new SourceError("A column heading is empty or too long.");
    if (field === "" || field === null || field === undefined) continue;
    if (typeof field !== "string" || !fields.includes(field)) throw new SourceError(`"${text}" maps to a field Wodana doesn't know.`);
    if (field !== "attribute" && used.has(field)) throw new SourceError("Map each field from one column only.");
    used.add(field);
    result[text] = field;
  }
  if (Object.keys(result).length > LIMITS.columns) throw new SourceError(`Map at most ${LIMITS.columns} columns.`);
  if (target === "suppliers" && !used.has("code") && !used.has("name")) throw new SourceError("Choose the column with the supplier's code or name: rows are matched by it.");
  if (target !== "suppliers" && !used.has("code")) throw new SourceError("Choose the column with the item code: rows are matched by it.");
  return { columns: result };
}

/** Bounds and tidies a source as received (a file the browser read, or a linked sheet). */
export function checkSheets(value: unknown): SourceSheet[] {
  if (!Array.isArray(value) || !value.length) throw new SourceError("The file has no sheets to import.");
  if (value.length > LIMITS.sheets) throw new SourceError(`Use at most ${LIMITS.sheets} tabs.`);
  let total = 0;
  return value.map((sheet) => {
    const name = clean((sheet as SourceSheet)?.name).slice(0, 200);
    const rows = (sheet as SourceSheet)?.rows;
    if (!Array.isArray(rows)) throw new SourceError("A tab could not be read.");
    if (rows.length > LIMITS.rowsPerSheet) throw new SourceError(`${name}: use at most ${LIMITS.rowsPerSheet} rows a tab.`);
    total += rows.length;
    if (total > LIMITS.rows) throw new SourceError(`Use at most ${LIMITS.rows} rows in all.`);
    return { name, rows: rows.map((row) => (Array.isArray(row) ? row.slice(0, 200).map((cell) => clean(cell).slice(0, LIMITS.cell)) : [])) };
  });
}

/**
 * The rows of every tab that has the key column, read through the mapping. The heading row is the first of
 * a tab's top 20 rows that names the key column; blank rows are skipped. When the category isn't mapped and
 * the source has several tabs, each tab's name is its rows' category.
 */
export function readRows(target: ImportTarget, sheets: SourceSheet[], mapping: ColumnMapping): { rows: SourceRow[]; skippedTabs: string[] } {
  const byHeading = new Map(Object.entries(mapping.columns).map(([heading, field]) => [headingKey(heading), field]));
  const key = keyField(target, mapping);
  const keyHeading = [...byHeading.entries()].find(([, field]) => field === key)![0];
  const tabCategory = target === "catalog" && sheets.length > 1 && ![...byHeading.values()].includes("category");
  const rows: SourceRow[] = [];
  const skippedTabs: string[] = [];
  for (const sheet of sheets) {
    const headerIndex = sheet.rows.slice(0, 20).findIndex((row) => row.some((cell) => headingKey(cell) === keyHeading));
    if (headerIndex < 0) { if (sheet.rows.some((row) => row.some(Boolean))) skippedTabs.push(sheet.name); continue; }
    const headings = sheet.rows[headerIndex].map((cell) => cell.trim());
    for (let index = headerIndex + 1; index < sheet.rows.length; index++) {
      const cells = sheet.rows[index];
      if (!cells.some(Boolean)) continue;
      const row: SourceRow = { sheet: sheet.name, line: index + 1, key: "", values: {}, attributes: {} };
      headings.forEach((heading, column) => {
        const field = byHeading.get(headingKey(heading));
        const value = cells[column] ?? "";
        if (!field) return;
        if (field === "attribute") { if (value) row.attributes[heading] = value; }
        else row.values[field as keyof SourceRow["values"]] = value;
      });
      if (tabCategory && !row.values.category) row.values.category = sheet.name;
      row.key = row.values[key] ?? "";
      rows.push(row);
    }
  }
  return { rows, skippedTabs };
}

/** A fingerprint of what an import reads: the mapped cells, so a re-run of the same data can be recognised. */
export function fingerprint(target: ImportTarget, mapping: ColumnMapping, rows: SourceRow[], settings: Record<string, unknown> = {}) {
  const hash = createHash("sha256");
  // Stored mappings come back with their keys reordered: compare them in one order.
  hash.update(JSON.stringify({ target, columns: Object.entries(mapping.columns).sort(([a], [b]) => a.localeCompare(b)), settings: Object.entries(settings).sort(([a], [b]) => a.localeCompare(b)) }));
  for (const row of rows) hash.update(JSON.stringify([row.sheet, row.line, row.values, row.attributes]));
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
