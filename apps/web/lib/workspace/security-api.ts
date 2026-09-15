import "server-only";

import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendPost } from "@/lib/auth/backend-session";
import { safeBackendMessage } from "@/lib/auth/server";

export async function securityActionResponse(path: string, workspaceId: string, fallback: string) {
  const result = await authenticatedBackendPost(path, { workspaceId });
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
