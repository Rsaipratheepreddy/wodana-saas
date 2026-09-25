import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ message: "This request must come from your workspace." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 30_000) return invalidRequest("The import row is too large.");
  const body = await Promise.resolve().then(() => JSON.parse(raw)).catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  const rowIndex = body?.rowIndex;
  const party = body?.party && typeof body.party === "object" && !Array.isArray(body.party) ? body.party as Record<string, unknown> : null;
  const details = body?.details && typeof body.details === "object" && !Array.isArray(body.details) ? body.details as Record<string, unknown> : null;
  const source = typeof body?.source === "string" ? body.source : "";
  const channel = typeof body?.channel === "string" ? body.channel : "";
  const serviceType = typeof body?.serviceType === "string" ? body.serviceType : "";
  const filename = typeof body?.filename === "string" ? body.filename.slice(0, 200) : "";
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 240) : "";
  if (!UUID.test(workspaceId) || !UUID.test(requestId) || !Number.isInteger(rowIndex) || Number(rowIndex) < 1 || Number(rowIndex) > 5000) return invalidRequest("A valid workspace, import request, and row number are required.");
  if (!party || !String(party.displayName ?? "").trim() || !String(party.mobile ?? "").trim() || !details || !String(details.emirate ?? "").trim() || !serviceType || !source || !channel) return invalidRequest("Customer name, mobile, Emirate, Enquiry Type, source, and channel are required.");
  return workspaceJsonResponse(`/workspaces/${workspaceId}/crm/intake-events`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `lead-import:${requestId}:${rowIndex}` },
    body: JSON.stringify({ party, details, source, channel, serviceType, title, intakeMethod: "import", assignment: { mode: "automatic" }, originalPayload: { origin: "crm_csv_import", filename, rowIndex } }),
  }, "The enquiry row could not be imported.");
}
