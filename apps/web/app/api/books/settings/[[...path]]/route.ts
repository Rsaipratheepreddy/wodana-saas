import { NextResponse } from "next/server";
import { getServerT } from "@/lib/i18n/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/** Settings › Ledger: every company's state (GET), one company's settings (GET /{companyId}) and the settings commands (POST). */
function allowed(path: string[], method: string) {
  if (!path.length) return method === "GET" || method === "POST";
  return path.length === 1 && UUID.test(path[0]) && method === "GET";
}

async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const t = await getServerT();
  const path = (await params).path ?? [];
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid request.") }, { status: 400 });
  const upstream = `/workspaces/${workspaceId}/books/settings${path.length ? `/${path[0]}` : ""}`;
  if (request.method === "GET") return workspaceJsonResponse(upstream, { method: "GET", cache: "no-store" }, t("Could not load the settings."));
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const body = await request.text();
  if (body.length > 100_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  return workspaceJsonResponse(upstream, { method: "POST", headers: { "content-type": "application/json" }, body }, t("Could not save."));
}

export { handle as GET, handle as POST };
