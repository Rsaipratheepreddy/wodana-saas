import type { BuilderState, CatalogHit, LineOp, QuoteDiscount } from "./types";

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
    addTrade: (id: string, name: string) => request<{ id: string; name: string }>(quotationPath(workspaceId, "work-packages"), "POST", { id, name }),
  };
}
