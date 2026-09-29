import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { safeBackendMessage } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";
import { forwardedOriginHeaders } from "@/lib/mcp/metadata.server";
import { UUID, invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

/** The OAuth query an AI app sent (client, redirect, PKCE, scope, state): long enough, never unbounded. */
const MAX_QUERY = 4_000;
const SCOPES = new Set(["read", "write"]);

/** Business Core's answer as it is (a refusal keeps its message and code), for the signed-in person. */
async function forward(request: Request, path: string, init: RequestInit, fallback: string): Promise<NextResponse> {
  const t = await getServerT();
  const result = await authenticatedBackendFetch(path, { ...init, headers: { ...init.headers as Record<string, string>, ...forwardedOriginHeaders(request) }, signal: AbortSignal.timeout(15_000) });
  let response: NextResponse;
  if (result.unauthenticated) response = NextResponse.json({ message: t("Your session has expired. Sign in again.") }, { status: 401 });
  else if (!result.upstream) response = NextResponse.json({ message: t("The workspace service is unavailable.") }, { status: 503 });
  else {
    const payload = await result.upstream.json().catch(() => null) as Record<string, unknown> | null;
    const code = typeof payload?.code === "string" ? payload.code : undefined;
    // A refusal the AI app should hear about carries its address; the page offers it, never follows it on its own.
    const redirectTo = typeof payload?.redirectTo === "string" ? payload.redirectTo : undefined;
    response = NextResponse.json(result.upstream.ok && payload ? payload : { message: safeBackendMessage(payload, fallback), ...(code ? { code } : {}), ...(redirectTo ? { redirectTo } : {}) },
      { status: result.upstream.ok && !payload ? 502 : result.upstream.status });
  }
  applyRotatedSession(response, result.rotatedSession);
  response.headers.set("cache-control", "no-store");
  return response;
}

/** What the AI app asks for, with the person's workspaces and whether each can connect. */
export async function GET(request: Request) {
  const t = await getServerT();
  const query = new URL(request.url).search.slice(1);
  if (!query || query.length > MAX_QUERY) return invalidRequest(t("This connection request isn't valid."));
  return forward(request, `/mcp/oauth/authorize?${query}`, { method: "GET" }, t("This connection request isn't valid."));
}

/** Allow (for one workspace, with the access chosen) or deny; the answer is where the AI app continues. */
export async function POST(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  const raw = await request.text();
  if (raw.length > MAX_QUERY + 1_000) return invalidRequest(t("This connection request isn't valid."));
  let body: Record<string, unknown> | null;
  try { body = JSON.parse(raw); } catch { return invalidRequest(t("This connection request isn't valid.")); }
  const query = typeof body?.query === "string" ? body.query.replace(/^\?/, "") : "";
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const decision = body?.decision === "allow" || body?.decision === "deny" ? body.decision : null;
  const scopes = Array.isArray(body?.scopes) ? body.scopes : null;
  if (!query || query.length > MAX_QUERY || !decision) return invalidRequest(t("This connection request isn't valid."));
  if (!UUID.test(workspaceId)) return invalidRequest(t("Choose a workspace."));
  if (!scopes?.length || scopes.some((scope) => typeof scope !== "string" || !SCOPES.has(scope)) || new Set(scopes).size !== scopes.length) {
    return invalidRequest(t("This connection request isn't valid."));
  }
  return forward(request, "/mcp/oauth/authorize", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, workspaceId, scopes, decision }),
  }, t("The AI app could not be connected."));
}
