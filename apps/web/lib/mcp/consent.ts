import { tKey, type MessageKey } from "@/lib/i18n/keys";

/** What an AI app may do: read records, and prepare changes the person confirms in Wodana. */
export type McpScope = "read" | "write";
export type ConsentUnavailableReason = "ai_off" | "mcp_off" | "no_ai_access";

/** An AI app's request as Business Core read it: the app, where it returns and the person's workspaces. */
export type ConsentRequest = {
  client: { id: string; name: string; uri: string | null };
  redirectHost: string;
  scopes: McpScope[];
  workspaces: Array<{ id: string; name: string; available: boolean; reason: ConsentUnavailableReason | null }>;
};

export const UNAVAILABLE_REASON: Record<ConsentUnavailableReason, MessageKey> = {
  ai_off: tKey("AI assistance is off in this workspace"),
  mcp_off: tKey("AI apps are off in this workspace"),
  no_ai_access: tKey("You don't have access to Woddy here"),
};

/**
 * What Business Core can say about a request (English keys, translated where shown). Listing them here keeps
 * them in en.json for the translation pass.
 */
export const MCP_MESSAGES = [
  tKey("This app is not registered. Connect it again from the app."), tKey("The app sent an address we can't return to."),
  tKey("PKCE with S256 is required."), tKey("Only the authorization code flow is supported."), tKey("Only the code response type is supported."),
  tKey("Scopes are read and write."), tKey("The request is too long."), tKey("Choose a workspace."),
  tKey("AI assistance is off for this workspace."), tKey("AI assistance is off for this workspace. An owner can turn it on in Settings."),
  tKey("AI apps are off for this workspace. An owner can turn them on in Settings."), tKey("AI apps are off for this workspace. An owner can turn them on in Settings → AI apps."),
  tKey("You don't have access to Woddy in this workspace."), tKey("Turn on AI assistance first."),
  tKey("AI settings changed; reload and try again"), tKey("This AI app changed; reload and try again"), tKey("This AI app was not found."),
  tKey("AI apps are off for this workspace, or the app was disconnected."), tKey("This action was not found."),
];

export class ConsentRequestError extends Error {
  /** When the refusal can go back to the AI app: its address (offered, never followed on its own). */
  readonly redirectTo?: string;
  constructor(message: string, readonly status: number, redirectTo?: string) {
    super(message); this.name = "ConsentRequestError";
    if (redirectTo && isSafeRedirect(redirectTo)) this.redirectTo = redirectTo;
  }
}

async function answer<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null) as (T & { message?: unknown; redirectTo?: unknown }) | null;
  if (!response.ok || !payload) {
    throw new ConsentRequestError(typeof payload?.message === "string" ? payload.message : fallback, response.status, typeof payload?.redirectTo === "string" ? payload.redirectTo : undefined);
  }
  return payload;
}

export async function readConsentRequest(query: string): Promise<ConsentRequest> {
  const response = await fetch(`/api/oauth/authorize?${query}`, { cache: "no-store" }).catch(() => null);
  if (!response) throw new ConsentRequestError(tKey("The workspace service is unavailable."), 503);
  return answer<ConsentRequest>(response, tKey("This connection request isn't valid."));
}

/** Allow or deny; the answer is the AI app's address to continue at. */
export async function decideConsent(input: { query: string; workspaceId: string; scopes: McpScope[]; decision: "allow" | "deny" }): Promise<string> {
  const response = await fetch("/api/oauth/authorize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }).catch(() => null);
  if (!response) throw new ConsentRequestError(tKey("The workspace service is unavailable."), 503);
  const { redirectTo } = await answer<{ redirectTo?: unknown }>(response, tKey("The AI app could not be connected."));
  if (typeof redirectTo !== "string" || !isSafeRedirect(redirectTo)) throw new ConsentRequestError(tKey("The AI app could not be connected."), 502);
  return redirectTo;
}

/** An absolute address the browser may open: never a script or data URL. */
export function isSafeRedirect(value: string) {
  try { return !["javascript:", "data:", "vbscript:", "blob:", "file:"].includes(new URL(value).protocol); } catch { return false; }
}
