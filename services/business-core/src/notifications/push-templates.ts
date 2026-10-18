import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { queueUserPush } from "./default-templates";

type Db = Pick<PoolClient, "query">;

/**
 * §0.3 Push like a delivery app: one short push for each moment of a job, worded by the firm (Setup → Push
 * notifications) with the kit's wording until it changes it. A push has a title, a line of text with the moment's
 * facts in {braces}, and one action button the phone shows. Team pushes go to the staff app, client pushes to the
 * client's app in their own words. Every push still follows the person's choices and quiet hours.
 */
export type PushAction = "open" | "review" | "reply" | "pay";
export type PushAudience = "team" | "client";
export type PushEventKey = "job_step" | "step_late" | "mention" | "client_step" | "client_waiting";
export type PushTemplate = { key: PushEventKey; title: string; body: string; action: PushAction; enabled: boolean };
export type PushEvent = PushTemplate & { audience: PushAudience; label: string; variables: string[]; actions: PushAction[]; sample: Record<string, string> };

export const TITLE_LIMIT = 60;
/** About what a lock screen shows before it cuts the text off. */
export const BODY_LIMIT = 178;

export const PUSH_EVENTS: PushEvent[] = [
  { key: "job_step", audience: "team", label: "A job moves to its next step", title: "{job}", body: "Now: {step} · {chapter} ({done} of {total})", action: "open", enabled: true,
    variables: ["job", "step", "chapter", "done", "total"], actions: ["open", "review"],
    sample: { job: "Villa 12 · J-000038", step: "Mood boards", chapter: "Design", done: "14", total: "41" } },
  { key: "step_late", audience: "team", label: "A step is late", title: "{step} is late", body: "{job}: it was due {due}. Tap to update it.", action: "open", enabled: true,
    variables: ["job", "step", "due"], actions: ["open", "review"], sample: { job: "Villa 12", step: "Proposal 1 sent", due: "14 Oct" } },
  { key: "mention", audience: "team", label: "Someone mentions you in a job's chat", title: "{author} mentioned you", body: "{job}: {text}", action: "reply", enabled: true,
    variables: ["author", "job", "text"], actions: ["reply", "open"], sample: { author: "Sam", job: "Villa 12", text: "Client confirmed the oak finish." } },
  { key: "client_step", audience: "client", label: "The client's project moves on", title: "{brand}", body: "{chapter}: {step}", action: "open", enabled: true,
    variables: ["brand", "chapter", "step"], actions: ["open"], sample: { brand: "Your studio", chapter: "Your design", step: "Mood boards to choose from" } },
  { key: "client_waiting", audience: "client", label: "Something waits for the client", title: "Waiting for you", body: "{step}. Tap to see it in your portal.", action: "review", enabled: true,
    variables: ["brand", "step"], actions: ["review", "open", "pay"], sample: { brand: "Your studio", step: "Your quotation" } },
];
const EVENT = new Map(PUSH_EVENTS.map((event) => [event.key, event]));
export const isPushEventKey = (value: unknown): value is PushEventKey => typeof value === "string" && EVENT.has(value as PushEventKey);

/** Fills {name} from the values (an unknown one is left out), collapses spaces and keeps to the limit. */
export function fillPush(text: string, values: Record<string, string>, limit: number) {
  const filled = text.replace(/\{([a-z]+)\}/g, (_, name: string) => values[name] ?? "").replace(/\s+/g, " ").replace(/\s+([:,.])/g, "$1")
    .replace(/(?:\s*·\s*)+$/, "").replace(/^(?:\s*·\s*)+/, "").replace(/·\s*·/g, "·").trim();
  return filled.length > limit ? `${filled.slice(0, limit - 1).trimEnd()}…` : filled;
}

/** The push as the phone shows it: title, text and the action's category (the button), from the template and the moment's facts. */
export function renderPush(template: Pick<PushTemplate, "title" | "body" | "action">, values: Record<string, string>) {
  return { title: fillPush(template.title, values, TITLE_LIMIT), body: fillPush(template.body, values, BODY_LIMIT), category: template.action };
}

/** A firm's templates, checked: each known moment once, a title and text within the limits, an action that moment offers. */
export function normalisePushTemplates(input: unknown): PushTemplate[] {
  if (!Array.isArray(input) || input.length > PUSH_EVENTS.length) throw new BadRequestException("Send the push notifications to save.");
  const seen = new Set<string>();
  return input.map((raw, index) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    if (!isPushEventKey(row.key) || seen.has(row.key)) throw new BadRequestException(`Push notification ${index + 1} isn't one the project sends.`);
    seen.add(row.key);
    const event = EVENT.get(row.key)!;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const body = typeof row.body === "string" ? row.body.trim() : "";
    if (!title || title.length > TITLE_LIMIT) throw new BadRequestException(`Give "${event.label}" a title of up to ${TITLE_LIMIT} characters.`);
    if (!body || body.length > BODY_LIMIT) throw new BadRequestException(`Keep the text of "${event.label}" to ${BODY_LIMIT} characters.`);
    const unknown = [...`${title} ${body}`.matchAll(/\{([a-z]+)\}/g)].map((match) => match[1]).filter((name) => !event.variables.includes(name));
    if (unknown.length) throw new BadRequestException(`"${event.label}" can use ${event.variables.map((name) => `{${name}}`).join(", ")}, not {${unknown[0]}}.`);
    const action = row.action as PushAction;
    if (!event.actions.includes(action)) throw new BadRequestException(`Choose a button "${event.label}" offers.`);
    return { key: row.key, title, body, action, enabled: row.enabled !== false };
  });
}

export const pushVersion = (templates: PushTemplate[]) => createHash("sha256").update(JSON.stringify(templates)).digest("hex").slice(0, 16);

/** Every moment's push for the workspace: the firm's wording where it changed it, the kit's otherwise. */
export async function readPushTemplates(db: Db, workspaceId: string): Promise<{ templates: PushTemplate[]; version: string }> {
  const rows = (await db.query<{ key: PushEventKey; title: string; body: string; action: PushAction; enabled: boolean }>(
    `SELECT event_key AS key, title, body, action, enabled FROM setup_push_templates WHERE workspace_id = $1`, [workspaceId])).rows;
  const own = new Map(rows.filter((row) => isPushEventKey(row.key)).map((row) => [row.key, row]));
  const templates = PUSH_EVENTS.map(({ key, title, body, action, enabled }) => {
    const row = own.get(key);
    return row ? { key, title: row.title, body: row.body, action: row.action, enabled: row.enabled } : { key, title, body, action, enabled };
  });
  return { templates, version: pushVersion(templates) };
}

export async function readPushTemplate(db: Db, workspaceId: string, key: PushEventKey): Promise<PushTemplate> {
  return (await readPushTemplates(db, workspaceId)).templates.find((template) => template.key === key)!;
}

/** Saves the firm's wording (version-checked; the same wording again changes nothing). A moment back at the kit's wording keeps no row. */
export async function savePushTemplates(db: Db, workspaceId: string, userId: string, input: { version?: unknown; templates?: unknown }) {
  const before = await readPushTemplates(db, workspaceId);
  if (input.version !== before.version) throw new ConflictException("The push notifications changed in another window. Reload and try again.");
  const changed = normalisePushTemplates(input.templates);
  const merged = before.templates.map((template) => changed.find((item) => item.key === template.key) ?? template);
  if (pushVersion(merged) === before.version) return { before, after: before, changed: false };
  for (const template of merged) {
    const kit = EVENT.get(template.key)!;
    const same = kit.title === template.title && kit.body === template.body && kit.action === template.action && kit.enabled === template.enabled;
    if (same) await db.query(`DELETE FROM setup_push_templates WHERE workspace_id = $1 AND event_key = $2`, [workspaceId, template.key]);
    else await db.query(`INSERT INTO setup_push_templates (workspace_id, event_key, title, body, action, enabled, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (workspace_id, event_key) DO UPDATE SET title = excluded.title, body = excluded.body, action = excluded.action, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()`,
      [workspaceId, template.key, template.title, template.body, template.action, template.enabled, userId]);
  }
  return { before, after: await readPushTemplates(db, workspaceId), changed: true };
}

/** The event type a moment's push is sent under (it decides which of the person's switches applies). */
export const PUSH_EVENT_TYPE: Record<PushEventKey, string> = {
  job_step: "project.job_step", step_late: "project.step_late", mention: "job.mentioned", client_step: "portal.step_changed", client_waiting: "portal.waiting",
};
const KEY_OF_EVENT_TYPE = new Map(Object.entries(PUSH_EVENT_TYPE).map(([key, type]) => [type, key as PushEventKey]));

/** The button a push shows (its category), read when it goes out: the firm's chosen action for the moment. */
export async function pushCategoryFor(db: Db, workspaceId: string, eventType: string): Promise<PushAction | null> {
  const key = KEY_OF_EVENT_TYPE.get(eventType);
  return key ? (await readPushTemplate(db, workspaceId, key)).action : null;
}

/**
 * Queues one team push for a moment, worded from the firm's template, through the person's own choices and quiet
 * hours (an alert still goes). Nothing when the firm switched the moment off; the same key again sends nothing new.
 */
export async function queueTeamPush(db: Db, input: { workspaceId: string; userId: string; key: Exclude<PushEventKey, "client_step" | "client_waiting">; values: Record<string, string>;
  deepLink: string; idempotencyKey: string }) {
  const template = await readPushTemplate(db, input.workspaceId, input.key);
  if (!template.enabled) return { queued: false as const, reason: "push_off_for_firm" };
  const push = renderPush(template, input.values);
  return queueUserPush(db, { workspaceId: input.workspaceId, recipientUserId: input.userId, eventType: PUSH_EVENT_TYPE[input.key], subject: push.title, body: push.body,
    deepLink: input.deepLink, idempotencyKey: input.idempotencyKey });
}

/**
 * Queues one push to a client contact's phone (the client app, registered with their consent), in their words.
 * Nothing when the firm switched the moment off, the client turned push notices off, or no phone of theirs is registered.
 */
export async function queueClientPush(db: Db, input: { workspaceId: string; grantId: string; key: "client_step" | "client_waiting"; values: Record<string, string>; deepLink: string; idempotencyKey: string }) {
  const template = await readPushTemplate(db, input.workspaceId, input.key);
  if (!template.enabled) return { queued: false as const, reason: "push_off_for_firm" };
  const eventType = PUSH_EVENT_TYPE[input.key];
  const preference = (await db.query<{ enabled: boolean }>(
    `SELECT enabled FROM notification_preferences WHERE workspace_id = $1 AND recipient_type = 'portal_contact' AND recipient_id = $2 AND channel = 'push'
       AND event_type::text IN ($3::text, 'portal.*', '*') ORDER BY CASE WHEN event_type::text = $3::text THEN 0 WHEN event_type::text = '*' THEN 2 ELSE 1 END LIMIT 1`,
    [input.workspaceId, input.grantId, eventType])).rows[0];
  if (preference?.enabled === false) return { queued: false as const, reason: "recipient_preference" };
  const device = (await db.query(`SELECT 1 FROM client_portal_grants grant_row JOIN client_portal_devices device ON device.workspace_id = grant_row.workspace_id AND device.phone = grant_row.phone
     WHERE grant_row.workspace_id = $1 AND grant_row.id = $2 AND grant_row.active AND device.token_hash IS NOT NULL AND device.opted_out_at IS NULL LIMIT 1`, [input.workspaceId, input.grantId])).rowCount;
  if (!device) return { queued: false as const, reason: "no_device" };
  const push = renderPush(template, input.values);
  const inserted = (await db.query(
    `INSERT INTO notifications (workspace_id, recipient_type, recipient_id, channel, event_type, status, scheduled_for, subject, body, deep_link, idempotency_key, correlation_id)
     VALUES ($1, 'portal_contact', $2, 'push', $3, 'pending', now(), $4, $5, $6, $7, gen_random_uuid()) ON CONFLICT (workspace_id, idempotency_key) DO NOTHING RETURNING id`,
    [input.workspaceId, input.grantId, eventType, push.title, push.body, input.deepLink, input.idempotencyKey])).rowCount;
  return inserted ? { queued: true as const } : { queued: false as const, reason: "already_sent" };
}
