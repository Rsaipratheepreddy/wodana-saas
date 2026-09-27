import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function POST(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const t = await getServerT();
  const { teamId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const revisionId = typeof body?.revisionId === "string" ? body.revisionId : "";
  const version = typeof body?.version === "number" ? body.version : -1;
  if (!UUID.test(workspaceId) || !UUID.test(teamId) || !UUID.test(revisionId) || !Number.isInteger(version) || version < 1) {
    return invalidRequest(t("A valid workspace, team, revision, and current version are required."));
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/teams/${teamId}/rollback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revisionId, version }),
  }, t("The team revision could not be restored."));
}
