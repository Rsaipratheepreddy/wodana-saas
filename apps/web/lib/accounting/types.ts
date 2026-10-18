export type AccountingLink = {
  id: string; legalEntityId: string; connectionId: string; startDate: string; salesItemId: string | null; expenseAccountId: string | null; paymentsAccountId: string | null;
  depositAccountId: string | null; pettyCashAccountId: string | null; pettyCashPaidFromId: string | null; active: boolean; version: number; taxCodes: Array<{ rate: string; providerTaxId: string }>; counts: Partial<Record<PostingStatus, number>>;
};
export type AccountingCompany = { id: string; name: string; currency: string; link: AccountingLink | null; rates: string[] };
export type AccountingConnection = { id: string; provider: "quickbooks" | "zoho_books"; name: string; legalEntityId: string | null; status: string };
export type AccountingSettings = { companies: AccountingCompany[]; connections: AccountingConnection[] };

export type PostingKind = "invoice" | "credit_note" | "invoice_payment" | "bill" | "bill_payment" | "bill_payment_void" | "expense";
export type PostingStatus = "pending" | "sent" | "failed" | "blocked" | "cancelled";
export type Posting = {
  id: string; kind: PostingKind; status: PostingStatus; documentDate: string; label: string | null; companyName: string; provider: "quickbooks" | "zoho_books"; attempts: number;
  providerNumber: string | null; errorCode: string | null; error: string | null; sentAt: string | null; nextAt: string | null;
};

/** An account, item or tax code read from the accounting system. */
export type ProviderOption = { id: string; name: string; type: string; rate: string | null };
