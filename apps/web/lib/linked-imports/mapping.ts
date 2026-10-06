import type { MessageKey } from "@/lib/i18n/keys";
import type { ColumnMapping, ImportTarget, SourceSheet } from "./client";

/** The Wodana fields a column can fill, per target, in the order they're offered. Labels are the English i18n keys. */
export const IMPORT_FIELDS: Record<ImportTarget, Array<{ id: string; label: MessageKey }>> = {
  stock: [
    { id: "code", label: "Item code" }, { id: "name", label: "Name" }, { id: "category", label: "Category" }, { id: "unit", label: "Unit" }, { id: "quantity", label: "Quantity" },
    { id: "usedQuantity", label: "Used quantity" }, { id: "size", label: "Size" }, { id: "colour", label: "Colour" },
    { id: "location", label: "Place" }, { id: "cost", label: "Cost" },
  ],
  catalog: [
    { id: "code", label: "Item code" }, { id: "name", label: "Name" }, { id: "category", label: "Category" }, { id: "unit", label: "Unit" },
    { id: "type", label: "Kind" }, { id: "description", label: "Description" }, { id: "cost", label: "Cost" }, { id: "price", label: "Selling price" },
    { id: "productionDays", label: "Production time (days)" }, { id: "technicalDrawing", label: "Technical drawing" },
    { id: "height", label: "Height" }, { id: "width", label: "Width" }, { id: "depth", label: "Depth" }, { id: "attribute", label: "Keep as attribute" },
  ],
  suppliers: [
    { id: "code", label: "Supplier code" }, { id: "name", label: "Name" }, { id: "legalName", label: "Legal name" }, { id: "contactName", label: "Contact person" },
    { id: "phone", label: "Phone" }, { id: "contact", label: "Contact person and number" }, { id: "email", label: "Email" }, { id: "address", label: "Location" }, { id: "taxNumber", label: "Tax registration number" },
    { id: "paymentTerms", label: "Payment terms" }, { id: "categories", label: "What they supply" }, { id: "approval", label: "Approval" }, { id: "notes", label: "Notes" }, { id: "attribute", label: "Keep as attribute" },
  ],
};

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

/** Headings compared the way the importer compares them (case and spacing aside). */
export const headingKey = (text: string) => text.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");

/** The headings of a source: each tab's heading row, in sheet order, without blanks or repeats (tabs may add their own). */
export function headingsOf(sheets: SourceSheet[]) {
  const seen = new Set<string>();
  const headings: Array<{ heading: string; sample: string }> = [];
  for (const sheet of sheets) {
    if (!sheet.rows.some((row) => row.some((cell) => cell.trim()))) continue;
    const index = headingRow(sheet.rows);
    (sheet.rows[index] ?? []).forEach((cell, column) => {
      const heading = cell.trim();
      if (!heading || seen.has(headingKey(heading))) return;
      seen.add(headingKey(heading));
      const sample = sheet.rows.slice(index + 1).map((cells) => (cells[column] ?? "").trim()).find(Boolean) ?? "";
      headings.push({ heading, sample });
    });
  }
  return headings;
}

/** A first guess at the mapping from the headings; every field at most once, nothing guessed as an attribute. */
export function suggestMapping(target: ImportTarget, headings: string[]): ColumnMapping {
  const fields = IMPORT_FIELDS[target].map((field) => field.id).filter((id) => id !== "attribute");
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

/** The field rows are matched by first: the code when a column holds it, else the name. */
export function keyField(_target: ImportTarget, mapping: ColumnMapping): "code" | "name" {
  return Object.values(mapping.columns).includes("code") ? "code" : "name";
}

const filled = (row: string[]) => row.reduce((count, cell) => count + (cell.trim() ? 1 : 0), 0);

/**
 * A tab's heading rows and each block's title, as the importer reads them: a heading row names the code or name
 * column and (more than one column mapped) at least two mapped columns; a block's title is the one filled cell of
 * the nearest row above its heading row.
 */
export function sheetBlocks(sheet: SourceSheet, mapping: ColumnMapping) {
  const byHeading = new Map(Object.entries(mapping.columns).filter(([, field]) => field).map(([heading, field]) => [headingKey(heading), field]));
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
  for (const header of headers) {
    let above = header - 1;
    while (above >= 0 && !filled(sheet.rows[above])) above -= 1;
    if (above < 0 || headers.includes(above) || filled(sheet.rows[above]) !== 1) continue;
    titles.set(header, sheet.rows[above].find((cell) => cell.trim())!.trim().slice(0, 200));
    titleRows.add(above);
  }
  return { headers, titles, titleRows, byHeading };
}

/** The tabs an import reads: those chosen, or every tab. */
export const chosenTabs = <T extends SourceSheet>(sheets: T[], mapping: ColumnMapping) => (mapping.tabs ? sheets.filter((sheet) => mapping.tabs!.includes(sheet.name)) : sheets);

/**
 * An uploaded file trimmed to what's imported, so only that is sent: the chosen tabs, their mapped columns, from
 * the first heading row down (repeated heading rows kept), each block's title sent alongside, cell links moved
 * with their columns. Row numbers stay the sheet's.
 */
export function mappedColumns(sheets: SourceSheet[], mapping: ColumnMapping): SourceSheet[] {
  return chosenTabs(sheets, mapping).map((sheet) => {
    const { headers, titles, titleRows, byHeading } = sheetBlocks(sheet, mapping);
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

/** Whether a mapping can be imported: the code or the name column is chosen. */
export const hasKey = (mapping: ColumnMapping) =>
  Object.values(mapping.columns).includes("code") || Object.values(mapping.columns).includes("name");
