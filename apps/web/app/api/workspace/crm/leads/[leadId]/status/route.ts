import { CRM_LEAD_STATUSES } from "@/lib/crm/leads";
import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const version = Number(body?.version);
  const status = typeof body?.status === "string" ? body.status : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const nextActionAt = typeof body?.nextActionAt === "string" ? body.nextActionAt : undefined;

  if (!UUID.test(workspaceId) || !UUID.test(leadId)) {
    return invalidRequest("A valid workspace and lead are required.");
  }
  if (!Number.isInteger(version) || version < 1) {
    return invalidRequest("A current lead version is required.");
  }
  if (!(CRM_LEAD_STATUSES as readonly string[]).includes(status)) {
    return invalidRequest("Select a valid lead status.");
  }
  if ((status === "paused" || status === "disqualified") && !reason) {
    return invalidRequest("Add a reason for pausing or disqualifying this lead.");
  }
  if (reason.length > 160 || (nextActionAt && Number.isNaN(Date.parse(nextActionAt)))) {
    return invalidRequest("The status reason or next-action date is invalid.");
  }

  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/crm/leads/${leadId}/status`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version,
        status,
        ...(reason ? { reason } : {}),
        ...(nextActionAt ? { nextActionAt } : {}),
      }),
    },
    "The lead status could not be updated.",
  );
}
