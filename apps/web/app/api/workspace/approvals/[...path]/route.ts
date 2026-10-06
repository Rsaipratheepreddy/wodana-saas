import { NextResponse } from "next/server";
import { tKey } from "@/lib/i18n/keys";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/**
 * E3: approval policies, away cover and one request's steps. Paths: policies, policies/{id}, policies/{id}/status,
 * delegations, delegations/{id}/end, requests/{id}.
 */
function allowed(path: string[], method: string) {
  const [head, id, tail] = path;
  if (head === "policies") return (path.length === 1 && ["GET", "POST"].includes(method)) || (path.length === 2 && UUID.test(id) && method === "PUT") || (path.length === 3 && UUID.test(id) && tail === "status" && method === "POST");
  if (head === "delegations") return (path.length === 1 && ["GET", "POST"].includes(method)) || (path.length === 3 && UUID.test(id) && tail === "end" && method === "POST");
  if (head === "requests") return path.length === 2 && UUID.test(id) && method === "GET";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return invalidRequest(tKey("Invalid approvals request."));
  let body: string | undefined;
  if (request.method !== "GET") {
    if (!isSameOrigin(request)) return NextResponse.json({ message: tKey("Use your workspace to make this change.") }, { status: 403 });
    const text = await request.text();
    if (text.length > 50_000) return invalidRequest(tKey("The request is too large."));
    try { const parsed: unknown = JSON.parse(text || "{}"); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalidRequest(tKey("A JSON object is required.")); body = JSON.stringify(parsed); }
    catch { return invalidRequest(tKey("Invalid JSON request.")); }
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/approvals/${path.join("/")}`, { method: request.method, headers: { "content-type": "application/json" }, body },
    tKey("The approval settings could not be saved."));
}

export { handle as GET, handle as POST, handle as PUT };
