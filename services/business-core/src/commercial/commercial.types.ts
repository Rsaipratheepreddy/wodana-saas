export type CatalogSelection = {
  role: string;
  recordId: string;
  version: number;
  snapshot: {
    id: string;
    name: string;
    code: string;
    kind: string;
    version: number;
    catalogId: string;
    catalogName?: string;
    configuration?: Record<string, string | number>;
    commerce?: { pricingMode: CatalogPricingMode };
  };
};
export type CatalogPricingMode = "unpriced" | "fixed" | "on_request";
export type CatalogPriceSnapshot = {
  status: "resolved" | "price_required" | "unpriced" | "stale";
  source: "catalog" | "manual_override";
  mode: CatalogPricingMode;
  catalogId: string;
  work: { id: string; version: number };
  variant?: { id: string; version: number };
  unit?: { id: string; version: number };
  unitLabel?: string;
  rateZone?: { id: string; version: number };
  quantity: number;
  currency: string;
  pricingDate: string;
  taxRate: number;
  resolvedAt: string;
  issue?: { code: string; message: string };
  rateCard?: {
    id: string;
    version: number;
    amount: number;
    baseUnitRate: number;
    appliedUnitRate: number;
    effectiveFrom: string;
    effectiveTo?: string;
    taxIncluded: boolean;
    costIncludes: string;
    minimumQuantity?: number;
    minimumCharge?: number;
    reference?: string;
  };
  override?: {
    amount: number;
    reason: string;
    by: string;
    at: string;
  };
};
export type CatalogPriceRequest = {
  action: "resolve" | "override";
  pricingDate?: string;
  rateZoneId?: string;
  rateZoneVersion?: number;
  reason?: string;
};
export type PaymentTerm = {
  id: string;
  title: string;
  percent: number;
  trigger: string;
  requiredForRelease: boolean;
};
export type PaymentTemplate = {
  id: string;
  name: string;
  version: number;
  milestones: PaymentTerm[];
};
export type QuotationMaterial = {
  id: string;
  name: string;
  code: string;
  brand: string;
  specification: string;
  suppliedByClient: boolean;
};
export type QuotationTemplate = {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  content: Pick<Quote, "rooms" | "lines" | "currency" | "discount" | "taxRate" | "inclusions" | "terms" | "exclusions" | "paymentTerms">;
};
export type QuoteLine = {
  id: string;
  room: string;
  title: string;
  specification: string;
  material: string;
  finish: string;
  quantity: number;
  unit: string;
  unitCost: number;
  rate: number;
  variant?: string;
  photo?: string;
  pricingMode?: "item" | "materials";
  materialRows?: QuotationMaterialRow[];
  catalogLinks?: CatalogSelection[];
  catalogPrice?: CatalogPriceSnapshot;
  /** Command-only intent. Removed before the quotation is persisted. */
  catalogPriceRequest?: CatalogPriceRequest;
  customMaterials?: QuotationMaterial[];
  deductsLineId?:string;
  scopeId?: string;
  scopeVersion?: number;
  specificationVersion?: number;
};
/** Selling-price breakdown per ONE item unit. Never contains internal purchase costs. */
export type QuotationMaterialRow = {
  id: string;
  name: string;
  type: "material" | "finish" | "labour" | "other";
  specification: string;
  quantity: number;
  unit: string;
  rate: number;
  suppliedByClient: boolean;
};
export type QuoteStatus =
  | "draft"
  | "internal_review"
  | "internal_approved"
  | "issued"
  | "accepted"
  | "changes_requested"
  | "declined"
  | "superseded"
  | "withdrawn";
export type Quote = {
  rooms?: { id:string; name:string; catalog?:CatalogSelection }[];
  direction?:"addition"|"deduction";
  familyId?:string;
  id: string;
  number: number;
  kind: "quotation" | "variation";
  baselineId?: string;
  definitionBaseline?: { id: string; number: number; hash: string };
  status: QuoteStatus;
  title: string;
  cover?: {
    preparedFor: string; location: string; subtitle: string;
    logo?: string; banner?: string; signature?: string;
    signerName?: string; signerTitle?: string; clientSignature?: boolean;
    taxLabel?: string; taxRegistration?: string;
  };
  inclusions?: string;
  currency: string;
  validUntil: string;
  discount: number;
  taxRate: number;
  terms: string;
  exclusions: string;
  lines: QuoteLine[];
  requestIds: string[];
  paymentTerms: PaymentTerm[];
  paymentTemplate?: { id: string; version: number; name: string };
  createdAt: string;
  issuedAt?: string;
  approvedBy?: string;
  approverId?: string;
  decisionChallengeId?: string;
  decidedAt?: string;
  decidedBy?: string;
  hash?: string;
  total: number;
  brand?: PortalBrand;
};
export type CommercialComment = {
  id: string;
  author: string;
  text: string;
  at: string;
  visibility: "client" | "internal";
};
export type ControlledChangeKind =
  | "addition"
  | "removal"
  | "replacement"
  | "clarification"
  | "date_change"
  | "price_correction";
export type ChangeImpactTarget = {
  kind: "work_package" | "task" | "order" | "material" | "booking";
  id: string;
  title: string;
  status: string;
};
export type ChangeImpact = {
  assessedAt: string;
  projectId: string;
  sourceLineIds: string[];
  targets: ChangeImpactTarget[];
  bookingCount: number;
  hasReportedOrCompletedWork: boolean;
};
export type ChangeDisposition = {
  targetKind: ChangeImpactTarget["kind"];
  targetId: string;
  action:
    | "cancel"
    | "hold_and_replan"
    | "return_or_credit"
    | "retain_as_stock"
    | "rework"
    | "complete_as_client_owned";
  note: string;
};
/**
 * A formal change case joins the commercial offer and the operational impact.
 * It deliberately lives on the existing request record so older client
 * feedback remains compatible and every case retains the same audit history.
 */
export type ControlledChange = {
  kind: ControlledChangeKind;
  sourceLineIds: string[];
  quoteIds: string[];
  impact?: ChangeImpact;
  dispositions: ChangeDisposition[];
};
export type ChangeRequest = {
  id: string;
  number: number;
  quoteId?: string;
  title: string;
  detail: string;
  status:
    | "open"
    | "under_review"
    | "awaiting_decision"
    | "resolved"
    | "declined"
    | "withdrawn";
  owner: string;
  dueDate: string;
  resolution: string;
  comments: CommercialComment[];
  createdAt: string;
  control?: ControlledChange;
};
export type Agreement = {
  quoteId: string;
  reference: string;
  terms: string;
  evidence: string;
  evidenceKind?: "operational" | "demonstration";
  status: "draft" | "executed";
  executedBy?: string;
  executedAt?: string;
};
export type Payment = {
  invoice?: { accountId?:string; lastError?:string; checkedAt?:string; connectionId:string; provider:string; id:string; number:string; customer:string; total:number; balance:number; currency:string; status:string; paymentUrl:string|null; refreshedAt:string };
  id: string;
  sourceQuoteId?: string;
  trigger?: string;
  title: string;
  amount: number;
  dueDate: string;
  requiredForRelease: boolean;
  status: "pending" | "proof_submitted" | "verified";
  proof: string;
  reference: string;
  evidenceKind?: "operational" | "demonstration";
  verifiedBy?: string;
  verifiedAt?: string;
};
export type AuditEntry = {
  id: string;
  at: string;
  actor: string;
  action: string;
  quoteId?: string;
  note: string;
};
export type OwnerReviewChecklist = {
  agreement: boolean;
  boq: boolean;
  documents: boolean;
  margin: boolean;
  materials: boolean;
  payment: boolean;
};
export type OwnerReview = {
  id: string;
  quoteId: string;
  quoteHash: string;
  status: "submitted" | "approved" | "returned" | "rejected";
  commission: number;
  checklist: OwnerReviewChecklist;
  submissionNote: string;
  submittedAt: string;
  submittedBy: string;
  submittedById: string;
  decisionNote?: string;
  decidedAt?: string;
  decidedBy?: string;
  decidedById?: string;
};
export type DealFile = {
  id: string;
  reference: string;
  revision: number;
  ownerReviewId: string;
  quoteId: string;
  quoteNumber: number;
  quoteHash: string;
  definitionBaseline?: { id: string; number: number; hash: string };
  agreementReference: string;
  paymentIds: string[];
  value: number;
  cost: number;
  margin: number;
  commission: number;
  status: "active";
  approvedAt: string;
  approvedBy: string;
};
export type MaterialApprovalStatus =
  | "proposed"
  | "client_review"
  | "approved"
  | "rejected";
export type MaterialApproval = {
  id: string;
  quoteId: string;
  lineId: string;
  materialRowId: string;
  revision: number;
  room: string;
  item: string;
  name: string;
  code: string;
  brand: string;
  specification: string;
  photo?: string;
  note: string;
  status: MaterialApprovalStatus;
  approverId?: string;
  submittedAt?: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
  decisionChallengeId?: string;
};
export type CommercialData = {
  credits?:{id:string;quoteId:string;amount:number;currency:string;status:"pending"|"verified";reference:string;evidence:string;verifiedBy?:string;verifiedAt?:string}[];
  ownerReview?: OwnerReview | null;
  dealFile?: DealFile | null;
  materialApprovals?: MaterialApproval[];
  revision: number;
  quotes: Quote[];
  requests: ChangeRequest[];
  agreement: Agreement | null;
  payments: Payment[];
  audit: AuditEntry[];
  release: null | {
    at: string;
    by: string;
    note: string;
    quoteId: string;
    dealFileId?: string;
    id: string;
    projectId?: string;
  };
};
export type PortalBrand = {
  name: string;
  logo: string;
  primaryColor: string;
  accentColor: string;
  welcomeTitle: string;
  welcomeText: string;
  supportPhone: string;
  layout: "soft" | "minimal";
};
export type PortalSettings = {
  workspaceId: string;
  slug: string;
  version: number;
  enabled: boolean;
  brand: PortalBrand;
  testMode: boolean;
  canManage?: boolean;
};
export type PortalGrant = {
  id: string;
  name: string;
  phone: string;
  role: "viewer" | "approver";
  active: boolean;
  testContact: boolean;
};
export type CommercialState = {
  workspaceId: string;
  caseId: string;
  title: string;
  customerName: string;
  currency: string;
  data: CommercialData;
  contacts: PortalGrant[];
  canEdit: boolean;
  canApprove: boolean;
  canOverridePrice?: boolean;
  canRelease: boolean;
  canManagePortal: boolean;
  portalSlug: string | null;
  portalBrand?: PortalBrand;
  portalEnabled?: boolean;
  testMode?: boolean;
  releaseReadiness?: {
    designsRequired: number;
    designsApproved: number;
  };
};
export type ClientQuote = Omit<
  Quote,
  "decisionChallengeId" | "lines" | "approvedBy" | "approverId" | "requestIds"
> & {
  lines: (Omit<
    QuoteLine,
    | "unitCost"
    | "scopeId"
    | "scopeVersion"
    | "specificationVersion"
    | "catalogLinks"
    | "catalogPrice"
    | "catalogPriceRequest"
  > & { variantLabel?: string })[];
  canDecide: boolean;
};
export type ClientMaterialApproval = Omit<
  MaterialApproval,
  "approverId" | "decisionChallengeId"
> & { canDecide: boolean };
export type ClientCase = {
  credits?:CommercialData["credits"];
  designs?:{id:string;title:string;type:string;number:number;status:string;name:string;mimeType:string}[];
  materials?:ClientMaterialApproval[];
  id: string;
  title: string;
  customerName: string;
  quotes: ClientQuote[];
  requests: ChangeRequest[];
  agreement: Agreement | null;
  payments: Payment[];
  released: boolean;
  project?: import("../projects/execution.types").PublicProject;
  role: "viewer" | "approver";
};
