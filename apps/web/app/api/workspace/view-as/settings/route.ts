import { NextResponse } from "next/server";
import { getServerT } from "@/lib/i18n/server";
import { viewAsJsonResponse } from "@/lib/workspace/view-as-api";
import { invalidRequest, isSameOrigin, UUID } from "@/lib/workspace/workspace-api";

/** Whether a person gets a notice after someone viewed as them (a workspace setting, on by default). */
export async function PUT(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Use the Wodana sign-in screen to continue.") }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  if (typeof body?.notifySubject !== "boolean" || !Number.isInteger(body?.version) || Number(body?.version) < 0) {
    return invalidRequest(t("This setting could not be saved. Refresh and try again."));
  }
  return viewAsJsonResponse(`/workspaces/${workspaceId}/view-as/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notifySubject: body.notifySubject, version: body.version }),
  }, t("This setting could not be saved. Refresh and try again."));
}
