import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_CODE = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

export async function POST(request: Request) {
  const t = await getServerT();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : undefined;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const roleCodes = Array.isArray(body?.roleCodes)
    ? body.roleCodes.filter((role): role is string => typeof role === "string")
    : [];
  const teamIds = Array.isArray(body?.teamIds)
    ? body.teamIds.filter((teamId): teamId is string => typeof teamId === "string")
    : [];

  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  if (body?.displayName !== undefined && (typeof displayName !== "string" || displayName.length < 2 || displayName.length > 160)) {
    return invalidRequest(t("Enter the member's full name."));
  }
  if (!EMAIL.test(email) || email.length > 255) return invalidRequest(t("Enter a valid work email address."));
  if (roleCodes.length > 20 || new Set(roleCodes).size !== roleCodes.length
    || roleCodes.some((role) => !ROLE_CODE.test(role))) {
    return invalidRequest(t("Choose valid workspace roles."));
  }
  if (teamIds.length > 25 || new Set(teamIds).size !== teamIds.length
    || teamIds.some((teamId) => !UUID.test(teamId))) {
    return invalidRequest(t("Choose valid workspace teams."));
  }
  if (!roleCodes.length && !teamIds.length) {
    return invalidRequest(t("Choose at least one workspace team or direct role."));
  }

  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/invitations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName, email, roleCodes, teamIds }),
    },
    t("The invitation could not be created."),
  );
}
