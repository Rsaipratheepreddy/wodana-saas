import type { Batch, FactorySettingsState, FactoryState, ProductionState, SamplesState, ScheduleState, WorkOrderRow, WorkOrderState } from "./types";

export class FactoryRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function upload<T>(url: string, file: File): Promise<T> {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(url, { method: "POST", body, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new FactoryRequestError(typeof data?.message === "string" ? data.message : "The photo could not be uploaded.", response.status);
  return data as T;
}

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new FactoryRequestError(typeof data?.message === "string" ? data.message : "Could not save.", response.status);
  return data as T;
}

/** The Factory API for one workspace. */
export function factoryApi(workspaceId: string) {
  const at = (value: string, query: Record<string, string> = {}) => `/api/factory/${value}?${new URLSearchParams({ workspaceId, ...query })}`;
  return {
    state: () => request<FactoryState>(at("state")),
    order: (id: string) => request<WorkOrderState>(at(`orders/${id}`)),
    /** Plans a work order for all or part of a scope line; replayed safely by its id. */
    plan: (input: Record<string, unknown>) => request<WorkOrderState>(at("orders"), "POST", input),
    /** One change to a work order: version-checked, or (reports and checks) by its own id. */
    command: (id: string, action: string, input: Record<string, unknown> = {}) => request<WorkOrderState>(at(`orders/${id}`), "POST", { ...input, action }),
    /** Hours on each workcenter each working day from a date, and the days over capacity. */
    schedule: (from?: string, days = 28) => request<ScheduleState>(at("schedule", { ...(from ? { from } : {}), days: String(days) })),
    /** Creates a batch from work orders, or adds, removes, starts or closes one (version-checked). */
    saveBatch: (input: Record<string, unknown>) => request<{ batches: Batch[]; orders: WorkOrderRow[] }>(at("batches"), "POST", input),
    /** The photo of a quality check (one per check; the same photo id twice changes nothing). */
    uploadCheckPhoto: (orderId: string, checkId: string, photoId: string, file: File) => upload<WorkOrderState>(at(`orders/${orderId}/checks/${checkId}/photos/${photoId}`), file),
    photoUrl: (photoId: string, preview = true) => at(`photos/${photoId}`, preview ? { preview: "1" } : {}),
    settings: () => request<FactorySettingsState>(at("settings")),
    saveSettings: (input: Record<string, unknown>) => request<FactorySettingsState>(at("settings"), "PUT", input),
    saveWorkcenter: (input: Record<string, unknown>) => request<FactorySettingsState>(at("workcenters"), "POST", input),
    /** PLM-063: each project's production status and its planned against actual dates. */
    production: () => request<ProductionState>(at("production")),
    /** PLM-061: sample requests: every one (the factory), or one case's. */
    samples: (caseId?: string | null) => request<SamplesState>(at("samples", caseId ? { caseId } : {})),
    /** Asks the factory for a sample; replayed safely by its id. */
    requestSample: (input: { id: string; caseId: string; title: string; note: string; dueOn: string }) => request<SamplesState>(at("samples"), "POST", input),
    /** Marks a sample ready, opens it again, or withdraws it (version-checked); `caseId` keeps the answer to that case. */
    sampleCommand: (id: string, action: "ready" | "reopen" | "cancel", input: Record<string, unknown>) => request<SamplesState>(at(`samples/${id}`), "POST", { ...input, action }),
  };
}
export type FactoryApi = ReturnType<typeof factoryApi>;
