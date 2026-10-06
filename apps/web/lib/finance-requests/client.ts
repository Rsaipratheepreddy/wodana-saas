import type {
  ClientOption, FileKind, FinanceRequestDetail, FinanceRequestsBoard, RequestContext, RequestOrigin, RequestSettingsState,
} from "./types";

export class FinanceRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function send<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new FinanceRequestError(typeof data?.message === "string" ? data.message : fallback, response.status);
  return data as T;
}

/** Finance requests for one workspace: raise, follow, and (for Finance) work them. */
export function financeRequestsApi(workspaceId: string) {
  const at = (value: string, query: Record<string, string> = {}) => `/api/finance-requests/${value}?${new URLSearchParams({ ...query, workspaceId })}`;
  /** One change, with its own command id so a retry never runs it twice. */
  const post = <T>(url: string, input: Record<string, unknown>) =>
    send<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, commandId: crypto.randomUUID() }) }, "Could not save.");
  return {
    board: () => send<FinanceRequestsBoard>(at("board"), {}, "Requests didn't load."),
    detail: (id: string) => send<FinanceRequestDetail>(at(`requests/${id}`), {}, "The request didn't load."),
    /** submit · resubmit · start · ask · done · reject · update · decide (by id; version when it exists). */
    command: (action: string, input: Record<string, unknown>) => post<FinanceRequestDetail>(at("board"), { ...input, action }),
    context: (origin: RequestOrigin) => send<RequestContext>(at("context", Object.fromEntries(Object.entries(origin).filter(([, value]) => Boolean(value))) as Record<string, string>), {},
      "The form didn't load."),
    clients: (search: string) => send<ClientOption[]>(at("options", { kind: "clients", search }), {}, "Could not load."),
    suppliers: (search: string) => send<Array<{ id: string; name: string; taxNumber: string | null; currency: string | null }>>(at("options", { kind: "suppliers", search }), {}, "Could not load."),
    projects: (search: string) => send<Array<{ id: string; name: string; reference: string | null }>>(at("options", { kind: "projects", search }), {}, "Could not load."),
    deals: (partyId: string) => send<Array<{ id: string; reference: string; title: string; status: string }>>(at("options", { kind: "deals", partyId }), {}, "Could not load."),
    quoteLines: (opportunityId: string, quoteId: string) =>
      send<{ currency: string; net: string; lines: Array<{ description: string; quantity: string; unitPrice: string }> }>(at("quote-lines", { opportunityId, quoteId }), {}, "Could not load."),
    upload: (id: string, kind: FileKind, file: File) => {
      const form = new FormData(); form.set("file", file);
      return send<FinanceRequestDetail>(at(`requests/${id}/files/${kind}`), { method: "POST", body: form }, "The file could not be uploaded.");
    },
    fileUrl: (id: string, fileId: string) => at(`requests/${id}/files/${fileId}`),
    settings: () => send<RequestSettingsState>(at("settings"), {}, "Settings didn't load."),
    saveSettings: (action: "save_settings" | "save_method" | "archive_method", input: Record<string, unknown>) => post<RequestSettingsState>(at("settings"), { ...input, action }),
  };
}
export type FinanceRequestsApi = ReturnType<typeof financeRequestsApi>;
