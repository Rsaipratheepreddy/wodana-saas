import { NextResponse } from "next/server";
import { getServerT } from "@/lib/i18n/server";
import { UUID, invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";
import { woddyBackend } from "@/lib/woddy/proxy.server";

const RECORD_TYPES = new Set(["enquiry", "opportunity", "customer", "conversation", "project", "work_item", "crm_task", "quotation"]);
const SURFACES = new Set(["panel", "inbox", "comment", "search"]);

/**
 * Ask Woddy (W-1): the question, the recent conversation, where the person is (the record open, the chats
 * selected) and nothing else. Business Core decides which tools this person may use.
 */
export async function POST(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 40_000) return invalidRequest(t("That conversation is too long. Start a new chat."));
  let body: Record<string, unknown> | null;
  try { body = JSON.parse(raw); } catch { return invalidRequest(t("Invalid chat request.")); }
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("Choose a workspace first."));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 3000) return invalidRequest(t("Send a question of up to 3,000 characters."));
  const history = Array.isArray(body?.history) ? body.history : [];
  if (history.length > 10 || history.some((item) => !item || !["user", "assistant"].includes(item.role) || typeof item.text !== "string" || !item.text.trim() || item.text.length > 3000)) {
    return invalidRequest(t("Send a question of up to 3,000 characters."));
  }
  const surface = typeof body?.surface === "string" && SURFACES.has(body.surface) ? body.surface : "panel";
  const context = body?.context as { type?: unknown; id?: unknown; label?: unknown } | null | undefined;
  if (context && (typeof context.type !== "string" || !RECORD_TYPES.has(context.type) || typeof context.id !== "string" || context.id.length > 120)) return invalidRequest(t("Choose a valid record."));
  const selection = body?.selection as { type?: unknown; ids?: unknown } | null | undefined;
  if (selection && (!["conversation", "enquiry"].includes(String(selection.type)) || !Array.isArray(selection.ids) || selection.ids.length > 50 || selection.ids.some((id) => typeof id !== "string" || !UUID.test(id)))) {
    return invalidRequest(t("Choose a valid record."));
  }
  return woddyBackend(t, `/workspaces/${workspaceId}/ai/agent/runs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message, surface, history: history.map((item) => ({ role: item.role, text: item.text })),
      ...(context ? { context: { type: context.type, id: context.id, ...(typeof context.label === "string" && context.label.trim() ? { label: context.label.slice(0, 240) } : {}) } } : {}),
      ...(selection && (selection.ids as string[]).length ? { selection: { type: selection.type, ids: selection.ids } } : {}),
    }),
  }, t("Woddy could not reply. Please try again."), { refusals: true });
}
