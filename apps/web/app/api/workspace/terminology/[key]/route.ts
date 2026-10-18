import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const TERMINOLOGY_KEY = /^[a-z][a-z_]{1,59}$/;

function isVersion(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function visibleName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 60 && !/[\u0000-\u001F\u007F]/u.test(value);
}

export async function PUT(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const { key } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId) || !TERMINOLOGY_KEY.test(key)) return invalidRequest(t("A valid workspace and terminology item are required."));
  if (!isVersion(body?.version) || !visibleName(body?.visibleName) || !visibleName(body?.visibleNamePlural)) {
    return invalidRequest(t("Enter a singular and plural name, each up to 60 characters."));
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/terminology/${key}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      version: body.version,
      visibleName: body.visibleName.trim(),
      visibleNamePlural: body.visibleNamePlural.trim(),
    }),
  }, t("Workspace terminology could not be saved."));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const { key } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId) || !TERMINOLOGY_KEY.test(key) || !isVersion(body?.version, 1)) {
    return invalidRequest(t("A valid workspace, terminology item, and version are required."));
  }
  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/terminology/${key}?version=${body.version}`,
    { method: "DELETE" },
    t("Workspace terminology could not be restored."),
  );
}

