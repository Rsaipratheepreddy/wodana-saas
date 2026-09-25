import { NextResponse } from "next/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const bypass = () => process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true";

/** My photo and chosen avatar in a workspace. */
export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest("A valid workspace is required.");
  if (bypass()) return NextResponse.json({ avatarPreset: null, photoUrl: null, version: 0 });
  return workspaceJsonResponse(`/workspaces/${workspaceId}/me/profile`, { method: "GET" }, "Your profile could not be loaded.");
}

export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return invalidRequest("This request must come from the workspace.");
  const body = await request.json().catch(() => null) as { workspaceId?: string; avatarPreset?: string | null; version?: number } | null;
  if (!UUID.test(body?.workspaceId ?? "")) return invalidRequest("A valid workspace is required.");
  if (bypass()) return NextResponse.json({ avatarPreset: body?.avatarPreset ?? null, photoUrl: null, version: (body?.version ?? 0) + 1 });
  return workspaceJsonResponse(`/workspaces/${body!.workspaceId}/me/avatar`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ avatarPreset: body?.avatarPreset ?? null, version: body?.version }),
  }, "Your avatar could not be saved.");
}
