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
};

export type SectionTotal = { key: string; gross: string; discount: string; net: string };
export type Pricing = {
  lines: Array<{ id: string; included: boolean; gross: string; lineDiscount: string; sectionDiscount: string; quoteDiscount: string; net: string; tax: string; total: string; cost: string | null }>;
  areas: SectionTotal[]; trades: SectionTotal[]; subtotal: string;
  discounts: { line: string; section: string; quote: string; total: string };
  net: string; tax: string; taxes: Array<{ rate: string; base: string; tax: string }>; total: string;
  cost: string | null; margin: string | null; optionalTotal: string;
};

export type QuoteDiscount = { scope: "quote" | "area" | "trade"; target: string; kind: "percent" | "amount"; value: string; reason: string };

export type BuilderState = {
  quote: { id: string; number: number; title: string; status: string; kind: string; round: string | null; currency: string; decimals: number; validUntil: string | null; taxRate: string; revision: number };
  settings: QuotationSettings;
  areas: Array<{ id: string; name: string }>;
  workPackages: Array<{ id: string; name: string }>;
  taxCodes: Array<{ code: string; label: string; rate: string; isDefault: boolean }>;
  lines: BuilderLine[];
  discounts: QuoteDiscount[];
  pricing: Pricing;
  canEdit: boolean; canEditCosts: boolean; canViewCosts: boolean;
};

export type CatalogHit = { id: string; code: string; name: string; itemType: string; unitCode: string; categoryName: string | null; description: string | null; rate: string | null; hasBuildUp: boolean };

export type LineOp =
  | { op: "upsert"; line: Partial<Omit<BuilderLine, "components">> & { id: string; version?: number; components?: Array<Partial<BuildUpRow>> } }
  | { op: "catalog"; itemId: string; line: Partial<BuilderLine> & { id: string; version?: number } }
  | { op: "delete"; id: string; version: number }
  | { op: "reorder"; ids: string[] };

export const GENERAL = "general";
export const NO_TRADE = "none";
