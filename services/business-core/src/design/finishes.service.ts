import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { leadDesigner } from "./design-journey.store";
import {
  addSnapshot, archiveSnapshot, factoryShares, finishSettings, priceBands, readSchedule, recordSignature, saveFinishSettings, scheduleAsset, sendToQs, setBudgetRange,
  shareWithFactory, sharedWithFactory, updateFinishDetails,
} from "./finishes.store";
import { archiveSample, listSamples, readSample, saveBands, saveSample, workspaceCurrency, type SampleInput } from "./samples.store";

const VIEW = "pre_projects.view", EDIT = "pre_projects.edit", MATERIALS = "pre_projects.manage_materials", CLIENT = "pre_projects.record_client_design_decisions";
const LIFECYCLE = "pre_projects.manage_lifecycle", SAMPLES = "catalog.samples.manage";

/**
 * The finishes schedule (PLM-156) on the materials and decisions ledger, the material log and sample library
 * (PLM-157), the designer's specification for QS (PLM-146) and the client's signed samples (PLM-148). Every command is
 * validated, idempotent by its ids (or by its content), version-checked where it edits and audited.
 */
@Injectable()
export class FinishesService {
  constructor(private readonly access: WorkspaceAccessService, private readonly storage: BrandAssetStorageService) {}

  // ---------- reading ----------

  /** The schedule on the case (Planning): what this person may do on it, too. */
  schedule(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      await this.case(client, workspaceId, caseId, false);
      return { ...await readSchedule(client, workspaceId, caseId), ...await this.rights(client, workspaceId, caseId, user.userId), caseId };
    });
  }

  /** The schedule from the job (the project): the same record, read by anyone on projects; the designers' actions where they have them. */
  projectSchedule(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["projects.view", VIEW], async (client, user) => {
      const caseId = await this.caseOfProject(client, workspaceId, projectId);
      const rights = await this.access.hasPermission(client, workspaceId, user.userId, VIEW) ? await this.rights(client, workspaceId, caseId, user.userId) : READ_ONLY;
      return { ...await readSchedule(client, workspaceId, caseId), ...rights, caseId };
    });
  }

  /** The factory's list of sample logs shared with it (PLM-156). */
  factoryList(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "factory.view", async (client) => ({ shares: await factoryShares(client, workspaceId) }));
  }

  /** A shared sample log, read from the Factory: only once the lead designer shared it. */
  factorySchedule(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermission(actor, workspaceId, "factory.view", async (client) => {
      if (!(await sharedWithFactory(client, workspaceId, caseId))) throw new NotFoundException("This sample log wasn't shared with the factory.");
      return { ...await readSchedule(client, workspaceId, caseId), ...READ_ONLY, caseId };
    });
  }

  /**
   * A photo or snapshot on the schedule, for someone reading it from the job or the Factory (the case's own file
   * address needs Planning access): only files the schedule uses.
   */
  asset(actor: RequestActor, workspaceId: string, from: { projectId?: string; caseId?: string }, assetId: string, preview: boolean) {
    return this.access.withAnyPermission(actor, workspaceId, ["projects.view", "factory.view", VIEW], async (client, user) => {
      const caseId = from.projectId ? await this.caseOfProject(client, workspaceId, from.projectId) : from.caseId!;
      const allowed = await this.access.hasPermission(client, workspaceId, user.userId, VIEW)
        || (from.projectId ? await this.access.hasPermission(client, workspaceId, user.userId, "projects.view") : false)
        || (await this.access.hasPermission(client, workspaceId, user.userId, "factory.view") && await sharedWithFactory(client, workspaceId, caseId));
      if (!allowed || !(await scheduleAsset(client, workspaceId, caseId, assetId))) throw new NotFoundException("File not found");
      const row = (await client.query<{ name: string; mimeType: string; objectKey: string; previewKey: string | null }>(
        `SELECT original_name AS name, mime_type AS "mimeType", object_key AS "objectKey", preview_key AS "previewKey" FROM pre_project_brief_assets WHERE workspace_id = $1 AND case_id = $2 AND id = $3`,
        [workspaceId, caseId, assetId])).rows[0];
      if (!row) throw new NotFoundException("File not found");
      if (preview && !row.previewKey) throw new NotFoundException("Preview not available");
      const stored = await this.storage.read(preview ? row.previewKey! : row.objectKey).catch(() => { throw new NotFoundException("This file could not be found in storage."); });
      return { body: stored.body, contentType: preview ? "image/webp" : row.mimeType, name: row.name, preview };
    });
  }

  // ---------- the schedule's commands ----------

  /**
   * A sample photo, a render snapshot or the photo of a signed sample, uploaded to the case. The Material Coordinator
   * (who keeps the material log) can add one without editing the rest of the case.
   */
  async upload(actor: RequestActor, workspaceId: string, caseId: string, id: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    return this.materials(actor, workspaceId, caseId, async (client, userId) => {
      const existing = (await client.query<{ id: string; name: string; mimeType: string; byteSize: number; hasPreview: boolean; sha256: string }>(
        `SELECT id, original_name AS name, mime_type AS "mimeType", byte_size AS "byteSize", preview_key IS NOT NULL AS "hasPreview", sha256 FROM pre_project_brief_assets
          WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, id])).rows[0];
      if (existing) {
        if (existing.sha256 !== prepared.digest) throw new ConflictException("This upload ID belongs to another file. Choose the file again.");
        const { sha256: _digest, ...asset } = existing; void _digest; return asset;
      }
      const key = `pre-projects/${workspaceId}/${caseId}/${id}`;
      await this.storage.put(`${key}/original`, prepared.body, prepared.mimeType);
      if (prepared.preview) await this.storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
      const asset = (await client.query<{ id: string; name: string; mimeType: string; byteSize: number; hasPreview: boolean }>(
        `INSERT INTO pre_project_brief_assets (id, workspace_id, case_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, original_name AS name, mime_type AS "mimeType", byte_size AS "byteSize", preview_key IS NOT NULL AS "hasPreview"`,
        [id, workspaceId, caseId, prepared.name, prepared.mimeType, prepared.body.length, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null, prepared.digest, userId])).rows[0];
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.finish_file_uploaded.v1", entityType: "pre_project_case", entityId: caseId, after: { assetId: id, name: prepared.name } });
      return asset;
    });
  }

  /** PLM-156: a finish's category, room, where it goes and the installation note. */
  details(actor: RequestActor, workspaceId: string, caseId: string, entryId: string, input: { entryVersion: number; categoryKey?: string | null; roomId?: string | null; location?: string | null; installNote?: string | null }) {
    return this.materials(actor, workspaceId, caseId, async (client, userId) => {
      const result = await updateFinishDetails(client, workspaceId, caseId, entryId, input);
      if (result.changed) await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.finish_details_changed.v1", entityType: "design_ledger_entry", entityId: entryId,
        before: result.before, after: result.after });
      return this.view(client, workspaceId, caseId, userId);
    });
  }

  /** PLM-146: a marker on a render snapshot for a finish. */
  addSnapshot(actor: RequestActor, workspaceId: string, caseId: string, entryId: string, input: { id: string; assetId: string; markerX: number; markerY: number; label: string }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const result = await addSnapshot(client, workspaceId, caseId, entryId, input, userId);
      if (!result.replayed) await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.finish_snapshot_added.v1", entityType: "design_ledger_entry", entityId: entryId,
        after: { snapshotId: input.id, assetId: input.assetId, label: input.label.trim() } });
      return this.view(client, workspaceId, caseId, userId);
    });
  }

  removeSnapshot(actor: RequestActor, workspaceId: string, caseId: string, snapshotId: string) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      if (await archiveSnapshot(client, workspaceId, caseId, snapshotId, userId))
        await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.finish_snapshot_removed.v1", entityType: "pre_project_case", entityId: caseId, after: { snapshotId } });
      return this.view(client, workspaceId, caseId, userId);
    });
  }

  /** PLM-146: the designer sends the finishes to QS (the step after the samples are approved). */
  sendToQs(actor: RequestActor, workspaceId: string, caseId: string, input: { note?: string | null }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const result = await sendToQs(client, workspaceId, caseId, input, userId);
      if (!result.replayed) await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.finishes_sent_to_qs.v1", entityType: "pre_project_case", entityId: caseId,
        after: { number: result.number, finishes: result.count, changed: result.changed ?? [], note: input.note?.trim() || null } });
      return { ...await this.view(client, workspaceId, caseId, userId), sent: { number: result.number, replayed: result.replayed } };
    });
  }

  /** PLM-148: the client's signed sample or data sheet, recorded by the designer (a photo and the day). */
  recordSignature(actor: RequestActor, workspaceId: string, caseId: string, entryId: string, input: { id: string; versionId: string; signedOn: string; signer: string; assetId: string; note?: string | null }) {
    return this.access.withAnyPermission(actor, workspaceId, [EDIT, CLIENT], async (client, user) => {
      await this.writable(client, workspaceId, caseId, user.userId);
      const result = await recordSignature(client, workspaceId, caseId, entryId, input, user.userId);
      if (!result.replayed) await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "design.finish_signature_recorded.v1", entityType: "design_ledger_entry", entityId: entryId,
        after: { signatureId: input.id, versionId: input.versionId, signedOn: input.signedOn, signer: input.signer.trim(), assetId: input.assetId } });
      return this.view(client, workspaceId, caseId, user.userId);
    });
  }

  /** PLM-156: the lead designer shares the sample log and photos with the factory. */
  share(actor: RequestActor, workspaceId: string, caseId: string, input: { note?: string | null }) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      await this.writable(client, workspaceId, caseId, user.userId, false);
      if (!(await this.shares(client, workspaceId, caseId, user.userId))) throw new ForbiddenException("The lead designer shares the sample log with the factory.");
      const result = await shareWithFactory(client, workspaceId, caseId, input, user.userId);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "design.finishes_shared_with_factory.v1", entityType: "pre_project_case", entityId: caseId,
        after: { number: result.number, told: result.told, note: input.note?.trim() || null } });
      return this.view(client, workspaceId, caseId, user.userId);
    });
  }

  // ---------- the quotation (PLM-146) ----------

  /** Marks a draft main quotation as a budget range the client asked for, or takes the mark off. */
  budgetRange(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, input: { budgetRange: boolean; note?: string | null }) {
    return this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], async (client, user) => {
      await this.writable(client, workspaceId, caseId, user.userId, false);
      if (await setBudgetRange(client, workspaceId, caseId, quoteId, input, user.userId))
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: input.budgetRange ? "quotation.budget_range_marked.v1" : "quotation.budget_range_removed.v1",
          entityType: "commercial_case", entityId: caseId, after: { quoteId, note: input.note?.trim() || null } });
      return { ok: true };
    });
  }

  // ---------- settings and the sample library (PLM-157) ----------

  settings(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, [VIEW, "catalog.view", "workspace.settings.manage"], async (client, user) => ({
      settings: await finishSettings(client, workspaceId), bands: await priceBands(client, workspaceId), currency: await workspaceCurrency(client, workspaceId),
      canManage: await this.access.hasPermission(client, workspaceId, user.userId, "workspace.settings.manage"),
    }));
  }

  saveSettings(actor: RequestActor, workspaceId: string, input: { version: number; categories?: unknown; specificationGate?: unknown; finishesToQsDays?: unknown; materialEditorSlots?: unknown; bands?: unknown }) {
    return this.access.withPermission(actor, workspaceId, "workspace.settings.manage", async (client, user) => {
      const { before, after } = await saveFinishSettings(client, workspaceId, input, user.userId);
      const bands = input.bands !== undefined ? await saveBands(client, workspaceId, input.bands) : await priceBands(client, workspaceId);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "workspace.finish_settings_changed.v1", entityType: "workspace", entityId: workspaceId,
        before: { categories: before.categories, specificationGate: before.specificationGate, finishesToQsDays: before.finishesToQsDays, materialEditorSlots: before.materialEditorSlots },
        after: { categories: after.categories, specificationGate: after.specificationGate, finishesToQsDays: after.finishesToQsDays, materialEditorSlots: after.materialEditorSlots,
          bands: bands.map((band) => band.label) } });
      return { settings: after, bands, currency: await workspaceCurrency(client, workspaceId), canManage: true };
    });
  }

  samples(actor: RequestActor, workspaceId: string, query: { q?: string; band?: string; category?: string; archived?: string }) {
    return this.access.withAnyPermission(actor, workspaceId, [VIEW, "catalog.view", "stock.view"], async (client, user) => ({
      samples: await listSamples(client, workspaceId, { search: query.q ?? "", bandId: query.band && /^[0-9a-f-]{36}$/i.test(query.band) ? query.band : null,
        categoryKey: query.category && /^[a-z][a-z0-9_]{0,39}$/.test(query.category) ? query.category : null, archived: query.archived === "1" }),
      bands: await priceBands(client, workspaceId), categories: (await finishSettings(client, workspaceId)).categories, currency: await workspaceCurrency(client, workspaceId),
      canManage: await this.access.hasPermission(client, workspaceId, user.userId, SAMPLES),
    }));
  }

  saveSample(actor: RequestActor, workspaceId: string, input: SampleInput) {
    return this.access.withPermission(actor, workspaceId, SAMPLES, async (client, user) => {
      const result = await saveSample(client, workspaceId, input, user.userId);
      if (result.changed) await recordAudit(client, { workspaceId, actorUserId: user.userId, action: result.created ? "catalog.sample_added.v1" : "catalog.sample_changed.v1",
        entityType: "material_sample", entityId: input.id, after: { name: result.sample.name, priceBand: result.sample.priceBandLabel, inStock: result.sample.inStock } });
      return result.sample;
    });
  }

  archiveSample(actor: RequestActor, workspaceId: string, id: string, input: { version: number }) {
    return this.access.withPermission(actor, workspaceId, SAMPLES, async (client, user) => {
      if (await archiveSample(client, workspaceId, id, input.version, user.userId))
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.sample_archived.v1", entityType: "material_sample", entityId: id, after: {} });
      return readSample(client, workspaceId, id);
    });
  }

  /** A sample's photo (one per sample; a new one replaces it). The same file again changes nothing. */
  async samplePhoto(actor: RequestActor, workspaceId: string, id: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    if (!prepared.mimeType.startsWith("image/")) throw new BadRequestException("Choose a photo (JPG, PNG or WebP).");
    return this.access.withPermission(actor, workspaceId, SAMPLES, async (client, user) => {
      const current = (await client.query<{ sha: string | null }>(`SELECT photo_sha256 AS sha FROM material_samples WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id])).rows[0];
      if (!current) throw new NotFoundException("Sample not found.");
      if (current.sha === prepared.digest) return readSample(client, workspaceId, id);
      const key = `samples/${workspaceId}/${id}/${prepared.digest.slice(0, 16)}`;
      await this.storage.put(`${key}/original`, prepared.body, prepared.mimeType);
      if (prepared.preview) await this.storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
      await client.query(`UPDATE material_samples SET photo_name = $3, photo_mime = $4, photo_key = $5, photo_preview_key = $6, photo_sha256 = $7, updated_by = $8, updated_at = now(), version = version + 1
                           WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, prepared.name, prepared.mimeType, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null, prepared.digest, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.sample_photo_added.v1", entityType: "material_sample", entityId: id, after: { name: prepared.name } });
      return readSample(client, workspaceId, id);
    });
  }

  readSamplePhoto(actor: RequestActor, workspaceId: string, id: string, preview: boolean) {
    return this.access.withAnyPermission(actor, workspaceId, [VIEW, "catalog.view", "stock.view", "factory.view"], async (client) => {
      const row = (await client.query<{ name: string | null; mime: string | null; key: string | null; previewKey: string | null }>(
        `SELECT photo_name AS name, photo_mime AS mime, photo_key AS key, photo_preview_key AS "previewKey" FROM material_samples WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      if (!row?.key) throw new NotFoundException("This sample has no photo.");
      const key = preview && row.previewKey ? row.previewKey : row.key;
      const stored = await this.storage.read(key).catch(() => { throw new NotFoundException("This photo could not be found in storage."); });
      return { body: stored.body, contentType: key === row.previewKey ? "image/webp" : row.mime ?? "application/octet-stream", name: row.name ?? "Sample" };
    });
  }

  // ---------- internals ----------

  private async view(client: PoolClient, workspaceId: string, caseId: string, userId: string) {
    return { ...await readSchedule(client, workspaceId, caseId), ...await this.rights(client, workspaceId, caseId, userId), caseId };
  }

  /** What this person may do on the case's schedule. */
  private async rights(client: PoolClient, workspaceId: string, caseId: string, userId: string) {
    const granted = await this.access.grantedPermissions(client, workspaceId, userId, [EDIT, MATERIALS, CLIENT, LIFECYCLE]);
    return {
      canEdit: granted.has(EDIT), canManageMaterials: granted.has(EDIT) || granted.has(MATERIALS), canSendToQs: granted.has(EDIT),
      canRecordSignature: granted.has(EDIT) || granted.has(CLIENT), canShare: await this.shares(client, workspaceId, caseId, userId),
    };
  }

  /** The lead designer of the job shares with the factory; so does someone who runs Planning (when nobody leads it, or to cover). */
  private async shares(client: PoolClient, workspaceId: string, caseId: string, userId: string) {
    if (await this.access.hasPermission(client, workspaceId, userId, LIFECYCLE)) return true;
    const membership = (await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId])).rows[0]?.id;
    return Boolean(membership && membership === await leadDesigner(client, workspaceId, caseId));
  }

  private async caseOfProject(client: PoolClient, workspaceId: string, projectId: string) {
    const project = (await client.query<{ caseId: string }>(`SELECT case_id AS "caseId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0];
    if (!project) throw new NotFoundException("Project not found.");
    return project.caseId;
  }

  private async case(client: PoolClient, workspaceId: string, caseId: string, lock = true) {
    const found = await client.query<{ status: string }>(`SELECT status FROM pre_project_cases WHERE workspace_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [workspaceId, caseId]);
    if (!found.rowCount) throw new NotFoundException("Case not found");
    return found.rows[0];
  }

  /** A case takes changes while it runs (a released case: the project exists, the schedule keeps being updated). */
  private async writable(client: PoolClient, workspaceId: string, caseId: string, userId: string, lock = true) {
    void userId;
    if (!["active", "released"].includes((await this.case(client, workspaceId, caseId, lock)).status)) throw new ConflictException("Reactivate the case first");
  }

  private edit<T>(actor: RequestActor, workspaceId: string, caseId: string, work: (client: PoolClient, userId: string) => Promise<T>) {
    return this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], async (client, user) => {
      await this.writable(client, workspaceId, caseId, user.userId);
      return work(client, user.userId);
    });
  }

  /** The material log: whoever edits the case, or keeps materials and samples on cases (the Material Coordinator). */
  private materials<T>(actor: RequestActor, workspaceId: string, caseId: string, work: (client: PoolClient, userId: string) => Promise<T>) {
    return this.access.withAnyPermission(actor, workspaceId, [EDIT, MATERIALS], async (client, user) => {
      if (!(await this.access.hasPermission(client, workspaceId, user.userId, VIEW))) throw new ForbiddenException(`Permissions required: ${VIEW}`);
      await this.writable(client, workspaceId, caseId, user.userId);
      return work(client, user.userId);
    });
  }
}

const READ_ONLY = { canEdit: false, canManageMaterials: false, canSendToQs: false, canRecordSignature: false, canShare: false };
