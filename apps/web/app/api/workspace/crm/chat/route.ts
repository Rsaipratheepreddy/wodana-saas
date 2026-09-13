import { NextResponse } from "next/server";
import { askWoddy, type WoddyMessage } from "@/lib/crm/woddy.server";
import { UUID, invalidRequest, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ message: "This request must come from your workspace." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 24_000) return invalidRequest("That conversation is too long. Start a new chat.");
  let body;
  try { body = JSON.parse(raw); } catch { return invalidRequest("Invalid chat request."); }
  if (!UUID.test(body?.workspaceId ?? "")) return invalidRequest("Choose a workspace first.");
  const messages = body.messages as WoddyMessage[];
  if (!Array.isArray(messages) || !messages.length || messages.length > 12 || messages.some((message, index) => !message || message.role !== (index % 2 ? "assistant" : "user") || typeof message.text !== "string" || !message.text.trim() || message.text.length > 3000) || messages.at(-1)?.role !== "user") return invalidRequest("Send a question of up to 3,000 characters.");
  const scope = body.context?.type ?? "overview";
  const collection = scope === "lead" ? "leads" : scope === "opportunity" ? "opportunities" : scope === "customer" ? "parties" : scope === "conversation" ? "conversations" : null;
  if (scope !== "overview" && (!collection || !UUID.test(body.context?.id ?? ""))) return invalidRequest("Choose a valid CRM record.");
  const upstream = await workspaceJsonResponse(`/workspaces/${body.workspaceId}/crm/${collection ? `${collection}/${body.context.id}` : "today"}`, { method: "GET" }, "Woddy cannot access this CRM context.");
  if (!upstream.ok) return upstream;
  const record = await upstream.json();
  // Minimize provider context. Contacts, emails, phones, credentials and arbitrary metadata are not sent.
  const facts = scope === "lead" ? { scope, status: record.status, leadManager: record.ownerMembershipId ? "Assigned" : "Unassigned", nextActionAt: record.nextActionAt, enquiry: { title: record.enquiry?.title, summary: record.enquiry?.summary, service: record.enquiry?.serviceType }, qualification: record.qualification, opportunities: record.opportunities?.map((item: Record<string, unknown>) => ({ title: item.title, status: item.status })) }
    : scope === "opportunity" ? { scope, title: record.title, status: record.status, stage: record.stageName, nextActionAt: record.nextActionAt, expectedCloseAt: record.expectedCloseAt, amount: record.amount, currency: record.currencyCode, leadManager: record.ownerMembershipId ? "Assigned" : "Unassigned" }
    : scope === "customer" ? { scope, type: record.type, lifecycle: record.lifecycle, contactChannels: record.contacts?.map((item: { type: string }) => item.type), consents: record.consents?.map((item: Record<string, unknown>) => ({ channel: item.channel, purpose: item.purpose, status: item.status })) }
    : scope === "conversation" ? { scope, channel: record.channel, status: record.status, leadManager: record.ownerMembershipId ? "Assigned" : "Unassigned", unreadCount: record.unreadCount, messageStates: record.messages?.slice(-12).map((item: Record<string, unknown>) => ({ direction: item.direction, status: item.status })), note: "Message contents and customer identity are not shared. Customer replies use the tenant’s connected provider; internal notes remain private." }
    : { scope, generatedAt: record.generatedAt, counts: record.counts, returnedItemCount: record.items?.length, note: "Today's permission-filtered work queue, limited to 200 items. Not the entire CRM." };
  let response: NextResponse;
  try { response = NextResponse.json({ answer: await askWoddy(body.workspaceId, facts, messages), note: "AI guidance · Review before acting. Nothing is sent or changed.", scope }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { response = NextResponse.json({ message: error instanceof Error && !["AbortError", "TimeoutError", "TypeError"].includes(error.name) ? error.message : "Woddy took too long to reply. Please try again." }, { status: 503, headers: { "cache-control": "no-store" } }); }
  for (const cookie of upstream.cookies.getAll()) response.cookies.set(cookie);
  return response;
}
