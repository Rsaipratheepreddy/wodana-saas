export type TaskStatus =
  | "planned"
  | "in_progress"
  | "blocked"
  | "on_hold"
  | "awaiting_inspection"
  | "completed"
  | "cancelled";
export type ReleasedCatalogSelection = {
  role: string;
  recordId: string;
  version: number;
  snapshot: {
    id: string;
    name: string;
    code: string;
    kind: string;
    version: number;
    catalogId: string;
    catalogName?: string;
    configuration?: Record<string, string | number>;
  };
};
export type ReleasedScopeLine = {
  id: string;
  deductsLineId?: string;
  sourceScopeId?: string;
  sourceScopeVersion?: number;
  sourceSpecificationVersion?: number;
  title: string;
  room: string;
  specification?: string;
  material: string;
  finish?: string;
  /** Accepted finished-item size; verified site measurements remain separate. */
  dimensions?: {
    length?: number;
    height?: number;
    depth?: number;
    unit: "mm" | "cm" | "m" | "in" | "ft";
  };
  quantity: number;
  unit: string;
  rate?: number;
  lineTotal?: number;
  variant?: string;
  pricingMode?: "item" | "materials";
  materialRows?: {
    id: string;
    name: string;
    type: "material" | "finish" | "labour" | "other";
    specification: string;
    quantity: number;
    unit: string;
    rate: number;
    suppliedByClient: boolean;
  }[];
  customMaterials?: {
    id: string;
    name: string;
    code: string;
    brand: string;
    specification: string;
    suppliedByClient: boolean;
  }[];
  catalogSelections?: ReleasedCatalogSelection[];
};
export type Task = {
  id: string;
  parentId: string;
  /** The released-scope work package this task belongs to, when it is delivery work. */
  packageId?: string;
  package: string;
  title: string;
  description: string;
  area: string;
  location: "site" | "factory" | "office";
  ownerId: string;
  assigneeIds: string[];
  resourceId: string;
  start: string;
  end: string;
  baselineStart: string;
  baselineEnd: string;
  predecessors: string[];
  quantity: number;
  unit: string;
  weight: number;
  approved: number;
  status: TaskStatus;
  priority: "normal" | "high" | "urgent";
  inspectionRequired: boolean;
  scopeIds: string[];
  drawingId: string;
  readiness: { scope: boolean; access: boolean; materials: boolean };
  blocker: string;
};
export type DailyReport = {
  summary?: string;
  weather?: string;
  safety?: string;
  /** Explicitly distinguishes an observation from a safety incident. */
  safetyStatus?: "none" | "observation" | "incident";
  /** The reporter's forecast judgement; reviewed work never changes itself. */
  scheduleImpact?: "none" | "watch" | "blocked";
  impactReason?: string;
  recoveryPlan?: string;
  nextUpdateOwnerId?: string;
  nextUpdateDate?: string;
  workforce?: {trade:string;people:number;hours:number}[];
  clientFileIds?:string[];
  id: string;
  date: string;
  shift: string;
  location: "site" | "factory";
  authorId: string;
  author: string;
  status: "draft" | "submitted" | "returned" | "approved";
  entries: { taskId: string; quantity: number }[];
  hours: number;
  people: number;
  materials: string;
  issues: string;
  tomorrow: string;
  evidence: string;
  note: string;
  reviewedBy?: string;
  reviewedAt?: string;
  publishedAt?: string;
  supersedes?: string;
};
export type Material = {
  reservations?: {
    taskId: string;
    quantity: number;
    reference: string;
    at: string;
  }[];
  id: string;
  title: string;
  specification: string;
  catalogId: string;
  catalogVersion: number;
  unit: string;
  required: number;
  supply: "company" | "vendor" | "client";
  taskId: string;
  needBy: string;
  movements: {
    taskId?: string;
    id: string;
    kind: "receive" | "issue" | "return" | "waste" | "supplier_return" | "transfer_out";
    quantity: number;
    reference: string;
    at: string;
  }[];
};
export type Order = {
  sourceEnquiry?: string;
  vendorUpdates?: {
    id: string;
    at: string;
    kind: "quotation" | "acknowledgement" | "progress" | "delivery";
    note: string;
    evidence: string;
    date: string;
    quantity: number;
    unitCost?: number;
  }[];
  id: string;
  number: string;
  title: string;
  vendor: string;
  vendorContact: string;
  kind: "material" | "subcontract" | "factory";
  materialId: string;
  taskId: string;
  quantity: number;
  unit: string;
  unitCost: number;
  currency: string;
  promisedDate: string;
  /** Supplier-confirmed duration retained with the commitment when known. */
  leadTimeDays?: number;
  status:
    | "enquiry"
    | "draft"
    | "submitted"
    | "approved"
    | "acknowledged"
    | "closed"
    | "cancelled";
  acknowledgement: string;
  receipts: {
    id: string;
    accepted: number;
    rejected: number;
    evidence: string;
    at: string;
  }[];
};
export type ProjectDocument = {
  id: string;
  title: string;
  kind:
    | "drawing"
    | "specification"
    | "permit"
    | "as_built"
    | "manual"
    | "warranty"
    | "other";
  revision: string;
  url: string;
  note: string;
  status: "draft" | "review" | "approved" | "superseded";
  replaces: string;
  published: boolean;
  approvedBy?: string;
  /** Immutable link when this is a design revision captured from Pre-execution. */
  sourceDesignVersionId?: string;
  /** Protected Pre-execution asset containing the captured design revision. */
  sourceDesignAssetId?: string;
  /** Released quotation scope covered by this document revision. */
  scopeLineIds?: string[];
};
export type Snag = {
  handoverId?: string;
  /** Present only for a claim raised through an authenticated client portal. */
  warrantyClaimChallengeId?: string;
  reportedAt?: string;
  reportedBy?: string;
  reportedVia?: "team" | "client_portal";
  /** Client-provided context stays internal and is never added to PublicProject. */
  clientNote?: string;
  id: string;
  title: string;
  taskId: string;
  area: string;
  ownerId: string;
  severity: "minor" | "major" | "critical";
  dueDate: string;
  status: "open" | "ready" | "closed";
  evidence: string;
  resolution: string;
  /** Person who submitted the latest correction; a different reviewer closes it. */
  resolutionBy?: string;
  verifiedBy?: string;
};
/** A named promise that survives physical handover instead of becoming a note. */
export type HandoverOutstandingItem = {
  id: string;
  title: string;
  kind: "punch" | "document" | "training" | "delivery" | "other";
  /** Blocking items must be resolved before the client can accept the pack. */
  blocking: boolean;
  ownerId: string;
  dueDate: string;
  status: "open" | "ready" | "closed" | "warranty";
  evidence: string;
  resolution: string;
  /** Person who submitted the latest completion evidence. */
  resolutionBy?: string;
  verifiedBy?: string;
};

/**
 * Immutable, client-safe view of what was offered for acceptance. It is a
 * snapshot, not a live query, so a later drawing or task change cannot alter
 * a pack the client has already reviewed.
 */
export type HandoverPacket = {
  id: string;
  version: number;
  createdAt: string;
  preparedBy: string;
  source: "area" | "work_package";
  sourcePackageId?: string;
  scopeLineIds: string[];
  tasks: {
    id: string;
    title: string;
    area: string;
    location: Task["location"];
    quantity: number;
    unit: string;
  }[];
  documents: Pick<ProjectDocument, "id" | "title" | "kind" | "revision" | "url">[];
  commissioningIds: string[];
  dispatchIds: string[];
};

export type Handover = {
  id: string;
  area: string;
  title: string;
  status: "draft" | "ready" | "returned" | "accepted";
  /** The source drives automatic scope, document and evidence selection. */
  source?: "area" | "work_package";
  sourcePackageId?: string;
  documentIds: string[];
  taskIds: string[];
  evidence: string;
  acceptedBy: string;
  acceptedAt: string;
  warrantyUntil: string;
  /** Legacy summary only. New work uses the owned items below. */
  outstanding: string;
  outstandingItems?: HandoverOutstandingItem[];
  packet?: HandoverPacket;
  /** Earlier offered packs remain available after a client return. */
  packets?: HandoverPacket[];
  clientApproverId?: string;
  clientReviewDueDate?: string;
  returnedAt?: string;
  returnedBy?: string;
  returnedNote?: string;
  decisionSource?: "client_portal" | "signed_record";
  decisionChallengeId?: string;
  published: boolean;
};
export type ProjectComment = {
  mentions?: string[];
  edits?: { text: string; at: string }[];
  id: string;
  recordId: string;
  parentId: string;
  text: string;
  author: string;
  authorId: string;
  at: string;
  resolved: boolean;
};
export type ProjectAudit = {
  id: string;
  at: string;
  author: string;
  action: string;
  recordId: string;
  note: string;
};
export type ProjectHoldHistoryEntry = {
  id: string;
  action: "placed" | "updated" | "released";
  reason: string;
  ownerId: string;
  at: string;
  byId: string;
  byName: string;
};
export type ProjectControlSummary = {
  reference: string;
  priority: "normal" | "high" | "critical";
  risk: "on_track" | "get_ready" | "urgent_action" | "high_risk" | "complete";
  onHold: boolean;
  holdReason: string;
  holdSince: string;
  holdOwnerId: string;
  promise: string;
  targetCompletion: string;
  handoverDate: string;
  nextAction: string;
  nextActionOwnerId: string;
  nextActionDate: string;
  nextClientMeeting: string;
  nextClientMeetingOwnerId: string;
  clientNote: string;
};
export type ProjectRole =
  | "sales_manager"
  | "senior_designer"
  | "junior_designer"
  | "technical_designer"
  | "visualizer"
  | "project_manager"
  | "creative_director"
  | "finance"
  | "procurement_production"
  | "crm_owner"
  | "sales_assistant"
  | "surveyor";
export type ProjectRoleAssignment = { role: ProjectRole; memberId: string };
/**
 * The commercial facts frozen when a project is released. Operational planning
 * reads this snapshot; it never rewrites the signed agreement or payment plan.
 */
export type ProjectInitiationCommercialBaseline = {
  quoteId: string;
  quoteHash: string;
  quoteNumber: number;
  dealFileId: string;
  dealFileReference: string;
  agreementReference: string;
  currency: string;
  value: number;
  paymentMilestones: {
    id: string;
    title: string;
    amount: number;
    dueDate: string;
    trigger: string;
    requiredForRelease: boolean;
    requiredForProduction?: boolean;
  }[];
};
export type ProjectInitiationBaseline = {
  projectOwnerId: string;
  /** The initial delivery team. Membership removal is a separate, explicit access action. */
  teamMemberIds: string[];
  siteReadiness: "not_required" | "to_confirm" | "confirmed";
  /** Active, project-owned work-location IDs; never free-text sites. */
  siteIds: string[];
  objective: string;
  clientPromise: string;
  clientContactName: string;
  clientContactPhone: string;
  clientContactEmail: string;
  accessNotes: string;
  operationalStart: string;
  targetCompletion: string;
  handoverDate: string;
};
export type ProjectInitiation = {
  status: "not_started" | "confirmed";
  commercial: ProjectInitiationCommercialBaseline;
  baseline: ProjectInitiationBaseline | null;
  confirmedAt: string;
  confirmedById: string;
  confirmedByName: string;
  revisions: {
    id: string;
    baseline: ProjectInitiationBaseline;
    reason: string;
    at: string;
    byId: string;
    byName: string;
  }[];
};
export type ApprovedMaterialSelection = {
  id: string;
  sourceApprovalId: string;
  quoteId: string;
  lineId: string;
  room: string;
  item: string;
  name: string;
  code: string;
  brand: string;
  specification: string;
  revision: number;
  approvedAt: string;
  approvedBy: string;
};
/**
 * The approved design evidence that crossed the commercial-to-delivery
 * boundary. It is separate from mutable project documents so delivery always
 * knows the exact design revision that was contractually released.
 */
export type ProjectDesignLink = {
  scopeLineId: string;
  sourceScopeId: string;
  sourceScopeVersion: number;
  sourceSpecificationVersion: number;
  designVersionId: string;
  designId: string;
  assetId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  hasPreview: boolean;
  title: string;
  documentType: string;
  revision: number;
  approvedAt: string;
};
export type ProjectDesignBaseline = {
  capturedAt: string;
  definitionBaseline?: { id: string; number: number; hash: string };
  links: ProjectDesignLink[];
};
export type ProjectWorkPackage = {
  id: string;
  /** Immutable links to the released quotation scope that this package delivers. */
  scopeLineIds: string[];
  title: string;
  area: string;
  deliveryRoute: "site" | "factory" | "vendor" | "office" | "mixed";
  status:
    | "planning"
    | "ready"
    | "in_progress"
    | "on_hold"
    | "blocked"
    | "completed"
    | "cancelled";
  ownerId: string;
  plannedStart: string;
  plannedEnd: string;
  /** Explicit package dependencies; task dependencies remain the detailed schedule truth. */
  predecessorPackageIds?: string[];
  priority?: "normal" | "high" | "critical";
  risk?: "on_track" | "watch" | "blocked";
  nextAction?: string;
  nextActionOwnerId?: string;
  nextActionDate?: string;
  recoveryPlan?: string;
  blocker: string;
  createdAt: string;
  updatedAt: string;
};
export type ProjectConnectedPlan = {
  promise: {
    statement: string;
    targetCompletion: string;
    handoverDate: string;
  };
  packages: {
    id: string;
    title: string;
    area: string;
    status: ProjectWorkPackage["status"];
    ownerId: string;
    priority: "normal" | "high" | "critical";
    risk: "on_track" | "watch" | "blocked";
    plannedStart: string;
    plannedEnd: string;
    predecessorPackageIds: string[];
    nextAction: string;
    nextActionOwnerId: string;
    nextActionDate: string;
    recoveryPlan: string;
    supplierCommitments: {
      orderId: string;
      number: string;
      vendor: string;
      status: Order["status"];
      promisedDate: string;
      leadTimeDays: number | null;
      taskId: string;
    }[];
    capacityCommitments: {
      taskId: string;
      resourceId: string;
      resourceName: string;
      resourceKind: ProjectResource["kind"] | null;
      bookingStatus: ProjectBooking["status"] | "missing";
      start: string;
      end: string;
    }[];
    issues: {
      code:
        | "owner"
        | "schedule"
        | "dependency"
        | "supplier"
        | "capacity"
        | "next_action"
        | "promise"
        | "recovery";
      detail: string;
    }[];
  }[];
};
export type ProjectData = import("./execution-controls.types").ExecutionControls & {
  controls?: ProjectControlSummary;
  holdHistory?: ProjectHoldHistoryEntry[];
  workflow?: import("./project-workflow").ProjectWorkflowState;
  roleAssignments?: ProjectRoleAssignment[];
  initiation?: ProjectInitiation;
  approvedMaterials?: ApprovedMaterialSelection[];
  designBaseline?: ProjectDesignBaseline;
  workPackages?: ProjectWorkPackage[];
  milestones?: {
    id: string;
    title: string;
    dueDate: string;
    baselineDate: string;
    ownerId: string;
    taskIds: string[];
    visibleToClient: boolean;
    acceptedAt?: string;
    evidence: string;
  }[];
  variations?: {
    direction?:"addition"|"deduction";
    quoteId: string;
    quoteHash?: string;
    currency?: string;
    releasedAt?: string;
    number: number;
    value: number;
    lines: ReleasedScopeLine[];
  }[];
  /** Immutable projection of commercial Change Cases released into execution. */
  changeCases?: {
    requestId: string;
    number: number;
    kind: string;
    quoteIds: string[];
    sourceLineIds: string[];
    releasedAt: string;
  }[];
  files?: {
    id: string;
    recordId: string;
    name: string;
    mimeType: string;
    bytes: number;
    sha256: string;
    by: string;
    at: string;
  }[];
  revision: number;
  phase: "planning" | "active" | "handover" | "completed";
  scope: {
    quoteId: string;
    quoteHash?: string;
    quoteNumber: number;
    definitionBaseline?: { id: string; number: number; hash: string };
    dealFileId?: string;
    dealFileReference?: string;
    releaseId?: string;
    releasedAt?: string;
    currency: string;
    value: number;
    lines: ReleasedScopeLine[];
  } | null;
  tasks: Task[];
  reports: DailyReport[];
  materials: Material[];
  orders: Order[];
  documents: ProjectDocument[];
  snags: Snag[];
  handovers: Handover[];
  comments: ProjectComment[];
  audit: ProjectAudit[];
  processed: string[];
  budget: number;
  forecast: number;
  financeClosed: boolean;
  financeEvidence: string;
};
export type ProjectResource = {
  id: string;
  name: string;
  kind: "crew" | "person" | "factory" | "vendor";
  members: string[];
  active: boolean;
  businessUnitId?: string | null;
  workspaceTeamId?: string | null;
  capacityMode?: "exclusive" | "pooled";
  capacity?: number;
  timezone?: string | null;
  version?: number;
  calendar?: import("./project-calendar").WorkCalendar;
};
export type ProjectBooking = {
  id: string;
  projectId: string;
  projectName: string;
  taskId: string;
  taskTitle: string;
  resourceId: string;
  start: string;
  end: string;
  status: import("./project-schedule-capacity").ScheduleBookingStatus;
  acknowledgement: string;
  units?: number;
  timezone?: string;
  version?: number;
  cancellationReason?: string | null;
  startTime?: string;
  endTime?: string;
};
export type ProjectExecutionAction = {
  id: string;
  kind:
    | "prepare_package"
    | "resolve_package"
    | "recover_task"
    | "resolve_task"
    | "inspect_task"
    | "resolve_design"
    | "resolve_booking"
    | "resolve_project_hold"
    | "resolve_project_risk"
    | "recover_project_promise"
    | "prepare_handover"
    | "complete_client_action"
    | "prepare_client_meeting"
    | "receive_factory_output"
    | "plan_factory_dispatch"
    | "review_factory_dispatch"
    | "record_dispatch"
    | "receive_dispatch"
    | "resolve_factory_rejection"
    | "start_task"
    | "review_report"
    | "correct_report"
    | "recover_site_update"
    | "review_site_incident"
    | "commission_site"
    | "review_commissioning"
    | "correct_commissioning"
    | "review_handover"
    | "correct_handover"
    | "recover_handover_commitment"
    | "resolve_warranty_claim"
    | "review_warranty_claim"
    | "confirm_order";
  priority: "critical" | "high" | "normal";
  title: string;
  detail: string;
  workPackageId?: string;
  taskId?: string;
  ownerId?: string;
  recordId: string;
};
export type ProjectExecutionPulse = {
  health: "clear" | "watch" | "attention" | "blocked";
  counts: {
    packages: number;
    readyPackages: number;
    activePackages: number;
    blockedPackages: number;
    overdueTasks: number;
    awaitingInspection: number;
  };
  nextActions: ProjectExecutionAction[];
};
export type ProjectState = {
  notifications?:{id:string;subject:string;body:string;deepLink:string;readAt:string|null;createdAt:string}[];
  timezone?:string;
  today?: string;
  workspaceId: string;
  id: string;
  caseId: string;
  name: string;
  customer: string;
  data: ProjectData;
  pulse: ProjectExecutionPulse;
  members: { id: string; name: string }[];
  sites?: { id: string; name: string; address: string }[];
  /** Active client contacts permitted to make portal acceptance decisions. */
  clientApprovers?: { id: string; name: string }[];
  resources: ProjectResource[];
  bookings: ProjectBooking[];
  /** Connected delivery projection; contains no employee leave or private HRMS fields. */
  connectedPlan?: ProjectConnectedPlan;
  memberId: string;
  canManage: boolean;
  canReview: boolean;
  canReport: boolean;
  canBuy: boolean;
  commercialReady: boolean;
};
export type PublicProject = {
  id: string;
  name: string;
  phase: string;
  stage: { key: string; name: string };
  progress: number;
  targetCompletion?: string;
  handoverDate?: string;
  promise?: string;
  milestones: {
    id: string;
    title: string;
    dueDate: string;
    acceptedAt?: string;
    progress: number;
  }[];
  reports: (Pick<
    DailyReport,
    "id" | "date" | "location" | "tomorrow" | "publishedAt"
  > & { work: { title: string; quantity: number; unit: string }[]; files?:{id:string;name:string;mimeType:string}[] })[];
  documents: Pick<
    ProjectDocument,
    "id" | "title" | "kind" | "revision" | "url"
  >[];
  handovers: (Pick<
    Handover,
    | "id"
    | "area"
    | "title"
    | "status"
    | "acceptedAt"
    | "warrantyUntil"
    | "outstanding"
    | "clientReviewDueDate"
  > & {
    canDecide?: boolean;
    canReportWarranty?: boolean;
    packet?: Pick<HandoverPacket, "id" | "version" | "tasks" | "documents">;
    outstandingItems: Pick<
      HandoverOutstandingItem,
      "id" | "title" | "kind" | "dueDate" | "status"
    >[];
  })[];
  warrantyClaims: Pick<
    Snag,
    "id" | "handoverId" | "title" | "area" | "severity" | "dueDate" | "status" | "reportedAt"
  >[];
};
