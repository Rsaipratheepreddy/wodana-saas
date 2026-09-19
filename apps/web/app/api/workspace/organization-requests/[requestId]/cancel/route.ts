import { NextResponse } from "next/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ message: "Invalid request origin." }, { status: 403 });
  const { requestId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const expectedVersion = Number(body?.expectedVersion);
  if (!UUID.test(workspaceId) || !UUID.test(requestId)) return invalidRequest("A valid workspace and organization request are required.");
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return invalidRequest("The organization request has changed. Refresh and try again.");

  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/account/organization-requests/${requestId}/cancel`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion }) },
    "The organization request could not be cancelled.",
  );
}
