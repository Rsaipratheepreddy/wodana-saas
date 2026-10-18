/** The quotation builder's state, as the API returns it (plan §6.8). Money and quantities are decimal strings. */
export type LineKind = "item" | "service" | "allowance" | "client_supplied" | "relocate" | "dismantle" | "remove_store" | "dispose";
export type QuoteView = "area" | "trade" | "area_trade";

export type QuotationSettings = {
  defaultView: QuoteView; pricesIncludeTax: boolean; rounding: "line" | "document"; defaultMarkupPercent: string;
  marginFloorPercent: string | null; discountApprovalPercent: string | null; validityDays: number; internalReview: boolean;
  priceBookId: string | null; decisionReminderDays: number[]; expiryWarningDays: number; defaultPaymentTemplateId: string | null;
  /** R3: how markup is shown to the client. */
  markupDisclosure?: "all_inclusive" | "disclosed_markup" | "fee_based";
  /** PLM-082: a QS confirms the pricing before a quotation goes to the client (the master switch). */
  qsReview?: boolean;
  /**
   * Every quotation; only where the rules apply (a BOQ order, or lines in a marked work package or catalogue kind); or
   * only quotations with such lines (a BOQ order alone sends nothing).
   */
  qsReviewScope?: "all" | "rules" | "lines";
  /** Catalogue kinds whose lines need the QS under the rules. */
  qsReviewItemTypes?: string[];
  /** §6.20: variations follow the QS rules, or never go to the QS. */
  qsVariations?: "rules" | "never";
  /** §6.20: the size (either way) from which a variation always goes to the QS; null for none. */
  qsVariationThreshold?: string | null;
  /** PLM-147: free value engineering rounds per job; past them a round is chargeable. Null: no limit. */
  valueEngineeringFreeRounds?: number | null;
  /** §0.3 P8: the job-team roles whose holder on the job gives manager approval; empty: anyone who approves quotes. */
  approvalTeamRoles?: string[];
  /** How many days a signing link stays open (R8). */
  signingLinkDays?: number;
  /** PLM-106: the firm's intro deck link. */
  introDeckUrl?: string | null;
  version: number;
};

export type BuildUpRow = {
  id: string; kind: "material" | "finish" | "hardware" | "labour" | "other"; catalogItemId: string | null; name: string;
  quantityFormula: string | null; quantity: string; unit: string; unitCost: string | null; rate: string | null;
  wastePercent: string | null; suppliedByClient: boolean;
  worked: { quantity: string; amount: string; error: string | null } | null;
};

export type BuilderLine = {
  id: string; position: number; version: number; kind: LineKind; areaId: string | null; fromAreaId: string | null; workPackageId: string | null;
  title: string; description: string; unit: string; quantity: string; formula: string | null; formulaError: string | null;
  length: string | null; width: string | null; height: string | null; count: string | null; dimensionUnit: string | null;
  /** What it's made of, as written on the quote. */
  material: string;
  /** Its values in the firm's own columns, by column id. */
  values: Record<string, string>;
  rate: string; unitCost: string | null; markupPercent: string | null; pricingMode: "rate" | "build_up";
  discountKind: "percent" | "amount" | null; discountValue: string | null; taxCode: string | null; taxRate: string | null;
  optional: boolean | null; optionGroup: string | null; note: string; catalogItemId: string | null;
  catalogSnapshot: { name?: string; code?: string; priceReason?: string | null } | null; buildUpComplete: boolean | null;
  updatedAt: string; updatedByName: string | null; components: BuildUpRow[];
  imageAssetId: string | null; catalogImageId: string | null;
  /** On a variation: what the line does to the agreed scope (add, remove, move) and the live BOQ line it changes. */
  changeOp?: "add" | "omit" | "move" | null; boqLineId?: string | null;
  /** The client requirement this line covers (requirement trace). */
  scopeId?: string | null;
};

export type SectionTotal = { key: string; gross: string; discount: string; net: string };
export type Pricing = {
  lines: Array<{ id: string; included: boolean; gross: string; lineDiscount: string; sectionDiscount: string; quoteDiscount: string; net: string; tax: string; total: string; cost: string | null }>;
  areas: SectionTotal[]; trades: SectionTotal[]; subtotal: string;
  discounts: { line: string; section: string; quote: string; total: string };
  net: string; tax: string; taxes: Array<{ rate: string; base: string; tax: string }>; total: string;
  cost: string | null; margin: string | null; optionalTotal: string;
};

export type PaymentMilestone = { id: string; title: string; percent: number; trigger: string; requiredForRelease: boolean; requiredForProduction?: boolean };

export type QuoteDiscount = { scope: "quote" | "area" | "trade"; target: string; kind: "percent" | "amount"; value: string; reason: string };

export type BuilderState = {
  /** The firm's own quote columns, in order. */
  columns?: QuoteColumn[];
  /** The terms and exclusions the proposal prints. */
  proposal?: { terms: string; exclusions: string };
  /** The unit sizes are written in unless a line says otherwise ("cm", "in"). */
  sizeUnit?: string;
  /** Choices for the unit and material cells. */
  units?: Array<{ code: string; label: string }>; materials?: string[];
  quote: {
    id: string; number: number; title: string; status: string; kind: string; round: string | null; currency: string; decimals: number; validUntil: string | null; taxRate: string; revision: number;
    paymentTerms: PaymentMilestone[]; approvedBy: string | null;
    /** The quotation number (from settings, on first sending); null before. */
    reference?: string | null;
    /** Guide M: the estimate proposal's reference (the quotation number with EST, "rev n" for a revision); null before sending. */
    estimateReference?: string | null;
    /** The QS who priced it, and the job's lead designer. */
    estimator?: string | null; designer?: string | null;
    clientDecision: { decision: string; decidedBy: string; decidedAt: string; note: string; method: string | null; recordedBy: string | null; evidence?: { id: string; name: string } | null } | null;
  };
  family: Array<{ id: string; number: number; status: string; total: string; createdAt: string | null }>;
  /** Whether this person may extend a sent or expired quote's validity (Q-7). */
  canEditValidity?: boolean;
  flow: { internalReview: boolean; reviewAction: "approve" | "qs_approve"; canReview: boolean; canRecordDecision: boolean; decisionEvidenceRequired?: boolean };
  paymentTemplates: Array<{ id: string; name: string; milestones: PaymentMilestone[] }>;
  settings: QuotationSettings;
  areas: Array<{ id: string; name: string }>;
  workPackages: Array<{ id: string; name: string }>;
  taxCodes: Array<{ code: string; label: string; rate: string; isDefault: boolean }>;
  lines: BuilderLine[];
  discounts: QuoteDiscount[];
  pricing: Pricing;
  checks: QuoteCheck[];
  me: string;
  /** Whether the assistant can be used now, and if not why: no model key, switched off, or no access. */
  assistant?: { available: boolean; reason: "not_set_up" | "off" | "no_access" | null; canTurnOn: boolean };
  document: QuoteDocument;
  brand: { name: string; logo: string; primaryColor: string; accentColor: string };
  client: { name: string; project: string; address: string | null };
  canEdit: boolean; canEditCosts: boolean; canViewCosts: boolean;
  /** Can change the lines' prices (rate, cost, markup, build-up): whoever edits the quote, and the QS while it is with them. */
  canPrice?: boolean;
  /** A change request's variation: its change moves it on (approval, sending, the client's decision). */
  changeRequest?: { id: string; reference: string; status: string; projectId: string | null } | null;
  /** The project this quote belongs to once it has started, and the sealed name a variation got when applied. */
  project?: { id: string; reference: string; appliedAs: string | null } | null;
  /** The client's requirements and the decision on each: included, excluded, later, not possible, undecided. */
  requirements?: Array<{ id: string; title: string; roomName: string | null; priority: string; source: string; status: string; note: string }>;
  /** PLM-146: the finishes to price from, who may edit the material column, and whether this quotation waits for the final specification. */
  finishes?: QuoteFinishes;
  canEditMaterial?: boolean;
  specification?: { applies: boolean; final: boolean; problem: string | null; budgetRange: { note: string; markedByName: string | null; markedAt: string } | null } | null;
  /** PLM-146: this person may mark the main quotation a budget range (until it is sent, also once approved). */
  canMarkBudgetRange?: boolean;
};

/** A line of the project's live BOQ that a variation can remove, move or replace. */
export type BoqPick = { id: string; title: string; unit: string; quantity: string; net: string; areaId: string | null; areaName: string | null };

/** A check about one line names it (`lineId`); one about an undecided requirement names the first to decide (`requirementId`). */
export type QuoteCheck = { code: string; values?: Record<string, string>; lineId?: string; requirementId?: string; tone: "danger" | "warning" };

export type AiChange = {
  key: string; action: "add" | "update" | "move" | "remove"; lineId: string | null; lineVersion: number | null; lineTitle: string | null;
  catalogItemId: string | null; catalogName: string | null; priced: boolean;
  fields: { title?: string; areaId?: string | null; fromAreaId?: string | null; workPackageId?: string | null; kind?: LineKind; quantity?: string; unit?: string; formula?: string | null; length?: string | null; width?: string | null; height?: string | null; count?: string | null };
  areaName: string | null; unknownArea: string | null; why: string;
};
export type AiProposal = { summary: string; changes: AiChange[] };

export type CatalogHit = { id: string; code: string; name: string; itemType: string; unitCode: string; categoryName: string | null; description: string | null; rate: string | null; hasBuildUp: boolean; imageId: string | null };

export type LineOp =
  | { op: "upsert"; line: Partial<Omit<BuilderLine, "components">> & { id: string; version?: number; components?: Array<Partial<BuildUpRow>> } }
  | { op: "catalog"; itemId: string; line: Partial<BuilderLine> & { id: string; version?: number } }
  | { op: "delete"; id: string; version: number }
  | { op: "reorder"; ids: string[] }
  | { op: "change"; change: "omit" | "move" | "replace"; id: string; boqLineId: string; quantity?: string; areaId?: string | null; replacementId?: string }
  /** PLM-146: a line priced from a finish of the schedule (null unties it); its material column takes the designer's specification. */
  | { op: "finish"; lineId: string; entryId: string | null; version?: number };

/** PLM-146: the finishes the designer sent to QS, and the lines priced from them (the old price flagged when a finish changed since). */
export type QuoteFinishes = {
  sent: { number: number; sentAt: string; sentByName: string | null } | null;
  entries: Array<{ id: string; title: string; roomName: string | null; categoryLabel: string | null; specification: string; versionId: string | null; number: number | null; snapshots: number; sent: boolean }>;
  links: Array<{ lineId: string; entryId: string; stale: boolean; removed: boolean }>;
};

export const GENERAL = "general";
export const NO_TRADE = "none";

export type QuoteAnchor = { kind: "line" | "area" | "trade" | "total"; key: string; field?: string | null };
export type QuoteThread = {
  id: string; anchorKind: QuoteAnchor["kind"]; anchorKey: string; anchorField: string | null; status: "open" | "resolved"; version: number;
  createdBy: string; createdByName: string; createdAt: string; resolvedByName: string | null; resolvedAt: string | null;
  messages: Array<{ id: string; body: string; mentions: string[]; createdBy: string; createdByName: string; createdAt: string }>;
};
export type QuotePerson = { userId: string; name: string; lineId: string | null; field: string | null };

export type DocumentStyleId = "atelier" | "minimal" | "noir" | "terrazzo" | "nordic" | "botanical" | "coastal" | "monochrome" | "heritage" | "linen" | "studio" | "marble";
export type DocumentSection = "cover" | "intro" | "summary" | "items" | "payments" | "terms" | "acceptance";
export type QuoteDocument = {
  style: DocumentStyleId; accent: string | null; sections: Record<DocumentSection, boolean>;
  title: string; subtitle: string; intro: string; terms: string; exclusions: string;
  /** PLM-045: what changed in this revision and why; older documents have none. */
  changeNote?: string;
  itemsView: QuoteView; itemsDetail: "lines" | "totals"; showRates: boolean; showDescriptions: boolean; showImages: boolean; coverAssetId: string | null;
};

export type TemplateLine = {
  title: string; description: string; unit: string; quantity: string; rate: string; unitCost: string | null; kind: string; formula: string | null;
  length: string | null; width: string | null; height: string | null; count: string | null; markupPercent: string | null; pricingMode: "rate" | "build_up";
  catalogItemId: string | null; workPackageId: string | null; optional: boolean; components: Array<Partial<BuildUpRow>>; areaName: string | null;
};
export type QuoteTemplate = { id: string; name: string; lines: TemplateLine[] };

/** One of the firm's own quote columns ("Brand", "Lead time"); every quote shows it. */
export type QuoteColumn = { id: string; name: string; kind: "text" | "number"; showInProposal: boolean; version: number };
