import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const VALID_TENANT = /^[a-zA-Z0-9_-]{1,160}$/;

export async function GET(_request: Request, context: { params: Promise<{ externalTenantId: string }> }) {
  const t = await getServerT();
  const { externalTenantId } = await context.params;
  if (!VALID_TENANT.test(externalTenantId)) return invalidRequest(t("Choose a valid client."));
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/operations`, {
    method: "GET",
  }, t("Tenant operations could not be loaded."));
}
