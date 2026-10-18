import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const is = (path: string[], length: number, ...parts: Array<string | typeof UUID>) =>
  path.length === length && parts.every((part, index) => (typeof part === "string" ? path[index] === part : part.test(path[index])));

/**
 * The firm's side of the client portal: settings, a project's portal and client contacts, and what the client did
 * (the moodboard, reported payments, issues and conversations).
 */
function allowed(path: string[], method: string) {
  if (is(path, 1, "settings")) return ["GET", "PUT"].includes(method);
  if (is(path, 2, "projects", UUID)) return ["GET", "PUT"].includes(method);
  if (path.length === 3 && is(path, 3, "projects", UUID) && ["invite", "revoke"].includes(path[2])) return method === "POST";
  if (is(path, 3, "projects", UUID, "issues")) return method === "GET";
  if (is(path, 4, "projects", UUID, "issues", UUID)) return method === "POST";
  if (is(path, 3, "cases", UUID, "contacts")) return ["GET", "PUT"].includes(method);
  if (is(path, 3, "cases", UUID, "preview")) return method === "GET";
  if (is(path, 3, "cases", UUID, "moodboard") || is(path, 3, "cases", UUID, "payment-reports") || is(path, 3, "cases", UUID, "threads")) return method === "GET";
  if (path.length === 4 && is(path, 4, "cases", UUID, "moodboard") && ["share", "reply"].includes(path[3])) return method === "POST";
  if (is(path, 5, "cases", UUID, "threads", UUID, "read")) return method === "POST";
  if (is(path, 2, "payment-reports", UUID)) return method === "POST";
  if (path.length === 5 && is(path, 5, "cases", UUID, "contacts", UUID) && ["sign-out", "demo-code"].includes(path[4])) return method === "POST";
  return false;
}

/** A file the client added, streamed privately for the team: never cached, never scriptable. */
async function clientFile(workspaceId: string, caseId: string, assetId: string, preview: boolean) {
  const t = await getServerT();
  const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/client-portal/cases/${caseId}/files/${assetId}${preview ? "?preview=1" : ""}`, { cache: "no-store" });
  if (result.unauthenticated || !result.upstream?.ok || !result.upstream.body) {
    const response = NextResponse.json({ message: result.unauthenticated ? t("Sign in again to open this file.") : t("The file could not be loaded.") },
      { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  const response = new NextResponse(result.upstream.body, { headers: {
    "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
    "content-disposition": result.upstream.headers.get("content-disposition") ?? "inline",
    "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'",
  } });
  applyRotatedSession(response, result.rotatedSession);
  return response;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get("workspaceId") ?? "";
  if (UUID.test(workspaceId) && request.method === "GET" && is(path, 4, "cases", UUID, "files", UUID))
    return clientFile(workspaceId, path[1], path[3], query.get("preview") === "1");
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid client portal resource.") }, { status: 400 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 50_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  return workspaceJsonResponse(`/workspaces/${workspaceId}/client-portal/${path.map(encodeURIComponent).join("/")}`,
    { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not save."));
}

export { handle as GET, handle as POST, handle as PUT };
