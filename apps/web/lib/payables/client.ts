import type { BillState, InvoiceableState, PayablesState, PaymentState, SupplierState } from "./types";

export class PayablesRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new PayablesRequestError(typeof data?.message === "string" ? data.message : "Could not save.", response.status);
  return data as T;
}

/** The payables API for one workspace: suppliers' invoices, payments to suppliers, and what each is owed. */
export function payablesApi(workspaceId: string) {
  const at = (value: string) => `/api/payables/${value}?${new URLSearchParams({ workspaceId })}`;
  /** One change, with its own command id so a retry never runs it twice. */
  const command = <T>(action: string, input: Record<string, unknown>) => request<T>(at("state"), "POST", { ...input, action, commandId: crypto.randomUUID() });
  return {
    state: () => request<PayablesState>(at("state")),
    bill: (id: string) => request<BillState>(at(`bills/${id}`)),
    supplier: (vendorId: string) => request<SupplierState>(at(`suppliers/${vendorId}`)),
    invoiceable: (orderId: string) => request<InvoiceableState>(at(`orders/${orderId}`)),
    /** save · submit · approve · cancel (an invoice, by id and version). */
    billCommand: (action: "save" | "submit" | "approve" | "cancel", input: Record<string, unknown>) => command<BillState>(action, input),
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
  };
}
export type PayablesApi = ReturnType<typeof payablesApi>;
