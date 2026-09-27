import { NextResponse } from "next/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function GET(request: Request) {
  const t = await getServerT();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/home-layout`, { method: "GET" }, t("Your Home layout could not be loaded."));
}

export async function PUT(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Request origin is not allowed.") }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || !UUID.test(String(body.workspaceId ?? ""))) return invalidRequest(t("A valid workspace is required."));
  return workspaceJsonResponse(`/workspaces/${body.workspaceId}/home-layout`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: body.version, widgets: body.widgets }),
  }, t("Your Home layout could not be saved."));
}
