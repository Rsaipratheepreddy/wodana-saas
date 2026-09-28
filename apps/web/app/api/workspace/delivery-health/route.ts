import { NextResponse } from "next/server";
import { UUID, invalidRequest, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** Delivery health for the people who run the workspace: per channel, set up or not, last success and failure. */
export async function GET(request: Request) {
  const t = await getServerT();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/delivery-health`, { method: "GET" }, t("Delivery health didn't load."));
}

/** "Send me a test": an email, and a push to the person's phone when one is registered. */
export async function POST(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  const body = await request.json().catch(() => null) as { requestId?: unknown } | null;
  if (!UUID.test(workspaceId) || typeof body?.requestId !== "string" || !UUID.test(body.requestId)) return invalidRequest(t("A valid workspace is required."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/delivery-health/test`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: body.requestId }) }, t("The test couldn't be sent."));
}
