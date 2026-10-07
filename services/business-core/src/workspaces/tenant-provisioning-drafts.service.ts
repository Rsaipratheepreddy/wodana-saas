import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import type { ProvisionTenantDto } from "./dto/provision-tenant.dto";
import type {
  CreateTenantProvisioningDraftDto, TenantContractContactDto, TenantSetupSelectionsDto,
} from "./dto/tenant-provisioning-draft.dto";
import { assertValidIdempotencyKey, provisioningRequestHash } from "./provisioning-idempotency";
import { WorkspacesService } from "./workspaces.service";

type DraftStatus = "draft" | "provisioning" | "provisioned" | "failed" | "expired";
type DraftRow = {
  id: string;
  externalTenantId: string;
  idempotencyKey: string;
  provisionIdempotencyKey: string | null;
  requestHash: string;
  account: TenantContractContactDto;
  organization: CreateTenantProvisioningDraftDto["organization"];
  owner: CreateTenantProvisioningDraftDto["owner"];
  defaults: TenantSetupSelectionsDto;
  slug: string;
  status: DraftStatus;
  version: number;
  reservationExpiresAt: Date;
  workspaceId: string | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type SetupProfile = { kind: "region" | "firm_kit" | "plan"; code: string; version: number; configuration: Record<string, unknown> };
const RESERVED_SLUGS = new Set(["admin", "api", "app", "auth", "internal", "login", "mail", "status", "support", "www", "workspace"]);

function slugFor(input: CreateTenantProvisioningDraftDto["organization"]): string {
  const slug = input.slug ?? input.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
  if (!slug || RESERVED_SLUGS.has(slug)) throw new BadRequestException("Choose a different organization login slug");
  return slug;
}

function correlationId(value?: string): string {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value : randomUUID();
}

@Injectable()
export class TenantProvisioningDraftsService {
  constructor(private readonly database: DatabaseService, private readonly workspaces: WorkspacesService) {}

  async listProfiles(): Promise<SetupProfile[]> {
    const result = await this.database.query<SetupProfile>(
      `SELECT kind, code, version, configuration FROM tenant_setup_profiles
       WHERE selectable = true AND kind IN ('region', 'firm_kit', 'plan') ORDER BY kind, code, version DESC`,
    );
    return result.rows;
  }

  async createDraft(
    input: CreateTenantProvisioningDraftDto, suppliedKey: string | undefined,
    operatorUserId: string, suppliedCorrelationId?: string,
  ) {
    let key: string;
    try { key = assertValidIdempotencyKey(suppliedKey); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    const slug = slugFor(input.organization);
    const organization = { ...input.organization, slug };
    const normalized = { ...input, organization };
    const requestHash = provisioningRequestHash(normalized);
    const auditId = correlationId(suppliedCorrelationId);
    try {
      return await this.database.transaction(async (client) => {
        for (const name of [`draft-external:${input.externalTenantId}`, `draft-key:${key}`, `slug:${slug}`].sort()) {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [name]);
        }
        const existing = await client.query<DraftRow>(
          `${this.selectDraft()} WHERE idempotency_key = $1 OR external_tenant_id = $2 LIMIT 1`,
          [key, input.externalTenantId],
        );
        if (existing.rowCount) {
          const prior = existing.rows[0];
          if (prior.idempotencyKey !== key || prior.externalTenantId !== input.externalTenantId || prior.requestHash !== requestHash) {
            throw new ConflictException("Draft key or external tenant ID already belongs to a different request");
          }
          return { ...this.publicDraft(prior), replayed: true };
        }
        const alreadyProvisioned = await client.query(
          `SELECT 1 FROM tenant_provisioning_requests WHERE external_tenant_id = $1 LIMIT 1`,
          [input.externalTenantId],
        );
        if (alreadyProvisioned.rowCount) {
          throw new ConflictException("External tenant ID is already provisioned");
        }
        await this.requireProfiles(client, input.defaults);
        await client.query(
          `UPDATE tenant_provisioning_drafts SET status = 'expired', version = version + 1, updated_at = now()
           WHERE slug = $1 AND status IN ('draft', 'failed') AND reservation_expires_at <= now()`,
          [slug],
        );
        const collision = await client.query<{ taken: boolean }>(
          `SELECT wodana_internal_slug_taken($1::varchar) OR EXISTS (
             SELECT 1 FROM tenant_provisioning_drafts
             WHERE slug = $1 AND status IN ('draft', 'provisioning', 'failed', 'provisioned')
           ) AS taken`,
          [slug],
        );
        if (collision.rows[0]?.taken) throw new ConflictException("Organization login slug is already reserved");
        const inserted = await client.query<DraftRow>(
          `INSERT INTO tenant_provisioning_drafts
             (external_tenant_id, idempotency_key, request_hash, account, organization, owner,
              defaults, slug, reservation_expires_at, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '48 hours', $9, $9)
           RETURNING id, external_tenant_id AS "externalTenantId", idempotency_key AS "idempotencyKey",
             provision_idempotency_key AS "provisionIdempotencyKey", request_hash AS "requestHash",
             account, organization, owner, defaults, slug, status, version,
             reservation_expires_at AS "reservationExpiresAt", workspace_id AS "workspaceId",
             last_error_code AS "lastErrorCode", created_at AS "createdAt", updated_at AS "updatedAt"`,
          [input.externalTenantId, key, requestHash, input.account, organization, input.owner, input.defaults, slug, operatorUserId],
        );
        await this.audit(client, operatorUserId, "tenant.draft_created", input.externalTenantId, auditId, { draftId: inserted.rows[0].id, slug });
        return { ...this.publicDraft(inserted.rows[0]), replayed: false };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException("Draft, external tenant ID or login slug already exists");
      throw error;
    }
  }

  async getDraft(id: string) {
    const result = await this.database.query<DraftRow>(`${this.selectDraft()} WHERE id = $1`, [id]);
    if (!result.rowCount) throw new NotFoundException("Provisioning draft not found");
    return this.publicDraft(result.rows[0]);
  }

  async provisionDraft(
    id: string, expectedVersion: number, suppliedKey: string | undefined,
    operatorUserId: string, suppliedCorrelationId?: string,
  ) {
    let key: string;
    try { key = assertValidIdempotencyKey(suppliedKey); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    const auditId = correlationId(suppliedCorrelationId);
    const prepared = await this.database.transaction(async (client) => {
      const found = await client.query<DraftRow>(`${this.selectDraft()} WHERE id = $1 FOR UPDATE`, [id]);
      if (!found.rowCount) throw new NotFoundException("Provisioning draft not found");
      const draft = found.rows[0];
      if (draft.provisionIdempotencyKey && draft.provisionIdempotencyKey !== key) {
        throw new ConflictException("This draft's provision command uses a different idempotency key");
      }
      if (draft.status === "provisioned") return draft;
      if (draft.status === "expired" || draft.reservationExpiresAt <= new Date()) {
        throw new ConflictException("The login slug reservation expired; create a new draft");
      }
      if (draft.version !== expectedVersion && draft.status !== "provisioning") {
        throw new ConflictException("Provisioning draft changed; reload and try again");
      }
      if (draft.status === "provisioning") return draft;
      await this.requireProfiles(client, draft.defaults);
      const updated = await client.query<DraftRow>(
        `${this.updateDraftReturning()} WHERE id = $1 RETURNING id, external_tenant_id AS "externalTenantId",
          idempotency_key AS "idempotencyKey", provision_idempotency_key AS "provisionIdempotencyKey",
          request_hash AS "requestHash", account, organization, owner, defaults, slug, status, version,
          reservation_expires_at AS "reservationExpiresAt", workspace_id AS "workspaceId",
          last_error_code AS "lastErrorCode", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, key, operatorUserId],
      );
      await this.audit(client, operatorUserId, "tenant.draft_provision_started", draft.externalTenantId, auditId,
        { draftId: id, version: updated.rows[0].version });
      return updated.rows[0];
    });
    if (prepared.status === "provisioned") {
      return { draft: this.publicDraft(prepared), tenant: await this.workspaces.getProvisionedTenant(prepared.externalTenantId), replayed: true };
    }
    const provisionInput: ProvisionTenantDto & { account: TenantContractContactDto; defaults: TenantSetupSelectionsDto } = {
      ...prepared.organization,
      externalTenantId: prepared.externalTenantId,
      owner: prepared.owner,
      account: prepared.account,
      defaults: prepared.defaults,
    };
    let tenant: Awaited<ReturnType<WorkspacesService["provisionTenant"]>>;
    try {
      tenant = await this.workspaces.provisionTenant(provisionInput, `draft:${id}`, operatorUserId, auditId);
    } catch (error) {
      await this.database.query(
        `UPDATE tenant_provisioning_drafts SET status = 'failed', version = version + 1,
           last_error_code = $2, updated_at = now(), updated_by = $3
         WHERE id = $1 AND status = 'provisioning'`,
        [id, error instanceof ConflictException ? "conflict" : "provision_failed", operatorUserId],
      ).catch(() => undefined);
      throw error;
    }
    const liveTenant = await this.workspaces.getProvisionedTenant(prepared.externalTenantId);
    const workspaceId = liveTenant.workspace.id;
    const finalized = await this.database.transaction(async (client) => {
      const updated = await client.query<DraftRow>(
        `UPDATE tenant_provisioning_drafts SET status = 'provisioned', workspace_id = $2,
           version = version + 1, last_error_code = NULL, updated_by = $3, updated_at = now()
         WHERE id = $1 AND status IN ('provisioning', 'failed')
         RETURNING id, external_tenant_id AS "externalTenantId", idempotency_key AS "idempotencyKey",
           provision_idempotency_key AS "provisionIdempotencyKey", request_hash AS "requestHash",
           account, organization, owner, defaults, slug, status, version,
           reservation_expires_at AS "reservationExpiresAt", workspace_id AS "workspaceId",
           last_error_code AS "lastErrorCode", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, workspaceId, operatorUserId],
      );
      if (!updated.rowCount) {
        const alreadyFinalized = await client.query<DraftRow>(`${this.selectDraft()} WHERE id = $1`, [id]);
        if (alreadyFinalized.rows[0]?.status === "provisioned" && alreadyFinalized.rows[0].workspaceId === workspaceId) {
          return alreadyFinalized.rows[0];
        }
        throw new ConflictException("Provisioning draft changed during finalization");
      }
      await this.audit(client, operatorUserId, "tenant.draft_provisioned", prepared.externalTenantId, auditId,
        { draftId: id, workspaceId });
      return updated.rows[0];
    });
    return { draft: this.publicDraft(finalized), tenant, replayed: tenant.replayed };
  }

  private async requireProfiles(client: PoolClient, selections: TenantSetupSelectionsDto) {
    const result = await client.query<SetupProfile>(
      `SELECT kind, code, version, configuration FROM tenant_setup_profiles
       WHERE selectable = true AND (
         (kind = 'region' AND code = $1 AND version = $2)
         OR (kind = 'firm_kit' AND code = $3 AND version = $4)
         OR (kind = 'plan' AND code = $5 AND version = $6))`,
      [selections.region.code, selections.region.version,
        selections.firmKit.code, selections.firmKit.version,
        selections.plan.code, selections.plan.version],
    );
    if (result.rowCount !== 3) throw new BadRequestException("Select published region, firm kit and plan versions");
    return result.rows;
  }

  private selectDraft() {
    return `SELECT id, external_tenant_id AS "externalTenantId", idempotency_key AS "idempotencyKey",
      provision_idempotency_key AS "provisionIdempotencyKey", request_hash AS "requestHash",
      account, organization, owner, defaults, slug, status, version,
      reservation_expires_at AS "reservationExpiresAt", workspace_id AS "workspaceId",
      last_error_code AS "lastErrorCode", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM tenant_provisioning_drafts`;
  }

  private updateDraftReturning() {
    return `UPDATE tenant_provisioning_drafts SET status = 'provisioning',
      provision_idempotency_key = COALESCE(provision_idempotency_key, $2),
      version = version + 1, last_error_code = NULL, updated_by = $3, updated_at = now()`;
  }

  private publicDraft(row: DraftRow) {
    return {
      id: row.id, externalTenantId: row.externalTenantId, account: row.account,
      organization: row.organization, owner: row.owner, defaults: row.defaults,
      slug: row.slug, status: row.status, version: row.version,
      reservationExpiresAt: row.reservationExpiresAt, workspaceId: row.workspaceId,
      lastErrorCode: row.lastErrorCode, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private audit(client: PoolClient, actor: string, action: string, targetId: string, id: string, details: Record<string, unknown>) {
    return client.query(
      `INSERT INTO platform_operator_audit (actor_user_id, action, target_type, target_id, correlation_id, details)
       VALUES ($1, $2, 'tenant', $3, $4, $5)`,
      [actor, action, targetId, id, details],
    );
  }
}
