import { NextResponse } from "next/server";
import {
  UUID,
  isSameOrigin,
  workspaceJsonResponse,
} from "@/lib/workspace/workspace-api";
async function handle(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params,
    w = new URL(request.url).searchParams.get("workspaceId") ?? "";
  const valid =
    (path.length === 2 && path[0] === "quotation-templates" && UUID.test(path[1]) && request.method === "GET") ||
    (path.length === 1 &&
      ["portal-settings", "payment-templates", "quotation-templates"].includes(path[0]) &&
      ["GET", "PUT"].includes(request.method)) ||
    (path[0] === "cases" &&
      UUID.test(path[1] ?? "") &&
      ((path.length === 2 && ["GET", "POST"].includes(request.method)) ||
        (path.length === 3 &&
          ((path[2] === "invoice" && request.method === "POST") || (path[2] === "contacts" && request.method === "PUT") ||
            (["catalog-context","catalog-options"].includes(path[2]) && request.method === "GET")))));
  if (!UUID.test(w) || !valid)
    return NextResponse.json(
      { message: "Invalid commercial resource." },
      { status: 400 },
    );
  if (request.method !== "GET" && !isSameOrigin(request))
    return NextResponse.json(
      { message: "Use your workspace to make this change." },
      { status: 403 },
    );
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 1500000)
    return NextResponse.json(
      { message: "The request is too large." },
      { status: 413 },
    );
  const query=new URLSearchParams();
  if(path[2]==="catalog-options")for(const key of ["kind","search","linkedTo","catalogId"]) {const value=new URL(request.url).searchParams.get(key);if(value)query.set(key,value);}
  return workspaceJsonResponse(
    `/workspaces/${w}/commercial/${path.join("/")}${query.size?`?${query}`:""}`,
    {
      method: request.method,
      headers: { "content-type": "application/json" },
      body,
    },
    "Could not complete the commercial action.",
  );
}
export { handle as GET, handle as POST, handle as PUT };
