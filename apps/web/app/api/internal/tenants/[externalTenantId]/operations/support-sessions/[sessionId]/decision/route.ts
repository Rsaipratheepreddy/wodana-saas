import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin, UUID } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function POST(request: Request, context: { params: Promise<{ externalTenantId: string; sessionId: string }> }) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("The request origin is not allowed."));
  const { externalTenantId, sessionId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId) || !UUID.test(sessionId)) return invalidRequest(t("Choose a valid support request."));
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/operations/support-sessions/${sessionId}/decision`, {
    method: "POST", headers: { "content-type": "application/json" }, body: await request.text(),
  }, t("Support access could not be updated."));
}
