import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const version = Number(body?.version);

  if (!UUID.test(workspaceId) || !UUID.test(leadId)) {
    return invalidRequest("A valid workspace and lead are required.");
  }
  if (!Number.isInteger(version) || version < 1) {
    return invalidRequest("A current lead version is required.");
  }

  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/crm/leads/${leadId}/auto-assign?version=${version}`,
    { method: "POST" },
    "The lead could not be auto-assigned.",
  );
}
