/**
 * The client portal as the business core returns it (services/business-core/src/client-portal): the client's side of
 * apps/web/lib/client-portal/types.ts, kept in step with it (the web file imports through the web's `@/` paths, which
 * the app can't resolve). The app reads the same read model as the web portal; nothing here is the app's own.
 */

export const PORTAL_SECTIONS = ["progress", "moodboard", "decisions", "payments", "documents", "warranty", "messages"] as const;
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
  canDecide: boolean; cover: Record<string, string | boolean | null> | null; presentation: unknown; brand: Record<string, string> | null;
  rooms: Array<{ id: string; name: string }>; paymentTerms: Array<{ id: string; title: string; percent: number; trigger: string }>; lines: PortalQuoteLine[];
  decision: null | { decision: "accept" | "changes" | "decline"; quoteHash: string; selectedOptionLineIds: string[]; baseTotal: number; optionsTotal: number;
    acceptedTotal: number | null; decidedAt: string; decidedBy: string; note: string };
  /** The quotation number (from the firm's numbering), once sent. */
  reference?: string | null;
  /** R3: how the price is made up (shown on the web; the app opens the quotation there). */
  disclosure?: unknown;
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
};

/** R1: agreed value + approved changes + allowance spend beyond what was included = forecast final (client prices only). */
export type PortalBudget = {
  currency: string; agreed: string; changesTotal: string; forecast: string; pendingTotal: string;
  changes: Array<{ kind: "variation" | "change_request"; id: string; reference: string | null; title: string; amount: string; decidedAt: string | null; method: string }>;
  allowances: Array<{ lineId: string; title: string; included: string; spent: string; over: string; left: string }>;
  allowanceIncluded: string; allowanceSpent: string; allowanceOverrun: string;
  pending: Array<{ id: string; reference: string; title: string; amount: string; status: string }>;
};

export type PortalFeedKind = "day" | "update" | "design" | "presentation" | "document" | "quote" | "change" | "invoice" | "payment" | "reply" | "handover" | "choice";
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

export type PortalStep = { kind: "quote" | "design" | "definition" | "materials" | "handover" | "request" | "invoice" | "site_access" | "change" | "presentation" | "choice"; id: string; title: string;
  due: string | null };

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
  decisions: null | { quotes: PortalQuote[]; designs: PortalDesign[]; requests: PortalQuestion[]; definition: PortalDefinition | null; materials: PortalMaterials | null; handovers: PortalHandover[] };
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
};
export type PortalReceiptDocument = { id: string; milestone: string; amount: string; currency: string; receivedOn: string | null; invoiceNumber: string | null; company: string; customer: string | null };

export type PortalView = { contact: { name: string; nameConfirmed: boolean; phone: string }; today: string; projects: PortalProject[] };

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
