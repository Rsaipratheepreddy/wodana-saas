import type { BillState, InvoiceableState, PayablesState, PaymentState, RunState, SupplierState } from "./types";

export class PayablesRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new PayablesRequestError(typeof data?.message === "string" ? data.message : "Could not save.", response.status);
  return data as T;
}

/** The payables API for one workspace: suppliers' invoices, payments to suppliers, what each is owed, and payment runs. */
export function payablesApi(workspaceId: string) {
  const at = (value: string) => `/api/payables/${value}?${new URLSearchParams({ workspaceId })}`;
  /** One change, with its own command id so a retry never runs it twice. */
  const command = <T>(action: string, input: Record<string, unknown>) => request<T>(at("state"), "POST", { ...input, action, commandId: crypto.randomUUID() });
  return {
    workspaceId,
    state: () => request<PayablesState>(at("state")),
    bill: (id: string) => request<BillState>(at(`bills/${id}`)),
    supplier: (vendorId: string) => request<SupplierState>(at(`suppliers/${vendorId}`)),
    invoiceable: (orderId: string) => request<InvoiceableState>(at(`orders/${orderId}`)),
    /** save · submit · approve · cancel · release (retention) — an invoice, by id and version. */
    billCommand: (action: "save" | "submit" | "approve" | "cancel" | "release", input: Record<string, unknown>) => command<BillState>(action, input),
    /** pay (a new payment, by its id) · allocate · reverse (by paymentId). */
    paymentCommand: (action: "pay" | "allocate" | "reverse", input: Record<string, unknown>) => command<PaymentState>(action, input),
    uploadFile: async (billId: string, file: File) => {
      const body = new FormData(); body.set("file", file);
      const response = await fetch(at(`bills/${billId}/file`), { method: "POST", body });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new PayablesRequestError(typeof data?.message === "string" ? data.message : "The file could not be uploaded.", response.status);
      return data as BillState;
    },
    fileUrl: (billId: string) => at(`bills/${billId}/file`),
    run: (runId: string) => request<RunState>(at(`runs/${runId}`)),
    /** save · submit · approve · return · paid · cancel — a payment run, by id (and version once it exists). */
    runCommand: (action: "save" | "submit" | "approve" | "return" | "paid" | "cancel", input: Record<string, unknown>) =>
      request<RunState>(at("runs"), "POST", { ...input, action, commandId: crypto.randomUUID() }),
    /** An approved run's file for the bank, or why it can't be made. */
    runFile: async (runId: string) => {
      const response = await fetch(at(`runs/${runId}/file`), { cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new PayablesRequestError(typeof data?.message === "string" ? data.message : "The file could not be made.", response.status);
      }
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "payment-run.csv";
      return { name, body: await response.blob() };
    },
  };
}
export type PayablesApi = ReturnType<typeof payablesApi>;
