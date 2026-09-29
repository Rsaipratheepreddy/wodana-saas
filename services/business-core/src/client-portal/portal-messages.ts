import { BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { newRequest } from "../commercial/commercial.domain";
import type { ChangeRequest, CommercialData } from "../commercial/commercial.types";
import type { Grant } from "./portal-auth";
import { grantFor, noticeClientMessage, type DecisionContext } from "./portal-decisions";
import { attach, contactId, ownUploads, readAttachments } from "./portal-files";

type Db = Pick<PoolClient, "query">;

/**
 * Conversations between the client and the project team: the client's requests (a thread each), the team's
 * client-visible replies, files on both, and who has read what. The team is "your project team", never a name.
 */

function words(value: unknown, max: number, message: string, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new BadRequestException(message);
  if (text.length > max) throw new BadRequestException(`Keep it under ${max} characters.`);
  return text;
}

type Reads = Map<string, { client: string | null; team: string | null }>;

async function reads(db: Db, workspaceId: string, caseId: string, grantId: string | null): Promise<Reads> {
  const rows = (await db.query<{ threadId: string; client: string | null; team: string | null }>(
    `SELECT thread_id AS "threadId", max(read_at) FILTER (WHERE reader_kind = 'client' AND reader_id = $3::uuid) AS client, max(read_at) FILTER (WHERE reader_kind = 'team') AS team
       FROM client_portal_reads WHERE workspace_id = $1 AND case_id = $2 GROUP BY thread_id`, [workspaceId, caseId, grantId])).rows;
  return new Map(rows.map((row) => [row.threadId, { client: row.client ? new Date(row.client).toISOString() : null, team: row.team ? new Date(row.team).toISOString() : null }]));
}

/** A request thread: the team's replies are "your project team", never a person's name. */
export function portalRequest(request: ChangeRequest, grant: Grant) {
  return {
    id: request.id, number: request.number, title: request.title, detail: request.detail, status: request.status, createdAt: request.createdAt,
    resolution: request.resolution,
    comments: request.comments.filter((comment) => comment.visibility === "client").map((comment) => ({
      id: comment.id, at: comment.at, text: comment.text,
      fromClient: (comment as { fromClient?: boolean }).fromClient ?? comment.author === grant.name,
    })),
  };
}

/** The client's threads, newest activity first: each with its files, how many team replies they haven't read, and whether the team has seen their last word. */
export async function readMessages(db: Db, workspaceId: string, grant: Grant, caseId: string, commercial: CommercialData) {
  const seen = await reads(db, workspaceId, caseId, contactId(grant));
  const files = await readAttachments(db, workspaceId, caseId, ["message"]);
  const requests = commercial.requests.filter((request) => !request.decisionRequest).map((request) => {
    const thread = portalRequest(request, grant);
    const comments = thread.comments.map((comment) => ({ ...comment, files: files.get(`message:${comment.id}`) ?? [] }));
    const read = seen.get(request.id);
    const team = comments.filter((comment) => !comment.fromClient);
    const lastClient = [request.createdAt, ...comments.filter((comment) => comment.fromClient).map((comment) => comment.at)].sort().at(-1) ?? request.createdAt;
    const lastTeam = team.map((comment) => comment.at).sort().at(-1) ?? null;
    return {
      ...thread,
      files: files.get(`message:${request.id}`) ?? [],
      comments,
      unread: team.filter((comment) => !read?.client || comment.at > read.client).length,
      // Seen once the team opened it after the client's last message, or answered after it.
      seenByTeam: Boolean((read?.team && read.team >= lastClient) || (lastTeam && lastTeam >= lastClient)),
      lastAt: [lastClient, lastTeam].filter((at): at is string => Boolean(at)).sort().at(-1) ?? request.createdAt,
    };
  });
  requests.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  return { requests, unread: requests.reduce((sum, request) => sum + request.unread, 0) };
}

export type PortalMessages = Awaited<ReturnType<typeof readMessages>>;

/** A new conversation with the project team, with photos or PDFs; the team hears it in the app and by email. */
export async function raiseRequest(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "messages");
  const title = words(body.title, 240, "Give it a short title.", true);
  const detail = words(body.detail, 6000, "Say what you need.", true);
  const files = await ownUploads(ctx.db, ctx.workspaceId, ctx.contact, row.caseId, body.uploadIds);
  const data = await ctx.commercial.load(ctx.db, ctx.workspaceId, row.caseId);
  const request = newRequest(data, title, detail, undefined, undefined, { name: grant.name, client: true });
  await ctx.commercial.persist(ctx.db, ctx.workspaceId, row.caseId, data, grant.name, "Client request (portal)");
  await attach(ctx.db, ctx.workspaceId, { caseId: row.caseId, grantId: grant.id, kind: "message", targetId: request.id, files });
  await markRead(ctx.db, ctx.workspaceId, row.caseId, request.id, "client", grant.id);
  await noticeClientMessage(ctx.db, ctx.workspaceId, row, { code: "request.client_raised", actor: grant.name, request, note: withFiles(detail, files.length), key: request.id, email: true });
  return { ok: true, requestId: request.id, entity: { type: "pre_project_case", id: row.caseId }, audit: { requestId: request.id, files: files.length } };
}

/** A reply in a conversation (text, files, or both); the team hears it. */
export async function comment(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "messages");
  const files = await ownUploads(ctx.db, ctx.workspaceId, ctx.contact, row.caseId, body.uploadIds);
  const text = words(body.text, 6000, "Write your message.", !files.length);
  const data = await ctx.commercial.load(ctx.db, ctx.workspaceId, row.caseId);
  const request = data.requests.find((item) => item.id === body.requestId && !item.decisionRequest);
  if (!request) throw new NotFoundException("This conversation isn't there any more.");
  const commentId = randomUUID();
  request.comments.push({ id: commentId, author: grant.name, at: new Date().toISOString(), text, visibility: "client", fromClient: true } as ChangeRequest["comments"][number]);
  await ctx.commercial.persist(ctx.db, ctx.workspaceId, row.caseId, data, grant.name, "Client message (portal)");
  await attach(ctx.db, ctx.workspaceId, { caseId: row.caseId, grantId: grant.id, kind: "message", targetId: commentId, files });
  await markRead(ctx.db, ctx.workspaceId, row.caseId, request.id, "client", grant.id);
  await noticeClientMessage(ctx.db, ctx.workspaceId, row, { code: "request.client_replied", actor: grant.name, request, note: withFiles(text, files.length), key: commentId, email: true });
  return { ok: true, commentId, entity: { type: "pre_project_case", id: row.caseId }, audit: { requestId: request.id, commentId, files: files.length } };
}

const withFiles = (text: string, count: number) => (count ? `${text}${text ? " " : ""}(${count} file${count === 1 ? "" : "s"} attached)` : text);

/** The client opened a conversation: the team's replies so far are read. */
export async function readThread(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "messages");
  const data = await ctx.commercial.load(ctx.db, ctx.workspaceId, row.caseId);
  const request = data.requests.find((item) => item.id === body.requestId && !item.decisionRequest);
  if (!request) throw new NotFoundException("This conversation isn't there any more.");
  await markRead(ctx.db, ctx.workspaceId, row.caseId, request.id, "client", grant.id);
  return { ok: true, entity: { type: "pre_project_case", id: row.caseId }, audit: { requestId: request.id } };
}

/** Records that a conversation was read now, by the client contact or by someone on the team. */
export async function markRead(db: Db, workspaceId: string, caseId: string, threadId: string, kind: "client" | "team", readerId: string) {
  await db.query(
    `INSERT INTO client_portal_reads (workspace_id, case_id, thread_id, reader_kind, reader_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, thread_id, reader_kind, reader_id) DO UPDATE SET read_at = now()`, [workspaceId, caseId, threadId.slice(0, 80), kind, readerId]);
}

/** For the team: per conversation on a case, the client's files and when the client last read it. */
export async function readStaffThreads(db: Db, workspaceId: string, caseId: string) {
  const files = await readAttachments(db, workspaceId, caseId, ["message"]);
  const clientReads = (await db.query<{ threadId: string; at: string }>(
    `SELECT thread_id AS "threadId", max(read_at) AS at FROM client_portal_reads WHERE workspace_id = $1 AND case_id = $2 AND reader_kind = 'client' GROUP BY thread_id`,
    [workspaceId, caseId])).rows;
  // Who on the client's side raised each conversation, from the portal command that raised it (every command keeps its contact).
  const raisers = (await db.query<{ requestId: string; name: string }>(
    `SELECT command.result->>'requestId' AS "requestId", coalesce(grant_row.confirmed_name, grant_row.name) AS name
       FROM client_portal_commands command
       JOIN client_portal_grants grant_row ON grant_row.workspace_id = command.workspace_id AND grant_row.id = command.grant_id
      WHERE command.workspace_id = $1 AND grant_row.case_id = $2 AND command.action IN ('request', 'progress_question') AND command.result ? 'requestId'`,
    [workspaceId, caseId])).rows;
  return {
    files: Object.fromEntries([...files].map(([key, list]) => [key.replace(/^message:/, ""), list])),
    clientRead: Object.fromEntries(clientReads.map((row) => [row.threadId, new Date(row.at).toISOString()])),
    raisedBy: Object.fromEntries(raisers.map((row) => [row.requestId, row.name])),
  };
}
