import { NextResponse } from "next/server";
import { getServerT } from "@/lib/i18n/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const bypass = () => process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true";

/** Turns the person's sound and haptics on or off; it follows them to their other devices. */
export async function PUT(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const body = await request.json().catch(() => null) as { workspaceId?: string; enabled?: unknown } | null;
  if (!UUID.test(body?.workspaceId ?? "")) return invalidRequest(t("A valid workspace is required."));
  if (typeof body?.enabled !== "boolean") return invalidRequest(t("Choose on or off."));
  if (bypass()) return NextResponse.json({ feedbackEnabled: body.enabled });
  return workspaceJsonResponse(`/workspaces/${body.workspaceId}/me/feedback`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: body.enabled }),
  }, t("Your sound setting could not be saved."));
}
