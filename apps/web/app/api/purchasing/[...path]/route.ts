import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** Purchasing: suppliers, what projects need to order, purchase orders, deliveries and their settings. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "suppliers") return ["GET", "POST"].includes(method);
  if (path.length === 2 && path[0] === "suppliers" && path[1] === "import") return method === "POST";
  if (path.length === 3 && path[0] === "suppliers" && UUID.test(path[1]) && ["approval", "archive"].includes(path[2])) return method === "POST";
  if (path.length === 2 && path[0] === "suppliers" && UUID.test(path[1])) return method === "GET";
  if (path.length === 3 && path[0] === "suppliers" && UUID.test(path[1]) && ["documents", "bank-accounts", "contracts"].includes(path[2])) return method === "POST";
  if (path.length === 5 && path[0] === "suppliers" && UUID.test(path[1]) && path[2] === "contracts" && UUID.test(path[3]) && path[4] === "cancel") return method === "POST";
  if (path.length === 4 && path[0] === "suppliers" && UUID.test(path[1]) && path[2] === "bank-accounts" && UUID.test(path[3])) return method === "POST";
  if (path.length === 5 && path[0] === "suppliers" && UUID.test(path[1]) && path[2] === "documents" && UUID.test(path[3]) && path[4] === "file") return method === "POST";
  if (path.length === 2 && path[0] === "supplier-documents" && UUID.test(path[1])) return method === "GET";
  if (path.length === 1 && path[0] === "needs") return method === "GET";
  if (path.length === 1 && path[0] === "settings") return ["GET", "PUT"].includes(method);
  if (path.length === 1 && (path[0] === "orders" || path[0] === "price-requests")) return ["GET", "POST"].includes(method);
  if (path.length === 2 && path[0] === "orders" && path[1] === "bulk") return method === "POST";
  if (path.length === 2 && (path[0] === "orders" || path[0] === "price-requests") && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 1 && path[0] === "deliveries") return method === "GET";
  if (path.length === 1 && path[0] === "arrivals") return method === "GET";
  if (path.length === 3 && path[0] === "orders" && UUID.test(path[1]) && path[2] === "receiving") return method === "GET";
  if (path.length === 1 && path[0] === "receipts") return method === "POST";
  if (path.length === 2 && path[0] === "receipts" && UUID.test(path[1])) return method === "GET";
  if (path.length === 3 && path[0] === "receipts" && UUID.test(path[1]) && ["inspection", "reversal"].includes(path[2])) return method === "POST";
  if (path.length === 4 && ["receipts", "unmatched"].includes(path[0]) && UUID.test(path[1]) && path[2] === "photos" && UUID.test(path[3])) return method === "POST";
  if (path.length === 2 && path[0] === "photos" && UUID.test(path[1])) return method === "GET";
  if (path.length === 1 && path[0] === "unmatched") return method === "POST";
  if (path.length === 2 && path[0] === "unmatched" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 1 && path[0] === "returns") return ["GET", "POST"].includes(method);
  if (path.length === 2 && path[0] === "returns" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid purchasing resource.") }, { status: 400 });
  // Delivery photos and supplier documents stream back as files.
  if (path[0] === "photos" || path[0] === "supplier-documents") {
    const preview = path[0] === "photos" && new URL(request.url).searchParams.get("preview") === "1";
    const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/purchasing/${path[0]}/${path[1]}${preview ? "?preview=1" : ""}`, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream || !result.upstream.ok) return NextResponse.json({ message: t("The photo could not be loaded.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    const response = new NextResponse(result.upstream.body, { status: 200, headers: { "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  if (path[2] === "photos" || path[4] === "file") {
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return NextResponse.json({ message: t("Choose a file up to 20 MB.") }, { status: 400 });
    const input = await request.formData().catch(() => null);
    const file = input?.get("file");
    const allowed = (type: string) => type.startsWith("image/") || (path[4] === "file" && type === "application/pdf");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024 || !allowed(file.type)) return NextResponse.json({ message: t("Choose a photo or PDF up to 20 MB.") }, { status: 400 });
    const body = new FormData(); body.set("file", file);
    return workspaceJsonResponse(`/workspaces/${workspaceId}/purchasing/${path.join("/")}`, { method: "POST", body }, t("The photo could not be uploaded."));
  }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 2_000_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  // What's on its way to one project's site.
  if (path[0] === "arrivals") {
    const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
    if (!UUID.test(projectId)) return NextResponse.json({ message: t("Invalid purchasing resource.") }, { status: 400 });
    return workspaceJsonResponse(`/workspaces/${workspaceId}/purchasing/arrivals?projectId=${projectId}`, { method: "GET" }, t("Could not save."));
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/purchasing/${path.join("/")}`,
    { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not save."));
}
export { handle as GET, handle as POST, handle as PUT };
