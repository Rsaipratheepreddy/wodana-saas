import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** The factory: what to make, work orders and their output, and its settings. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && ["state", "schedule", "production"].includes(path[0])) return method === "GET";
  if (path.length === 1 && path[0] === "samples") return ["GET", "POST"].includes(method);
  if (path.length === 2 && path[0] === "samples" && UUID.test(path[1])) return method === "POST";
  if (path.length === 1 && path[0] === "batches") return method === "POST";
  if (path.length === 1 && path[0] === "orders") return method === "POST";
  if (path.length === 2 && path[0] === "orders" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 6 && path[0] === "orders" && UUID.test(path[1]) && path[2] === "checks" && UUID.test(path[3]) && path[4] === "photos" && UUID.test(path[5])) return method === "POST";
  if (path.length === 2 && path[0] === "photos" && UUID.test(path[1])) return method === "GET";
  // PLM-150: design inspections: the list, one round (read, pass or fail), its photos.
  if (path.length === 1 && path[0] === "inspections") return method === "GET";
  if (path.length === 2 && path[0] === "inspections" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 4 && path[0] === "inspections" && UUID.test(path[1]) && path[2] === "photos" && UUID.test(path[3])) return method === "POST";
  if (path.length === 2 && path[0] === "inspection-photos" && UUID.test(path[1])) return method === "GET";
  if (path.length === 1 && path[0] === "settings") return ["GET", "PUT"].includes(method);
  if (path.length === 1 && path[0] === "workcenters") return method === "POST";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid factory resource.") }, { status: 400 });
  // A quality check's (or an inspection's) photo streams back as a file.
  if (path[0] === "photos" || path[0] === "inspection-photos") {
    const preview = url.searchParams.get("preview") === "1";
    const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/factory/${path[0]}/${path[1]}${preview ? "?preview=1" : ""}`, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream || !result.upstream.ok) return NextResponse.json({ message: t("The photo could not be loaded.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    const response = new NextResponse(result.upstream.body, { status: 200, headers: { "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  if (path[4] === "photos" || (path[0] === "inspections" && path[2] === "photos")) {
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return NextResponse.json({ message: t("Choose a file up to 20 MB.") }, { status: 400 });
    const input = await request.formData().catch(() => null);
    const file = input?.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024 || !file.type.startsWith("image/")) return NextResponse.json({ message: t("Choose a photo up to 20 MB.") }, { status: 400 });
    const form = new FormData(); form.set("file", file);
    return workspaceJsonResponse(`/workspaces/${workspaceId}/factory/${path.join("/")}`, { method: "POST", body: form }, t("The photo could not be uploaded."));
  }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 1_000_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  // The schedule's window: a date and a number of days.
  const query = new URLSearchParams();
  const from = url.searchParams.get("from");
  const days = url.searchParams.get("days");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query.set("from", from);
  if (days && /^\d{1,3}$/.test(days)) query.set("days", days);
  // One case's sample requests.
  const caseId = url.searchParams.get("caseId");
  if (caseId && UUID.test(caseId)) query.set("caseId", caseId);
  // PLM-150: the open inspections: one project's, the viewer's own, or due in a date range (as the design calendar reads them).
  const projectId = url.searchParams.get("projectId");
  if (projectId && UUID.test(projectId)) query.set("projectId", projectId);
  if (url.searchParams.get("mine") === "1") query.set("mine", "1");
  const to = url.searchParams.get("to");
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) query.set("to", to);
  return workspaceJsonResponse(`/workspaces/${workspaceId}/factory/${path.join("/")}${query.size ? `?${query}` : ""}`,
    { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not save."));
}
export { handle as GET, handle as POST, handle as PUT };
