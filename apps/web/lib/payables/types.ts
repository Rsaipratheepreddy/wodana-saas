export type BillStatus = "draft" | "held" | "approved" | "cancelled";

/** A supplier's invoice, with what's been paid on it. Amounts are exact decimal strings. */
export type Bill = {
  id: string; vendorId: string; supplierName: string; legalEntityId: string; companyName: string; number: string; invoiceDate: string; dueDate: string | null; currency: string;
  net: string; tax: string; total: string; statedTotal: string | null; status: BillStatus; holdReasons: string; approvedByName: string | null; approvedAt: string | null; approvalNote: string;
  cancelReason: string | null; fileName: string | null; createdBy: string; createdByName: string; createdAt: string; version: number; paid: string; balance: string; orders: string[];
};

export type BillLine = {
  id: string; position: number; orderLineId: string | null; orderId: string | null; orderNumber: string | null; projectId: string | null; projectReference: string | null;
  description: string; unit: string | null; quantity: string; unitPrice: string; taxRate: string; net: string; tax: string; total: string;
};

export type PaymentMethod = "bank" | "cheque" | "cash" | "card" | "other";

export type SupplierPayment = {
  id: string; vendorId: string; supplierName: string; legalEntityId: string; companyName: string; paidOn: string; currency: string; amount: string; method: PaymentMethod; reference: string;
  orderId: string | null; orderNumber: string | null; status: "recorded" | "reversed"; reverseReason: string | null; createdBy: string; createdByName: string; allocated: string; unallocated: string;
  allocations: Array<{ invoiceId: string; number: string; amount: string }>;
};

/** What a supplier is owed by one buying company in one currency. */
export type SupplierBalance = {
  vendorId: string; supplierName: string; legalEntityId: string; companyName: string; currency: string;
  invoiced: string; paid: string; debited: string; owed: string; overdue: string; held: string;
};

export type Rights = { canManage: boolean; canApprove: boolean };

export type PayablesState = Rights & {
  bills: Bill[]; payments: SupplierPayment[]; suppliers: SupplierBalance[];
  vendors: Array<{ id: string; name: string; currency: string | null }>; companies: Array<{ id: string; name: string; currency: string }>;
};

export type BillState = Rights & {
  bill: Bill; lines: BillLine[]; payments: SupplierPayment[];
  canEdit: boolean; canApproveThis: boolean; canCancel: boolean; canPay: boolean;
};

export type PaymentState = Rights & { payment: SupplierPayment };

export type DebitNote = { orderLineId: string; orderId: string; orderNumber: string; description: string; unit: string; legalEntityId: string; currency: string; quantity: string; amount: string };

export type SupplierState = Rights & {
  supplier: { id: string; name: string; creditDays: number | null; paymentTerms: string | null; bank: { id: string; bankName: string; last4: string; currency: string | null } | null; bankChangePending: boolean };
  orders: Array<{ id: string; number: string; legalEntityId: string; currency: string; status: string; total: string }>;
  balances: SupplierBalance[]; bills: Bill[]; payments: SupplierPayment[]; debitNotes: DebitNote[];
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
