import type { BuyingCompany, SupplierImportRow } from "./types";

export type SupplierColumn = "name" | "categories" | "approval" | "deal" | "terms" | "contactName" | "phone" | "email" | "locality" | "notes";
export type SupplierSheet = { name: string; header: number; columns: Partial<Record<SupplierColumn, number>>; rows: string[][]; likely: boolean };

// Header words for each field, most specific first. A column is used for one field only.
const MATCHERS: Array<[SupplierColumn, RegExp]> = [
  ["email", /e-?mail/],
  ["approval", /approv|nominat/],
  ["deal", /discount|commission|rebate/],
  ["terms", /payment terms|^terms$|credit terms/],
  ["name", /company name|supplier name|vendor name|^supplier$|^vendor$|^name$|^company$/],
  ["categories", /supplier type|category|categories|^type$|trade/],
  ["contactName", /contact person|contact name|^contact$|^contact person/],
  ["phone", /phone|mobile|telephone|^tel/],
  ["locality", /location|city|area|emirate|address|state/],
  ["notes", /description|remarks|notes/],
];

/** Finds the header row (within the first 10) and which column holds what. */
export function readSupplierSheet(name: string, rows: string[][]): SupplierSheet {
  let header = -1;
  let columns: SupplierSheet["columns"] = {};
  for (let index = 0; index < Math.min(10, rows.length) && header < 0; index++) {
    const cells = rows[index].map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim().toLowerCase());
    const found: SupplierSheet["columns"] = {};
    const used = new Set<number>();
    for (const [field, pattern] of MATCHERS) {
      const at = cells.findIndex((cell, column) => cell && !used.has(column) && pattern.test(cell));
      if (at >= 0) { found[field] = at; used.add(at); }
    }
    if (found.name !== undefined) { header = index; columns = found; }
  }
  // A supplier list says more than names: a category, terms, approval or a contact.
  const likely = header >= 0 && ["categories", "terms", "approval", "contactName", "phone", "email"].some((field) => columns[field as SupplierColumn] !== undefined);
  return { name, header, columns, rows, likely };
}

const PHONE = /(\+?\d[\d\s()-]{6,}\d)/;

/** The sheet's supplier rows; a row with only one filled cell is a section title and is skipped. */
export function supplierRows(sheet: SupplierSheet, entityId: string | null): SupplierImportRow[] {
  if (sheet.header < 0) return [];
  const cell = (row: string[], field: SupplierColumn) => (sheet.columns[field] === undefined ? "" : String(row[sheet.columns[field]!] ?? "").replace(/\s+/g, " ").trim());
  return sheet.rows.slice(sheet.header + 1).flatMap((row, index) => {
    const name = cell(row, "name");
    if (!name || row.filter((value) => String(value ?? "").trim()).length < 2) return [];
    let contactName = cell(row, "contactName");
    let phone = cell(row, "phone");
    // "Ramiz - +971 52 846 6806": the name and the number in one cell.
    const inContact = contactName.match(PHONE);
    if (!phone && inContact) { phone = inContact[1].trim(); contactName = contactName.replace(inContact[1], "").replace(/[\s\-–/]+$/, "").replace(/^[\s\-–/]+/, "").trim(); }
    return [{ key: `${sheet.name}:${sheet.header + index + 2}`, name, categories: cell(row, "categories"), approval: cell(row, "approval"), deal: cell(row, "deal"), terms: cell(row, "terms"),
      contactName, phone, email: cell(row, "email"), locality: cell(row, "locality"), notes: cell(row, "notes"), entityId }];
  });
}

/** The company a sheet most likely belongs to, by the words its name shares with the company's name. */
export function guessCompany(sheetName: string, companies: BuyingCompany[]): string | null {
  const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !["llc", "the", "and", "suppliers", "supplier", "list", "prefered", "preferred"].includes(word)));
  const sheet = words(sheetName);
  let best: { id: string; score: number } | null = null;
  for (const company of companies) {
    const score = [...words(`${company.name} ${company.code}`)].filter((word) => sheet.has(word) || [...sheet].some((item) => item.startsWith(word) || word.startsWith(item))).length;
    if (score && (!best || score > best.score)) best = { id: company.id, score };
  }
  return best?.id ?? (companies.length === 1 ? companies[0].id : null);
}
