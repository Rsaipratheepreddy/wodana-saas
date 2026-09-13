import "server-only";

import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { safeBackendMessage } from "@/lib/auth/server";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    const incoming = new URL(origin);
    // Next's internal request URL can use its bind hostname (e.g. localhost).
    // The HTTP Host is the browser-facing authority; browsers cannot spoof it.
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? new URL(request.url).protocol.replace(":", "");
    return incoming.host === host && incoming.protocol === `${protocol}:`;
  } catch { return false; }
}

export async function workspaceJsonResponse(
  path: string,
  init: RequestInit,
  fallback: string,
): Promise<NextResponse> {
  const result = await authenticatedBackendFetch(path, init);
  if (result.unauthenticated) {
    const response = NextResponse.json(
      { message: "Your session has expired. Sign in again." },
      { status: 401 },
    );
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!result.upstream) {
    return NextResponse.json({ message: "The workspace service is unavailable." }, { status: 503 });
  }

  const payload = await result.upstream.json().catch(() => null);
  const response = NextResponse.json(
    result.upstream.ok ? payload : { message: safeBackendMessage(payload, fallback) + (Array.isArray(payload?.missing) && payload.missing.every((item: unknown) => typeof item === "string") ? `: ${payload.missing.join(", ")}` : "") },
    { status: result.upstream.status },
  );
  applyRotatedSession(response, result.rotatedSession);
  response.headers.set("cache-control", "no-store");
  return response;
}

export function invalidRequest(message: string): NextResponse {
  return NextResponse.json({ message }, { status: 400 });
}
