import { NextResponse } from "next/server";
import { askWoddy, type WoddyMessage } from "@/lib/crm/woddy.server";
import { isAiPauseMessage } from "@/lib/ai/pause";
import { UUID, invalidRequest, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
import { translateKnown } from "@/lib/i18n/keys";
import { ACCESS_COOKIE } from "@/lib/auth/server";

export async function POST(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 24_000) return invalidRequest(t("That conversation is too long. Start a new chat."));
  let body;
  try { body = JSON.parse(raw); } catch { return invalidRequest(t("Invalid chat request.")); }
  if (!UUID.test(body?.workspaceId ?? "")) return invalidRequest(t("Choose a workspace first."));
  const messages = body.messages as WoddyMessage[];
  if (!Array.isArray(messages) || !messages.length || messages.length > 12 || messages.some((message, index) => !message || message.role !== (index % 2 ? "assistant" : "user") || typeof message.text !== "string" || !message.text.trim() || message.text.length > 3000) || messages.at(-1)?.role !== "user") return invalidRequest(t("Send a question of up to 3,000 characters."));
  const scope = body.context?.type ?? "overview";
  const collection = scope === "lead" ? "leads" : scope === "opportunity" ? "opportunities" : scope === "customer" ? "parties" : scope === "conversation" ? "conversations" : null;
  const delivery = scope === "pre-project" || scope === "commercial" || scope === "project";
  if (scope !== "overview" && !delivery && (!collection || !UUID.test(body.context?.id ?? ""))) return invalidRequest(t("Choose a valid CRM record."));
  if (delivery && !UUID.test(body.context?.id ?? "")) return invalidRequest(t("Choose a valid record."));
  const upstreamPath = scope === "project"
    ? `/workspaces/${body.workspaceId}/projects/${body.context.id}/execution`
    : delivery
      ? `/workspaces/${body.workspaceId}/pre-projects/${body.context.id}/readiness?target=pricing`
      : `/workspaces/${body.workspaceId}/crm/${collection ? `${collection}/${body.context.id}` : "today"}`;
  const upstream = await workspaceJsonResponse(upstreamPath, { method: "GET" }, t("Woddy cannot access this context."));
  if (!upstream.ok) return upstream;
  const record = await upstream.json();
  // Minimize provider context. Contacts, emails, phones, credentials and arbitrary metadata are not sent.
  const facts = scope === "project" ? { scope, phase: record.data?.phase, health: record.pulse?.health, counts: record.pulse?.counts, nextActions: record.pulse?.nextActions?.slice(0, 8).map((item: { kind: string; title: string; detail: string; priority: string }) => ({ kind: item.kind, title: item.title, detail: item.detail, priority: item.priority })), controls: record.data?.controls ? { risk: record.data.controls.risk, onHold: record.data.controls.onHold, handoverDate: record.data.controls.handoverDate, nextAction: record.data.controls.nextAction } : undefined, openOrders: record.data?.orders?.filter((order: { status: string }) => !["closed", "cancelled", "enquiry"].includes(order.status)).length, openSnags: record.data?.snags?.filter((snag: { status: string }) => snag.status !== "closed").length, note: "Delivery project state, permission-filtered. Amounts and personal data are omitted." }
    : delivery ? { scope: "pre-project", ready: record.ready, summary: record.summary, blockers: record.blockers?.slice(0, 10).map((item: { code: string; label: string; detail: string }) => ({ code: item.code, label: item.label, detail: item.detail })), note: "Planning readiness for pricing, permission-filtered." }
    : scope === "lead" ? { scope, status: record.status, leadManager: record.ownerMembershipId ? "Assigned" : "Unassigned", nextActionAt: record.nextActionAt, enquiry: { title: record.enquiry?.title, summary: record.enquiry?.summary, service: record.enquiry?.serviceType }, qualification: record.qualification, opportunities: record.opportunities?.map((item: Record<string, unknown>) => ({ title: item.title, status: item.status })) }
    : scope === "opportunity" ? { scope, title: record.title, status: record.status, stage: record.stageName, nextActionAt: record.nextActionAt, expectedCloseAt: record.expectedCloseAt, amount: record.amount, currency: record.currencyCode, leadManager: record.ownerMembershipId ? "Assigned" : "Unassigned" }
    : scope === "customer" ? { scope, type: record.type, lifecycle: record.lifecycle, contactChannels: record.contacts?.map((item: { type: string }) => item.type), consents: record.consents?.map((item: Record<string, unknown>) => ({ channel: item.channel, purpose: item.purpose, status: item.status })) }
    : scope === "conversation" ? { scope, channel: record.channel, status: record.status, leadManager: record.ownerMembershipId ? "Assigned" : "Unassigned", unreadCount: record.unreadCount, messageStates: record.messages?.slice(-12).map((item: Record<string, unknown>) => ({ direction: item.direction, status: item.status })), note: "Message contents and customer identity are not shared. Customer replies use the tenant’s connected provider; internal notes remain private." }
    : { scope, generatedAt: record.generatedAt, counts: record.counts, returnedItemCount: record.items?.length, note: "Today's permission-filtered work queue, limited to 200 items. Not the entire CRM." };
  let response: NextResponse;
  // A session the context call rotated is used for the model call too (the old refresh token is spent).
  const rotatedAccess = upstream.cookies.get(ACCESS_COOKIE)?.value;
  try { response = NextResponse.json({ answer: await askWoddy(body.workspaceId, facts, messages, rotatedAccess), note: t("AI guidance · Review before acting. Nothing is sent or changed."), scope }, { headers: { "cache-control": "no-store" } }); }
  catch (error) {
    // Credits used up or today's AI limit: a pause the chat shows calmly, not an error to retry.
    const paused = error instanceof Error && isAiPauseMessage(error.message);
    response = NextResponse.json({ message: error instanceof Error && !["AbortError", "TimeoutError", "TypeError"].includes(error.name) ? translateKnown(t, error.message) : t("Woddy took too long to reply. Please try again."), ...(paused ? { paused } : {}) },
      { status: paused ? 402 : 503, headers: { "cache-control": "no-store" } });
  }
  for (const cookie of upstream.cookies.getAll()) response.cookies.set(cookie);
  return response;
}
