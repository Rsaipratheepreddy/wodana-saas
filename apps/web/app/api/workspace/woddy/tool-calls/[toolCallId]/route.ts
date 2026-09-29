import { NextResponse } from "next/server";
import { getServerT } from "@/lib/i18n/server";
import { UUID, invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";
import { woddyBackend } from "@/lib/woddy/proxy.server";

type Params = { params: Promise<{ toolCallId: string }> };

/** A card as it is now (expired ones say so). */
export async function GET(request: Request, { params }: Params) {
  const t = await getServerT();
  const { toolCallId } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(toolCallId)) return invalidRequest(t("Choose a valid record."));
  return woddyBackend(t, `/workspaces/${workspaceId}/ai/tool-calls/${toolCallId}`, { method: "GET" }, t("The action could not be completed."));
}

/** Confirm (with the items kept ticked) or cancel what Woddy prepared. Only the person who asked can. */
export async function POST(request: Request, { params }: Params) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  const { toolCallId } = await params;
  const raw = await request.text();
  if (raw.length > 8_000) return invalidRequest(t("The action could not be completed."));
  let body: Record<string, unknown> | null;
  try { body = JSON.parse(raw); } catch { return invalidRequest(t("The action could not be completed.")); }
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const action = body?.action === "confirm" ? "confirm" : body?.action === "reject" ? "reject" : null;
  const version = typeof body?.version === "number" && Number.isInteger(body.version) && body.version > 0 ? body.version : null;
  const selection = Array.isArray(body?.selection) ? body.selection : undefined;
  if (!UUID.test(workspaceId) || !UUID.test(toolCallId) || !action || !version) return invalidRequest(t("The action could not be completed."));
  if (selection && (action !== "confirm" || selection.length > 50 || selection.some((id) => typeof id !== "string" || !UUID.test(id)))) return invalidRequest(t("The action could not be completed."));
  return woddyBackend(t, `/workspaces/${workspaceId}/ai/tool-calls/${toolCallId}/${action}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version, ...(selection ? { selection } : {}) }),
  }, t("The action could not be completed."));
}
