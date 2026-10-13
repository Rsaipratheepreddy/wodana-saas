import type { StockLocation } from "@/lib/purchasing/types";
import type { ProductionStep } from "./production";

export type WorkOrderStatus = "planned" | "released" | "in_production" | "ready" | "on_hold" | "cancelled" | "short_closed";
export type FactorySettings = {
  requireDrawing: boolean; requirePayment: boolean; requireMaterials: boolean; requireCheck: boolean; version: number;
  /** PLM-063: the production steps the firm keeps (in their order) with its own words, and its internal production target in weeks. */
  productionSteps?: ProductionStep[]; productionWeeks?: number | null;
  /** PLM-067: days before the latest planned ready date of a payment stage's work orders that the client is reminded to pay. */
  balanceReminderDays?: number;
  /**
   * PLM-150: design inspections of made items: on or off, the stages kept with the firm's names, the trades that need them
   * (none: every made item), the project role that inspects (and the role that does on the listed design packages), and
   * the working days to do it.
   */
  inspectionsEnabled?: boolean; inspectionStages?: InspectionStage[]; inspectionWorkPackages?: string[]; inspectorRole?: string; directorRole?: string | null;
  directorPackages?: string[]; inspectionDays?: number;
};

/** PLM-150: a design inspection stage: in raw material before the final finish, or after finishing (before dispatch). */
export type InspectionStageKind = "raw" | "final";
export type InspectionStage = { kind: InspectionStageKind; label: string };
/** Where a stage of an item stands: not needed, to mark ready for, with the design team, snags to fix, or passed. */
export type InspectionStep = "not_needed" | "to_request" | "due" | "snags" | "passed";
export type OrderInspection = { raw: InspectionStep; final: InspectionStep; dueId: string | null; dueStage: InspectionStageKind | null; dueOn: string | null; latestId: string | null;
  /** Who the open round is with (null: nobody on the team inspects), and the snags the factory still has to fix. */
  inspectorName?: string | null; openSnags: number };
/** One round of an inspection as a work order lists it. */
export type InspectionRound = { id: string; stage: InspectionStageKind; round: number; status: "due" | "passed" | "failed" | "cancelled"; dueOn: string; resultAt: string | null;
  resultByName: string | null; inspectorName?: string | null; comments: string; openSnags?: number; snags: number };
/** An open inspection (with the design team): who, which item, which project, by when (the design calendar reads these, PLM-152). */
export type OpenInspection = { id: string; workOrderId: string; order: string; item: string; projectId: string; projectReference: string; projectName: string;
  stage: InspectionStageKind; stageLabel: string; round: number; inspectorMembershipId: string | null; inspectorName: string | null; inspectorRole: string | null;
  dueOn: string; requestedAt: string; overdue: boolean };
/** One round, as its record page shows it. */
export type InspectionState = {
  row: { id: string; workOrderId: string; projectId: string; stage: InspectionStageKind; round: number; status: "due" | "passed" | "failed" | "cancelled"; dueOn: string; requestedAt: string;
    requestedByName: string; requestedByMe: boolean; inspectorMembershipId: string | null; inspectorName: string | null; inspectorRole: string | null; resultByName: string | null;
    resultAt: string | null; comments: string; version: number; number: number; title: string; specification: string; quantity: string; unit: string; orderStatus: WorkOrderStatus;
    projectReference: string; projectName: string; projectStatus: string };
  photos: Array<{ id: string; name: string; byName: string; at: string }>;
  snags: Array<{ id: string; number: number; title: string; severity: "minor" | "major" | "critical"; status: string; dueDate: string | null; assigneeName: string | null; inspectionId: string }>;
  rounds: InspectionRound[]; stages: InspectionStage[]; managers: string[];
  canRecord: boolean; why: string | null; canSeeFactory: boolean;
};

export type { ProductionRow, ProductionState, ProductionStep, ProductionStepKind, ProductionSummary, ProductionWindow } from "./production";

/** PLM-061: a sample the design team asked the factory for, needed by a day (before the material selection appointment when one is booked). */
export type SampleRequest = {
  id: string; number: number; caseId: string; caseReference: string | null; clientName: string; projectId: string | null; projectReference: string | null;
  title: string; note: string; dueOn: string; status: "requested" | "ready" | "cancelled"; requestedBy: string; requestedByName: string; requestedAt: string;
  readyNote: string; readyByName: string | null; readyAt: string | null; cancelReason: string; version: number; appointmentOn: string | null;
};
export type SamplesState = {
  samples: SampleRequest[]; today: string; appointmentOn: string | null; suggestedDueOn: string; me: string;
  canRequest: boolean; canMake: boolean; canWithdrawAny: boolean;
};
export type Workcenter = { id: string; name: string; hoursPerDay: string | null; active: boolean };
/** A workcenter's hourly rate from a date: hours reported on a day cost the rate set from the latest date on or before it. */
export type WorkcenterRate = { id: string; workcenterId: string; from: string; rate: string; currency: string; version: number };

/** A scope line made in our factory: how much is on work orders and what's left to plan. */
export type MakeLine = {
  lineId: string; projectId: string; projectReference: string; projectName: string; packageId: string | null; packageName: string | null;
  title: string; specification: string; unit: string; quantity: string; planned: string; left: string; suggestedStart: string | null; suggestedEnd: string | null;
  /** Its project is running, or on hold (nothing is planned for it until it runs again). */
  projectStatus?: "active" | "on_hold";
};

/** The one step a work order waits for, and whether it's the viewer's to do. */
export type WorkOrderNext = "fix" | "release" | "start" | "approve" | "check" | "report" | "send" | "resume" | "decide_drawing"
  | "request_inspection" | "inspection" | "snags" | null;

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
  /** Passed goods the site sent back to be made again (already taken off passed). */
  reworked?: string;
  /** The approved design revision it's made to, and a newer revision's number when there is one. */
  drawingVersionId?: string | null; drawingNewer?: number | null;
  /** In lists: why a planned work order can't be released, what's made and still at the factory, and its next step (mine when it's the viewer's to do). */
  blocked?: Array<{ key: ReleaseCheck["key"]; missing: string }>; atFactory?: string; next?: WorkOrderNext; mine?: boolean;
  /** PLM-150: where its design inspections stand (none when it needs none). */
  inspection?: OrderInspection | null;
};

/** Work orders from any projects run together on a workcenter and day. */
export type Batch = { id: string; number: number; name: string; workcenterId: string | null; workcenterName: string | null; plannedOn: string | null; status: "open" | "started" | "closed";
  orders: number; projects: string[]; version: number };
/** Hours booked on each workcenter each working day, and the days over what it can do. */
export type ScheduleState = {
  from: string; to: string; days: string[]; workcenters: Workcenter[]; orders: WorkOrderRow[]; load: Record<string, Record<string, number>>;
  conflicts: Array<{ workcenterId: string; workcenterName: string; date: string; hours: number; capacity: number; orders: string[] }>;
};

export type ReleaseCheck = { key: "running" | "scope" | "client_drawings" | "technical_measure" | "drawing" | "payment" | "materials" | "schedule"; passed: boolean; missing: string; detail?: string[] };
export type OutputReport = {
  id: string; good: string; scrap: string; scrapReason: string; note: string; status: "pending" | "approved" | "refused"; reportedBy: string; reportedByName: string; reportedAt: string;
  decidedByName: string | null; decisionNote: string;
  /** The hours it took, when reported: costed at the workcenter's hourly rate once approved. */
  hours: string | null;
};
/** A quality check: what passed and failed (and why), who checked it, its note and its photo. */
export type QualityCheck = { id: string; passed: string; failed: string; failReason: string; checkedByName: string; checkedAt: string; note?: string; photoId?: string | null };
export type WorkOrderEvent = { id: string; kind: string; detail: Record<string, unknown>; byName: string; at: string };

export type FactoryRights = { canManage: boolean; canReport: boolean; canApprove: boolean; canIssue: boolean };

/** A material a work order uses: needed, issued (less returned) and what's on hand; a swap waits for someone else. */
export type WorkOrderMaterial = {
  id: string; itemId: string; itemName: string; unit: string; materialItemId: string | null; quantity: string; status: "active" | "pending" | "replaced" | "refused" | "removed";
  replacesId: string | null; replacesName: string | null; reason: string; requestedBy: string; requestedByName: string; decidedByName: string | null; decisionNote: string;
  issued: string; issuedValue: string; projectOnHand: string; freeOnHand: string;
};
export type FactoryState = FactoryRights & { toMake: MakeLine[]; orders: WorkOrderRow[]; workcenters: Workcenter[]; batches: Batch[]; requireCheck?: boolean; today?: string;
  /** PLM-150: the firm's names for its design inspections. */
  inspectionStages?: InspectionStage[] };
/** Goods the site refused and sent back to be made again. */
export type WorkOrderRework = { id: string; quantity: string; reason: string; source: "site" | "factory"; at: string; byName: string };
export type WorkOrderState = FactoryRights & {
  order: WorkOrderRow & { drawingRef: string; drawingApprovedAt: string | null; drawingApprovedByName: string | null; holdReason: string | null; closeReason: string | null;
    closedAt: string | null; releasedAt: string | null; readyAt: string | null;
    /** The order-ready date, and the client's payment stage that falls due when it's ready. */
    readyOn?: string | null; readyPaymentId?: string | null };
  reports: OutputReport[]; checks: QualityCheck[]; events: WorkOrderEvent[]; settings: FactorySettings; releaseChecks: ReleaseCheck[]; workcenters: Workcenter[]; me: string;
  materials: WorkOrderMaterial[]; materialCost: string; currency: string;
  /** The project's material list, with this work order's share of those used only on its line. */
  projectMaterials: Array<{ id: string; name: string; unit: string; suggested?: string | null }>;
  /** Something on the project's list isn't on this work order yet. */
  canSuggest: boolean; places: StockLocation[];
  /** Steps done by suppliers on its goods: out while their service order still waits for something. */
  operations: Array<{ id: string; name: string; supplierName: string; orderId: string; orderNumber: string; orderStatus: string; orderLineId: string; quantity: string; back: string; out: boolean }>;
  suppliers: Array<{ id: string; name: string; approved: boolean }>;
  /** Moves of its made goods to the project's site, and what's still at the factory to send. */
  dispatches: Array<{ id: string; number: number; status: "in_transit" | "received" | "cancelled"; sentOn: string; quantity: string; received: string | null; short: boolean;
    /** Refused at site, why, and the trip that brings it back. */
    rejected?: string | null; rejectReason?: string; returnId?: string | null; returnNumber?: number | null; returnStatus?: "in_transit" | "received" | "cancelled" | null }>;
  atFactory: string;
  next?: WorkOrderNext; reworks?: WorkOrderRework[];
  /** PLM-150: where its design inspections stand, and every round so far. */
  inspection?: OrderInspection | null; inspections?: InspectionRound[];
  /** The project's designs with an approved revision (the latest of each), to make it to. */
  designs?: Array<{ designId: string; versionId: string; title: string; number: number; documentType: string }>;
  /**
   * The drawing it's made to: recorded on it, the project's drawings once the client approved their latest revision
   * (Scope › Drawings), or a standard piece's catalogue drawing; and the project's latest drawings revision.
   */
  drawing?: { source: "work_order" | "project" | "catalogue" | null; approved: boolean;
    project: { number: number; status: string; decidedOn: string | null; decidedByName: string | null } | null };
  projectStatus?: string;
  /** The project's payment stages it can be tied to, and the reminder its ready date triggered for the tied stage. */
  payments?: Array<{ id: string; title: string; status: "pending" | "proof_submitted" | "verified" }>;
  /** `on` is the day it was decided, in the workspace's time zone. */
  readyReminder?: { readyOn: string | null; outcome: string; channel: "whatsapp" | "email" | null; at: string; on: string;
    /** Why it went: everything tied to the stage was ready, or the planned ready date was near (with that date). */
    reason?: "all_ready" | "before_ready"; plannedReadyOn?: string | null } | null;
};
/** Settings → Factory; hourly rates (oldest first) only for people who set them or see costs. */
export type FactorySettingsState = {
  settings: FactorySettings; workcenters: Workcenter[]; canManage: boolean; canSeeRates: boolean; rates: WorkcenterRate[]; currency: string; today: string;
  /** PLM-150: what the inspection settings choose from: the firm's project roles, trades and design packages. */
  inspectionChoices?: { roles: Array<{ key: string; label: string }>; workPackages: Array<{ id: string; name: string }>; designPackages: Array<{ code: string; name: string }> };
};
