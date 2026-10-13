import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { markInspectionSnagFixed, readInspection, readOpenInspections, recordInspection, recordRights } from "./factory-inspections";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FACTORY_VIEW = ["factory.view", "factory.manage", "factory.report", "factory.approve"];
const MAX_PHOTOS = 10;

/**
 * PLM-150: the design inspections as people open them. The factory sees every one; a manager (projects.manage) too;
 * anyone else on a project's team sees its inspections. Only the inspecting designer or a manager records a result,
 * never the factory person who marked the item ready.
 */
@Injectable()
export class FactoryInspectionsService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  /**
   * The open inspections (due with the design team) with who, which item, which project and by when: one person's
   * (`mine=1`), one project's, or due in a date range (`from`, `to`), as the design calendar reads them (PLM-152).
   */
  list(actor: RequestActor, workspaceId: string, query: Record<string, string>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const scope = await this.scope(client, workspaceId, user.userId);
      const projectId = query.projectId && UUID.test(query.projectId) ? query.projectId : null;
      if (projectId && scope.projects && !scope.projects.includes(projectId)) throw new NotFoundException("Project not found.");
      const membershipId = query.mine === "1" ? scope.membershipId : null;
      const rows = await readOpenInspections(client, workspaceId, { projectId, membershipId, from: DATE.test(query.from ?? "") ? query.from : null, to: DATE.test(query.to ?? "") ? query.to : null });
      return { inspections: scope.projects ? rows.filter((row) => scope.projects!.includes(row.projectId)) : rows };
    });
  }

  detail(actor: RequestActor, workspaceId: string, inspectionId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.view(client, workspaceId, inspectionId, user.userId));
  }

  /**
   * Passes or fails a round (version-checked), or (`fix_snag`) the factory marks one of the item's snags fixed: the
   * factory's people and whoever the snag is given to; the next round opens by itself once the last one is fixed.
   */
  command(actor: RequestActor, workspaceId: string, inspectionId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const view = await this.view(client, workspaceId, inspectionId, user.userId);
      if (body.action === "fix_snag") {
        const snag = view.snags.find((row) => row.id === body.snagId);
        if (!snag) throw new NotFoundException("Snag not found.");
        // Marked fixed already (a second press, or someone else first): nothing changes.
        if (["in_review", "done"].includes(snag.status)) return view;
        if (snag.status === "cancelled") throw new ConflictException("This snag was cancelled.");
        if (!snag.canFix) throw new ForbiddenException("Only the factory marks its snags fixed.");
        const result = await markInspectionSnagFixed(client, workspaceId, { inspectionId, snagId: snag.id, version: body.version, userId: user.userId });
        if (result.changed) await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "work_order.inspection_snag_fixed", entityType: "work_order",
          entityId: result.snag.workOrderId, after: { inspectionId, snagId: snag.id, number: snag.number } });
        return this.view(client, workspaceId, inspectionId, user.userId);
      }
      await recordInspection(client, workspaceId, { id: inspectionId, body, userId: user.userId, manages: await this.access.hasPermission(client, workspaceId, user.userId, "projects.manage") });
      return this.view(client, workspaceId, inspectionId, user.userId);
    });
  }

  /** A photo taken at a round while it's open (up to ten), by whoever records it; the same photo id twice changes nothing. */
  async uploadPhoto(actor: RequestActor, workspaceId: string, inspectionId: string, photoId: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    if (!prepared.mimeType.startsWith("image/")) throw new BadRequestException("Choose a photo (JPG, PNG, WebP or HEIC).");
    const storage = this.storage;
    if (!storage) throw new ConflictException("Photos can't be stored here yet.");
    if (!UUID.test(photoId)) throw new BadRequestException("Photo isn't valid.");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const view = await this.view(client, workspaceId, inspectionId, user.userId);
      const round = (await client.query<{ status: string; workOrderId: string }>(
        `SELECT status, work_order_id AS "workOrderId" FROM factory_inspections WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, inspectionId])).rows[0];
      const existing = (await client.query<{ sha256: string; inspectionId: string }>(`SELECT sha256, inspection_id AS "inspectionId" FROM factory_inspection_photos WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, photoId])).rows[0];
      if (existing) {
        if (existing.inspectionId !== inspectionId || existing.sha256 !== prepared.digest) throw new ConflictException("This upload id belongs to another photo.");
        return view;
      }
      if (round.status !== "due") throw new ConflictException("This inspection is already recorded.");
      if (!view.canRecord) throw new ForbiddenException(view.why ?? "You can't add photos to this inspection.");
      if (view.photos.length >= MAX_PHOTOS) throw new BadRequestException(`An inspection takes up to ${MAX_PHOTOS} photos.`);
      const key = `factory/inspections/${workspaceId}/${photoId}`;
      await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
      if (prepared.preview) await storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
      await client.query(
        `INSERT INTO factory_inspection_photos (id, workspace_id, inspection_id, work_order_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [photoId, workspaceId, inspectionId, round.workOrderId, prepared.name.slice(0, 240), prepared.mimeType, prepared.body.length, `${key}/original`,
          prepared.preview ? `${key}/preview.webp` : null, prepared.digest, user.userId]);
      await client.query(`UPDATE factory_inspections SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, inspectionId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "work_order.inspection_photo_added", entityType: "work_order", entityId: round.workOrderId,
        after: { inspectionId, photoId } });
      return this.view(client, workspaceId, inspectionId, user.userId);
    });
  }

  /** A round's photo (or its preview) for someone who can open the round. */
  photo(actor: RequestActor, workspaceId: string, photoId: string, preview: boolean) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      if (!UUID.test(photoId)) throw new NotFoundException("Photo not found.");
      const row = (await client.query<{ inspectionId: string; objectKey: string; previewKey: string | null; mimeType: string }>(
        `SELECT inspection_id AS "inspectionId", object_key AS "objectKey", preview_key AS "previewKey", mime_type AS "mimeType" FROM factory_inspection_photos WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, photoId])).rows[0];
      if (!row || !this.storage) throw new NotFoundException("Photo not found.");
      await this.view(client, workspaceId, row.inspectionId, user.userId);
      const key = preview && row.previewKey ? row.previewKey : row.objectKey;
      const stored = await this.storage.read(key).catch(() => null);
      if (!stored) throw new NotFoundException("Photo not found.");
      return { body: stored.body, contentType: key === row.previewKey ? "image/webp" : row.mimeType };
    });
  }

  /** The round, if the person may open it, with whether they may record it and why not. */
  private async view(client: Db, workspaceId: string, inspectionId: string, userId: string) {
    if (!UUID.test(inspectionId)) throw new NotFoundException("Inspection not found.");
    const found = await readInspection(client, workspaceId, inspectionId);
    if (!found) throw new NotFoundException("Inspection not found.");
    const scope = await this.scope(client, workspaceId, userId);
    if (scope.projects && !scope.projects.includes(found.row.projectId)) throw new NotFoundException("Inspection not found.");
    const manages = await this.access.hasPermission(client, workspaceId, userId, "projects.manage");
    const rights = found.row.status === "due" ? await recordRights(client, workspaceId, found.row, userId, manages) : { canRecord: false, why: null };
    const { requestedBy, ...row } = found.row;
    // PLM-150: the factory (who makes and reports) marks a snag fixed; so does whoever it was given to.
    const factoryFixes = (await this.access.grantedPermissions(client, workspaceId, userId, ["factory.manage", "factory.report"])).size > 0;
    const snags = found.snags.map(({ assigneeId, ...snag }) => ({ ...snag,
      canFix: ["todo", "in_progress"].includes(snag.status) && (factoryFixes || (Boolean(assigneeId) && assigneeId === scope.membershipId)) }));
    return { ...found, snags, row: { ...row, requestedByMe: requestedBy === userId }, canRecord: rights.canRecord, why: rights.why, canSeeFactory: scope.factory };
  }

  /** What the person sees: every project (the factory, managers) or the projects they're on (with access to projects). */
  private async scope(client: Db, workspaceId: string, userId: string): Promise<{ factory: boolean; projects: string[] | null; membershipId: string | null }> {
    const granted = await this.access.grantedPermissions(client, workspaceId, userId, [...FACTORY_VIEW, "projects.manage", "projects.view"]);
    const membershipId = (await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`,
      [workspaceId, userId])).rows[0]?.id ?? null;
    const factory = FACTORY_VIEW.some((code) => granted.has(code));
    if (factory || granted.has("projects.manage")) return { factory, projects: null, membershipId };
    if (!granted.has("projects.view")) throw new ForbiddenException("You don't have access to inspections.");
    const projects = (await client.query<{ projectId: string }>(
      `SELECT project_id AS "projectId" FROM project_assignments WHERE workspace_id = $1 AND membership_id = $2 AND active AND project_id IS NOT NULL`,
      [workspaceId, membershipId])).rows.map((row) => row.projectId);
    return { factory, projects, membershipId };
  }
}
