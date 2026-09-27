import type { AccountingSettings, Posting, ProviderOption } from "./types";

export class AccountingRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new AccountingRequestError(typeof data?.message === "string" ? data.message : "Could not save.", response.status);
  return data as T;
}

/** The accounting system's records as options: whichever of its field names it uses for the id, name, type and rate. */
export function toOptions(items: Array<Record<string, unknown>>): ProviderOption[] {
  const text = (...values: unknown[]) => { for (const value of values) if (typeof value === "string" || typeof value === "number") return String(value); return ""; };
  return items.map((item) => ({
    id: text(item.Id, item.item_id, item.account_id, item.tax_id),
    name: text(item.Name, item.FullyQualifiedName, item.name, item.account_name, item.tax_name),
    type: text(item.AccountType, item.Type, item.account_type, item.item_type).toLowerCase().replace(/[\s_]+/g, " "),
    rate: text(item.tax_percentage) || null,
  })).filter((option) => option.id && option.name);
}

/** The accounting API for one workspace: where each company posts, and the postings. */
export function accountingApi(workspaceId: string) {
  const at = (value: string) => `/api/accounting/${value}?${new URLSearchParams({ workspaceId })}`;
  return {
    settings: () => request<AccountingSettings>(at("settings")),
    saveLink: (input: Record<string, unknown>) => request<AccountingSettings>(at("links"), "PUT", input),
    postings: () => request<{ postings: Posting[] }>(at("postings")),
    retry: (postingId: string) => request<{ postings: Posting[] }>(at(`postings/${postingId}/retry`), "POST", {}),
    /** Items, accounts or tax codes from the connection's accounting system (up to 250). */
    options: async (connectionId: string, kind: "items" | "accounts" | "taxes") => {
      const all: Array<Record<string, unknown>> = [];
      for (let page = 1; page <= 5; page += 1) {
        const data = await request<{ items?: Array<Record<string, unknown>>; hasMore?: boolean }>(
          `/api/workspace/integration-connections/${connectionId}/tools?${new URLSearchParams({ workspaceId, kind, page: String(page) })}`);
        all.push(...(data.items ?? []));
        if (!data.hasMore) break;
      }
      return toOptions(all.filter((item) => item.Active !== false && item.is_active !== false && item.status !== "inactive"));
    },
  };
}
export type AccountingApi = ReturnType<typeof accountingApi>;
