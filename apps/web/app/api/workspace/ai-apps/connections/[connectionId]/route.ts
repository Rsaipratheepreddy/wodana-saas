import { NextResponse } from "next/server";
import { getServerT } from "@/lib/i18n/server";
import { UUID, invalidRequest, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

type Params = { params: Promise<{ connectionId: string }> };

/** Revoke an AI app's connection: the person's own, or anyone's for those who manage AI apps. */
export async function POST(request: Request, { params }: Params) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  const { connectionId } = await params;
  const body = await request.json().catch(() => null) as { workspaceId?: unknown; version?: unknown } | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  if (!UUID.test(connectionId) || typeof body?.version !== "number" || !Number.isInteger(body.version) || body.version < 0) {
    return invalidRequest(t("The AI app could not be revoked."));
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/ai/mcp/connections/${connectionId}/revoke`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: body.version }),
  }, t("The AI app could not be revoked."));
}
