import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Grant } from "./portal-auth";
import { grantFor, type DecisionContext } from "./portal-decisions";
import type { FilePresence } from "./portal-files";
import { takesIdeas } from "./portal-moodboard";
import { caseTeam, caseTitle, tellStaff } from "./portal-notices";

type Db = Pick<PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The designs the team shared with the client, every shared revision with its picture, and the conversation on it:
 * comments pinned to a point of the picture (or on the whole file), threaded, that the client and the team both
 * write, reply to and resolve. They are the team's own design threads (pre_project_design_threads): what the client
 * writes is in the staff Design tab, and a team thread reaches the client when the team shares it. The team is
 * "your design team", never a staff name.
 */

/** Revisions the client has been shown: sent for their review, and what came of it. */
export const SHARED_DESIGN_STATUSES = ["client_review", "approved", "changes_requested", "rejected"];
const BOARD_TYPES = ["Concept / mood board", "Material / finish board"];
const BOARD_STAGES = ["concepts", "material_selection"];

type Anchor = { x: number; y: number };
export type VersionRow = { id: string; designId: string; title: string; type: string; board: boolean; number: number; status: string; dueAt: string | null; room: string | null;
  item: string | null; mimeType: string; objectKey: string; previewKey: string | null; sharedAt: string };
type ThreadRow = { id: string; versionId: string; anchor: Anchor | null; status: "open" | "resolved"; version: number; grantId: string | null; createdAt: string; resolvedAt: string | null };
type MessageRow = { id: string; threadId: string; body: string; createdAt: string; grantId: string | null; author: string | null };

export async function sharedVersions(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<VersionRow>(
    `SELECT version.id, design.id AS "designId", design.title, design.document_type AS type,
            (design.stage = ANY($4::text[]) OR design.document_type = ANY($5::text[])) AS board, version.number,
            CASE WHEN version.status = 'client_review' AND version.client_review_expires_at <= now() THEN 'expired' ELSE version.status END AS status,
            version.client_review_expires_at AS "dueAt", room.name AS room, entry.title AS item, asset.mime_type AS "mimeType",
            asset.object_key AS "objectKey", asset.preview_key AS "previewKey",
            coalesce((SELECT max(activity.created_at) FROM pre_project_design_activity activity
                       WHERE activity.workspace_id = version.workspace_id AND activity.version_id = version.id AND activity.action = 'client_review'), version.created_at) AS "sharedAt"
       FROM pre_project_design_versions version
       JOIN pre_project_designs design ON design.workspace_id = version.workspace_id AND design.id = version.design_id AND design.archived_at IS NULL
       JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.id = version.asset_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = design.workspace_id AND room.case_id = design.case_id AND room.id = design.room_id
       LEFT JOIN pre_project_brief_entries entry ON entry.workspace_id = design.workspace_id AND entry.case_id = design.case_id AND entry.id = design.scope_entry_id
      WHERE version.workspace_id = $1 AND version.case_id = $2 AND version.status = ANY($3::text[])
      ORDER BY design.title, design.id, version.number DESC`, [workspaceId, caseId, SHARED_DESIGN_STATUSES, BOARD_STAGES, BOARD_TYPES])).rows
    .map((row) => ({ ...row, sharedAt: new Date(row.sharedAt).toISOString(), dueAt: row.dueAt ? new Date(row.dueAt).toISOString() : null }));
}

export async function clientThreads(db: Db, workspaceId: string, caseId: string) {
  const threads = (await db.query<ThreadRow>(
    `SELECT thread.id, thread.version_id AS "versionId", thread.anchor, thread.status, thread.version, thread.client_grant_id AS "grantId",
            thread.created_at AS "createdAt", thread.resolved_at AS "resolvedAt"
       FROM pre_project_design_threads thread
      WHERE thread.workspace_id = $1 AND thread.case_id = $2 AND thread.client_visible ORDER BY thread.created_at, thread.id`, [workspaceId, caseId])).rows;
  const messages = (await db.query<MessageRow>(
    `SELECT message.id, message.thread_id AS "threadId", message.body, message.created_at AS "createdAt", message.client_grant_id AS "grantId",
            coalesce(grant_row.confirmed_name, grant_row.name) AS author
       FROM pre_project_design_messages message
       JOIN pre_project_design_threads thread ON thread.workspace_id = message.workspace_id AND thread.id = message.thread_id AND thread.client_visible
       LEFT JOIN client_portal_grants grant_row ON grant_row.workspace_id = message.workspace_id AND grant_row.id = message.client_grant_id
      WHERE message.workspace_id = $1 AND message.case_id = $2 ORDER BY message.created_at, message.id`, [workspaceId, caseId])).rows;
  return { threads, messages };
}

/** The client's Design: each shared design (newest share first) with its revisions, newest first, and their threads. */
export async function readDesignReview(db: Db, workspaceId: string, grant: Grant, row: { caseId: string; caseStatus: string; projectStatus: string | null },
  files: FilePresence) {
  const versions = await sharedVersions(db, workspaceId, row.caseId);
  const { threads, messages } = await clientThreads(db, workspaceId, row.caseId);
  const open = takesIdeas(row);
  const iso = (value: string | null) => (value ? new Date(value).toISOString() : null);
  const designs = new Map<string, { id: string; title: string; type: string; board: boolean; room: string | null; item: string | null; sharedAt: string;
    versions: Array<Record<string, unknown>> }>();
  for (const version of versions) {
    const design = designs.get(version.designId) ?? { id: version.designId, title: version.title, type: version.type, board: version.board, room: version.room, item: version.item,
      sharedAt: version.sharedAt, versions: [] };
    const latest = design.versions.length === 0;
    const image = version.mimeType.startsWith("image/");
    design.versions.push({
      id: version.id, number: version.number, status: version.status, dueAt: version.dueAt, sharedAt: version.sharedAt, mimeType: version.mimeType,
      // A picture to pin comments on: the image itself, or the preview the team's upload made.
      hasPreview: (await files.has(version.previewKey)) || (image && (await files.has(version.objectKey))),
      latest,
      canDecide: grant.role === "approver" && latest && version.status === "client_review" && row.caseStatus === "active",
      canComment: open && latest,
      threads: threads.filter((thread) => thread.versionId === version.id).map((thread) => ({
        id: thread.id, anchor: thread.anchor ? { x: Number(thread.anchor.x), y: Number(thread.anchor.y) } : null, status: thread.status, version: thread.version,
        fromClient: Boolean(thread.grantId), mine: thread.grantId === grant.id, at: iso(thread.createdAt)!, resolvedAt: iso(thread.resolvedAt),
        // The client's side resolves what it started; the team's threads are the team's to close.
        canResolve: Boolean(thread.grantId) && open && latest,
        messages: messages.filter((message) => message.threadId === thread.id).map((message) => ({
          id: message.id, text: message.body, at: iso(message.createdAt)!, fromClient: Boolean(message.grantId), mine: message.grantId === grant.id,
          author: message.grantId ? message.author : null,
        })),
      })),
    });
    if (version.sharedAt > design.sharedAt) design.sharedAt = version.sharedAt;
    designs.set(version.designId, design);
  }
  return { designs: [...designs.values()].sort((a, b) => (a.sharedAt < b.sharedAt ? 1 : -1)) };
}

export type PortalDesignReview = Awaited<ReturnType<typeof readDesignReview>>;

function words(value: unknown, max: number, message: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BadRequestException(message);
  if (text.length > max) throw new BadRequestException(`Keep it under ${max} characters.`);
  return text;
}

/** A point on the picture, as fractions of its width and height; nothing for a comment on the whole file. */
export function designAnchor(value: unknown): Anchor | null {
  if (value === null || value === undefined) return null;
  const point = value as Partial<Anchor>;
  const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  if (typeof value !== "object" || !ok(point.x) || !ok(point.y)) throw new BadRequestException("Tap the picture where the comment belongs.");
  return { x: Math.round(point.x! * 10000) / 10000, y: Math.round(point.y! * 10000) / 10000 };
}

/** The latest shared revision of its design: the one the client can comment on. */
async function commentableVersion(ctx: DecisionContext, caseId: string, versionId: unknown) {
  if (typeof versionId !== "string" || !UUID.test(versionId)) throw new BadRequestException("Choose a design.");
  const versions = await sharedVersions(ctx.db, ctx.workspaceId, caseId);
  const version = versions.find((item) => item.id === versionId);
  if (!version) throw new NotFoundException("This design isn't shared with you any more.");
  if (versions.find((item) => item.designId === version.designId)!.id !== version.id) throw new ConflictException("There's a newer version of this design. Comment on that one.");
  return version;
}

async function clientThread(ctx: DecisionContext, caseId: string, threadId: unknown) {
  if (typeof threadId !== "string" || !UUID.test(threadId)) throw new BadRequestException("Choose a comment.");
  const thread = (await ctx.db.query<{ id: string; versionId: string; designId: string; status: string; version: number; grantId: string | null; createdBy: string | null }>(
    `SELECT id, version_id AS "versionId", design_id AS "designId", status, version, client_grant_id AS "grantId", created_by AS "createdBy"
       FROM pre_project_design_threads WHERE workspace_id = $1 AND case_id = $2 AND id = $3 AND client_visible FOR UPDATE`, [ctx.workspaceId, caseId, threadId])).rows[0];
  if (!thread) throw new NotFoundException("This comment isn't there any more.");
  return { thread, version: await commentableVersion(ctx, caseId, thread.versionId) };
}

/** The team that hears a client's design comment: who made and reviews the revision, the thread's team, else the design team. */
async function designPeople(db: Db, workspaceId: string, caseId: string, versionId: string, threadId: string | null) {
  const people = (await db.query<{ userId: string }>(
    `SELECT version.created_by AS "userId" FROM pre_project_design_versions version WHERE version.workspace_id = $1 AND version.id = $2
     UNION SELECT version.reviewer_id FROM pre_project_design_versions version WHERE version.workspace_id = $1 AND version.id = $2 AND version.reviewer_id IS NOT NULL
     UNION SELECT message.created_by FROM pre_project_design_messages message WHERE message.workspace_id = $1 AND message.thread_id = $3 AND message.created_by IS NOT NULL`,
    [workspaceId, versionId, threadId])).rows.map((row) => row.userId).filter(Boolean);
  const active = people.length ? (await db.query<{ userId: string }>(
    `SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND status = 'active' AND user_id = ANY($2::uuid[])`, [workspaceId, people])).rows
    .map((row) => row.userId) : [];
  return active.length ? active : caseTeam(db, workspaceId, caseId, ["design"]);
}

export async function tellDesignTeam(ctx: DecisionContext, grant: Grant, caseId: string, version: Pick<VersionRow, "id" | "designId" | "title" | "number">, threadId: string, key: string, text: string, email: boolean) {
  const facts = await caseTitle(ctx.db, ctx.workspaceId, caseId);
  await tellStaff(ctx.db, { workspaceId: ctx.workspaceId, recipients: await designPeople(ctx.db, ctx.workspaceId, caseId, version.id, threadId), code: "design.client_commented",
    variables: { title: facts.title, clientName: facts.clientName, actor: grant.name, item: `${version.title} · V${version.number}`, note: text.slice(0, 480) },
    deepLink: `/workspace/pre-projects/cases/${caseId}/designs?file=${version.designId}&thread=${threadId}`, key, email });
}

const touch = (ctx: DecisionContext, caseId: string, designId: string) =>
  ctx.db.query(`UPDATE pre_project_designs SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [ctx.workspaceId, caseId, designId]);

/** A new comment on the latest shared revision, pinned to a point of its picture or on the whole file; the design team hears it. */
export async function designComment(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  if (!takesIdeas(row)) throw new ConflictException("This project isn't taking design comments any more.");
  const version = await commentableVersion(ctx, row.caseId, body.versionId);
  const text = words(body.text, 5000, "Write your comment.");
  const anchor = designAnchor(body.anchor);
  const id = randomUUID();
  await ctx.db.query(
    `INSERT INTO pre_project_design_threads (id, workspace_id, case_id, design_id, version_id, title, blocking, created_by, client_grant_id, client_visible, anchor)
     VALUES ($1, $2, $3, $4, $5, $6, false, NULL, $7, true, $8::jsonb)`,
    [id, ctx.workspaceId, row.caseId, version.designId, version.id, text.slice(0, 240), grant.id, anchor ? JSON.stringify(anchor) : null]);
  await ctx.db.query(`INSERT INTO pre_project_design_messages (id, workspace_id, case_id, design_id, thread_id, body, created_by, client_grant_id) VALUES ($1, $2, $3, $4, $1, $5, NULL, $6)`,
    [id, ctx.workspaceId, row.caseId, version.designId, text, grant.id]);
  await touch(ctx, row.caseId, version.designId);
  await tellDesignTeam(ctx, grant, row.caseId, version, id, id, text, true);
  return { ok: true, threadId: id, entity: { type: "pre_project_design", id: version.designId }, audit: { versionId: version.id, threadId: id, pinned: Boolean(anchor) } };
}

/** A reply in a comment thread the client can see; the people in the thread hear it. */
export async function designReply(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  if (!takesIdeas(row)) throw new ConflictException("This project isn't taking design comments any more.");
  const { thread, version } = await clientThread(ctx, row.caseId, body.threadId);
  if (thread.status === "resolved") throw new ConflictException("This comment was resolved. Reopen it to reply.");
  const text = words(body.text, 5000, "Write your reply.");
  const id = randomUUID();
  await ctx.db.query(`INSERT INTO pre_project_design_messages (id, workspace_id, case_id, design_id, thread_id, body, created_by, client_grant_id) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
    [id, ctx.workspaceId, row.caseId, thread.designId, thread.id, text, grant.id]);
  await ctx.db.query(`UPDATE pre_project_design_threads SET version = version + 1 WHERE workspace_id = $1 AND id = $2`, [ctx.workspaceId, thread.id]);
  await touch(ctx, row.caseId, thread.designId);
  await tellDesignTeam(ctx, grant, row.caseId, version, thread.id, id, text, false);
  return { ok: true, messageId: id, entity: { type: "pre_project_design", id: thread.designId }, audit: { threadId: thread.id, messageId: id } };
}

/** The client resolves (or reopens) a thread their side started, at the version they saw. */
export async function designResolve(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "decisions");
  const { thread } = await clientThread(ctx, row.caseId, body.threadId);
  const status = body.status === "resolved" ? "resolved" : body.status === "open" ? "open" : null;
  if (!status) throw new BadRequestException("Choose resolve or reopen.");
  if (!thread.grantId) throw new ForbiddenException("Your design team resolves its own comments.");
  if (body.version !== thread.version) throw new ConflictException("This comment changed. Reload and try again.");
  if (thread.status === status) throw new ConflictException(status === "resolved" ? "This comment is already resolved." : "This comment is already open.");
  await ctx.db.query(
    `UPDATE pre_project_design_threads SET status = $3::varchar, version = version + 1, resolved_by = NULL,
            resolved_by_grant_id = CASE WHEN $3::varchar = 'resolved' THEN $4::uuid END, resolved_at = CASE WHEN $3::varchar = 'resolved' THEN now() END
      WHERE workspace_id = $1 AND id = $2`, [ctx.workspaceId, thread.id, status, grant.id]);
  await touch(ctx, row.caseId, thread.designId);
  return { ok: true, entity: { type: "pre_project_design", id: thread.designId }, audit: { threadId: thread.id, status } };
}
