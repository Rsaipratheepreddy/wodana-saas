import { tKey, type MessageKey } from "@/lib/i18n/keys";
import type { ApprovalGroup, ApprovalKind, ApprovalRow } from "../../../../services/business-core/src/approvals/approval-sources";

export type { ApprovalGroup, ApprovalKind, ApprovalRow };
export type WaitingForYou = { rows: ApprovalRow[]; count: number; counts: Record<ApprovalGroup, number> };

/** The chips, in the order people think of the work. */
export const APPROVAL_FILTERS: Array<{ id: "all" | ApprovalGroup; label: MessageKey }> = [
  { id: "all", label: tKey("All") },
  { id: "quotes", label: tKey("Quotes") },
  { id: "payments", label: tKey("Payments") },
  { id: "deals", label: tKey("Deals") },
  { id: "orders", label: tKey("Orders") },
  { id: "factory", label: tKey("Factory") },
  { id: "site", label: tKey("Site") },
  { id: "stock", label: tKey("Stock") },
  { id: "finance", label: tKey("Finance") },
  { id: "ai", label: tKey("AI apps") },
];

/** What the row asks for, in a word or two. */
export const KIND_LABEL: Record<ApprovalKind, MessageKey> = {
  quote_review: tKey("Quote to review"),
  receipt: tKey("Payment to verify"),
  agreement: tKey("Agreement to verify"),
  deal_finance: tKey("Deal to check"),
  deal_approval: tKey("Deal to approve"),
  order: tKey("Order to approve"),
  output: tKey("Output to approve"),
  material_swap: tKey("Material swap"),
  site_report: tKey("Daily progress"),
  petty_cash: tKey("Petty cash"),
  snag: tKey("Snag to close"),
  warranty: tKey("Warranty claim"),
  stock_correction: tKey("Stock correction"),
  bill: tKey("Held bill"),
  payment_run: tKey("Payment run"),
  reimbursement: tKey("To reimburse"),
  invoice: tKey("To invoice"),
  ai_action: tKey("AI app change"),
};

/** The colour of the type chip: sales purple, money in green, spend amber, issues red, site and factory teal, quotes blue. */
export const KIND_HUE: Record<ApprovalKind, 1 | 2 | 3 | 4 | 5 | 6> = {
  quote_review: 1, receipt: 3, agreement: 2, deal_finance: 2, deal_approval: 2, order: 4, output: 6, material_swap: 6,
  site_report: 6, petty_cash: 4, snag: 5, warranty: 5, stock_correction: 6, bill: 4, payment_run: 4, reimbursement: 4, invoice: 3, ai_action: 2,
};

/** The title of a milestone to invoice (D-14), sent by the server as a phrase to translate. */
export const INVOICE_PHRASE = tKey("Issue invoice · {milestone}");

/** The button for the in-row approval, in the words of the record. */
export function approveLabel(kind: ApprovalKind): MessageKey {
  // A daily report approved in the row goes to the client as reviewed.
  return kind === "receipt" ? tKey("Verify") : kind === "site_report" ? tKey("Approve & send") : tKey("Approve");
}

export const OTHER_LABEL: Record<"return" | "reject", MessageKey> = { return: tKey("Return"), reject: tKey("Refuse") };

/** How long it has waited, in the largest whole unit: "3 hours", "2 days". */
/** What the row is, as people read it: a site report is its day ("28 Sep 2026"), not the stored date. */
export function approvalTitle(row: Pick<ApprovalRow, "kind" | "title">, locale?: string) {
  if (row.kind !== "site_report" || !/^\d{4}-\d{2}-\d{2}$/.test(row.title)) return row.title;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${row.title}T00:00:00Z`));
}

export function waitingSince(since: string, now: Date, locale?: string) {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000));
  const format = (value: number, unit: Intl.RelativeTimeFormatUnit) =>
    new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(value);
  if (minutes < 60) return format(Math.max(1, minutes), "minute");
  if (minutes < 60 * 24) return format(Math.floor(minutes / 60), "hour");
  return format(Math.floor(minutes / (60 * 24)), "day");
}

export function filterRows(rows: ApprovalRow[], filter: "all" | ApprovalGroup) {
  return filter === "all" ? rows : rows.filter((row) => row.group === filter);
}

const path = (workspaceId: string, query: Record<string, string> = {}) => `/api/workspace/approvals?${new URLSearchParams({ workspaceId, ...query })}`;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Could not load what's waiting for you.");
  return payload as T;
}

export const approvalsApi = (workspaceId: string) => ({
  mine: () => request<WaitingForYou>(path(workspaceId)),
  count: () => request<{ count: number; counts: Record<ApprovalGroup, number> }>(path(workspaceId, { count: "1" })),
  decide: (row: Pick<ApprovalRow, "kind" | "id">, decision: "approve" | "return" | "reject", note = "") =>
    request<WaitingForYou>(path(workspaceId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: row.kind, id: row.id, decision, note }) }),
});
