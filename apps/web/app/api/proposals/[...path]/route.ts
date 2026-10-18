import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { getServerT } from "@/lib/i18n/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUOTE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SLOT = /^[1235]$/;
const MAX_BYTES = 20 * 1024 * 1024;

type Kind = "json" | "file" | "upload";

/**
 * Proposals (PLM-085), quotation documents and numbering, the QS hand-off (PLM-082/084), e-sign requests (R8) and the
 * intro deck (PLM-106). Only these paths pass; files stream through with the backend's own type and disposition.
 */
function route(path: string[], method: string): Kind | null {
  const [head, a, b, c, d, e, f] = path;
  if (head === "numbering") return path.length === 1 && method === "GET" ? "json" : null;
  if (head === "template") {
    if (path.length === 1) return method === "GET" ? "json" : null;
    if (a !== "pages" || !SLOT.test(b ?? "")) return null;
    if (path.length === 3) return method === "PUT" ? "upload" : null;
    if (path.length === 4 && c === "remove") return method === "POST" ? "json" : null;
    if (path.length === 4 && c === "file") return method === "GET" ? "file" : null;
    return null;
  }
  if (head === "opportunities" && ID.test(a ?? "") && path.length === 3) {
    if (b === "intro-deck") return method === "GET" ? "json" : null;
    if (b === "intro-page.pdf") return method === "GET" ? "file" : null;
    return null;
  }
  if (head !== "cases" || !ID.test(a ?? "")) return null;
  if (b === "documents") {
    if (path.length === 3) return method === "GET" ? "json" : null;
    if (path.length === 4 && c === "external") return method === "POST" ? "upload" : null;
    if (!ID.test(c ?? "") || d !== "versions") return null;
    if (path.length === 5) return method === "POST" ? "upload" : null;
    if (path.length === 7 && /^\d{1,6}$/.test(e ?? "") && f === "file") return method === "GET" ? "file" : null;
    return null;
  }
  if (b === "signatures" && ID.test(c ?? "") && d === "revoke" && path.length === 5) return method === "POST" ? "json" : null;
  if (b !== "quotes" || !QUOTE_ID.test(c ?? "")) return null;
  if (path.length === 5 && d === "proposal.pdf") return method === "GET" ? "file" : null;
  if (path.length === 5 && ["proposal", "signature"].includes(d ?? "")) return method === "POST" ? "json" : null;
  if (path.length === 5 && ["client-view", "qs"].includes(d ?? "")) return method === "GET" ? "json" : null;
  if (path.length === 6 && d === "qs" && ["send", "decide"].includes(e ?? "")) return method === "POST" ? "json" : null;
  return null;
}

const UPLOAD_FIELDS = ["version", "id", "reference", "title", "amount", "currency", "note"];

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const kind = route(path, request.method);
  if (!UUID.test(workspaceId) || !kind) return invalidRequest(t("Invalid proposal request."));
  const upstreamPath = `/workspaces/${workspaceId}/proposals/${path.map(encodeURIComponent).join("/")}`;
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });

  if (kind === "file") {
    const download = url.searchParams.get("download") === "1" ? "?download=1" : "";
    const result = await authenticatedBackendFetch(`${upstreamPath}${download}`, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream?.ok) {
      const response = NextResponse.json({ message: result.unauthenticated ? t("Sign in again to open this file.") : t("The file could not be loaded.") },
        { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
      applyRotatedSession(response, result.rotatedSession);
      return response;
    }
    const response = new NextResponse(result.upstream.body, { status: 200, headers: {
      "content-type": result.upstream.headers.get("content-type") ?? "application/pdf",
      "content-disposition": result.upstream.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'",
    } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }

  if (kind === "upload") {
    if (Number(request.headers.get("content-length")) > MAX_BYTES + 1024 * 1024) return invalidRequest(t("Choose a file up to 20 MB."));
    try {
      const input = await request.formData();
      const file = input.get("file");
      if (!(file instanceof File) || !file.size || file.size > MAX_BYTES) return invalidRequest(t("Choose a PDF up to 20 MB."));
      const body = new FormData();
      for (const field of UPLOAD_FIELDS) {
        const value = input.get(field);
        if (typeof value === "string" && value.length <= 1000) body.set(field, value);
      }
      body.set("file", file);
      return workspaceJsonResponse(upstreamPath, { method: request.method, body }, t("The file could not be saved."));
    } catch { return invalidRequest(t("Choose a valid file.")); }
  }

  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 100_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  return workspaceJsonResponse(upstreamPath, { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not update the proposal."));
}

export { handle as GET, handle as POST, handle as PUT };
