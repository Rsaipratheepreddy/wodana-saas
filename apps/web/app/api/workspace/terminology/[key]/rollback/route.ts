import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const TERMINOLOGY_KEY = /^[a-z][a-z_]{1,59}$/;

export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const { key } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const revisionId = typeof body?.revisionId === "string" ? body.revisionId : "";
  const version = body?.version;
  if (
    !UUID.test(workspaceId) ||
    !UUID.test(revisionId) ||
    !TERMINOLOGY_KEY.test(key) ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 0
  ) return invalidRequest(t("A valid workspace, terminology revision, and current version are required."));
  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/terminology/${key}/rollback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revisionId, version }),
    },
    t("Workspace language could not be restored."),
  );
}
