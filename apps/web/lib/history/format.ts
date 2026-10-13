import type { HistoryItem, HistoryLink, HistorySubject, HistoryVerb } from "@wodana/contracts/history";
import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";

/**
 * A history line as a sentence in the person's language: "Sara sent quotation Q-0012 V2 to Aisha Rahman",
 * "Layla verified the payment of AED 15,000.00". Every verb and subject has its own label; an unknown one (a newer
 * server than this page) reads as "updated the record", never as a code.
 */
const SUBJECTS: Record<HistorySubject, { the: MessageKey; named: MessageKey }> = {
  enquiry: { the: tKey("the enquiry"), named: tKey("enquiry {reference}") },
  opportunity: { the: tKey("the opportunity"), named: tKey("opportunity {reference}") },
  planning_case: { the: tKey("the planning case"), named: tKey("planning case {reference}") },
  brief: { the: tKey("the brief"), named: tKey("brief {reference}") },
  site_visit: { the: tKey("the site visit"), named: tKey("site visit {reference}") },
  design: { the: tKey("the design"), named: tKey("design {reference}") },
  material_list: { the: tKey("the material list"), named: tKey("material list {reference}") },
  quotation: { the: tKey("the quotation"), named: tKey("quotation {reference}") },
  deal_file: { the: tKey("the deal file"), named: tKey("deal file {reference}") },
  project: { the: tKey("the project"), named: tKey("project {reference}") },
  stage: { the: tKey("a stage"), named: tKey("stage {reference}") },
  drawing: { the: tKey("the drawings"), named: tKey("drawing {reference}") },
  material: { the: tKey("the materials"), named: tKey("material {reference}") },
  change_request: { the: tKey("the change request"), named: tKey("change request {reference}") },
  purchase_order: { the: tKey("the purchase order"), named: tKey("purchase order {reference}") },
  delivery: { the: tKey("a delivery"), named: tKey("delivery {reference}") },
  work_order: { the: tKey("the work order"), named: tKey("work order {reference}") },
  invoice: { the: tKey("the invoice"), named: tKey("invoice {reference}") },
  payment: { the: tKey("a payment"), named: tKey("payment {reference}") },
  finance_request: { the: tKey("the finance request"), named: tKey("finance request {reference}") },
  petty_cash_claim: { the: tKey("a petty cash claim"), named: tKey("petty cash claim {reference}") },
  supplier_invoice: { the: tKey("a supplier invoice"), named: tKey("supplier invoice {reference}") },
  price_request: { the: tKey("a price request"), named: tKey("price request {reference}") },
  snag: { the: tKey("a snag"), named: tKey("snag {reference}") },
  site_report: { the: tKey("the site report"), named: tKey("site report {reference}") },
  handover_pack: { the: tKey("the handover pack"), named: tKey("handover pack {reference}") },
  warranty_claim: { the: tKey("a warranty claim"), named: tKey("warranty claim {reference}") },
  task: { the: tKey("a task"), named: tKey("task {reference}") },
  appointment: { the: tKey("an appointment"), named: tKey("appointment {reference}") },
  message: { the: tKey("a message"), named: tKey("message {reference}") },
  approval: { the: tKey("an approval"), named: tKey("approval {reference}") },
  file: { the: tKey("a file"), named: tKey("file {reference}") },
  agreement: { the: tKey("the agreement"), named: tKey("agreement {reference}") },
  client_request: { the: tKey("a client request"), named: tKey("client request {reference}") },
  client: { the: tKey("the client's details"), named: tKey("client {reference}") },
  value_engineering: { the: tKey("value engineering"), named: tKey("value engineering {reference}") },
  timeline_question: { the: tKey("a timeline question"), named: tKey("timeline question {reference}") },
  record: { the: tKey("the record"), named: tKey("record {reference}") },
};

const VERBS: Record<HistoryVerb, MessageKey> = {
  created: tKey("{actor} created {subject}"),
  updated: tKey("{actor} updated {subject}"),
  removed: tKey("{actor} removed {subject}"),
  sent: tKey("{actor} sent {subject}"),
  submitted: tKey("{actor} submitted {subject} for approval"),
  approved: tKey("{actor} approved {subject}"),
  declined: tKey("{actor} declined {subject}"),
  decided: tKey("{actor} decided on {subject}"),
  verified: tKey("{actor} verified {subject}"),
  signed: tKey("{actor} signed {subject}"),
  requested_approval: tKey("{actor} asked for approval of {subject}"),
  requested_signature: tKey("{actor} sent {subject} to be signed"),
  sent_for_review: tKey("{actor} sent {subject} for review"),
  returned: tKey("{actor} returned {subject} with changes"),
  cancelled: tKey("{actor} withdrew {subject}"),
  closed: tKey("{actor} closed {subject}"),
  completed: tKey("{actor} completed {subject}"),
  started: tKey("{actor} started {subject}"),
  issued: tKey("{actor} issued {subject}"),
  raised: tKey("{actor} raised {subject}"),
  assigned: tKey("{actor} assigned {subject}"),
  reassigned: tKey("{actor} reassigned {subject}"),
  numbered: tKey("{actor} numbered {subject}"),
  uploaded: tKey("{actor} added a file to {subject}"),
  commented: tKey("{actor} commented on {subject}"),
  messaged: tKey("{actor} sent a message about {subject}"),
  logged_contact: tKey("{actor} logged contact on {subject}"),
  posted_update: tKey("{actor} posted an update on {subject}"),
  paid: tKey("{actor} recorded {subject}"),
  received: tKey("{actor} received {subject}"),
  scheduled: tKey("{actor} scheduled {subject}"),
  priced: tKey("{actor} priced {subject}"),
  applied: tKey("{actor} applied {subject}"),
  won: tKey("{actor} won {subject}"),
  lost: tKey("{actor} marked {subject} lost"),
  qualified: tKey("{actor} qualified {subject}"),
  held: tKey("{actor} put {subject} on hold"),
  reopened: tKey("{actor} reopened {subject}"),
  released: tKey("{actor} released {subject}"),
  dispatched: tKey("{actor} dispatched {subject}"),
  checked: tKey("{actor} checked {subject}"),
  confirmed: tKey("{actor} confirmed {subject}"),
  escalated: tKey("{actor} escalated {subject}"),
  expired: tKey("{subject} expired"),
  reacted: tKey("{actor} reacted to {subject}"),
  advanced: tKey("{actor} moved {subject} forward"),
  followed_up: tKey("{actor} followed up on {subject}"),
  not_sent: tKey("{actor} couldn't email {subject}"),
  credited: tKey("{actor} credited {subject}"),
  answered: tKey("{actor} answered {subject}"),
};

/** Field names the audit keeps, as people say them; other fields aren't listed (no raw names). */
const FIELDS: Record<string, MessageKey> = {
  status: tKey("Status"), title: tKey("Title"), name: tKey("Name"), amount: tKey("Amount"), total: tKey("Total"), probability: tKey("Probability"),
  forecast_category: tKey("Forecast"), forecastCategory: tKey("Forecast"), outcome_reason: tKey("Outcome"), outcomeReason: tKey("Outcome"), priority: tKey("Priority"),
  description: tKey("Description"), note: tKey("Note"), quantity: tKey("Quantity"), unit: tKey("Unit"), unitPrice: tKey("Unit price"), price: tKey("Price"),
  currency: tKey("Currency"), currency_code: tKey("Currency"), dueDate: tKey("Due date"), due_date: tKey("Due date"), expectedDate: tKey("Expected date"),
  expected_close_at: tKey("Expected close"), startDate: tKey("Start date"), start_date: tKey("Start date"), endDate: tKey("End date"), promise_date: tKey("Promised date"),
  handover: tKey("Handover"), handoverBefore: tKey("Handover"), handoverAfter: tKey("New handover"), deliverTo: tKey("Deliver to"), reference: tKey("Reference"),
  furniturePath: tKey("Furniture path"), materialsChange: tKey("Materials change"), severity: tKey("Severity"), progress: tKey("Progress"), owner: tKey("Owner"),
  location: tKey("Location"), nextActionAt: tKey("Next follow-up"), serviceType: tKey("Enquiry type"), source: tKey("Source"), channel: tKey("Channel"),
  summary: tKey("Description"), disqualificationReason: tKey("Reason"), displayName: tKey("Name"), primaryEmail: tKey("Email"), primaryMobile: tKey("Mobile"),
  primaryPhone: tKey("Phone"), reason: tKey("Reason"), decision: tKey("Decision"), step: tKey("Step"), percent: tKey("Share"), phase: tKey("Phase"), stage: tKey("Stage"),
};

export type HistoryFormat = { money: (value: string, currency: string) => string; date: (value: string) => string };

export function subjectPhrase(item: Pick<HistoryItem, "subject" | "reference">, t: Translate) {
  const subject = SUBJECTS[item.subject] ?? SUBJECTS.record;
  return item.reference ? t(subject.named, { reference: item.reference }) : t(subject.the);
}

export function actorName(actor: HistoryItem["actor"], t: Translate) {
  if (actor.kind === "client") return actor.name ? t("{name} (client)", { name: actor.name }) : t("The client");
  if (actor.kind === "system") return actor.name ?? t("Automation");
  return actor.name ?? t("Someone");
}

/** The line's sentence. Amount-led events say the amount ("verified the payment of AED 15,000.00"). */
export function historySentence(item: HistoryItem, t: Translate, format: HistoryFormat): string {
  const actor = actorName(item.actor, t);
  const subject = subjectPhrase(item, t);
  const amount = item.amount ? format.money(item.amount.value, item.amount.currency) : null;
  if (item.subject === "payment" && amount) {
    if (item.verb === "verified") return t("{actor} verified the payment of {amount}", { actor, amount });
    if (item.verb === "paid") return t("{actor} recorded a payment of {amount}", { actor, amount });
  }
  if (item.verb === "sent" && item.to) return t("{actor} sent {subject} to {to}", { actor, subject, to: item.to });
  const sentence = t(VERBS[item.verb] ?? VERBS.updated, { actor, subject });
  return sentence.charAt(0).toLocaleUpperCase() + sentence.slice(1);
}

/** Field changes people can read: known fields only, values as written (dates and codes made readable). */
export function historyChanges(item: HistoryItem, t: Translate, format: HistoryFormat) {
  const value = (raw: string | null) => {
    if (raw === null || raw === "") return "—";
    if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(raw)) return format.date(raw);
    if (raw === "true") return t("Yes");
    if (raw === "false") return t("No");
    return /^[a-z]+(_[a-z]+)+$|^[a-z]+$/.test(raw) ? (raw.charAt(0).toUpperCase() + raw.slice(1)).replace(/_/g, " ") : raw;
  };
  return item.changes.filter((change) => FIELDS[change.field]).map((change) => ({ field: t(FIELDS[change.field]), before: value(change.before), after: value(change.after) }));
}

/** Where a related record opens in the workspace (null when it has no page of its own). */
export function historyHref(link: HistoryLink): string | null {
  switch (link.type) {
    case "project": return `/workspace/projects/${link.id}/overview`;
    case "quotation": return link.caseId ? `/workspace/pre-projects/cases/${link.caseId}/quotations` : null;
    case "planning_case": case "case": return `/workspace/pre-projects/cases/${link.id}/overview`;
    case "purchase_order": return `/workspace/purchasing/orders?order=${link.id}`;
    case "work_order": return `/workspace/factory/orders?order=${link.id}`;
    case "site_report": return link.projectId ? `/workspace/projects/${link.projectId}/site?report=${link.id}` : null;
    case "snag": return link.projectId ? `/workspace/projects/${link.projectId}/site` : null;
    case "invoice": return `/workspace/finance/client-invoices?invoice=${link.id}`;
    case "finance_request": return `/workspace/finance/requests?request=${link.id}`;
    default: return null;
  }
}

const LINK_LABELS: Partial<Record<HistoryLink["type"], MessageKey>> = {
  project: tKey("Open the project"), quotation: tKey("Open the quotation"), planning_case: tKey("Open the planning case"), case: tKey("Open the planning case"),
  purchase_order: tKey("Open the purchase order"), site_report: tKey("Open the site report"), snag: tKey("Open the snag"), invoice: tKey("Open the invoice"),
  finance_request: tKey("Open the finance request"),
};
export function historyLinkLabel(link: HistoryLink, t: Translate) {
  return t(LINK_LABELS[link.type] ?? tKey("Open"));
}
