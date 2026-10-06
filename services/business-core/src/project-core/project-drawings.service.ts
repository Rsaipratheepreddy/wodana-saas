import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ActorUser, RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { DRAWING_CHECKS } from "./project-checks";
import { membershipOf, readProject, readStages, readTeam } from "./project-core.store";
import {
  assertSendable, canStartRevision, drawingRoute, MAX_APPROVAL_FILES, MAX_DRAWING_FILES, productionReleased, readDrawingRevisions, readLatestRevision,
} from "./project-drawings";
import { tellKeepInformed } from "./project-keep-informed";
import { noticeStageReady } from "./project-stage-watch";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN = ["active", "on_hold"];

/**
 * The project's technical drawings (PLM-057 … 062): the revisions with their files, uploading drawings and the
 * client's signed approval, and the files themselves. The team uploads; the technical team or the project manager
 * records the site check, and the project manager sends them and records the client's decision (project commands).
 * The factory reads them, with the material list and the BOQ, once the client approved them.
 */
@Injectable()
export class ProjectDrawingsService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  read(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.state(client, workspaceId, await this.reader(client, workspaceId, projectId, user)));
  }

  /**
   * One drawing file (kind "drawing") on the revision being prepared, starting the next revision when the latest is
   * decided; or the client's signed approval (kind "approval") on the revision with the client. Replayed safely by its id.
   */
  async upload(actor: RequestActor, workspaceId: string, projectId: string, revisionId: string, fileId: string, kind: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    const storage = this.storage;
    if (!storage) throw new ConflictException("Files can't be stored here yet.");
    if (kind !== "drawing" && kind !== "approval") throw new BadRequestException("Upload a drawing or the client's approval.");
    if (!UUID.test(revisionId) || !UUID.test(fileId)) throw new BadRequestException("The upload isn't valid.");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const reader = await this.reader(client, workspaceId, projectId, user);
      const { project } = reader;
      if (!reader.onTeam) throw new ForbiddenException("Only the project's team can add drawings.");
      if (!OPEN.includes(project.status)) throw new ConflictException("The project is closed.");
      if (kind === "approval" && !reader.manager) throw new ForbiddenException("Only the project manager records the client's approval.");
      await readProject(client, workspaceId, projectId, true);
      const existing = (await client.query<{ sha256: string; revisionId: string }>(`SELECT sha256, revision_id AS "revisionId" FROM project_drawing_files WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, fileId])).rows[0];
      if (existing) {
        if (existing.sha256 !== prepared.digest || existing.revisionId !== revisionId) throw new ConflictException("This upload id belongs to another file.");
        return this.state(client, workspaceId, reader);
      }
      const latest = await readLatestRevision(client, workspaceId, projectId, true);
      let number = latest?.number ?? 0;
      if (kind === "drawing") {
        if (latest?.id === revisionId) {
          if (latest.status !== "uploaded") throw new ConflictException(`Drawings R${latest.number} are already checked. Add files to a new revision once they're decided.`);
          if (latest.drawingFiles >= MAX_DRAWING_FILES) throw new BadRequestException(`A revision takes up to ${MAX_DRAWING_FILES} drawings.`);
        } else {
          if ((await client.query(`SELECT 1 FROM project_drawing_revisions WHERE workspace_id = $1 AND id = $2`, [workspaceId, revisionId])).rowCount)
            throw new ConflictException("These drawings changed. Reload to see the latest revision.");
          if (!canStartRevision(latest)) throw new ConflictException(`Drawings R${latest!.number} are still being checked or are with the client.`);
          number += 1;
          await client.query(`INSERT INTO project_drawing_revisions (id, workspace_id, project_id, number, created_by) VALUES ($1, $2, $3, $4, $5)`,
            [revisionId, workspaceId, projectId, number, user.userId]);
        }
      } else {
        if (!latest || latest.id !== revisionId || latest.status !== "sent") throw new ConflictException("The client's approval goes on the drawings waiting for them.");
        if (latest.approvalFiles >= MAX_APPROVAL_FILES) throw new BadRequestException(`Attach up to ${MAX_APPROVAL_FILES} files of the client's approval.`);
      }
      const key = `projects/drawings/${workspaceId}/${fileId}`;
      await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
      if (prepared.preview) await storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
      await client.query(
        `INSERT INTO project_drawing_files (id, workspace_id, project_id, revision_id, kind, original_name, mime_type, byte_size, object_key, preview_key, sha256, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [fileId, workspaceId, projectId, revisionId, kind, prepared.name, prepared.mimeType, prepared.body.length, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null,
          prepared.digest, user.userId]);
      await client.query(`UPDATE delivery_projects SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: kind === "drawing" ? "project.drawing_uploaded" : "project.drawing_approval_attached",
        entityType: "project", entityId: projectId, after: { revisionId, number, fileId, name: prepared.name, sha256: prepared.digest } });
      // PLM-055: the first drawings are the technical drawings started (once, with the stage task's own notice).
      if (kind === "drawing" && number === 1 && latest?.id !== revisionId)
        await tellKeepInformed(client, { workspaceId, projectId, event: "drawings_started", key: "first", actorUserId: user.userId, date: "" });
      // The drawings task closes and the site check opens (or the client's approval, on a route without one).
      await noticeStageReady(client, workspaceId, projectId, user.userId);
      return this.state(client, workspaceId, await this.reader(client, workspaceId, projectId, user));
    });
  }

  /** One drawing file (or its preview) for someone who may read the project. */
  file(actor: RequestActor, workspaceId: string, projectId: string, fileId: string, preview: boolean) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.reader(client, workspaceId, projectId, user);
      if (!UUID.test(fileId)) throw new NotFoundException("File not found.");
      const row = (await client.query<{ objectKey: string; previewKey: string | null; mimeType: string; name: string }>(
        `SELECT object_key AS "objectKey", preview_key AS "previewKey", mime_type AS "mimeType", original_name AS name FROM project_drawing_files
          WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, fileId])).rows[0];
      if (!row || !this.storage) throw new NotFoundException("File not found.");
      const key = preview && row.previewKey ? row.previewKey : row.objectKey;
      const stored = await this.storage.read(key).catch(() => null);
      if (!stored) throw new NotFoundException("File not found.");
      return { body: stored.body, contentType: key === row.previewKey ? "image/webp" : row.mimeType, name: row.name };
    });
  }

  /**
   * Who may read the project's drawings: the people who manage projects, its team, and (read-only) the people who run
   * the factory once the client approved the drawings or while its route asks the factory to book a slot (PLM-062).
   */
  private async reader(client: Db, workspaceId: string, projectId: string, user: ActorUser) {
    const project = await readProject(client, workspaceId, projectId);
    if (!project) throw new NotFoundException("Project not found.");
    const has = async (codes: string[]) => { for (const code of codes) if (await this.access.hasPermission(client, workspaceId, user.userId, code)) return true; return false; };
    const all = await has(["projects.manage"]);
    const membershipId = await membershipOf(client, workspaceId, user.userId);
    const team = (await readTeam(client, workspaceId, [projectId])).get(projectId) ?? [];
    const assigned = Boolean(membershipId && (await client.query(`SELECT 1 FROM project_assignments WHERE workspace_id = $1 AND project_id = $2 AND membership_id = $3 AND active`,
      [workspaceId, projectId, membershipId])).rowCount);
    const onTeam = all || (assigned && await has(["projects.view"]));
    if (!onTeam) {
      const factory = await has(["factory.view", "factory.manage"]) && (await productionReleased(client, workspaceId, projectId) || (await drawingRoute(client, workspaceId, projectId)).factorySlot);
      if (!factory) throw new NotFoundException("Project not found.");
    }
    const manager = all || team.some((member) => member.membershipId === membershipId && member.lead);
    return { project, all, membershipId, team, onTeam, manager };
  }

  private async state(client: Db, workspaceId: string, reader: Awaited<ReturnType<ProjectDrawingsService["reader"]>>) {
    const { project, team, membershipId, onTeam, manager } = reader;
    const revisions = await readDrawingRevisions(client, workspaceId, project.id);
    const route = await drawingRoute(client, workspaceId, project.id);
    const stages = await readStages(client, workspaceId, [project.id]);
    const drawingRoles = new Set(stages.filter((stage) => stage.ownerRole && stage.checks.some((check) => DRAWING_CHECKS.includes(check.kind))).map((stage) => stage.ownerRole!));
    const drawer = team.some((member) => member.membershipId === membershipId && member.roles.some((role) => drawingRoles.has(role)));
    const latest = revisions[0] ?? null;
    const open = OPEN.includes(project.status);
    const drawingFiles = latest ? latest.files.filter((file) => file.kind === "drawing").length : 0;
    let sendable = false;
    if (latest) try { assertSendable({ ...latest, drawingFiles }, route.needsSiteCheck); sendable = true; } catch { sendable = false; }
    return {
      revisions, version: project.version, caseId: project.caseId, inRoute: route.inRoute, needsSiteCheck: route.needsSiteCheck,
      canUpload: open && onTeam && (latest?.status === "uploaded" || canStartRevision(latest)),
      canCheck: open && (manager || drawer) && latest?.status === "uploaded" && drawingFiles > 0,
      canSend: open && manager && sendable,
      canDecide: open && manager && latest?.status === "sent",
    };
  }
}
