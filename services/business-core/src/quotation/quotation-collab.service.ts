import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { notifyUserInApp } from "../notifications/default-templates";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";

const VIEW = "pre_projects.view";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = ["title", "quantity", "unit", "rate", "amount", "area", "trade"];

export type QuoteThread = {
  id: string; anchorKind: "line" | "area" | "trade" | "total"; anchorKey: string; anchorField: string | null; status: "open" | "resolved"; version: number;
  createdBy: string; createdByName: string; createdAt: string; resolvedByName: string | null; resolvedAt: string | null;
  messages: Array<{ id: string; body: string; mentions: string[]; createdBy: string; createdByName: string; createdAt: string }>;
};

/**
 * Working on a quote together: comments pinned where they belong (a line or one of its cells, an
 * area or trade, the totals) with replies, @mentions and resolve; and presence — who has the quote
 * open and which line they're on — refreshed by each builder every few seconds, which also tells
 * it when someone else changed the quote.
 */
@Injectable()
export class QuotationCollabService {
  constructor(private readonly access: WorkspaceAccessService) {}

  threads(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => {
      await quoteExists(client, workspaceId, caseId, quoteId);
      return { threads: await readThreads(client, workspaceId, caseId, quoteId), members: await members(client, workspaceId) };
    });
  }

  comment(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, input: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      await quoteExists(client, workspaceId, caseId, quoteId);
      const id = uuid(input.id, "Comment");
      const body = text(input.body);
      const mentions = await validMentions(client, workspaceId, input.mentions);
      const existing = (await client.query<{ id: string }>(`SELECT id FROM commercial_quote_threads WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      if (!existing) {
        const anchorKind = String(input.anchorKind ?? "");
        if (!["line", "area", "trade", "total"].includes(anchorKind)) throw new BadRequestException("Choose where the comment goes.");
        const anchorKey = anchorKind === "total" ? "" : String(input.anchorKey ?? "");
        const anchorField = anchorKind === "line" && typeof input.anchorField === "string" && FIELDS.includes(input.anchorField) ? input.anchorField : null;
        await validAnchor(client, workspaceId, caseId, quoteId, anchorKind, anchorKey);
        await client.query(`INSERT INTO commercial_quote_threads (id, workspace_id, case_id, quote_id, anchor_kind, anchor_key, anchor_field, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, workspaceId, caseId, quoteId, anchorKind, anchorKey, anchorField, user.userId]);
        await client.query(`INSERT INTO commercial_quote_messages (id, workspace_id, thread_id, body, mentions, created_by) VALUES ($1, $2, $1, $3, $4, $5)`, [id, workspaceId, body, mentions, user.userId]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.comment_added.v1", entityType: "commercial_case", entityId: caseId, after: { quoteId, threadId: id, anchorKind, anchorKey } });
        await this.mention(client, { workspaceId, caseId, quoteId, actorUserId: user.userId, mentions, body, messageId: id });
      }
      return { threads: await readThreads(client, workspaceId, caseId, quoteId) };
    });
  }

  reply(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, threadId: string, input: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      const thread = await readThread(client, workspaceId, caseId, quoteId, threadId);
      const id = uuid(input.id, "Reply");
      const body = text(input.body);
      const mentions = await validMentions(client, workspaceId, input.mentions);
      const existing = (await client.query<{ id: string }>(`SELECT id FROM commercial_quote_messages WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      if (!existing) {
        if (thread.status === "resolved") throw new ConflictException("Reopen the comment before replying.");
        await client.query(`INSERT INTO commercial_quote_messages (id, workspace_id, thread_id, body, mentions, created_by) VALUES ($1, $2, $3, $4, $5, $6)`, [id, workspaceId, threadId, body, mentions, user.userId]);
        await client.query(`UPDATE commercial_quote_threads SET version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, threadId]);
        await this.mention(client, { workspaceId, caseId, quoteId, actorUserId: user.userId, mentions, body, messageId: id });
      }
      return { threads: await readThreads(client, workspaceId, caseId, quoteId) };
    });
  }

  setStatus(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, threadId: string, input: { version?: unknown; status?: unknown }) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      const thread = await readThread(client, workspaceId, caseId, quoteId, threadId);
      const status = input.status === "resolved" ? "resolved" : input.status === "open" ? "open" : null;
      if (!status) throw new BadRequestException("Choose resolved or open.");
      if (thread.status === status) return { threads: await readThreads(client, workspaceId, caseId, quoteId) };
      if (Number(input.version) !== thread.version) throw new ConflictException("Someone just changed this comment. Have a look, then try again.");
      await client.query(`UPDATE commercial_quote_threads SET status = $3::varchar, version = version + 1, resolved_by = CASE WHEN $3::varchar = 'resolved' THEN $4::uuid END, resolved_at = CASE WHEN $3::varchar = 'resolved' THEN now() END WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, threadId, status, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `quotation.comment_${status}.v1`, entityType: "commercial_case", entityId: caseId, after: { quoteId, threadId } });
      return { threads: await readThreads(client, workspaceId, caseId, quoteId) };
    });
  }

  /** "I'm here, on this line": records presence and returns who else is here, plus what changed. */
  pulse(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, input: { lineId?: unknown; field?: unknown }) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      await quoteExists(client, workspaceId, caseId, quoteId);
      const lineId = typeof input.lineId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(input.lineId) ? input.lineId : null;
      const field = typeof input.field === "string" && FIELDS.includes(input.field) ? input.field : null;
      await client.query(
        `INSERT INTO commercial_quote_presence (workspace_id, case_id, quote_id, user_id, line_id, field, seen_at) VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (workspace_id, case_id, quote_id, user_id) DO UPDATE SET line_id = excluded.line_id, field = excluded.field, seen_at = now()`,
        [workspaceId, caseId, quoteId, user.userId, lineId, field]);
      const people = (await client.query<{ userId: string; name: string; lineId: string | null; field: string | null }>(
        `SELECT presence.user_id AS "userId", person.display_name AS name, presence.line_id AS "lineId", presence.field
           FROM commercial_quote_presence presence JOIN users person ON person.id = presence.user_id
          WHERE presence.workspace_id = $1 AND presence.case_id = $2 AND presence.quote_id = $3 AND presence.seen_at > now() - interval '30 seconds' AND presence.user_id <> $4
          ORDER BY person.display_name`, [workspaceId, caseId, quoteId, user.userId])).rows;
      const stamp = (await client.query<{ revision: number; comments: string }>(
        `SELECT coalesce((SELECT revision FROM commercial_cases WHERE workspace_id = $1 AND case_id = $2), 0) AS revision,
                coalesce((SELECT count(*)::text || ':' || coalesce(sum(thread.version), 0)::text FROM commercial_quote_threads thread WHERE thread.workspace_id = $1 AND thread.case_id = $2 AND thread.quote_id = $3), '0') AS comments`,
        [workspaceId, caseId, quoteId])).rows[0];
      return { people, revision: stamp.revision, comments: stamp.comments };
    });
  }

  private async mention(client: PoolClient, input: { workspaceId: string; caseId: string; quoteId: string; actorUserId: string; mentions: string[]; body: string; messageId: string }) {
    if (!input.mentions.length) return;
    const quote = (await client.query<{ number: number; title: string }>(`SELECT number, title FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [input.workspaceId, input.caseId, input.quoteId])).rows[0];
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [input.actorUserId])).rows[0]?.name ?? "Someone";
    for (const userId of input.mentions.filter((id) => id !== input.actorUserId))
      await notifyUserInApp(client, {
        workspaceId: input.workspaceId, recipientUserId: userId, code: "quotation.mentioned", eventType: "quotation.mentioned",
        variables: { title: `Q-${quote.number} · ${quote.title}`, actor, note: input.body.slice(0, 280) },
        deepLink: `/workspace/pre-projects/cases/${input.caseId}/quotations?quote=${encodeURIComponent(input.quoteId)}`,
        idempotencyKey: `quotation.mentioned:${input.messageId}:${userId}`,
      });
  }
}

async function quoteExists(db: PoolClient, workspaceId: string, caseId: string, quoteId: string) {
  if (!(await db.query(`SELECT 1 FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, quoteId])).rowCount) throw new NotFoundException("Quote not found.");
}

async function validAnchor(db: PoolClient, workspaceId: string, caseId: string, quoteId: string, kind: string, key: string) {
  const ok = kind === "total" ? true
    : kind === "line" ? Boolean((await db.query(`SELECT 1 FROM commercial_quote_lines WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3 AND id = $4`, [workspaceId, caseId, quoteId, key])).rowCount)
    : kind === "area" ? key === "general" || (UUID.test(key) && Boolean((await db.query(`SELECT 1 FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, key])).rowCount))
    : key === "none" || (UUID.test(key) && Boolean((await db.query(`SELECT 1 FROM workspace_work_packages WHERE workspace_id = $1 AND id = $2`, [workspaceId, key])).rowCount));
  if (!ok) throw new BadRequestException("That part of the quote no longer exists.");
}

async function readThread(db: PoolClient, workspaceId: string, caseId: string, quoteId: string, threadId: string) {
  if (!UUID.test(threadId)) throw new NotFoundException("Comment not found.");
  const thread = (await db.query<{ status: string; version: number }>(`SELECT status, version FROM commercial_quote_threads WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3 AND id = $4 FOR UPDATE`, [workspaceId, caseId, quoteId, threadId])).rows[0];
  if (!thread) throw new NotFoundException("Comment not found.");
  return thread;
}

async function readThreads(db: PoolClient, workspaceId: string, caseId: string, quoteId: string): Promise<QuoteThread[]> {
  return (await db.query<QuoteThread>(
    `SELECT thread.id, thread.anchor_kind AS "anchorKind", thread.anchor_key AS "anchorKey", thread.anchor_field AS "anchorField", thread.status, thread.version,
            thread.created_by AS "createdBy", author.display_name AS "createdByName", thread.created_at AS "createdAt",
            resolver.display_name AS "resolvedByName", thread.resolved_at AS "resolvedAt",
            coalesce((SELECT jsonb_agg(jsonb_build_object('id', message.id, 'body', message.body, 'mentions', to_jsonb(message.mentions), 'createdBy', message.created_by,
                        'createdByName', writer.display_name, 'createdAt', message.created_at) ORDER BY message.created_at)
                        FROM commercial_quote_messages message JOIN users writer ON writer.id = message.created_by
                       WHERE message.workspace_id = thread.workspace_id AND message.thread_id = thread.id), '[]'::jsonb) AS messages
       FROM commercial_quote_threads thread
       JOIN users author ON author.id = thread.created_by
       LEFT JOIN users resolver ON resolver.id = thread.resolved_by
      WHERE thread.workspace_id = $1 AND thread.case_id = $2 AND thread.quote_id = $3
      ORDER BY thread.created_at`, [workspaceId, caseId, quoteId])).rows;
}

async function members(db: PoolClient, workspaceId: string) {
  return (await db.query<{ id: string; name: string }>(
    `SELECT DISTINCT person.id, person.display_name AS name FROM workspace_memberships membership JOIN users person ON person.id = membership.user_id
      WHERE membership.workspace_id = $1 AND membership.status = 'active' ORDER BY person.display_name LIMIT 300`, [workspaceId])).rows;
}

async function validMentions(db: PoolClient, workspaceId: string, value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some((id) => typeof id !== "string" || !UUID.test(id))) throw new BadRequestException("Mention people from your team.");
  const ids = [...new Set(value as string[])];
  if (!ids.length) return [];
  const found = (await db.query(`SELECT DISTINCT user_id FROM workspace_memberships WHERE workspace_id = $1 AND status = 'active' AND user_id = ANY($2::uuid[])`, [workspaceId, ids])).rowCount;
  if (found !== ids.length) throw new BadRequestException("Mention people from your team.");
  return ids;
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} id is invalid.`);
  return value.toLowerCase();
}
function text(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException("Write a comment.");
  if (value.trim().length > 5000) throw new BadRequestException("Keep a comment under 5,000 characters.");
  return value.trim();
}
