import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
import { allowedLogisticsPath, isPermitUpload } from "@/lib/logistics/paths";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KIND = /^(delivery|installation|factory_slot|permit|production)$/;
const PERMIT_FIELDS = ["permitType", "permitNumber", "validFrom", "validTo", "collectedOn", "collectedByWorkerId", "note", "version"];

/** Factory and installation bookings: options, one booking, booking commands, people, vehicles and building permits. */
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowedLogisticsPath(path, request.method)) return NextResponse.json({ message: t("Invalid booking resource.") }, { status: 400 });
  // A permit's file streams back as a file.
  if (path[0] === "permits") {
    const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/logistics/${path.join("/")}`, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream || !result.upstream.ok) return NextResponse.json({ message: t("The file could not be loaded.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    const disposition = result.upstream.headers.get("content-disposition");
    const response = new NextResponse(result.upstream.body, { status: 200, headers: { "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", ...(disposition ? { "content-disposition": disposition } : {}) } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  if (request.method === "POST" && isPermitUpload(path)) {
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return NextResponse.json({ message: t("Choose a PDF or image up to 20 MB.") }, { status: 400 });
    const input = await request.formData().catch(() => null);
    const file = input?.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024 || !(file.type === "application/pdf" || file.type.startsWith("image/")))
      return NextResponse.json({ message: t("Choose a PDF or image up to 20 MB.") }, { status: 400 });
    const body = new FormData();
    for (const key of PERMIT_FIELDS) { const value = input?.get(key); if (typeof value === "string" && value.length <= 500) body.set(key, value); }
    body.set("file", file);
    return workspaceJsonResponse(`/workspaces/${workspaceId}/logistics/${path.join("/")}`, { method: "POST", body }, t("The permit could not be saved."));
  }
  const query = new URLSearchParams();
  if (request.method === "GET" && path[0] === "booking") {
    const kind = url.searchParams.get("kind") ?? "", projectId = url.searchParams.get("projectId") ?? "", opportunityId = url.searchParams.get("opportunityId") ?? "";
    if (!KIND.test(kind) || !(UUID.test(projectId) || UUID.test(opportunityId))) return NextResponse.json({ message: t("Invalid booking resource.") }, { status: 400 });
    query.set("kind", kind);
    for (const key of ["projectId", "opportunityId", "workOrderId", "permitId"]) { const value = url.searchParams.get(key); if (value && UUID.test(value)) query.set(key, value); }
  }
  const from = url.searchParams.get("from");
  if (from && DAY.test(from)) query.set("from", from);
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 100_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  return workspaceJsonResponse(`/workspaces/${workspaceId}/logistics/${path.join("/")}${query.size ? `?${query}` : ""}`,
    { method: request.method, ...(body ? { headers: { "content-type": "application/json" }, body } : {}) }, t("Could not save."));
}

export { handle as GET, handle as POST, handle as PUT };
