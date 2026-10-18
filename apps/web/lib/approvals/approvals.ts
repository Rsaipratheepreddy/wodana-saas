import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";
import type { ApprovalGroup, ApprovalKind, ApprovalRow } from "../../../../services/business-core/src/approvals/approval-sources";

export type { ApprovalGroup, ApprovalKind, ApprovalRow };
export type WaitingForYou = { rows: ApprovalRow[]; count: number; counts: Record<ApprovalGroup, number> };

/** The chips, in the order people think of the work. */
export const APPROVAL_FILTERS: Array<{ id: "all" | ApprovalGroup; label: MessageKey }> = [
  { id: "all", label: tKey("All") },
  { id: "designs", label: tKey("Designs") },
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

/** A row's title: what deciding it does, then the record ("Verify payment · On handover", "Review site report · 28 Sep 2026"). */
export const APPROVAL_ACTION: Record<ApprovalKind, MessageKey> = {
  quote_review: tKey("Review quote · {subject}"),
  receipt: tKey("Verify payment · {subject}"),
  agreement: tKey("Verify agreement · {subject}"),
  deal_finance: tKey("Check deal · {subject}"),
  deal_approval: tKey("Approve deal · {subject}"),
  order: tKey("Approve order · {subject}"),
  output: tKey("Approve output · {subject}"),
  material_swap: tKey("Approve material swap · {subject}"),
  site_report: tKey("Review site report · {subject}"),
  petty_cash: tKey("Approve petty cash · {subject}"),
  snag: tKey("Close snag · {subject}"),
  warranty: tKey("Review warranty claim · {subject}"),
  stock_correction: tKey("Approve stock correction · {subject}"),
  bill: tKey("Release bill · {subject}"),
  payment_run: tKey("Approve payment run · {subject}"),
  reimbursement: tKey("Reimburse · {subject}"),
  invoice: tKey("Issue invoice · {subject}"),
  ai_action: tKey("Review AI app change · {subject}"),
  approval: tKey("Approve · {subject}"),
  qs_review: tKey("Confirm pricing · {subject}"),
  design_review: tKey("Review design · {subject}"),
};

/** An approval's title in the person's language: the action, then the record as people read it. */
export function approvalHeading(t: Translate, row: Pick<ApprovalRow, "kind" | "title">, locale?: string) {
  const subject = approvalTitle(row, locale);
  const action = APPROVAL_ACTION[row.kind as ApprovalKind];
  return action && subject ? t(action, { subject }) : subject;
}

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

/**
 * A row's files as links the review opens, each through its module's own file route (a project file, a client's
 * upload, a site photo, a petty-cash receipt, a supplier bill, an opportunity's proof, a request's or change's file,
 * or a file added to the decision).
 */
export function approvalFileLinks(workspaceId: string, row: ApprovalRow) {
  const query = (preview: boolean) => new URLSearchParams({ workspaceId, ...(preview ? { preview: "1" } : {}) }).toString();
  const url = (file: NonNullable<ApprovalRow["files"]>[number], preview: boolean) => {
    switch (file.store) {
      case "case_asset": return `/api/workspace/pre-projects/${file.owner}/assets/${file.id}?${query(preview)}`;
      case "client_file": return `/api/client-portal-admin/cases/${file.owner}/files/${file.id}?${query(preview)}`;
      case "site_photo": return `/api/site/projects/${file.owner}/photos/${file.id}?${query(preview)}`;
      case "petty_cash_receipt": return `/api/petty-cash/claims/${file.id}/receipt?${query(false)}`;
      case "bill": return `/api/payables/bills/${file.id}/file?${query(false)}`;
      case "opportunity_proof": return `/api/workspace/crm/opportunity-proofs/${file.owner}/${file.id}?${query(preview)}`;
      case "request_file": return `/api/finance-requests/requests/${file.owner}/files/${file.id}?${query(false)}`;
      case "change_file": return `/api/project-changes/${file.owner}/files/${file.id}?${query(preview)}`;
      case "evidence": return `/api/workspace/evidence/${file.id}?${query(preview)}`;
    }
  };
  return row.files?.map((file) => ({ id: `${file.store}:${file.id}`, name: file.name, href: url(file, false), previewHref: file.preview ? url(file, true) : null }));
}
