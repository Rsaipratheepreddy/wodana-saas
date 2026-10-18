import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { preInstallationChecklist } from "./project-installation";
import { readItemSupplies, signOffSupplies } from "./project-item-supplies";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ActorUser, RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { tellClients } from "../client-portal/portal-notices";
import { canonicalHash } from "../crm/shared/crm-types";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { membershipOf, readProject, readTeam } from "./project-core.store";
import { leadDesignerRole, leadDesigners, membershipOfUser, tellItemPeople } from "./project-item-notices";
import {
  assertCanUpload, deliveryNext, drawingInput, itemDrawingState, MAX_ITEM_PHOTOS, readDeliveryRecords, readItemDrawingRecords, readProjectItems, reviewOutcome,
  type DeliveryState, type ItemDrawingRowStatus, type VersionStatus,
} from "./project-item-proof";
import { defaultMeasureUnit, MEASURE_UNITS } from "./project-technical-measure";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN = ["active", "on_hold"];
const ACTIONS = ["review_drawing", "mark_delivered", "mark_installed", "plan_item", "design_check", "sign_off_supplies"] as const;
const DELIVERY_MODES = ["delivery", "delivery_install"] as const;
type ItemPlan = { lineId: string; drafterName: string; drafterDueOn: string | null; personsNeeded: number | null; crewNames: string[]; deliveryMode: (typeof DELIVERY_MODES)[number]; version: number };

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} isn't valid.`);
  return value.toLowerCase();
}

function version(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new BadRequestException("Reload and try again.");
  return value;
}

/** The upload's details: a JSON object sent beside the file. */
function metaOf(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || raw.length > 4000) throw new BadRequestException("The drawing's details are missing.");
  try { const parsed = JSON.parse(raw) as unknown; if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>; } catch { /* below */ }
  throw new BadRequestException("The drawing's details are missing.");
}

type Context = Awaited<ReturnType<ProjectItemProofService["context"]>>;

/**
 * Shop drawings and delivery proof per item (project-item-proof.ts). The project's team uploads each item's shop
 * drawing versions; the lead designer (the project manager when no one holds the role) approves a version, which sends
 * it to the client, or returns it with the reason; the client signs in the portal (portal-item-drawings.ts). The team
 * adds photos of each item on site and marks it delivered, or delivered and installed, only with a photo. The people
 * who run the factory read. Every command is validated, version-checked against the item it changes, replayed safely by
 * its id and audited.
 */
@Injectable()
export class ProjectItemProofService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  drawings(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.drawingState(client, workspaceId, await this.context(client, workspaceId, projectId, user)));
  }

  deliveries(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.deliveryState(client, workspaceId, await this.context(client, workspaceId, projectId, user)));
  }

  /**
   * One shop drawing version of an item: the file (PDF or image) with the quantity and sizes it shows and a note, from
   * the project's team, while the item waits for a drawing or after changes were asked. Replayed safely by its id; the
   * lead designer hears.
   */
  async uploadDrawing(actor: RequestActor, workspaceId: string, projectId: string, lineId: string, versionId: string, rawMeta: unknown, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    const storage = this.storage;
    if (!storage) throw new ConflictException("Files can't be stored here yet.");
    const line = uuid(lineId, "Item"), id = uuid(versionId, "Drawing");
    const meta = metaOf(rawMeta);
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const ctx = await this.context(client, workspaceId, projectId, user);
      if (!ctx.onTeam) throw new ForbiddenException("Only the project's team adds shop drawings.");
      if (!ctx.open) throw new ConflictException("The project is closed.");
      await readProject(client, workspaceId, projectId, true);
      const existing = (await client.query<{ sha256: string; lineId: string }>(`SELECT sha256, line_id AS "lineId" FROM project_item_drawing_versions WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, id])).rows[0];
      if (existing) {
        if (existing.sha256 !== prepared.digest || existing.lineId !== line) throw new ConflictException("This upload id belongs to another file.");
        return this.drawingState(client, workspaceId, ctx);
      }
      const item = (await readProjectItems(client, workspaceId, projectId)).find((candidate) => candidate.lineId === line);
      if (!item) throw new NotFoundException("Item not found.");
      const row = (await client.query<{ id: string; status: ItemDrawingRowStatus; latestNumber: number; version: number }>(
        `SELECT id, status, latest_number AS "latestNumber", version FROM project_item_drawings WHERE workspace_id = $1 AND project_id = $2 AND line_id = $3 FOR UPDATE`,
        [workspaceId, projectId, line])).rows[0];
      if (version(meta.version) !== (row?.version ?? 0)) throw new ConflictException("This item's drawing changed. Reload to see the latest.");
      assertCanUpload(itemDrawingState({ needed: item.needed, status: row?.status ?? null }), row?.latestNumber ?? 0);
      const input = drawingInput(meta, item, await defaultMeasureUnit(client, workspaceId));
      const number = (row?.latestNumber ?? 0) + 1;
      const itemId = row?.id ?? randomUUID();
      const key = `projects/item-drawings/${workspaceId}/${id}`;
      await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
      if (prepared.preview) await storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
      if (row) await client.query(`UPDATE project_item_drawings SET status = 'with_lead_designer', latest_number = $3, current_version_id = $4, version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`, [workspaceId, itemId, number, id]);
      else await client.query(`INSERT INTO project_item_drawings (workspace_id, id, project_id, line_id, status, latest_number, current_version_id) VALUES ($1, $2, $3, $4, 'with_lead_designer', $5, $6)`,
        [workspaceId, itemId, projectId, line, number, id]);
      await client.query(
        `INSERT INTO project_item_drawing_versions (workspace_id, id, project_id, line_id, item_drawing_id, number, original_name, mime_type, byte_size, object_key, preview_key, sha256,
           note, quantity, unit, width, height, depth, dimension_unit, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [workspaceId, id, projectId, line, itemId, number, prepared.name, prepared.mimeType, prepared.body.length, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null,
          prepared.digest, input.note, input.quantity, item.unit, input.width, input.height, input.depth, input.dimensionUnit, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "project.item_drawing_uploaded", entityType: "project", entityId: projectId,
        after: { lineId: line, versionId: id, number, name: prepared.name, sha256: prepared.digest, quantity: input.quantity, width: input.width, height: input.height, depth: input.depth,
          dimensionUnit: input.dimensionUnit } });
      await tellItemPeople(client, { workspaceId, projectId, key: `uploaded:${id}`, actorUserId: user.userId, code: "project.item_drawing_uploaded",
        memberships: await leadDesigners(client, workspaceId, projectId), item: `${item.title} · V${number}`, note: input.note });
      return this.drawingState(client, workspaceId, ctx);
    });
  }

  /** One photo of an item on site, taken by a signed-in person of the project's team (who and when are kept). Replayed safely by its id. */
  async uploadPhoto(actor: RequestActor, workspaceId: string, projectId: string, lineId: string, photoId: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    if (!prepared.mimeType.startsWith("image/")) throw new BadRequestException("Choose a photo (JPG, PNG, WebP or HEIC).");
    const storage = this.storage;
    if (!storage) throw new ConflictException("Photos can't be stored here yet.");
    const line = uuid(lineId, "Item"), id = uuid(photoId, "Photo");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const ctx = await this.context(client, workspaceId, projectId, user);
      if (!ctx.onTeam) throw new ForbiddenException("Only the project's team adds delivery photos.");
      if (!ctx.open) throw new ConflictException("The project is closed.");
      await readProject(client, workspaceId, projectId, true);
      const existing = (await client.query<{ sha256: string; lineId: string }>(`SELECT sha256, line_id AS "lineId" FROM project_item_delivery_photos WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, id])).rows[0];
      if (existing) {
        if (existing.sha256 !== prepared.digest || existing.lineId !== line) throw new ConflictException("This upload id belongs to another photo.");
        return this.deliveryState(client, workspaceId, ctx);
      }
      if (!(await readProjectItems(client, workspaceId, projectId)).some((item) => item.lineId === line)) throw new NotFoundException("Item not found.");
      const count = (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM project_item_delivery_photos WHERE workspace_id = $1 AND project_id = $2 AND line_id = $3`,
        [workspaceId, projectId, line])).rows[0].count;
      if (count >= MAX_ITEM_PHOTOS) throw new BadRequestException(`An item takes up to ${MAX_ITEM_PHOTOS} photos.`);
      const key = `projects/item-photos/${workspaceId}/${id}`;
      await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
      if (prepared.preview) await storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
      await client.query(
        `INSERT INTO project_item_delivery_photos (workspace_id, id, project_id, line_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, taken_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [workspaceId, id, projectId, line, prepared.name, prepared.mimeType, prepared.body.length, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null, prepared.digest, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "project.item_delivery_photo_added", entityType: "project", entityId: projectId,
        after: { lineId: line, photoId: id, sha256: prepared.digest } });
      return this.deliveryState(client, workspaceId, ctx);
    });
  }

  /**
   * One item command, once: the lead designer's check of a drawing version, or an item marked delivered or delivered and
   * installed. The command id makes a retry return the state (different details under the same id are refused).
   */
  command(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    const commandId = uuid(body.commandId, "Command");
    const action = typeof body.action === "string" && (ACTIONS as readonly string[]).includes(body.action) ? body.action as (typeof ACTIONS)[number] : null;
    if (!action) throw new BadRequestException("This action isn't available.");
    const requestHash = canonicalHash(body);
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const ctx = await this.context(client, workspaceId, projectId, user);
      await readProject(client, workspaceId, projectId, true);
      const state = () => action === "review_drawing" || action === "sign_off_supplies" || (action === "plan_item" && body.view === "drawings") ? this.drawingState(client, workspaceId, ctx) : this.deliveryState(client, workspaceId, ctx);
      const prior = (await client.query<{ requestHash: string }>(`SELECT request_hash AS "requestHash" FROM project_item_commands WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, commandId])).rows[0];
      if (prior) {
        if (prior.requestHash !== requestHash) throw new ConflictException("This was already sent with different details. Reload and try again.");
        return { ...(await state()), replayed: true };
      }
      if (!ctx.open) throw new ConflictException("The project is closed.");
      if (action === "review_drawing") await this.review(client, workspaceId, ctx, user, body);
      else if (action === "plan_item") await this.plan(client, workspaceId, ctx, user, body);
      else if (action === "sign_off_supplies") {
        // Guide step 21: procurement signs off the item's supplies; the project manager and the factory lead hear.
        if (!ctx.procurement) throw new ForbiddenException("Only procurement signs off an item's supplies.");
        const lineId = uuid(body.lineId, "Item");
        const item = (await readProjectItems(client, workspaceId, ctx.project.id)).find((candidate) => candidate.lineId === lineId);
        if (!item) throw new NotFoundException("Item not found.");
        await signOffSupplies(client, { workspaceId, projectId: ctx.project.id, lineId, title: item.title, method: body.method, note: body.note, userId: user.userId });
      }
      else if (action === "design_check") {
        // Guide step 23: the lead designer checks the items match the design before they go to site.
        if (!ctx.leadDesigner) throw new ForbiddenException("Only the lead designer checks the items against the design.");
        await client.query(`UPDATE delivery_projects SET design_checked_by = $3, design_checked_at = now() WHERE workspace_id = $1 AND id = $2 AND design_checked_at IS NULL`,
          [workspaceId, ctx.project.id, user.userId]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "project.design_checked", entityType: "project", entityId: ctx.project.id, after: { checked: true } });
      }
      else await this.deliver(client, workspaceId, ctx, user, body, action === "mark_installed" ? "installed" : "delivered");
      await client.query(`INSERT INTO project_item_commands (workspace_id, id, project_id, action, request_hash, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [workspaceId, commandId, projectId, action, requestHash, user.userId]);
      return state();
    });
  }

  /** The lead designer approves a version (it goes to the client, who hears at most once a day) or returns it with the reason (its uploader hears). */
  private async review(client: Db, workspaceId: string, ctx: Context, user: ActorUser, body: Record<string, unknown>) {
    if (!ctx.leadDesigner) throw new ForbiddenException("Only the lead designer checks shop drawings.");
    const versionId = uuid(body.versionId, "Drawing");
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length > 1000) throw new BadRequestException("Keep the reason under 1000 characters.");
    const found = (await client.query<{ itemId: string; status: VersionStatus; current: boolean; itemVersion: number; number: number; createdBy: string; title: string }>(
      `SELECT item.id AS "itemId", version.status, item.current_version_id = version.id AS current, item.version AS "itemVersion", version.number, version.created_by AS "createdBy", line.title
         FROM project_item_drawing_versions version
         JOIN project_item_drawings item ON item.workspace_id = version.workspace_id AND item.id = version.item_drawing_id
         JOIN project_boq_lines line ON line.workspace_id = version.workspace_id AND line.id = version.line_id
        WHERE version.workspace_id = $1 AND version.project_id = $2 AND version.id = $3 FOR UPDATE OF version, item`, [workspaceId, ctx.project.id, versionId])).rows[0];
    if (!found) throw new NotFoundException("Drawing not found.");
    if (version(body.version) !== found.itemVersion || !found.current) throw new ConflictException("This item's drawing changed. Reload to see the latest.");
    const outcome = reviewOutcome(found.status, body.decision, reason);
    await client.query(`UPDATE project_item_drawing_versions SET status = $3, reviewed_by = $4, reviewed_at = now(), review_note = $5 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, versionId, outcome, user.userId, reason]);
    await client.query(`UPDATE project_item_drawings SET status = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, found.itemId, outcome === "with_client" ? "with_client" : "changes_asked"]);
    await recordAudit(client, { workspaceId, actorUserId: user.userId, action: outcome === "with_client" ? "project.item_drawing_approved" : "project.item_drawing_returned",
      entityType: "project", entityId: ctx.project.id, after: { versionId, number: found.number, reason } });
    const label = `${found.title} · V${found.number}`;
    if (outcome === "with_client") {
      const today = (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`,
        [workspaceId])).rows[0].today;
      // The client's decision-makers hear that shop drawings wait for their signature: the portal card, and WhatsApp or the branded email once a day.
      await tellClients(client, { workspaceId, caseId: ctx.project.caseId, event: "decision_waiting", recordId: `item-drawings:${ctx.project.id}:${today}`, title: "Shop drawings" });
    } else {
      const uploader = await membershipOfUser(client, workspaceId, found.createdBy);
      await tellItemPeople(client, { workspaceId, projectId: ctx.project.id, key: `returned:${versionId}`, actorUserId: user.userId, code: "project.item_drawing_returned",
        memberships: uploader ? [uploader] : [], item: label, note: reason });
    }
  }

  /** Marks an item delivered, or delivered and installed: only with a photo of it on site, and only forward. */
  /**
   * Guide steps 18, 22, 24: an item's plan: who drafts its technical drawing (a name, no login needed) and by when; the
   * people the factory needs on it and who they are (names); delivered only, or delivered and installed. The project's
   * manager or someone who runs the factory sets it; version-checked per item.
   */
  private async plan(client: Db, workspaceId: string, ctx: Context, user: ActorUser, body: Record<string, unknown>) {
    if (!ctx.manager && !(await this.access.hasPermission(client, workspaceId, user.userId, "factory.manage"))) throw new ForbiddenException("Only the project's manager or the factory plans an item.");
    const line = uuid(body.lineId, "Item");
    if (!(await readProjectItems(client, workspaceId, ctx.project.id)).some((item) => item.lineId === line)) throw new NotFoundException("Item not found.");
    const current = (await readItemPlans(client, workspaceId, ctx.project.id)).get(line);
    if (version(body.version) !== (current?.version ?? 0)) throw new ConflictException("This item's plan changed. Reload to see the latest.");
    const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
    const drafterName = body.drafterName === undefined ? current?.drafterName ?? "" : text(body.drafterName, 120);
    const dueOn = body.drafterDueOn === undefined ? current?.drafterDueOn ?? null : body.drafterDueOn === null || body.drafterDueOn === "" ? null : String(body.drafterDueOn);
    if (dueOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new BadRequestException("Choose the day the drawing is due.");
    const persons = body.personsNeeded === undefined ? current?.personsNeeded ?? null : body.personsNeeded === null || body.personsNeeded === "" ? null : Number(body.personsNeeded);
    if (persons !== null && (!Number.isInteger(persons) || persons < 1 || persons > 99)) throw new BadRequestException("People needed is 1 to 99.");
    const crew = body.crewNames === undefined ? current?.crewNames ?? [] : Array.isArray(body.crewNames) ? [...new Set(body.crewNames.map((name) => text(name, 120)).filter(Boolean))] : [];
    if (crew.length > 20) throw new BadRequestException("At most 20 people on one item.");
    const mode = body.deliveryMode === undefined ? current?.deliveryMode ?? "delivery_install" : body.deliveryMode;
    if (!(DELIVERY_MODES as readonly unknown[]).includes(mode)) throw new BadRequestException("Choose delivery only, or delivery and installation.");
    await client.query(
      `INSERT INTO project_item_plans (workspace_id, project_id, line_id, drafter_name, drafter_due_on, persons_needed, crew_names, delivery_mode, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (workspace_id, project_id, line_id) DO UPDATE SET drafter_name = excluded.drafter_name, drafter_due_on = excluded.drafter_due_on, persons_needed = excluded.persons_needed,
         crew_names = excluded.crew_names, delivery_mode = excluded.delivery_mode, updated_by = excluded.updated_by, updated_at = now(), version = project_item_plans.version + 1`,
      [workspaceId, ctx.project.id, line, drafterName, dueOn, persons, crew, mode, user.userId]);
    await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "project.item_planned", entityType: "project", entityId: ctx.project.id,
      before: current ?? null, after: { lineId: line, drafterName, drafterDueOn: dueOn, personsNeeded: persons, crewNames: crew, deliveryMode: mode } });
  }

  private async deliver(client: Db, workspaceId: string, ctx: Context, user: ActorUser, body: Record<string, unknown>, target: "delivered" | "installed") {
    if (!ctx.onTeam) throw new ForbiddenException("Only the project's team records deliveries.");
    const line = uuid(body.lineId, "Item");
    // Guide step 23: the first delivery waits for the pre-installation checklist.
    if (target === "delivered" && !(await client.query(`SELECT 1 FROM project_item_deliveries WHERE workspace_id = $1 AND project_id = $2 LIMIT 1`, [workspaceId, ctx.project.id])).rowCount) {
      const open = (await preInstallationChecklist(client, workspaceId, ctx.project.id)).filter((item) => !item.done);
      if (open.length) throw new ConflictException(`Before the first delivery: ${open.map((item) => item.label).join("; ")}.`);
    }
    // Guide step 24: an item planned as delivery only is done when delivered; it has no installation to record.
    if (target === "installed" && (await readItemPlans(client, workspaceId, ctx.project.id)).get(line)?.deliveryMode === "delivery")
      throw new ConflictException("This item is delivery only: it has no installation to record.");
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length > 1000) throw new BadRequestException("Keep the note under 1000 characters.");
    const item = (await readProjectItems(client, workspaceId, ctx.project.id)).find((candidate) => candidate.lineId === line);
    if (!item) throw new NotFoundException("Item not found.");
    const row = (await client.query<{ id: string; status: "delivered" | "installed"; version: number }>(
      `SELECT id, status, version FROM project_item_deliveries WHERE workspace_id = $1 AND project_id = $2 AND line_id = $3 FOR UPDATE`, [workspaceId, ctx.project.id, line])).rows[0];
    if (version(body.version) !== (row?.version ?? 0)) throw new ConflictException("This item's delivery changed. Reload to see the latest.");
    const photos = (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM project_item_delivery_photos WHERE workspace_id = $1 AND project_id = $2 AND line_id = $3`,
      [workspaceId, ctx.project.id, line])).rows[0].count;
    const next = deliveryNext((row?.status ?? "pending") as DeliveryState, target, photos);
    if (row) await client.query(
      `UPDATE project_item_deliveries SET status = $3::varchar, installed_by = CASE WHEN $3::varchar = 'installed' THEN $4::uuid END,
              installed_at = CASE WHEN $3::varchar = 'installed' THEN now() END, note = CASE WHEN $5::varchar = '' THEN note ELSE $5::varchar END, version = version + 1
        WHERE workspace_id = $1 AND id = $2`, [workspaceId, row.id, next, user.userId, note]);
    else await client.query(
      `INSERT INTO project_item_deliveries (workspace_id, id, project_id, line_id, status, delivered_by, installed_by, installed_at, note)
       VALUES ($1, $2, $3, $4, $5::varchar, $6, CASE WHEN $5::varchar = 'installed' THEN $6::uuid END, CASE WHEN $5::varchar = 'installed' THEN now() END, $7)`,
      [workspaceId, randomUUID(), ctx.project.id, line, next, user.userId, note]);
    await recordAudit(client, { workspaceId, actorUserId: user.userId, action: next === "installed" ? "project.item_installed" : "project.item_delivered", entityType: "project",
      entityId: ctx.project.id, after: { lineId: line, item: item.title, photos, note } });
  }

  /** One drawing version's file (or its preview), for someone who may read the project's item drawings. */
  drawingFile(actor: RequestActor, workspaceId: string, projectId: string, versionId: string, preview: boolean) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.context(client, workspaceId, projectId, user);
      if (!UUID.test(versionId)) throw new NotFoundException("File not found.");
      return this.stored(client, `SELECT object_key AS "objectKey", preview_key AS "previewKey", mime_type AS "mimeType", original_name AS name FROM project_item_drawing_versions
        WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, versionId], preview);
    });
  }

  /** One delivery photo (or its preview), for someone who may read the project. */
  photo(actor: RequestActor, workspaceId: string, projectId: string, photoId: string, preview: boolean) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.context(client, workspaceId, projectId, user);
      if (!UUID.test(photoId)) throw new NotFoundException("File not found.");
      return this.stored(client, `SELECT object_key AS "objectKey", preview_key AS "previewKey", mime_type AS "mimeType", original_name AS name FROM project_item_delivery_photos
        WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, photoId], preview);
    });
  }

  private async stored(client: Db, sql: string, values: unknown[], preview: boolean) {
    const row = (await client.query<{ objectKey: string; previewKey: string | null; mimeType: string; name: string }>(sql, values)).rows[0];
    if (!row || !this.storage) throw new NotFoundException("File not found.");
    const key = preview && row.previewKey ? row.previewKey : row.objectKey;
    const stored = await this.storage.read(key).catch(() => null);
    if (!stored) throw new NotFoundException("File not found.");
    return { body: stored.body, contentType: key === row.previewKey ? "image/webp" : row.mimeType, name: row.name };
  }

  /**
   * Who may read and act: the people who manage projects and the project's team read and add drawings and delivery
   * proof; the lead designer (the project manager too) checks drawings; the people who run the factory only read.
   */
  private async context(client: Db, workspaceId: string, projectId: string, user: ActorUser) {
    if (!UUID.test(projectId)) throw new NotFoundException("Project not found.");
    const project = await readProject(client, workspaceId, projectId);
    if (!project) throw new NotFoundException("Project not found.");
    const has = (code: string) => this.access.hasPermission(client, workspaceId, user.userId, code);
    const all = await has("projects.manage");
    const membershipId = await membershipOf(client, workspaceId, user.userId);
    const team = (await readTeam(client, workspaceId, [projectId])).get(projectId) ?? [];
    const me = team.find((member) => member.membershipId === membershipId);
    const onTeam = all || (Boolean(me) && await has("projects.view"));
    const procurement = await has("purchasing.manage");
    const factory = await has("factory.manage");
    if (!onTeam && !procurement && !(await has("factory.view") || factory)) throw new NotFoundException("Project not found.");
    const manager = all || Boolean(me?.lead);
    const role = await leadDesignerRole(client, workspaceId);
    const leadDesigner = onTeam && (manager || Boolean(role && me?.roles.includes(role)));
    return { project, onTeam, manager, leadDesigner, procurement, factory, open: OPEN.includes(project.status) };
  }

  /** Every item with where its shop drawing stands, its versions (newest first), the lock and the client's signature. */
  private async drawingState(client: Db, workspaceId: string, ctx: Context) {
    const items = await readProjectItems(client, workspaceId, ctx.project.id);
    const records = await readItemDrawingRecords(client, workspaceId, ctx.project.id);
    const plans = await readItemPlans(client, workspaceId, ctx.project.id);
    const supplies = await readItemSupplies(client, workspaceId, ctx.project.id);
    const canAdd = ctx.open && ctx.onTeam;
    return {
      dimensionUnit: await defaultMeasureUnit(client, workspaceId), units: MEASURE_UNITS, canUpload: canAdd, canReview: ctx.open && ctx.leadDesigner,
      // Who plans an item: the project's manager or the factory (the same rule as the plan command).
      canPlan: ctx.open && (ctx.manager || ctx.factory),
      items: items.map((item) => {
        const row = records.rows.find((candidate) => candidate.lineId === item.lineId) ?? null;
        const versions = records.versions.filter((candidate) => candidate.lineId === item.lineId).map(({ lineId: _line, ...rest }) => rest);
        const state = itemDrawingState({ needed: item.needed, status: row?.status ?? null });
        const current = versions.find((candidate) => candidate.id === row?.currentVersionId) ?? null;
        const locked = row?.lockedVersionId ? versions.find((candidate) => candidate.id === row.lockedVersionId) ?? null : null;
        const signature = locked ? records.signatures.find((candidate) => candidate.versionId === locked.id) ?? null : null;
        let uploadable = canAdd;
        try { assertCanUpload(state, row?.latestNumber ?? 0); } catch { uploadable = false; }
        return {
          lineId: item.lineId, title: item.title, area: item.area, quantity: item.quantity, unit: item.unit, needed: item.needed,
          state, version: row?.version ?? 0, number: row?.latestNumber ?? 0, current, versions,
          locked: locked && row?.lockedAt ? { versionId: locked.id, number: locked.number, at: new Date(row.lockedAt).toISOString(), quantity: locked.quantity, unit: locked.unit,
            width: locked.width, height: locked.height, depth: locked.depth, dimensionUnit: locked.dimensionUnit } : null,
          signature, plan: plans.get(item.lineId) ?? null,
          // Guide step 21: procurement's sign-off of the item's supplies (the last gate before its release).
          supplies: supplies.get(item.lineId) ?? null, canSignOffSupplies: ctx.open && ctx.procurement && !supplies.has(item.lineId),
          canUpload: uploadable, canReview: ctx.open && ctx.leadDesigner && current?.status === "with_lead_designer",
        };
      }),
    };
  }

  /** Every item with its delivery state (pending, delivered, installed), who and when, and its photos. */
  private async deliveryState(client: Db, workspaceId: string, ctx: Context) {
    const items = await readProjectItems(client, workspaceId, ctx.project.id);
    const records = await readDeliveryRecords(client, workspaceId, ctx.project.id);
    const plans = await readItemPlans(client, workspaceId, ctx.project.id);
    const canRecord = ctx.open && ctx.onTeam;
    return {
      canRecord, checklist: await preInstallationChecklist(client, workspaceId, ctx.project.id), canDesignCheck: ctx.open && ctx.leadDesigner,
      items: items.map((item) => {
        const row = records.rows.find((candidate) => candidate.lineId === item.lineId) ?? null;
        return {
          lineId: item.lineId, title: item.title, area: item.area, quantity: item.quantity, unit: item.unit, state: (row?.status ?? "pending") as DeliveryState, version: row?.version ?? 0,
          deliveredAt: row?.deliveredAt ?? null, deliveredByName: row?.deliveredByName ?? null, installedAt: row?.installedAt ?? null, installedByName: row?.installedByName ?? null,
          note: row?.note ?? "", photos: records.photos.filter((photo) => photo.lineId === item.lineId).map(({ lineId: _line, ...photo }) => photo),
          plan: plans.get(item.lineId) ?? null,
          canRecord: canRecord && row?.status !== "installed" && !(row?.status === "delivered" && plans.get(item.lineId)?.deliveryMode === "delivery"),
        };
      }),
    };
  }
}


/** Every item's plan on a project (drafter and due day, factory people and crew, delivery mode), by item. */
export async function readItemPlans(db: Db, workspaceId: string, projectId: string): Promise<Map<string, ItemPlan>> {
  const rows = (await db.query<ItemPlan>(
    `SELECT line_id AS "lineId", drafter_name AS "drafterName", to_char(drafter_due_on, 'YYYY-MM-DD') AS "drafterDueOn", persons_needed AS "personsNeeded",
            crew_names AS "crewNames", delivery_mode AS "deliveryMode", version
       FROM project_item_plans WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows;
  return new Map(rows.map((row) => [row.lineId, row]));
}
