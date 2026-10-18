import { NextResponse } from "next/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** What a person still holds, by module, and who can take it over (SP-4). */
export async function GET(request: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const t = await getServerT();
  const { membershipId } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(membershipId)) return invalidRequest(t("A valid workspace and member are required."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/members/${membershipId}/offboarding`, { method: "GET" }, t("Could not load what this person holds."));
}

/** Hand everything to a successor, sign the person out and suspend them. */
export async function POST(request: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Invalid request origin.") }, { status: 403 });
  const { membershipId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const successorMembershipId = typeof body?.successorMembershipId === "string" ? body.successorMembershipId : "";
  if (!UUID.test(workspaceId) || !UUID.test(membershipId) || !UUID.test(successorMembershipId)) return invalidRequest(t("Choose who takes over."));
  if (!Number.isInteger(body?.version) || Number(body?.version) < 1) return invalidRequest(t("A current member version is required."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/members/${membershipId}/offboarding`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ successorMembershipId, version: body?.version }),
  }, t("Could not offboard this person."));
}
