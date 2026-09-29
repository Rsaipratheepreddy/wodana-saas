import "server-only";

import { NextResponse } from "next/server";
import { tKey } from "@/lib/i18n/keys";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { safeBackendMessage } from "@/lib/auth/server";

/**
 * Relays a view-as call to the business service and keeps its error `code` (for example
 * MFA_STEP_UP_REQUIRED or view_as_owner_protected), so the dialog can ask for a code or say why.
 */
export async function viewAsJsonResponse(path: string, init: RequestInit, fallback: string): Promise<NextResponse> {
  const result = await authenticatedBackendFetch(path, init);
  if (result.unauthenticated) {
    const response = NextResponse.json({ message: tKey("Your session has expired. Sign in again.") }, { status: 401 });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!result.upstream) return NextResponse.json({ message: tKey("The workspace service is unavailable.") }, { status: 503 });
  const payload = await result.upstream.json().catch(() => null) as Record<string, unknown> | null;
  const code = typeof payload?.code === "string" ? payload.code : undefined;
  const response = NextResponse.json(
    result.upstream.ok ? payload : { message: safeBackendMessage(payload, fallback), ...(code ? { code } : {}) },
    { status: result.upstream.status },
  );
  applyRotatedSession(response, result.rotatedSession);
  response.headers.set("cache-control", "no-store");
  return response;
}
