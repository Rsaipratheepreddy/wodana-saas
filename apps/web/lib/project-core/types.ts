export type ProjectStatus = "active" | "on_hold" | "completed" | "cancelled" | "archived";
export type Health = "on_track" | "at_risk" | "off_track";
export type Priority = "normal" | "high" | "critical";
export type CheckKind = "confirm" | "lead_assigned" | "role_assigned" | "payment_verified" | "material_list_signed_off" | "everything_ordered";

export type ProjectRole = { key: string; label: string };
export type StageCheck = { key: string; kind: CheckKind; label?: string; role?: string };
export type RouteStage = { key: string; name: string; ownerRole: string | null; checks: StageCheck[] };
export type ProjectRoute = { id: string; name: string; isDefault: boolean; version: number; stages: RouteStage[] };

export type ProjectSettings = {
  requireAgreement: boolean; requirePayment: boolean; requireApproval: boolean; requireVariationPayment: boolean; referencePrefix: string; roles: ProjectRole[]; version: number;
};
export type SettingsState = { settings: ProjectSettings; templates: ProjectRoute[]; workTemplates: WorkTemplate[]; canManage: boolean };
/** One step of a package's standard work: working days, the role that does it, its stage, and whether it runs with the step before. */
export type TemplateTask = { title: string; days: number; role: string | null; stage: string | null; withPrevious: boolean };
export type WorkTemplate = { supply: Supply; tasks: TemplateTask[]; version: number };

export type NextStep = { stage: string; kind: CheckKind | "finish"; text: string; role: string | null; owner: string | null };

export type ProjectSummary = {
  id: string; reference: string; name: string; clientName: string; status: ProjectStatus; priority: Priority; health: Health;
  promiseDate: string | null; currency: string; total: string; startedAt: string;
};
export type ProjectRow = ProjectSummary & { stage: { name: string; position: number; count: number } | null; lead: string | null; next: NextStep | null };

export type Member = { membershipId: string; name: string };
export type EvaluatedCheck = StageCheck & { passed: boolean; confirmedBy: string | null; confirmedAt: string | null; note: string };
export type ProjectStage = {
  id: string; position: number; key: string; name: string; ownerRole: string | null; status: "upcoming" | "current" | "done" | "skipped";
  startedAt: string | null; completedAt: string | null; completedByName: string | null; skipReason: string | null;
  checks: EvaluatedCheck[]; ready: boolean; owner: Member | null; canWork: boolean;
};
export type StatusUpdate = { id: string; health: Health; note: string; byName: string; at: string };

export type ProjectDetail = {
  project: ProjectSummary & {
    caseId: string; opportunityId: string; opportunityReference: string | null; holdReason: string | null; holdReviewOn: string | null;
    startDate: string | null; templateName: string | null; version: number;
    closedAt: string | null; closedByName: string | null; cancelReason: string | null;
  };
  seal: { revisionLabel: string; quoteNumber: number; acceptedAt: string; acceptedBy: string; method: string | null; contentHash: string; sealedAt: string } | null;
  roles: ProjectRole[];
  team: Array<{ role: string; label: string; member: Member | null }>;
  stages: ProjectStage[];
  next: NextStep | null;
  updates: StatusUpdate[];
  members: Member[];
  canManage: boolean;
  canClose: boolean;
};

/** An order or price request never sent. */
export type CloseOutDraft = { id: string; number: string; kind: "order" | "request" };
/** What closing a project needs settled first, and what it does by itself. */
export type CloseOut = {
  owedOrders: Array<{ id: string; number: string; supplierName: string; lines: number }>;
  sharedDrafts: CloseOutDraft[];
  inspections: Array<{ id: string; number: number; orderNumber: string }>;
  moves: Array<{ id: string; number: number }>;
  siteStock: Array<{ itemName: string; unit: string; quantity: string; locationName: string }>;
  openWork: number;
  drafts: CloseOutDraft[];
  heldStock: Array<{ itemId: string; itemName: string; unit: string; quantity: string; locationId: string; locationName: string }>;
  blockers: string[];
};

export type SealedLine = {
  id: string; position: number; kind: string; areaId: string | null; fromAreaId: string | null; workPackageId: string | null; title: string; description: string;
  unit: string; quantity: string; rate: string; net: string; total: string; catalogImageId: string | null; imageAssetId: string | null;
};
export type SealedScope = {
  snapshot: {
    quote: { id: string; number: number; title: string; currency: string; decimals: number };
    revisionLabel: string;
    lines: SealedLine[];
    declinedOptions: Array<{ id: string; title: string; total: string }>;
    areas: Array<{ id: string; name: string }>;
    trades: Array<{ id: string; name: string }>;
    pricing: { subtotal: string; discounts: string; net: string; tax: string; total: string; areas: Array<{ key: string; net: string }> };
    paymentTerms: Array<{ id: string; title: string; percent: number; trigger: string }>;
    terms: string; exclusions: string;
    acceptance: { decidedBy: string; decidedAt: string; method: string; recordedBy: string | null; note: string };
    agreement: { reference: string; status: string; executedAt: string | null } | null;
    /** What the client asked for and what became of each request (absent on older seals). */
    requirements?: Array<{ id: string; title: string; roomName: string | null; priority: string; source: string; status: string; note: string; lineIds: string[] }>;
  };
  contentHash: string; sealedAt: string; sealedBy: string; intact: boolean;
};

export type StartState = {
  project: { id: string; reference: string } | null;
  quote: { id: string; number: number; title: string; currency: string; total: string; acceptedAt: string | null; acceptedBy: string | null } | null;
  checks: Array<{ key: "accepted" | "agreement" | "payment" | "approval"; ok: boolean; required: boolean }>;
  caseStatus: string;
  templates: Array<{ id: string; name: string; isDefault: boolean }>;
  members: Member[];
  suggested: { name: string; lead: string | null };
  canStart: boolean;
  canManage: boolean;
};
export type ReadyCase = { caseId: string; name: string; clientName: string; quoteNumber: number; total: string; currency: string };

export type Supply = "make" | "buy" | "ready_made" | "subcontract" | "client" | "site_work";
export type ScopeLine = {
  id: string; position: number; kind: string; areaId: string | null; areaName: string | null; workPackageId: string | null; tradeName: string | null;
  title: string; description: string; unit: string; quantity: string; rate: string; net: string; status: "active" | "omitted"; packageId: string | null;
  origin: string; catalogImageId: string | null; imageAssetId: string | null;
};
export type ScopePackage = { id: string; name: string; supply: Supply; ownerMembershipId: string | null; ownerName: string | null; dueDate: string | null; version: number };
export type SealSummary = { id: string; kind: "baseline" | "variation"; revisionLabel: string; quoteNumber: number; total: string; currency: string; acceptedAt: string; acceptedBy: string };
export type VariationSummary = { id: string; number: number; title: string; status: string; total: string; appliedAs: string | null };
export type LiveScope = {
  lines: ScopeLine[]; packages: ScopePackage[]; seals: SealSummary[]; variations: VariationSummary[];
  currency: string; version: number; canManage: boolean; members: Member[]; caseId: string; baselineQuoteId: string;
};
export type LineHistoryEntry = { id: string; kind: string; detail: Record<string, unknown>; byName: string | null; at: string };

export type MaterialDecision = { itemId: string; decision: "approved" | "rejected"; note: string };
export type MaterialItem = {
  id: string; position: number; catalogItemId: string | null; name: string; code: string; specification: string; supplier: string;
  quantity: string | null; unit: string; note: string; boqLineIds: string[]; version: number;
  /** False for materials the client doesn't choose; they don't wait for sign-off. */
  clientChoice: boolean;
  usedIn: Array<{ id: string; title: string; areaName: string | null }>; decision: MaterialDecision | null;
};
export type MaterialRevision = {
  id: string; number: number; status: "sent" | "signed_off" | "changes_requested"; sentAt: string; sentByName: string | null;
  decidedAt: string | null; decidedBy: string | null; method: string | null; note: string;
};
export type MaterialsState = {
  state: "draft" | "sent" | "signed_off" | "changes_requested" | "changed";
  items: MaterialItem[]; revisions: MaterialRevision[]; version: number; canEdit: boolean;
};

export type WorkType = "task" | "blocker" | "client_request" | "snag";
export type WorkStatus = "todo" | "in_progress" | "in_review" | "done" | "cancelled";
export type WorkPriority = "low" | "normal" | "high" | "urgent";
export type WorkRef = { id: string; number: number; title: string; type: WorkType; status: WorkStatus };
export type WorkItem = {
  id: string; projectId: string; number: number; type: WorkType; parentId: string | null; packageId: string | null; boqLineId: string | null; stageId: string | null;
  sprintId: string | null; title: string; status: WorkStatus; priority: WorkPriority; assigneeId: string | null; assigneeName: string | null;
  startDate: string | null; dueDate: string | null; baselineStart: string | null; baselineDue: string | null; completedAt: string | null; createdBy: string; version: number;
  subtasks: number; subtasksDone: number; comments: number; blockedBy: WorkRef[];
};
export type WorkLink = WorkRef & { kind: "fs" | "ss"; lagDays: number };
export type WorkActivity =
  | { id: string; kind: "comment"; body: string; by: string; at: string }
  | { id: string; kind: string; detail: Record<string, unknown>; by: string; at: string };
export type WorkDetail = WorkItem & {
  description: string; createdByName: string; createdAt: string; startedAt: string | null;
  subtaskIds: string[]; before: WorkLink[]; after: WorkLink[]; activity: WorkActivity[];
};
export type WorkBoard = {
  items: WorkItem[]; packages: Array<{ id: string; name: string; supply: Supply; planned: boolean }>; stages: Array<{ id: string; name: string; status: string }>;
  lines: Array<{ id: string; title: string; areaName: string | null; packageId: string | null }>;
  people: Member[]; me: string | null; canEdit: boolean; canManage: boolean; item: WorkDetail | null; sprints: Sprint[];
  /** The working week (0 = Sunday) and days off, for scheduling. */
  calendar: { workingDays: number[]; holidays: string[] };
  promiseDate: string | null; startDate: string | null; baseline: { at: string; byName: string | null } | null;
};
/** An item pushed later because something it waits on moved. */
export type WorkMove = { id: string; number: number; title: string; fromStart: string | null; fromDue: string | null; startDate: string | null; dueDate: string | null; because: number };
export type OpenWorkItem = WorkItem & { projectReference: string; projectName: string };
export type OpenWork = { items: OpenWorkItem[]; me: string | null; view: "mine" | "all"; canSeeTeam: boolean };
export type WorkInsightRow = {
  membershipId: string | null; name: string | null; total: boolean; open: number; late: number; dueThisWeek: number; blocked: number;
  done: number; doneWithDue: number; onTime: number; cycleDays: number | null;
};
export type WorkInsights = { days: 30 | 90; total: WorkInsightRow | null; people: WorkInsightRow[] };
/** A package's standard work laid out from a start date, before it's created. */
export type PackagePlan = {
  package: { id: string; name: string; supply: Supply }; startDate: string; planned: boolean;
  tasks: Array<{ title: string; days: number; withPrevious: boolean; startDate: string; dueDate: string; role: string | null; roleLabel: string | null;
    assigneeId: string | null; assigneeName: string | null; stageId: string | null; stageName: string | null }>;
};
export type MissReason = "blocked" | "waiting_on_client" | "materials_late" | "underestimated" | "people_unavailable" | "reprioritised" | "other";
export type Sprint = {
  id: string; number: number; name: string; goal: string; startDate: string; endDate: string; status: "planned" | "active" | "closed"; version: number;
  items: number; itemsDone: number; committed: number; committedDone: number; closedAt: string | null;
};
export type SprintDetail = {
  sprint: Sprint; days: Array<{ date: string; remaining: number | null; ideal: number }>; added: number; removed: number;
  missed: Array<{ itemId: string; number: number; title: string; reason: MissReason; note: string }>;
  /** Committed and not done yet, while the sprint runs. */
  unfinished: Array<{ itemId: string; number: number; title: string }>;
};
