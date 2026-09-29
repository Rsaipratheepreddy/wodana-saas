import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { intelligenceApiUrl, safeBackendMessage } from "@/lib/auth/server";
import { UUID, invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function POST(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Invalid request origin.") }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!UUID.test(body?.workspaceId ?? "") || !Array.isArray(body.connectionIds) || !body.connectionIds.length || body.connectionIds.length > 10 || body.connectionIds.some((id: unknown) => typeof id !== "string" || !UUID.test(id))) return invalidRequest(t("Choose a Google connection."));
  const result = await authenticatedBackendFetch("/integrations/google/calendar-events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: body.workspaceId, connectionIds: body.connectionIds, timeMin: body.timeMin, timeMax: body.timeMax, timeZone: body.timeZone }) }, intelligenceApiUrl);
  const payload = await result.upstream?.json().catch(() => null);
  const response = NextResponse.json(result.unauthenticated ? { message: t("Sign in again to view Google Calendar.") } : result.upstream?.ok ? payload : { message: safeBackendMessage(payload, t("Google Calendar is unavailable. Check your connection in Connections.")) }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503, headers: { "cache-control": "no-store" } });
  applyRotatedSession(response, result.rotatedSession);
  return response;
}
