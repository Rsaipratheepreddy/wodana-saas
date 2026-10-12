/**
 * A record's history as Business Core serves it (`GET /workspaces/:id/history/:recordType/:recordId`) and the web
 * shows it. Business Core keeps its own copies of these lists (src/history/*); history-contract.spec.ts there checks
 * they match.
 */
export const HISTORY_RECORD_TYPES = [
  "lead", "opportunity", "planning_case", "design", "quotation", "deal_file", "project", "change_request", "purchase_order", "work_order",
  "invoice", "finance_request", "snag", "site_report",
] as const;
export type HistoryRecordType = (typeof HISTORY_RECORD_TYPES)[number];

export const HISTORY_FILTERS = ["all", "changes", "messages", "approvals"] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export const HISTORY_VERBS = [
  "created", "updated", "removed", "sent", "submitted", "approved", "declined", "decided", "verified", "signed", "requested_approval",
  "requested_signature", "sent_for_review", "returned", "cancelled", "closed", "completed", "started", "issued", "raised", "assigned", "reassigned",
  "numbered", "uploaded", "commented", "messaged", "logged_contact", "posted_update", "paid", "received", "scheduled", "priced", "applied", "won",
  "lost", "qualified", "held", "reopened", "released", "dispatched", "checked", "confirmed", "escalated", "expired", "reacted", "advanced", "followed_up", "not_sent",
] as const;
export type HistoryVerb = (typeof HISTORY_VERBS)[number];
export type HistoryCategory = "change" | "message" | "approval";

export const HISTORY_SUBJECTS = [
  "enquiry", "opportunity", "planning_case", "brief", "site_visit", "design", "material_list", "quotation", "deal_file", "project", "stage", "drawing", "material",
  "change_request", "purchase_order", "delivery", "work_order", "invoice", "payment", "finance_request", "petty_cash_claim", "supplier_invoice", "price_request", "snag",
  "site_report", "handover_pack", "warranty_claim", "task", "appointment", "message", "approval", "file", "agreement", "client_request", "record",
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
export type HistoryPage = { items: HistoryItem[]; next: string | null; timeZone: string };
