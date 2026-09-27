import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { safeBackendMessage } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Sets or restores the workspace brand colour. The backend checks the settings permission, the
// workspace version and records the change; the logo is managed by the company profile routes.
export async function PUT(request: Request) {
  const t = await getServerT();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId)) return NextResponse.json({ message: t("A valid workspace is required.") }, { status: 400 });
  const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/appearance`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceVersion: body?.workspaceVersion, primaryColor: body?.primaryColor ?? null }),
  });
  if (result.unauthenticated) {
    const response = NextResponse.json({ message: t("Your session has expired. Sign in again.") }, { status: 401 });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!result.upstream) return NextResponse.json({ message: t("The workspace service is unavailable.") }, { status: 503 });
  const payload = await result.upstream.json().catch(() => null);
  const response = NextResponse.json(
    result.upstream.ok ? payload : { message: safeBackendMessage(payload, t("The brand colour could not be saved.")) },
    { status: result.upstream.status, headers: { "cache-control": "no-store" } },
  );
  applyRotatedSession(response, result.rotatedSession);
  return response;
}
