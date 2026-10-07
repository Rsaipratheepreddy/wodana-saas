import { NextResponse } from "next/server";
import { tKey } from "@/lib/i18n/keys";
import { getServerT } from "@/lib/i18n/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const QUERY_KEYS = ["legalEntityId", "status"];

/**
 * Manual and opening journals: the list and the commands (GET, POST), the editor's options (GET /options), the opening
 * file preview (POST /opening-preview) and one journal (GET /{id}).
 */
function allowed(path: string[], method: string) {
  if (!path.length) return method === "GET" || method === "POST";
  if (path.length !== 1) return false;
  if (path[0] === "options") return method === "GET";
  if (path[0] === "opening-preview") return method === "POST";
  return UUID.test(path[0]) && method === "GET";
}

async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const t = await getServerT();
  const path = (await params).path ?? [];
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid request.") }, { status: 400 });
  const query = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const upstream = `/workspaces/${workspaceId}/books/manual-journals${path.length ? `/${path[0]}` : ""}${request.method === "GET" && query.size ? `?${query}` : ""}`;
  if (request.method === "GET") return workspaceJsonResponse(upstream, { method: "GET", cache: "no-store" }, t(tKey("Could not load the journals.")));
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const body = await request.text();
  // An opening trial balance file travels in the body (up to 1 MB of text).
  if (body.length > 1_200_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  return workspaceJsonResponse(upstream, { method: "POST", headers: { "content-type": "application/json" }, body }, t("Could not save."));
}

export { handle as GET, handle as POST };
