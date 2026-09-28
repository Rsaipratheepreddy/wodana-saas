/**
 * Team inbox rules that need no database: chat states, label colours, template placeholders and their
 * values, the optional signature, and the text of a staff notice. The service and the web share the
 * same vocabulary (see apps/web/lib/crm/inbox.ts).
 */
export const CONVERSATION_STATES = ["open", "snoozed", "closed"] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

export const INBOX_VIEWS = ["mine", "unassigned", "team", "all"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

/** Semantic chart colours from the design tokens (--wd-color-viz-1..6); never raw values. */
export const LABEL_COLORS = ["viz-1", "viz-2", "viz-3", "viz-4", "viz-5", "viz-6"] as const;

/** What can fill a WhatsApp template's {{n}}, always read from the chat's own records. */
export const TEMPLATE_VARIABLE_SOURCES = [
  "contact.first_name", "contact.name", "enquiry.reference", "opportunity.reference", "project.name", "project.stage",
  "quote.number", "invoice.number", "invoice.total", "invoice.due_date", "payment.amount", "portal.link", "staff.first_name", "business.name", "today.date",
] as const;
export type TemplateVariableSource = (typeof TEMPLATE_VARIABLE_SOURCES)[number];

export const MAX_SNOOZE_DAYS = 90;

export type NumberHealth = { state: "connected" | "limited" | "blocked"; quality: string | null; limit: string | null; status: string | null };

/** The connected number's standing from Meta's quality rating, status and quality events. */
export function numberHealthState(health: { quality?: string | null; status?: string | null; event?: string | null }): NumberHealth["state"] {
  const status = (health.status ?? "").toUpperCase();
  if (["BANNED", "RESTRICTED", "DISCONNECTED", "DELETED"].includes(status)) return "blocked";
  if ((health.quality ?? "").toUpperCase() === "RED" || ["FLAGGED", "RATE_LIMITED"].includes(status) || ["FLAGGED", "DOWNGRADE"].includes((health.event ?? "").toUpperCase())) return "limited";
  return "connected";
}

/** Enquiry states a chat can be filtered by (the open ones and the outcomes). */
export const ENQUIRY_STAGES = ["new", "attempting_contact", "connected", "nurturing", "paused", "qualified", "disqualified"] as const;

/**
 * The SQL for "the chat's linked record is at one of these stages" (DZ-11), OR'ed together:
 *   lead:<status>          the chat's enquiry (linked, else the client's) has that status
 *   opportunity:<stageId>  the client's open opportunity is at that pipeline stage
 *   project:<stageKey>     the client's active project's current stage
 *   none                   the client has no enquiry, opportunity or project
 * `push` adds a value and returns its placeholder. Unknown tokens are ignored.
 */
export function stageFilterSql(tokens: string[], push: (value: unknown) => string, alias = "conversation") {
  const clauses: string[] = [];
  const cases = `SELECT pc.id FROM pre_project_cases pc JOIN crm_opportunities opp ON opp.workspace_id = pc.workspace_id AND opp.id = pc.opportunity_id
    WHERE pc.workspace_id = ${alias}.workspace_id AND opp.party_id = ${alias}.party_id`;
  for (const token of tokens) {
    const [kind, value] = token.split(":", 2);
    if (kind === "lead" && (ENQUIRY_STAGES as readonly string[]).includes(value)) {
      clauses.push(`EXISTS (SELECT 1 FROM crm_leads stage_lead WHERE stage_lead.workspace_id = ${alias}.workspace_id
        AND (stage_lead.id = ${alias}.lead_id OR (${alias}.lead_id IS NULL AND stage_lead.party_id = ${alias}.party_id)) AND stage_lead.status = ${push(value)}::crm_lead_status)`);
    } else if (kind === "opportunity" && /^[0-9a-f-]{36}$/i.test(value ?? "")) {
      clauses.push(`EXISTS (SELECT 1 FROM crm_opportunities stage_opportunity WHERE stage_opportunity.workspace_id = ${alias}.workspace_id
        AND stage_opportunity.party_id = ${alias}.party_id AND stage_opportunity.status = 'open' AND stage_opportunity.stage_id = ${push(value)}::uuid)`);
    } else if (kind === "project" && /^[a-z0-9_-]{1,60}$/.test(value ?? "")) {
      clauses.push(`EXISTS (SELECT 1 FROM delivery_projects stage_project JOIN project_stages current_stage ON current_stage.workspace_id = stage_project.workspace_id
          AND current_stage.project_id = stage_project.id AND current_stage.status = 'current'
        WHERE stage_project.workspace_id = ${alias}.workspace_id AND stage_project.status = 'active' AND stage_project.case_id IN (${cases}) AND current_stage.key = ${push(value)})`);
    } else if (kind === "none") {
      clauses.push(`(${alias}.lead_id IS NULL AND NOT EXISTS (SELECT 1 FROM crm_leads none_lead WHERE none_lead.workspace_id = ${alias}.workspace_id AND none_lead.party_id = ${alias}.party_id)
        AND NOT EXISTS (SELECT 1 FROM crm_opportunities none_opportunity WHERE none_opportunity.workspace_id = ${alias}.workspace_id AND none_opportunity.party_id = ${alias}.party_id))`);
    }
  }
  return clauses.length ? `(${clauses.join(" OR ")})` : null;
}
export const MAX_TEMPLATE_PARAMETER_LENGTH = 1024;

const PLACEHOLDER = /\{\{\s*(\d{1,2})\s*\}\}/g;

/** The distinct {{n}} positions of a provider template body, ascending. */
export function templatePlaceholders(body: string): number[] {
  const positions = new Set<number>();
  for (const match of body.matchAll(PLACEHOLDER)) positions.add(Number(match[1]));
  return [...positions].sort((a, b) => a - b);
}

/** A template's placeholders are usable when they are exactly {{1}}…{{n}} (Meta's own rule). */
export function placeholdersAreContiguous(positions: number[]) {
  return positions.every((position, index) => position === index + 1);
}

/** Meta refuses new lines, tabs and more than four spaces in a row inside a parameter. */
export function normalizeTemplateParameter(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();
}

/** The body as the client receives it: every {{n}} replaced by its value. */
export function renderTemplate(body: string, parameters: readonly string[]) {
  return body.replace(PLACEHOLDER, (all, position: string) => parameters[Number(position) - 1] ?? all);
}

/** Null when the values fit the template; otherwise the reason, naming the first position at fault. */
export function templateParametersProblem(positions: number[], parameters: readonly string[]): string | null {
  if (!placeholdersAreContiguous(positions)) return "This template's variables are not numbered 1, 2, 3…";
  if (parameters.length !== positions.length) return `This template needs ${positions.length} value${positions.length === 1 ? "" : "s"}`;
  const empty = parameters.findIndex((value) => !value.trim());
  if (empty >= 0) return `Fill in {{${empty + 1}}}`;
  const long = parameters.findIndex((value) => value.length > MAX_TEMPLATE_PARAMETER_LENGTH);
  if (long >= 0) return `{{${long + 1}}} is longer than ${MAX_TEMPLATE_PARAMETER_LENGTH} characters`;
  return null;
}

/** The first name of a person, or null for the placeholder name an unknown WhatsApp number gets. */
export function firstName(displayName: string | null | undefined): string | null {
  const name = (displayName ?? "").trim();
  if (!name || /^whatsapp\s*\+?\d/i.test(name) || /^\+?\d[\d\s-]+$/.test(name)) return null;
  return name.split(/\s+/)[0] || null;
}

/** "— Sara" under a free-text reply when the firm turned the signature on; the client sees one business number. */
export function withSignature(body: string, senderName: string | null | undefined, enabled: boolean) {
  const name = firstName(senderName);
  if (!enabled || !name) return body;
  const signature = `— ${name}`;
  return body.trimEnd().endsWith(signature) ? body : `${body.trimEnd()}\n${signature}`;
}

/** A snooze must end in the future and within the limit. */
export function snoozeProblem(until: Date, now = new Date()): string | null {
  if (Number.isNaN(until.getTime())) return "Choose when this chat comes back";
  if (until.getTime() <= now.getTime() + 60_000) return "Choose a time in the future";
  if (until.getTime() > now.getTime() + MAX_SNOOZE_DAYS * 86_400_000) return `Snooze for at most ${MAX_SNOOZE_DAYS} days`;
  return null;
}

const MEDIA_WORDS: Record<string, [string, string]> = {
  image: ["a photo", "photos"], video: ["a video", "videos"], audio: ["a voice note", "voice notes"],
  document: ["a document", "documents"], sticker: ["a sticker", "stickers"], location: ["a location", "locations"],
};

/** The body of the one notice a chat raises: the message itself, or a count while more arrive. */
export function inboundSummary(unread: number, lastText: string | null | undefined, kinds: readonly string[] = []) {
  const count = Math.max(1, unread);
  const onlyKind = kinds.length && kinds.every((kind) => kind === kinds[0]) ? kinds[0] : null;
  const words = onlyKind ? MEDIA_WORDS[onlyKind] : undefined;
  if (count === 1) {
    const text = (lastText ?? "").replace(/\s+/g, " ").trim();
    if (words && (!text || / received$/i.test(text))) return `Sent ${words[0]}`;
    return text ? (text.length > 140 ? `${text.slice(0, 139)}…` : text) : "New message";
  }
  return words ? `Sent ${count} ${words[1]}` : `${count} new messages`;
}
