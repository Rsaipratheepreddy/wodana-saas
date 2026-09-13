import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ invitationId: string }> },
) {
  const { invitationId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId) || !UUID.test(invitationId)) {
    return invalidRequest("A valid workspace and invitation are required.");
  }
  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/invitations/${invitationId}/resend`,
    { method: "POST" },
    "The invitation could not be renewed.",
  );
}
