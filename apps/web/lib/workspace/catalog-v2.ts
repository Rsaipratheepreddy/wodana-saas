export type CatalogSummary = { id: string; code: string; name: string; purpose: "sell" | "buy" | "reference"; itemCount: number; version: number };
export type CatalogCategory = { id: string; parentId: string | null; code: string; name: string };
export type CatalogAttribute = { id: string; code: string; label: string; valueType: string; required: boolean; choices: Array<{ value: string; label: string }>; unitCode: string | null; categoryId: string | null };
export type CatalogUnit = { code: string; label: string; kind: string };
export type CatalogStructure = { categories: CatalogCategory[]; attributes: CatalogAttribute[]; units: CatalogUnit[] };
export type CatalogItemRow = {
  id: string; code: string; name: string; itemType: string; unitCode: string; status: string; version: number;
  categoryId: string | null; categoryName: string | null; values: Record<string, string>;
  sellPrice: { method: string; price: string | null; rate: string | null; currency: string; status: string } | null;
};
export type ImportRow = { line: number; sheet?: string; category?: string; code?: string; name?: string; unit?: string; supplier?: string; cost?: string; attributes?: Record<string, string> };
export type ImportPlan = {
  rows: Array<{ line: number; sheet?: string; action: "create" | "update" | "skip" | "error"; code: string; name: string; category: string | null; unit: string; messages: string[] }>;
  summary: { create: number; update: number; skip: number; error: number; newUnits: string[]; newCategories: string[]; newAttributes: string[] };
};

/** A refused catalog request, with its HTTP status (409: someone else changed the item first). */
export class CatalogRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "CatalogRequestError"; }
}

export async function catalogApi<T>(workspaceId: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const url = `/api/workspace/catalogs/${path}${path.includes("?") ? "&" : "?"}workspaceId=${workspaceId}`;
  const response = await fetch(url, init?.body === undefined ? { method: init?.method ?? "GET" } : {
    method: init?.method ?? "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(init.body),
  });
  const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
  if (!response.ok) throw new CatalogRequestError(Array.isArray(payload?.message) ? payload.message.join(". ") : payload?.message ?? "Something went wrong. Try again.", response.status);
  return payload as T;
}

/** Recognized spreadsheet headers → import fields (any language-neutral spelling of the usual names). */
const HEADER_FIELDS: Array<[RegExp, keyof ImportRow | "attr:Size" | "attr:Colour"]> = [
  [/^(item\s*)?name$|^item$|^description$|^product$/i, "name"],
  [/^(model|moral|item|product|sku|part)?\s*(code|no\.?|number|sku)$/i, "code"],
  [/^units?$|^uom$/i, "unit"],
  [/^suppliers?$|^vendors?$/i, "supplier"],
  [/^(unit\s*)?(price|cost|rate)$/i, "cost"],
  [/^colou?r$|^finish$/i, "attr:Colour"],
  [/^(dimensions?|size)(\s*&\s*size)?$|^dimensions? & size$/i, "attr:Size"],
  [/^category$|^group$/i, "category"],
];

export type SheetMapping = { sheet: string; headerRow: number; columns: Record<number, string>; category: string };

/** Finds the header row (the first row with a name-like column) and maps columns. */
export function detectMapping(sheet: { name: string; rows: string[][] }): SheetMapping | null {
  for (let index = 0; index < Math.min(sheet.rows.length, 15); index += 1) {
    const row = sheet.rows[index].map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim());
    const columns: Record<number, string> = {};
    row.forEach((cell, column) => {
      if (/^serial|^s\.?\s*no|^#$|qty|quantity|used|received|total/i.test(cell)) return;
      const match = HEADER_FIELDS.find(([pattern]) => pattern.test(cell));
      if (match && !Object.values(columns).includes(match[1])) columns[column] = match[1];
    });
    if (Object.values(columns).includes("name")) return { sheet: sheet.name, headerRow: index, columns, category: tidyName(sheet.name) };
  }
  return null;
}

/** "SOCKET & SWITCHES MATERIALS INV" → "Socket & Switches" */
export function tidyName(sheetName: string) {
  const words = sheetName.replace(/\b(materials?|inventory|invent|inv|list|sheet)\b/gi, " ").replace(/\s+/g, " ").trim();
  return (words || sheetName).toLowerCase().replace(/(^|[\s&/-])(\p{L})/gu, (_all, lead: string, letter: string) => lead + letter.toUpperCase());
}

export function rowsFromSheet(sheet: { name: string; rows: string[][] }, mapping: SheetMapping): ImportRow[] {
  const out: ImportRow[] = [];
  sheet.rows.slice(mapping.headerRow + 1).forEach((cells, offset) => {
    const row: ImportRow = { line: mapping.headerRow + offset + 2, sheet: sheet.name, category: mapping.category, attributes: {} };
    for (const [column, field] of Object.entries(mapping.columns)) {
      const value = String(cells[Number(column)] ?? "").replace(/\s+/g, " ").trim();
      if (!value) continue;
      if (field.startsWith("attr:")) row.attributes![field.slice(5)] = value;
      else (row as Record<string, unknown>)[field] = value;
    }
    if (row.name) out.push(row);
  });
  return out;
}
