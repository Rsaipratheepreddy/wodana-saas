/** §0.3 Push like a delivery app: the firm's wording for each moment (Setup → Push notifications). */
export type PushAction = "open" | "review" | "reply" | "pay";
export type PushTemplate = {
  key: string; title: string; body: string; action: PushAction; enabled: boolean;
  audience: "team" | "client"; label: string; variables: string[]; actions: PushAction[]; sample: Record<string, string>;
  kit: { title: string; body: string; action: PushAction };
};
export type PushTemplates = { version: string; templates: PushTemplate[] };

export const TITLE_LIMIT = 60;
export const BODY_LIMIT = 178;

const url = (workspaceId: string) => `/api/workspace/setup/push-templates?workspaceId=${encodeURIComponent(workspaceId)}`;

export async function loadPushTemplates(workspaceId: string): Promise<PushTemplates> {
  const response = await fetch(url(workspaceId), { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !Array.isArray(data.templates)) throw new Error(typeof data?.message === "string" ? data.message : "Could not load.");
  return data as PushTemplates;
}

export async function savePushTemplates(workspaceId: string, version: string, templates: Array<Pick<PushTemplate, "key" | "title" | "body" | "action" | "enabled">>) {
  const response = await fetch(url(workspaceId), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version, templates }) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data.version !== "string") throw new Error(typeof data?.message === "string" ? data.message : "Could not save.");
  return data as { version: string };
}

/** The push as the phone shows it, filled with the moment's sample facts (the server fills real ones the same way). */
export function fillPush(text: string, values: Record<string, string>, limit: number) {
  const filled = text.replace(/\{([a-z]+)\}/g, (_, name: string) => values[name] ?? "").replace(/\s+/g, " ").replace(/\s+([:,.])/g, "$1")
    .replace(/(?:\s*·\s*)+$/, "").replace(/^(?:\s*·\s*)+/, "").replace(/·\s*·/g, "·").trim();
  return filled.length > limit ? `${filled.slice(0, limit - 1).trimEnd()}…` : filled;
}
