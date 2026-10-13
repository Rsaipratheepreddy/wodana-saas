import type { ClientPresentation } from "@/lib/proposals/client";
import type { DocumentLetterhead } from "../brand/letterhead";
/** The client portal as the business core returns it (services/business-core/src/client-portal). */

export const PORTAL_SECTIONS = ["progress", "moodboard", "designs", "decisions", "payments", "documents", "warranty", "meetings", "messages"] as const;
export type PortalSection = (typeof PORTAL_SECTIONS)[number];
export type PortalSections = Record<PortalSection, boolean>;

export type PortalSite = {
  slug: string;
  brand: { name: string; logoUrl: string | null; primaryColor: string | null; secondaryColor: string | null; headingFont: string | null; bodyFont: string | null };
  welcomeTitle: string;
  welcomeText: string;
  support: { phone: string; email: string; whatsapp: string };
  region: { locale: string; currency: string; timeZone: string; country: string | null };
  signIn: { channels: Array<"whatsapp" | "email">; demo: boolean };
  gallerySlug: string | null;
};

export type PortalQuoteLine = {
  id: string; deductsLineId: string | null; room: string; title: string; specification: string; material: string; finish: string; variantLabel: string | null;
  photo: string | null; dimensions: { length: number | null; height: number | null; depth: number | null; unit: string } | null; pricingMode: "item" | "materials";
  quantity: number; unit: string; rate: number; optional: boolean; optionPrice: number | null;
  materialRows: Array<{ id: string; name: string; type: string; specification: string; quantity: number; unit: string; rate: number; suppliedByClient: boolean }>;
  customMaterials: Array<{ id: string; name: string; brand: string; code: string; specification: string; suppliedByClient: boolean }>;
};

export type PortalQuote = {
  id: string; number: number; kind: "quotation" | "variation"; direction: "addition" | "deduction" | null; status: string; title: string; currency: string; validUntil: string;
  issuedAt: string | null; total: number; discount: number; taxRate: number; terms: string; exclusions: string; inclusions: string; hash: string | null; expired: boolean;
  canDecide: boolean; cover: Record<string, string | boolean | null> | null; presentation: unknown; brand: Record<string, string> | null; letterhead?: DocumentLetterhead | null;
  rooms: Array<{ id: string; name: string }>; paymentTerms: Array<{ id: string; title: string; percent: number; trigger: string }>; lines: PortalQuoteLine[];
  decision: null | { decision: "accept" | "changes" | "decline"; quoteHash: string; selectedOptionLineIds: string[]; baseTotal: number; optionsTotal: number;
    acceptedTotal: number | null; decidedAt: string; decidedBy: string; note: string };
  /** The quotation number (from the firm's numbering), once sent. */
  reference?: string | null;
  /** R3: how the price is made up, when the firm discloses its markup or works on a fee. */
  disclosure?: ClientPresentation | null;
};

export type PortalDesign = { id: string; title: string; type: string; number: number; status: string; dueAt: string | null; room: string | null; item: string | null; mimeType: string;
  /** A picture can be shown (its file is there). */
  hasPreview: boolean; canDecide: boolean };

/** A photo or PDF someone on the client's side added. */
export type PortalFile = { id: string; name: string; mimeType: string; hasPreview: boolean };

export type PortalDefinition = {
  id: string; number: number; message: string; publishedAt: string | null; status: string;
  brief: Record<"goals" | "propertyType" | "location" | "area" | "timeline" | "preferences" | "retainedItems" | "exclusions" | "constraints", string>;
  rooms: string[]; items: Array<{ title: string; room: string | null; quantity: number | null; unit: string; requirement: string; avoid: string }>;
  decision: { decision: string | null; decidedAt: string | null; note: string } | null; canDecide: boolean;
};

export type PortalMaterials = {
  id: string; number: number; status: "sent" | "signed_off" | "changes_requested"; sentAt: string; decidedAt: string | null; decidedBy: string | null;
  items: Array<{ id: string; name: string; specification: string; quantity: string | null; unit: string; areas: string[]; decision: "approved" | "rejected" | null; note: string }>;
  canDecide: boolean;
};

export type PortalHandover = {
  id: string; revision: number; title: string; status: "issued" | "accepted" | "refused"; areas: string[]; issuedAt: string; decidedOn: string | null; decidedBy: string | null;
  note: string; documents: Array<{ id: string; kind: string; title: string; mimeType: string }>; canDecide: boolean;
  /** Money still due on the project while the pack waits for the client's decision. */
  balance?: { currency: string; due: string } | null;
};

/** The technical drawings sent to the client (PLM-059): the drawing files, and their decision. */
export type PortalDrawings = {
  id: string; number: number; status: "sent" | "approved" | "changes_requested"; sentAt: string; decidedOn: string | null; decidedBy: string | null; note: string;
  files: Array<{ id: string; name: string; mimeType: string }>; canDecide: boolean;
};

export type PortalQuestion = {
  id: string; number: number; title: string; detail: string; dueDate: string | null; target: string; choices: Array<{ id: string; label: string }>;
  decision: { choiceLabel: string; note: string; decidedAt: string; decidedBy: string } | null; canDecide: boolean;
};

/** One payment milestone: what it is, when, how much, its invoice, what's received, and the client's own "I've paid" report. */
export type PortalMilestone = {
  id: string; title: string; amount: string | null; paid: string | null; left: string | null; dueDate: string | null;
  status: "paid" | "received" | "checking" | "part_paid" | "overdue" | "due" | "upcoming";
  invoice: { id: string; number: string; issueDate: string } | null;
  receipts: Array<{ id: string; amount: string | null; receivedOn: string | null }>;
  payUrl: string | null;
  report: null | { id: string; status: "submitted" | "recorded" | "not_received"; paidOn: string; reference: string; amount: string | null; at: string; reason: string; files: PortalFile[] };
  canReport: boolean;
};

/** A document card (E5-4): what it is, its version and date, whether it replaced one the client had, and whether a picture can be shown. */
export type PortalDocument = { id: string; kind: "agreement" | "design" | "handover" | "change"; title: string; group: string; date: string | null; mimeType: string;
  version?: number; changed?: boolean; hasPreview?: boolean; at?: string | null };

/** A change request (plan §6.20, R11): sent to the client to approve, or asked for by them and with the team until it's assessed. */
export type PortalChange = {
  id: string; reference: string; title: string; description: string; status: "with_team" | "waiting" | "approved" | "declined" | "withdrawn";
  raisedByClient: boolean; mine: boolean; createdAt: string; sharedAt: string | null;
  currency: string | null; priceImpact: string | null; timeImpactDays: number | null; handoverBefore: string | null; handoverAfter: string | null; designImpact: string;
  lines: Array<{ id: string; action: "add" | "omit" | "replace" | "draw"; title: string; room: string | null; quantity: string | null; unit: string; unitPrice: string | null; amount: string }>;
  decidedAt: string | null; decidedBy: string | null; method: "portal" | "signed_link" | null; declineNote: string | null; version: number; signed: boolean; canDecide: boolean;
  /** A change on a started project: priced as a variation (client prices only), and the stages and handover it moves, as sent. */
  price?: { net: string; tax: string; total: string; lines: Array<{ id: string; op: "add" | "omit" | "move"; title: string; area: string | null; quantity: string; unit: string; total: string }> } | null;
  time?: { handoverBefore: string | null; handoverAfter: string | null; stages: Array<{ name: string; delay: number }> } | null;
};

/** R1: agreed value + approved changes + allowance spend beyond what was included = forecast final (client prices only). */
export type PortalBudget = {
  currency: string; agreed: string; changesTotal: string; forecast: string; pendingTotal: string;
  changes: Array<{ kind: "variation" | "change_request"; id: string; reference: string | null; title: string; amount: string; decidedAt: string | null; method: string }>;
  allowances: Array<{ lineId: string; title: string; included: string; spent: string; over: string; left: string }>;
  allowanceIncluded: string; allowanceSpent: string; allowanceOverrun: string;
  pending: Array<{ id: string; reference: string; title: string; amount: string; status: string }>;
};

export type PortalFeedKind = "day" | "update" | "design" | "presentation" | "document" | "quote" | "change" | "invoice" | "payment" | "reply" | "handover" | "choice" | "minutes";

/** PLM-153: the folders of the client's Designs, in their order. */
export type PortalDesignGroup = "concepts" | "layouts" | "materials" | "renders" | "drawings";
/** A shared design file's state in the client's words: in review (or its time passed), decided, or shown as a presentation's option. */
export type PortalDesignFileStatus = "client_review" | "expired" | "approved" | "changes_requested" | "rejected" | "presented" | "chosen" | "shown";
/** PLM-153: one design in the client's Designs, its shared files newest first (earlier rounds after), each with its conversation. */
export type PortalFolderDesign = {
  id: string; title: string; room: string | null; sharedAt: string;
  files: Array<{ id: string; number: number; status: PortalDesignFileStatus; sharedAt: string; mimeType: string; hasPreview: boolean; canComment: boolean;
    comments: Array<{ id: string; at: string; text: string; fromClient: boolean; mine: boolean; author: string | null }> }>;
};

/** PLM-153: the notes of one meeting the team shared, its files and the conversation on it (the team reads as one team). */
export type PortalMeeting = {
  id: string; title: string; meetingAt: string | null; text: string; sharedAt: string; updatedAt: string | null;
  files: Array<{ id: string; name: string; mimeType: string; hasPreview: boolean }>;
  comments: Array<{ id: string; at: string; text: string; fromClient: boolean; author: string | null; mine: boolean }>;
};
/** One typed card of the home feed, newest first. */
export type PortalFeedCard = { kind: PortalFeedKind; id: string; at: string; title: string; note: string | null; status: string | null };
/** AI2: what happened since this contact last looked, by kind (null on a first visit). */
export type PortalDigest = { since: string; items: Array<{ kind: PortalFeedKind; count: number; titles: string[] }> };

export type PortalRequest = {
  id: string; number: number; title: string; detail: string; status: string; createdAt: string; resolution: string; files: PortalFile[];
  /** Whether the client's side opened the conversation (else the team did), who, and whether it was this contact. */
  fromClient?: boolean; author?: string | null; mine?: boolean;
  /** Oldest first. `author` names someone on the client's side (the team is never named); `seen` says the team has seen a client message. */
  comments: Array<{ id: string; at: string; text: string; fromClient: boolean; author?: string | null; mine?: boolean; seen?: boolean; files: PortalFile[] }>;
  /** Team replies the client hasn't opened yet. */
  unread: number;
  /** The team opened or answered the thread after the client's last message. */
  seenByTeam: boolean;
  lastAt: string;
};

export type PortalComment = { id: string; text: string; at: string; fromClient: boolean; mine: boolean; author: string | null };
export type PortalReaction = "like" | "dislike";

/** Concept and material boards the team shared, the inspirations they chose to show, and the client's own. */
export type PortalMoodboard = {
  boards: Array<{ id: string; title: string; room: string | null; number: number; status: string; mimeType: string; sharedAt: string; hasImage: boolean;
    reaction: PortalReaction | null; comments: PortalComment[] }>;
  pins: Array<{ id: string; title: string; note: string; link: string | null; room: string | null; addedAt: string; feeling: "love" | "avoid"; fromClient: boolean; mine: boolean;
    author: string | null; photos: Array<{ id: string }>; reaction: PortalReaction | null; comments: PortalComment[] }>;
  canAdd: boolean;
};

export type PortalIssue = { id: string; number: number; raisedOn: string; description: string; area: string | null; status: "to_triage" | "accepted" | "declined" | "fixed";
  reason: string; files: PortalFile[] };

/** A delivery to site the client confirms access for, or asks to move (D-29). */
export type PortalSiteAccess = { id: string; date: string; items: string; status: "waiting" | "confirmed" | "move_asked"; clientReason: string | null; clientDate: string | null;
  movedFrom: string | null; moveReason: string | null; chargeable: boolean; version: number };

export type PortalCardPhoto = { id: string; area: string | null; phase: "before" | "after" | null; pairId: string | null };
/** A day on site as the team sent it to the client. */
export type PortalDayCard = {
  id: string; date: string; sentAt: string; summary: string; noWork: boolean; hero: PortalCardPhoto | null; photos: PortalCardPhoto[];
  completed: string[]; advanced: Array<{ title: string; progress: number }>; next: string[]; notes: string[];
  reactions: { like: number; love: number }; mine: { like: boolean; love: boolean };
  /** Where the project stood that day (the stage's name and the percent when the tenant shows stage names). */
  stage?: { number: number; total: number; name: string | null } | null; percent?: number | null;
};

export type PortalStep = { kind: "quote" | "design" | "definition" | "materials" | "drawings" | "handover" | "request" | "invoice" | "site_access" | "change" | "presentation" | "choice"; id: string; title: string;
  due: string | null };

export type PortalUpdateFrequency = "weekly" | "fortnightly" | "monthly" | "off";
export type PortalUpdates = { mode: "call" | "portal"; frequency: PortalUpdateFrequency; version: number };

/** Someone the client deals with: their project manager, designer or sales contact (one person may be two). */
export type PortalTeamRole = "manager" | "designer" | "sales";
export type PortalTeamMember = { roles: PortalTeamRole[]; name: string; email: string | null; avatar: string | null };

export type PortalProject = {
  id: string; title: string; reference: string | null; role: "approver" | "viewer"; status: "planning" | "active" | "on_hold" | "completed" | "cancelled"; paused: boolean;
  sections: PortalSections; manager: string | null; stage: { number: number; total: number; name: string | null } | null;
  /** Planned handover, while the work is on. */
  handoverDate: string | null;
  /** When it was handed over, once complete, and the last day of its warranty. */
  handedOverOn: string | null; warrantyUntil: string | null;
  /** Where the project is (its site's address, or the area given when the client first asked). */
  address?: string | null;
  /** When the work started, when the tenant shows dates. */
  startDate?: string | null;
  /** The client's project manager, designer and sales contact. */
  team?: PortalTeamMember[];
  rooms: Array<{ id: string; name: string }>;
  next: PortalStep[];
  /** Team replies the client hasn't read, across conversations. */
  unread: number;
  latestUpdate: { id: string; at: string; text: string } | null;
  /** How the client hears how the work goes (PLM-046): a call or a portal update, and how often; null until the team sets it up. */
  updates?: PortalUpdates | null;
  progress: null | {
    stages: Array<{ name: string | null; state: "done" | "current" | "upcoming"; startedOn: string | null; finishedOn: string | null }>;
    updates: Array<{ id: string; at: string; text: string }>;
    photoDays: Array<{ on: string; photos: Array<{ id: string }> }>;
    /** The days the team sent, each as it went: words, photos, what was finished and what's next, and the reactions. */
    cards?: PortalDayCard[];
    /** The week's days in one digest (the firm's weekly roll-up). */
    weeks?: Array<{ id: string; weekEnding: string; digest: string }>;
    /** How far the whole project is, in percent (with stage names shown). */
    percent?: number | null;
    issues: PortalIssue[]; canReportIssue: boolean;
    siteAccess: PortalSiteAccess[];
  };
  moodboard: PortalMoodboard | null;
  decisions: null | { quotes: PortalQuote[]; designs: PortalDesign[]; requests: PortalQuestion[]; definition: PortalDefinition | null; materials: PortalMaterials | null; handovers: PortalHandover[]; drawings?: PortalDrawings | null };
  payments: null | { currency: string | null; showAmounts: boolean; milestones: PortalMilestone[];
    /** Paid and still to pay across the plan (exact decimals), when the tenant shows amounts. */
    totals?: { paid: string; left: string } | null };
  documents: PortalDocument[] | null;
  warranty: null | {
    rooms: Array<{ id: string | null; name: string | null; until: string; active: boolean; items: Array<{ id: string; title: string; until: string; active: boolean }> }>;
    claims: Array<{ id: string; number: number; raisedOn: string; description: string; status: "open" | "covered" | "not_covered" | "chargeable"; reason: string; files: PortalFile[] }>;
    areas: Array<{ id: string; name: string }>; lines: Array<{ id: string; title: string; areaId: string | null }>; canClaim: boolean;
  };
  messages: null | { requests: PortalRequest[]; unread: number };
  /** PLM-153: the notes of the meetings the team shared, newest meeting first. */
  meetings?: null | { meetings: PortalMeeting[] };
  /** PLM-153: every design file shared with the client, by stage. */
  designs?: null | { groups: Array<{ key: PortalDesignGroup; designs: PortalFolderDesign[] }> };
  /** Shared designs with their pinned comment threads, one conversation with the design team (plan §6.7a). */
  design?: PortalDesignReview | null;
  /** Concept presentations to choose from and the materials and decisions to confirm (plan §6.7a). */
  choices?: PortalDesignChoices | null;
  /** Change requests sent to the client or raised by them (R11). */
  changes?: PortalChange[] | null;
  /** The client's budget tracker (R1), when amounts are shown. */
  budget?: PortalBudget | null;
  /** The home feed: typed cards, newest first. */
  feed?: PortalFeedCard[];
  /** What changed since this contact last looked (AI2). */
  digest?: PortalDigest | null;
};

/** A tax invoice as the client prints it. */
export type PortalInvoiceDocument = {
  number: string; issueDate: string; dueDate: string; currency: string; milestone: string; reference: string | null;
  company: { name: string; address: string; taxNumber: string }; customer: { name: string; address: string; taxNumber: string };
  lines: Array<{ description: string; taxRate: string; net: string; tax: string; total: string }>;
  net: string; tax: string; total: string; paid: string; balance: string; note: string; status: "credited" | "paid" | "overdue" | "due";
  credit: { number: string | null; on: string | null } | null;
  /** The issuing business's letterhead (PLM-112). */
  letterhead?: DocumentLetterhead | null;
};
export type PortalReceiptDocument = { id: string; milestone: string; amount: string; currency: string; receivedOn: string | null; invoiceNumber: string | null; company: string; customer: string | null;
  letterhead?: DocumentLetterhead | null };

export type PortalView = { contact: { name: string; nameConfirmed: boolean; phone: string }; today: string; projects: PortalProject[] };

/** Staff side. */
export type PortalSettings = {
  workspaceId: string; slug: string; enabled: boolean; version: number; sections: PortalSections;
  progress: { stageNames: boolean; dates: boolean; updates: boolean; photos: boolean }; invoiceAmounts: boolean;
  welcomeTitle: string; welcomeText: string; support: { phone: string; email: string; whatsapp: string };
};

export type PortalContact = {
  id: string; name: string; confirmedName: string | null; phone: string; email: string | null; role: "approver" | "viewer"; active: boolean; testContact: boolean;
  lastSignedInAt: string | null; version: number; signedIn: boolean;
  /** They sign in with a demonstration code an admin set; no code is sent to them. */
  demoCode: boolean;
};

export type InviteDelivery = "sent" | "not_configured" | "failed" | "suppressed";
export type ClientAccessStatus = "not_invited" | "invited" | "active" | "revoked";
/** Why the client can't be invited right now. */
export type InviteBlock = "portal_off" | "paused" | "no_client" | "no_phone" | "no_email";

/** The project's client and their place in the portal: invited, active (last visit), revoked, or what stops an invite. */
export type ClientAccess = {
  name: string | null; phone: string | null; email: string | null; grantId: string | null; partyId: string | null;
  status: ClientAccessStatus; invitedAt: string | null; expiresAt: string | null; delivery: InviteDelivery | null; lastVisitAt: string | null;
  version: number; resendAfter: number; blocked: InviteBlock | null;
  /** They sign in with a demonstration code an admin set; no code is sent to them. */
  demoCode: boolean;
};

export type ProjectPortal = {
  enabled: boolean; sections: PortalSection[]; access: { sections: PortalSection[] | null; paused: boolean; pausedAt: string | null; version: number };
  contacts: PortalContact[]; caseId: string; canManage: boolean; canSetDemoCode: boolean; portalUrl: string; client: ClientAccess;
};

/** What the client did, for the team (Planning and Projects). */
export type StaffBoardComment = { id: string; targetKind: "pin" | "design"; targetId: string; text: string; at: string; fromClient: boolean; author: string };
export type StaffMoodboard = {
  /** Moodboard pins (brief entry ids) shown in the client's portal. */
  shared: string[];
  /** When each shown pin was shared with the client, by pin. */
  sharedAt?: Record<string, string>;
  /** Whether the client can see the moodboard at all (the portal is on and shows it for this project). */
  portalOpen?: boolean;
  reactions: Array<{ targetKind: "pin" | "design"; targetId: string; reaction: "like" | "dislike"; by: string; at: string }>;
  comments: StaffBoardComment[];
  /** Concept and material boards the client can see (design version ids). */
  boards: Array<{ id: string; designId: string; title: string; number: number; room: string | null }>;
  canEdit: boolean;
};
export type StaffPaymentReport = {
  id: string; caseId: string; paymentId: string; milestone: string | null; status: "submitted" | "recorded" | "not_received"; paidOn: string; reference: string;
  amount: string | null; currency: string | null; note: string; reason: string; at: string; grantName: string; files: PortalFile[]; decidedBy: string | null; decidedAt: string | null;
  version: number;
};
export type StaffIssue = {
  id: string; number: number; raisedOn: string; description: string; area: string | null; areaId: string | null; status: "to_triage" | "accepted" | "declined";
  severity: "minor" | "major" | "critical" | null; reason: string; by: string; snagId: string | null; version: number; decidedBy: string | null; files: PortalFile[];
};
export type StaffThreads = { files: Record<string, PortalFile[]>; clientRead: Record<string, string>;
  /** Which client contact raised each conversation (from their portal command). */
  raisedBy?: Record<string, string> };

/** What an invitation link opens: the client's number ready to sign in, or a link that no longer works. */
export type PortalInvite = { status: "valid"; name: string; phone: string } | { status: "expired" };

export type PortalDesignThread = {
  id: string; anchor: { x: number; y: number } | null; status: "open" | "resolved"; version: number; fromClient: boolean; mine: boolean; at: string; resolvedAt: string | null; canResolve: boolean;
  messages: Array<{ id: string; text: string; at: string; fromClient: boolean; mine: boolean; author: string | null }>;
};
export type PortalDesignReview = {
  designs: Array<{ id: string; title: string; type: string; board: boolean; room: string | null; item: string | null; sharedAt: string;
    versions: Array<{ id: string; number: number; status: string; dueAt: string | null; sharedAt: string; mimeType: string; hasPreview: boolean; latest: boolean; canDecide: boolean; canComment: boolean;
      threads: PortalDesignThread[] }> }>;
};
export type PortalPresentation = {
  id: string; stage: string; label: string; round: number; status: "presented" | "chosen" | "changes_requested"; version: number; presentedAt: string | null;
  chosenOptionId: string | null; decidedAt: string | null; decidedByName: string | null; decisionNote: string | null; canDecide: boolean;
  options: Array<{ id: string; title: string; note: string; linkUrl: string | null; versionId: string | null; versionNumber: number | null; mimeType: string | null; hasPreview: boolean }>;
};
export type PortalChoice = {
  entryId: string; kind: "material" | "design"; room: string | null; versionId: string; number: number; title: string; specification: string; quantity: string | null; unit: string;
  unitPrice: string | null; currency: string | null; priceImpact: string; timeImpactDays: number; afterLock: boolean; status: "proposed" | "confirmed" | "declined" | "superseded";
  confirmedAt: string | null; confirmedByName: string | null; changed: boolean; canDecide: boolean;
  /** When this version was recorded. */
  recordedAt?: string;
  /** R2: up to three alternatives offered after the client declined this choice. */
  alternatives?: PortalAlternative[];
};
export type PortalAlternative = { id: string; title: string; unit: string; unitPrice: string | null; currency: string | null; lineTotal: string | null; inStock: boolean; inBudget: boolean;
  fromPastJobs: boolean; canChoose: boolean };
export type PortalDesignChoices = { presentations: PortalPresentation[]; choices: PortalChoice[]; locked: boolean; currency: string | null };
