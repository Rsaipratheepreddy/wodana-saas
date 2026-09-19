import type { Quote, QuoteLine } from "./types";
export const statusLabel: Record<string, string> = {
  draft: "Draft",
  internal_review: "Internal review",
  internal_approved: "Ready to issue",
  issued: "Awaiting client",
  accepted: "Accepted",
  changes_requested: "Changes requested",
  declined: "Declined",
  superseded: "Replaced",
  withdrawn: "Withdrawn",
  open: "Open",
  under_review: "Under review",
  awaiting_decision: "Awaiting decision",
  resolved: "Resolved",
  pending: "Upcoming",
  proof_submitted: "Proof submitted",
  verified: "Verified",
  executed: "Signed agreement verified",
  submitted: "Submitted",
  approved: "Approved",
  returned: "Returned",
  rejected: "Rejected",
  proposed: "Proposed",
  client_review: "Client review",
};
export function money(value: number, currency = "AED") {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
export const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function paymentMilestoneAmounts(total: number, terms: { percent: number }[]) {
  const complete = Math.abs(terms.reduce((s, t) => s + t.percent, 0) - 100) < .001;
  let allocated = 0;
  return terms.map((term, i) => {
    const amount = complete && i === terms.length - 1 ? roundMoney(total - allocated) : roundMoney(total * term.percent / 100);
    allocated = roundMoney(allocated + amount);
    return amount;
  });
}
export function quoteTotals(q: Pick<Quote, "lines" | "discount" | "taxRate">) {
  const round = roundMoney;
  const includedLines = q.lines.filter((line) => !line.optional);
  const subtotal = round(
      includedLines.reduce((sum, l) => sum + round(l.quantity * l.rate), 0),
    ),
    cost = round(
      includedLines.reduce((s, l) => s + round(l.quantity * (l.unitCost ?? 0)), 0),
    ),
    net = round(subtotal - q.discount),
    tax = round((net * q.taxRate) / 100);
  return {
    subtotal,
    cost,
    net,
    tax,
    total: round(net + tax),
    margin: net ? ((net - cost) / net) * 100 : 0,
  };
}
export function quoteSelectionTotals(
  q: Pick<Quote, "lines" | "discount" | "taxRate" | "total">,
  selectedOptionLineIds: string[],
) {
  const selected = new Set(selectedOptionLineIds);
  const selectedTotals = quoteTotals({
    ...q,
    lines: q.lines.map((line) =>
      line.optional && selected.has(line.id)
        ? { ...line, optional: false }
        : line,
    ),
  });
  return {
    baseTotal: roundMoney(q.total),
    optionsTotal: roundMoney(selectedTotals.total - q.total),
    acceptedTotal: selectedTotals.total,
  };
}
export function acceptedQuoteTotals(q: Quote) {
  const selected = new Set(
    q.clientDecision?.decision === "accept"
      ? q.clientDecision.selectedOptionLineIds
      : [],
  );
  return quoteTotals({
    ...q,
    lines: q.lines.map((line) =>
      line.optional && selected.has(line.id)
        ? { ...line, optional: false }
        : line,
    ),
  });
}
export function acceptedQuoteValue(q: Quote) {
  return q.clientDecision?.decision === "accept" &&
    q.clientDecision.acceptedTotal !== undefined
    ? q.clientDecision.acceptedTotal
    : q.total;
}
export function newLine(room = "General"): QuoteLine {
  return {
    id: crypto.randomUUID(),
    room,
    title: "New item",
    specification: "",
    material: "",
    finish: "",
    quantity: 1,
    unit: "nos",
    unitCost: 0,
    rate: 0,
  };
}
export async function jsonRequest<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await r.json().catch(() => null);
  if (!r.ok)
    throw new Error(
      data?.message ?? "Could not complete this action. Please try again.",
    );
  return data;
}
export function commercialPath(workspaceId: string, path: string) {
  return `/api/commercial/${path}?workspaceId=${workspaceId}`;
}
export function changedLines(
  current: Pick<Quote, "lines">,
  previous?: Pick<Quote, "lines">,
) {
  if (!previous) return [];
  const changes: string[] = [];
  for (const l of current.lines) {
    const old = previous.lines.find((o) => o.id === l.id);
    if (!old) changes.push(`Added: ${l.title}`);
    else if (JSON.stringify(l) !== JSON.stringify(old))
      changes.push(`Updated: ${l.title}`);
  }
  for (const l of previous.lines)
    if (!current.lines.some((n) => n.id === l.id))
      changes.push(`Removed: ${l.title}`);
  return changes;
}

export function paymentIsVerified(
  payment: {
    status: string;
    invoice?: {
      accountId?: string;
      balance: number;
      refreshedAt: string;
      lastError?: string;
    };
  },
  now = Date.now(),
) {
  if (payment.status !== "verified") return false;
  if (!payment.invoice) return true;
  const checked = Date.parse(payment.invoice.refreshedAt);
  return (
    Boolean(payment.invoice.accountId) &&
    payment.invoice.balance === 0 &&
    !payment.invoice.lastError &&
    Number.isFinite(checked) &&
    checked <= now &&
    now - checked <= 86400000
  );
}
