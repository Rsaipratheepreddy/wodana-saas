export type PaymentReminder = { on: string; channel: "whatsapp" | "email" };
/** A tax invoice to a client for a project's payment milestone, with what's paid on it. Amounts are exact decimal strings. */
export type ClientInvoice = {
  id: string; legalEntityId: string; projectId: string; projectReference: string; caseId: string; paymentId: string; number: string; issueDate: string; dueDate: string;
  currency: string; net: string; tax: string; total: string; milestoneTitle: string; customerName: string; customerAddress: string; customerTaxNumber: string;
  companyName: string; companyAddress: string; companyTaxNumber: string; note: string; status: "issued" | "credited"; issuedByName: string; issuedAt: string; version: number;
  creditNoteId: string | null; creditNoteNumber: string | null; creditReason: string | null; creditedOn: string | null;
  paid: string; balance: string; overdue: boolean;
  /** When the client was last reminded to pay (Send reminder or the automatic schedule). */
  lastReminder?: PaymentReminder | null;
};

export type InvoiceLine = { id: string; position: number; description: string; taxRate: string; net: string; tax: string; total: string };

/** A project's payment milestone still to invoice. */
export type MilestoneToInvoice = {
  projectId: string; projectReference: string; projectName: string; caseId: string; paymentId: string; title: string; amount: string; currency: string | null;
  dueDate: string | null; clientName: string; paid: string;
  lastReminder?: PaymentReminder | null;
};

export type ReceivablesState = { invoices: ClientInvoice[]; toInvoice: MilestoneToInvoice[]; canManage: boolean };
export type InvoiceState = { invoice: ClientInvoice; lines: InvoiceLine[]; canManage: boolean; canCredit: boolean };

/** What an invoice for a milestone would say, before it's issued. */
export type InvoicePreview = {
  milestone: MilestoneToInvoice; currency: string; net: string; tax: string; total: string; pricesIncludeTax: boolean;
  lines: Array<{ description: string; rate: string; net: string; tax: string; total: string }>;
  customer: { name: string; address: string }; company: { name: string; address: string; taxNumber: string };
};
