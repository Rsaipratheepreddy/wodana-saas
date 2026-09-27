import { invalidRequest, UUID } from "@/lib/workspace/workspace-api";
import { securityActionResponse } from "@/lib/workspace/security-api";
import { getServerT } from "@/lib/i18n/server";

export async function POST(request: Request, { params }: { params: Promise<{ familyId: string }> }) {
  const t = await getServerT();
  const { familyId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId) || !UUID.test(familyId)) return invalidRequest(t("A valid workspace and session are required."));
  return securityActionResponse(`/security/sessions/${familyId}/revoke`, workspaceId, t("The session could not be revoked."));
}
