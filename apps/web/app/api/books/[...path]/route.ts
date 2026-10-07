import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/**
 * The Ledger (engine books): one proxy to business-core /workspaces/:id/books/… for every Ledger slice — reports
 * (overview, company reports, accounts, journals), posting issues and their retry, settings, manual journals, bill
 * capture and project profit. Business-core checks the permission of every call; this only keeps the address to
 * the Ledger's resources, keeps changes same-origin and passes files (CSV, PDF, photos) through.
 */
const RESOURCES = new Set([
  "reports", "issues", "settings", "templates", "accounts", "roles", "payment-accounts", "tax-codes", "journals", "manual-journals", "opening",
  "capture", "captures", "projects",
]);
const SEGMENT = /^[A-Za-z0-9_-]{1,80}$/;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_JSON = 500_000;
const MAX_FILE = 21 * 1024 * 1024;

function allowed(path: string[]) {
  return path.length >= 1 && path.length <= 5 && RESOURCES.has(path[0]) && path.every((segment) => SEGMENT.test(segment));
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path) || !METHODS.has(request.method)) return invalidRequest(t("Invalid report request."));
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  const query = new URLSearchParams(url.searchParams);
  query.delete("workspaceId");
  if (query.toString().length > 2000) return invalidRequest(t("The request filters are too long."));
  const upstream = `/workspaces/${workspaceId}/books/${path.join("/")}${query.size ? `?${query}` : ""}`;

  // Files (a report as CSV with format=csv, a captured bill's …/file) stream through; JSON goes through the shared reader.
  if (request.method === "GET" && (query.get("format") === "csv" || path[path.length - 1] === "file")) {
    const result = await authenticatedBackendFetch(upstream, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream || !result.upstream.ok) {
      const reason = result.upstream ? await result.upstream.json().then((data) => (typeof data?.message === "string" ? data.message : null)).catch(() => null) : null;
      return NextResponse.json({ message: reason ?? t("The report could not be loaded.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    }
    const headers: Record<string, string> = { "content-type": result.upstream.headers.get("content-type") || "application/octet-stream", "cache-control": "private, no-store",
      "x-content-type-options": "nosniff" };
    const disposition = result.upstream.headers.get("content-disposition");
    if (disposition) headers["content-disposition"] = disposition;
    const response = new NextResponse(result.upstream.body, { status: 200, headers });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (request.method === "GET") return workspaceJsonResponse(upstream, { method: "GET", headers: { "content-type": "application/json" } }, t("The report could not be loaded."));

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    if (Number(request.headers.get("content-length")) > MAX_FILE) return NextResponse.json({ message: t("Choose a file up to 20 MB.") }, { status: 400 });
    const input = await request.formData().catch(() => null);
    if (!input) return invalidRequest(t("Invalid report request."));
    return workspaceJsonResponse(upstream, { method: request.method, body: input }, t("Could not save."));
  }
  const body = await request.text();
  if (body.length > MAX_JSON) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  if (body) {
    try { const parsed: unknown = JSON.parse(body); if (!parsed || typeof parsed !== "object") return invalidRequest(t("A JSON object is required.")); }
    catch { return invalidRequest(t("Invalid JSON request.")); }
  }
  return workspaceJsonResponse(upstream, { method: request.method, headers: { "content-type": "application/json" }, body: body || undefined }, t("Could not save."));
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT };
