import "server-only";

import { tKey } from "@/lib/i18n/keys";
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
      { message: tKey("Your session has expired. Sign in again.") },
      { status: 401 },
    );
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!result.upstream) {
    return NextResponse.json({ message: tKey("The workspace service is unavailable.") }, { status: 503 });
  }

  const payload = await result.upstream.json().catch(() => null);
  const response = NextResponse.json(
    result.upstream.ok ? payload : { message: safeBackendMessage(payload, fallback) + missingSuffix(payload?.missing), ...missingItems(payload?.missing) },
    { status: result.upstream.status },
  );
  applyRotatedSession(response, result.rotatedSession);
  response.headers.set("cache-control", "no-store");
  return response;
}

/** What a refused stage move still needs, as plain labels after the message (older readers show only the message). */
function missingSuffix(missing: unknown) {
  if (!Array.isArray(missing) || !missing.length) return "";
  const labels = missing.map((item) => typeof item === "string" ? item : item && typeof item === "object" && typeof (item as { label?: unknown }).label === "string" ? (item as { label: string }).label : null);
  return labels.every(Boolean) ? `: ${labels.join(", ")}` : "";
}

/** The same items with their keys, so a screen can offer the action that resolves each one. */
function missingItems(missing: unknown) {
  if (!Array.isArray(missing)) return {};
  const items = missing.flatMap((item) => item && typeof item === "object" && typeof (item as { key?: unknown }).key === "string" && typeof (item as { label?: unknown }).label === "string"
    ? [{ key: String((item as { key: string }).key).slice(0, 120), label: String((item as { label: string }).label).slice(0, 240) }] : []);
  return items.length ? { missing: items.slice(0, 50) } : {};
}

export function invalidRequest(message: string): NextResponse {
  return NextResponse.json({ message }, { status: 400 });
}
