import type { SupplierImportPlan, SupplierImportRow, SupplierState } from "./types";

export class PurchasingRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const path = (workspaceId: string, value: string) => `/api/purchasing/${value}?${new URLSearchParams({ workspaceId })}`;

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new PurchasingRequestError(typeof data?.message === "string" ? data.message : "Could not save.", response.status);
  return data as T;
}

/** The Purchasing API for one workspace. */
export function purchasingApi(workspaceId: string) {
  const at = (value: string) => path(workspaceId, value);
  return {
    suppliers: () => request<SupplierState>(at("suppliers")),
    saveSupplier: (input: Record<string, unknown>) => request<SupplierState>(at("suppliers"), "POST", input),
    approveSupplier: (id: string, input: Record<string, unknown>) => request<SupplierState>(at(`suppliers/${id}/approval`), "POST", input),
    archiveSupplier: (id: string, input: Record<string, unknown>) => request<SupplierState>(at(`suppliers/${id}/archive`), "POST", input),
    previewImport: (rows: SupplierImportRow[]) => request<SupplierImportPlan>(at("suppliers/import"), "POST", { rows }),
    commitImport: (rows: SupplierImportRow[]) => request<SupplierState>(at("suppliers/import"), "POST", { rows, commit: true }),
  };
}
export type PurchasingApi = ReturnType<typeof purchasingApi>;
