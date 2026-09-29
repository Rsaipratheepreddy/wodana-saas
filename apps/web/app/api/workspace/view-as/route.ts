import { NextResponse } from "next/server";
import { getServerT } from "@/lib/i18n/server";
import { viewAsJsonResponse } from "@/lib/workspace/view-as-api";
import { invalidRequest, isSameOrigin, UUID } from "@/lib/workspace/workspace-api";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;

/** Starts a read-only view as a team member (or a role preview). The business service asks for a recent MFA step-up. */
export async function POST(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Use the Wodana sign-in screen to continue.") }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const kind = body?.kind === "role" ? "role" : "person";
  const targetId = typeof (kind === "role" ? body?.roleId : body?.membershipId) === "string" ? String(kind === "role" ? body?.roleId : body?.membershipId) : "";
  const returnPath = typeof body?.returnPath === "string" && body.returnPath.startsWith("/workspace") ? body.returnPath.slice(0, 512) : undefined;
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!UUID.test(workspaceId) || !UUID.test(targetId)) return invalidRequest(t("A valid workspace and person are required."));
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) return invalidRequest(t("This request could not be sent. Try again."));
  return viewAsJsonResponse(`/workspaces/${workspaceId}/view-as`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(kind === "role" ? { kind, roleId: targetId, returnPath } : { kind, membershipId: targetId, returnPath }),
  }, t("The view could not be started."));
}
