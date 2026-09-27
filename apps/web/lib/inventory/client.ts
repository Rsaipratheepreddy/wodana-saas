import type { MovementRow, StockLocation, StockState, TransferState, TransfersState } from "./types";

export class InventoryRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new InventoryRequestError(typeof data?.message === "string" ? data.message : "Could not save.", response.status);
  return data as T;
}

/** The Inventory API for one workspace. */
export function inventoryApi(workspaceId: string) {
  const at = (value: string, query: Record<string, string> = {}) => `/api/inventory/${value}?${new URLSearchParams({ workspaceId, ...query })}`;
  return {
    stock: () => request<StockState>(at("stock")),
    /** One stock change (issue, return, allocate, release, count, add), replayed safely by its id. */
    change: (input: Record<string, unknown>) => request<StockState>(at("stock"), "POST", input),
    movements: (filter: { itemId?: string; locationId?: string; projectId?: string } = {}) =>
      request<{ movements: MovementRow[] }>(at("movements", Object.fromEntries(Object.entries(filter).filter(([, value]) => Boolean(value))) as Record<string, string>)),
    transfers: () => request<TransfersState>(at("transfers")),
    transfer: (id: string) => request<TransferState>(at(`transfers/${id}`)),
    send: (input: Record<string, unknown>) => request<TransferState>(at("transfers"), "POST", input),
    transferCommand: (id: string, action: string, input: Record<string, unknown> = {}) => request<TransferState>(at(`transfers/${id}`), "POST", { ...input, action }),
    /** Applies or refuses a stock correction waiting for approval. */
    decideAdjustment: (id: string, action: "approve" | "reject", note = "") => request<StockState>(at(`adjustments/${id}`), "POST", { action, note }),
    locations: () => request<{ locations: StockLocation[]; canManage: boolean }>(at("locations")),
    saveLocation: (input: Record<string, unknown>) => request<{ locations: StockLocation[] }>(at("locations"), "POST", input),
  };
}
export type InventoryApi = ReturnType<typeof inventoryApi>;
