import "server-only";
import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { intelligenceApiUrl, safeBackendMessage } from "@/lib/auth/server";

export async function providerResponse(
  path: string,
  init: RequestInit = {},
  health?: { workspaceId: string; connectionId: string; operation: string },
) {
  const result = await authenticatedBackendFetch(path, init, intelligenceApiUrl);
  const payload = await result.upstream?.json().catch(() => null);
  if (health && !result.unauthenticated) {
    await authenticatedBackendFetch(
      `/workspaces/${health.workspaceId}/integration-connections/${health.connectionId}/runtime-health`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: health.operation,
          succeeded: result.upstream?.ok === true,
          ...(result.upstream?.ok ? {} : { errorCode: `provider_http_${result.upstream?.status ?? 503}` }),
        }),
      },
    ).catch(() => undefined);
  }
  const response = NextResponse.json(result.unauthenticated ? { message: "Sign in again to use this connection." }
    : result.upstream?.ok ? payload : { message: safeBackendMessage(payload, "The provider is unavailable. Check the connection settings.") },
    { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503, headers: { "cache-control": "no-store" } });
  applyRotatedSession(response, result.rotatedSession);
  return response;
}
