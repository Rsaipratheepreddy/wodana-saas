import "server-only";

import { NextResponse } from "next/server";
import { refusalOf } from "@/lib/ai/gateway.server";
import { aiPauseOf, AI_PAUSE_MESSAGES } from "@/lib/ai/pause";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { safeBackendMessage } from "@/lib/auth/server";
import { WODDY_REFUSALS } from "@/lib/crm/woddy.server";
import { translateKnown, type Translate } from "@/lib/i18n/keys";

/**
 * Sends a Woddy request to Business Core as the signed-in person and passes the answer back. A refusal keeps
 * what the page needs: a calm pause (credits used up, today's limit) or the module's own message, translated
 * when it is a known one; an expired card keeps its code.
 */
export async function woddyBackend(t: Translate, path: string, init: RequestInit, fallback: string, options: { refusals?: boolean } = {}): Promise<NextResponse> {
  const result = await authenticatedBackendFetch(path, { ...init, signal: AbortSignal.timeout(170_000) });
  if (result.unauthenticated) {
    const response = NextResponse.json({ message: t("Your session has expired. Sign in again.") }, { status: 401 });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!result.upstream) return NextResponse.json({ message: t("Woddy took too long to reply. Please try again.") }, { status: 503 });
  const payload = await result.upstream.json().catch(() => null) as Record<string, unknown> | null;
  let response: NextResponse;
  if (result.upstream.ok) response = NextResponse.json(payload);
  else {
    const status = result.upstream.status;
    const pause = aiPauseOf(status, payload);
    const code = typeof payload?.code === "string" ? payload.code : undefined;
    const message = pause ? t(AI_PAUSE_MESSAGES[pause])
      : options.refusals && (code?.startsWith("AI_") || [403, 429, 503].includes(status)) ? translateKnown(t, WODDY_REFUSALS[refusalOf(status, payload)])
      : translateKnown(t, safeBackendMessage(payload, fallback));
    response = NextResponse.json({ message, ...(pause ? { paused: true } : {}), ...(code ? { code } : {}) }, { status: pause ? 402 : status });
  }
  applyRotatedSession(response, result.rotatedSession);
  response.headers.set("cache-control", "no-store");
  return response;
}
