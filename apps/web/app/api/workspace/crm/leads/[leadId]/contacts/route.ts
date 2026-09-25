import { CONTACT_CHANNELS, CONTACT_OUTCOMES } from "@/lib/crm/contact";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/** PLM-042: log one contact attempt with its outcome. */
export async function POST(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  if (!isSameOrigin(request)) return invalidRequest("This request must come from the workspace.");
  const { leadId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const version = Number(body?.version);
  const channel = String(body?.channel ?? "");
  const outcome = String(body?.outcome ?? "");
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const nextActionAt = typeof body?.nextActionAt === "string" ? body.nextActionAt : "";
  if (!UUID.test(workspaceId) || !UUID.test(leadId)) return invalidRequest("A valid workspace and enquiry are required.");
  if (!Number.isInteger(version) || version < 1) return invalidRequest("A current enquiry version is required.");
  if (!(CONTACT_CHANNELS as readonly string[]).includes(channel) || !(CONTACT_OUTCOMES as readonly string[]).includes(outcome)) return invalidRequest("Choose how you contacted the client and the outcome.");
  if (!note || note.length > 4000 || reason.length > 160 || (nextActionAt && Number.isNaN(Date.parse(nextActionAt)))) return invalidRequest("Check the note, reason and follow-up date.");
  return workspaceJsonResponse(`/workspaces/${workspaceId}/crm/leads/${leadId}/contacts`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ version, channel, outcome, note, ...(reason ? { reason } : {}), ...(nextActionAt ? { nextActionAt } : {}) }),
  }, "The contact could not be logged.");
}
