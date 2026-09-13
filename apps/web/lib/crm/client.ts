export type RecordData = Record<string, unknown> & { id: string };
export function rows(payload: unknown): RecordData[] {
  if (Array.isArray(payload)) return payload as RecordData[];
  if (!payload || typeof payload !== "object") return [];
  const page = payload as Record<string, unknown>;
  return (Array.isArray(page.data) ? page.data : Array.isArray(page.items) ? page.items : Array.isArray(page.rows) ? page.rows : []) as RecordData[];
}
export class CrmRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function crmRequest<T = RecordData>(workspaceId: string, path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const [resource, search = ""] = path.split("?");
  const query = new URLSearchParams(search);
  query.set("workspaceId", workspaceId);
  const response = await fetch(`/api/workspace/crm/data/${resource}?${query}`, {
    method, signal, cache: "no-store", headers: { "content-type": "application/json" },
    ...(method !== "GET" && method !== "DELETE" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new CrmRequestError(result?.message ?? "CRM is unavailable. Please try again.", response.status);
  return result as T;
}
export function label(value: unknown, fallback = "Not set"): string {
  return typeof value === "string" && value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : fallback;
}
export function dateText(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
