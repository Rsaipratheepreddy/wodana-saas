import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const EVENTS = new Set(["collected", "delivered", "installed"]);

/** Guide J: record a collection, delivery or installation on a deal (a delivery with its photo as proof), or open that photo. */
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !path.length || path.length > 2 || !path.every((id) => UUID.test(id))) return invalidRequest(t("Invalid request."));
  const [opportunityId, fulfilmentId] = path;
  if (request.method === "GET") {
    if (!fulfilmentId) return invalidRequest(t("Invalid request."));
    const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/crm/opportunities/${opportunityId}/fulfilment/${fulfilmentId}/proof${query.get("preview") === "1" ? "?preview=1" : ""}`, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream?.ok) {
      const response = NextResponse.json({ message: result.unauthenticated ? t("Sign in again to open this file.") : t("The file could not be loaded.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 502 });
      applyRotatedSession(response, result.rotatedSession);
      return response;
    }
    const response = new NextResponse(result.upstream.body, { status: 200, headers: {
      "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": result.upstream.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'",
    } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (fulfilmentId) return invalidRequest(t("Invalid request."));
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return invalidRequest(t("Choose a file up to 20 MB."));
  try {
    const input = await request.formData();
    const file = input.get("file"), event = String(input.get("event") ?? ""), receivedBy = String(input.get("receivedBy") ?? "").trim();
    const note = String(input.get("note") ?? "").trim(), commandId = String(input.get("commandId") ?? "");
    if (!EVENTS.has(event) || !receivedBy || receivedBy.length > 200 || note.length > 1000 || (commandId && !UUID.test(commandId))) return invalidRequest(t("Invalid request."));
    if (file !== null && (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024)) return invalidRequest(t("Choose an image or PDF up to 20 MB."));
    const body = new FormData();
    body.set("event", event);
    body.set("receivedBy", receivedBy);
    if (note) body.set("note", note);
    if (commandId) body.set("commandId", commandId);
    if (file instanceof File) body.set("file", file);
    return workspaceJsonResponse(`/workspaces/${workspaceId}/crm/opportunities/${opportunityId}/fulfilment`, { method: "POST", body }, t("The handover could not be recorded."));
  } catch { return invalidRequest(t("Choose a valid file.")); }
}

export { handle as GET, handle as POST };
