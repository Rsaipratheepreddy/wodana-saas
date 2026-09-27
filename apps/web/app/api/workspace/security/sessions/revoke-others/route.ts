import { invalidRequest, UUID } from "@/lib/workspace/workspace-api";
import { securityActionResponse } from "@/lib/workspace/security-api";
import { getServerT } from "@/lib/i18n/server";

export async function POST(request: Request) {
  const t = await getServerT();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  return securityActionResponse("/security/sessions/revoke-others", workspaceId, t("Other sessions could not be signed out."));
}
