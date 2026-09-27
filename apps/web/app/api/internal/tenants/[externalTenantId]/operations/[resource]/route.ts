import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const VALID_TENANT = /^[a-zA-Z0-9_-]{1,160}$/;
const RESOURCES = new Set(["entitlements", "data-policy"]);

export async function PATCH(request: Request, context: { params: Promise<{ externalTenantId: string; resource: string }> }) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("The request origin is not allowed."));
  const { externalTenantId, resource } = await context.params;
  if (!VALID_TENANT.test(externalTenantId) || !RESOURCES.has(resource)) return invalidRequest(t("Choose a valid tenant operation."));
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/operations/${resource}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  }, t("The tenant operation could not be saved."));
}
