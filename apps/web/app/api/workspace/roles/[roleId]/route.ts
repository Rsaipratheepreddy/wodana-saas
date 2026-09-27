import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const PERMISSION_CODE = /^[a-z][a-z0-9_.-]{1,119}$/;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ roleId: string }> },
) {
  const t = await getServerT();
  const { roleId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const version = body?.version;
  const name = body?.name;
  const description = body?.description;
  const permissionCodes = body?.permissionCodes;

  if (!UUID.test(workspaceId) || !UUID.test(roleId)) {
    return invalidRequest(t("A valid workspace and role are required."));
  }
  if (!Number.isInteger(version) || Number(version) < 1) {
    return invalidRequest(t("A current role version is required."));
  }
  if (name !== undefined && (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100)) {
    return invalidRequest(t("Role name must be between 2 and 100 characters."));
  }
  if (description !== undefined && (typeof description !== "string" || description.length > 500)) {
    return invalidRequest(t("Role description must be 500 characters or fewer."));
  }
  if (permissionCodes !== undefined && (!Array.isArray(permissionCodes)
    || new Set(permissionCodes).size !== permissionCodes.length
    || permissionCodes.some((permission) => typeof permission !== "string" || !PERMISSION_CODE.test(permission)))) {
    return invalidRequest(t("Select valid permissions for this role."));
  }
  if (name === undefined && description === undefined && permissionCodes === undefined) {
    return invalidRequest(t("No role changes were provided."));
  }

  return workspaceJsonResponse(`/workspaces/${workspaceId}/roles/${roleId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      version,
      ...(name === undefined ? {} : { name: String(name).trim() }),
      ...(description === undefined ? {} : { description }),
      ...(permissionCodes === undefined ? {} : { permissionCodes }),
    }),
  }, t("The role could not be updated."));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ roleId: string }> },
) {
  const t = await getServerT();
  const { roleId } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const version = Number(url.searchParams.get("version"));
  if (!UUID.test(workspaceId) || !UUID.test(roleId)) {
    return invalidRequest(t("A valid workspace and role are required."));
  }
  if (!Number.isInteger(version) || version < 1) {
    return invalidRequest(t("A current role version is required."));
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/roles/${roleId}?version=${version}`, {
    method: "DELETE",
  }, t("The role could not be deleted."));
}
