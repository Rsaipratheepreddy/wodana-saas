import { internalBinaryResponse } from "@/lib/internal/proxy";
import { invalidRequest, UUID } from "@/lib/workspace/workspace-api";

export async function GET(_: Request, context: { params: Promise<{ externalTenantId: string; exportId: string }> }) {
  const { externalTenantId, exportId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId) || !UUID.test(exportId)) {
    return invalidRequest("Choose a valid tenant export.");
  }
  return internalBinaryResponse(
    `/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/operations/exports/${exportId}/content`,
    "The tenant export could not be downloaded.",
  );
}
