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
};

export type ReleaseCheck = { key: "running" | "drawing" | "payment" | "materials" | "schedule"; passed: boolean; missing: string; detail?: string[] };
export type OutputReport = {
  id: string; good: string; scrap: string; scrapReason: string; note: string; status: "pending" | "approved" | "refused"; reportedBy: string; reportedByName: string; reportedAt: string;
  decidedByName: string | null; decisionNote: string;
};
export type QualityCheck = { id: string; passed: string; failed: string; failReason: string; checkedByName: string; checkedAt: string };
export type WorkOrderEvent = { id: string; kind: string; detail: Record<string, unknown>; byName: string; at: string };

export type FactoryRights = { canManage: boolean; canReport: boolean; canApprove: boolean };
export type FactoryState = FactoryRights & { toMake: MakeLine[]; orders: WorkOrderRow[]; workcenters: Workcenter[] };
export type WorkOrderState = FactoryRights & {
  order: WorkOrderRow & { drawingRef: string; drawingApprovedAt: string | null; drawingApprovedByName: string | null; holdReason: string | null; closeReason: string | null;
    closedAt: string | null; releasedAt: string | null; readyAt: string | null };
  reports: OutputReport[]; checks: QualityCheck[]; events: WorkOrderEvent[]; settings: FactorySettings; releaseChecks: ReleaseCheck[]; workcenters: Workcenter[]; me: string;
};
export type FactorySettingsState = { settings: FactorySettings; workcenters: Workcenter[]; canManage: boolean };
