export type ProjectStatus = "active" | "on_hold" | "completed" | "cancelled" | "archived";
export type Health = "on_track" | "at_risk" | "off_track";
export type Priority = "normal" | "high" | "critical";
export type CheckKind = "confirm" | "lead_assigned" | "role_assigned" | "payment_verified" | "material_list_signed_off";

export type ProjectRole = { key: string; label: string };
export type StageCheck = { key: string; kind: CheckKind; label?: string; role?: string };
export type RouteStage = { key: string; name: string; ownerRole: string | null; checks: StageCheck[] };
export type ProjectRoute = { id: string; name: string; isDefault: boolean; version: number; stages: RouteStage[] };

export type ProjectSettings = {
  requireAgreement: boolean; requirePayment: boolean; requireApproval: boolean; referencePrefix: string; roles: ProjectRole[]; version: number;
};
export type SettingsState = { settings: ProjectSettings; templates: ProjectRoute[]; canManage: boolean };

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
  };
  seal: { revisionLabel: string; quoteNumber: number; acceptedAt: string; acceptedBy: string; method: string | null; contentHash: string; sealedAt: string } | null;
  roles: ProjectRole[];
  team: Array<{ role: string; label: string; member: Member | null }>;
  stages: ProjectStage[];
  next: NextStep | null;
  updates: StatusUpdate[];
  members: Member[];
  canManage: boolean;
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
