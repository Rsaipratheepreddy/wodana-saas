import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { intelligenceApiUrl, safeBackendMessage } from "@/lib/auth/server";
import { invalidRequest, isSameOrigin, UUID } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("Invalid request origin."));
  const { connectionId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const version = body?.version;
  const provider = body?.provider;
  if (!UUID.test(workspaceId) || !UUID.test(connectionId)) return invalidRequest(t("A valid workspace and connection are required."));
  if (!Number.isInteger(version) || Number(version) < 1) return invalidRequest(t("A current connection version is required."));
  if (!["google_workspace", "quickbooks", "zoho_books", "whatsapp"].includes(String(provider))) return invalidRequest(t("Provider authorization is not available."));

  const result = await authenticatedBackendFetch(provider === "google_workspace" ? "/integrations/google/oauth/start" : `/integrations/providers/${provider}/oauth/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, connectionId, version, ...(provider === "google_workspace" ? { accessMode: "manage", gmailSend: body?.gmailSend === true, driveFiles: body?.driveFiles === true } : {}) }),
  }, intelligenceApiUrl);
  if (result.unauthenticated) {
    const response = NextResponse.json({ message: t("Your session has expired. Sign in again.") }, { status: 401 });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!result.upstream) return NextResponse.json({ message: t("The integration authorization service is unavailable.") }, { status: 503 });
  const payload = await result.upstream.json().catch(() => null);
  // Wodana's own app for this provider isn't set up yet (Wodana Control): say so, never the raw error.
  const code = (payload as { error?: { code?: unknown } } | null)?.error?.code;
  const unavailable = code === "provider_not_configured" || code === "google_not_configured";
  const response = NextResponse.json(
    result.upstream.ok ? payload : { message: unavailable ? t("Not available yet — Wodana is setting this up")
      : safeBackendMessage(payload, t("Provider authorization could not be started.")) },
    { status: result.upstream.status },
  );
  applyRotatedSession(response, result.rotatedSession);
  response.headers.set("cache-control", "no-store");
  return response;
}
