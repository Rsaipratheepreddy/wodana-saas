import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { REFRESH_COOKIE, safeBackendMessage } from "@/lib/auth/server";

export async function securityActionResponse(path: string, workspaceId: string, fallback: string) {
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return NextResponse.json({ message: "Your session has expired. Sign in again." }, { status: 401 });
  const result = await authenticatedBackendFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken, workspaceId }),
  });
  if (result.unauthenticated) {
    const response = NextResponse.json({ message: "Your session has expired. Sign in again." }, { status: 401 });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!result.upstream) return NextResponse.json({ message: "The security service is unavailable." }, { status: 503 });
  const payload = await result.upstream.json().catch(() => null);
  const response = NextResponse.json(
    result.upstream.ok ? payload : { message: safeBackendMessage(payload, fallback) },
    { status: result.upstream.status },
  );
  applyRotatedSession(response, result.rotatedSession);
  response.headers.set("cache-control", "no-store");
  return response;
}
