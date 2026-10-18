import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const ROLE_CODE = /^[a-z][a-z0-9_-]{1,63}$/;
const PERMISSION_CODE = /^[a-z][a-z0-9_.-]{1,119}$/;

export async function POST(request: Request) {
  const t = await getServerT();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const code = typeof body?.code === "string" ? body.code.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const permissionCodes = body?.permissionCodes;

  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  if (!ROLE_CODE.test(code)) return invalidRequest(t("Use a valid role code."));
  if (name.length < 2 || name.length > 100) return invalidRequest(t("Role name must be between 2 and 100 characters."));
  if (description.length > 500) return invalidRequest(t("Role description must be 500 characters or fewer."));
  if (!Array.isArray(permissionCodes)
    || new Set(permissionCodes).size !== permissionCodes.length
    || permissionCodes.some((permission) => typeof permission !== "string" || !PERMISSION_CODE.test(permission))) {
    return invalidRequest(t("Select valid permissions for this role."));
  }

  return workspaceJsonResponse(`/workspaces/${workspaceId}/roles`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name, description, permissionCodes }),
  }, t("The role could not be created."));
}
