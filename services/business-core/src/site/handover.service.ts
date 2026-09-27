import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { caseOf, tellClients } from "../client-portal/portal-notices";
import { canonicalHash } from "../crm/shared/crm-types";
import { notifyUserInApp } from "../notifications/default-templates";
import { membershipOf, readProject } from "../project-core/project-core.store";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { decideHandoverPack, handedOver } from "./handover";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ["drawing", "warranty", "manual", "care_guide", "photo", "other"] as const;
const METHODS = ["signed_document", "in_person", "email", "portal"] as const;

type Pack = {
  id: string; revision: number; title: string; areaIds: string[]; status: "draft" | "issued" | "accepted" | "refused"; replacesId: string | null; contentHash: string | null;
  issuedAt: string | null; issuedByName: string | null; decidedOn: string | null; decidedByName: string | null; decisionMethod: string | null; decisionNote: string; version: number;
  documents: Array<{ id: string; kind: string; title: string; name: string; size: number; sha256: string }>;
};

/**
 * Handover packs: what the client receives, for the whole project or some of its areas. Issuing freezes
 * a revision; the client accepts it (minor items outstanding become snags, and no critical snag may be
 * open in its areas) or refuses it with why (a snag, and a new revision to issue).
 */
@Injectable()
export class HandoverService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  state(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.read(client, workspaceId, projectId, user.userId));
  }

  command(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const who = await this.who(client, workspaceId, projectId, user.userId);
      if (!who.manager) throw new ForbiddenException("Only the project manager prepares and records the handover.");
      if (!["active", "on_hold"].includes(who.status)) throw new ConflictException("The project is closed.");
      await client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, projectId]);
      const action = String(body.action ?? "");
      const areas = await this.areas(client, workspaceId, projectId);
      const areaIds = (value: unknown) => {
        const ids = Array.isArray(value) ? [...new Set(value.map((item) => uuid(item, "Area")))] : [];
        if (ids.some((id) => !areas.some((area) => area.id === id))) throw new BadRequestException("Choose the project's areas.");
        return ids;
      };
      let audit: Record<string, unknown> = {};
      if (action === "create_pack") {
        const id = uuid(body.id, "Pack");
        if ((await client.query(`SELECT 1 FROM handover_packs WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) return this.read(client, workspaceId, projectId, user.userId);
        const title = text(body.title, 200);
        if (!title) throw new BadRequestException("Name the pack.");
        const revision = (await client.query<{ next: number }>(`SELECT coalesce(max(revision), 0) + 1 AS next FROM handover_packs WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0].next;
        await client.query(`INSERT INTO handover_packs (id, workspace_id, project_id, revision, title, area_ids, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, workspaceId, projectId, revision, title, areaIds(body.areaIds), user.userId]);
        audit = { packId: id, revision };
      } else {
        const pack = (await this.packs(client, workspaceId, projectId, uuid(body.packId, "Pack")))[0];
        if (!pack) throw new NotFoundException("Handover pack not found.");
        if (body.version !== pack.version) throw new ConflictException("This pack changed elsewhere. Reload to see it.");
        const bump = () => client.query(`UPDATE handover_packs SET version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, pack.id]);
        if (action === "update_pack" || action === "remove_document" || action === "issue") {
          if (pack.status !== "draft") throw new ConflictException("An issued pack doesn't change; a refusal makes a new revision.");
        } else if (pack.status !== "issued") throw new ConflictException("Only an issued pack is accepted or refused.");
        if (action === "update_pack") {
          const title = text(body.title, 200);
          if (!title) throw new BadRequestException("Name the pack.");
          await client.query(`UPDATE handover_packs SET title = $3, area_ids = $4, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, pack.id, title, areaIds(body.areaIds)]);
        } else if (action === "remove_document") {
          await client.query(`DELETE FROM handover_documents WHERE workspace_id = $1 AND pack_id = $2 AND id = $3`, [workspaceId, pack.id, uuid(body.documentId, "Document")]);
          await bump();
        } else if (action === "issue") {
          if (!pack.documents.length) throw new ConflictException("Add the documents the client receives first.");
          // The revision as issued: what's in it, fingerprinted; it never changes after.
          const snapshot = { title: pack.title, revision: pack.revision, areas: areas.filter((area) => pack.areaIds.includes(area.id)).map((area) => area.name),
            documents: pack.documents.map(({ kind, title, name, size, sha256 }) => ({ kind, title, name, size, sha256 })) };
          await client.query(`UPDATE handover_packs SET status = 'issued', snapshot = $3::jsonb, content_hash = $4, issued_by = $5, issued_at = now(), version = version + 1
            WHERE workspace_id = $1 AND id = $2`, [workspaceId, pack.id, JSON.stringify(snapshot), canonicalHash(snapshot), user.userId]);
          audit = { packId: pack.id, revision: pack.revision, hash: canonicalHash(snapshot) };
          // The client's decision-makers hear the handover is ready for them to accept.
          await tellClients(client, { workspaceId, caseId: await caseOf(client, workspaceId, projectId), event: "decision_waiting", recordId: `handover:${pack.id}`,
            title: `${pack.title} (R${pack.revision})` });
        } else if (action === "accept" || action === "refuse") {
          const decidedOn = date(body.decidedOn, "Date");
          const decidedByName = text(body.decidedByName, 200);
          if (!decidedByName) throw new BadRequestException("Say who decided for the client.");
          const method = oneOf(body.method, METHODS, "How");
          if (action === "accept") {
            const outstanding = Array.isArray(body.outstanding) ? body.outstanding.map((item) => text(item, 300)).filter(Boolean) : [];
            const decided = await decideHandoverPack(client, workspaceId, projectId, pack, { decision: "accept", decidedOn, decidedByName, method, outstanding, reason: "",
              recordedBy: user.userId, grantId: null, staffId: user.userId });
            await this.tell(client, workspaceId, projectId, "handover.accepted", user.userId,
              `${decidedByName} accepted R${pack.revision}${outstanding.length ? ` with ${outstanding.length} item${outstanding.length === 1 ? "" : "s"} outstanding` : ""}.`, `accepted:${pack.id}`);
            audit = { packId: pack.id, outstanding: outstanding.length, warrantyStarted: decided.warrantyStarted };
          } else {
            const reason = text(body.reason, 1000);
            if (!reason) throw new BadRequestException("Say why the client refused it.");
            const decided = await decideHandoverPack(client, workspaceId, projectId, pack, { decision: "refuse", decidedOn, decidedByName, method, outstanding: [], reason,
              recordedBy: user.userId, grantId: null, staffId: user.userId });
            await this.tell(client, workspaceId, projectId, "handover.refused", user.userId, reason, `refused:${pack.id}`);
            audit = { packId: pack.id, reason, next: decided.next };
          }
        } else throw new BadRequestException("Unknown action.");
        if (!Object.keys(audit).length) audit = { packId: pack.id };
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `handover.${action}`, entityType: "project", entityId: projectId, after: audit });
      return this.read(client, workspaceId, projectId, user.userId);
    });
  }

  /** A document for a draft pack (a PDF or image, up to the upload limit); replayed safely by its id. */
  async uploadDocument(actor: RequestActor, workspaceId: string, projectId: string, packId: string, documentId: string, meta: { kind?: string; title?: string }, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    if (!prepared.mimeType.startsWith("image/") && prepared.mimeType !== "application/pdf") throw new BadRequestException("Choose a PDF or a photo.");
    const storage = this.storage;
    if (!storage) throw new ConflictException("Files can't be stored here yet.");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const who = await this.who(client, workspaceId, projectId, user.userId);
      if (!who.manager) throw new ForbiddenException("Only the project manager prepares the handover.");
      const pack = (await client.query<{ status: string }>(`SELECT status FROM handover_packs WHERE workspace_id = $1 AND id = $2 AND project_id = $3 FOR UPDATE`,
        [workspaceId, uuid(packId, "Pack"), projectId])).rows[0];
      if (!pack) throw new NotFoundException("Handover pack not found.");
      if (pack.status !== "draft") throw new ConflictException("An issued pack doesn't change.");
      const id = uuid(documentId, "Document");
      const existing = (await client.query<{ sha256: string }>(`SELECT sha256 FROM handover_documents WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      if (existing && existing.sha256 !== prepared.digest) throw new ConflictException("This upload id belongs to another file.");
      if (!existing) {
        const kind = oneOf(meta.kind ?? "other", KINDS, "Kind");
        const title = text(meta.title, 200) || prepared.name;
        const key = `handover/${workspaceId}/${id}`;
        await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
        await client.query(
          `INSERT INTO handover_documents (id, workspace_id, pack_id, kind, title, original_name, mime_type, byte_size, object_key, sha256, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [id, workspaceId, packId, kind, title, prepared.name, prepared.mimeType, prepared.body.length, `${key}/original`, prepared.digest, user.userId]);
        await client.query(`UPDATE handover_packs SET version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, packId]);
      }
      return this.read(client, workspaceId, projectId, user.userId);
    });
  }

  document(actor: RequestActor, workspaceId: string, projectId: string, documentId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.who(client, workspaceId, projectId, user.userId);
      const row = (await client.query<{ objectKey: string; mimeType: string }>(
        `SELECT document.object_key AS "objectKey", document.mime_type AS "mimeType" FROM handover_documents document
           JOIN handover_packs pack ON pack.workspace_id = document.workspace_id AND pack.id = document.pack_id
          WHERE document.workspace_id = $1 AND document.id = $2 AND pack.project_id = $3`, [workspaceId, uuid(documentId, "Document"), projectId])).rows[0];
      if (!row || !this.storage) throw new NotFoundException("Document not found.");
      const stored = await this.storage.read(row.objectKey).catch(() => null);
      if (!stored) throw new NotFoundException("Document not found.");
      return { body: stored.body, contentType: row.mimeType };
    });
  }

  // ---------- helpers ----------
  private async read(client: Db, workspaceId: string, projectId: string, userId: string) {
    const who = await this.who(client, workspaceId, projectId, userId);
    const areas = await this.areas(client, workspaceId, projectId);
    const packs = await this.packs(client, workspaceId, projectId);
    return { packs, areas, covered: handedOver(packs, areas.map((area) => area.id)), canManage: who.manager && ["active", "on_hold"].includes(who.status) };
  }

  private async packs(client: Db, workspaceId: string, projectId: string, id: string | null = null): Promise<Pack[]> {
    const rows = (await client.query<Omit<Pack, "documents">>(
      `SELECT pack.id, pack.revision, pack.title, pack.area_ids AS "areaIds", pack.status, pack.replaces_id AS "replacesId", pack.content_hash AS "contentHash", pack.issued_at AS "issuedAt",
              issuer.display_name AS "issuedByName", pack.decided_on::text AS "decidedOn", pack.decided_by_name AS "decidedByName", pack.decision_method AS "decisionMethod",
              pack.decision_note AS "decisionNote", pack.version
         FROM handover_packs pack LEFT JOIN users issuer ON issuer.id = pack.issued_by
        WHERE pack.workspace_id = $1 AND pack.project_id = $2 AND ($3::uuid IS NULL OR pack.id = $3) ORDER BY pack.revision DESC`, [workspaceId, projectId, id])).rows;
    const documents = (await client.query<{ packId: string; id: string; kind: string; title: string; name: string; size: number; sha256: string }>(
      `SELECT pack_id AS "packId", id, kind, title, original_name AS name, byte_size AS size, sha256 FROM handover_documents WHERE workspace_id = $1 AND pack_id = ANY($2::uuid[]) ORDER BY created_at`,
      [workspaceId, rows.map((row) => row.id)])).rows;
    return rows.map((row) => ({ ...row, documents: documents.filter((document) => document.packId === row.id).map(({ packId: _packId, ...document }) => document) }));
  }

  private async areas(client: Db, workspaceId: string, projectId: string) {
    return (await client.query<{ id: string; name: string }>(
      `SELECT room.id, room.name FROM pre_project_rooms room JOIN delivery_projects project ON project.workspace_id = room.workspace_id AND project.case_id = room.case_id
        WHERE room.workspace_id = $1 AND project.id = $2 ORDER BY room.name`, [workspaceId, projectId])).rows;
  }

  private async who(client: Db, workspaceId: string, projectId: string, userId: string) {
    const project = await readProject(client, workspaceId, projectId);
    if (!project) throw new NotFoundException("Project not found.");
    const all = await this.access.hasPermission(client, workspaceId, userId, "projects.manage");
    if (!all && !(await this.access.hasPermission(client, workspaceId, userId, "projects.view"))) throw new ForbiddenException("You don't have access to projects.");
    const membershipId = await membershipOf(client, workspaceId, userId);
    const assignment = (await client.query<{ lead: boolean }>(
      `SELECT is_manager AS lead FROM project_assignments WHERE workspace_id = $1 AND project_id = $2 AND membership_id = $3 AND active`, [workspaceId, projectId, membershipId])).rows[0];
    if (!all && !assignment) throw new NotFoundException("Project not found.");
    return { manager: all || Boolean(assignment?.lead), status: project.status };
  }

  private async tell(client: Db, workspaceId: string, projectId: string, code: string, actorId: string, note: string, key: string) {
    const facts = (await client.query<{ title: string }>(`SELECT reference || ' · ' || name AS title FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0];
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "";
    const team = (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active`, [workspaceId, projectId])).rows.map((row) => row.userId);
    for (const userId of team.filter((id) => id !== actorId))
      await notifyUserInApp(client, { workspaceId, recipientUserId: userId, code, eventType: code, variables: { title: facts?.title ?? "", clientName: "", actor, note: note.slice(0, 480) },
        deepLink: `/workspace/projects/${projectId}/handover`, idempotencyKey: `${code}:${key}:${userId}` });
  }
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} isn't valid.`);
  return value;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new BadRequestException(`Choose ${label.toLowerCase()}.`);
  return value as T;
}

function date(value: unknown, label: string) {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} isn't a valid date.`);
  return value;
}
