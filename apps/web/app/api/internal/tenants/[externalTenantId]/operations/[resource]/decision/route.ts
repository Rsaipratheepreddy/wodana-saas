import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin, UUID } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ externalTenantId: string; resource: string }>;
  },
) {
  const t = await getServerT();
  if (!isSameOrigin(request))
    return invalidRequest(t("The request origin is not allowed."));
  const { externalTenantId, resource: operationId } = await context.params;
  if (
    !/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId) ||
    !UUID.test(operationId)
  ) {
    return invalidRequest(t("Choose a valid tenant operation."));
  }
  return internalJsonResponse(
    `/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/operations/${operationId}/decision`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
    },
    t("The tenant operation could not be updated."),
  );
}
