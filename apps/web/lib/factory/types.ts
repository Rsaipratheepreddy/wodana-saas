import type { StockLocation } from "@/lib/purchasing/types";

export type WorkOrderStatus = "planned" | "released" | "in_production" | "ready" | "on_hold" | "cancelled" | "short_closed";
export type FactorySettings = { requireDrawing: boolean; requirePayment: boolean; requireMaterials: boolean; requireCheck: boolean; version: number };
export type Workcenter = { id: string; name: string; hoursPerDay: string | null; active: boolean };

/** A scope line made in our factory: how much is on work orders and what's left to plan. */
export type MakeLine = {
  lineId: string; projectId: string; projectReference: string; projectName: string; packageId: string | null; packageName: string | null;
  title: string; specification: string; unit: string; quantity: string; planned: string; left: string; suggestedStart: string | null; suggestedEnd: string | null;
};

export type WorkOrderRow = {
  id: string; number: number; projectId: string; projectReference: string; projectName: string; packageId: string | null; packageName: string | null; boqLineId: string;
  title: string; specification: string; quantity: string; unit: string; status: WorkOrderStatus; workcenterId: string | null; workcenterName: string | null;
  plannedStart: string | null; plannedEnd: string | null; notes: string; version: number;
  /** Good output approved, waiting for approval, passed its check (ready), approved but not checked yet, still to make, scrapped. */
  made: string; pending: string; passed: string; toCheck: string; left: string; scrapped: string;
  /** Its scope line now: removed by a variation, or how much more its work orders hold than the line needs. */
  lineStatus: "active" | "omitted"; lineQuantity: string; scopeOver: string;
  /** Why it's on hold: put on hold, or stopped because its drawing changed (someone else lets it go on). */
  holdKind: "manual" | "drawing" | null;
  /** The hours it takes, spread over its working days; the run it's part of. */
  plannedHours: string | null; batchId: string | null; batchNumber: number | null; batchName: string | null;
};

/** Work orders from any projects run together on a workcenter and day. */
export type Batch = { id: string; number: number; name: string; workcenterId: string | null; workcenterName: string | null; plannedOn: string | null; status: "open" | "started" | "closed";
  orders: number; projects: string[]; version: number };
/** Hours booked on each workcenter each working day, and the days over what it can do. */
export type ScheduleState = {
  from: string; to: string; days: string[]; workcenters: Workcenter[]; orders: WorkOrderRow[]; load: Record<string, Record<string, number>>;
  conflicts: Array<{ workcenterId: string; workcenterName: string; date: string; hours: number; capacity: number; orders: string[] }>;
};

export type ReleaseCheck = { key: "running" | "scope" | "drawing" | "payment" | "materials" | "schedule"; passed: boolean; missing: string; detail?: string[] };
export type OutputReport = {
  id: string; good: string; scrap: string; scrapReason: string; note: string; status: "pending" | "approved" | "refused"; reportedBy: string; reportedByName: string; reportedAt: string;
  decidedByName: string | null; decisionNote: string;
};
export type QualityCheck = { id: string; passed: string; failed: string; failReason: string; checkedByName: string; checkedAt: string };
export type WorkOrderEvent = { id: string; kind: string; detail: Record<string, unknown>; byName: string; at: string };

export type FactoryRights = { canManage: boolean; canReport: boolean; canApprove: boolean; canIssue: boolean };

/** A material a work order uses: needed, issued (less returned) and what's on hand; a swap waits for someone else. */
export type WorkOrderMaterial = {
  id: string; itemId: string; itemName: string; unit: string; materialItemId: string | null; quantity: string; status: "active" | "pending" | "replaced" | "refused" | "removed";
  replacesId: string | null; replacesName: string | null; reason: string; requestedBy: string; requestedByName: string; decidedByName: string | null; decisionNote: string;
  issued: string; issuedValue: string; projectOnHand: string; freeOnHand: string;
};
export type FactoryState = FactoryRights & { toMake: MakeLine[]; orders: WorkOrderRow[]; workcenters: Workcenter[]; batches: Batch[] };
export type WorkOrderState = FactoryRights & {
  order: WorkOrderRow & { drawingRef: string; drawingApprovedAt: string | null; drawingApprovedByName: string | null; holdReason: string | null; closeReason: string | null;
    closedAt: string | null; releasedAt: string | null; readyAt: string | null };
  reports: OutputReport[]; checks: QualityCheck[]; events: WorkOrderEvent[]; settings: FactorySettings; releaseChecks: ReleaseCheck[]; workcenters: Workcenter[]; me: string;
  materials: WorkOrderMaterial[]; materialCost: string; currency: string; projectMaterials: Array<{ id: string; name: string; unit: string }>; canSuggest: boolean; places: StockLocation[];
  /** Steps done by suppliers on its goods: out while their service order still waits for something. */
  operations: Array<{ id: string; name: string; supplierName: string; orderId: string; orderNumber: string; orderStatus: string; orderLineId: string; quantity: string; back: string; out: boolean }>;
  suppliers: Array<{ id: string; name: string; approved: boolean }>;
  /** Moves of its made goods to the project's site, and what's still at the factory to send. */
  dispatches: Array<{ id: string; number: number; status: "in_transit" | "received" | "cancelled"; sentOn: string; quantity: string; received: string | null; short: boolean }>;
  atFactory: string;
};
export type FactorySettingsState = { settings: FactorySettings; workcenters: Workcenter[]; canManage: boolean };
