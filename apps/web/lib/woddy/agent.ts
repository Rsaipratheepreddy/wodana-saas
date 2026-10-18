/**
 * Woddy with tools (W-1, W-3, W-4). Business Core runs the tools with the person's own permissions: reads
 * answer at once, writes come back as cards the person confirms or cancels, drafts go to the chat's reply box.
 * Every answer lists the records it read (its sources) so a fact links to where it came from.
 */
export type WoddyRecordType = "enquiry" | "opportunity" | "customer" | "conversation" | "project" | "work_item" | "crm_task" | "quotation";
export type WoddySurface = "panel" | "inbox" | "comment" | "search";
export type WoddySource = { key: string; type: string; id: string; label: string; href?: string | null };
export type WoddyPreviewField = { label: string; before?: string | null; after: string | null; format?: "datetime" | "date" };
export type WoddyPreview =
  | { kind: "fields"; fields: WoddyPreviewField[] }
  | { kind: "targets"; items: Array<{ type: string; id: string; label: string; href?: string | null; detail?: string | null; now?: string | null }>; selectable: boolean; fields: WoddyPreviewField[] }
  | { kind: "text"; text: string; fields: WoddyPreviewField[] };
export type WoddyCardStatus = "proposed" | "confirmed" | "executed" | "rejected" | "failed" | "expired";
export type WoddyCard = {
  id: string; runId: string; tool: string; status: WoddyCardStatus;
  /** What confirming does: an English key with {placeholders} (translated here) and the same in plain English. */
  title: { key: string; values?: Record<string, string | number> }; summary: string; preview: WoddyPreview;
  target: { type: string; id: string; label: string; href?: string | null } | null; expiresAt: string; version: number; selection: string[] | null;
  record: { type: string; id: string; label: string; href?: string | null } | null; failures: Array<{ id: string; label: string; message: string }>; error: string | null;
  /** Where it was asked: in Wodana, or by an AI app over MCP (then `clientName` is the app). */
  surface?: WoddySurface | "mcp"; clientName?: string | null;
};
export type WoddyAnswer = {
  runId: string; answer: string; sources: WoddySource[]; cited: string[]; proposals: WoddyCard[];
  draft: { text: string; conversationId: string | null } | null; stopped: "rounds" | "tokens" | null;
};
export type WoddyAsk = {
  message: string;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  surface: WoddySurface;
  context?: { type: WoddyRecordType; id: string; label?: string } | null;
  selection?: { type: "conversation" | "enquiry"; ids: string[] } | null;
};
/** A refused ask: a pause (credits used up, today's limit) is shown calmly; anything else is an error to retry. */
export class WoddyAskError extends Error {
  constructor(message: string, readonly paused: boolean) { super(message); this.name = "WoddyAskError"; }
}

/** "@Woddy …" at the start of a line is an instruction for Woddy, never a message to send. */
export const WODDY_MENTION = /^\s*@woddy\b[\s,:]*/i;
export function woddyInstruction(text: string): string | null {
  return WODDY_MENTION.test(text) ? text.replace(WODDY_MENTION, "").trim() : null;
}

export async function askWoddyAgent(workspaceId: string, ask: WoddyAsk, signal?: AbortSignal): Promise<WoddyAnswer> {
  const response = await fetch("/api/workspace/woddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, ...ask }), signal });
  const payload = await response.json().catch(() => null) as (WoddyAnswer & { message?: string; paused?: boolean }) | null;
  if (!response.ok || !payload?.runId) throw new WoddyAskError(payload?.message ?? "Woddy could not reply. Please try again.", Boolean(payload?.paused));
  return payload;
}

/** A card could not be read: its status says whether it's missing (404) or the person has no access (403). */
export class WoddyCardError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "WoddyCardError"; }
}

/** A card as it is now (an expired one says so). */
export async function readWoddyCard(workspaceId: string, toolCallId: string): Promise<WoddyCard> {
  const response = await fetch(`/api/workspace/woddy/tool-calls/${encodeURIComponent(toolCallId)}?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }).catch(() => null);
  const payload = response ? await response.json().catch(() => null) as (WoddyCard & { message?: string }) | null : null;
  if (!response?.ok || !payload?.id) throw new WoddyCardError(payload?.message ?? "The action could not be completed.", response?.status ?? 503);
  return payload;
}

/** Confirm (with the items kept ticked) or cancel a card; the answer is the card as it is now. */
export async function decideWoddyCard(workspaceId: string, card: WoddyCard, decision: "confirm" | "reject", selection?: string[]): Promise<WoddyCard> {
  const response = await fetch(`/api/workspace/woddy/tool-calls/${card.id}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, action: decision, version: card.version, ...(selection ? { selection } : {}) }),
  });
  const payload = await response.json().catch(() => null) as (WoddyCard & { message?: string; code?: string }) | null;
  if (response.status === 410 || payload?.code === "AI_TOOL_CALL_EXPIRED") return { ...card, status: "expired" };
  if (!response.ok || !payload?.id) throw new Error(payload?.message ?? "The action could not be completed.");
  return payload;
}

/** The records an answer cites, in the order it cites them; every source it read when it cites none. */
export function citedSources(answer: Pick<WoddyAnswer, "sources" | "cited">): WoddySource[] {
  const cited = answer.cited.map((key) => answer.sources.find((source) => source.key === key)).filter((source): source is WoddySource => Boolean(source));
  return cited.length ? cited : answer.sources.slice(0, 6);
}
