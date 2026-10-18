import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const PERMISSION_CODE = /^[a-z][a-z0-9_.-]{1,119}$/;
const LEVELS = ["none", "view", "edit", "manage"];

/** A role's access by module: one level per module and the advanced permissions. Business Core expands and checks them. */
export async function PUT(request: Request, { params }: { params: Promise<{ roleId: string }> }) {
  const t = await getServerT();
  const { roleId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const { version, levels, extras } = body ?? {};
  if (!UUID.test(workspaceId) || !UUID.test(roleId)) return invalidRequest(t("A valid workspace and role are required."));
  if (!Number.isInteger(version) || Number(version) < 1) return invalidRequest(t("A current role version is required."));
  if (!levels || typeof levels !== "object" || Array.isArray(levels)
    || Object.entries(levels).some(([module, level]) => !/^[a-z_]{2,40}$/.test(module) || !LEVELS.includes(String(level)))) {
    return invalidRequest(t("Choose an access level for each module."));
  }
  if (!Array.isArray(extras) || new Set(extras).size !== extras.length
    || extras.some((code) => typeof code !== "string" || !PERMISSION_CODE.test(code))) {
    return invalidRequest(t("Select valid permissions for this role."));
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/roles/${roleId}/access`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version, levels, extras }),
  }, t("The role could not be updated."));
}
