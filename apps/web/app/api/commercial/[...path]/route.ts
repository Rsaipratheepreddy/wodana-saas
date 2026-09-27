import { NextResponse } from "next/server";
import {
  UUID,
  isSameOrigin,
  workspaceJsonResponse,
} from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
async function handle(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const t = await getServerT();
  const { path } = await params,
    w = new URL(request.url).searchParams.get("workspaceId") ?? "";
  const valid =
    (path.length === 2 && path[0] === "quotation-templates" && UUID.test(path[1]) && request.method === "GET") ||
    (path.length === 3 && ["quotation-templates", "payment-templates"].includes(path[0]) && UUID.test(path[1]) && (
      (path[2] === "history" && request.method === "GET") ||
      (["archive", "rollback"].includes(path[2]) && request.method === "POST")
    )) ||
    (path.length === 1 &&
      ["payment-templates", "quotation-templates"].includes(path[0]) &&
      ["GET", "PUT"].includes(request.method)) ||
    (path[0] === "cases" &&
      UUID.test(path[1] ?? "") &&
      ((path.length === 2 && ["GET", "POST"].includes(request.method)) ||
        (path.length === 3 &&
          ((path[2] === "invoice" && request.method === "POST") ||
            (["catalog-context","catalog-options","master-catalog","quotation-composer"].includes(path[2]) && request.method === "GET") ||
            (["catalog-price","quotation-proposals"].includes(path[2]) && request.method === "POST"))) ||
        (path.length === 5 && path[2] === "quotation-proposals" && UUID.test(path[3]) && ["apply","dismiss"].includes(path[4]) && request.method === "POST")));
  if (!UUID.test(w) || !valid)
    return NextResponse.json(
      { message: t("Invalid commercial resource.") },
      { status: 400 },
    );
  if (request.method !== "GET" && !isSameOrigin(request))
    return NextResponse.json(
      { message: t("Use your workspace to make this change.") },
      { status: 403 },
    );
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 1500000)
    return NextResponse.json(
      { message: t("The request is too large.") },
      { status: 413 },
    );
  const query=new URLSearchParams();
  if(path[2]==="catalog-options")for(const key of ["kind","search","linkedTo","catalogId"]) {const value=new URL(request.url).searchParams.get(key);if(value)query.set(key,value);}
  if(path[2]==="quotation-composer") {const quoteId=new URL(request.url).searchParams.get("quoteId");if(!quoteId || !UUID.test(quoteId)) return NextResponse.json({message:t("Choose a valid quotation.")},{status:400});query.set("quoteId",quoteId);}
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_BYPASS === "true" &&
    request.method === "GET" &&
    path[0] === "cases" &&
    path[2] === "quotation-composer"
  ) {
    const covered = [
      { id: "quote-line-table", title: "Dining table", roomName: "Dining area" },
      { id: "quote-line-chairs", title: "Dining chairs", roomName: "Dining area" },
      { id: "quote-line-media", title: "Media wall & buffet joinery", roomName: "Living area" },
    ];
    return NextResponse.json({
      revision: 1,
      definition: { id: "e2e-confirmed-scope", number: 1, confirmed: true, current: true },
      readiness: { readyForReview: true, blockers: [], warnings: [] },
      coverage: { included: covered, covered, uncovered: [] },
      comparison: { previousQuoteId: null, added: 0, removed: 0, changed: 0, totalDelta: 0, details: { added: [], removed: [], changed: [] } },
      runs: [],
    });
  }
  return workspaceJsonResponse(
    `/workspaces/${w}/commercial/${path.join("/")}${query.size?`?${query}`:""}`,
    {
      method: request.method,
      headers: { "content-type": "application/json" },
      body,
    },
    t("Could not complete the commercial action."),
  );
}
export { handle as GET, handle as POST, handle as PUT };
