import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** What a business's documents print (PLM-112). */
export async function GET(request: Request, { params }: { params: Promise<{ entityId: string }> }) {
  const t = await getServerT();
  const { entityId } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(entityId)) return invalidRequest(t("A valid workspace and legal entity are required."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/legal-entities/${entityId}/letterhead`, { method: "GET" }, t("The letterhead could not be loaded."));
}
