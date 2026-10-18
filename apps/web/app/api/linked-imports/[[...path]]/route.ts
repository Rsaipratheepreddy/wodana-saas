import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { intelligenceApiUrl } from "@/lib/auth/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
import { providerErrorCode, providerErrorMessage, providerProblem } from "@/lib/workspace/provider-errors";

/** Linked spreadsheet imports (stock, catalog, suppliers), and the Google Picker that links a sheet. */
function allowed(path: string[], method: string) {
  if (path.length === 0) return ["GET", "POST"].includes(method);
  if (path.length === 1 && path[0] === "picker") return ["GET", "POST"].includes(method);
  if (path.length === 1 && ["source", "preview"].includes(path[0])) return method === "POST";
  if (path.length === 1 && UUID.test(path[0])) return method === "GET";
  if (path.length === 2 && UUID.test(path[0]) && ["refresh", "settings"].includes(path[1])) return method === "POST";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const t = await getServerT();
  const path = (await params).path ?? [];
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid import request.") }, { status: 400 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });

  if (path[0] === "picker") {
    // The Picker needs Wodana's browser key and Cloud project number; without them, linking a sheet isn't offered.
    const apiKey = process.env.GOOGLE_PICKER_API_KEY ?? "", appId = process.env.GOOGLE_PICKER_APP_ID ?? "";
    if (request.method === "GET") return NextResponse.json({ configured: Boolean(apiKey && appId), apiKey, appId }, { headers: { "cache-control": "no-store" } });
    const body = await request.json().catch(() => null);
    if (!UUID.test(body?.connectionId ?? "")) return NextResponse.json({ message: t("Choose a Google connection.") }, { status: 400 });
    const result = await authenticatedBackendFetch("/integrations/google/picker-token", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, connectionId: body.connectionId }) }, intelligenceApiUrl);
    const payload = await result.upstream?.json().catch(() => null);
    // Google's own text never passes: a code picks Wodana's sentence (a revoked account asks to reconnect).
    const code = providerErrorCode(payload);
    const response = NextResponse.json(result.unauthenticated ? { message: t("Your session has expired. Sign in again.") }
      : result.upstream?.ok ? payload : { ...(code ? { code } : {}), problem: providerProblem(code), message: providerErrorMessage(t, code, t("Google isn't available. Check the connection in Connections.")) },
      { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503, headers: { "cache-control": "no-store" } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }

  const query = new URLSearchParams();
  const target = url.searchParams.get("target");
  if (target === "stock" || target === "catalog" || target === "suppliers") query.set("target", target);
  const catalogId = url.searchParams.get("catalogId");
  if (catalogId && UUID.test(catalogId)) query.set("catalogId", catalogId);
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 2_000_000) return NextResponse.json({ message: t("The sheet is too large. Import fewer columns or rows.") }, { status: 413 });
  return workspaceJsonResponse(`/workspaces/${workspaceId}/linked-imports${path.length ? `/${path.join("/")}` : ""}${query.size ? `?${query}` : ""}`,
    { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not import."));
}
export { handle as GET, handle as POST };
