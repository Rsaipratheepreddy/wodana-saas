import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { intelligenceApiUrl, safeBackendMessage } from "@/lib/auth/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function PATCH(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("Invalid request origin."));
  const { connectionId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId) || !UUID.test(connectionId)) return invalidRequest(t("A valid workspace and connection are required."));
  if (!Number.isInteger(body?.version) || Number(body?.version) < 1) return invalidRequest(t("A current connection version is required."));
  const payload = { ...body, workspaceId: undefined };
  return workspaceJsonResponse(`/workspaces/${workspaceId}/integration-connections/${connectionId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, t("The integration connection could not be updated."));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("Invalid request origin."));
  const { connectionId } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const version = Number(url.searchParams.get("version"));
  if (!UUID.test(workspaceId) || !UUID.test(connectionId)) return invalidRequest(t("A valid workspace and connection are required."));
  if (!Number.isInteger(version) || version < 1) return invalidRequest(t("A current connection version is required."));
  const result = await authenticatedBackendFetch(
    `/integrations/providers/workspaces/${workspaceId}/connections/${connectionId}?version=${version}`,
    { method: "DELETE" },
    intelligenceApiUrl,
  );
  if (result.unauthenticated) {
    const response = NextResponse.json({ message: t("Your session has expired. Sign in again.") }, { status: 401 });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!result.upstream) return NextResponse.json({ message: t("The integration authorization service is unavailable.") }, { status: 503 });
  const payload = await result.upstream.json().catch(() => null);
  const response = NextResponse.json(
    result.upstream.ok ? payload : { message: safeBackendMessage(payload, t("The integration connection could not be revoked.")) },
    { status: result.upstream.status },
  );
  applyRotatedSession(response, result.rotatedSession);
  response.headers.set("cache-control", "no-store");
  return response;
}
