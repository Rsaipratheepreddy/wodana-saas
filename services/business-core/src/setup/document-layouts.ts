import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * §0.3 P3/P4: how the firm lays out a client document (Setup → Invoice layout). Configuration only: the amounts,
 * taxes and numbers are always the system's. Kept as one JSON object per document kind, version-checked.
 */
export type InvoiceLayout = {
  /** The document's title ("Tax invoice"; a firm may name it its own way). */
  title: string;
  /** The tax rate and tax columns on each line (else net and total only; the totals always show tax). */
  lineTax: boolean;
  /** The job's reference beside the milestone. */
  reference: boolean;
  /** What's paid on it and what's left. */
  balance: boolean;
  /** How to pay: bank details, a payment link, a cheque payee. */
  payment: string;
  /** The firm's terms. */
  terms: string;
  /** A line at the foot. */
  footer: string;
};

export const DEFAULT_INVOICE_LAYOUT: InvoiceLayout = { title: "Tax invoice", lineTax: true, reference: true, balance: true, payment: "", terms: "", footer: "" };

const words = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

/** A layout as stored: known fields only, each in its limits; anything missing takes the default. */
export function normaliseInvoiceLayout(value: unknown): InvoiceLayout {
  const input = value && typeof value === "object" ? value as Partial<InvoiceLayout> : {};
  return {
    title: words(input.title, 60).replace(/\s+/g, " ") || DEFAULT_INVOICE_LAYOUT.title,
    lineTax: typeof input.lineTax === "boolean" ? input.lineTax : DEFAULT_INVOICE_LAYOUT.lineTax,
    reference: typeof input.reference === "boolean" ? input.reference : DEFAULT_INVOICE_LAYOUT.reference,
    balance: typeof input.balance === "boolean" ? input.balance : DEFAULT_INVOICE_LAYOUT.balance,
    payment: words(input.payment, 1000), terms: words(input.terms, 2000), footer: words(input.footer, 300),
  };
}

export async function readInvoiceLayout(db: Db, workspaceId: string) {
  const row = (await db.query<{ layout: unknown; revision: number }>(`SELECT layout, revision FROM setup_document_layouts WHERE workspace_id = $1 AND kind = 'client_invoice'`, [workspaceId])).rows[0];
  return { layout: row ? normaliseInvoiceLayout(row.layout) : DEFAULT_INVOICE_LAYOUT, revision: row?.revision ?? 0 };
}
