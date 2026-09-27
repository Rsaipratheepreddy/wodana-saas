import type {
  DeliveriesState, NeedsState, OrderState, OrdersState, PriceRequestsState, PriceRequestState, PurchasingSettings, ReceiptState, ReceivingForm, SupplierImportPlan, SupplierImportRow,
  SupplierControlsState, SupplierReturnState, SupplierReturnsState, SupplierState, UnmatchedState,
} from "./types";

export class PurchasingRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const path = (workspaceId: string, value: string, query: Record<string, string> = {}) => `/api/purchasing/${value}?${new URLSearchParams({ workspaceId, ...query })}`;

async function upload<T>(url: string, file: File): Promise<T> {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(url, { method: "POST", body, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new PurchasingRequestError(typeof data?.message === "string" ? data.message : "The photo could not be uploaded.", response.status);
  return data as T;
}

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new PurchasingRequestError(typeof data?.message === "string" ? data.message : "Could not save.", response.status);
  return data as T;
}

/** The Purchasing API for one workspace. */
export function purchasingApi(workspaceId: string) {
  const at = (value: string, query: Record<string, string> = {}) => path(workspaceId, value, query);
  return {
    suppliers: () => request<SupplierState>(at("suppliers")),
    saveSupplier: (input: Record<string, unknown>) => request<SupplierState>(at("suppliers"), "POST", input),
    approveSupplier: (id: string, input: Record<string, unknown>) => request<SupplierState>(at(`suppliers/${id}/approval`), "POST", input),
    archiveSupplier: (id: string, input: Record<string, unknown>) => request<SupplierState>(at(`suppliers/${id}/archive`), "POST", input),
    supplierControls: (id: string) => request<SupplierControlsState>(at(`suppliers/${id}`)),
    addDocument: (id: string, input: Record<string, unknown>) => request<SupplierControlsState>(at(`suppliers/${id}/documents`), "POST", input),
    uploadDocument: (id: string, documentId: string, file: File) => upload<SupplierControlsState>(at(`suppliers/${id}/documents/${documentId}/file`), file),
    documentUrl: (documentId: string) => at(`supplier-documents/${documentId}`),
    requestBankAccount: (id: string, input: Record<string, unknown>) => request<SupplierControlsState>(at(`suppliers/${id}/bank-accounts`), "POST", input),
    bankAccountCommand: (id: string, accountId: string, input: Record<string, unknown>) => request<SupplierControlsState>(at(`suppliers/${id}/bank-accounts/${accountId}`), "POST", input),
    previewImport: (rows: SupplierImportRow[]) => request<SupplierImportPlan>(at("suppliers/import"), "POST", { rows }),
    commitImport: (rows: SupplierImportRow[]) => request<SupplierState>(at("suppliers/import"), "POST", { rows, commit: true }),
    needs: () => request<NeedsState>(at("needs")),
    orders: () => request<OrdersState>(at("orders")),
    order: (id: string) => request<OrderState>(at(`orders/${id}`)),
    createOrder: (input: Record<string, unknown>) => request<OrderState>(at("orders"), "POST", input),
    /** One change to an order, version-checked; returns the order as it is now. */
    orderCommand: (id: string, version: number, action: string, input: Record<string, unknown> = {}) =>
      request<OrderState>(at(`orders/${id}`), "POST", { ...input, action, version, commandId: crypto.randomUUID() }),
    priceRequests: () => request<PriceRequestsState>(at("price-requests")),
    priceRequest: (id: string) => request<PriceRequestState>(at(`price-requests/${id}`)),
    createPriceRequest: (input: Record<string, unknown>) => request<PriceRequestState>(at("price-requests"), "POST", input),
    priceRequestCommand: (id: string, version: number, action: string, input: Record<string, unknown> = {}) => request<PriceRequestState>(at(`price-requests/${id}`), "POST", { ...input, action, version }),
    deliveries: () => request<DeliveriesState>(at("deliveries")),
    receiving: (orderId: string) => request<ReceivingForm>(at(`orders/${orderId}/receiving`)),
    receive: (input: Record<string, unknown>) => request<ReceiptState>(at("receipts"), "POST", input),
    receipt: (id: string) => request<ReceiptState>(at(`receipts/${id}`)),
    inspect: (id: string, input: Record<string, unknown>) => request<ReceiptState>(at(`receipts/${id}/inspection`), "POST", input),
    reverse: (id: string, reason: string) => request<ReceiptState>(at(`receipts/${id}/reversal`), "POST", { reason }),
    /** Adds a photo to a delivery (or to goods that came without an order); the same photo id twice changes nothing. */
    uploadPhoto: (owner: { kind: "receipt" | "unmatched"; id: string }, photoId: string, file: File) => upload<ReceiptState & UnmatchedState>(at(`${owner.kind === "receipt" ? "receipts" : "unmatched"}/${owner.id}/photos/${photoId}`), file),
    photoUrl: (photoId: string, preview = true) => at(`photos/${photoId}`, preview ? { preview: "1" } : {}),
    recordUnmatched: (input: Record<string, unknown>) => request<UnmatchedState>(at("unmatched"), "POST", input),
    unmatched: (id: string) => request<UnmatchedState>(at(`unmatched/${id}`)),
    resolveUnmatched: (id: string, input: Record<string, unknown>) => request<UnmatchedState>(at(`unmatched/${id}`), "POST", input),
    returns: () => request<SupplierReturnsState>(at("returns")),
    supplierReturn: (id: string) => request<SupplierReturnState>(at(`returns/${id}`)),
    createReturn: (input: Record<string, unknown>) => request<SupplierReturnState>(at("returns"), "POST", input),
    returnCommand: (id: string, version: number, action: string, input: Record<string, unknown> = {}) =>
      request<SupplierReturnState>(at(`returns/${id}`), "POST", { ...input, action, version, commandId: crypto.randomUUID() }),
    settings: () => request<{ settings: PurchasingSettings; canManage: boolean; currency: string | null }>(at("settings")),
    saveSettings: (input: Record<string, unknown>) => request<PurchasingSettings>(at("settings"), "PUT", input),
  };
}
export type PurchasingApi = ReturnType<typeof purchasingApi>;
