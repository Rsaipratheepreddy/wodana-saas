import "server-only";

import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { safeBackendMessage } from "@/lib/auth/server";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A brand image command (start, upload, complete or remove) sent to business-core with the member's session; the
 * backend's own message on a refusal, else the given fallback.
 */
export async function proxyBrandImageCommand(
  path: string,
  init: RequestInit,
  messages: { expired: string; unavailable: string; failed: string },
) {
  const result = await authenticatedBackendFetch(path, init);
  if (result.unauthenticated) {
    const response = NextResponse.json({ message: messages.expired }, { status: 401 });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!result.upstream) return NextResponse.json({ message: messages.unavailable }, { status: 503 });
  const payload = await result.upstream.json().catch(() => null) as Record<string, unknown> | null;
  const response = NextResponse.json(result.upstream.ok ? payload : { message: safeBackendMessage(payload, messages.failed) }, { status: result.upstream.status });
  applyRotatedSession(response, result.rotatedSession);
  return response;
}
