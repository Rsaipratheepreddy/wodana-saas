import type { BuilderState, CatalogHit, LineOp, PaymentMilestone, QuoteDiscount } from "./types";

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

/** The builder's calls for one quote. */
export function quoteApi(workspaceId: string, caseId: string, quoteId: string) {
  const base = `cases/${caseId}/quotes/${encodeURIComponent(quoteId)}`;
  return {
    load: () => request<BuilderState>(quotationPath(workspaceId, base)),
    apply: (ops: LineOp[]) => request<BuilderState>(quotationPath(workspaceId, `${base}/lines`), "POST", { ops }),
    discount: (input: Omit<QuoteDiscount, "reason"> & { reason?: string }) => request<BuilderState>(quotationPath(workspaceId, `${base}/discounts`), "PUT", input),
    tax: (taxRate: string) => request<BuilderState>(quotationPath(workspaceId, `${base}/tax`), "PUT", { taxRate }),
    search: (q: string, signal?: AbortSignal) => request<{ items: CatalogHit[] }>(quotationPath(workspaceId, `${base}/catalog`, { q }), "GET", undefined, signal),
    paymentTerms: (terms: PaymentMilestone[]) => request<BuilderState>(quotationPath(workspaceId, `${base}/payment-terms`), "PUT", { terms }),
    /** A step on the quote's journey (submit, approve, issue, revise, record_decision…), through the commercial case. */
    step: (action: string, revision: number, extra: Record<string, unknown> = {}) =>
      request<{ data: { revision: number; quotes: Array<{ id: string; number: number; status: string }> } }>(`/api/commercial/cases/${caseId}?${new URLSearchParams({ workspaceId })}`, "POST", { action, revision, quoteId, ...extra }),
    loadOther: (otherId: string) => request<BuilderState>(quotationPath(workspaceId, `cases/${caseId}/quotes/${encodeURIComponent(otherId)}`)),
    addTrade: (id: string, name: string) => request<{ id: string; name: string }>(quotationPath(workspaceId, "work-packages"), "POST", { id, name }),
  };
}
