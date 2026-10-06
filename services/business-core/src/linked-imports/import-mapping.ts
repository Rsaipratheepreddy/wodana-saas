import { headingKey, sheetBlocks, TARGET_FIELDS, type ColumnMapping, type ImportTarget, type SourceSheet } from "./linked-import-source";

/**
 * The mapping step of a linked import, on the server: the first guess at which column fills which field, and the
 * file trimmed to what is imported. The same rules as the browser's (apps/web/lib/linked-imports/mapping.ts);
 * `import-mapping.spec.ts` keeps both in step. Used by the operator CLI.
 */

const key = (text: string) => text.normalize("NFKC").trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** How sheets usually name each field. */
const ALIASES: Record<string, string[]> = {
  code: ["code", "item code", "sku", "id", "item id", "ref", "reference", "item no", "item number", "product code", "article", "article no", "part no", "part number", "material code",
    "model code", "model no", "model number",
    "supplier code", "vendor code", "supplier id", "vendor id", "supplier no"],
  name: ["name", "item", "item name", "product", "product name", "material", "material name", "title", "supplier", "supplier name", "vendor", "vendor name", "company", "company name"],
  legalName: ["legal name", "registered name", "trade name", "full legal name", "company legal name"],
  contactName: ["contact", "contact person", "contact name", "sales person", "salesperson", "representative", "attention"],
  contact: ["contact person number", "contact person and number", "contact name and number", "contact name number", "contact details"],
  phone: ["phone", "mobile", "telephone", "tel", "contact number", "phone number", "mobile number", "whatsapp", "contact no"],
  email: ["email", "e mail", "email address", "mail"],
  address: ["address", "location", "office address", "area", "city"],
  taxNumber: ["trn", "trn no", "trn number", "tax number", "tax no", "tax registration number", "tax id", "vat number", "vat no", "vat registration number", "gstin", "gst number", "gst no"],
  paymentTerms: ["payment terms", "terms", "payment", "credit terms", "payment term"],
  categories: ["categories", "category", "supplier type", "vendor type", "type of supplier", "supplies", "what they supply", "products", "materials", "trade", "scope", "specialty", "speciality"],
  approval: ["approval", "approved", "approval status", "approved not approved", "approved or not", "directors approved", "directors approval", "director approved", "director approval",
    "directors approved not approved", "director approved not approved", "management approval", "supplier approval", "vendor approval", "approved supplier", "approved vendor"],
  notes: ["notes", "remarks", "comments"],
  unit: ["unit", "uom", "units", "unit of measure"],
  quantity: ["qty", "quantity", "stock", "on hand", "in stock", "balance", "available", "stock qty", "current stock"],
  location: ["location", "place", "warehouse", "store", "bin"],
  cost: ["cost", "unit cost", "cost price", "purchase price", "buying price", "landed cost"],
  price: ["price", "selling price", "sale price", "sales price", "retail price", "rrp", "mrp", "list price"],
  category: ["category", "collection", "group", "range"],
  type: ["kind", "item type", "product type"],
  description: ["description", "details", "notes", "remarks"],
  productionDays: ["production time", "production days", "lead time", "make time", "production lead time", "days"],
  technicalDrawing: ["technical drawing", "technical drawing current", "technical drawings", "drawing", "drawings", "tech drawing", "shop drawing", "shop drawings"],
  height: ["height", "height cm", "height mm", "height in"],
  width: ["width", "length", "width cm", "length cm", "width mm", "length mm", "width in", "length in"],
  depth: ["depth", "depth cm", "depth mm", "depth in"],
  usedQuantity: ["used qty", "used quantity", "used", "qty used", "quantity used", "issued", "issued qty"],
  size: ["size", "sizes", "dimension", "dimensions", "dimensions size", "dimensions and size"],
  colour: ["colour", "color", "colours", "colors", "finish colour", "finish color"],
};

/** The heading row: the fullest of a tab's first ten rows (the first, when equal). */
export function headingRow(rows: string[][]) {
  let best = 0, filled = -1;
  rows.slice(0, 10).forEach((row, index) => {
    const count = row.filter((cell) => cell.trim()).length;
    if (count > filled) { filled = count; best = index; }
  });
  return best;
}

/** The headings of a source: each tab's heading row, in sheet order, without blanks or repeats. */
export function headingsOf(sheets: SourceSheet[]) {
  const seen = new Set<string>();
  const headings: string[] = [];
  for (const sheet of sheets) {
    if (!sheet.rows.some((row) => row.some((cell) => cell.trim()))) continue;
    for (const cell of sheet.rows[headingRow(sheet.rows)] ?? []) {
      const heading = cell.trim();
      if (!heading || seen.has(headingKey(heading))) continue;
      seen.add(headingKey(heading));
      headings.push(heading);
    }
  }
  return headings;
}

/** A first guess at the mapping from the headings; every field at most once, nothing guessed as an attribute. */
export function suggestMapping(target: ImportTarget, headings: string[]): ColumnMapping {
  const fields = (TARGET_FIELDS[target] as readonly string[]).filter((id) => id !== "attribute");
  const columns: Record<string, string> = {};
  const used = new Set<string>();
  // Exact names first, so "Item code" wins the code over a later "Item".
  for (const pass of ["exact", "contains"] as const) {
    for (const heading of headings) {
      if (columns[heading]) continue;
      const written = key(heading);
      const field = fields.find((id) => !used.has(id) && (pass === "exact" ? ALIASES[id]?.includes(written) : ALIASES[id]?.some((alias) => alias.length > 3 && written.includes(alias))));
      if (field) { columns[heading] = field; used.add(field); }
    }
  }
  return { columns };
}

/** The tabs an import reads: those chosen, or every tab. */
export const chosenTabs = <T extends SourceSheet>(sheets: T[], mapping: ColumnMapping) => (mapping.tabs ? sheets.filter((sheet) => mapping.tabs!.includes(sheet.name)) : sheets);

/**
 * An uploaded file trimmed to what's imported, as the browser sends it: the chosen tabs, their mapped columns, from
 * the first heading row down, each block's title sent alongside, cell links moved with their columns.
 */
export function mappedColumns(sheets: SourceSheet[], mapping: ColumnMapping): SourceSheet[] {
  const usable: ColumnMapping = { ...mapping, columns: Object.fromEntries(Object.entries(mapping.columns).filter(([, field]) => field)) };
  return chosenTabs(sheets, mapping).map((sheet) => {
    const { headers, titles, titleRows, byHeading } = sheetBlocks({ name: sheet.name, rows: sheet.rows }, usable);
    if (!headers.length) return { name: sheet.name, rows: [] };
    const keep = [...new Set(headers.flatMap((header) => sheet.rows[header].map((cell, column) => (byHeading.has(headingKey(cell)) ? column : -1))))]
      .filter((column) => column >= 0).sort((a, b) => a - b);
    const position = new Map(keep.map((column, at) => [column, at]));
    const rows = sheet.rows.map((row, at) => {
      if (at < headers[0] || titleRows.has(at)) return [];
      const cells = keep.map((column) => row[column] ?? "");
      return cells.some((cell) => cell.trim()) ? cells : [];
    });
    const trimmed: SourceSheet = { name: sheet.name, rows, titles: Object.fromEntries([...titles].map(([header, title]) => [String(header), title])) };
    const links = Object.entries(sheet.links ?? {}).flatMap(([at, url]) => {
      const [row, column] = at.split(":").map(Number);
      return row >= headers[0] && position.has(column) ? [[`${row}:${position.get(column)}`, url] as const] : [];
    });
    if (links.length) trimmed.links = Object.fromEntries(links);
    return trimmed;
  });
}

/**
 * The guessed columns with an operator's overrides: each override maps a heading to a field (or "" to leave the
 * heading out). A field an override takes is dropped from the headings the guess gave it, except "attribute",
 * which many columns can be.
 */
export function overrideMapping(guess: Record<string, string>, overrides: Record<string, string>) {
  const taken = new Set(Object.values(overrides).filter((field) => field && field !== "attribute"));
  const overridden = new Set(Object.keys(overrides).map(headingKey));
  const columns: Record<string, string> = {};
  for (const [heading, field] of Object.entries(guess)) if (!overridden.has(headingKey(heading)) && !taken.has(field)) columns[heading] = field;
  for (const [heading, field] of Object.entries(overrides)) if (field) columns[heading] = field;
  return columns;
}
