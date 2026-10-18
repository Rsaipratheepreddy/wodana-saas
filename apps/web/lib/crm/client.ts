import { tKey } from "@/lib/i18n/keys";

export type RecordData = Record<string, unknown> & { id: string };
export function rows(payload: unknown): RecordData[] {
  if (Array.isArray(payload)) return payload as RecordData[];
  if (!payload || typeof payload !== "object") return [];
  const page = payload as Record<string, unknown>;
  return (Array.isArray(page.data) ? page.data : Array.isArray(page.items) ? page.items : Array.isArray(page.rows) ? page.rows : []) as RecordData[];
}
export type MissingRequirement = { key: string; label: string };
export class CrmRequestError extends Error {
  /** What a refused stage move still needs (PLM-121/122), each with its key. */
  constructor(message: string, public status: number, public missing: MissingRequirement[] = []) { super(message); }
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
  if (!response.ok) throw new CrmRequestError(result?.message ?? tKey("CRM is unavailable. Please try again."), response.status, Array.isArray(result?.missing) ? result.missing : []);
  return result as T;
}
export function label(value: unknown, fallback: string = tKey("Not set")): string {
  return typeof value === "string" && value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : fallback;
}
/** Date and time in the workspace's locale and time zone (pass them from `useDesignSystem()`). */
export function dateText(value: unknown, format: { locale?: string; timeZone?: string } = {}, empty: string = tKey("Not scheduled")) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return empty;
  return new Intl.DateTimeFormat(format.locale, { dateStyle: "medium", timeStyle: "short", timeZone: format.timeZone }).format(new Date(value));
}
