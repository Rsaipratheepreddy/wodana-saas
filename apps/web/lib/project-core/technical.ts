import type { ReadinessCell } from "@/lib/readiness/types";

/**
 * The technical handover pack (PLM-165) and each line's requirements (PLM-166), as business-core reads them
 * (services/business-core/src/project-core/project-technical-handover.ts, project-factory-requirements.ts).
 */
export const COMPONENT_TYPES = ["board", "fabric", "foam", "hardware", "labour", "other"] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];
export const REQUIREMENT_ITEM_TYPES = ["board", "fabric", "foam", "hardware", "other"] as const;
export type RequirementItemType = (typeof REQUIREMENT_ITEM_TYPES)[number];

export const HANDOVER_ITEMS = ["picture", "size", "materials", "selection"] as const;
export type HandoverItem = (typeof HANDOVER_ITEMS)[number];
export type HandoverStatus = "draft" | "handed_over" | "accepted";
export type RequirementState = "verified" | "confirmed" | "pending" | "needs_requirements" | "not_needed";

export type ExplodedComponent = { componentItemId: string; label: string; unitCode: string; formula: string; componentType: ComponentType; perAssembly: string; quantity: string; purchaseQuantity: string; hours: string | null };
export type LineRequirements =
  | { state: "none" }
  | { state: "unverified"; components: number }
  | { state: "needs_measurements"; problem: string }
  | { state: "verified"; lines: ExplodedComponent[]; labourHours: string; verified: { at: string; byName: string | null } };

export type RequirementItem = { id: string; componentType: RequirementItemType; name: string; quantity: string; unit: string; catalogItemId: string | null; note: string };
export type FactoryRequirement = {
  id: string; lineId: string; status: "pending" | "confirmed"; labourHours: string | null; notes: string; items: RequirementItem[];
  confirmedByName: string | null; confirmedAt: string | null; updatedByName: string | null; updatedAt: string; version: number;
};
export type LineRequirementRow = {
  lineId: string; title: string; quantity: string; unit: string; areaName: string | null; catalogItemId: string | null; catalogId: string | null; code: string | null;
  size: string | null; made: boolean; recipe: LineRequirements; factory: FactoryRequirement | null; state: RequirementState;
};

export type Waiver = { reason: string; byName: string | null; at: string };
export type HandoverRow = {
  lineId: string; title: string; code: string | null; quantity: string; unit: string; areaName: string | null; catalogItemId: string | null; catalogId: string | null;
  catalogImageId: string | null; imageAssetId: string | null; size: string | null;
  drawing: { needed: boolean; reason: "bespoke" | "made_to_order" | "no_catalogue_drawing" | "catalogue_drawing"; overridden: boolean } | null;
  requirements: RequirementState;
  cells: Record<HandoverItem, ReadinessCell>;
  waivers: Partial<Record<HandoverItem, Waiver>>;
  missing: HandoverItem[];
};

export type TechnicalHandover = {
  status: HandoverStatus; version: number;
  handedOver: { byName: string | null; at: string; note: string } | null;
  accepted: { byName: string | null; at: string } | null;
  items: readonly HandoverItem[]; rows: HandoverRow[]; missing: number; requirements: LineRequirementRow[];
  caseId: string | null; projectVersion: number;
  canHandOver: boolean; canAccept: boolean; canWaive: boolean; canSaveRequirements: boolean; canConfirmRequirements: boolean;
};
