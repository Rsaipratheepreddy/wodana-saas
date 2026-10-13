import type { LineStatus } from "../purchasing/types";
import type { ProductionSummary } from "../factory/production";
import type { Crew } from "../logistics/types";

export type ProjectStatus = "active" | "on_hold" | "completed" | "cancelled" | "archived";
export type Health = "on_track" | "at_risk" | "off_track";
export type Priority = "normal" | "high" | "critical";
export type CheckKind = "confirm" | "lead_assigned" | "role_assigned" | "payment_verified" | "material_list_signed_off" | "everything_ordered" | "everything_made"
  | "snags_closed" | "no_critical_snags" | "handover_accepted" | "drawings_uploaded" | "drawings_site_checked" | "drawings_client_approved" | "factory_slot_booked"
  | "installation_scheduled" | "goods_delivered" | "installation_done" | "permit_collected";

export type ProjectRole = { key: string; label: string };
export type StageCheck = { key: string; kind: CheckKind; label?: string; role?: string };
export type RouteStage = { key: string; name: string; ownerRole: string | null; checks: StageCheck[] };
export type ProjectRoute = { id: string; name: string; isDefault: boolean; version: number; stages: RouteStage[] };

export type ProjectSettings = {
  requireAgreement: boolean; requirePayment: boolean; requireApproval: boolean; requireVariationPayment: boolean; referencePrefix: string; roles: ProjectRole[]; version: number;
  /** §6.20: how a variation is paid — all before its work, or with the project's next milestone. */
  variationPaymentRule?: "before_work" | "next_milestone";
  /** The project finishes by itself once the client accepts the handover (D-7). */
  autoFinish: boolean;
  /** Hours after which a drafted client update nobody sent goes by itself; null keeps it manual (D-40). */
  clientUpdateAutoSendHours: number | null;
  /** When the day's site report is due (HH:MM, the workspace's time): reminders start then. */
  reportDueTime?: string;
  /** With "Send by itself" on, daily reports nobody reviewed also go (as written) after its hours. */
  autoSendPendingReports?: boolean;
  /** The week's sent days go to the client as one digest on the last working day. */
  weeklyRollup?: boolean;
  /** PLM-055: the roles told at the project's key moments. */
  keepInformed?: Record<KeepInformedEvent, string[]>;
};
/** The project's key moments people can be kept informed about (PLM-055). */
export type KeepInformedEvent = "drawings_started" | "production_started" | "installation_scheduled";

/** PLM-069: delivery and installation, read from the records; the two days are set by the project manager or the installation team. */
export type DeliveryStatus = "not_booked" | "booked" | "part_delivered" | "delivered";
export type InstallationStatus = "not_started" | "in_progress" | "done";
export type ProjectInstallation = {
  deliveryOn: string | null; installationOn: string | null; note: string; setByName: string | null; setAt: string | null;
  delivery: DeliveryStatus; installation: InstallationStatus; siteStartedOn: string | null; siteFinishedOn: string | null; inRoute: boolean; late: boolean;
  /** Who goes on the delivery (with the vehicle and driver) and on the installation: people by name (Palm, 6 Oct). */
  deliveryCrew?: (Crew & { assignmentId: string | null }) | null; installationCrew?: (Crew & { assignmentId: string | null }) | null;
  /** The building permit the delivery needs on a route that checks it: covering the delivery day (or valid today), until when, the planned collection. */
  permit?: { required: boolean; valid: boolean; validTo: string | null; reminderOn?: string | null; collectOn: string | null; plannedId: string | null; collected: boolean };
};
export type SettingsState = { settings: ProjectSettings; templates: ProjectRoute[]; workTemplates: WorkTemplate[]; canManage: boolean };
/** One step of a package's standard work: working days, the role that does it, its stage, and whether it runs with the step before. */
export type TemplateTask = { title: string; days: number; role: string | null; stage: string | null; withPrevious: boolean; needsMaterials?: boolean };
export type WorkTemplate = { supply: Supply; tasks: TemplateTask[]; version: number };

export type NextStep = { stage: string; kind: CheckKind | "finish"; text: string; role: string | null; owner: string | null };

export type ProjectSummary = {
  id: string; reference: string; name: string; clientName: string; status: ProjectStatus; priority: Priority; health: Health;
  /** The agreed value; null for people who don't see it (QA-006). */
  promiseDate: string | null; currency: string; total: string | null; startedAt: string;
};
export type ProjectRow = ProjectSummary & {
  stage: { name: string; position: number; count: number } | null; lead: string | null; next: NextStep | null;
  /** Open work that's late, and open work held up by something unfinished. */
  attention?: { late: number; blocked: number };
};

export type Member = { membershipId: string; name: string; email?: string | null };
export type EvaluatedCheck = StageCheck & { passed: boolean; confirmedBy: string | null; confirmedAt: string | null; note: string };
export type ProjectStage = {
  id: string; position: number; key: string; name: string; ownerRole: string | null; status: "upcoming" | "current" | "done" | "skipped";
  startedAt: string | null; completedAt: string | null; completedByName: string | null; skipReason: string | null;
  /** Finished by itself (D-7), on behalf of `completedByName`. */
  finishedAutomatically?: boolean;
  checks: EvaluatedCheck[]; ready: boolean; owner: Member | null; canWork: boolean;
};
export type StatusUpdate = {
  id: string; health: Health; note: string; byName: string; at: string; sharedAt?: string | null;
  /** A status update, or the week's client update (drafted from approved site reports; a draft until the project manager approves it). */
  kind?: "status" | "client_update"; draft?: boolean; photoIds?: string[];
  /** When a draft client update goes to the client by itself (the firm sends them automatically). */
  sendsAt?: string | null;
};
/** Who sees what of a project's money: its costs (margin only with commercial costs), and the client side. */
export type MoneyRights = { costs: boolean; margin: boolean; client: boolean };

export type ProjectDetail = {
  project: ProjectSummary & {
    caseId: string; opportunityId: string; opportunityReference: string | null; holdReason: string | null; holdReviewOn: string | null;
    startDate: string | null; templateName: string | null; version: number;
    closedAt: string | null; closedByName: string | null; cancelReason: string | null;
    heldAt?: string | null; siteStartedOn?: string | null; siteFinishedOn?: string | null;
    /** The client has accepted a handover pack (its warranty has started). */
    handoverAccepted?: boolean;
  };
  /** While on hold: how long, in calendar and working days (resume can move the dates by the working days). */
  hold?: { days: number; workingDays: number } | null;
  money?: MoneyRights;
  seal: { revisionLabel: string; quoteNumber: number; acceptedAt: string; acceptedBy: string; method: string | null; contentHash: string; sealedAt: string } | null;
  roles: ProjectRole[];
  /** One person per role, or the role marked "not applicable" for this project (PLM-100). */
  team: Array<{ role: string; label: string; member: Member | null; notApplicable?: boolean }>;
  /** People outside Wodana who do the work (installers, subcontractors). */
  teamNote?: string;
  stages: ProjectStage[];
  next: NextStep | null;
  updates: StatusUpdate[];
  members: Member[];
  canManage: boolean;
  canClose: boolean;
  /** Whether this person sees the project's costs (the Money tab). */
  canSeeMoney: boolean;
  /** Whether the agreed value is shown (QA-006); the server leaves it out otherwise. */
  canSeeValue?: boolean;
  /** Whole percent of the work done, packages weighed by value; null before any work is planned. */
  progress: number | null;
  /** The factory slot booked for the project (PLM-068), and whether this person may book or move it. */
  factorySlot?: { date: string; note: string; byName: string | null; at: string | null } | null;
  canBookSlot?: boolean;
  /** Whether the route keeps technical drawings (and asks for a site check or a factory slot), and the latest revision. */
  drawings?: { inRoute: boolean; needsSiteCheck: boolean; factorySlot: boolean; latest: { id: string; number: number; status: DrawingStatus } | null };
  /** PLM-063: the project's production from its work orders (none when the factory makes nothing for it). */
  production?: ProductionSummary | null;
  /** PLM-069: delivery and installation, and whether this person may schedule them. */
  installation?: ProjectInstallation;
  canScheduleInstallation?: boolean;
  /** PLM-098: the areas this job's enquiry-type path uses after Won, plus any area already holding a record. Missing = every area. */
  areas?: ProjectAreas;
};

export type ProjectArea = "planning" | "production" | "supply" | "delivery";
export type ProjectAreas = Record<ProjectArea, boolean>;

export type DrawingStatus = "uploaded" | "checked" | "changes_needed" | "sent" | "approved" | "changes_requested";
export type DrawingFile = { id: string; kind: "drawing" | "approval"; name: string; mimeType: string; byteSize: number; hasPreview: boolean; byName: string; at: string };
export type DrawingRevision = {
  id: string; number: number; status: DrawingStatus; note: string; createdByName: string; createdAt: string;
  siteCheck: "ok" | "changes" | null; siteCheckNote: string; siteCheckedByName: string | null; siteCheckedAt: string | null;
  sentByName: string | null; sentAt: string | null;
  decidedOn: string | null; decidedByName: string | null; decisionNote: string; decisionVia: "recorded" | "portal" | null; decisionRecordedByName: string | null;
  files: DrawingFile[];
};
/** The project's technical drawings (PLM-057 … 060), newest revision first, with what this person may do next. */
export type DrawingReason = "bespoke" | "made_to_order" | "no_catalogue_drawing" | "catalogue_drawing";
/** One item and whether it needs technical drawings (PLM-057): the rule, the team's decision, and the catalogue drawing it already has. */
export type DrawingItem = {
  lineId: string; title: string; area: string | null; catalogItemId: string | null; catalogId: string | null; catalogName: string | null; catalogDrawingUrl: string | null;
  rule: { needed: boolean; reason: DrawingReason }; needed: boolean;
  override: { needed: boolean; reason: string; byName: string | null; at: string | null } | null; version: number;
};
export type DrawingsState = {
  revisions: DrawingRevision[]; version: number; caseId: string; inRoute: boolean; needsSiteCheck: boolean;
  canUpload: boolean; canCheck: boolean; canSend: boolean; canDecide: boolean;
  /** Whether any item needs drawings; the items; who may decide per item. */
  needed?: boolean; items?: DrawingItem[]; canDecideItems?: boolean;
};

export type CostSource = "stock" | "service" | "price_difference" | "charge" | "labour" | "petty_cash";
/** What a cost was for: the project P&L's categories. */
export type CostCategory = "materials" | "factory" | "subcontract_labour" | "site_expenses" | "other";
/** One cost the project carries, in the workspace's currency, from the record that caused it. */
export type CostEntry = { key: string; on: string; source: CostSource; category?: CostCategory; description: string; reference: string | null; packageId: string | null; packageName: string | null;
  amount: string };

/** One cost category of the P&L: the quotation's estimate against what's spent, committed and still expected. Money is decimal text. */
export type PnlCategory = {
  category: CostCategory; budget: string | null; actual: string; committed: string; remaining: string; forecast: string; variance: string | null; usedPercent: string | null; over: boolean;
};
export type PnlFlag =
  | { code: "over_budget"; category: CostCategory; amount: string }
  | { code: "forecast_loss"; amount: string }
  | { code: "below_target"; forecastPercent: string; target: string }
  | { code: "estimate_incomplete"; count: number }
  | { code: "no_estimate" };
export type ContractPart = { sealId: string; label: string; net: string; total: string; acceptedAt: string };
export type PnlFigures = {
  currency: string; contractCurrency: string; comparable: boolean;
  contract: { baselineNet: string; baselineTotal: string; variationsNet: string; variationsTotal: string; variations: ContractPart[]; net: string; total: string };
  revenue: { invoicedNet: string; invoicedTotal: string; received: string };
  categories: PnlCategory[];
  totals: { budget: string | null; actual: string; committed: string; remaining: string; forecast: string };
  margin: { toDate: string | null; toDatePercent: string | null; forecast: string | null; forecastPercent: string | null; target: string | null };
  flags: PnlFlag[];
};
/** A project's P&L (Money › Summary), with the figures it's read from and how they compare with the Ledger. */
export type ProjectPnl = PnlFigures & {
  projectId: string; reference: string; name: string; asOf: string;
  estimate: { lines: number; missing: number }; uncosted: number; marginHidden: boolean;
  basis: { source: "operational"; ledger: null | { company: string; currency: string; revenue: string; cost: string; revenueDifference: string | null; costDifference: string | null;
    matches: boolean | null; journals: string } };
};
export type CashMonth = { month: string; in: string; out: string; net: string; cumulativeIn: string; cumulativeOut: string; balance: string };
export type UpcomingBucket = "overdue" | "days_0_30" | "days_31_60" | "days_61_90";
export type UpcomingItem = { key: string; direction: "in" | "out"; kind: "milestone" | "bill" | "order" | "petty_cash"; label: string; due: string | null; amount: string };
/** A project's cash: money in and out by month, its wallet, what's due in 90 days and the spending guard. */
export type ProjectCashFlow = {
  projectId: string; currency: string; timeZone: string; asOf: string;
  months: CashMonth[];
  wallet: { received: string; paid: string; balance: string };
  upcoming: { buckets: Array<{ key: UpcomingBucket; from: string | null; to: string; in: string; out: string; net: string }>; undated: { in: string; out: string }; items: UpcomingItem[] };
  spendingLock: { guard: "off" | "warn" | "strict"; available: string | null; state: "off" | "clear" | "warn" | "locked" };
  unconverted: number;
};
export type ProfitabilityRow = {
  projectId: string; reference: string; name: string; clientName: string; status: ProjectStatus; href: string;
  contractCurrency: string; contractNet: string; variationsNet: string; revenue: string; received: string;
  cost: string; committed: string; forecastCost: string; budget: string | null;
  margin: string | null; marginPercent: string | null; forecastMargin: string | null; forecastMarginPercent: string | null;
  flags: PnlFlag[]; comparable: boolean;
};
export type Profitability = { currency: string; marginHidden: boolean; target: string | null; categories: CostCategory[]; rows: ProfitabilityRow[] };
/** A package's budget against what's spent and still committed; `id` null for costs not in a package. */
export type PackageMoney = { id: string | null; name: string | null; budget: string | null; budgetVersion: number; budgetNote: string; spent: string; committed: string; forecast: string; over: boolean };
/** A project's money: the client side in the project's currency, costs in the workspace's. */
export type ProjectMoney = {
  currency: string;
  income: { currency: string; agreed: string; agreedNet: string; requested: string; invoiced: string; received: string };
  spent: string; committed: string; forecast: string; budget: string | null; margin: string | null; available: string | null;
  packages: PackageMoney[]; entries: CostEntry[]; uncosted: number; canManage: boolean;
  /** A project manager sees their project's money without its margin. */
  marginHidden?: boolean;
};

/** A trade's day rate from a date: a day on site costs the rate set from the latest date on or before it. */
export type TradeRate = { id: string; key: string; trade: string; from: string; rate: string; currency: string; version: number; updatedByName: string; updatedAt: string };
/** Settings → Projects → Labour rates: each trade with its rates (oldest first), including trades on site reports with none yet. */
export type LabourRates = { currency: string; today: string; trades: Array<{ key: string; name: string; reports: number; rates: TradeRate[] }>; canManage: boolean };

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
  /** Snags not closed: the project can't complete while one is open (PLM-070). */
  openSnags?: Array<{ id: string; number: number; title: string; severity: string }>;
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
  /** Rate and amount are null for people who don't see the project's value (QA-006). */
  title: string; description: string; unit: string; quantity: string; rate: string | null; net: string | null; status: "active" | "omitted"; packageId: string | null;
  origin: string; catalogImageId: string | null; imageAssetId: string | null;
};
export type ScopePackage = { id: string; name: string; supply: Supply; ownerMembershipId: string | null; ownerName: string | null; dueDate: string | null; version: number };
export type SealSummary = { id: string; kind: "baseline" | "variation"; revisionLabel: string; quoteNumber: number; total: string | null; currency: string; acceptedAt: string; acceptedBy: string };
export type VariationSummary = { id: string; number: number; title: string; status: string; total: string | null; appliedAs: string | null };
export type LiveScope = {
  lines: ScopeLine[]; packages: ScopePackage[]; seals: SealSummary[]; variations: VariationSummary[];
  currency: string; version: number; canManage: boolean; members: Member[]; caseId: string; baselineQuoteId: string;
  /** Whether prices, amounts and the sealed documents are shown (QA-006). */
  canSeeValue?: boolean;
};
export type LineHistoryEntry = { id: string; kind: string; detail: Record<string, unknown>; byName: string | null; at: string };

export type MaterialDecision = { itemId: string; decision: "approved" | "rejected"; note: string };
export type MaterialItem = {
  id: string; position: number; catalogItemId: string | null; name: string; code: string; specification: string; supplier: string;
  quantity: string | null; unit: string; note: string; boqLineIds: string[]; version: number;
  /** False for materials the client doesn't choose; they don't wait for sign-off. */
  clientChoice: boolean;
  usedIn: Array<{ id: string; title: string; areaName: string | null }>; decision: MaterialDecision | null;
  /** Where it has got to (PLM-072): required, ordered, received or installed, as Purchasing works it out. */
  status?: LineStatus | null;
  /** PLM-055: product details for the technical team (internal; not part of what the client signs), with who added them and when. */
  teamNote?: string; teamNoteByName?: string | null; teamNoteAt?: string | null;
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
  /** Its package's materials must be there when it starts: purchasing counts back from its start. */
  needsMaterials: boolean;
  /** For a snag: how serious, where it came from, its area, and who marked it fixed. */
  severity: Severity | null; source: SnagSource | null; areaId: string | null; fixedBy: string | null;
  /** For open work: when its assignee is away on approved leave within its dates (dates only). */
  assigneeAway?: Array<{ startDate: string; endDate: string }>;
};
export type Severity = "minor" | "major" | "critical";
export type SnagSource = "internal" | "inspection" | "delivery" | "client" | "warranty";
export type WorkLink = WorkRef & { kind: "fs" | "ss"; lagDays: number };
export type WorkActivity =
  | { id: string; kind: "comment"; body: string; by: string; at: string }
  | { id: string; kind: string; detail: Record<string, unknown>; by: string; at: string };
export type WorkDetail = WorkItem & {
  description: string; createdByName: string; createdAt: string; startedAt: string | null;
  subtaskIds: string[]; before: WorkLink[]; after: WorkLink[]; activity: WorkActivity[];
  /** A snag's photos before and after it's fixed. */
  photos: Array<{ id: string; kind: "before" | "after"; name: string; byName: string; at: string }>;
  /** A task a stage check opened links to what its work needs: the drawings, measurements, material list, designs or the factory slot. */
  links?: Array<{ key: "drawings" | "measurements" | "materials" | "designs" | "factory_slot" | "installation" | "permit"; href: string }>;
};
export type WorkBoard = {
  items: WorkItem[]; packages: Array<{ id: string; name: string; supply: Supply; planned: boolean }>; stages: Array<{ id: string; name: string; status: string }>;
  lines: Array<{ id: string; title: string; areaName: string | null; packageId: string | null }>;
  people: Member[]; me: string | null; canEdit: boolean; canManage: boolean; item: WorkDetail | null; sprints: Sprint[];
  /** The working week (0 = Sunday) and days off, for scheduling. */
  calendar: { workingDays: number[]; holidays: string[] };
  promiseDate: string | null; startDate: string | null; baseline: { at: string; byName: string | null } | null;
  /** The plan's finish and, per open dated item, the working days it can slip before that finish moves (none or less: critical). */
  critical: { finish: string | null; float: Record<string, number> };
  /** Whole percent done: the project (packages weighed by value) and each package with tasks. */
  progress: { project: number | null; packages: Record<string, number> };
  /** For open work that needs its package's materials: those not in yet, by item id. */
  materials: Record<string, string[]>;
  /** The project's areas, for where a snag is. */
  areas: Array<{ id: string; name: string }>;
  /** A completed project still works its warranty snags. */
  aftercare: boolean;
  /** On hold: the plan is read-only apart from cancelling work and comments. */
  onHold?: boolean;
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

/** What holds a project up, counted from the record that causes it; `href` opens its filtered list. */
export type BlockerKey = "late_work" | "blocked_work" | "materials_not_in" | "late_to_order" | "late_orders" | "work_orders_waiting" | "reports_missing" | "client_decisions"
  | "critical_snags" | "funds_short";
export type Blocker = { key: BlockerKey; count: number; items: string[]; href: string };
export type ClientDecision = { kind: "materials" | "drawings" | "handover" | "variation"; label: string; since: string | null; href: string };
export type ActivityRow = { id: string; at: string; action: string; source: string; actor: string; subject: string; detail: Record<string, string> };
/** The project's Overview, read on the server. */
export type HealthReason =
  | { key: "stated" } | { key: "past_handover"; days: number } | { key: "plan_after_handover"; days: number }
  | { key: "late_work"; count: number } | { key: "late_orders"; count: number } | { key: "critical_snags"; count: number };
export type ProjectOverview = {
  today: string;
  /** Where the work is: the project's check-in site, else the property on its opportunity. */
  site?: { address: string | null; latitude: number | null; longitude: number | null } | null;
  /** The worse of the health the manager stated and what the records say (late work, a missed handover). */
  health?: { health: Health; stated: Health; reasons: HealthReason[] };
  /** Who to call: the client and the sales person on the opportunity. */
  contacts?: { client: { phone: string | null; email: string | null }; sales: { name: string; email: string | null } | null };
  /** The crew in the latest site report sent for review. */
  workforce?: { date: string; people: number; trades: Array<{ trade: string; people: number }> } | null;
  /** The latest site reports sent for review, newest first. */
  siteReports?: Array<{ id: string; date: string; status: string; byName: string; text: string }>;
  work: { open: number; late: number; blocked: number; ready: number; openSnags: number; criticalSnags: number; clientRequests: number };
  blockers: Blocker[];
  decisions: ClientDecision[];
  stagePlan: Record<string, { start: string | null; end: string | null; open: number; total: number }>;
  dates: { start: string | null; promise: string | null; planEnd: string | null; siteStarted: string | null; siteFinished: string | null };
  money: null | {
    currency: string; agreed: string; invoiced: string; received: string; due: string; toInvoice: number;
    next: { title: string; amount: string; dueDate: string | null; state: MilestoneState } | null;
    spent: string | null; committed: string | null; available: string | null; costCurrency: string | null;
    /** The cost budget set on the project's packages, when any. */
    budget?: string | null;
  };
  activity: ActivityRow[];
};
export type MilestoneState = "to_invoice" | "invoiced" | "reported" | "verified";
/** One payment milestone of the project's sealed quotations, with its invoice and receipt. */
export type Milestone = {
  id: string; title: string; trigger: string; amount: string; currency: string; dueDate: string | null; quoteId: string | null; requiredForProduction: boolean;
  state: MilestoneState; reference: string;
  invoice: { id: string; number: string; total: string; dueDate: string } | null;
  receipt: { status: string; reportedBy: string; reportedAt: string; verifiedBy: string | null; verifiedAt: string | null } | null;
};
export type Milestones = { milestones: Milestone[]; caseRevision: number | null; caseId: string; currency: string; canReport: boolean; canVerify: boolean; visible: boolean };
