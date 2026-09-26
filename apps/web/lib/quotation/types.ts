/** The quotation builder's state, as the API returns it (plan §6.8). Money and quantities are decimal strings. */
export type LineKind = "item" | "service" | "allowance" | "client_supplied" | "relocate" | "dismantle" | "remove_store" | "dispose";
export type QuoteView = "area" | "trade" | "area_trade";

export type QuotationSettings = {
  defaultView: QuoteView; pricesIncludeTax: boolean; rounding: "line" | "document"; defaultMarkupPercent: string;
  marginFloorPercent: string | null; discountApprovalPercent: string | null; validityDays: number; internalReview: boolean;
  priceBookId: string | null; version: number;
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
  rate: string; unitCost: string | null; markupPercent: string | null; pricingMode: "rate" | "build_up";
  discountKind: "percent" | "amount" | null; discountValue: string | null; taxCode: string | null; taxRate: string | null;
  optional: boolean | null; optionGroup: string | null; note: string; catalogItemId: string | null;
  catalogSnapshot: { name?: string; code?: string; priceReason?: string | null } | null; buildUpComplete: boolean | null;
  updatedAt: string; updatedByName: string | null; components: BuildUpRow[];
  imageAssetId: string | null; catalogImageId: string | null;
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
  quote: {
    id: string; number: number; title: string; status: string; kind: string; round: string | null; currency: string; decimals: number; validUntil: string | null; taxRate: string; revision: number;
    paymentTerms: PaymentMilestone[]; approvedBy: string | null;
    clientDecision: { decision: string; decidedBy: string; decidedAt: string; note: string; method: string | null; recordedBy: string | null } | null;
  };
  family: Array<{ id: string; number: number; status: string; total: string; createdAt: string | null }>;
  flow: { internalReview: boolean; reviewAction: "approve" | "qs_approve"; canReview: boolean; canRecordDecision: boolean };
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
  document: QuoteDocument;
  brand: { name: string; logo: string; primaryColor: string; accentColor: string };
  client: { name: string; project: string; address: string | null };
  canEdit: boolean; canEditCosts: boolean; canViewCosts: boolean;
};

export type QuoteCheck = { code: string; values?: Record<string, string>; lineId?: string; tone: "danger" | "warning" };

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
  | { op: "reorder"; ids: string[] };

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
  itemsView: QuoteView; itemsDetail: "lines" | "totals"; showRates: boolean; showDescriptions: boolean; showImages: boolean; coverAssetId: string | null;
};

export type TemplateLine = {
  title: string; description: string; unit: string; quantity: string; rate: string; unitCost: string | null; kind: string; formula: string | null;
  length: string | null; width: string | null; height: string | null; count: string | null; markupPercent: string | null; pricingMode: "rate" | "build_up";
  catalogItemId: string | null; workPackageId: string | null; optional: boolean; components: Array<Partial<BuildUpRow>>; areaName: string | null;
};
export type QuoteTemplate = { id: string; name: string; lines: TemplateLine[] };
