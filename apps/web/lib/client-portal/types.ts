/** The client portal as the business core returns it (services/business-core/src/client-portal). */

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

export type PortalDocument = { id: string; kind: "agreement" | "design" | "handover"; title: string; group: string; date: string | null; mimeType: string };

export type PortalRequest = {
  id: string; number: number; title: string; detail: string; status: string; createdAt: string; resolution: string; files: PortalFile[];
  comments: Array<{ id: string; at: string; text: string; fromClient: boolean; files: PortalFile[] }>;
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

export type PortalStep = { kind: "quote" | "design" | "definition" | "materials" | "handover" | "request" | "invoice" | "site_access"; id: string; title: string; due: string | null };

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
export type StaffThreads = { files: Record<string, PortalFile[]>; clientRead: Record<string, string> };

/** What an invitation link opens: the client's number ready to sign in, or a link that no longer works. */
export type PortalInvite = { status: "valid"; name: string; phone: string } | { status: "expired" };
