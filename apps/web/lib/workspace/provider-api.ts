import "server-only";

import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { intelligenceApiUrl, safeBackendMessage } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";
import { translateKnown } from "@/lib/i18n/keys";
import { knownProviderError, providerErrorCode, providerErrorMessage, providerProblem } from "@/lib/workspace/provider-errors";

/**
 * A call to a connected provider through the integration service. A failure carries its code, what it means
 * (`problem`: reconnect, setup, unavailable) and a sentence in the person's language — never the provider's own text.
 */
export async function providerResponse(
  path: string,
  init: RequestInit = {},
  health?: { workspaceId: string; connectionId: string; operation: string },
) {
  const t = await getServerT();
  const result = await authenticatedBackendFetch(path, init, intelligenceApiUrl);
  const payload = await result.upstream?.json().catch(() => null);
  const code = result.upstream?.ok ? undefined : providerErrorCode(payload);
  if (health && !result.unauthenticated) {
    await authenticatedBackendFetch(
      `/workspaces/${health.workspaceId}/integration-connections/${health.connectionId}/runtime-health`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: health.operation,
          succeeded: result.upstream?.ok === true,
          ...(result.upstream?.ok ? {} : { errorCode: code?.toLowerCase() ?? `provider_http_${result.upstream?.status ?? 503}` }),
        }),
      },
    ).catch(() => undefined);
  }
  // A Google call's own words never pass; other providers' messages are already Wodana's (masked by the service).
  const google = path.startsWith("/integrations/google/");
  const message = knownProviderError(code) || google ? providerErrorMessage(t, code)
    : providerErrorMessage(t, code, translateKnown(t, safeBackendMessage(payload, t("The provider is unavailable. Check the connection settings."))));
  const response = NextResponse.json(result.unauthenticated ? { message: t("Sign in again to use this connection.") }
    : result.upstream?.ok ? payload : { ...(code ? { code } : {}), problem: providerProblem(code), message },
    { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503, headers: { "cache-control": "no-store" } });
  applyRotatedSession(response, result.rotatedSession);
  return response;
}
