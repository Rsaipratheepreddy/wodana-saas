import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { addComment, minutesOfCase, readComments, readSharedMinutes } from "../meetings/meeting-minutes";
import type { Grant } from "./portal-auth";
import { grantFor, type DecisionContext } from "./portal-decisions";
import { caseTitle, tellStaff } from "./portal-notices";

type Db = Pick<PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PLM-153: the client's Meetings: the notes of each meeting the team shared (newest meeting first), with their files and
 * the conversation on them. The team reads as "your project team", never a person's name.
 */
export async function readMeetings(db: Db, workspaceId: string, grant: Grant, caseId: string) {
  const shared = await readSharedMinutes(db, workspaceId, caseId);
  const files = shared.length ? new Map((await db.query<{ id: string; name: string; mimeType: string; hasPreview: boolean }>(
    `SELECT id, original_name AS name, mime_type AS "mimeType", preview_key IS NOT NULL AS "hasPreview" FROM meeting_minutes_files
      WHERE workspace_id = $1 AND id = ANY($2::uuid[])`, [workspaceId, shared.flatMap((minutes) => minutes.fileIds)])).rows.map((file) => [file.id, file])) : new Map();
  const meetings = [];
  for (const minutes of shared) {
    const comments = (await readComments(db, workspaceId, minutes.id, "team")).map((comment) => ({ ...comment, author: comment.fromClient ? comment.author : null,
      mine: comment.fromClient && comment.author === grant.name }));
    meetings.push({
      id: minutes.id, title: minutes.title, meetingAt: minutes.meetingAt ? new Date(minutes.meetingAt).toISOString() : null, text: minutes.body,
      sharedAt: new Date(minutes.sharedAt).toISOString(), updatedAt: minutes.updated ? new Date(minutes.updatedAt).toISOString() : null,
      files: minutes.fileIds.map((id) => files.get(id)).filter((file): file is { id: string; name: string; mimeType: string; hasPreview: boolean } => Boolean(file)),
      comments,
    });
  }
  return { meetings };
}

export type PortalMeetings = Awaited<ReturnType<typeof readMeetings>>;

/** The client's comment on a meeting's shared notes; whoever wrote the minutes hears it (in the app and by email). */
export async function minutesComment(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "meetings");
  const minutesId = typeof body.minutesId === "string" && UUID.test(body.minutesId) ? body.minutesId : "";
  if (!minutesId) throw new BadRequestException("Choose the meeting.");
  const minutes = await minutesOfCase(ctx.db, ctx.workspaceId, row.caseId, minutesId);
  if (!minutes) throw new NotFoundException("These notes aren't shared with you.");
  const commentId = typeof body.commentId === "string" && UUID.test(body.commentId) ? body.commentId : "";
  if (!commentId) throw new BadRequestException("Try that again.");
  const text = await addComment(ctx.db, { workspaceId: ctx.workspaceId, minutesId, commentId, text: body.text, grant: { id: grant.id, caseId: row.caseId } });
  const author = (await ctx.db.query<{ userId: string }>(
    `SELECT minutes.created_by AS "userId" FROM meeting_minutes minutes JOIN workspace_memberships member ON member.workspace_id = minutes.workspace_id
        AND member.user_id = minutes.created_by AND member.status = 'active'
      WHERE minutes.workspace_id = $1 AND minutes.id = $2`, [ctx.workspaceId, minutesId])).rows.map((item) => item.userId);
  const facts = await caseTitle(ctx.db, ctx.workspaceId, row.caseId);
  await tellStaff(ctx.db, { workspaceId: ctx.workspaceId, recipients: author, code: "meeting.minutes_comment", key: commentId, email: true,
    variables: { title: minutes.title, clientName: facts.clientName, actor: grant.name, note: text },
    deepLink: `/workspace/crm/follow-ups?record=${minutes.activityId}` });
  return { ok: true, commentId, entity: { type: "crm_activity", id: minutes.activityId }, audit: { minutesId, commentId } };
}
