import type { DealFulfilment, PathRule, RulesState } from "./types";

export class FulfilmentError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function send<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new FulfilmentError(typeof data?.message === "string" ? data.message : fallback, response.status);
  return data as T;
}

/** A won order's fulfilment on its deal, and the rules per enquiry type and path. */
export function fulfilmentApi(workspaceId: string) {
  const at = (path: string) => `/api/fulfilment/${path}?${new URLSearchParams({ workspaceId })}`;
  const json = (method: string, body: Record<string, unknown>): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return {
    deal: (opportunityId: string) => send<DealFulfilment>(at(`deals/${opportunityId}`), {}, "The order didn't load."),
    /** set_boq · request_transfer · transfer_arrived · book_delivery · cancel, with its own command id so a retry never runs it twice. */
    command: (opportunityId: string, version: number, action: string, input: Record<string, unknown> = {}) =>
      send<DealFulfilment>(at(`deals/${opportunityId}`), json("POST", { ...input, action, version, commandId: crypto.randomUUID() }), "Could not save."),
    rules: () => send<RulesState>(at("rules"), {}, "The rules didn't load."),
    saveRules: (flowId: string, rules: Array<Omit<PathRule, "version">>, versions: string[]) => send<RulesState>(at(`rules/${flowId}`), json("PUT", { rules, versions }), "Could not save."),
  };
}
export type FulfilmentApi = ReturnType<typeof fulfilmentApi>;
