import { NextResponse } from "next/server";
import { e2eCatalogResponse } from "@/lib/workspace/catalog-v2.fixture";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

// Proxy for the catalog API: /api/workspace/catalogs[/<path>]?workspaceId=… → /workspaces/<id>/catalogs[/<path>].
async function proxy(request: Request, params: Promise<{ path?: string[] }>, method: string) {
  const t = await getServerT();
  const path = (await params).path ?? [];
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  if (method !== "GET" && !isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  if (path.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return invalidRequest(t("Invalid path."));
  url.searchParams.delete("workspaceId");
  const body = method === "GET" ? undefined : await request.text();
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") return NextResponse.json(e2eCatalogResponse(method, path, body ? JSON.parse(body) : undefined, url.searchParams));
  const query = url.searchParams.toString();
  return workspaceJsonResponse(`/workspaces/${workspaceId}/catalogs${path.length ? `/${path.join("/")}` : ""}${query ? `?${query}` : ""}`, {
    method, ...(body ? { headers: { "content-type": "application/json" }, body } : {}),
  }, t("The catalog request could not be completed."));
}

type Context = { params: Promise<{ path?: string[] }> };
export const GET = (request: Request, context: Context) => proxy(request, context.params, "GET");
export const POST = (request: Request, context: Context) => proxy(request, context.params, "POST");
export const PUT = (request: Request, context: Context) => proxy(request, context.params, "PUT");
export const PATCH = (request: Request, context: Context) => proxy(request, context.params, "PATCH");
