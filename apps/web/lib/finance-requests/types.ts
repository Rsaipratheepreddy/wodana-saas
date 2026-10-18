import type { ApprovalStatus } from "../approvals/policies";

export type RequestKind = "invoice" | "refund" | "payable";
export type RequestStatus = "new" | "in_progress" | "needs_info" | "done" | "rejected";
export type InvoiceKind = "standard" | "progress" | "web_order";
export type MaterialLocation = "factory" | "office" | "project";
export type FileKind = "quote" | "tax_invoice" | "proof" | "other";
export const REQUEST_STATUSES: RequestStatus[] = ["new", "in_progress", "needs_info", "done", "rejected"];

/** A request as the viewer may read it. Amounts are exact decimal strings; Finance-only fields are null for everyone else. */
export type FinanceRequest = {
  id: string; number: number; reference: string; kind: RequestKind; status: RequestStatus; source: "manual" | "stage";
  requestedBy: string; requesterName: string; createdAt: string; updatedAt: string; version: number;
  partyId: string | null; clientName: string | null; clientType: string | null;
  opportunityId: string | null; opportunityReference: string | null; opportunityTitle: string | null;
  projectId: string | null; projectReference: string | null; projectName: string | null;
  vendorId: string | null; supplierName: string | null; salespersonId: string | null; salespersonName: string | null;
  legalEntityId: string | null; companyName: string | null; currency: string; clientEmail: string; clientTaxNumber: string;
  invoiceKind: InvoiceKind | null; caseId: string | null; quoteId: string | null; paymentStageId: string | null; paymentStageTitle: string;
  paymentTerms: string; contractReference: string; orderNumber: string; orderGross: string | null; paymentMethodId: string | null; paymentMethod: string;
  taxCode: string; taxLabel: string; taxRate: string | null; net: string | null; tax: string | null; total: string;
  invoiceNumber: string; reason: string; bankDetails: string | null; hasBankDetails: boolean;
  supplierReference: string; payNow: string | null; balance: string | null; authorisedBy: string | null; authorisedByName: string | null;
  materialLocation: MaterialLocation | null; supplierTaxNumber: string; paidOnStatement: boolean; statementAmount: string | null;
  statementCheckedAt: string | null; statementCheckedByName: string | null; remarks: string;
  financeReference: string; internalNote: string | null; handledBy: string | null; handledByName: string | null;
  closedByName: string | null; closedAt: string | null; closeNote: string; invoicePending: boolean;
  approvalStatus: "pending" | "approved" | "returned" | "rejected" | "cancelled" | "superseded" | null; approvedAt: string | null;
  /** A refund's days, from its method when it was raised (PLM-109), and the day they lead to. */
  refundDays?: number | null; expectedRefundOn: string | null;
};

export type RequestLine = { id: string; position: number; description: string; quantity: string; unitPrice: string; amount: string };
export type RequestFile = { id: string; kind: FileKind; name: string; contentType: string; uploadedByName: string; uploadedAt: string };
export type RequestEvent = { id: string; kind: string; fromStatus: string | null; toStatus: string | null; note: string; actorName: string | null; occurredAt: string };

export type FinanceRequestsBoard = {
  requests: FinanceRequest[]; canManage: boolean; canRaise: boolean; me: string; settings: { financeInboxSet: boolean };
};

export type FinanceRequestDetail = {
  request: FinanceRequest; lines: RequestLine[]; files: RequestFile[]; events: RequestEvent[]; approval: ApprovalStatus | null; canDecide: boolean;
  guidance: string; canManage: boolean; canResubmit: boolean; canAttach: boolean;
};

/** A payment method, which is also a refund method: its guidance, whether a refund needs bank details and its usual refund days (PLM-109). */
export type PaymentMethod = { id: string; label: string; refundGuidance: string; needsBankDetails: boolean; refundDays: number | null; position: number; version: number };
export type TaxRate = { code: string; label: string; rate: string; isDefault: boolean };
export type Company = { id: string; name: string; currency: string; taxLabel: string; rates: TaxRate[] };
export type PaymentStage = { id: string; title: string; trigger: string; dueDate: string | null; currency: string; amount: string; legalEntityId: string | null };
export type ClientOption = { id: string; name: string; type: string; email: string | null };

/** What the request form starts from: the record it was raised from, filled, and what to pick from. */
export type RequestContext = {
  client: ClientOption | null;
  deal: { id: string; reference: string; title: string; legalEntityId: string | null; salespersonName: string | null; currency: string | null } | null;
  project: { id: string; reference: string | null; name: string } | null;
  caseId: string | null; stages: PaymentStage[]; quotes: Array<{ id: string; label: string; status: string; currency: string }>;
  companies: Company[]; defaultCompanyId: string | null; methods: PaymentMethod[]; people: Array<{ id: string; name: string }>;
  currency: string; taxNumberLabel: string | null; me: string;
};

export type RequestSettingsState = {
  settings: { financeInbox: string | null; stageInvoiceRequests: boolean; version: number };
  methods: PaymentMethod[]; canManage: boolean;
};

/** Where a request is raised from (it fills the client, deal and project). */
export type RequestOrigin = { partyId?: string; opportunityId?: string; projectId?: string };
