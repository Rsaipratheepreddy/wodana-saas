import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest } from "@/lib/workspace/workspace-api";

export async function GET(_request: Request, context: RouteContext<"/api/internal/provisioning/drafts/[draftId]">) {
  const { draftId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) return invalidRequest("Choose a valid draft.");
  return internalJsonResponse(`/internal/operator/tenant-drafts/${draftId}`, { method: "GET" }, "The provisioning draft could not be loaded.");
}
