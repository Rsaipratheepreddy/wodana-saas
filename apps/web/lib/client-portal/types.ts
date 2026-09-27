/** The client portal as the business core returns it (services/business-core/src/client-portal). */

export const PORTAL_SECTIONS = ["progress", "decisions", "payments", "documents", "warranty", "messages"] as const;
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

export type PortalDesign = { id: string; title: string; type: string; number: number; status: string; dueAt: string | null; room: string | null; item: string | null; mimeType: string; canDecide: boolean };

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
};

export type PortalQuestion = {
  id: string; number: number; title: string; detail: string; dueDate: string | null; target: string; choices: Array<{ id: string; label: string }>;
  decision: { choiceLabel: string; note: string; decidedAt: string; decidedBy: string } | null; canDecide: boolean;
};

export type PortalInvoice = {
  id: string; number: string; milestone: string; issueDate: string; dueDate: string; currency: string; total: string | null; paid: string | null; balance: string | null;
  status: "paid" | "due" | "overdue" | "credited"; receipts: Array<{ amount: string | null; receivedOn: string | null }>;
};

export type PortalMilestone = {
  id: string; title: string; amount: string | null; paid: string | null; dueDate: string | null; status: "paid" | "part_paid" | "overdue" | "due" | "upcoming";
  invoiceNumber: string | null; payUrl: string | null;
};

export type PortalDocument = { id: string; kind: "agreement" | "design" | "handover"; title: string; group: string; date: string | null; mimeType: string };

export type PortalRequest = {
  id: string; number: number; title: string; detail: string; status: string; createdAt: string; resolution: string;
  comments: Array<{ id: string; at: string; text: string; fromClient: boolean }>;
};

export type PortalStep = { kind: "quote" | "design" | "definition" | "materials" | "handover" | "request" | "invoice"; id: string; title: string; due: string | null };

export type PortalProject = {
  id: string; title: string; reference: string | null; role: "approver" | "viewer"; status: "planning" | "active" | "on_hold" | "completed" | "cancelled"; paused: boolean;
  sections: PortalSections; manager: string | null; stage: { number: number; total: number; name: string | null } | null; handoverDate: string | null; next: PortalStep[];
  latestUpdate: { id: string; at: string; text: string } | null;
  progress: null | {
    stages: Array<{ name: string | null; state: "done" | "current" | "upcoming"; startedOn: string | null; finishedOn: string | null }>;
    updates: Array<{ id: string; at: string; text: string }>;
    photoDays: Array<{ on: string; photos: Array<{ id: string }> }>;
  };
  decisions: null | { quotes: PortalQuote[]; designs: PortalDesign[]; requests: PortalQuestion[]; definition: PortalDefinition | null; materials: PortalMaterials | null; handovers: PortalHandover[] };
  payments: null | { currency: string | null; showAmounts: boolean; invoices: PortalInvoice[]; schedule: PortalMilestone[] };
  documents: PortalDocument[] | null;
  warranty: null | {
    items: Array<{ id: string; title: string; area: string | null; startsOn: string; endsOn: string; active: boolean }>;
    claims: Array<{ id: string; number: number; raisedOn: string; description: string; status: "open" | "covered" | "not_covered" | "chargeable"; reason: string }>;
    areas: Array<{ id: string; name: string }>; lines: Array<{ id: string; title: string; areaId: string | null }>; canClaim: boolean;
  };
  messages: null | { requests: PortalRequest[] };
};

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
};

export type ProjectPortal = {
  enabled: boolean; sections: PortalSection[]; access: { sections: PortalSection[] | null; paused: boolean; pausedAt: string | null; version: number };
  contacts: PortalContact[]; caseId: string; canManage: boolean; portalUrl: string; client: ClientAccess;
};

/** What an invitation link opens: the client's number ready to sign in, or a link that no longer works. */
export type PortalInvite = { status: "valid"; name: string; phone: string } | { status: "expired" };
