import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/**
 * Product sourcing: /api/workspace/product-sourcing/<path>?workspaceId=… → /workspaces/<id>/product-sourcing/<path>.
 * Pictures (clips/{id}/images/{id}, link-previews/{id}/image) stream through; everything else is JSON.
 */
const ROUTES: Array<[RegExp, string[]]> = [
  [/^clips$/, ["POST"]],
  [/^clips\/U$/, ["GET"]],
  [/^clips\/U\/(save|discard)$/, ["POST"]],
  [/^clips\/U\/images\/U$/, ["GET"]],
  [/^items\/U\/source$/, ["GET"]],
  [/^items\/U\/dimensions$/, ["PUT"]],
  [/^link-previews$/, ["POST"]],
  [/^link-previews\/U\/image$/, ["GET"]],
  [/^cases\/U\/access-points$/, ["GET"]],
  [/^cases\/U\/access-points\/U$/, ["PUT"]],
  [/^cases\/U\/access-points\/U\/archive$/, ["POST"]],
  [/^cases\/U\/fit-checks$/, ["POST"]],
  [/^cases\/U\/fit-checks\/overrides$/, ["POST"]],
];

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const shape = path.map((part) => (UUID.test(part) ? "U" : part)).join("/");
  const allowed = ROUTES.some(([pattern, methods]) => pattern.test(shape) && methods.includes(request.method));
  if (!UUID.test(workspaceId) || !allowed || path.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return invalidRequest(t("Invalid path."));
  if (request.method !== "GET" && !isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const base = `/workspaces/${workspaceId}/product-sourcing/${path.join("/")}`;
  if (/images\/U$|\/image$/.test(shape)) {
    const result = await authenticatedBackendFetch(`${base}${url.searchParams.get("preview") === "1" ? "?preview=1" : ""}`, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream?.ok) return NextResponse.json({ message: result.unauthenticated ? t("Sign in again to see this image.") : t("The image could not be loaded.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    const response = new NextResponse(result.upstream.body, { headers: { "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream", "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'" } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 100_000) return invalidRequest(t("This request is too large."));
  return workspaceJsonResponse(base, { method: request.method, ...(body ? { headers: { "content-type": "application/json" }, body } : {}) }, t("The request could not be completed."));
}

export { handle as GET, handle as POST, handle as PUT };
