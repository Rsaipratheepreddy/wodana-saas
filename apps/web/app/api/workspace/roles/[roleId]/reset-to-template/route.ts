import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** Gives a role built from a template its template's permissions back. */
export async function POST(request: Request, { params }: { params: Promise<{ roleId: string }> }) {
  const t = await getServerT();
  const { roleId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId) || !UUID.test(roleId)) return invalidRequest(t("A valid workspace and role are required."));
  if (!Number.isInteger(body?.version) || Number(body?.version) < 1) return invalidRequest(t("A current role version is required."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/roles/${roleId}/reset-to-template`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: body?.version }),
  }, t("The role could not be reset."));
}
