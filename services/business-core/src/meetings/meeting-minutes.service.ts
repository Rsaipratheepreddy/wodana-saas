import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ActorUser, RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { tellClients } from "../client-portal/portal-notices";
import { effectiveSections, readPortalSettings, readProjectAccess } from "../client-portal/portal-settings";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import {
  addComment, MAX_MINUTES_FILES, minutesProblem, parseMinutes, readComments, readMeeting, readMeetingFiles, readMinutes, readRevisions, saveMinutes, type MeetingFacts,
} from "./meeting-minutes";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * PLM-153: the minutes of a client meeting, from the meeting itself (wherever it opens: the follow-ups, the calendar,
 * the design journey). Whoever ran or attended the meeting, or manages activities, writes them; sharing them puts them
 * in the client's portal (Meetings) and emails the client; the team answers the client's comments there.
 */
@Injectable()
export class MeetingMinutesService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  read(actor: RequestActor, workspaceId: string, activityId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.state(client, workspaceId, await this.reader(client, workspaceId, activityId, user)));
  }

  /** Saves the minutes as a new revision; shared for the first time, the client hears it (portal and email). Version-checked; audited. */
  save(actor: RequestActor, workspaceId: string, activityId: string, body: Record<string, unknown>) {
    const input = parseMinutes(body);
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const reader = await this.reader(client, workspaceId, activityId, user, true);
      if (!reader.canWrite) throw new ForbiddenException("Only the people in the meeting, or who manage activities, write its minutes.");
      const problem = minutesProblem(reader.meeting, new Date());
      if (problem) throw new ConflictException(problem);
      const saved = await saveMinutes(client, { ...input, workspaceId, activityId, userId: user.userId });
      if (!saved.changed) return this.state(client, workspaceId, reader);
      let told: Awaited<ReturnType<typeof tellClients>> | null = null;
      // The client hears once, when the minutes are first shared; later edits show as updated in the portal.
      if (saved.newlyShared && reader.meeting.caseId)
        told = await tellClients(client, { workspaceId, caseId: reader.meeting.caseId, event: "minutes_shared", recordId: `minutes:${saved.minutes.id}`, title: saved.minutes.title,
          note: saved.minutes.body.slice(0, 480) });
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: saved.newlyShared ? "meeting.minutes_shared" : "meeting.minutes_saved", entityType: "crm_activity",
        entityId: activityId, before: saved.before ? { revision: saved.before.revision, shared: Boolean(saved.before.sharedAt) } : undefined,
        after: { minutesId: saved.minutes.id, revision: saved.minutes.revision, title: saved.minutes.title, files: saved.minutes.fileIds.length, shared: Boolean(saved.minutes.sharedAt),
          clientTold: told?.queued ?? 0 } });
      return { ...(await this.state(client, workspaceId, await this.reader(client, workspaceId, activityId, user))), told: told ? { queued: told.queued, reason: told.reason } : null };
    });
  }

  /** The team's reply to the client's comments on shared minutes; the client hears it (email). */
  reply(actor: RequestActor, workspaceId: string, activityId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const reader = await this.reader(client, workspaceId, activityId, user, true);
      if (!reader.canWrite) throw new ForbiddenException("Only the people in the meeting, or who manage activities, answer the client here.");
      const minutes = await readMinutes(client, workspaceId, activityId);
      if (!minutes?.sharedAt) throw new ConflictException("Share the minutes with the client first.");
      const commentId = typeof body.commentId === "string" && UUID.test(body.commentId) ? body.commentId : null;
      if (!commentId) throw new BadRequestException("The reply isn't valid.");
      const known = (await client.query(`SELECT 1 FROM meeting_minutes_comments WHERE workspace_id = $1 AND id = $2`, [workspaceId, commentId])).rowCount;
      if (known) return this.state(client, workspaceId, reader);
      const text = await addComment(client, { workspaceId, minutesId: minutes.id, commentId, text: body.text, userId: user.userId });
      if (reader.meeting.caseId)
        await tellClients(client, { workspaceId, caseId: reader.meeting.caseId, event: "minutes_replied", recordId: `minutes-reply:${commentId}`, title: minutes.title, note: text.slice(0, 480) });
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "meeting.minutes_replied", entityType: "crm_activity", entityId: activityId,
        after: { minutesId: minutes.id, commentId } });
      return this.state(client, workspaceId, reader);
    });
  }

  /** A photo or PDF for the minutes; kept on the meeting until a save lists it. Replayed safely by its id. */
  async upload(actor: RequestActor, workspaceId: string, activityId: string, fileId: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    const storage = this.storage;
    if (!storage) throw new ConflictException("Files can't be stored here yet.");
    if (!UUID.test(fileId)) throw new BadRequestException("The upload isn't valid.");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const reader = await this.reader(client, workspaceId, activityId, user, true);
      if (!reader.canWrite) throw new ForbiddenException("Only the people in the meeting, or who manage activities, add files to its minutes.");
      const problem = minutesProblem(reader.meeting, new Date());
      if (problem) throw new ConflictException(problem);
      const existing = (await client.query<{ sha256: string; activityId: string }>(`SELECT sha256, activity_id AS "activityId" FROM meeting_minutes_files WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, fileId])).rows[0];
      if (existing) {
        if (existing.sha256 !== prepared.digest || existing.activityId !== activityId) throw new ConflictException("This upload id belongs to another file.");
      } else {
        const count = (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM meeting_minutes_files WHERE workspace_id = $1 AND activity_id = $2`,
          [workspaceId, activityId])).rows[0].count;
        if (count >= MAX_MINUTES_FILES * 3) throw new BadRequestException("This meeting has too many files.");
        const key = `meetings/minutes/${workspaceId}/${fileId}`;
        await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
        if (prepared.preview) await storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
        await client.query(
          `INSERT INTO meeting_minutes_files (id, workspace_id, activity_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [fileId, workspaceId, activityId, prepared.name, prepared.mimeType, prepared.body.length, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null, prepared.digest, user.userId]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "meeting.minutes_file_added", entityType: "crm_activity", entityId: activityId,
          after: { fileId, name: prepared.name, sha256: prepared.digest } });
      }
      return (await readMeetingFiles(client, workspaceId, activityId)).find((item) => item.id === fileId)!;
    });
  }

  /** A file of the meeting's minutes (or its preview), for someone who may read them. */
  file(actor: RequestActor, workspaceId: string, activityId: string, fileId: string, preview: boolean) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.reader(client, workspaceId, activityId, user);
      if (!UUID.test(fileId)) throw new NotFoundException("File not found.");
      const row = (await client.query<{ objectKey: string; previewKey: string | null; mimeType: string; name: string }>(
        `SELECT object_key AS "objectKey", preview_key AS "previewKey", mime_type AS "mimeType", original_name AS name FROM meeting_minutes_files
          WHERE workspace_id = $1 AND activity_id = $2 AND id = $3`, [workspaceId, activityId, fileId])).rows[0];
      if (!row || !this.storage) throw new NotFoundException("File not found.");
      const key = preview && row.previewKey ? row.previewKey : row.objectKey;
      const stored = await this.storage.read(key).catch(() => null);
      if (!stored) throw new NotFoundException("File not found.");
      return { body: stored.body, contentType: key === row.previewKey ? "image/webp" : row.mimeType, name: row.name };
    });
  }

  /**
   * Who may read and write a meeting's minutes: the people who see activities read them, the people who manage them write
   * them; whoever ran or attended the meeting does both (a project manager running a site meeting, a designer at the kick-off).
   */
  private async reader(client: Db, workspaceId: string, activityId: string, user: ActorUser, lock = false) {
    const meeting = await readMeeting(client, workspaceId, activityId, lock);
    if (!meeting) throw new NotFoundException("Meeting not found.");
    const membership = (await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`,
      [workspaceId, user.userId])).rows[0]?.id ?? null;
    const inMeeting = Boolean(membership && (meeting.ownerMembershipId === membership || meeting.attendeeMembershipIds.includes(membership)));
    const canWrite = inMeeting || await this.access.hasPermission(client, workspaceId, user.userId, "crm.activities.manage");
    if (!canWrite && !(await this.access.hasPermission(client, workspaceId, user.userId, "crm.activities.view"))) throw new NotFoundException("Meeting not found.");
    return { meeting, canWrite };
  }

  private async state(client: Db, workspaceId: string, reader: { meeting: MeetingFacts; canWrite: boolean }) {
    const { meeting, canWrite } = reader;
    const minutes = await readMinutes(client, workspaceId, meeting.activityId);
    return {
      meeting: { activityId: meeting.activityId, title: meeting.title, type: meeting.type, status: meeting.status, startsAt: meeting.startsAt, endsAt: meeting.endsAt,
        clientName: meeting.clientName },
      minutes, revisions: minutes ? await readRevisions(client, workspaceId, minutes.id) : [], comments: minutes ? await readComments(client, workspaceId, minutes.id) : [],
      files: await readMeetingFiles(client, workspaceId, meeting.activityId),
      // Why minutes can't be written now (cancelled, not started yet), and who may write them.
      problem: minutesProblem(meeting, new Date()), canWrite,
      // Where the client would read them: their project (once there is one), and whether anyone there can open the portal yet.
      portal: await this.portal(client, workspaceId, meeting.caseId),
    };
  }

  /** The client's side: the portal on, the Meetings section shown for the project, and someone with access. */
  private async portal(client: Db, workspaceId: string, caseId: string | null) {
    const settings = await readPortalSettings(client, workspaceId);
    if (!caseId) return { caseId: null, enabled: settings.enabled, shown: false, contacts: 0 };
    const project = (await client.query<{ id: string }>(`SELECT id FROM delivery_projects WHERE workspace_id = $1 AND case_id = $2 AND started_at IS NOT NULL ORDER BY started_at LIMIT 1`,
      [workspaceId, caseId])).rows[0];
    const access = project ? await readProjectAccess(client, workspaceId, project.id) : null;
    const contacts = (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM client_portal_grants WHERE workspace_id = $1 AND case_id = $2 AND active`,
      [workspaceId, caseId])).rows[0].count;
    return { caseId, enabled: settings.enabled, shown: settings.enabled && effectiveSections(settings, access).meetings, contacts };
  }
}

