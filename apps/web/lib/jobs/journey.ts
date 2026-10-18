import { tKey, type MessageKey } from "@/lib/i18n/keys";

/** §0.3 P2: a job's journey from enquiry to warranty (services/business-core/src/jobs/job-journey.ts). */
export type JourneyChapter = "win" | "design" | "price" | "make" | "install" | "care";
export type JourneyLane = "client" | "sales" | "design" | "finance" | "delivery";
export type JourneyStepState = "done" | "now" | "next" | "upcoming" | "skipped";
export type JourneyStep = {
  key: string; chapter: JourneyChapter; lane: JourneyLane; label: string; state: JourneyStepState;
  doneAt: string | null; doneBy: string | null; dueAt: string | null; href: string | null; note?: string | null;
};
export type JourneyView = {
  jobId: string; reference: string; title: string | null; client: string | null;
  chapters: Array<{ key: JourneyChapter; state: "done" | "now" | "upcoming" | "skipped"; done: number; total: number }>;
  lanes: JourneyLane[];
  steps: JourneyStep[];
  now: (JourneyStep & { owner: string | null; doneWhen: string }) | null;
  next: JourneyStep[];
  value: { amount: string; currency: string } | null;
  targetDate: string | null;
};

export const CHAPTER_LABEL: Record<JourneyChapter, MessageKey> = {
  win: tKey("Win"), design: tKey("Design"), price: tKey("Price"), make: tKey("Make"), install: tKey("Install"), care: tKey("Care"),
};
/** Each chapter's chip colour, the same on every screen (list, job page, map, portal): calm hues only, never a state colour. */
export const CHAPTER_HUE: Record<JourneyChapter, 1 | 2 | 6> = { win: 1, design: 2, price: 6, make: 1, install: 2, care: 6 };
export const LANE_LABEL: Record<JourneyLane, MessageKey> = {
  client: tKey("Client"), sales: tKey("Sales"), design: tKey("Design team"), finance: tKey("Finance"), delivery: tKey("Delivery"),
};
export const STATE_LABEL: Record<JourneyStepState, MessageKey> = {
  done: tKey("Done"), now: tKey("Now"), next: tKey("Next"), upcoming: tKey("Later"), skipped: tKey("Not in this job"),
};

/** The step labels the server sends, as message keys (the server's words are the English keys). */
export const STEP_LABELS = [
  tKey("Enquiry received"), tKey("First contact"), tKey("Converted to opportunity"), tKey("Intro booked"), tKey("Intro held"), tKey("Intro outcome"),
  tKey("Proposal 1 sent"), tKey("Proposal 1 accepted"), tKey("Design fee paid"), tKey("Quotation priced"), tKey("Quotation sent"), tKey("Quotation accepted"),
  tKey("Agreement signed"), tKey("Upfront payment"), tKey("Deal approved"), tKey("Project started"), tKey("Made and bought"), tKey("Handover"), tKey("Warranty"),
  tKey("Not part of this job"), tKey("Lost"),
] as const;

/** The chapters in order, each with the steps that belong to it (the map's bands). */
export function chapterBands(view: Pick<JourneyView, "chapters" | "steps">) {
  return view.chapters.map((chapter) => ({ ...chapter, steps: view.steps.filter((step) => step.chapter === chapter.key) }))
    .filter((band) => band.steps.length > 0);
}

/** §0.3 P4: a job's documents: every send with its state now, and every signature (e-signature or portal code). */
export type SendState = "failed" | "sent" | "delivered" | "opened" | "signed";
export type JobDocuments = {
  sends: Array<{ id: string; kind: string; title: string; channel: "whatsapp" | "email"; recipient: string; state: SendState; reason: string; sentAt: string; sentBy: string | null;
    openedAt: string | null; signedAt: string | null }>;
  signatures: Array<{ id: string; title: string; signer: string; signedAt: string; method: "esign" | "portal_code"; verifiedBy: string | null; device: string | null;
    fingerprint: string | null; decision: string | null }>;
};

/** §0.3 P8: the job's money statement (the server's single calculation; amounts are exact decimal strings). */
export type JobMoney = {
  currency: string; agreed: string; received: string; due: string; credit: string; overdue: string; unallocated: string;
  next: { id: string; title: string; amount: string; dueDate: string | null } | null;
  lines: Array<{ id: string; kind: "design" | "quotation" | "addition" | "deduction"; title: string; number: number; agreed: string; scheduled: string }>;
  milestones: Array<{ id: string; title: string; quoteId: string | null; amount: string; received: string; remaining: string; dueDate: string | null; overdue: boolean }>;
  checks: Array<{ kind: "schedule_gap"; quoteId: string; title: string; difference: string } | { kind: "not_posted" | "posted_differently"; receiptId: string; amount: string; posted: string | null }>;
};

/** §0.3 P8/P9: the job's supplier side (internal; the server's single calculation, exact decimal strings). */
export type JobCosts = {
  currency: string; committed: string; billed: string; paid: string; toPay: string;
  orders: Array<{ id: string; number: string; supplier: string; status: string; committed: string; billed: string }>;
  bills: Array<{ id: string; number: string; supplier: string; status: string; date: string; total: string; paid: string; remaining: string; shared: boolean }>;
  otherCurrency: number;
  checks: Array<{ kind: "billed_over_order"; orderNumber: string; description: string; ordered: string; billed: string }
    | { kind: "bill_not_posted" | "bill_posted_differently"; number: string; total: string; posted: string | null }
    | { kind: "payment_not_posted"; reference: string; amount: string }>;
};

/** §0.3: the job's team thread (staff only). */
export type JobThread = {
  messages: Array<{ id: string; kind: "message" | "event"; author: { id: string; name: string } | null; body: string; mentions: string[]; eventCode: string | null; at: string; mine: boolean }>;
  people: Array<{ membershipId: string; name: string; role: string | null }>;
  unread: number; lastReadAt: string | null;
};

/** §0.3: one row of the Jobs list, summarised from its journey. */
export type JobRow = {
  id: string; reference: string; title: string | null; client: string | null; chapter: JourneyChapter | null;
  now: { label: string; owner: string | null; dueAt: string | null; late: boolean } | null;
  progress: { done: number; total: number }; value: { amount: string; currency: string } | null; targetDate: string | null;
};
