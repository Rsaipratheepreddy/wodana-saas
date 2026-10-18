import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import sharp from "sharp";
import { RequestActor } from "../auth/actor";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { HrmsAccessService, HrmsContext } from "./hrms-access.service";
import { DocumentDto, SiteAccessDto, VersionDto } from "./hrms.dto";
import { dateOnly, localDate } from "./hrms-domain";

type Db = Pick<PoolClient, "query">;
export const DOCUMENT_KINDS = ["identity", "work_permit", "residence", "licence", "insurance", "safety_induction", "medical", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export type DocumentUpload = { buffer: Buffer; size: number; mimetype: string; originalname?: string };
/** Days before expiry that count as "expiring". */
export const EXPIRING_DAYS = 30;

export type Subject = { kind: "member" | "worker"; id: string };
export type Clearance = {
  subject: Subject; name: string; detail: string; cleared: boolean; missing: DocumentKind[]; expired: DocumentKind[];
  documents: Array<{ kind: DocumentKind; title: string; number: string; expiresOn: string | null }>;
};

/** A document's standing on a day: valid, expiring within 30 days, or expired. */
export function documentStatus(expiresOn: string | null, today: string) {
  if (!expiresOn) return "valid" as const;
  if (expiresOn < today) return "expired" as const;
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + EXPIRING_DAYS * 86_400_000).toISOString().slice(0, 10);
  return expiresOn <= soon ? ("expiring" as const) : ("valid" as const);
}

/**
 * Who is cleared for site on a day: each person needs, for every kind the workspace requires, a
 * document of that kind that hasn't expired. With nothing required, everyone is cleared.
 */
export async function clearance(db: Db, workspaceId: string, subjects: Subject[], day: string): Promise<Clearance[]> {
  if (!subjects.length) return [];
  const required = ((await db.query<{ kinds: DocumentKind[] }>(`SELECT site_documents::text[] AS kinds FROM hrms_settings WHERE workspace_id=$1`, [workspaceId])).rows[0]?.kinds ?? []);
  const members = subjects.filter((subject) => subject.kind === "member").map((subject) => subject.id);
  const workers = subjects.filter((subject) => subject.kind === "worker").map((subject) => subject.id);
  const people = (await db.query<{ kind: "member" | "worker"; id: string; name: string; detail: string }>(
    `SELECT 'member' AS kind, member.id, person.display_name AS name, coalesce(employee.designation, '') AS detail
       FROM workspace_memberships member JOIN users person ON person.id = member.user_id
       LEFT JOIN hrms_employees employee ON employee.workspace_id = member.workspace_id AND employee.membership_id = member.id
      WHERE member.workspace_id=$1 AND member.id = ANY($2::uuid[])
     UNION ALL
     SELECT 'worker', worker.id, worker.name, worker.trade || coalesce(' · ' || crew.name, '')
       FROM hrms_workers worker LEFT JOIN hrms_crews crew ON crew.workspace_id = worker.workspace_id AND crew.id = worker.crew_id
      WHERE worker.workspace_id=$1 AND worker.id = ANY($3::uuid[])`,
    [workspaceId, members, workers],
  )).rows;
  const documents = (await db.query<{ memberId: string | null; workerId: string | null; kind: DocumentKind; title: string; number: string; expiresOn: string | null }>(
    `SELECT membership_id AS "memberId", worker_id AS "workerId", kind, title, number, expires_on::text AS "expiresOn" FROM hrms_documents
      WHERE workspace_id=$1 AND (membership_id = ANY($2::uuid[]) OR worker_id = ANY($3::uuid[])) ORDER BY expires_on DESC NULLS FIRST`,
    [workspaceId, members, workers],
  )).rows;
  return people.map((person) => {
    const own = documents.filter((document) => (person.kind === "member" ? document.memberId : document.workerId) === person.id);
    const missing: DocumentKind[] = [], expired: DocumentKind[] = [];
    for (const kind of required) {
      const ofKind = own.filter((document) => document.kind === kind);
      if (!ofKind.length) missing.push(kind);
      else if (!ofKind.some((document) => documentStatus(document.expiresOn, day) !== "expired")) expired.push(kind);
    }
    return {
      subject: { kind: person.kind, id: person.id }, name: person.name, detail: person.detail,
      cleared: !missing.length && !expired.length, missing, expired,
      documents: own.filter((document) => required.includes(document.kind)).map(({ kind, title, number, expiresOn }) => ({ kind, title, number, expiresOn })),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * People's documents (plan §6.28, H3): identity papers, work permits, licences, inductions… with their
 * expiry, kept by HR (a person sees their own), and who may go to each project's site. The workspace
 * chooses which kinds a person needs on site; the site's access list shows who is cleared.
 */
@Injectable()
export class HrmsDocumentsService {
  constructor(private readonly access: HrmsAccessService, private readonly storage: BrandAssetStorageService) {}

  private async today(ctx: HrmsContext) {
    const row = (await ctx.client.query<{ zone: string | null }>(`SELECT default_timezone AS zone FROM workspaces WHERE id=$1`, [ctx.workspaceId])).rows[0];
    return localDate(new Date(), row?.zone || "UTC");
  }

  /** HR sees everyone's documents (or one person's); anyone else sees only their own. */
  documents(actor: RequestActor, workspaceId: string, query: { membershipId?: string; workerId?: string }) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const manage = ctx.permissions.has("hrms.manage");
      const membershipId = manage ? query.membershipId ?? null : ctx.membershipId;
      const workerId = manage ? query.workerId ?? null : null;
      if (!manage && query.workerId) throw new ForbiddenException("Only HR sees workers' documents.");
      const today = await this.today(ctx);
      const rows = (await ctx.client.query(
        `SELECT document.id, document.membership_id AS "membershipId", document.worker_id AS "workerId",
                coalesce(person.display_name, worker.name) AS "personName", document.kind, document.title, document.number,
                document.issued_on::text AS "issuedOn", document.expires_on::text AS "expiresOn", document.file_name AS "fileName",
                document.note, document.version, document.created_at AS "createdAt"
           FROM hrms_documents document
           LEFT JOIN workspace_memberships member ON member.workspace_id = document.workspace_id AND member.id = document.membership_id
           LEFT JOIN users person ON person.id = member.user_id
           LEFT JOIN hrms_workers worker ON worker.workspace_id = document.workspace_id AND worker.id = document.worker_id
          WHERE document.workspace_id=$1
            AND ($4 OR document.membership_id=$2)
            AND ($2::uuid IS NULL OR document.membership_id=$2) AND ($3::uuid IS NULL OR document.worker_id=$3)
          ORDER BY document.expires_on NULLS LAST, lower(coalesce(person.display_name, worker.name))`,
        [workspaceId, membershipId, workerId, manage],
      )).rows;
      const settings = (await ctx.client.query<{ kinds: string[] }>(`SELECT site_documents::text[] AS kinds FROM hrms_settings WHERE workspace_id=$1`, [workspaceId])).rows[0];
      return { documents: rows.map((row) => ({ ...row, status: documentStatus(row.expiresOn, today) })), siteDocuments: settings?.kinds ?? [], canManage: manage };
    });
  }

  saveDocument(actor: RequestActor, workspaceId: string, id: string, input: DocumentDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      if (Boolean(input.membershipId) === Boolean(input.workerId)) throw new BadRequestException("Choose one person or one worker.");
      if (input.issuedOn) dateOnly(input.issuedOn);
      if (input.expiresOn) dateOnly(input.expiresOn);
      if (input.issuedOn && input.expiresOn && input.expiresOn < input.issuedOn) throw new BadRequestException("A document expires after it's issued.");
      if (input.membershipId) await this.access.memberExists(ctx, input.membershipId);
      if (input.workerId) {
        const worker = await ctx.client.query(`SELECT 1 FROM hrms_workers WHERE workspace_id=$1 AND id=$2`, [workspaceId, input.workerId]);
        if (!worker.rowCount) throw new BadRequestException("Choose a worker from this workspace.");
      }
      const before = (await ctx.client.query(`SELECT * FROM hrms_documents WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [workspaceId, id])).rows[0];
      this.access.version(before?.version, input.version);
      if (before && (before.membership_id !== (input.membershipId ?? null) || before.worker_id !== (input.workerId ?? null)))
        throw new ConflictException("A document stays with its person.");
      await ctx.client.query(
        `INSERT INTO hrms_documents(id,workspace_id,membership_id,worker_id,kind,title,number,issued_on,expires_on,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(id) DO UPDATE SET kind=EXCLUDED.kind,title=EXCLUDED.title,number=EXCLUDED.number,issued_on=EXCLUDED.issued_on,expires_on=EXCLUDED.expires_on,
           note=EXCLUDED.note,version=hrms_documents.version+1 WHERE hrms_documents.workspace_id=EXCLUDED.workspace_id`,
        [id, workspaceId, input.membershipId ?? null, input.workerId ?? null, input.kind, input.title.trim(), input.number.trim(), input.issuedOn ?? null,
          input.expiresOn ?? null, input.note.trim(), ctx.userId],
      );
      // The number is personal data: the audit keeps that it changed, not the number.
      await this.access.audit(ctx, before ? "document_updated" : "document_added", id, { ...input, number: input.number ? "(set)" : "" },
        before ? { kind: before.kind, title: before.title, expiresOn: before.expires_on } : undefined);
      return this.one(ctx, id);
    });
  }

  private async one(ctx: HrmsContext, id: string) {
    const row = (await ctx.client.query(
      `SELECT id, membership_id AS "membershipId", worker_id AS "workerId", kind, title, number, issued_on::text AS "issuedOn", expires_on::text AS "expiresOn",
              file_name AS "fileName", note, version, created_at AS "createdAt" FROM hrms_documents WHERE workspace_id=$1 AND id=$2`,
      [ctx.workspaceId, id],
    )).rows[0];
    if (!row) throw new NotFoundException("Document not found.");
    return { ...row, status: documentStatus(row.expiresOn, await this.today(ctx)) };
  }

  /** The scan or photo of a document: a PDF or an image up to 10 MB, replacing any earlier file. */
  uploadFile(actor: RequestActor, workspaceId: string, id: string, file?: DocumentUpload) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      const document = (await ctx.client.query(`SELECT object_key, version FROM hrms_documents WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [workspaceId, id])).rows[0];
      if (!document) throw new NotFoundException("Document not found.");
      if (!file?.buffer.length || file.buffer.length > DOCUMENT_MAX_BYTES) throw new BadRequestException("Attach a PDF or an image up to 10 MB.");
      let contentType: string;
      if (file.buffer.subarray(0, 5).toString("latin1") === "%PDF-") contentType = "application/pdf";
      else {
        try {
          const meta = await sharp(file.buffer, { limitInputPixels: 40_000_000 }).metadata();
          if (!["jpeg", "png", "webp", "heif"].includes(meta.format ?? "")) throw new Error("format");
          contentType = meta.format === "png" ? "image/png" : meta.format === "webp" ? "image/webp" : meta.format === "heif" ? "image/heic" : "image/jpeg";
        } catch {
          throw new BadRequestException("Attach a PDF or an image up to 10 MB.");
        }
      }
      const name = (file.originalname ?? "document").replace(/[^\p{L}\p{N}._ -]+/gu, "").slice(0, 180) || "document";
      const key = `hrms/${workspaceId}/documents/${id}-${Date.now()}`;
      await this.storage.put(key, file.buffer, contentType);
      await ctx.client.query(
        `UPDATE hrms_documents SET object_key=$3,file_name=$4,content_type=$5,byte_size=$6,version=version+1 WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, id, key, name, contentType, file.buffer.length],
      );
      if (document.object_key) await this.storage.remove(document.object_key).catch(() => undefined);
      await this.access.audit(ctx, "document_file_attached", id, { fileName: name, contentType, byteSize: file.buffer.length });
      return this.one(ctx, id);
    });
  }

  readFile(actor: RequestActor, workspaceId: string, id: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const row = (await ctx.client.query(`SELECT membership_id, object_key, content_type, file_name FROM hrms_documents WHERE workspace_id=$1 AND id=$2`, [workspaceId, id])).rows[0];
      if (!row?.object_key) throw new NotFoundException("File not found.");
      if (!ctx.permissions.has("hrms.manage") && row.membership_id !== ctx.membershipId) throw new NotFoundException("File not found.");
      const data = await this.storage.read(row.object_key);
      return { body: data.body, contentType: row.content_type as string, fileName: row.file_name as string };
    });
  }

  removeDocument(actor: RequestActor, workspaceId: string, id: string, input: VersionDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      const before = (await ctx.client.query(`SELECT * FROM hrms_documents WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [workspaceId, id])).rows[0];
      if (!before) throw new NotFoundException("Document not found.");
      this.access.version(before.version, input.version);
      await ctx.client.query(`DELETE FROM hrms_documents WHERE workspace_id=$1 AND id=$2`, [workspaceId, id]);
      if (before.object_key) await this.storage.remove(before.object_key).catch(() => undefined);
      await this.access.audit(ctx, "document_removed", id, {}, { kind: before.kind, title: before.title, expiresOn: before.expires_on });
      return { id };
    });
  }

  /** People who may see and keep a project's access list: HR, people who run projects, and the project's managers and site supervisors. */
  private async siteRole(ctx: HrmsContext, projectId: string) {
    const project = await ctx.client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id=$1 AND id=$2`, [ctx.workspaceId, projectId]);
    if (!project.rowCount) throw new NotFoundException("Project not found.");
    if (ctx.permissions.has("hrms.manage") || ctx.permissions.has("projects.manage")) return "manage" as const;
    const assigned = (await ctx.client.query<{ manager: boolean; supervisor: boolean }>(
      `SELECT is_manager AS manager, 'site_supervisor' = ANY(role_keys) AS supervisor FROM project_assignments
        WHERE workspace_id=$1 AND project_id=$2 AND membership_id=$3 AND active`,
      [ctx.workspaceId, projectId, ctx.membershipId],
    )).rows[0];
    if (assigned?.manager) return "manage" as const;
    if (assigned?.supervisor) return "view" as const;
    throw new ForbiddenException("Only the project's managers and site supervisors see its site access.");
  }

  /** A project's site access: who was added (crews, workers, staff) and, per person, whether they're cleared today. */
  siteAccess(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const role = await this.siteRole(ctx, projectId);
      return this.siteState(ctx, projectId, role === "manage");
    });
  }

  private async siteState(ctx: HrmsContext, projectId: string, canManage: boolean) {
    const entries = (await ctx.client.query<{ id: string; crewId: string | null; workerId: string | null; membershipId: string | null; name: string }>(
      `SELECT access.id, access.crew_id AS "crewId", access.worker_id AS "workerId", access.membership_id AS "membershipId",
              coalesce(crew.name, worker.name, person.display_name) AS name
         FROM hrms_site_access access
         LEFT JOIN hrms_crews crew ON crew.workspace_id = access.workspace_id AND crew.id = access.crew_id
         LEFT JOIN hrms_workers worker ON worker.workspace_id = access.workspace_id AND worker.id = access.worker_id
         LEFT JOIN workspace_memberships member ON member.workspace_id = access.workspace_id AND member.id = access.membership_id
         LEFT JOIN users person ON person.id = member.user_id
        WHERE access.workspace_id=$1 AND access.project_id=$2 ORDER BY access.created_at`,
      [ctx.workspaceId, projectId],
    )).rows;
    const crewWorkers = (await ctx.client.query<{ id: string }>(
      `SELECT id FROM hrms_workers WHERE workspace_id=$1 AND active AND crew_id = ANY($2::uuid[])`,
      [ctx.workspaceId, entries.filter((entry) => entry.crewId).map((entry) => entry.crewId)],
    )).rows.map((row) => row.id);
    const workers = [...new Set([...crewWorkers, ...entries.filter((entry) => entry.workerId).map((entry) => entry.workerId!)])];
    const members = entries.filter((entry) => entry.membershipId).map((entry) => entry.membershipId!);
    const today = await this.today(ctx);
    const people = await clearance(ctx.client, ctx.workspaceId, [...members.map((id) => ({ kind: "member" as const, id })), ...workers.map((id) => ({ kind: "worker" as const, id }))], today);
    const required = (await ctx.client.query<{ kinds: string[] }>(`SELECT site_documents::text[] AS kinds FROM hrms_settings WHERE workspace_id=$1`, [ctx.workspaceId])).rows[0]?.kinds ?? [];
    return { projectId, day: today, required, entries, people, canManage };
  }

  addSiteAccess(actor: RequestActor, workspaceId: string, input: SiteAccessDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      if ((await this.siteRole(ctx, input.projectId)) !== "manage") throw new ForbiddenException("Only the project's managers change its site access.");
      if ([input.crewId, input.workerId, input.membershipId].filter(Boolean).length !== 1) throw new BadRequestException("Add one crew, worker or person.");
      if (input.membershipId) await this.access.memberExists(ctx, input.membershipId);
      if (input.crewId && !(await ctx.client.query(`SELECT 1 FROM hrms_crews WHERE workspace_id=$1 AND id=$2`, [workspaceId, input.crewId])).rowCount)
        throw new BadRequestException("Choose a crew from this workspace.");
      if (input.workerId && !(await ctx.client.query(`SELECT 1 FROM hrms_workers WHERE workspace_id=$1 AND id=$2`, [workspaceId, input.workerId])).rowCount)
        throw new BadRequestException("Choose a worker from this workspace.");
      const added = await ctx.client.query<{ id: string }>(
        `INSERT INTO hrms_site_access(workspace_id,project_id,crew_id,worker_id,membership_id,added_by) VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT (workspace_id, project_id, coalesce(crew_id, worker_id, membership_id)) DO NOTHING RETURNING id`,
        [workspaceId, input.projectId, input.crewId ?? null, input.workerId ?? null, input.membershipId ?? null, ctx.userId],
      );
      if (added.rowCount) await this.access.audit(ctx, "site_access_added", added.rows[0].id, { ...input });
      return this.siteState(ctx, input.projectId, true);
    });
  }

  removeSiteAccess(actor: RequestActor, workspaceId: string, id: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const entry = (await ctx.client.query<{ projectId: string }>(`SELECT project_id AS "projectId" FROM hrms_site_access WHERE workspace_id=$1 AND id=$2`, [workspaceId, id])).rows[0];
      if (!entry) throw new NotFoundException("Not on this site's list.");
      if ((await this.siteRole(ctx, entry.projectId)) !== "manage") throw new ForbiddenException("Only the project's managers change its site access.");
      await ctx.client.query(`DELETE FROM hrms_site_access WHERE workspace_id=$1 AND id=$2`, [workspaceId, id]);
      await this.access.audit(ctx, "site_access_removed", id, { projectId: entry.projectId });
      return this.siteState(ctx, entry.projectId, true);
    });
  }
}
