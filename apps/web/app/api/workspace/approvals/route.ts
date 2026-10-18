import { NextResponse } from "next/server";
import { tKey } from "@/lib/i18n/keys";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/** Everything waiting for the signed-in person (`?count=1` for the badge). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest("A valid workspace is required.");
  return workspaceJsonResponse(`/workspaces/${workspaceId}/approvals/mine${params.get("count") === "1" ? "/count" : ""}`, { method: "GET" },
    "What's waiting for you could not be loaded.");
}

/** Approve, return or refuse one row; the owning module's own checks apply. */
export async function POST(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest("A valid workspace is required.");
  if (!isSameOrigin(request)) return NextResponse.json({ message: tKey("Use your workspace to make this change.") }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.kind !== "string" || typeof body.id !== "string" || typeof body.decision !== "string") return invalidRequest("Choose what to decide.");
  return workspaceJsonResponse(`/workspaces/${workspaceId}/approvals/decide`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: body.kind, id: body.id, decision: body.decision, note: typeof body.note === "string" ? body.note.slice(0, 1000) : "" }),
  }, "The decision could not be saved.");
}
