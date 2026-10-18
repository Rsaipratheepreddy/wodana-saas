import { tKey } from "@/lib/i18n/keys";
import type { McpScope } from "@/lib/mcp/consent";

/** An AI app a person connected over MCP; it acts as that person and only in this workspace. */
export type McpConnection = {
  id: string;
  clientName: string;
  userId: string;
  userName: string;
  /** Connected by the person reading. */
  mine: boolean;
  scopes: McpScope[];
  createdAt: string;
  lastUsedAt: string | null;
  version: number;
};

/** Settings → AI apps. `canManage`: may switch AI apps on or off and revoke anyone's; everyone may revoke their own. */
export type McpOverview = {
  enabled: boolean;
  aiEnabled: boolean;
  version: number;
  canManage: boolean;
  connections: McpConnection[];
};

export class AiAppsRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "AiAppsRequestError"; }
}

async function request(url: string, init: RequestInit | undefined, fallback: string): Promise<McpOverview> {
  const response = await fetch(url, { cache: "no-store", ...init }).catch(() => null);
  if (!response) throw new AiAppsRequestError(tKey("The workspace service is unavailable."), 503);
  const payload = await response.json().catch(() => null) as (McpOverview & { message?: unknown }) | null;
  if (!response.ok || !payload) throw new AiAppsRequestError(typeof payload?.message === "string" ? payload.message : fallback, response.status);
  return payload;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const aiAppsApi = (workspaceId: string) => ({
  read: () => request(`/api/workspace/ai-apps?workspaceId=${encodeURIComponent(workspaceId)}`, undefined, tKey("AI apps didn't load.")),
  setEnabled: (enabled: boolean, version: number) => request("/api/workspace/ai-apps", json("PUT", { workspaceId, enabled, version }), tKey("AI apps could not be saved.")),
  revoke: (connection: Pick<McpConnection, "id" | "version">) =>
    request(`/api/workspace/ai-apps/connections/${encodeURIComponent(connection.id)}`, json("POST", { workspaceId, version: connection.version }), tKey("The AI app could not be revoked.")),
});
