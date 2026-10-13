export type TaxRate = { code: string; label: string; rate: string; isDefault: boolean };
export type NumberingRow = { documentType: "QUOTATION" | "INVOICE" | "CREDIT_NOTE" | "PURCHASE_ORDER" | "DEAL_FILE"; prefix: string; suffix?: string; padding: number; resetPolicy: "never" | "annual"; nextNumber: number; version: number; exists: boolean; preview: string };
export type TaxNumbering = {
  entity: { id: string; countryCode: string; currency: string; taxRegistrationNumber: string | null };
  taxModel: { model: string; label: string | null; registrationLabel: string | null };
  tax: { version: number; pricesIncludeTax: boolean; rates: TaxRate[] } | null;
  numbering: NumberingRow[];
};

export const e2eTaxNumbering = (entityId: string): TaxNumbering => ({
  entity: { id: entityId, countryCode: "AE", currency: "AED", taxRegistrationNumber: "100000000000003" },
  taxModel: { model: "vat", label: "VAT", registrationLabel: "TRN" },
  tax: null,
  numbering: [
    { documentType: "QUOTATION", prefix: "IGLO-QUO-{YYYY}-", padding: 5, resetPolicy: "annual", nextNumber: 1, version: 1, exists: true, preview: "IGLO-QUO-2026-00001" },
    { documentType: "INVOICE", prefix: "IGLO-INV-{YYYY}-", padding: 5, resetPolicy: "annual", nextNumber: 1, version: 1, exists: true, preview: "IGLO-INV-2026-00001" },
    { documentType: "PURCHASE_ORDER", prefix: "IGLO-PO-{YYYY}-", padding: 5, resetPolicy: "annual", nextNumber: 1, version: 1, exists: true, preview: "IGLO-PO-2026-00001" },
  ],
});

/** Same preview the server computes (prefix, number, suffix), for live feedback while editing. */
export function previewNumber(prefix: string, padding: number, next: number, year = new Date().getFullYear(), suffix = "") {
  return prefix.replaceAll("{YYYY}", String(year)) + String(Math.max(1, next || 1)).padStart(Math.min(12, Math.max(1, padding || 1)), "0") + suffix.replaceAll("{YYYY}", String(year));
}
