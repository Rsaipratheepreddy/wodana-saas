import { NextResponse } from "next/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const QUOTE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** The quotation builder API: settings, work packages and one quote's lines, discounts and tax. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "settings") return ["GET", "PUT"].includes(method);
  if (path.length === 1 && path[0] === "work-packages") return method === "POST";
  if (path.length === 1 && path[0] === "templates") return method === "GET";
  if (path.length === 2 && path[0] === "work-packages" && UUID.test(path[1])) return method === "PATCH";
  if (path.length === 1 && path[0] === "columns") return method === "POST";
  if (path.length === 2 && path[0] === "columns" && UUID.test(path[1])) return method === "PATCH";
  if (path[0] !== "cases" || !UUID.test(path[1] ?? "") || path[2] !== "quotes" || !QUOTE_ID.test(path[3] ?? "")) return false;
  if (path.length === 4) return method === "GET";
  if (path.length === 5 && ["catalog", "boq"].includes(path[4])) return method === "GET";
  if (path.length === 5 && path[4] === "lines") return method === "POST";
  if (path.length === 7 && path[4] === "lines" && QUOTE_ID.test(path[5]) && path[6] === "to-catalog") return method === "POST";
  if (path.length === 5 && ["discounts", "tax", "payment-terms", "document", "proposal"].includes(path[4])) return method === "PUT";
  if (path.length === 6 && path[4] === "ai" && ["draft", "edit"].includes(path[5])) return method === "POST";
  if (path.length === 5 && path[4] === "comments") return ["GET", "POST"].includes(method);
  if (path.length === 5 && path[4] === "pulse") return method === "POST";
  if (path.length === 5 && path[4] === "templates") return method === "POST";
  if (path.length === 7 && path[4] === "comments" && UUID.test(path[5]) && ["replies", "status"].includes(path[6])) return method === "POST";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: "Invalid quotation resource." }, { status: 400 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: "Use your workspace to make this change." }, { status: 403 });
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 1_000_000) return NextResponse.json({ message: "The request is too large." }, { status: 413 });
  const query = new URLSearchParams();
  const q = url.searchParams.get("q");
  if (path[4] === "catalog" && q) query.set("q", q.slice(0, 120));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/quotation/${path.join("/")}${query.size ? `?${query}` : ""}`,
    { method: request.method, headers: { "content-type": "application/json" }, body }, "Could not update the quotation.");
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH };
