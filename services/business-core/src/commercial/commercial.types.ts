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
    attributes?: Array<{ name: string; value: string }>;
    configuration?: Record<string, string | number>;
    commerce?: { pricingMode: CatalogPricingMode };
    primaryAsset?: {
      id: string;
      recordId: string;
      name: string;
      mimeType: string;
      hasPreview: boolean;
    };
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
    sourceUnit?: {
      id: string;
      version: number;
      label: string;
      conversionFactor: number;
    };
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
  /** Explicit H3 applicability; never inferred from free-text trigger/title. */
  requiredForProduction?: boolean;
};
export type PaymentTemplate = {
  id: string;
  name: string;
  version: number;
  milestones: PaymentTerm[];
  status?: "active" | "archived";
  updatedAt?: string;
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
  status?: "active" | "archived";
  content: Pick<Quote, "rooms" | "lines" | "currency" | "discount" | "taxRate" | "inclusions" | "terms" | "exclusions" | "paymentTerms" | "presentation">;
};
export type QuoteRichTextNode = {
  type: string;
  text?: string;
  content?: QuoteRichTextNode[];
  marks?: { type: string }[];
  attrs?: { level?: number; start?: number };
};
export type QuoteCanvasElement = {
  id: string;
  type: "text" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  richText?: QuoteRichTextNode;
  src?: string;
  color?: string;
  fontSize?: number;
  align?: "left" | "center" | "right";
};
export type QuoteCanvasPage = {
  id: string;
  /** Custom pages have no system-generated commercial block beneath them. */
  kind?: "custom";
  title?: string;
  background?: string;
  backgroundImage?: string;
  elements: QuoteCanvasElement[];
};
export type QuotePresentation = {
  version: 1;
  template?: 'palm-reference-v1';
  details?: Partial<Record<'companyName' | 'clientName' | 'clientPhone' | 'clientEmail' | 'projectName' | 'location' | 'reference' | 'date' | 'preparedBy' | 'estimator' | 'manager' | 'clientLogo', string>>;
  /** Logical sections in reading order; scope expands into item pages. */
  pageOrder?: string[];
  hiddenPages?: string[];
  scopeColumns?: { hidden: string[]; custom: { id: string; name: string; values: Record<string, string> }[] };
  pageBackground: string;
  textColor: string;
  accentColor: string;
  pages: QuoteCanvasPage[];
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
  /** Client-facing finished-item size; not a substitute for verified site measurements. */
  dimensions?: {
    length?: number;
    height?: number;
    depth?: number;
    unit: "mm" | "cm" | "m" | "in" | "ft";
  };
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
  /** Client-visible alternate that is priced but excluded from the base total until selected. */
  optional?: boolean;
  /** Internal authorization evidence for a line with no confirmed scope or catalogue source. */
  manualReason?: string;
  /** Builder fields (plan §6.8): the line's area and work package, its kind, discount and tax. */
  kind?: string;
  description?: string;
  areaId?: string;
  fromAreaId?: string;
  workPackageId?: string;
  catalogItemId?: string;
  formula?: string;
  length?: number;
  width?: number;
  height?: number;
  count?: number;
  markupPercent?: number;
  discountKind?: "percent" | "amount";
  discountValue?: number;
  taxCode?: string;
  lineTaxRate?: number;
  optionGroup?: string;
  components?: Array<Record<string, unknown>>;
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
export type QuoteDecisionEvidence = {
  decision: "accept" | "changes" | "decline";
  /** Hash of the immutable, issued quotation the client reviewed. */
  quoteHash: string;
  /** Optional item IDs selected by the client for this decision. */
  selectedOptionLineIds: string[];
  baseTotal: number;
  optionsTotal: number;
  /** Present only when the quotation was accepted. */
  acceptedTotal?: number;
  decidedAt: string;
  decidedBy: string;
  note?: string;
};
export type Quote = {
  /** Separate client and payment rounds for Palm's design and main proposal. */
  round?: "design" | "main";
  qsEstimate?: {
    quoteHash: string;
    cost: number;
    sellingTotal: number;
    reviewedAt: string;
    reviewedById: string;
    reviewedBy: string;
  };
  rooms?: { id:string; name:string; catalog?:CatalogSelection }[];
  direction?:"addition"|"deduction";
  familyId?:string;
  id: string;
  number: number;
  kind: "quotation" | "variation";
  baselineId?: string;
  definitionBaseline?: { id: string; number: number; hash: string };
  /** Exact approved design files used to review and price this quotation. */
  designEvidence?: import("../projects/execution.types").ProjectDesignBaseline;
  status: QuoteStatus;
  title: string;
  cover?: {
    preparedFor: string; location: string; subtitle: string;
    coordinates?: { latitude: number; longitude: number; accuracy?: number };
    logo?: string; banner?: string; signature?: string;
    signerName?: string; signerTitle?: string; clientSignature?: boolean;
    taxLabel?: string; taxRegistration?: string;
  };
  /** Client-facing page styling. Prices and scope remain controlled fields. */
  presentation?: QuotePresentation;
  inclusions?: string;
  currency: string;
  validUntil: string;
  discount: number;
  taxRate: number;
  terms: string;
  exclusions: string;
  lines: QuoteLine[];
  /** Set by the builder: the workspace's pricing policy and the quote's discounts. */
  pricing?: { currencyDecimals: number; pricesIncludeTax: boolean; rounding: "line" | "document" };
  discounts?: Array<{ scope: "quote" | "area" | "trade"; target: string; kind: "percent" | "amount"; value: number | string; reason?: string }>;
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
  clientDecision?: QuoteDecisionEvidence;
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
  decisionRequest?: {
    ownerMembershipId: string;
    clientApproverGrantId: string;
    target: {
      type: "quotation" | "material";
      id: string;
      revision: number;
      label: string;
    };
    allowedChoices: Array<{ id: string; label: string }>;
    escalationMinutes: number | null;
    notificationPolicy: {
      remindersEnabled: boolean;
      channels: Array<"in_app" | "email" | "whatsapp">;
    };
    decision: null | {
      responseId: string;
      choiceId: string;
      choiceLabel: string;
      note: string;
      decidedAt: string;
      decidedBy: string;
      clientGrantId: string;
    };
  };
};
export type ClientChangeRequest = Omit<
  ChangeRequest,
  "control" | "decisionRequest"
> & {
  decisionRequest?: {
    target: NonNullable<ChangeRequest["decisionRequest"]>["target"];
    allowedChoices: Array<{ id: string; label: string }>;
    escalationMinutes: number | null;
    notificationPolicy: {
      remindersEnabled: boolean;
      channels: Array<"in_app" | "email" | "whatsapp">;
    };
    decision: null | {
      responseId: string;
      choiceId: string;
      choiceLabel: string;
      note: string;
      decidedAt: string;
      decidedBy: string;
    };
  };
};
export type Agreement = {
  files?: { id: string; name: string; mimeType: string; byteSize: number; hasPreview: boolean; addedAt: string; addedBy: string }[];
  quoteId: string;
  /** Exact accepted quotation snapshot bound to this agreement. */
  quoteHash?: string;
  selectedOptionLineIds?: string[];
  acceptedTotal?: number;
  /** Legal entity that owns the contract and every related finance record. */
  legalEntityId?: string;
  currency?: string;
  reference: string;
  terms: string;
  evidence: string;
  evidenceKind?: "operational" | "demonstration";
  status: "draft" | "executed";
  executedBy?: string;
  executedAt?: string;
};
export type CommercialFinanceContext = {
  legalEntityId: string;
  code: string;
  displayName: string;
  registeredName: string;
  countryCode: string;
  baseCurrency: string;
  currency: string;
  taxRegistrationNumber?: string;
  /** Tax fields are informational until a regional policy has been validated. */
  taxValidation: "unvalidated" | "validated";
  boundAt: string;
};
export type FinanceDocument = {
  id: string;
  kind: "invoice" | "credit_note";
  source: "provider" | "manual";
  legalEntityId: string;
  currency: string;
  number: string;
  total: number;
  status: string;
  paymentId?: string;
  creditId?: string;
  provider?: string;
  connectionId?: string;
  providerDocumentId?: string;
  evidence?: string;
  issuedAt: string;
  updatedAt: string;
};
export type FinanceReceipt = {
  id: string;
  paymentId: string;
  legalEntityId: string;
  currency: string;
  amount: number;
  source: "provider" | "manual";
  status:
    | "reported"
    | "provider_confirmed"
    | "finance_verified"
    | "rejected";
  reference: string;
  evidence: string;
  provider?: string;
  connectionId?: string;
  providerDocumentId?: string;
  reportedAt: string;
  reportedBy: string;
  verifiedAt?: string;
  verifiedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
};
export type FinanceAllocation = {
  id: string;
  receiptId: string;
  paymentId: string;
  legalEntityId: string;
  currency: string;
  amount: number;
  createdAt: string;
  createdBy: string;
  reversedAt?: string;
  reversalReason?: string;
};
export type ClientCredit = {
  id: string;
  quoteId: string;
  legalEntityId?: string;
  amount: number;
  currency: string;
  status: "pending" | "verified";
  reference: string;
  evidence: string;
  verifiedBy?: string;
  verifiedAt?: string;
};
export type Payment = {
  invoice?: { accountId?:string; lastError?:string; checkedAt?:string; connectionId:string; provider:string; id:string; number:string; customer:string; total:number; balance:number; currency:string; status:string; paymentUrl:string|null; refreshedAt:string };
  id: string;
  sourceQuoteId?: string;
  legalEntityId?: string;
  currency?: string;
  agreementReference?: string;
  trigger?: string;
  title: string;
  amount: number;
  dueDate: string;
  requiredForRelease: boolean;
  /** Finance-verified receipt is required before manufacturing starts. */
  requiredForProduction?: boolean;
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
  status: "submitted" | "pending_finance" | "pending_approval" | "approved" | "returned" | "rejected";
  commission: number;
  commissionLines?: import("./deal-submission").CommissionLine[];
  finalCommissionLines?: import("./deal-submission").CommissionLine[];
  paymentProofUrl?: string;
  financeNote?: string;
  financeReviewedAt?: string;
  financeReviewedBy?: string;
  financeReviewedById?: string;
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
  designEvidence?: import("../projects/execution.types").ProjectDesignBaseline;
  materialEvidence?: MaterialApproval[];
  agreementReference: string;
  paymentIds: string[];
  value: number;
  cost: number;
  margin: number;
  commission: number;
  commissionLines?: import("./deal-submission").CommissionLine[];
  paymentProofUrl?: string;
  opportunityId?: string;
  opportunityReference?: string | null;
  enquiryReference?: string | null;
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
  /** Palm's selected service path. Frozen when its first quotation is created. */
  palmFlow?: {
    scope: import("../projects/palm-flow-route").PalmFlowScope;
    selectedAt: string;
    selectedBy: string;
    /** Minimum design deposit from the workspace's design settings, frozen when the path is chosen. */
    designMinimumDeposit?: { amount: string; currency: string } | null;
  };
  /** First paid design round retained when a second, main round starts in the same Deal. */
  designRound?: {
    quoteId: string;
    agreement: Agreement;
    ownerReview: OwnerReview;
    dealFile: DealFile;
  };
  financeContext?: CommercialFinanceContext | null;
  financeDocuments?: FinanceDocument[];
  receipts?: FinanceReceipt[];
  allocations?: FinanceAllocation[];
  credits?: ClientCredit[];
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
  palmFlowEnabled?: boolean;
  enquiryType?: string | null;
  workspaceId: string;
  caseId: string;
  title: string;
  opportunityId?: string;
  opportunityStatus?: string;
  opportunityReference?: string | null;
  enquiryReference?: string | null;
  opportunityValue?: number | null;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  currency: string;
  data: CommercialData;
  contacts: PortalGrant[];
  canEdit: boolean;
  canApprove: boolean;
  canEstimate?: boolean;
  canApproveDeal?: boolean;
  canVerifyFinance: boolean;
  canOverridePrice?: boolean;
  canViewCosts?: boolean;
  canEditCosts?: boolean;
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
    | "manualReason"
  > & { variantLabel?: string })[];
  canDecide: boolean;
  expired: boolean;
};
export type ClientMaterialApproval = Omit<
  MaterialApproval,
  "approverId" | "decisionChallengeId"
> & { canDecide: boolean };
export type ClientCase = {
  credits?:Array<Omit<ClientCredit, "legalEntityId" | "verifiedBy" | "evidence">>;
  definitionBaseline?: {
    id: string;
    number: number;
    status: "awaiting_confirmation" | "confirmed" | "changes_requested" | "superseded";
    current: boolean;
    canDecide: boolean;
    publishedAt: string;
    snapshot: { definition: {
      brief: { goals?: string; propertyType?: string; location?: string; area?: string; timeline?: string; exclusions?: string };
      items: Array<{ id: string; title: string; roomName: string | null; scopeStatus: string; quantity: number | null; unit: string; specification: null | { refinedRequirement?: string; inclusions?: string; exclusions?: string; materials?: Array<{ application?: string; productName?: string; productCode?: string }> } }>;
    } };
    decision: null | { decision: "confirmed" | "changes_requested"; decisionBy: string; note: string; decidedAt: string };
  } | null;
  designs?:{id:string;title:string;type:string;number:number;status:string;name:string;mimeType:string;clientReviewExpiresAt?:string|null;roomName?:string|null;itemName?:string|null}[];
  materials?:ClientMaterialApproval[];
  id: string;
  title: string;
  customerName: string;
  quotes: ClientQuote[];
  requests: ClientChangeRequest[];
  agreement: Agreement | null;
  payments: Array<
    Omit<Payment, "legalEntityId" | "agreementReference" | "verifiedBy" | "invoice"> & {
      invoice?: Pick<
        NonNullable<Payment["invoice"]>,
        | "provider"
        | "number"
        | "balance"
        | "currency"
        | "status"
        | "paymentUrl"
        | "refreshedAt"
        | "lastError"
      >;
    }
  >;
  released: boolean;
  project?: import("../projects/execution.types").PublicProject;
  role: "viewer" | "approver";
};
