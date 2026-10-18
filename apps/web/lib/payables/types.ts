export type BillStatus = "draft" | "held" | "approved" | "cancelled";

/** A supplier's invoice, with what's been paid on it. Amounts are exact decimal strings. */
export type Bill = {
  id: string; vendorId: string; supplierName: string; legalEntityId: string; companyName: string; number: string; invoiceDate: string; dueDate: string | null; currency: string;
  net: string; tax: string; total: string; statedTotal: string | null; status: BillStatus; holdReasons: string; approvedByName: string | null; approvedAt: string | null; approvalNote: string;
  cancelReason: string | null; fileName: string | null; createdBy: string; createdByName: string; createdAt: string; version: number; paid: string; balance: string; orders: string[];
  /** Held back until handover (fixed on approval) and still held; reserved by open payment runs; and what can be paid now. */
  retention: string; retentionHeld: string; reserved: string; payable: string;
};

export type BillLine = {
  id: string; position: number; orderLineId: string | null; orderId: string | null; orderNumber: string | null; projectId: string | null; projectReference: string | null;
  description: string; unit: string | null; quantity: string; unitPrice: string; taxRate: string; net: string; tax: string; total: string; retentionPercent: string;
  /** The Ledger's purchase tax code and account for the line, when the company keeps its books in Wodana. */
  taxCode?: string | null; booksAccountId?: string | null;
};

export type PaymentMethod = "bank" | "cheque" | "cash" | "card" | "other";

export type SupplierPayment = {
  id: string; vendorId: string; supplierName: string; legalEntityId: string; companyName: string; paidOn: string; currency: string; amount: string; method: PaymentMethod; reference: string;
  orderId: string | null; orderNumber: string | null; status: "recorded" | "reversed"; reverseReason: string | null; createdBy: string; createdByName: string; allocated: string; unallocated: string;
  runId: string | null; runNumber: number | null;
  allocations: Array<{ invoiceId: string; number: string; amount: string }>;
};

/** What a supplier is owed by one buying company in one currency. */
export type SupplierBalance = {
  vendorId: string; supplierName: string; legalEntityId: string; companyName: string; currency: string;
  invoiced: string; paid: string; debited: string; owed: string; overdue: string; held: string;
  /** Retention still held: owed, but not payable (nor overdue) until it's released. */
  retention: string;
};

export type Rights = { canManage: boolean; canApprove: boolean };

export type PayablesState = Rights & {
  bills: Bill[]; payments: SupplierPayment[]; suppliers: SupplierBalance[]; runs: PaymentRun[];
  /** Invoices are paid only through approved runs. */
  runsRequired: boolean;
  vendors: Array<{ id: string; name: string; currency: string | null }>; companies: Array<{ id: string; name: string; currency: string }>;
};

/** What an invoice holds back for one project (or for no project), and each release of it. */
export type Retention = {
  id: string; projectId: string | null; projectReference: string | null; amount: string; released: string; held: string;
  releases: Array<{ id: string; amount: string; automatic: boolean; reason: string | null; releasedByName: string | null; releasedAt: string }>;
};

export type BillState = Rights & {
  bill: Bill; lines: BillLine[]; payments: SupplierPayment[]; retentions: Retention[];
  canEdit: boolean; canApproveThis: boolean; canCancel: boolean; canPay: boolean; canRelease: boolean;
};

export type PaymentState = Rights & { payment: SupplierPayment };

export type DebitNote = { orderLineId: string; orderId: string; orderNumber: string; description: string; unit: string; legalEntityId: string; currency: string; quantity: string; amount: string };

export type SupplierState = Rights & {
  supplier: { id: string; name: string; creditDays: number | null; paymentTerms: string | null; bank: { id: string; bankName: string; last4: string; currency: string | null } | null; bankChangePending: boolean };
  orders: Array<{ id: string; number: string; legalEntityId: string; currency: string; status: string; total: string }>;
  balances: SupplierBalance[]; bills: Bill[]; payments: SupplierPayment[]; debitNotes: DebitNote[]; runsRequired: boolean;
};

/** An order line as the supplier may still invoice it, at the order's net price. */
export type InvoiceableLine = {
  orderLineId: string; orderId: string; orderNumber: string; projectId: string | null; projectReference: string | null; description: string; unit: string;
  ordered: string; taxRate: string; accepted: string; credited: string; billed: string; left: string; netUnitPrice: string;
};

export type InvoiceableState = {
  order: { id: string; number: string; vendorId: string; legalEntityId: string; currency: string; status: string; creditDays: number | null };
  lines: InvoiceableLine[];
};

export type RunStatus = "draft" | "submitted" | "approved" | "paid" | "cancelled";

/** A payment run: approved invoices to pay and how much of each, approved by someone else before the money goes out. */
export type PaymentRun = {
  id: string; number: number; note: string; status: RunStatus; createdBy: string; preparedBy: string; preparedByName: string; submittedAt: string | null;
  approvedBy: string | null; approvedByName: string | null; approvedAt: string | null; returnNote: string | null; paidByName: string | null; paidAt: string | null; paidOn: string | null;
  cancelReason: string | null; createdAt: string; version: number;
  invoices: number; suppliers: number; dueFrom: string | null; totals: Array<{ currency: string; amount: string }>;
};

export type RunItem = {
  id: string; invoiceId: string; amount: string; number: string; vendorId: string; supplierName: string; legalEntityId: string; companyName: string; currency: string;
  invoiceDate: string; dueDate: string | null; status: BillStatus; payable: string;
  /** The most it can take in this run: what it can be paid now, plus what this run reserves on it. */
  available: string;
};

/** One payment the run makes, per supplier, company and currency, into the supplier's approved account. */
export type RunPayment = {
  key: string; vendorId: string; supplierName: string; legalEntityId: string; companyName: string; currency: string; amount: string;
  invoices: Array<{ invoiceId: string; number: string; amount: string }>; reference: string; paymentId: string | null;
  bank: { bankName: string; last4: string } | null; bankChangePending: boolean; bankChanged: boolean;
};

export type RunState = Rights & {
  run: PaymentRun; items: RunItem[]; payments: RunPayment[];
  canEdit: boolean; canApproveThis: boolean; canReturn: boolean; canPay: boolean; canDownload: boolean; canCancel: boolean;
};
