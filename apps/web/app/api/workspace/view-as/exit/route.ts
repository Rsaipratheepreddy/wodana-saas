import { NextResponse } from "next/server";
import { getServerT } from "@/lib/i18n/server";
import { viewAsJsonResponse } from "@/lib/workspace/view-as-api";
import { invalidRequest, isSameOrigin, UUID } from "@/lib/workspace/workspace-api";

/** Leaves the view: the viewer's own session carries on, and the reply names the page to return to. */
export async function POST(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Use the Wodana sign-in screen to continue.") }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  if (!UUID.test(workspaceId) || !UUID.test(sessionId)) return invalidRequest(t("A valid workspace is required."));
  return viewAsJsonResponse(`/workspaces/${workspaceId}/view-as/${sessionId}/exit`, { method: "POST" }, t("The view could not be closed."));
}
