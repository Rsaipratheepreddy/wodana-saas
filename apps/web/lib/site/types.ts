export type SiteReportStatus = "draft" | "submitted" | "approved" | "returned";
export type Safety = "none" | "observation" | "incident";
export type Outlook = "none" | "watch" | "blocked";

export type Severity = "minor" | "major" | "critical";
/** How the day reached the client: still to send, kept internal, or sent. */
export type Delivery = "pending" | "internal" | "sent";
export type PhotoPhase = "before" | "after";
export type ReportPhoto = { id: string; name: string; shared?: boolean; areaId?: string | null; phase?: PhotoPhase | null; pairId?: string | null; forClient?: boolean };
export type ReportTask = { id: string; workItemId: string; number: number; title: string; progress: number; previous: number | null; note: string; hidden: boolean };
export type ReportNext = { id: string; workItemId: string | null; title: string; hidden: boolean };
export type ReportMaterial = { id: string; direction: "received" | "used"; description: string; quantity: string | null; unit: string; purchaseOrderId: string | null; stockTransferId: string | null };
export type IssueRaised = "snag" | "material" | "change_request";
export type ReportIssue = { id: string; severity: Severity; description: string; internal: boolean; raised: IssueRaised | null; workItemId: string | null; workItemNumber: number | null;
  changeRequestId?: string | null; status?: "open" | "resolved"; ownerId?: string | null; ownerName?: string | null; dueOn?: string | null; version?: number };

/** One person's day on a project's site. */
export type SiteReport = {
  id: string; reportDate: string; authorId: string; authorName: string; status: SiteReportStatus; weather: string; safety: Safety; safetyNote: string; forecast: Outlook; impact: string;
  recoveryOwnerId: string | null; recoveryOwnerName: string | null; recoveryOn: string | null; noWorkReason: string; notes: string; decidedByName: string | null; decisionNote: string; version: number; waitingFor: string[];
  workforce: Array<{ trade: string; people: number; hours?: string | null }>;
  lines: Array<{ id: string; boqLineId: string; title: string; unit: string; installed: string; note: string }>;
  photos: ReportPhoto[];
  submittedAt?: string | null; decidedAt?: string | null; updatedAt?: string;
  /** Submitted after the day's end-of-day time (or still not by then). */
  late?: boolean;
  clientSummary?: string; summarySource?: "none" | "template" | "ai" | "edited"; heroPhotoId?: string | null;
  delivery?: Delivery; sentAt?: string | null; sentByName?: string | null; sentAutomatically?: boolean;
  /** Sent, then taken off the client's page. */
  clientHidden?: boolean;
  tasks?: ReportTask[]; next?: ReportNext[]; materials?: ReportMaterial[]; issues?: ReportIssue[];
  reactions?: { like: number; love: number };
  /** Which client contacts reacted. */
  reactedBy?: { like: string[]; love: string[] };
};
/** A scope line with what approved reports installed and what submitted ones would add. */
export type SiteLine = { id: string; title: string; unit: string; quantity: string; supply: string | null; catalogItemId: string | null; areaName: string | null; installed: string; pending: string };
/** One of today's planned tasks (from the plan), with how far it is. */
export type TodayTask = {
  id: string; number: number; title: string; status: "todo" | "in_progress" | "in_review" | "done" | "cancelled"; progress: number | null; startDate: string | null; dueDate: string | null;
  overdue: boolean; packageName: string | null; assigneeName: string | null;
};
/** A recent delivery to the site a material can come on: an order for the project, or a stock move. */
export type SiteDelivery = { kind: "order" | "transfer"; id: string; label: string; on: string | null; received: boolean };
/** Something on its way to the site: an order still owing goods for the project, or a stock move. */
export type SiteState = {
  site: { startedOn: string | null; finishedOn: string | null }; reports: SiteReport[]; lines: SiteLine[]; members: Array<{ membershipId: string; name: string }>;
  today: string; me: string; canReport: boolean; canApprove: boolean; canManage: boolean;
  /** The Access view (who may be on site): the project's managers and site supervisors, and HR. */
  canSeeSiteAccess?: boolean;
  /** When the day's report is due (HH:MM, the workspace's time). */
  dueTime?: string;
  /** What the day's report starts from: today's planned work and the next working day's. */
  plan?: { today: TodayTask[]; tomorrow: { day: string; tasks: Array<{ id: string; title: string }> } };
  areas?: Array<{ id: string; name: string }>;
  deliveries?: SiteDelivery[];
  /** The last day's crew, to start today's from. */
  crew?: Array<{ trade: string; people: number; hours?: string | null }>;
  /** Worked days (the last two weeks) that ended without a submitted report. */
  missing?: string[];
  /** The day cards of the last four weeks, with the working days that have no report. */
  days?: DayFeed;
  /** PLM-065: what the client still owes before installation is signed off (finishing site work), while site work runs. */
  installationOwed?: InstallationOwed | null;
  /** Whoever manages projects may sign installation off while it's owed, with why. */
  canSignOffOwed?: boolean;
};

export type InstallationOwed = {
  stages: Array<{ id: string; title: string; amount: string; currency: string; state: "to_invoice" | "invoiced" | "reported" | "verified" }>;
  totals: Array<{ currency: string; amount: string }>;
};

/** A photo on the client's card: where it was taken, and the before/after it pairs with. */
export type CardPhoto = { id: string; area: string | null; phase: PhotoPhase | null; pairId: string | null };
/** Exactly what the client gets for a day (and, once sent, what they got). */
export type ClientView = {
  reportId: string; date: string;
  project: { name: string; reference: string | null; stage: string | null; stageNumber: number | null; stageCount: number | null; progress: number | null; handoverDate: string | null; daysToHandover: number | null };
  brand: { name: string; logoUrl: string | null; accentColor: string | null };
  summary: string; noWork: boolean; hero: CardPhoto | null; photos: CardPhoto[];
  completed: string[]; advanced: Array<{ title: string; progress: number }>; next: string[]; notes: string[];
};

/**
 * A progress report on paper: the client's card for a day (or the week's roll-up) and nothing else, built field by
 * field from the client view so nothing internal can be printed by accident.
 */
export type ProgressPrintData = {
  brand: { name: string; logoUrl: string | null };
  project: { name: string; reference: string | null };
  /** The day, or the last day of the week. */
  date: string;
  stage: { number: number; total: number; name: string | null } | null;
  percent: number | null;
  summary: string; noWork: boolean;
  /** The lead photo first. */
  photos: CardPhoto[];
  completed: string[]; advanced: Array<{ title: string; progress: number }>; next: string[]; notes: string[];
};

/** Home for the people who run projects: days to review, and sites without today's report after the end of the day. */
export type SiteAttention = {
  today: string; dueTime: string; pastDue: boolean;
  toReview: Array<{ reportId: string; projectId: string; reference: string; name: string; reportDate: string; authorName: string; summary: string; submittedAt: string; photos: number; photoId: string | null }>;
  missing: Array<{ projectId: string; reference: string; name: string; supervisor: string | null }>;
};

export type HandoverKind = "drawing" | "warranty" | "manual" | "care_guide" | "photo" | "other";
export type HandoverMethod = "signed_document" | "in_person" | "email" | "portal";
/** What the client receives for the whole project or some areas; frozen once issued. */
export type HandoverPack = {
  id: string; revision: number; title: string; areaIds: string[]; status: "draft" | "issued" | "accepted" | "refused"; replacesId: string | null; contentHash: string | null;
  issuedAt: string | null; issuedByName: string | null; decidedOn: string | null; decidedByName: string | null; decisionMethod: HandoverMethod | null; decisionNote: string; version: number;
  documents: Array<{ id: string; kind: HandoverKind; title: string; name: string; size: number; sha256: string }>;
  /** Money still due when it was accepted, and why it was accepted anyway (staff), in the project's currency. */
  balanceDue?: string | null; balanceCurrency?: string | null; balanceReason?: string | null;
  /** The file the client's decision came in, when staff recorded it. */
  decisionFiles?: Array<{ id: string; name: string; mimeType: string; hasPreview: boolean; uploadedAt: string }>;
};
export type HandoverState = {
  packs: HandoverPack[]; areas: Array<{ id: string; name: string }>; covered: boolean; canManage: boolean; open: { stages: string[]; snags: string[] };
  /** §0.3 P3: each pack's handover checklist (Setup → Questionnaires) and its answers. */
  checklists?: Record<string, import("@/lib/setup/questionnaires").QuestionnaireAnswers>;
  /** What the client still owes (agreed less verified receipts) and the milestones not invoiced yet. */
  balance?: { currency: string; due: string; toInvoice: Array<{ id: string; title: string; amount: string; dueDate: string | null }> };
  /** Whether this person may accept a handover while money is still due. */
  canAcceptBalance?: boolean;
};

export type Supply = "make" | "buy" | "ready_made" | "subcontract" | "client" | "site_work";
/** A scope line's warranty: from the handover it was accepted in, for its months. */
export type WarrantyItem = { lineId: string; title: string; areaName: string | null; supply: Supply | null; months: number; startsOn: string; endsOn: string; note: string; active: boolean };
export type ClaimStatus = "open" | "covered" | "not_covered" | "chargeable";
export type WarrantyClaim = {
  id: string; number: number; raisedOn: string; raisedByName: string; channel: "phone" | "email" | "visit" | "message" | "portal"; description: string; areaId: string | null; lineId: string | null;
  lineTitle: string | null; status: ClaimStatus; decisionNote: string; decidedByName: string | null; snagId: string | null; snagNumber: number | null; snagStatus: string | null; version: number;
  /** A chargeable claim's variation: its number and state, and the label it was applied as (VO-n). */
  variationId?: string | null; variationNumber?: number | null; variationStatus?: string | null; variationApplied?: string | null;
  /** Photos of the problem, recorded with the claim. */
  files?: Array<{ id: string; name: string; mimeType: string; hasPreview: boolean; uploadedAt: string }>;
};
export type WarrantyState = {
  items: WarrantyItem[]; claims: WarrantyClaim[]; lines: Array<{ id: string; title: string }>; areas: Array<{ id: string; name: string }>; today: string; canRecord: boolean; canManage: boolean;
  caseId?: string | null; baselineQuoteId?: string | null;
};
export type WarrantySettings = { months: Record<Supply, number>; canManage: boolean };

/** The phone's "My sites today": each running project I'm on whose site work runs today. */
export type SiteToday = {
  projectId: string; reference: string; name: string; report: { id: string; status: SiteReportStatus } | null; arriving: number; snags: number;
  /** Today's day card, when someone reported today. */
  card?: DayCard | null;
};

/** One report of a day, as its card shows it. */
export type DayReport = {
  id: string; authorId: string; authorName: string; status: SiteReportStatus; version: number;
  submittedAt: string | null; decidedAt: string | null; decidedByName: string | null; decisionNote: string;
  /** Submitted after the day's end-of-day time (or still not by then). */
  late: boolean;
  /** Written on a later day than the day it's for. */
  backdated: boolean;
  delivery: Delivery; sentAt: string | null; hidden: boolean;
  noWorkReason: string; notes: string; clientSummary: string;
  safety: Safety; safetyNote: string; forecast: Outlook; impact: string; recoveryOwnerName: string | null; recoveryOn: string | null;
  waitingFor: string[]; reactions: { like: number; love: number };
};
export type DayWork = {
  id: string; reportId: string; kind: "task" | "installed"; title: string; workItemId: string | null; number: number | null; progress: number | null; previous: number | null;
  stageId: string | null; stageName: string | null; packageName: string | null; area: string | null; quantity: string | null; unit: string; note: string; hidden: boolean;
};
export type DayPhoto = { id: string; reportId: string; area: string | null; phase: PhotoPhase | null; pairId: string | null; forClient: boolean; shared: boolean };
export type DayIssue = {
  id: string; reportId: string; severity: Severity; description: string; internal: boolean; status: "open" | "resolved"; ownerId: string | null; ownerName: string | null;
  dueOn: string | null; overdue: boolean; resolvedAt: string | null; resolvedByName: string | null; resolution: string; raised: IssueRaised | null; workItemId: string | null;
  workItemNumber: number | null; changeRequestId: string | null; changeRequestReference: string | null; version: number;
};
export type DayMaterial = { id: string; reportId: string | null; direction: "received" | "used"; description: string; quantity: string | null; unit: string;
  source: "report" | "delivery" | "stock"; reference: string | null };
/** A project's day on site: every report of the day in one card. */
export type DayCard = {
  date: string; status: SiteReportStatus; clientVisible: boolean; reports: DayReport[];
  crew: Array<{ trade: string; people: number; source: "report" | "crew_day" }>; people: number;
  work: DayWork[]; photos: DayPhoto[]; issues: DayIssue[]; materials: DayMaterial[];
  next: Array<{ id: string; reportId: string; title: string; workItemId: string | null; hidden: boolean }>;
  stageIds: string[]; trades: string[];
};
export type DayFeed = { from: string; to: string; today: string; cards: DayCard[]; missing: string[]; stages: Array<{ id: string; name: string }>; trades: string[] };

/** The "Progress report" PDF for a period: the client's card of each approved day, merged per day. */
export type ProgressReportDay = { date: string; summary: string; noWork: boolean; photos: CardPhoto[]; completed: string[]; advanced: Array<{ title: string; progress: number }>;
  next: string[]; notes: string[] };
export type ProgressReport = {
  brand: { name: string; logoUrl: string | null };
  project: { name: string; reference: string | null; stage: string | null; stageNumber: number | null; stageCount: number | null; progress: number | null; handoverDate: string | null };
  from: string; to: string; days: ProgressReportDay[];
};
export type SitesToday = { today: string | null; hour: number | null; dueTime?: string | null; sites: SiteToday[] };
