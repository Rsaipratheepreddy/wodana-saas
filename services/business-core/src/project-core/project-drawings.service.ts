import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ActorUser, RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { readDrawingItems } from "./project-drawing-needs";
import { DRAWING_CHECKS } from "./project-checks";
import { ensureSettings, membershipOf, readProject, readStages, readTeam } from "./project-core.store";
import {
  assertSendable, canStartRevision, drawingRoute, drawingsClientRoleOf, MAX_APPROVAL_FILES, MAX_DRAWING_FILES, measureGate, productionReleased, readDrawingRevisions,
  readLatestRevision,
} from "./project-drawings";
import { defaultMeasureUnit, MAX_MEASURE_FILES, MEASURE_UNITS, readMeasures } from "./project-technical-measure";
import { tellKeepInformed } from "./project-keep-informed";
import { noticeStageReady } from "./project-stage-watch";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN = ["active", "on_hold"];

/**
 * The project's technical drawings (PLM-057 … 062, PLM-149): the technical site measure with its photos, the revisions
 * with their files, uploading drawings and the client's signed approval, and the files themselves. The project manager
 * or the factory team records the technical measure, and shop drawings start after it (when the route asks for it).
 * The team uploads; the technical team or the project manager records the site check, or the lead designer the design
 * check; the project manager (or the lead designer the firm chose) sends them and records the client's decision
 * (project commands). The technical team never sends drawings to the client. The factory reads them, with the material
 * list and the BOQ, once the client approved them.
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
      if (kind === "approval" && !reader.clientFacing) throw new ForbiddenException("Only the project manager or the designer who sends the drawings records the client's approval.");
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
          // PLM-149: shop drawings start after the technical site measure (when the route asks for it).
          if (!latest && !(await measureGate(client, workspaceId, projectId)).done) throw new ConflictException("Record the technical site measure first.");
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

  /** PLM-149: one photo or PDF of a technical measure, by the people who record it. Replayed safely by its id. */
  async uploadMeasureFile(actor: RequestActor, workspaceId: string, projectId: string, measureId: string, fileId: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    const storage = this.storage;
    if (!storage) throw new ConflictException("Files can't be stored here yet.");
    if (!UUID.test(measureId) || !UUID.test(fileId)) throw new BadRequestException("The upload isn't valid.");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const reader = await this.reader(client, workspaceId, projectId, user);
      if (!reader.measurer) throw new ForbiddenException("Only the project manager or the factory team adds the measure's photos.");
      if (!OPEN.includes(reader.project.status)) throw new ConflictException("The project is closed.");
      await readProject(client, workspaceId, projectId, true);
      const existing = (await client.query<{ sha256: string; measureId: string }>(
        `SELECT sha256, measure_id AS "measureId" FROM project_technical_measure_files WHERE workspace_id = $1 AND id = $2`, [workspaceId, fileId])).rows[0];
      if (existing) {
        if (existing.sha256 !== prepared.digest || existing.measureId !== measureId) throw new ConflictException("This upload id belongs to another file.");
        return this.state(client, workspaceId, reader);
      }
      const measure = (await client.query<{ files: number }>(
        `SELECT (SELECT count(*)::int FROM project_technical_measure_files file WHERE file.workspace_id = measure.workspace_id AND file.measure_id = measure.id) AS files
           FROM project_technical_measures measure WHERE measure.workspace_id = $1 AND measure.project_id = $2 AND measure.id = $3`, [workspaceId, projectId, measureId])).rows[0];
      if (!measure) throw new NotFoundException("Measure not found.");
      if (measure.files >= MAX_MEASURE_FILES) throw new BadRequestException(`A measure takes up to ${MAX_MEASURE_FILES} files.`);
      const key = `projects/measures/${workspaceId}/${fileId}`;
      await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
      if (prepared.preview) await storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
      await client.query(
        `INSERT INTO project_technical_measure_files (id, workspace_id, project_id, measure_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [fileId, workspaceId, projectId, measureId, prepared.name, prepared.mimeType, prepared.body.length, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null,
          prepared.digest, user.userId]);
      await client.query(`UPDATE delivery_projects SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "project.technical_measure_file_added", entityType: "project", entityId: projectId,
        after: { measureId, fileId, name: prepared.name, sha256: prepared.digest } });
      return this.state(client, workspaceId, await this.reader(client, workspaceId, projectId, user));
    });
  }

  /** One file of a technical measure (or its preview) for someone who may read the project's drawings. */
  measureFile(actor: RequestActor, workspaceId: string, projectId: string, fileId: string, preview: boolean) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.reader(client, workspaceId, projectId, user);
      if (!UUID.test(fileId)) throw new NotFoundException("File not found.");
      const row = (await client.query<{ objectKey: string; previewKey: string | null; mimeType: string; name: string }>(
        `SELECT object_key AS "objectKey", preview_key AS "previewKey", mime_type AS "mimeType", original_name AS name FROM project_technical_measure_files
          WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, fileId])).rows[0];
      if (!row || !this.storage) throw new NotFoundException("File not found.");
      const key = preview && row.previewKey ? row.previewKey : row.objectKey;
      const stored = await this.storage.read(key).catch(() => null);
      if (!stored) throw new NotFoundException("File not found.");
      return { body: stored.body, contentType: key === row.previewKey ? "image/webp" : row.mimeType, name: row.name };
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
   * Who may read the project's drawings: the people who manage projects, its team, and the people who run the factory
   * once the client approved the drawings or while its route asks the factory to book a slot (PLM-062) or to take the
   * technical measure (PLM-149). The factory only reads, and records the technical measure.
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
    const route = await drawingRoute(client, workspaceId, projectId);
    if (!onTeam) {
      const factory = await has(["factory.view", "factory.manage"]) && (await productionReleased(client, workspaceId, projectId) || route.factorySlot || route.needsMeasure);
      if (!factory) throw new NotFoundException("Project not found.");
    }
    const manager = all || team.some((member) => member.membershipId === membershipId && member.lead);
    // PLM-149: the client hears about drawings from the project manager or the role the firm chose (the lead designer).
    const clientRole = drawingsClientRoleOf(await ensureSettings(client, workspaceId), route.check);
    const clientFacing = manager || Boolean(clientRole && team.some((member) => member.membershipId === membershipId && member.roles.includes(clientRole)));
    // The technical measure: the project manager or the factory team (its factory lead, or the people who run the factory).
    const measurer = manager || team.some((member) => member.membershipId === membershipId && member.roles.includes("factory_lead")) || await has(["factory.manage"]);
    return { project, all, membershipId, team, onTeam, manager, route, clientFacing, measurer };
  }

  private async state(client: Db, workspaceId: string, reader: Awaited<ReturnType<ProjectDrawingsService["reader"]>>) {
    const { project, team, membershipId, onTeam, manager, clientFacing, measurer } = reader;
    const revisions = await readDrawingRevisions(client, workspaceId, project.id);
    const route = await drawingRoute(client, workspaceId, project.id);
    const gate = route.needsMeasure ? await measureGate(client, workspaceId, project.id) : { required: false, done: true };
    const stages = await readStages(client, workspaceId, [project.id]);
    const drawingRoles = new Set(stages.filter((stage) => stage.ownerRole && stage.checks.some((check) => DRAWING_CHECKS.includes(check.kind))).map((stage) => stage.ownerRole!));
    const drawer = team.some((member) => member.membershipId === membershipId && member.roles.some((role) => drawingRoles.has(role)));
    const latest = revisions[0] ?? null;
    const open = OPEN.includes(project.status);
    const drawingFiles = latest ? latest.files.filter((file) => file.kind === "drawing").length : 0;
    let sendable = false;
    if (latest) try { assertSendable({ ...latest, drawingFiles }, route.check); sendable = true; } catch { sendable = false; }
    // The site check is the technical team's (or the project manager's); the design check the lead designer's (PLM-149).
    const checker = route.check === "design" ? clientFacing : manager || drawer;
    return {
      revisions, version: project.version, caseId: project.caseId, inRoute: route.inRoute, needed: route.needed, needsSiteCheck: route.needsSiteCheck, check: route.check,
      // PLM-149: the technical site measure (the latest first), whether shop drawings wait for it, and who records it.
      measure: route.needsMeasure ? { required: gate.required, done: gate.done, measures: await readMeasures(client, workspaceId, project.id),
        unit: await defaultMeasureUnit(client, workspaceId), units: MEASURE_UNITS, canRecord: open && measurer } : null,
      // PLM-057: the items, whether each needs drawings (the rule or the team's decision) and the catalogue drawing it already has.
      items: await readDrawingItems(client, workspaceId, project.id), canDecideItems: open && (manager || drawer),
      canUpload: open && onTeam && (latest?.status === "uploaded" || canStartRevision(latest)) && (Boolean(latest) || gate.done),
      canCheck: open && checker && latest?.status === "uploaded" && drawingFiles > 0,
      canSend: open && clientFacing && sendable,
      canDecide: open && clientFacing && latest?.status === "sent",
    };
  }
}
