import { describeAction, type HistoryCategory, type HistoryVerb } from "./history-actions";
import type { HistoryRecordType, RecordFacts } from "./history-records";

/**
 * One line of a record's history as the web shows it: who, what (a verb about a thing), when, and the facts worth
 * reading (its number, an amount, a note, fields before → after, related records). Never the raw action code; ids
 * appear only inside `links` for building hrefs.
 */
export const HISTORY_SUBJECTS = [
  "enquiry", "opportunity", "planning_case", "brief", "site_visit", "design", "material_list", "quotation", "deal_file", "project", "stage", "drawing", "material",
  "change_request", "purchase_order", "delivery", "work_order", "invoice", "payment", "finance_request", "petty_cash_claim", "supplier_invoice", "price_request", "snag",
  "site_report", "handover_pack", "warranty_claim", "task", "appointment", "message", "approval", "file", "agreement", "client_request", "client", "value_engineering",
  "timeline_question", "record",
] as const;
export type HistorySubject = (typeof HISTORY_SUBJECTS)[number];

export type HistoryLink = { type: HistoryRecordType | "case"; id: string; caseId?: string | null; projectId?: string | null };
export type HistoryChange = { field: string; before: string | null; after: string | null };
export type HistoryItem = {
  id: string;
  occurredAt: string;
  verb: HistoryVerb;
  category: HistoryCategory;
  subject: HistorySubject;
  reference: string | null;
  actor: { id: string | null; name: string | null; roles: string[]; preset: string | null; kind: "person" | "client" | "system" };
  amount: { value: string; currency: string } | null;
  note: string | null;
  to: string | null;
  changes: HistoryChange[];
  links: HistoryLink[];
};

export type AuditRow = {
  id: string; action: string; entityType: string; entityId: string | null; source: string; occurredAt: string;
  before: unknown; after: unknown; actorId: string | null; actorName: string | null; actorRoles: string[] | null; actorPreset: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : null);

/** What the event is about, from where it was written and its action. */
export function historySubject(entityType: string, action: string, after: Record<string, unknown>, recordType?: HistoryRecordType): HistorySubject {
  const code = action.replace(/\.v\d+$/, "");
  const kind = text(after.kind);
  switch (entityType) {
    case "crm_lead": case "crm_enquiry": return "enquiry";
    case "crm_party": return "client";
    case "crm_opportunity":
      if (code === "finance_request_raised") return "finance_request";
      // PLM-155: a timeline question asked, answered or withdrawn on the opportunity.
      if (/\.timeline_check_[a-z]+$/.test(code)) return "timeline_question";
      if (/payment_proof/.test(code)) return "payment";
      if (/(intro|site_visit)_booked$/.test(code)) return "appointment";
      return "opportunity";
    case "crm_activity": return /appointment/.test(code) || ["meeting", "appointment", "site_visit", "call"].includes(text(after.type) ?? "") ? "appointment" : "task";
    case "crm_conversation": case "crm_message": case "crm_client_message": return "message";
    case "commercial_case":
      if (/^CR-/.test(text(after.number) ?? "")) return "change_request";
      if (/client_message$|client_question/.test(code)) return "message";
      if (/owner_review|deal_finance/.test(code)) return "deal_file";
      if (/payment|verify_credit/.test(code)) return "payment";
      if (/agreement/.test(code)) return "agreement";
      if (/change_case|change_variations|change_dispositions/.test(code)) return "change_request";
      if (/^commercial\.(request|update_request)$/.test(code)) return "client_request";
      if (/material_approval/.test(code)) return "material_list";
      if (/^commercial\.release$/.test(code)) return "project";
      return "quotation";
    case "commercial_deal_file": return "deal_file";
    case "pre_project_brief": return "brief";
    case "pre_project_site_record": return "site_visit";
    case "pre_project_design": case "design_package": return "design";
    case "design_ledger_entry": case "pre_project_item_specification": return "material_list";
    case "approval_request":
      return kind === "quote_qs" ? "quotation" : kind === "deal_file" ? "deal_file" : kind === "change_request" ? "change_request" : kind === "refund" ? "finance_request"
        : kind === "purchase_order" ? "purchase_order" : recordType === "purchase_order" ? "purchase_order" : "approval";
    case "change_request": return "change_request";
    case "purchase_order": return "purchase_order";
    case "goods_receipt": return "delivery";
    case "work_order": return "work_order";
    case "work_item": return recordType === "snag" || text(after.type) === "snag" ? "snag" : "task";
    case "client_invoice": return "invoice";
    case "finance_request": return "finance_request";
    case "petty_cash_claim": return "petty_cash_claim";
    case "supplier_invoice": return "supplier_invoice";
    case "supplier_payment": return "payment";
    case "price_request": return "price_request";
    case "site_report": return "site_report";
    case "pre_project_case":
      if (code.startsWith("change_request.")) return "change_request";
      // PLM-147: a value engineering round on the job's estimate.
      if (/^quotation\.value_engineering_/.test(code)) return "value_engineering";
      if (/^(quotation|commercial)\.|quote_decision$/.test(code)) return "quotation";
      if (/design|moodboard|board_comment|^client_portal\.react$/.test(code)) return "design";
      if (/report_payment$/.test(code)) return "payment";
      if (/file_added$/.test(code)) return "file";
      if (/^client_portal\.(comment|request|read_thread)$/.test(code)) return "message";
      if (/^client_calls\./.test(code)) return "appointment";
      return "planning_case";
    case "project": case "delivery_project":
      if (code === "finance_request_raised") return "finance_request";
      if (/raise_issue$/.test(code)) return "snag";
      if (/^site\./.test(code)) return after.reportId ? "site_report" : "project";
      if (/daily_report/.test(code)) return "site_report";
      if (/handover/.test(code)) return "handover_pack";
      if (/warranty/.test(code)) return "warranty_claim";
      if (/drawing/.test(code)) return "drawing";
      if (/material/.test(code)) return "material";
      if (/complete_stage$/.test(code)) return "stage";
      if (/^logistics\./.test(code)) return "delivery";
      if (/schedule\.updated$|^work\./.test(code)) return "task";
      return "project";
    default: return "record";
  }
}

/** Ids, versions, hashes and timestamps people don't read; objects and lists aren't compared field by field. */
const SKIPPED = /(^id$|Id$|_id$|^version$|hash$|Hash$|^sha256$|_at$|At$|^workspace|^commandId$|^replayed$|^via$|^seal$)/;

/** Field-level before → after for edits where the audit kept both sides (scalars only, at most eight). */
export function fieldChanges(before: unknown, after: unknown): HistoryChange[] {
  const left = record(before), right = record(after);
  if (!Object.keys(left).length || !Object.keys(right).length) return [];
  const scalar = (value: unknown) => value === null || ["string", "number", "boolean"].includes(typeof value);
  const shown = (value: unknown) => (value === null || value === undefined || value === "" ? null : typeof value === "string" && UUID.test(value) ? undefined : String(value));
  const changes: HistoryChange[] = [];
  for (const field of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (SKIPPED.test(field) || !(field in left) || !(field in right)) continue;
    if (!scalar(left[field]) || !scalar(right[field]) || left[field] === right[field]) continue;
    const from = shown(left[field]), to = shown(right[field]);
    if (from === undefined || to === undefined || from === to) continue;
    changes.push({ field, before: from, after: to });
    if (changes.length === 8) break;
  }
  return changes;
}

function amountOf(after: Record<string, unknown>) {
  const currency = text(after.currency) ?? text(after.currency_code) ?? text(after.currencyCode);
  const value = text(after.total) ?? text(after.amount) ?? text(after.priceImpact) ?? text(after.totalAmount);
  return currency && value && /^-?\d+(\.\d+)?$/.test(value) ? { value, currency } : null;
}

function linksOf(after: Record<string, unknown>, entityType: string, recordType: HistoryRecordType, recordId: string, facts: RecordFacts): HistoryLink[] {
  const onSite = entityType === "project" || entityType === "site_report";
  const caseId = text(after.caseId) ?? facts.caseId;
  const projectId = text(after.projectId) ?? facts.projectId;
  const candidates: Array<[HistoryLink["type"], string | null, Partial<HistoryLink>]> = [
    ["project", text(after.projectId), {}],
    ["quotation", text(after.quoteId) && caseId ? caseId : null, { caseId }],
    ["purchase_order", text(after.orderId), {}],
    ["invoice", text(after.invoiceId), {}],
    ["site_report", onSite ? text(after.reportId) : null, { projectId }],
    ["snag", onSite ? text(after.issueId) : null, { projectId }],
    ["finance_request", text(after.financeRequestId), {}],
  ];
  const links: HistoryLink[] = [];
  for (const [type, id, extra] of candidates) {
    if (!id || !UUID.test(id) || (type === recordType && id === recordId)) continue;
    if (type === "quotation" && (recordType === "quotation" || recordType === "planning_case")) continue;
    if (type === "project" && recordType === "project") continue;
    if (!links.some((link) => link.type === type && link.id === id)) links.push({ type, id, ...extra });
  }
  return links;
}

const COSTS = /cost|margin|markup|commission/i, VALUES = /amount|value|price|total|budget/i, NOTES = /(^|\.)internalNotes$|^notes?$/i;

/**
 * What a reader may not see taken out: costs and margins never show in a history; values only with `values` (the
 * opportunity value permission); internal notes only with `notes` (PLM-024).
 */
export function redactItem(item: HistoryItem, may: { values: boolean; notes: boolean }): HistoryItem {
  const changes = item.changes.filter((change) => !COSTS.test(change.field) && (may.values || !VALUES.test(change.field)) && (may.notes || !NOTES.test(change.field)));
  return { ...item, amount: may.values ? item.amount : null, note: may.notes || !["enquiry", "client"].includes(item.subject) ? item.note : null, changes };
}

export function toHistoryItem(row: AuditRow, recordType: HistoryRecordType, recordId: string, facts: RecordFacts, own: string[]): HistoryItem {
  const after = record(row.after), before = record(row.before);
  const { verb, category } = describeAction(row.action);
  const isOwn = own.includes(row.entityType) && row.entityId === recordId;
  const subject = historySubject(row.entityType, row.action, after, recordType);
  const stage = subject === "stage" && text(after.stage) ? text(after.stage)!.replace(/[_-]+/g, " ").replace(/^\w/, (first) => first.toUpperCase()) : null;
  // A timeline question is about the record it's on: "Sam asked a timeline question", not "… question O-0049".
  const reference = subject === "timeline_question" ? null : stage ?? (isOwn ? facts.reference :text(after.number) ?? (row.entityType === "approval_request" && text(after.subjectId) === recordId ? facts.reference : null));
  // A log entry kept by name (the commercial case's) is a person's when it names one.
  const actorKind = row.source === "client_portal" ? "client" : row.actorId || text(after.by) ? "person" : "system";
  const decision = text(after.decision);
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    verb: verb === "decided" && decision ? (/^(approved?|accept(ed)?)$/i.test(decision) ? "approved" : /^(declined?|reject(ed)?)$/i.test(decision) ? "declined" : verb) : verb,
    category,
    subject,
    reference,
    actor: { id: row.actorId, name: row.actorName ?? text(after.by) ?? text(after.signer) ?? text(record(after.signer).name) ?? null, roles: row.actorRoles ?? [], preset: row.actorPreset, kind: actorKind },
    amount: amountOf(after),
    note: text(after.note) ?? text(after.reason) ?? text(after.declineNote) ?? null,
    to: verb === "sent" ? text(after.signer) ?? text(after.to) : null,
    changes: fieldChanges(before, after),
    links: linksOf(after, row.entityType, recordType, recordId, facts),
  };
}
