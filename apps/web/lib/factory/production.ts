// Imported by the mobile app (through lib/project-core/types.ts): relative imports only.

/** PLM-063: a production step, read from the work orders; the firm keeps the ones it uses and may name them its own way (empty: the standard word). */
export type ProductionStepKind = "scheduled" | "in_production" | "quality_check" | "ready";
export type ProductionStep = { kind: ProductionStepKind; label: string };
export type ProductionWindow = { start: string | null; end: string | null; days: number | null };
/** A project's production: its step (none before its first work order), planned against actual dates, and whether it's late or past the firm's target. */
export type ProductionSummary = {
  step: ProductionStep | null; planned: ProductionWindow; actual: ProductionWindow; late: boolean; overTarget: boolean; orders: number; ready: number; held: boolean;
};
export type ProductionRow = ProductionSummary & { projectId: string; reference: string; name: string; clientName: string; projectStatus: string };
export type ProductionState = { steps: ProductionStep[]; targetWeeks: number | null; today: string; projects: ProductionRow[] };

/** The production steps in their order. */
export const PRODUCTION_STEP_KINDS: ProductionStepKind[] = ["scheduled", "in_production", "quality_check", "ready"];
