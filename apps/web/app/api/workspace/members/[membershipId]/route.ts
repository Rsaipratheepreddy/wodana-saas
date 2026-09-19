import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const ROLE_CODE = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> },
) {
  const { membershipId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const version = body?.version;
  const status = body?.status;
  const roleCodes = body?.roleCodes;

  if (!UUID.test(workspaceId) || !UUID.test(membershipId)) {
    return invalidRequest("A valid workspace and member are required.");
  }
  if (!Number.isInteger(version) || Number(version) < 1) {
    return invalidRequest("A current member version is required.");
  }
  if (status !== undefined && status !== "active" && status !== "suspended") {
    return invalidRequest("Select a valid member status.");
  }
  if (roleCodes !== undefined && (!Array.isArray(roleCodes) || roleCodes.length > 20
    || new Set(roleCodes).size !== roleCodes.length
    || roleCodes.some((role) => typeof role !== "string" || !ROLE_CODE.test(role)))) {
    return invalidRequest("Choose valid direct workspace roles.");
  }
  if (status === undefined && roleCodes === undefined) {
    return invalidRequest("No member changes were provided.");
  }

  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/members/${membershipId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, status, roleCodes }),
    },
    "The member could not be updated.",
  );
}
