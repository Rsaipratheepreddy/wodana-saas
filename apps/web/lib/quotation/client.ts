import type { ProposalKit, Quote } from "@/lib/commercial/types";
import type { AiProposal, BoqPick, BuilderState, QuoteColumn, QuoteDocument, QuoteTemplate, CatalogHit, LineOp, PaymentMilestone, QuoteAnchor, QuoteDiscount, QuotePerson, QuoteThread } from "./types";

/** The firm's own quote columns (workspace-wide). */
export const quoteColumnsApi = (workspaceId: string) => ({
  add: (id: string, name: string, kind: "text" | "number") => request<{ columns: QuoteColumn[] }>(quotationPath(workspaceId, "columns"), "POST", { id, name, kind }),
  change: (id: string, change: { name?: string; archived?: boolean; showInProposal?: boolean; version: number }) => request<{ columns: QuoteColumn[] }>(quotationPath(workspaceId, `columns/${id}`), "PATCH", change),
});

/** The firm's proposal kit (workspace-wide): read by anyone who sees quotes, changed field by field. */
export const proposalKitApi = (workspaceId: string) => ({
  get: () => request<{ kit: ProposalKit; canManage: boolean }>(quotationPath(workspaceId, "proposal-kit")),
  change: (change: Partial<Omit<ProposalKit, "version">> & { version: number }) => request<ProposalKit>(quotationPath(workspaceId, "proposal-kit"), "PUT", change),
});

export const quotationPath = (workspaceId: string, path: string, query?: Record<string, string>) =>
  `/api/quotation/${path}?${new URLSearchParams({ workspaceId, ...query })}`;

export class QuotationRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new QuotationRequestError(typeof data?.message === "string" ? data.message : "Could not update the quotation.", response.status);
  return data as T;
}

/**
 * What sending a quote delivered: it is always in the client's portal; `channel` is how they were told
 * (WhatsApp, email, or not at all), `emailed` who got the email, `reason` why nothing went out.
 */
/** Sharing a sent quote (Q-9): its portal link, the client contacts WhatsApp can reach, and the message. */
export type QuoteShare = { portalUrl: string | null; contacts: Array<{ id: string; name: string; phone: string; decides: boolean }>; message: string; canResend: boolean };

export type IssueDelivery = { portal: true; channel: "whatsapp" | "email" | null; emailed: string[]; reason: string | null; decider: string; deciderHasEmail: boolean };

/** The builder's calls for one quote. */
export function quoteApi(workspaceId: string, caseId: string, quoteId: string) {
  const base = `cases/${caseId}/quotes/${encodeURIComponent(quoteId)}`;
  return {
    load: () => request<BuilderState>(quotationPath(workspaceId, base)),
    apply: (ops: LineOp[]) => request<BuilderState>(quotationPath(workspaceId, `${base}/lines`), "POST", { ops }),
    discount: (input: Omit<QuoteDiscount, "reason"> & { reason?: string }) => request<BuilderState>(quotationPath(workspaceId, `${base}/discounts`), "PUT", input),
    tax: (taxRate: string) => request<BuilderState>(quotationPath(workspaceId, `${base}/tax`), "PUT", { taxRate }),
    boq: () => request<{ lines: BoqPick[] }>(quotationPath(workspaceId, `${base}/boq`)),
    search: (q: string, signal?: AbortSignal, limit = 12) => request<{ items: CatalogHit[] }>(quotationPath(workspaceId, `${base}/catalog`, { q, limit: String(limit) }), "GET", undefined, signal),
    share: () => request<QuoteShare>(quotationPath(workspaceId, `${base}/share`)),
    resend: () => request<{ channel: "whatsapp" | "email" | null; emailed: string[]; reason: string | null }>(quotationPath(workspaceId, `${base}/resend`), "POST", {}),
    paymentTerms: (terms: PaymentMilestone[]) => request<BuilderState>(quotationPath(workspaceId, `${base}/payment-terms`), "PUT", { terms }),
    /** A step on the quote's journey (submit, approve, issue, revise, record_decision…), through the commercial case. */
    step: (action: string, revision: number, extra: Record<string, unknown> = {}) =>
      request<{ data: { revision: number; quotes: Array<{ id: string; number: number; status: string }> }; sent?: IssueDelivery }>(`/api/commercial/cases/${caseId}?${new URLSearchParams({ workspaceId })}`, "POST", { action, revision, quoteId, ...extra }),
    aiDraft: () => request<AiProposal>(quotationPath(workspaceId, `${base}/ai/draft`), "POST", {}),
    aiEdit: (text: string, chat: { history?: Array<{ role: "estimator" | "assistant"; text: string }>; focusLineIds?: string[] } = {}) =>
      request<AiProposal>(quotationPath(workspaceId, `${base}/ai/edit`), "POST", { request: text, history: chat.history ?? [], focusLineIds: chat.focusLineIds ?? [] }),
    threads: () => request<{ threads: QuoteThread[]; members: Array<{ id: string; name: string }> }>(quotationPath(workspaceId, `${base}/comments`)),
    comment: (id: string, anchor: QuoteAnchor, body: string, mentions: string[]) => request<{ threads: QuoteThread[] }>(quotationPath(workspaceId, `${base}/comments`), "POST", { id, anchorKind: anchor.kind, anchorKey: anchor.key, anchorField: anchor.field ?? null, body, mentions }),
    reply: (threadId: string, id: string, body: string, mentions: string[]) => request<{ threads: QuoteThread[] }>(quotationPath(workspaceId, `${base}/comments/${threadId}/replies`), "POST", { id, body, mentions }),
    threadStatus: (threadId: string, version: number, status: "open" | "resolved") => request<{ threads: QuoteThread[] }>(quotationPath(workspaceId, `${base}/comments/${threadId}/status`), "POST", { version, status }),
    pulse: (lineId: string | null, field: string | null) => request<{ people: QuotePerson[]; revision: number; comments: string }>(quotationPath(workspaceId, `${base}/pulse`), "POST", { lineId, field }),
    proposal: (change: Record<string, unknown>) => request<{ quote: Quote; revision: number }>(quotationPath(workspaceId, `${base}/proposal`), "PUT", change),
    document: (change: Partial<QuoteDocument>) => request<BuilderState>(quotationPath(workspaceId, `${base}/document`), "PUT", change),
    templates: () => request<{ templates: QuoteTemplate[] }>(quotationPath(workspaceId, "templates")),
    saveTemplate: (id: string, name: string, scope: "area" | "trade" | "quote", target: string) => request<{ id: string; name: string; lines: number }>(quotationPath(workspaceId, `${base}/templates`), "POST", { id, name, scope, target }),
    toCatalog: (lineId: string, version: number) => request<BuilderState>(quotationPath(workspaceId, `${base}/lines/${encodeURIComponent(lineId)}/to-catalog`), "POST", { version }),
    loadOther: (otherId: string) => request<BuilderState>(quotationPath(workspaceId, `cases/${caseId}/quotes/${encodeURIComponent(otherId)}`)),
    addTrade: (id: string, name: string) => request<{ id: string; name: string }>(quotationPath(workspaceId, "work-packages"), "POST", { id, name }),
  };
}

/** A catalog item's picture (small preview by default). */
export const catalogImageUrl = (workspaceId: string, imageId: string, preview = true) => `/api/catalog-images/${imageId}?${new URLSearchParams({ workspaceId, ...(preview ? { preview: "1" } : {}) })}`;
