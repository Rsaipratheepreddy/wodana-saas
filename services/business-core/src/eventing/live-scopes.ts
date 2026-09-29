/**
 * What changed, for screens that show it: each domain event maps to the scopes whose lists should refresh.
 * Only scope names and record ids leave the server, never the event's data: every screen re-reads its own
 * rows through its usual permission-checked API.
 */
export type LiveEventSource = { eventType: string; aggregateType: string; aggregateId: string; payload?: string | null };

const has = (value: string, ...prefixes: string[]) => prefixes.some((prefix) => value.startsWith(prefix));

function dataOf(payload: string | null | undefined): Record<string, unknown> {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(payload) as { data?: unknown };
    return parsed?.data && typeof parsed.data === "object" ? parsed.data as Record<string, unknown> : {};
  } catch { return {}; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (value: unknown) => (typeof value === "string" && UUID.test(value) ? value : null);

export function liveScopes(event: LiveEventSource): string[] {
  const type = event.eventType.toLowerCase();
  const aggregate = event.aggregateType.toLowerCase();
  const data = dataOf(event.payload);
  const scopes = new Set<string>(["workspace"]);
  if (aggregate === "notification" || has(type, "notification.")) scopes.add("notifications");
  if (has(aggregate, "crm_conversation", "crm_message") || has(type, "crm.conversation", "crm.message")) {
    scopes.add("conversations");
    const conversation = aggregate === "crm_conversation" ? id(event.aggregateId) : id(data.conversationId);
    if (conversation) scopes.add(`conversation:${conversation}`);
  }
  if (has(aggregate, "crm_", "lead", "enquiry") || has(type, "crm.")) scopes.add("sales");
  if (has(aggregate, "pre_project", "commercial_case", "quotation", "design_") || has(type, "design.", "quotation.", "pre_project")) scopes.add("planning");
  if (has(aggregate, "project", "delivery_project", "site_", "snag", "handover", "warranty") || has(type, "project.", "site.", "work.", "handover.", "warranty.")) {
    scopes.add("projects");
    const project = id(data.projectId) ?? (aggregate === "project" || aggregate === "delivery_project" ? id(event.aggregateId) : null);
    if (project) scopes.add(`project:${project}`);
  }
  if (has(aggregate, "supplier", "purchase", "goods_receipt", "stock_", "payment_run", "inventory") || has(type, "purchasing.", "stock.", "payables.", "supplier.")) scopes.add("purchasing");
  if (has(aggregate, "factory", "work_order") || has(type, "factory.")) scopes.add("factory");
  if (has(aggregate, "approval") || has(type, "approval") || /(submitted|approval_needed|review_requested)/.test(type)) scopes.add("approvals");
  return [...scopes];
}
