import { NextResponse } from "next/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** Settings → Projects → Warranty. */
async function handle(request: Request) {
  const t = await getServerT();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return NextResponse.json({ message: t("Invalid workspace.") }, { status: 400 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 10_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  return workspaceJsonResponse(`/workspaces/${workspaceId}/warranty-settings`, { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not save."));
}
export { handle as GET, handle as PUT };
