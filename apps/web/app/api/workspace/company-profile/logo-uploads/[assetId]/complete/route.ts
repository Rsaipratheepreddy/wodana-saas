import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { safeBackendMessage } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const t = await getServerT();
  const { assetId } = await context.params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(assetId)) return NextResponse.json({ message: t("A valid upload is required.") }, { status: 400 });
  const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/company-profile/logo-uploads/${assetId}/complete`, { method: "POST" });
  if (result.unauthenticated) {
    const response = NextResponse.json({ message: t("Your session has expired. Sign in again.") }, { status: 401 });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!result.upstream) return NextResponse.json({ message: t("Logo uploads are unavailable.") }, { status: 503 });
  const payload = await result.upstream.json().catch(() => null);
  const response = NextResponse.json(result.upstream.ok ? payload : { message: safeBackendMessage(payload, t("The logo could not be activated.")) }, { status: result.upstream.status });
  applyRotatedSession(response, result.rotatedSession);
  return response;
}
