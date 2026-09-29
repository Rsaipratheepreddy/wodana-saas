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
export type ReportIssue = { id: string; severity: Severity; description: string; internal: boolean; raised: "snag" | "material" | null; workItemId: string | null; workItemNumber: number | null };

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
};
export type HandoverState = {
  packs: HandoverPack[]; areas: Array<{ id: string; name: string }>; covered: boolean; canManage: boolean; open: { stages: string[]; snags: string[] };
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
};
export type WarrantyState = {
  items: WarrantyItem[]; claims: WarrantyClaim[]; lines: Array<{ id: string; title: string }>; areas: Array<{ id: string; name: string }>; today: string; canRecord: boolean; canManage: boolean;
  caseId?: string | null; baselineQuoteId?: string | null;
};
export type WarrantySettings = { months: Record<Supply, number>; canManage: boolean };

/** The phone's "My sites today": each running project I'm on whose site work runs today. */
export type SiteToday = {
  projectId: string; reference: string; name: string; report: { id: string; status: SiteReportStatus } | null; arriving: number; snags: number;
};
export type SitesToday = { today: string | null; hour: number | null; dueTime?: string | null; sites: SiteToday[] };
