import type { MessageKey } from "@/lib/i18n/keys";
import type { ColumnMapping, ImportTarget, SourceSheet } from "./client";

/** The Wodana fields a column can fill, per target, in the order they're offered. Labels are the English i18n keys. */
export const IMPORT_FIELDS: Record<ImportTarget, Array<{ id: string; label: MessageKey }>> = {
  stock: [
    { id: "code", label: "Item code" }, { id: "name", label: "Name" }, { id: "unit", label: "Unit" }, { id: "quantity", label: "Quantity" },
    { id: "location", label: "Place" }, { id: "cost", label: "Cost" },
  ],
  catalog: [
    { id: "code", label: "Item code" }, { id: "name", label: "Name" }, { id: "category", label: "Category" }, { id: "unit", label: "Unit" },
    { id: "type", label: "Kind" }, { id: "description", label: "Description" }, { id: "cost", label: "Cost" }, { id: "price", label: "Selling price" },
    { id: "productionDays", label: "Production time (days)" }, { id: "attribute", label: "Keep as attribute" },
  ],
  suppliers: [
    { id: "code", label: "Supplier code" }, { id: "name", label: "Name" }, { id: "legalName", label: "Legal name" }, { id: "contactName", label: "Contact person" },
    { id: "phone", label: "Phone" }, { id: "email", label: "Email" }, { id: "address", label: "Location" }, { id: "taxNumber", label: "Tax registration number" },
    { id: "paymentTerms", label: "Payment terms" }, { id: "categories", label: "What they supply" }, { id: "notes", label: "Notes" }, { id: "attribute", label: "Keep as attribute" },
  ],
};

const key = (text: string) => text.normalize("NFKC").trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** How sheets usually name each field. */
const ALIASES: Record<string, string[]> = {
  code: ["code", "item code", "sku", "id", "item id", "ref", "reference", "item no", "item number", "product code", "article", "article no", "part no", "part number", "material code",
    "supplier code", "vendor code", "supplier id", "vendor id", "supplier no"],
  name: ["name", "item", "item name", "product", "product name", "material", "material name", "title", "supplier", "supplier name", "vendor", "vendor name", "company", "company name"],
  legalName: ["legal name", "registered name", "trade name", "full legal name", "company legal name"],
  contactName: ["contact", "contact person", "contact name", "sales person", "salesperson", "representative", "attention"],
  phone: ["phone", "mobile", "telephone", "tel", "contact number", "phone number", "mobile number", "whatsapp", "contact no"],
  email: ["email", "e mail", "email address", "mail"],
  address: ["address", "location", "office address", "area", "city"],
  taxNumber: ["trn", "trn no", "trn number", "tax number", "tax no", "tax registration number", "tax id", "vat number", "vat no", "vat registration number", "gstin", "gst number", "gst no"],
  paymentTerms: ["payment terms", "terms", "payment", "credit terms", "payment term"],
  categories: ["categories", "category", "supplier type", "vendor type", "type of supplier", "supplies", "what they supply", "products", "materials", "trade", "scope", "specialty", "speciality"],
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

/** The headings of a source (the first tab that has any), in sheet order, without blanks or repeats. */
export function headingsOf(sheets: SourceSheet[]) {
  for (const sheet of sheets) {
    if (!sheet.rows.some((row) => row.some((cell) => cell.trim()))) continue;
    const row = sheet.rows[headingRow(sheet.rows)] ?? [];
    const seen = new Set<string>();
    const headings: Array<{ heading: string; sample: string }> = [];
    const index = headingRow(sheet.rows);
    row.forEach((cell, column) => {
      const heading = cell.trim();
      if (!heading || seen.has(key(heading))) return;
      seen.add(key(heading));
      const sample = sheet.rows.slice(index + 1).map((cells) => (cells[column] ?? "").trim()).find(Boolean) ?? "";
      headings.push({ heading, sample });
    });
    return headings;
  }
  return [];
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

/** The field rows are matched by: the code, or (a supplier list without codes) the name. */
export function keyField(target: ImportTarget, mapping: ColumnMapping): "code" | "name" {
  return target === "suppliers" && !Object.values(mapping.columns).includes("code") ? "name" : "code";
}

/** An uploaded file trimmed to its mapped columns, so only what's imported is sent (row numbers stay the sheet's). */
export function mappedColumns(sheets: SourceSheet[], mapping: ColumnMapping, target: ImportTarget = "stock"): SourceSheet[] {
  const mapped = new Set(Object.entries(mapping.columns).filter(([, field]) => field).map(([heading]) => key(heading)));
  const matchBy = keyField(target, mapping);
  const code = key(Object.entries(mapping.columns).find(([, field]) => field === matchBy)?.[0] ?? "");
  return sheets.map((sheet) => {
    // The heading row is the one naming the code column, as the importer reads it.
    const index = sheet.rows.slice(0, 20).findIndex((row) => row.some((cell) => key(cell) === code));
    if (index < 0) return { name: sheet.name, rows: [] };
    const keep = sheet.rows[index].map((cell, column) => (mapped.has(key(cell)) ? column : -1)).filter((column) => column >= 0);
    return { name: sheet.name, rows: sheet.rows.map((row, at) => (at < index ? [] : keep.map((column) => row[column] ?? ""))) };
  });
}

/** Whether a mapping can be imported: the code column is chosen (or, for suppliers, the code or the name). */
export const hasKey = (mapping: ColumnMapping, target: ImportTarget = "stock") =>
  Object.values(mapping.columns).includes("code") || (target === "suppliers" && Object.values(mapping.columns).includes("name"));
