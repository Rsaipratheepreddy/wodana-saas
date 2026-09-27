import type { InvoicePreview, InvoiceState, ReceivablesState } from "./types";

export class ReceivablesRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ReceivablesRequestError(typeof data?.message === "string" ? data.message : "Could not save.", response.status);
  return data as T;
}

/** The receivables API for one workspace: tax invoices to clients and credit notes. */
export function receivablesApi(workspaceId: string) {
  const at = (value: string) => `/api/receivables/${value}?${new URLSearchParams({ workspaceId })}`;
  return {
    state: () => request<ReceivablesState>(at("state")),
    invoice: (id: string) => request<InvoiceState>(at(`invoices/${id}`)),
    preview: (caseId: string, paymentId: string) => request<InvoicePreview>(at(`milestones/${caseId}/${encodeURIComponent(paymentId)}`)),
    /** Issues the invoice for a milestone (replayed safely by its id). */
    issue: (input: { id: string; caseId: string; paymentId: string; issueDate?: string | null; dueDate?: string | null; customerTaxNumber?: string; note?: string }) =>
      request<InvoiceState>(at("state"), "POST", { ...input, action: "issue", commandId: crypto.randomUUID() }),
    /** Credits an invoice in full with why. */
    credit: (id: string, version: number, reason: string) => request<InvoiceState>(at("state"), "POST", { id, version, reason, action: "credit", commandId: crypto.randomUUID() }),
  };
}
export type ReceivablesApi = ReturnType<typeof receivablesApi>;
