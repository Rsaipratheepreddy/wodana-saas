import { NextResponse } from "next/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const bypass = () => process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest("A valid workspace is required.");
  if (bypass()) return NextResponse.json({ enabled: true, version: 1, available: true });
  return workspaceJsonResponse(`/workspaces/${workspaceId}/ai-settings`, { method: "GET" }, "AI settings could not be loaded.");
}

export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return invalidRequest("This request must come from the workspace.");
  const body = await request.json().catch(() => null) as { workspaceId?: string; enabled?: boolean; version?: number } | null;
  if (!UUID.test(body?.workspaceId ?? "")) return invalidRequest("A valid workspace is required.");
  if (bypass()) return NextResponse.json({ enabled: Boolean(body?.enabled), version: (body?.version ?? 0) + 1, available: true });
  return workspaceJsonResponse(`/workspaces/${body!.workspaceId}/ai-settings`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: body?.enabled, version: body?.version }),
  }, "AI settings could not be saved.");
}
