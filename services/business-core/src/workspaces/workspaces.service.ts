import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import sharp from "sharp";
import { ActorUser, RequestActor } from "../auth/actor";
import { IdentityService } from "../auth/identity.service";
import { DatabaseService } from "../database/database.service";
import { CreateIntegrationConnectionDto } from "../integrations/dto/create-integration-connection.dto";
import { UpdateIntegrationConnectionDto } from "../integrations/dto/update-integration-connection.dto";
import { CreateBusinessUnitDto } from "./dto/create-business-unit.dto";
import { CreateTeamDto } from "./dto/create-team.dto";
import { CreateLegalEntityDto } from "./dto/create-legal-entity.dto";
import { CreateRoleDto } from "./dto/create-role.dto";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { InviteMemberDto } from "./dto/invite-member.dto";
import { ProvisionTenantDto } from "./dto/provision-tenant.dto";
import {
  CompleteOnboardingDto,
  REQUIRED_ONBOARDING_STEPS,
  UpdateOnboardingDto,
  WorkspaceOnboardingStep,
} from "./dto/update-onboarding.dto";
import { UpdateBusinessUnitDto } from "./dto/update-business-unit.dto";
import { UpdateTeamDto } from "./dto/update-team.dto";
import { UpdateCompanyProfileDto } from "./dto/update-company-profile.dto";
import { UpdateLegalEntityDto } from "./dto/update-legal-entity.dto";
import { UpdateMemberDto } from "./dto/update-member.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";
import { UpdateWorkspaceDto } from "./dto/update-workspace.dto";
import { UpdateWorkspaceSettingsDto } from "./dto/update-workspace-settings.dto";
import { UpdateWorkspaceTerminologyDto } from "./dto/update-workspace-terminology.dto";
import { WorkspaceAccessService } from "./workspace-access.service";
import { DEFAULT_CRM_AUTOMATION_TEMPLATES } from "../crm/automations/default-automation-templates";
import {
  assertValidIdempotencyKey,
  provisioningRequestHash,
} from "./provisioning-idempotency";
import { BrandAssetStorageService } from "./brand-asset-storage.service";
import {
  COMPANY_LOGO_MAX_BYTES,
  InitiateCompanyLogoUploadDto,
} from "./dto/company-logo.dto";
import { TransactionalEmailService } from "../email/transactional-email.service";
import {
  resolveWorkspaceTerminology,
  workspaceTerminologyDefault,
  type WorkspaceTerminologyOverride,
} from "./workspace-terminology";

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  default_currency: string;
  default_locale: string;
  default_timezone: string;
  unit_system: string;
  week_starts_on: number;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface LegalEntityRow {
  id: string;
  workspace_id: string;
  code: string;
  display_name: string;
  registered_name: string;
  country_code: string;
  base_currency: string;
  locale: string;
  timezone: string;
  tax_registration_number: string | null;
  registration_number: string | null;
  address: Record<string, unknown>;
  status: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface OnboardingRow {
  workspace_id: string;
  status: string;
  current_step: string;
  completed_steps: string[];
  version: number;
  started_at: Date | null;
  completed_at: Date | null;
}

interface BrandAssetRow {
  id: string;
  workspace_id: string;
  object_key: string;
  original_filename: string;
  mime_type: string;
  expected_byte_size: number;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  variants: Record<string, string>;
  status: string;
  upload_expires_at: Date;
  updated_at: Date;
}

const SYSTEM_ROLES = [
  ["owner", "Owner", "Full workspace ownership"],
  ["administrator", "Administrator", "Manage workspace operations"],
  ["member", "Member", "Standard workspace access"],
  ["viewer", "Viewer", "Read-only workspace access"],
] as const;

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly identities: IdentityService,
    private readonly access: WorkspaceAccessService,
    private readonly brandStorage: BrandAssetStorageService,
    private readonly transactionalEmail: TransactionalEmailService,
  ) {}

  async create(actor: RequestActor, input: CreateWorkspaceDto) {
    const actorUser = await this.identities.resolveActor(actor);
    const workspaceId = randomUUID();
    const legalEntityId = randomUUID();
    const membershipId = randomUUID();
    const slug = input.slug ?? this.toSlug(input.name);

    try {
      return await this.database.tenantTransaction(
        workspaceId,
        actorUser.userId,
        async (client) => {
          const workspace = await client.query<WorkspaceRow>(
            `INSERT INTO workspaces
              (id, name, slug, default_currency, default_locale, default_timezone,
               unit_system, week_starts_on, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [
              workspaceId,
              input.name,
              slug,
              input.defaultCurrency,
              input.defaultLocale,
              input.defaultTimezone,
              input.unitSystem,
              input.weekStartsOn,
              actorUser.userId,
            ],
          );
          await client.query(
            `INSERT INTO tenant_login_branding (workspace_id, login_slug, display_name)
             VALUES ($1, $2, $3)`,
            [workspaceId, slug, input.name],
          );

          const legalEntity = await this.insertLegalEntity(
            client,
            workspaceId,
            legalEntityId,
            input.firstLegalEntity,
          );

          await client.query(
            `INSERT INTO workspace_memberships
              (id, workspace_id, user_id, status, joined_at)
             VALUES ($1, $2, $3, 'active', now())`,
            [membershipId, workspaceId, actorUser.userId],
          );

          const roleIds = await this.insertSystemRoles(client, workspaceId);
          await client.query(
            `INSERT INTO member_roles (workspace_id, membership_id, role_id)
             VALUES ($1, $2, $3)`,
            [workspaceId, membershipId, roleIds.get("owner")],
          );

          await this.insertOnboarding(client, workspaceId);
          await this.insertDefaultSequences(client, workspaceId, legalEntityId, input.firstLegalEntity.code);
          await this.insertDefaultCrmAutomations(client, workspaceId);
          await client.query(
            `INSERT INTO workspace_subscriptions (workspace_id, currency, renews_at)
             VALUES ($1, $2, now() + interval '14 days')`,
            [workspaceId, input.defaultCurrency],
          );
          await this.recordChange(client, {
            workspaceId,
            actorUserId: actorUser.userId,
            action: "workspace.created",
            entityType: "workspace",
            entityId: workspaceId,
            after: this.mapWorkspace(workspace.rows[0]),
          });

          return {
            workspace: this.mapWorkspace(workspace.rows[0]),
            legalEntities: [this.mapLegalEntity(legalEntity)],
            membership: { id: membershipId, role: "owner", status: "active" },
          };
        },
      );
    } catch (error) {
      this.rethrowConstraint(error, "A workspace or legal entity with this code already exists");
    }
  }

  async provisionTenant(input: ProvisionTenantDto, suppliedIdempotencyKey?: string) {
    let idempotencyKey: string;
    try {
      idempotencyKey = assertValidIdempotencyKey(suppliedIdempotencyKey);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const requestHash = provisioningRequestHash(input);
    const workspaceId = randomUUID();
    const legalEntityId = randomUUID();
    const invitationId = randomUUID();
    const slug = input.slug ?? this.toSlug(input.name);

    try {
      return await this.database.transaction(async (client) => {
        const lockNames = [
          `external-tenant:${input.externalTenantId}`,
          `idempotency-key:${idempotencyKey}`,
        ].sort();
        for (const lockName of lockNames) {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockName]);
        }

        const prior = await client.query<{
          request_hash: string;
          response_body: Record<string, unknown>;
        }>(
          `SELECT request_hash, response_body
           FROM tenant_provisioning_requests
           WHERE idempotency_key = $1 OR external_tenant_id = $2
           LIMIT 1`,
          [idempotencyKey, input.externalTenantId],
        );
        if (prior.rowCount) {
          if (prior.rows[0].request_hash !== requestHash) {
            throw new ConflictException(
              "This idempotency key or external tenant ID was already used with a different request",
            );
          }
          const replay = prior.rows[0].response_body;
          return {
            ...replay,
            replayed: true,
            ownerInvitation: {
              ...(replay.ownerInvitation as Record<string, unknown>),
              invitationToken: null,
              tokenNotice: "Token omitted on replay; explicitly rotate it if the original was lost.",
            },
          };
        }

        const owner = await client.query<{ id: string }>(
          `INSERT INTO users (primary_email, display_name, preferred_locale, preferred_timezone)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (primary_email)
           DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
           RETURNING id`,
          [input.owner.email, input.owner.displayName, input.defaultLocale, input.defaultTimezone],
        );
        const ownerUserId = owner.rows[0].id;
        await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspaceId]);
        await client.query("SELECT set_config('app.current_actor_id', $1, true)", [ownerUserId]);

        const workspace = await client.query<WorkspaceRow>(
          `INSERT INTO workspaces
            (id, name, slug, default_currency, default_locale, default_timezone,
             unit_system, week_starts_on, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            workspaceId,
            input.name,
            slug,
            input.defaultCurrency,
            input.defaultLocale,
            input.defaultTimezone,
            input.unitSystem,
            input.weekStartsOn,
            ownerUserId,
          ],
        );
        await client.query(
          `INSERT INTO tenant_login_branding (workspace_id, login_slug, display_name)
           VALUES ($1, $2, $3)`,
          [workspaceId, slug, input.name],
        );
        const legalEntity = await this.insertLegalEntity(
          client,
          workspaceId,
          legalEntityId,
          input.firstLegalEntity,
        );
        const roleIds = await this.insertSystemRoles(client, workspaceId);
        const invitationToken = randomBytes(32).toString("base64url");
        const tokenHash = createHash("sha256").update(invitationToken).digest("hex");
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await client.query(
          `INSERT INTO workspace_invitations
            (id, workspace_id, email, token_hash, invited_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [invitationId, workspaceId, input.owner.email, tokenHash, ownerUserId, expiresAt],
        );
        await client.query(
          `INSERT INTO invitation_roles (workspace_id, invitation_id, role_id)
           VALUES ($1, $2, $3)`,
          [workspaceId, invitationId, roleIds.get("owner")],
        );
        const onboarding = await this.insertOnboarding(client, workspaceId);
        await this.insertDefaultSequences(
          client,
          workspaceId,
          legalEntityId,
          input.firstLegalEntity.code,
        );
        await this.insertDefaultCrmAutomations(client, workspaceId);

        const workspaceResponse = this.mapWorkspace(workspace.rows[0]);
        await client.query(
          `INSERT INTO workspace_subscriptions (workspace_id, currency, renews_at)
           VALUES ($1, $2, now() + interval '14 days')`,
          [workspaceId, input.defaultCurrency],
        );
        const legalEntityResponse = this.mapLegalEntity(legalEntity);
        const onboardingResponse = this.mapOnboarding(onboarding);
        const safeResponse = {
          externalTenantId: input.externalTenantId,
          workspace: workspaceResponse,
          legalEntity: legalEntityResponse,
          ownerInvitation: {
            id: invitationId,
            email: input.owner.email,
            role: "owner",
            status: "pending",
            expiresAt,
            acceptedAt: null,
            invitationToken: null,
            tokenNotice: "Token returned only on initial provisioning or explicit rotation.",
          },
          onboarding: onboardingResponse,
          replayed: false,
        };

        await this.recordChange(client, {
          workspaceId,
          actorUserId: null,
          source: "internal",
          action: "workspace.provisioned",
          entityType: "workspace",
          entityId: workspaceId,
          after: { ...workspaceResponse, externalTenantId: input.externalTenantId },
        });
        await this.recordChange(client, {
          workspaceId,
          actorUserId: null,
          source: "internal",
          action: "workspace.owner_invited",
          entityType: "workspace_invitation",
          entityId: invitationId,
          after: { email: input.owner.email, role: "owner", expiresAt },
        });
        await client.query(
          `INSERT INTO tenant_provisioning_requests
            (external_tenant_id, idempotency_key, request_hash, workspace_id,
             response_body, expires_at)
           VALUES ($1, $2, $3, $4, $5, now() + interval '30 days')`,
          [input.externalTenantId, idempotencyKey, requestHash, workspaceId, safeResponse],
        );

        return {
          ...safeResponse,
          ownerInvitation: {
            ...safeResponse.ownerInvitation,
            invitationToken,
            tokenNotice: "This token is returned once and is never stored in plaintext.",
          },
        };
      });
    } catch (error) {
      this.rethrowConstraint(error, "Tenant, workspace slug, or legal entity code already exists");
    }
  }

  async getProvisionedTenant(externalTenantId: string) {
    const provisioned = await this.database.query<{
      workspace_id: string;
      response_body: Record<string, unknown>;
    }>(
      `SELECT workspace_id, response_body
       FROM tenant_provisioning_requests
       WHERE external_tenant_id = $1`,
      [externalTenantId],
    );
    if (!provisioned.rowCount) throw new NotFoundException("Provisioned tenant not found");
    const workspaceId = provisioned.rows[0].workspace_id;
    const ownerInvitationId = String(
      (provisioned.rows[0].response_body.ownerInvitation as Record<string, unknown>).id,
    );
    const live = await this.database.tenantTransaction(workspaceId, workspaceId, async (client) => {
      const workspace = await this.requireWorkspace(client, workspaceId);
      const onboarding = await this.requireOnboarding(client, workspaceId);
      const invitation = await client.query<{
        id: string;
        email: string;
        status: string;
        expiresAt: Date;
        acceptedAt: Date | null;
      }>(
        `SELECT id, email,
                CASE WHEN status = 'pending' AND expires_at <= now()
                     THEN 'expired' ELSE status::text END AS status,
                expires_at AS "expiresAt", accepted_at AS "acceptedAt"
         FROM workspace_invitations
         WHERE id = $1 AND workspace_id = $2`,
        [ownerInvitationId, workspaceId],
      );
      if (!invitation.rowCount) throw new NotFoundException("Owner invitation not found");
      return {
        workspace: this.mapWorkspace(workspace),
        onboarding: this.mapOnboarding(onboarding),
        ownerInvitation: {
          ...invitation.rows[0],
          role: "owner",
          invitationToken: null,
          tokenNotice: "Tokens are exposed only when created or explicitly rotated.",
        },
      };
    });
    return {
      ...provisioned.rows[0].response_body,
      ...live,
      replayed: true,
      ownerInvitation: live.ownerInvitation,
    };
  }

  async resendProvisionedOwnerInvitation(externalTenantId: string) {
    const provisioned = await this.database.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM tenant_provisioning_requests WHERE external_tenant_id = $1`,
      [externalTenantId],
    );
    if (!provisioned.rowCount) throw new NotFoundException("Provisioned tenant not found");
    const workspaceId = provisioned.rows[0].workspace_id;
    return this.database.tenantTransaction(workspaceId, workspaceId, async (client) => {
      await this.lockWorkspace(client, workspaceId);
      const pending = await client.query<{ id: string; email: string }>(
        `SELECT invitation.id, invitation.email
         FROM workspace_invitations invitation
         JOIN invitation_roles assigned ON assigned.invitation_id = invitation.id
         JOIN roles role ON role.id = assigned.role_id
         WHERE invitation.workspace_id = $1
           AND invitation.status = 'pending'
           AND role.code = 'owner'
         ORDER BY invitation.created_at
         LIMIT 1
         FOR UPDATE OF invitation`,
        [workspaceId],
      );
      if (!pending.rowCount) {
        throw new NotFoundException("Pending owner invitation not found");
      }
      const invitationToken = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(invitationToken).digest("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await client.query(
        `UPDATE workspace_invitations
         SET token_hash = $1, expires_at = $2
         WHERE id = $3`,
        [tokenHash, expiresAt, pending.rows[0].id],
      );
      await this.recordChange(client, {
        workspaceId,
        actorUserId: null,
        source: "internal",
        action: "workspace.owner_invitation_resent",
        entityType: "workspace_invitation",
        entityId: pending.rows[0].id,
        after: { email: pending.rows[0].email, role: "owner", expiresAt },
      });
      return {
        id: pending.rows[0].id,
        email: pending.rows[0].email,
        role: "owner",
        status: "pending",
        expiresAt,
        acceptedAt: null,
        invitationToken,
        tokenNotice: "This replacement token is returned once and is never stored in plaintext.",
      };
    });
  }

  async list(actor: RequestActor) {
    const actorUser = await this.identities.resolveActor(actor);
    return this.database.actorTransaction(actorUser.userId, async (client) => {
      const result = await client.query<WorkspaceRow>(
        `SELECT workspace.*
         FROM workspaces workspace
         JOIN workspace_memberships membership ON membership.workspace_id = workspace.id
         WHERE membership.user_id = $1
           AND membership.status = 'active'
           AND workspace.status = 'active'
         ORDER BY workspace.name`,
        [actorUser.userId],
      );
      return result.rows.map((row) => this.mapWorkspace(row));
    });
  }

  async acceptInvitation(actor: RequestActor, token: string) {
    const actorUser = await this.identities.resolveActor(actor);
    const tokenHash = createHash("sha256").update(token).digest("hex");

    return this.database.invitationTransaction(
      actorUser.userId,
      tokenHash,
      async (client) => {
        const found = await client.query<{
          id: string;
          workspace_id: string;
          email: string;
          status: string;
          expires_at: Date;
        }>(
          `SELECT id, workspace_id, email, status, expires_at
           FROM workspace_invitations
           WHERE token_hash = $1`,
          [tokenHash],
        );
        if (!found.rowCount) {
          throw new NotFoundException("Invitation not found");
        }

        const discoveredInvitation = found.rows[0];
        await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [
          discoveredInvitation.workspace_id,
        ]);
        return this.acceptInvitationRecord(client, actorUser, discoveredInvitation.id);
      },
    );
  }

  async acceptInvitationById(actor: RequestActor, invitationId: string) {
    const actorUser = await this.identities.resolveActor(actor);
    return this.database.actorTransaction(actorUser.userId, async (client) => {
      const found = await client.query<{ id: string; workspace_id: string }>(
        `SELECT id, workspace_id
         FROM workspace_invitations
         WHERE id = $1`,
        [invitationId],
      );
      if (!found.rowCount) throw new NotFoundException("Invitation not found");
      await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [
        found.rows[0].workspace_id,
      ]);
      return this.acceptInvitationRecord(client, actorUser, invitationId);
    });
  }

  async getOnboarding(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["module.organization.read", "legal_entities.view"], async (client) =>
      this.mapOnboarding(await this.requireOnboarding(client, workspaceId))
    );
  }

  async updateOnboarding(
    actor: RequestActor,
    workspaceId: string,
    input: UpdateOnboardingDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.edit", "workspace.settings.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireOnboarding(client, workspaceId, true);
        if (before.status === "completed") {
          throw new ConflictException("Workspace onboarding is already complete");
        }
        const completedSteps = input.completedSteps ?? before.completed_steps;
        const removedStep = before.completed_steps.find((step) => !completedSteps.includes(
          step as WorkspaceOnboardingStep,
        ));
        if (removedStep) {
          throw new UnprocessableEntityException("Completed onboarding steps cannot be removed");
        }
        const updated = await client.query<OnboardingRow>(
          `UPDATE workspace_onboarding
           SET status = 'in_progress', current_step = $1, completed_steps = $2,
               started_at = COALESCE(started_at, now()), version = version + 1
           WHERE workspace_id = $3 AND version = $4
           RETURNING *`,
          [input.currentStep, JSON.stringify(completedSteps), workspaceId, input.version],
        );
        if (!updated.rowCount) {
          throw new ConflictException("Onboarding changed; reload and try again");
        }
        const response = this.mapOnboarding(updated.rows[0]);
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.onboarding_updated",
          entityType: "workspace_onboarding",
          entityId: workspaceId,
          before: this.mapOnboarding(before),
          after: response,
        });
        return response;
      },
    );
  }

  async completeOnboarding(
    actor: RequestActor,
    workspaceId: string,
    input: CompleteOnboardingDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.edit", "workspace.settings.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireOnboarding(client, workspaceId, true);
        if (before.status === "completed") return this.mapOnboarding(before);
        const missing = REQUIRED_ONBOARDING_STEPS.filter(
          (step) => !before.completed_steps.includes(step),
        );
        if (missing.length) {
          throw new UnprocessableEntityException({
            message: "Required onboarding steps are incomplete",
            missingSteps: missing,
          });
        }
        const updated = await client.query<OnboardingRow>(
          `UPDATE workspace_onboarding
           SET status = 'completed', current_step = 'complete', completed_at = now(),
               started_at = COALESCE(started_at, now()), version = version + 1
           WHERE workspace_id = $1 AND version = $2
           RETURNING *`,
          [workspaceId, input.version],
        );
        if (!updated.rowCount) {
          throw new ConflictException("Onboarding changed; reload and try again");
        }
        const response = this.mapOnboarding(updated.rows[0]);
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.onboarding_completed",
          entityType: "workspace_onboarding",
          entityId: workspaceId,
          before: this.mapOnboarding(before),
          after: response,
        });
        return response;
      },
    );
  }

  async get(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["module.organization.read", "legal_entities.view"], async (client) => {
      const workspace = await this.requireWorkspace(client, workspaceId);
      const entities = await client.query<LegalEntityRow>(
        `SELECT * FROM legal_entities
         WHERE workspace_id = $1 AND status = 'active'
         ORDER BY display_name`,
        [workspaceId],
      );
      const units = await client.query(
        `SELECT id, legal_entity_id AS "legalEntityId", parent_business_unit_id AS "parentBusinessUnitId",
                code, name, name AS "visibleName", type, timezone, color, status, version
         FROM business_units
         WHERE workspace_id = $1 AND status = 'active'
         ORDER BY name`,
        [workspaceId],
      );
      const branding = await client.query<{
        logoAssetId: string | null;
        logoUpdatedAt: Date | null;
      }>(
        `SELECT branding.logo_asset_id AS "logoAssetId",
                asset.updated_at AS "logoUpdatedAt"
         FROM tenant_login_branding branding
         LEFT JOIN workspace_brand_assets asset ON asset.id = branding.logo_asset_id
         WHERE branding.workspace_id = $1`,
        [workspaceId],
      );
      const terminology = await this.resolvedTerminology(client, workspaceId);
      return {
        workspace: this.mapWorkspace(workspace),
        legalEntities: entities.rows.map((row) => this.mapLegalEntity(row)),
        businessUnits: units.rows,
        branding: this.mapBranding(workspace.slug, branding.rows[0]),
        terminology: terminology.map,
      };
    });
  }

  async terminology(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, (client) =>
      this.resolvedTerminology(client, workspaceId));
  }

  async updateTerminology(
    actor: RequestActor,
    workspaceId: string,
    key: string,
    input: UpdateWorkspaceTerminologyDto,
  ) {
    const fallback = workspaceTerminologyDefault(key);
    if (!fallback) throw new BadRequestException("Choose a supported terminology key");
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.edit", "workspace.settings.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const existing = await client.query<WorkspaceTerminologyOverride>(
          `SELECT key, visible_name AS "visibleName", visible_name_plural AS "visibleNamePlural",
                  version, updated_at AS "updatedAt"
           FROM workspace_terminology
           WHERE workspace_id = $1 AND key = $2
           FOR UPDATE`,
          [workspaceId, key],
        );
        const before = resolveWorkspaceTerminology(existing.rows).items.find((item) => item.key === key)!;
        let saved;
        if (existing.rowCount) {
          if (input.version !== existing.rows[0].version) {
            throw new ConflictException("Terminology changed; reload and try again");
          }
          saved = await client.query<WorkspaceTerminologyOverride>(
            `UPDATE workspace_terminology
             SET visible_name = $1, visible_name_plural = $2, version = version + 1,
                 updated_by = $3, updated_at = now()
             WHERE workspace_id = $4 AND key = $5 AND version = $6
             RETURNING key, visible_name AS "visibleName", visible_name_plural AS "visibleNamePlural",
                       version, updated_at AS "updatedAt"`,
            [input.visibleName, input.visibleNamePlural, actorUser.userId, workspaceId, key, input.version],
          );
        } else {
          if (input.version !== 0) {
            throw new ConflictException("Terminology changed; reload and try again");
          }
          saved = await client.query<WorkspaceTerminologyOverride>(
            `INSERT INTO workspace_terminology
              (workspace_id, key, visible_name, visible_name_plural, updated_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING key, visible_name AS "visibleName", visible_name_plural AS "visibleNamePlural",
                       version, updated_at AS "updatedAt"`,
            [workspaceId, key, input.visibleName, input.visibleNamePlural, actorUser.userId],
          );
        }
        if (!saved.rowCount) throw new ConflictException("Terminology changed; reload and try again");
        const response = resolveWorkspaceTerminology(saved.rows).items.find((item) => item.key === key)!;
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.terminology_updated",
          entityType: "workspace_terminology",
          entityId: workspaceId,
          before: { ...before },
          after: { ...response },
        });
        return response;
      },
    );
  }

  async restoreTerminology(
    actor: RequestActor,
    workspaceId: string,
    key: string,
    version: number,
  ) {
    const fallback = workspaceTerminologyDefault(key);
    if (!fallback) throw new BadRequestException("Choose a supported terminology key");
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.edit", "workspace.settings.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const existing = await client.query<WorkspaceTerminologyOverride>(
          `SELECT key, visible_name AS "visibleName", visible_name_plural AS "visibleNamePlural",
                  version, updated_at AS "updatedAt"
           FROM workspace_terminology
           WHERE workspace_id = $1 AND key = $2
           FOR UPDATE`,
          [workspaceId, key],
        );
        if (!existing.rowCount || existing.rows[0].version !== version) {
          throw new ConflictException("Terminology changed; reload and try again");
        }
        const before = resolveWorkspaceTerminology(existing.rows).items.find((item) => item.key === key)!;
        const removed = await client.query(
          `DELETE FROM workspace_terminology
           WHERE workspace_id = $1 AND key = $2 AND version = $3`,
          [workspaceId, key, version],
        );
        if (!removed.rowCount) throw new ConflictException("Terminology changed; reload and try again");
        const response = resolveWorkspaceTerminology([]).items.find((item) => item.key === key)!;
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.terminology_restored",
          entityType: "workspace_terminology",
          entityId: workspaceId,
          before: { ...before },
          after: { ...response },
        });
        return response;
      },
    );
  }

  async updateCompanyProfile(
    actor: RequestActor,
    workspaceId: string,
    input: UpdateCompanyProfileDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.edit", "workspace.settings.manage", "legal_entities.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const beforeWorkspace = await this.requireWorkspace(client, workspaceId);
        const beforeEntity = await this.requireLegalEntity(
          client,
          workspaceId,
          input.legalEntityId,
        );

        try {
          const workspace = await client.query<WorkspaceRow>(
            `UPDATE workspaces
             SET name = $1, default_currency = $2,
                 default_locale = $3, default_timezone = $4,
                 unit_system = $5, week_starts_on = $6,
                 version = version + 1
             WHERE id = $7 AND version = $8
             RETURNING *`,
            [
              input.name,
              input.defaultCurrency,
              input.defaultLocale,
              input.defaultTimezone,
              input.unitSystem,
              input.weekStartsOn,
              workspaceId,
              input.workspaceVersion,
            ],
          );
          if (!workspace.rowCount) {
            throw new ConflictException("Company profile changed; reload and try again");
          }

          const legalEntity = await client.query<LegalEntityRow>(
            `UPDATE legal_entities
             SET display_name = $1,
                 registered_name = $2,
                 country_code = $3,
                 registration_number = $4,
                 tax_registration_number = $5,
                 address = $6,
                 base_currency = $7,
                 locale = $8,
                 timezone = $9,
                 version = version + 1
             WHERE id = $10
               AND workspace_id = $11
               AND version = $12
               AND status = 'active'
             RETURNING *`,
            [
              input.name,
              input.registeredName,
              input.countryCode,
              input.registrationNumber || null,
              input.taxRegistrationNumber || null,
              input.address ?? {},
              input.defaultCurrency,
              input.defaultLocale,
              input.defaultTimezone,
              input.legalEntityId,
              workspaceId,
              input.legalEntityVersion,
            ],
          );
          if (!legalEntity.rowCount) {
            throw new ConflictException("Company profile changed; reload and try again");
          }

          await client.query(
            `INSERT INTO tenant_login_branding (workspace_id, login_slug, display_name)
             VALUES ($1, $2, $3)
             ON CONFLICT (workspace_id)
             DO UPDATE SET login_slug = EXCLUDED.login_slug,
                           display_name = EXCLUDED.display_name`,
            [workspaceId, beforeWorkspace.slug, input.name],
          );

          const response = {
            workspace: this.mapWorkspace(workspace.rows[0]),
            legalEntity: this.mapLegalEntity(legalEntity.rows[0]),
          };
          await this.recordChange(client, {
            workspaceId,
            actorUserId: actorUser.userId,
            action: "workspace.company_profile_updated",
            entityType: "workspace",
            entityId: workspaceId,
            before: {
              workspace: this.mapWorkspace(beforeWorkspace),
              legalEntity: this.mapLegalEntity(beforeEntity),
            },
            after: response,
          });
          return response;
        } catch (error) {
          this.rethrowConstraint(error, "A workspace with this URL already exists");
        }
      },
    );
  }

  async initiateCompanyLogoUpload(
    actor: RequestActor,
    workspaceId: string,
    input: InitiateCompanyLogoUploadDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.edit", "workspace.settings.manage"],
      async (client, actorUser) => {
        const assetId = randomUUID();
        const objectKey = `workspace-branding/${workspaceId}/${assetId}/source`;
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        await client.query(
          `INSERT INTO workspace_brand_assets
            (id, workspace_id, object_key, original_filename, mime_type,
             expected_byte_size, created_by, upload_expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            assetId,
            workspaceId,
            objectKey,
            input.filename,
            input.mimeType,
            input.byteSize,
            actorUser.userId,
            expiresAt,
          ],
        );
        const uploadUrl = await this.brandStorage.createUploadUrl(objectKey, input.mimeType);
        return {
          assetId,
          expiresAt,
          uploadMode: uploadUrl ? "signed" : "application",
          uploadUrl,
          uploadHeaders: { "content-type": input.mimeType },
        };
      },
    );
  }

  async uploadCompanyLogoContent(
    actor: RequestActor,
    workspaceId: string,
    assetId: string,
    contentType: string,
    body: Buffer,
  ) {
    if (this.brandStorage.usesObjectStorage) {
      throw new BadRequestException("Use the signed object-storage URL for this upload");
    }
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.edit", "workspace.settings.manage"],
      async (client) => {
        const asset = await this.requirePendingBrandAsset(client, workspaceId, assetId);
        if (contentType !== asset.mime_type) throw new BadRequestException("Logo content type changed");
        if (body.byteLength !== asset.expected_byte_size) {
          throw new BadRequestException("Logo byte size changed during upload");
        }
        if (body.byteLength > COMPANY_LOGO_MAX_BYTES) {
          throw new BadRequestException("Logo must be 5 MB or smaller");
        }
        await this.brandStorage.writeLocal(asset.object_key, body);
        return { uploaded: true };
      },
    );
  }

  async completeCompanyLogoUpload(
    actor: RequestActor,
    workspaceId: string,
    assetId: string,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.edit", "workspace.settings.manage"],
      async (client, actorUser) => {
        const asset = await this.requirePendingBrandAsset(client, workspaceId, assetId);
        const stored = await this.brandStorage.read(asset.object_key).catch(() => null);
        if (!stored) throw new BadRequestException("Upload the logo before completing it");
        if (stored.byteSize !== asset.expected_byte_size || stored.byteSize > COMPANY_LOGO_MAX_BYTES) {
          throw new BadRequestException("Uploaded logo size does not match the requested file");
        }

        const metadata = await sharp(stored.body, { failOn: "warning" }).metadata().catch(() => null);
        const detectedMime = metadata?.format === "jpeg"
          ? "image/jpeg"
          : metadata?.format === "png"
            ? "image/png"
            : metadata?.format === "webp"
              ? "image/webp"
              : null;
        if (!metadata?.width || !metadata.height || detectedMime !== asset.mime_type) {
          throw new BadRequestException("The uploaded file is not a valid supported logo image");
        }
        if (metadata.width < 64 || metadata.height < 64) {
          throw new BadRequestException("Logo dimensions must be at least 64 by 64 pixels");
        }
        if (metadata.width > 4096 || metadata.height > 4096) {
          throw new BadRequestException("Logo dimensions must not exceed 4096 by 4096 pixels");
        }

        const variantPrefix = `workspace-branding/${workspaceId}/${assetId}`;
        const displayKey = `${variantPrefix}/display.webp`;
        const squareKey = `${variantPrefix}/square.webp`;
        const documentKey = `${variantPrefix}/document.png`;
        const [display, square, document] = await Promise.all([
          sharp(stored.body).rotate().resize({ width: 1024, height: 512, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer(),
          sharp(stored.body).rotate().resize({ width: 512, height: 512, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).webp({ quality: 90 }).toBuffer(),
          sharp(stored.body).rotate().resize({ width: 1024, height: 512, fit: "contain", background: "#ffffff", withoutEnlargement: true }).flatten({ background: "#ffffff" }).png().toBuffer(),
        ]);
        await Promise.all([
          this.brandStorage.put(displayKey, display, "image/webp"),
          this.brandStorage.put(squareKey, square, "image/webp"),
          this.brandStorage.put(documentKey, document, "image/png"),
        ]);
        const variants = { display: displayKey, square: squareKey, document: documentKey };

        await client.query(
          `UPDATE workspace_brand_assets SET status = 'replaced'
           WHERE workspace_id = $1 AND status = 'active' AND id <> $2`,
          [workspaceId, assetId],
        );
        const activated = await client.query<BrandAssetRow>(
          `UPDATE workspace_brand_assets
           SET status = 'active', byte_size = $1, width = $2, height = $3,
               variants = $4, activated_at = now()
           WHERE id = $5 AND workspace_id = $6 AND status = 'pending'
           RETURNING *`,
          [stored.byteSize, metadata.width, metadata.height, variants, assetId, workspaceId],
        );
        if (!activated.rowCount) throw new ConflictException("Logo upload changed; try again");
        const branding = await client.query<{ loginSlug: string }>(
          `UPDATE tenant_login_branding
           SET logo_asset_id = $1, logo_url = NULL
           WHERE workspace_id = $2
           RETURNING login_slug AS "loginSlug"`,
          [assetId, workspaceId],
        );
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.logo_updated",
          entityType: "workspace_brand_asset",
          entityId: assetId,
          after: {
            mimeType: asset.mime_type,
            byteSize: stored.byteSize,
            width: metadata.width,
            height: metadata.height,
          },
        });
        return {
          assetId,
          logoUrl: `/api/auth/tenant-logo/${branding.rows[0]?.loginSlug}?v=${assetId}`,
          updatedAt: activated.rows[0].updated_at,
        };
      },
    );
  }

  async removeCompanyLogo(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.delete", "workspace.settings.manage"],
      async (client, actorUser) => {
        const current = await client.query<{ logoAssetId: string | null }>(
          `SELECT logo_asset_id AS "logoAssetId" FROM tenant_login_branding WHERE workspace_id = $1`,
          [workspaceId],
        );
        const assetId = current.rows[0]?.logoAssetId;
        if (assetId) {
          await client.query(
            `UPDATE workspace_brand_assets SET status = 'replaced'
             WHERE id = $1 AND workspace_id = $2`,
            [assetId, workspaceId],
          );
        }
        await client.query(
          `UPDATE tenant_login_branding SET logo_asset_id = NULL, logo_url = NULL
           WHERE workspace_id = $1`,
          [workspaceId],
        );
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.logo_removed",
          entityType: "workspace",
          entityId: workspaceId,
          before: { logoAssetId: assetId ?? null },
          after: { logoAssetId: null },
        });
        return { removed: true };
      },
    );
  }

  async readPublicCompanyLogo(loginSlug: string) {
    const branding = await this.database.query<{ workspaceId: string; assetId: string | null }>(
      `SELECT workspace_id AS "workspaceId", logo_asset_id AS "assetId"
       FROM tenant_login_branding WHERE login_slug = $1`,
      [loginSlug.toLowerCase()],
    );
    const row = branding.rows[0];
    if (!row?.assetId) throw new NotFoundException("Company logo was not found");
    return this.database.tenantTransaction(row.workspaceId, row.workspaceId, async (client) => {
      const asset = await client.query<BrandAssetRow>(
        `SELECT * FROM workspace_brand_assets
         WHERE id = $1 AND workspace_id = $2 AND status = 'active'`,
        [row.assetId, row.workspaceId],
      );
      if (!asset.rowCount) throw new NotFoundException("Company logo was not found");
      const objectKey = asset.rows[0].variants.display ?? asset.rows[0].object_key;
      const stored = await this.brandStorage.read(objectKey).catch(() => null);
      if (!stored) throw new NotFoundException("Company logo was not found");
      return {
        body: stored.body,
        contentType: objectKey.endsWith(".webp") ? "image/webp" : asset.rows[0].mime_type,
        etag: asset.rows[0].updated_at.getTime().toString(36),
      };
    });
  }

  async updateWorkspace(actor: RequestActor, workspaceId: string, input: UpdateWorkspaceDto) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.edit", "workspace.settings.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireWorkspace(client, workspaceId);
        const values: unknown[] = [];
        const assignments: string[] = [];
        const add = (column: string, value: unknown) => {
          values.push(value);
          assignments.push(`${column} = $${values.length}`);
        };
        if (input.name !== undefined) add("name", input.name);
        if (input.slug !== undefined) add("slug", input.slug);
        if (!assignments.length) return this.mapWorkspace(before);

        values.push(workspaceId, input.version);
        try {
          const updated = await client.query<WorkspaceRow>(
            `UPDATE workspaces
             SET ${assignments.join(", ")}, version = version + 1
             WHERE id = $${values.length - 1} AND version = $${values.length}
             RETURNING *`,
            values,
          );
          if (!updated.rowCount) {
            throw new ConflictException("Workspace changed; reload and try again");
          }
          await client.query(
            `INSERT INTO tenant_login_branding (workspace_id, login_slug, display_name)
             VALUES ($1, $2, $3)
             ON CONFLICT (workspace_id)
             DO UPDATE SET login_slug = EXCLUDED.login_slug,
                           display_name = EXCLUDED.display_name`,
            [workspaceId, updated.rows[0].slug, updated.rows[0].name],
          );
          const response = this.mapWorkspace(updated.rows[0]);
          await this.recordChange(client, {
            workspaceId,
            actorUserId: actorUser.userId,
            action: "workspace.updated",
            entityType: "workspace",
            entityId: workspaceId,
            before: this.mapWorkspace(before),
            after: response,
          });
          return response;
        } catch (error) {
          this.rethrowConstraint(error, "A workspace with this slug already exists");
        }
      },
    );
  }

  async updateSettings(
    actor: RequestActor,
    workspaceId: string,
    input: UpdateWorkspaceSettingsDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.edit", "workspace.settings.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireWorkspace(client, workspaceId);
        const values: unknown[] = [];
        const assignments: string[] = [];
        const add = (column: string, value: unknown) => {
          values.push(value);
          assignments.push(`${column} = $${values.length}`);
        };

        if (input.defaultCurrency) add("default_currency", input.defaultCurrency);
        if (input.defaultLocale) add("default_locale", input.defaultLocale);
        if (input.defaultTimezone) add("default_timezone", input.defaultTimezone);
        if (input.unitSystem) add("unit_system", input.unitSystem);
        if (input.weekStartsOn !== undefined) add("week_starts_on", input.weekStartsOn);

        if (!assignments.length) {
          return this.mapWorkspace(before);
        }

        values.push(workspaceId, input.version);
        const updated = await client.query<WorkspaceRow>(
          `UPDATE workspaces
           SET ${assignments.join(", ")}, version = version + 1
           WHERE id = $${values.length - 1} AND version = $${values.length}
           RETURNING *`,
          values,
        );
        if (!updated.rowCount) {
          throw new ConflictException("Workspace settings changed; reload and try again");
        }

        const response = this.mapWorkspace(updated.rows[0]);
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.settings_updated",
          entityType: "workspace",
          entityId: workspaceId,
          before: this.mapWorkspace(before),
          after: response,
        });
        return response;
      },
    );
  }

  async createLegalEntity(
    actor: RequestActor,
    workspaceId: string,
    input: CreateLegalEntityDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.write", "legal_entities.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const entityId = randomUUID();
        try {
          const entity = await this.insertLegalEntity(client, workspaceId, entityId, input);
          await this.insertDefaultSequences(client, workspaceId, entityId, input.code);
          await this.recordChange(client, {
            workspaceId,
            actorUserId: actorUser.userId,
            action: "legal_entity.created",
            entityType: "legal_entity",
            entityId,
            after: this.mapLegalEntity(entity),
          });
          return this.mapLegalEntity(entity);
        } catch (error) {
          this.rethrowConstraint(error, "A legal entity with this code already exists");
        }
      },
    );
  }

  async updateLegalEntity(
    actor: RequestActor,
    workspaceId: string,
    entityId: string,
    input: UpdateLegalEntityDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.edit", "legal_entities.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireLegalEntity(client, workspaceId, entityId);
        const values: unknown[] = [];
        const assignments: string[] = [];
        const add = (column: string, value: unknown) => {
          values.push(value);
          assignments.push(`${column} = $${values.length}`);
        };
        if (input.displayName !== undefined) add("display_name", input.displayName);
        if (input.registeredName !== undefined) add("registered_name", input.registeredName);
        if (input.countryCode !== undefined) add("country_code", input.countryCode);
        if (input.baseCurrency !== undefined) add("base_currency", input.baseCurrency);
        if (input.locale !== undefined) add("locale", input.locale);
        if (input.timezone !== undefined) add("timezone", input.timezone);
        if (input.taxRegistrationNumber !== undefined) {
          add("tax_registration_number", input.taxRegistrationNumber || null);
        }
        if (input.registrationNumber !== undefined) {
          add("registration_number", input.registrationNumber || null);
        }
        if (input.address !== undefined) add("address", input.address);
        if (!assignments.length) return this.mapLegalEntity(before);

        values.push(entityId, workspaceId, input.version);
        const updated = await client.query<LegalEntityRow>(
          `UPDATE legal_entities
           SET ${assignments.join(", ")}, version = version + 1
           WHERE id = $${values.length - 2}
             AND workspace_id = $${values.length - 1}
             AND version = $${values.length}
             AND status = 'active'
           RETURNING *`,
          values,
        );
        if (!updated.rowCount) {
          throw new ConflictException("Legal entity changed; reload and try again");
        }
        const response = this.mapLegalEntity(updated.rows[0]);
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "legal_entity.updated",
          entityType: "legal_entity",
          entityId,
          before: this.mapLegalEntity(before),
          after: response,
        });
        return response;
      },
    );
  }

  async archiveLegalEntity(
    actor: RequestActor,
    workspaceId: string,
    entityId: string,
    version: number,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.delete", "legal_entities.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireLegalEntity(client, workspaceId, entityId);
        const activeEntities = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM legal_entities
           WHERE workspace_id = $1 AND status = 'active'`,
          [workspaceId],
        );
        if (activeEntities.rows[0].count <= 1) {
          throw new ConflictException("A workspace must retain at least one active legal entity");
        }
        const dependencies = await client.query<{ units: number; connections: number }>(
          `SELECT
             (SELECT count(*)::int FROM business_units
              WHERE legal_entity_id = $1 AND status = 'active') AS units,
             (SELECT count(*)::int FROM integration_connections
              WHERE legal_entity_id = $1 AND status <> 'revoked') AS connections`,
          [entityId],
        );
        if (dependencies.rows[0].units > 0 || dependencies.rows[0].connections > 0) {
          throw new ConflictException({
            message: "Archive or reassign this entity's active units and integrations first",
            dependencies: dependencies.rows[0],
          });
        }

        const archived = await client.query<LegalEntityRow>(
          `UPDATE legal_entities
           SET status = 'archived', archived_at = now(), version = version + 1
           WHERE id = $1 AND workspace_id = $2 AND version = $3 AND status = 'active'
           RETURNING *`,
          [entityId, workspaceId, version],
        );
        if (!archived.rowCount) {
          throw new ConflictException("Legal entity changed; reload and try again");
        }
        const response = this.mapLegalEntity(archived.rows[0]);
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "legal_entity.archived",
          entityType: "legal_entity",
          entityId,
          before: this.mapLegalEntity(before),
          after: response,
        });
        return response;
      },
    );
  }

  async createBusinessUnit(
    actor: RequestActor,
    workspaceId: string,
    input: CreateBusinessUnitDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.teams.write", "legal_entities.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        await this.assertBusinessUnitParent(
          client,
          workspaceId,
          input.legalEntityId,
          input.parentBusinessUnitId ?? null,
        );
        try {
          const result = await client.query(
            `INSERT INTO business_units
              (workspace_id, legal_entity_id, parent_business_unit_id, code, name, type, timezone, color)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, legal_entity_id AS "legalEntityId",
                       parent_business_unit_id AS "parentBusinessUnitId",
                       code, name, name AS "visibleName", type, timezone, color, status, version`,
            [
              workspaceId,
              input.legalEntityId,
              input.parentBusinessUnitId ?? null,
              input.code,
              input.name,
              input.type,
              input.timezone,
              input.color ?? "#64748B",
            ],
          );
          const unit = result.rows[0] as Record<string, unknown>;
          await this.recordChange(client, {
            workspaceId,
            actorUserId: actorUser.userId,
            action: "business_unit.created",
            entityType: "business_unit",
            entityId: String(unit.id),
            after: unit,
          });
          return unit;
        } catch (error) {
          this.rethrowConstraint(error, "Business unit references or code are invalid");
        }
      },
    );
  }

  async updateBusinessUnit(
    actor: RequestActor,
    workspaceId: string,
    unitId: string,
    input: UpdateBusinessUnitDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.teams.edit", "legal_entities.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireBusinessUnit(client, workspaceId, unitId);
        const legalEntityId = input.legalEntityId ?? String(before.legalEntityId);
        if (
          input.legalEntityId !== undefined
          && input.legalEntityId !== String(before.legalEntityId)
        ) {
          const children = await client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM business_units
             WHERE parent_business_unit_id = $1`,
            [unitId],
          );
          if (children.rows[0].count > 0) {
            throw new ConflictException(
              "Move or archive child business units before changing the legal entity",
            );
          }
        }
        const parentBusinessUnitId = input.parentBusinessUnitId === undefined
          ? (before.parentBusinessUnitId as string | null)
          : input.parentBusinessUnitId;
        await this.assertBusinessUnitParent(
          client,
          workspaceId,
          legalEntityId,
          parentBusinessUnitId,
          unitId,
        );

        const values: unknown[] = [];
        const assignments: string[] = [];
        const add = (column: string, value: unknown) => {
          values.push(value);
          assignments.push(`${column} = $${values.length}`);
        };
        if (input.legalEntityId !== undefined) add("legal_entity_id", input.legalEntityId);
        if (input.parentBusinessUnitId !== undefined) {
          add("parent_business_unit_id", input.parentBusinessUnitId);
        }
        if (input.name !== undefined) add("name", input.name);
        if (input.type !== undefined) add("type", input.type);
        if (input.timezone !== undefined) add("timezone", input.timezone);
        if (input.color !== undefined) add("color", input.color);
        if (!assignments.length) return before;

        values.push(unitId, workspaceId, input.version);
        try {
          const updated = await client.query(
            `UPDATE business_units
             SET ${assignments.join(", ")}, version = version + 1
             WHERE id = $${values.length - 2}
               AND workspace_id = $${values.length - 1}
               AND version = $${values.length}
               AND status = 'active'
             RETURNING id, legal_entity_id AS "legalEntityId",
                       parent_business_unit_id AS "parentBusinessUnitId",
                       code, name, name AS "visibleName", type, timezone, color, status, version`,
            values,
          );
          if (!updated.rowCount) {
            throw new ConflictException("Business unit changed; reload and try again");
          }
          const response = updated.rows[0] as Record<string, unknown>;
          await this.recordChange(client, {
            workspaceId,
            actorUserId: actorUser.userId,
            action: "business_unit.updated",
            entityType: "business_unit",
            entityId: unitId,
            before,
            after: response,
          });
          return response;
        } catch (error) {
          this.rethrowConstraint(error, "Business unit references are invalid");
        }
      },
    );
  }

  async archiveBusinessUnit(
    actor: RequestActor,
    workspaceId: string,
    unitId: string,
    version: number,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.teams.delete", "legal_entities.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireBusinessUnit(client, workspaceId, unitId);
        const children = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM business_units
           WHERE parent_business_unit_id = $1 AND status = 'active'`,
          [unitId],
        );
        if (children.rows[0].count > 0) {
          throw new ConflictException("Archive or reassign child business units first");
        }
        const teams = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM workspace_teams
           WHERE business_unit_id = $1 AND status = 'active'`,
          [unitId],
        );
        if (teams.rows[0].count > 0) {
          throw new ConflictException("Archive or reassign teams in this business unit first");
        }
        const archived = await client.query(
          `UPDATE business_units
           SET status = 'archived', version = version + 1
           WHERE id = $1 AND workspace_id = $2 AND version = $3 AND status = 'active'
           RETURNING id, legal_entity_id AS "legalEntityId",
                     parent_business_unit_id AS "parentBusinessUnitId",
                     code, name, name AS "visibleName", type, timezone, color, status, version`,
          [unitId, workspaceId, version],
        );
        if (!archived.rowCount) {
          throw new ConflictException("Business unit changed; reload and try again");
        }
        const response = archived.rows[0] as Record<string, unknown>;
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "business_unit.archived",
          entityType: "business_unit",
          entityId: unitId,
          before,
          after: response,
        });
        return response;
      },
    );
  }

  async listTeams(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["module.teams.read", "legal_entities.view"], async (client) => {
      const result = await client.query(
        `SELECT team.id, team.business_unit_id AS "businessUnitId", team.code,
                team.name, team.description, team.status, team.version,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'membershipId', membership.id,
                  'userId', app_user.id,
                  'displayName', app_user.display_name,
                  'email', app_user.primary_email,
                  'isLead', assigned.is_lead
                ) ORDER BY assigned.is_lead DESC, app_user.display_name)
                  FILTER (WHERE membership.id IS NOT NULL), '[]'::jsonb) AS members
         FROM workspace_teams team
         LEFT JOIN workspace_team_members assigned ON assigned.team_id = team.id
         LEFT JOIN workspace_memberships membership ON membership.id = assigned.membership_id
         LEFT JOIN users app_user ON app_user.id = membership.user_id
         WHERE team.workspace_id = $1 AND team.status = 'active'
         GROUP BY team.id
         ORDER BY team.name`,
        [workspaceId],
      );
      return result.rows;
    });
  }

  async createTeam(actor: RequestActor, workspaceId: string, input: CreateTeamDto) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.teams.write", "legal_entities.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        await this.requireBusinessUnit(client, workspaceId, input.businessUnitId);
        const memberIds = Array.from(new Set([
          ...(input.memberIds ?? []),
          ...(input.leadMembershipId ? [input.leadMembershipId] : []),
        ]));
        let created;
        try {
          created = await client.query<{ id: string }>(
            `INSERT INTO workspace_teams
              (workspace_id, business_unit_id, code, name, description)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [workspaceId, input.businessUnitId, input.code, input.name, input.description || null],
          );
        } catch (error) {
          this.rethrowConstraint(error, "A team with this code already exists");
        }
        const teamId = created!.rows[0].id;
        await this.replaceTeamMembers(
          client,
          workspaceId,
          teamId,
          memberIds,
          input.leadMembershipId ?? null,
        );
        const response = await this.requireTeam(client, workspaceId, teamId);
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.team_created",
          entityType: "workspace_team",
          entityId: teamId,
          after: response,
        });
        return response;
      },
    );
  }

  async updateTeam(
    actor: RequestActor,
    workspaceId: string,
    teamId: string,
    input: UpdateTeamDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.teams.edit", "legal_entities.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireTeam(client, workspaceId, teamId);
        if (input.businessUnitId) {
          await this.requireBusinessUnit(client, workspaceId, input.businessUnitId);
        }
        const updated = await client.query(
          `UPDATE workspace_teams
           SET business_unit_id = COALESCE($1, business_unit_id),
               name = COALESCE($2, name),
               description = CASE WHEN $3::boolean THEN $4 ELSE description END,
               version = version + 1
           WHERE id = $5 AND workspace_id = $6 AND version = $7 AND status = 'active'
           RETURNING id`,
          [
            input.businessUnitId ?? null,
            input.name ?? null,
            input.description !== undefined,
            input.description || null,
            teamId,
            workspaceId,
            input.version,
          ],
        );
        if (!updated.rowCount) throw new ConflictException("Team changed; reload and try again");

        if (input.memberIds !== undefined || input.leadMembershipId !== undefined) {
          const existingMembers = (before.members as Array<{ membershipId: string; isLead: boolean }>);
          const memberIds = input.memberIds ?? existingMembers.map((member) => member.membershipId);
          const leadMembershipId = input.leadMembershipId === undefined
            ? existingMembers.find((member) => member.isLead)?.membershipId ?? null
            : input.leadMembershipId;
          const allMemberIds = Array.from(new Set([
            ...memberIds,
            ...(leadMembershipId ? [leadMembershipId] : []),
          ]));
          await this.replaceTeamMembers(
            client,
            workspaceId,
            teamId,
            allMemberIds,
            leadMembershipId,
          );
        }
        const response = await this.requireTeam(client, workspaceId, teamId);
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.team_updated",
          entityType: "workspace_team",
          entityId: teamId,
          before,
          after: response,
        });
        return response;
      },
    );
  }

  async archiveTeam(actor: RequestActor, workspaceId: string, teamId: string, version: number) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.teams.delete", "legal_entities.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireTeam(client, workspaceId, teamId);
        const archived = await client.query(
          `UPDATE workspace_teams SET status = 'archived', version = version + 1
           WHERE id = $1 AND workspace_id = $2 AND version = $3 AND status = 'active'
           RETURNING id, status, version`,
          [teamId, workspaceId, version],
        );
        if (!archived.rowCount) throw new ConflictException("Team changed; reload and try again");
        const response = archived.rows[0] as Record<string, unknown>;
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.team_archived",
          entityType: "workspace_team",
          entityId: teamId,
          before,
          after: response,
        });
        return response;
      },
    );
  }

  async listRoles(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["module.roles.read", "workspace.roles.manage"], async (client) => {
      const roles = await client.query(
        `SELECT role.id, role.code, role.name, role.description, role.is_system AS "isSystem",
                role.version,
                (SELECT count(*)::int FROM member_roles assigned
                 WHERE assigned.role_id = role.id) AS "memberCount",
                COALESCE(json_agg(permission.code ORDER BY permission.code)
                  FILTER (WHERE permission.code IS NOT NULL), '[]') AS permissions
         FROM roles role
         LEFT JOIN role_permissions granted ON granted.role_id = role.id
         LEFT JOIN permissions permission ON permission.id = granted.permission_id
         WHERE role.workspace_id = $1
         GROUP BY role.id
         ORDER BY role.is_system DESC, role.name`,
        [workspaceId],
      );
      return roles.rows;
    });
  }

  async createRole(actor: RequestActor, workspaceId: string, input: CreateRoleDto) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.roles.write", "workspace.roles.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const permissions = await this.resolvePermissions(client, input.permissionCodes);

        try {
          const role = await client.query<{ id: string } & Record<string, unknown>>(
            `INSERT INTO roles (workspace_id, code, name, description, is_system)
             VALUES ($1, $2, $3, $4, false)
             RETURNING id, code, name, description, is_system AS "isSystem", version`,
            [workspaceId, input.code, input.name, input.description],
          );
          for (const permission of permissions.rows) {
            await client.query(
              `INSERT INTO role_permissions (workspace_id, role_id, permission_id)
               VALUES ($1, $2, $3)`,
              [workspaceId, role.rows[0].id, permission.id],
            );
          }
          const response = { ...role.rows[0], permissions: input.permissionCodes.sort() };
          await this.recordChange(client, {
            workspaceId,
            actorUserId: actorUser.userId,
            action: "role.created",
            entityType: "role",
            entityId: role.rows[0].id,
            after: response,
          });
          return response;
        } catch (error) {
          this.rethrowConstraint(error, "A role with this code already exists");
        }
      },
    );
  }

  async updateRole(
    actor: RequestActor,
    workspaceId: string,
    roleId: string,
    input: UpdateRoleDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.roles.edit", "workspace.roles.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireRole(client, workspaceId, roleId);
        if (before.isSystem) {
          throw new ConflictException("System roles cannot be edited");
        }
        if (
          input.name === undefined
          && input.description === undefined
          && input.permissionCodes === undefined
        ) {
          return before;
        }
        const permissions = input.permissionCodes === undefined
          ? undefined
          : await this.resolvePermissions(client, input.permissionCodes);
        const updated = await client.query(
          `UPDATE roles
           SET name = COALESCE($1, name),
               description = COALESCE($2, description),
               version = version + 1
           WHERE id = $3 AND workspace_id = $4 AND version = $5 AND is_system = false
           RETURNING id, code, name, description, is_system AS "isSystem", version`,
          [input.name ?? null, input.description ?? null, roleId, workspaceId, input.version],
        );
        if (!updated.rowCount) {
          throw new ConflictException("Role changed; reload and try again");
        }
        if (permissions) {
          await client.query("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);
          for (const permission of permissions.rows) {
            await client.query(
              `INSERT INTO role_permissions (workspace_id, role_id, permission_id)
               VALUES ($1, $2, $3)`,
              [workspaceId, roleId, permission.id],
            );
          }
        }
        const response = {
          ...updated.rows[0],
          permissions: input.permissionCodes ?? before.permissions,
        } as Record<string, unknown>;
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "role.updated",
          entityType: "role",
          entityId: roleId,
          before,
          after: response,
        });
        return response;
      },
    );
  }

  async deleteRole(
    actor: RequestActor,
    workspaceId: string,
    roleId: string,
    version: number,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.roles.delete", "workspace.roles.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireRole(client, workspaceId, roleId);
        if (before.isSystem) {
          throw new ConflictException("System roles cannot be deleted");
        }
        const assignments = await client.query<{ members: number; invitations: number }>(
          `SELECT
             (SELECT count(*)::int FROM member_roles WHERE role_id = $1) AS members,
             (SELECT count(*)::int FROM invitation_roles assigned
              JOIN workspace_invitations invitation ON invitation.id = assigned.invitation_id
              WHERE assigned.role_id = $1 AND invitation.status = 'pending') AS invitations`,
          [roleId],
        );
        if (assignments.rows[0].members > 0 || assignments.rows[0].invitations > 0) {
          throw new ConflictException({
            message: "Reassign members and pending invitations before deleting this role",
            assignments: assignments.rows[0],
          });
        }
        const deleted = await client.query(
          `DELETE FROM roles
           WHERE id = $1 AND workspace_id = $2 AND version = $3 AND is_system = false
           RETURNING id`,
          [roleId, workspaceId, version],
        );
        if (!deleted.rowCount) {
          throw new ConflictException("Role changed; reload and try again");
        }
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "role.deleted",
          entityType: "role",
          entityId: roleId,
          before,
          after: { deleted: true },
        });
        return { id: roleId, deleted: true };
      },
    );
  }

  async inviteMember(actor: RequestActor, workspaceId: string, input: InviteMemberDto) {
    const created = await this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.members.write", "workspace.members.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const workspace = await this.requireWorkspace(client, workspaceId);
        await client.query(
          `UPDATE workspace_invitations
           SET status = 'expired'
           WHERE workspace_id = $1 AND status = 'pending' AND expires_at <= now()`,
          [workspaceId],
        );
        const existingMember = await client.query(
          `SELECT 1
           FROM workspace_memberships membership
           JOIN users app_user ON app_user.id = membership.user_id
           WHERE membership.workspace_id = $1 AND app_user.primary_email = $2`,
          [workspaceId, input.email],
        );
        if (existingMember.rowCount) {
          throw new ConflictException("This person is already a workspace member");
        }
        const existingInvitation = await client.query(
          `SELECT 1 FROM workspace_invitations
           WHERE workspace_id = $1 AND email = $2 AND status = 'pending'`,
          [workspaceId, input.email],
        );
        if (existingInvitation.rowCount) {
          throw new ConflictException("A pending invitation already exists for this email");
        }
        await this.assertSeatAvailable(client, workspaceId);
        const roles = await client.query<{ id: string; code: string }>(
          `SELECT id, code FROM roles WHERE workspace_id = $1 AND code = ANY($2::text[])`,
          [workspaceId, input.roleCodes],
        );
        if (roles.rowCount !== input.roleCodes.length) {
          throw new UnprocessableEntityException("One or more workspace roles are invalid");
        }

        const displayName = input.displayName
          ?? input.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
        await client.query(
          `INSERT INTO users (primary_email, display_name)
           VALUES ($1, $2)
           ON CONFLICT (primary_email) DO NOTHING`,
          [input.email, displayName],
        );

        const invitationToken = randomBytes(32).toString("base64url");
        const tokenHash = createHash("sha256").update(invitationToken).digest("hex");
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        let invitation;
        try {
          invitation = await client.query<{ id: string }>(
            `INSERT INTO workspace_invitations
              (workspace_id, email, token_hash, invited_by, expires_at)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [workspaceId, input.email, tokenHash, actorUser.userId, expiresAt],
          );
        } catch (error) {
          this.rethrowConstraint(error, "A pending invitation already exists for this email");
        }

        for (const role of roles.rows) {
          await client.query(
            `INSERT INTO invitation_roles (workspace_id, invitation_id, role_id)
             VALUES ($1, $2, $3)`,
            [workspaceId, invitation.rows[0].id, role.id],
          );
        }
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.member_invited",
          entityType: "workspace_invitation",
          entityId: invitation.rows[0].id,
          after: { displayName, email: input.email, roleCodes: input.roleCodes, expiresAt },
        });

        return {
          invitation: {
            id: invitation.rows[0].id,
            email: input.email,
            displayName,
            roleCodes: input.roleCodes,
            expiresAt,
            invitationToken,
            tokenNotice: "This token is returned once and is never stored in plaintext.",
          },
          message: {
            email: input.email,
            expiresAt,
            invitationToken,
            inviterName: actorUser.displayName,
            recipientName: displayName,
            roleCodes: input.roleCodes,
            workspaceName: workspace.name,
          },
        };
      },
    );
    const emailDelivery = await this.transactionalEmail.sendWorkspaceInvitation(created.message);
    return { ...created.invitation, emailDelivery };
  }

  async listMembers(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["module.members.read", "workspace.members.manage"], async (client) => {
      const members = await client.query(
        `SELECT membership.id, membership.status, membership.joined_at AS "joinedAt",
                membership.version,
                app_user.id AS "userId", app_user.primary_email AS email,
                app_user.display_name AS "displayName",
                COALESCE(json_agg(role.code ORDER BY role.code)
                  FILTER (WHERE role.code IS NOT NULL), '[]') AS roles
         FROM workspace_memberships membership
         JOIN users app_user ON app_user.id = membership.user_id
         LEFT JOIN member_roles assigned ON assigned.membership_id = membership.id
         LEFT JOIN roles role ON role.id = assigned.role_id
         WHERE membership.workspace_id = $1
         GROUP BY membership.id, app_user.id
         ORDER BY app_user.display_name`,
        [workspaceId],
      );
      return members.rows;
    });
  }

  async updateMember(
    actor: RequestActor,
    workspaceId: string,
    membershipId: string,
    input: UpdateMemberDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.members.edit", "workspace.members.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireMember(client, workspaceId, membershipId, true);
        if (input.status === undefined && input.roleCodes === undefined) return before;
        const requestedRoles = input.roleCodes === undefined
          ? undefined
          : await this.resolveRoles(client, workspaceId, input.roleCodes);
        const nextRoleCodes = input.roleCodes ?? (before.roles as string[]);
        const nextStatus = input.status ?? String(before.status);
        if (String(before.status) !== "active" && nextStatus === "active") {
          await this.assertSeatAvailable(client, workspaceId);
        }
        if (
          (before.roles as string[]).includes("owner")
          && (nextStatus !== "active" || !nextRoleCodes.includes("owner"))
        ) {
          await this.assertAnotherActiveOwner(client, workspaceId, membershipId);
        }

        const updated = await client.query<{ id: string }>(
          `UPDATE workspace_memberships
           SET status = COALESCE($1::membership_status, status), version = version + 1
           WHERE id = $2 AND workspace_id = $3 AND version = $4
           RETURNING id`,
          [input.status ?? null, membershipId, workspaceId, input.version],
        );
        if (!updated.rowCount) {
          throw new ConflictException("Member changed; reload and try again");
        }
        if (requestedRoles) {
          await client.query("DELETE FROM member_roles WHERE membership_id = $1", [membershipId]);
          for (const role of requestedRoles.rows) {
            await client.query(
              `INSERT INTO member_roles (workspace_id, membership_id, role_id)
               VALUES ($1, $2, $3)`,
              [workspaceId, membershipId, role.id],
            );
          }
        }
        const response = await this.requireMember(client, workspaceId, membershipId);
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.member_updated",
          entityType: "workspace_membership",
          entityId: membershipId,
          before,
          after: response,
        });
        return response;
      },
    );
  }

  async listInvitations(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.members.read", "workspace.members.manage"],
      async (client) => {
        const result = await client.query(
          `SELECT invitation.id, invitation.email, invitee.display_name AS "displayName",
                  CASE
                    WHEN invitation.status = 'pending' AND invitation.expires_at <= now()
                    THEN 'expired'
                    ELSE invitation.status::text
                  END AS status,
                  invitation.expires_at AS "expiresAt",
                  invitation.accepted_at AS "acceptedAt",
                  invitation.cancelled_at AS "cancelledAt",
                  invitation.created_at AS "createdAt",
                  inviter.display_name AS "invitedByName",
                  COALESCE(json_agg(role.code ORDER BY role.code)
                    FILTER (WHERE role.code IS NOT NULL), '[]') AS roles
           FROM workspace_invitations invitation
           JOIN users inviter ON inviter.id = invitation.invited_by
           JOIN users invitee ON invitee.primary_email = invitation.email
           LEFT JOIN invitation_roles assigned ON assigned.invitation_id = invitation.id
           LEFT JOIN roles role ON role.id = assigned.role_id
           WHERE invitation.workspace_id = $1
           GROUP BY invitation.id, inviter.id, invitee.id
           ORDER BY invitation.created_at DESC`,
          [workspaceId],
        );
        return result.rows;
      },
    );
  }

  async cancelInvitation(
    actor: RequestActor,
    workspaceId: string,
    invitationId: string,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.members.delete", "workspace.members.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const invitation = await this.requirePendingInvitation(client, workspaceId, invitationId);
        const cancelled = await client.query(
          `UPDATE workspace_invitations
           SET status = 'cancelled', cancelled_at = now()
           WHERE id = $1 AND workspace_id = $2 AND status = 'pending'
           RETURNING id, email, status, cancelled_at AS "cancelledAt"`,
          [invitationId, workspaceId],
        );
        if (!cancelled.rowCount) throw new ConflictException("Invitation is no longer pending");
        const response = cancelled.rows[0] as Record<string, unknown>;
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.invitation_cancelled",
          entityType: "workspace_invitation",
          entityId: invitationId,
          before: invitation,
          after: response,
        });
        return response;
      },
    );
  }

  async resendInvitation(
    actor: RequestActor,
    workspaceId: string,
    invitationId: string,
  ) {
    const renewed = await this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.members.write", "workspace.members.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const workspace = await this.requireWorkspace(client, workspaceId);
        const before = await this.requirePendingInvitation(client, workspaceId, invitationId);
        const details = await client.query<{ displayName: string; roleCodes: string[] }>(
          `SELECT invitee.display_name AS "displayName",
                  COALESCE(array_agg(role.code ORDER BY role.code)
                    FILTER (WHERE role.code IS NOT NULL), '{}') AS "roleCodes"
           FROM workspace_invitations invitation
           JOIN users invitee ON invitee.primary_email = invitation.email
           LEFT JOIN invitation_roles assigned ON assigned.invitation_id = invitation.id
           LEFT JOIN roles role ON role.id = assigned.role_id
           WHERE invitation.id = $1 AND invitation.workspace_id = $2
           GROUP BY invitee.id`,
          [invitationId, workspaceId],
        );
        const invitationToken = randomBytes(32).toString("base64url");
        const tokenHash = createHash("sha256").update(invitationToken).digest("hex");
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const resent = await client.query(
          `UPDATE workspace_invitations
           SET token_hash = $1, expires_at = $2, invited_by = $3
           WHERE id = $4 AND workspace_id = $5 AND status = 'pending'
           RETURNING id, email, expires_at AS "expiresAt"`,
          [tokenHash, expiresAt, actorUser.userId, invitationId, workspaceId],
        );
        if (!resent.rowCount) throw new ConflictException("Invitation is no longer pending");
        const response = {
          ...resent.rows[0],
          invitationToken,
          tokenNotice: "This replacement token is returned once and is never stored in plaintext.",
        } as Record<string, unknown>;
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.invitation_resent",
          entityType: "workspace_invitation",
          entityId: invitationId,
          before,
          after: { id: invitationId, email: response.email, expiresAt },
        });
        const recipient = details.rows[0];
        return {
          invitation: response,
          message: {
            email: String(response.email),
            expiresAt,
            invitationToken,
            inviterName: actorUser.displayName,
            recipientName: recipient?.displayName
              ?? String(response.email).split("@")[0],
            roleCodes: recipient?.roleCodes ?? [],
            workspaceName: workspace.name,
          },
        };
      },
    );
    const emailDelivery = await this.transactionalEmail.sendWorkspaceInvitation(renewed.message);
    return { ...renewed.invitation, emailDelivery };
  }

  async createIntegrationConnection(
    actor: RequestActor,
    workspaceId: string,
    input: CreateIntegrationConnectionDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.integrations.write", "integrations.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        if (input.legalEntityId) {
          await this.requireLegalEntity(client, workspaceId, input.legalEntityId);
        }
        this.validateIntegrationConfiguration(
          input.provider,
          input.legalEntityId ?? null,
          input.externalDomain ?? null,
          input.configuration ?? {},
        );
        try {
          const connection = await client.query(
            `INSERT INTO integration_connections
              (workspace_id, legal_entity_id, provider, display_name, external_domain,
               status, configuration, connected_by)
             VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7)
             RETURNING id, legal_entity_id AS "legalEntityId", provider,
                       display_name AS "displayName", external_domain AS "externalDomain",
                       status, configuration, version, created_at AS "createdAt"`,
            [
              workspaceId,
              input.legalEntityId ?? null,
              input.provider,
              input.displayName,
              input.externalDomain ?? null,
              input.configuration ?? {},
              actorUser.userId,
            ],
          );
          const response = connection.rows[0] as Record<string, unknown>;
          await this.recordChange(client, {
            workspaceId,
            actorUserId: actorUser.userId,
            action: "integration.connection_created",
            entityType: "integration_connection",
            entityId: String(response.id),
            after: response,
          });
          return response;
        } catch (error) {
          this.rethrowConstraint(
            error,
            "The connection conflicts with an existing provider/domain or legal entity",
          );
        }
      },
    );
  }

  async listIntegrationConnections(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["module.integrations.read", "integrations.view"], async (client) => {
      const result = await client.query(
        `SELECT connection.id, connection.legal_entity_id AS "legalEntityId",
                entity.display_name AS "legalEntityName", connection.provider,
                connection.display_name AS "displayName",
                connection.external_account_id AS "externalAccountId",
                connection.external_domain AS "externalDomain",
                CASE
                  WHEN connection.status = 'connected' AND (
                    (connection.provider IN ('google_workspace','quickbooks','zoho_books','whatsapp') AND entity.id IS NULL)
                    OR (connection.provider IN ('quickbooks','zoho_books')
                        AND NULLIF(connection.configuration->>'currency','') IS NOT NULL
                        AND upper(connection.configuration->>'currency') <> entity.base_currency)
                  ) THEN 'degraded'::integration_status
                  ELSE connection.status
                END AS status,
                connection.configuration,
                entity.base_currency AS "legalEntityCurrency",
                workspace.default_currency AS "workspaceCurrency",
                array_remove(ARRAY[
                  CASE WHEN connection.provider IN ('google_workspace','quickbooks','zoho_books','whatsapp') AND entity.id IS NULL
                    THEN 'Assign the provider account to a legal entity.' END,
                  CASE WHEN connection.provider IN ('quickbooks','zoho_books')
                         AND NULLIF(connection.configuration->>'currency','') IS NOT NULL
                         AND upper(connection.configuration->>'currency') <> entity.base_currency
                    THEN 'Provider currency does not match the legal entity currency.' END
                ], NULL) AS "healthIssues",
                connection.granted_scopes AS "grantedScopes",
                connection.last_synced_at AS "lastSyncedAt",
                connection.last_error_code AS "lastErrorCode",
                connection.version, connection.created_at AS "createdAt",
                connection.updated_at AS "updatedAt"
         FROM integration_connections connection
         LEFT JOIN legal_entities entity ON entity.id = connection.legal_entity_id
         JOIN workspaces workspace ON workspace.id = connection.workspace_id
         WHERE connection.workspace_id = $1
         ORDER BY connection.provider, connection.display_name`,
        [workspaceId],
      );
      return result.rows;
    });
  }

  async updateIntegrationConnection(
    actor: RequestActor,
    workspaceId: string,
    connectionId: string,
    input: UpdateIntegrationConnectionDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.integrations.edit", "integrations.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireIntegrationConnection(
          client,
          workspaceId,
          connectionId,
        );
        if (input.legalEntityId) {
          await this.requireLegalEntity(client, workspaceId, input.legalEntityId);
        }
        const legalEntityChanged = input.legalEntityId !== undefined
          && input.legalEntityId !== before.legalEntityId;
        const assignsMissingLegalEntity = legalEntityChanged
          && !before.legalEntityId
          && Boolean(input.legalEntityId);
        if (["connected", "pending", "degraded"].includes(String(before.status)) && (
          (legalEntityChanged && !assignsMissingLegalEntity)
          || (input.externalDomain !== undefined && input.externalDomain !== before.externalDomain)
          || (input.configuration !== undefined && JSON.stringify(input.configuration) !== JSON.stringify(before.configuration))
        )) {
          throw new ConflictException("Disconnect and create a new connection to change its organization or account settings");
        }
        this.validateIntegrationConfiguration(
          String(before.provider),
          input.legalEntityId === undefined
            ? (before.legalEntityId as string | null)
            : input.legalEntityId,
          input.externalDomain === undefined
            ? (before.externalDomain as string | null)
            : input.externalDomain,
          input.configuration ?? (before.configuration as Record<string, unknown>),
        );
        const values: unknown[] = [];
        const assignments: string[] = [];
        const add = (column: string, value: unknown) => {
          values.push(value);
          assignments.push(`${column} = $${values.length}`);
        };
        if (input.displayName !== undefined) add("display_name", input.displayName);
        if (input.legalEntityId !== undefined) add("legal_entity_id", input.legalEntityId);
        if (input.externalDomain !== undefined) add("external_domain", input.externalDomain);
        if (input.configuration !== undefined) add("configuration", input.configuration);
        if (!assignments.length) return before;

        values.push(connectionId, workspaceId, input.version);
        try {
          const updated = await client.query(
            `UPDATE integration_connections
             SET ${assignments.join(", ")}, version = version + 1
             WHERE id = $${values.length - 2}
               AND workspace_id = $${values.length - 1}
               AND version = $${values.length}
               AND status <> 'revoked'
             RETURNING id, legal_entity_id AS "legalEntityId", provider,
                       display_name AS "displayName", external_domain AS "externalDomain",
                       status, configuration, version, created_at AS "createdAt",
                       updated_at AS "updatedAt"`,
            values,
          );
          if (!updated.rowCount) {
            throw new ConflictException("Integration changed or was revoked; reload and try again");
          }
          const response = updated.rows[0] as Record<string, unknown>;
          await this.recordChange(client, {
            workspaceId,
            actorUserId: actorUser.userId,
            action: "integration.connection_updated",
            entityType: "integration_connection",
            entityId: connectionId,
            before,
            after: response,
          });
          return response;
        } catch (error) {
          this.rethrowConstraint(
            error,
            "The connection conflicts with an existing provider/domain or legal entity",
          );
        }
      },
    );
  }

  async requestIntegrationConnection(
    actor: RequestActor,
    workspaceId: string,
    connectionId: string,
    version: number,
  ) {
    return this.changeIntegrationStatus(
      actor,
      workspaceId,
      connectionId,
      version,
      "pending",
      "integration.connection_requested",
    );
  }

  async revokeIntegrationConnection(
    actor: RequestActor,
    workspaceId: string,
    connectionId: string,
    version: number,
  ) {
    return this.changeIntegrationStatus(
      actor,
      workspaceId,
      connectionId,
      version,
      "revoked",
      "integration.connection_revoked",
    );
  }

  async listAuditEvents(
    actor: RequestActor,
    workspaceId: string,
    limit: number,
    encodedCursor?: string,
  ) {
    return this.access.withPermission(
      actor,
      workspaceId,
      "audit.view",
      async (client) => {
        const cursor = encodedCursor ? this.decodeAuditCursor(encodedCursor) : undefined;
        const result = await client.query(
          `SELECT event.id, event.source, event.action,
                  event.entity_type AS "entityType", event.entity_id AS "entityId",
                  event.before, event.after, event.correlation_id AS "correlationId",
                  event.occurred_at AS "occurredAt",
                  app_user.display_name AS "actorName", app_user.primary_email AS "actorEmail"
           FROM audit_events event
           LEFT JOIN users app_user ON app_user.id = event.actor_user_id
           WHERE event.workspace_id = $1
             AND ($2::timestamptz IS NULL OR
                  (event.occurred_at, event.id) < ($2::timestamptz, $3::uuid))
           ORDER BY event.occurred_at DESC, event.id DESC
           LIMIT $4`,
          [
            workspaceId,
            cursor?.occurredAt ?? null,
            cursor?.id ?? null,
            Math.min(Math.max(limit, 1), 100) + 1,
          ],
        );
        const hasMore = result.rows.length > limit;
        const items = hasMore ? result.rows.slice(0, limit) : result.rows;
        const last = items.at(-1) as { id?: string; occurredAt?: Date | string } | undefined;
        return {
          items,
          nextCursor: hasMore && last?.id && last.occurredAt
            ? Buffer.from(JSON.stringify({
              id: last.id,
              occurredAt: new Date(last.occurredAt).toISOString(),
            })).toString("base64url")
            : null,
        };
      },
    );
  }

  private decodeAuditCursor(encoded: string): { id: string; occurredAt: string } {
    try {
      const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
        id?: unknown;
        occurredAt?: unknown;
      };
      if (
        typeof value.id !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
        || typeof value.occurredAt !== "string"
        || Number.isNaN(Date.parse(value.occurredAt))
      ) {
        throw new Error("invalid cursor fields");
      }
      return { id: value.id, occurredAt: value.occurredAt };
    } catch {
      throw new BadRequestException("Audit cursor is invalid");
    }
  }

  private async changeIntegrationStatus(
    actor: RequestActor,
    workspaceId: string,
    connectionId: string,
    version: number,
    status: "pending" | "revoked",
    action: string,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      [status === "revoked" ? "module.integrations.delete" : "module.integrations.edit", "integrations.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireIntegrationConnection(
          client,
          workspaceId,
          connectionId,
        );
        if (before.status === status) {
          throw new ConflictException(`Integration is already ${status}`);
        }
        if (status === "pending" && before.status === "connected") {
          throw new ConflictException("Revoke the active connection before reconnecting it");
        }
        if (status === "pending") {
          const legalEntityId = before.legalEntityId as string | null;
          if (legalEntityId) {
            await this.requireLegalEntity(client, workspaceId, legalEntityId);
          }
          this.validateIntegrationConfiguration(
            String(before.provider),
            legalEntityId,
            before.externalDomain as string | null,
            before.configuration as Record<string, unknown>,
          );
        }
        let changed;
        try {
          changed = await client.query(
            `UPDATE integration_connections
             SET status = $1::integration_status,
                 revoked_at = CASE WHEN $1 = 'revoked' THEN now() ELSE NULL END,
                 last_error_code = CASE WHEN $1 = 'pending' THEN NULL ELSE last_error_code END,
                 last_error_at = CASE WHEN $1 = 'pending' THEN NULL ELSE last_error_at END,
                 version = version + 1
             WHERE id = $2 AND workspace_id = $3 AND version = $4
             RETURNING id, legal_entity_id AS "legalEntityId", provider,
                       display_name AS "displayName", external_domain AS "externalDomain",
                       status, version, revoked_at AS "revokedAt",
                       created_at AS "createdAt", updated_at AS "updatedAt"`,
            [status, connectionId, workspaceId, version],
          );
        } catch (error) {
          this.rethrowConstraint(
            error,
            "Another active integration already uses this provider, legal entity, and domain",
          );
        }
        if (!changed.rowCount) {
          throw new ConflictException("Integration changed; reload and try again");
        }
        const response = changed.rows[0] as Record<string, unknown>;
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action,
          entityType: "integration_connection",
          entityId: connectionId,
          before,
          after: response,
        });
        return response;
      },
    );
  }

  private validateIntegrationConfiguration(
    provider: string,
    legalEntityId: string | null,
    externalDomain: string | null,
    configuration: Record<string, unknown>,
  ): void {
    if (provider === "google_workspace" && (!legalEntityId || !externalDomain)) {
      throw new UnprocessableEntityException(
        "Google Workspace connections require a legal entity and verified domain",
      );
    }
    if (["quickbooks", "zoho_books", "whatsapp"].includes(provider) && !legalEntityId) {
      throw new UnprocessableEntityException(
        "Accounting and messaging connections must be assigned to a legal entity",
      );
    }

    if (provider === "zoho_books" && !["us", "in", "eu", "au", "ca", "jp", "sa"].includes(String(configuration.region ?? "us"))) {
      throw new UnprocessableEntityException("Select a supported Zoho data center");
    }
    if (provider === "google_workspace" && ["gmail.com", "googlemail.com"].includes(externalDomain ?? "")) {
      const account = String(configuration.accountEmail ?? "").toLowerCase();
      if (!/^[^\s@]+@(gmail|googlemail)\.com$/.test(account) || account.split("@")[1] !== externalDomain) {
        throw new UnprocessableEntityException("Enter the exact Gmail address for this connection");
      }
    }

    const secretKeys = new Set([
      "secret",
      "clientsecret",
      "webhooksecret",
      "accesstoken",
      "refreshtoken",
      "apikey",
      "password",
      "credential",
      "credentials",
      "privatekey",
    ]);
    const inspect = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => inspect(item, `${path}[${index}]`));
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [key, nested] of Object.entries(value)) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
        if (secretKeys.has(normalizedKey)) {
          throw new UnprocessableEntityException(
            `Integration secrets cannot be stored in configuration (${path}.${key})`,
          );
        }
        inspect(nested, `${path}.${key}`);
      }
    };
    inspect(configuration, "configuration");
  }

  private async requireLegalEntity(
    client: PoolClient,
    workspaceId: string,
    entityId: string,
  ): Promise<LegalEntityRow> {
    const result = await client.query<LegalEntityRow>(
      `SELECT * FROM legal_entities
       WHERE id = $1 AND workspace_id = $2 AND status = 'active'`,
      [entityId, workspaceId],
    );
    if (!result.rowCount) throw new NotFoundException("Legal entity not found");
    return result.rows[0];
  }

  private async requirePendingBrandAsset(
    client: PoolClient,
    workspaceId: string,
    assetId: string,
  ): Promise<BrandAssetRow> {
    const result = await client.query<BrandAssetRow>(
      `SELECT * FROM workspace_brand_assets
       WHERE id = $1 AND workspace_id = $2 AND status = 'pending'`,
      [assetId, workspaceId],
    );
    if (!result.rowCount) throw new NotFoundException("Pending logo upload was not found");
    if (result.rows[0].upload_expires_at.getTime() <= Date.now()) {
      await client.query(
        `UPDATE workspace_brand_assets SET status = 'failed'
         WHERE id = $1 AND workspace_id = $2`,
        [assetId, workspaceId],
      );
      throw new GoneException("Logo upload expired; choose the file again");
    }
    return result.rows[0];
  }

  private async requireBusinessUnit(
    client: PoolClient,
    workspaceId: string,
    unitId: string,
  ): Promise<Record<string, unknown>> {
    const result = await client.query(
      `SELECT id, legal_entity_id AS "legalEntityId",
              parent_business_unit_id AS "parentBusinessUnitId",
              code, name, name AS "visibleName", type, timezone, color, status, version
       FROM business_units
       WHERE id = $1 AND workspace_id = $2 AND status = 'active'`,
      [unitId, workspaceId],
    );
    if (!result.rowCount) throw new NotFoundException("Business unit not found");
    return result.rows[0] as Record<string, unknown>;
  }

  private async resolvedTerminology(client: PoolClient, workspaceId: string) {
    const overrides = await client.query<WorkspaceTerminologyOverride>(
      `SELECT key, visible_name AS "visibleName", visible_name_plural AS "visibleNamePlural",
              version, updated_at AS "updatedAt"
       FROM workspace_terminology
       WHERE workspace_id = $1
       ORDER BY key`,
      [workspaceId],
    );
    return resolveWorkspaceTerminology(overrides.rows);
  }

  private async requireTeam(
    client: PoolClient,
    workspaceId: string,
    teamId: string,
  ): Promise<Record<string, unknown>> {
    const result = await client.query(
      `SELECT team.id, team.business_unit_id AS "businessUnitId", team.code,
              team.name, team.description, team.status, team.version,
              COALESCE(jsonb_agg(jsonb_build_object(
                'membershipId', membership.id,
                'userId', app_user.id,
                'displayName', app_user.display_name,
                'email', app_user.primary_email,
                'isLead', assigned.is_lead
              ) ORDER BY assigned.is_lead DESC, app_user.display_name)
                FILTER (WHERE membership.id IS NOT NULL), '[]'::jsonb) AS members
       FROM workspace_teams team
       LEFT JOIN workspace_team_members assigned ON assigned.team_id = team.id
       LEFT JOIN workspace_memberships membership ON membership.id = assigned.membership_id
       LEFT JOIN users app_user ON app_user.id = membership.user_id
       WHERE team.id = $1 AND team.workspace_id = $2 AND team.status = 'active'
       GROUP BY team.id`,
      [teamId, workspaceId],
    );
    if (!result.rowCount) throw new NotFoundException("Team not found");
    return result.rows[0] as Record<string, unknown>;
  }

  private async replaceTeamMembers(
    client: PoolClient,
    workspaceId: string,
    teamId: string,
    memberIds: string[],
    leadMembershipId: string | null,
  ): Promise<void> {
    if (leadMembershipId && !memberIds.includes(leadMembershipId)) {
      throw new UnprocessableEntityException("The team lead must be a team member");
    }
    if (memberIds.length) {
      const memberships = await client.query<{ id: string }>(
        `SELECT id FROM workspace_memberships
         WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
        [workspaceId, memberIds],
      );
      if (memberships.rowCount !== memberIds.length) {
        throw new UnprocessableEntityException("One or more team members are not active");
      }
    }
    await client.query("DELETE FROM workspace_team_members WHERE team_id = $1", [teamId]);
    for (const membershipId of memberIds) {
      await client.query(
        `INSERT INTO workspace_team_members (workspace_id, team_id, membership_id, is_lead)
         VALUES ($1, $2, $3, $4)`,
        [workspaceId, teamId, membershipId, membershipId === leadMembershipId],
      );
    }
  }

  private async assertBusinessUnitParent(
    client: PoolClient,
    workspaceId: string,
    legalEntityId: string,
    parentBusinessUnitId: string | null,
    unitId?: string,
  ): Promise<void> {
    await this.requireLegalEntity(client, workspaceId, legalEntityId);
    if (!parentBusinessUnitId) return;
    if (unitId && parentBusinessUnitId === unitId) {
      throw new UnprocessableEntityException("A business unit cannot be its own parent");
    }
    const parent = await client.query<{ legal_entity_id: string }>(
      `SELECT legal_entity_id FROM business_units
       WHERE id = $1 AND workspace_id = $2 AND status = 'active'`,
      [parentBusinessUnitId, workspaceId],
    );
    if (!parent.rowCount || parent.rows[0].legal_entity_id !== legalEntityId) {
      throw new UnprocessableEntityException(
        "The parent business unit must belong to the same active legal entity",
      );
    }
    if (unitId) {
      const cycle = await client.query(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM business_units WHERE parent_business_unit_id = $1
           UNION ALL
           SELECT child.id
           FROM business_units child
           JOIN descendants parent ON child.parent_business_unit_id = parent.id
         )
         SELECT 1 FROM descendants WHERE id = $2 LIMIT 1`,
        [unitId, parentBusinessUnitId],
      );
      if (cycle.rowCount) {
        throw new UnprocessableEntityException("Business unit hierarchy cannot contain a cycle");
      }
    }
  }

  private async resolvePermissions(client: PoolClient, permissionCodes: string[]) {
    const permissions = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM permissions WHERE code = ANY($1::text[])`,
      [permissionCodes],
    );
    if (permissions.rowCount !== permissionCodes.length) {
      const found = new Set(permissions.rows.map((permission) => permission.code));
      throw new UnprocessableEntityException({
        message: "One or more permission codes are invalid",
        invalidPermissionCodes: permissionCodes.filter((code) => !found.has(code)),
      });
    }
    return permissions;
  }

  private async resolveRoles(client: PoolClient, workspaceId: string, roleCodes: string[]) {
    const roles = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM roles WHERE workspace_id = $1 AND code = ANY($2::text[])`,
      [workspaceId, roleCodes],
    );
    if (roles.rowCount !== roleCodes.length) {
      const found = new Set(roles.rows.map((role) => role.code));
      throw new UnprocessableEntityException({
        message: "One or more workspace roles are invalid",
        invalidRoleCodes: roleCodes.filter((code) => !found.has(code)),
      });
    }
    return roles;
  }

  private async requireRole(
    client: PoolClient,
    workspaceId: string,
    roleId: string,
  ): Promise<Record<string, unknown>> {
    const lock = await client.query(
      "SELECT id FROM roles WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
      [roleId, workspaceId],
    );
    if (!lock.rowCount) throw new NotFoundException("Role not found");
    const result = await client.query(
      `SELECT role.id, role.code, role.name, role.description,
              role.is_system AS "isSystem", role.version,
              COALESCE(array_agg(permission.code ORDER BY permission.code)
                FILTER (WHERE permission.code IS NOT NULL), ARRAY[]::varchar[]) AS permissions
       FROM roles role
       LEFT JOIN role_permissions granted ON granted.role_id = role.id
       LEFT JOIN permissions permission ON permission.id = granted.permission_id
       WHERE role.id = $1 AND role.workspace_id = $2
       GROUP BY role.id`,
      [roleId, workspaceId],
    );
    return result.rows[0] as Record<string, unknown>;
  }

  private async requireMember(
    client: PoolClient,
    workspaceId: string,
    membershipId: string,
    lock = false,
  ): Promise<Record<string, unknown>> {
    if (lock) {
      const locked = await client.query(
        `SELECT id FROM workspace_memberships
         WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [membershipId, workspaceId],
      );
      if (!locked.rowCount) throw new NotFoundException("Member not found");
    }
    const result = await client.query(
      `SELECT membership.id, membership.status, membership.joined_at AS "joinedAt",
              membership.version, app_user.id AS "userId",
              app_user.primary_email AS email, app_user.display_name AS "displayName",
              COALESCE(array_agg(role.code ORDER BY role.code)
                FILTER (WHERE role.code IS NOT NULL), ARRAY[]::varchar[]) AS roles
       FROM workspace_memberships membership
       JOIN users app_user ON app_user.id = membership.user_id
       LEFT JOIN member_roles assigned ON assigned.membership_id = membership.id
       LEFT JOIN roles role ON role.id = assigned.role_id
       WHERE membership.id = $1 AND membership.workspace_id = $2
       GROUP BY membership.id, app_user.id`,
      [membershipId, workspaceId],
    );
    if (!result.rowCount) throw new NotFoundException("Member not found");
    return result.rows[0] as Record<string, unknown>;
  }

  private async assertAnotherActiveOwner(
    client: PoolClient,
    workspaceId: string,
    excludedMembershipId: string,
  ): Promise<void> {
    const owners = await client.query<{ count: number }>(
      `SELECT count(DISTINCT membership.id)::int AS count
       FROM workspace_memberships membership
       JOIN member_roles assigned ON assigned.membership_id = membership.id
       JOIN roles role ON role.id = assigned.role_id
       WHERE membership.workspace_id = $1
         AND membership.id <> $2
         AND membership.status = 'active'
         AND role.code = 'owner'`,
      [workspaceId, excludedMembershipId],
    );
    if (owners.rows[0].count < 1) {
      throw new ConflictException("The workspace must retain at least one active owner");
    }
  }

  private async requirePendingInvitation(
    client: PoolClient,
    workspaceId: string,
    invitationId: string,
  ): Promise<Record<string, unknown>> {
    const result = await client.query(
      `SELECT id, email, status, expires_at AS "expiresAt", created_at AS "createdAt"
       FROM workspace_invitations
       WHERE id = $1 AND workspace_id = $2 AND status = 'pending'
       FOR UPDATE`,
      [invitationId, workspaceId],
    );
    if (!result.rowCount) throw new NotFoundException("Pending invitation not found");
    return result.rows[0] as Record<string, unknown>;
  }

  private async requireIntegrationConnection(
    client: PoolClient,
    workspaceId: string,
    connectionId: string,
  ): Promise<Record<string, unknown>> {
    const result = await client.query(
      `SELECT id, legal_entity_id AS "legalEntityId", provider,
              display_name AS "displayName", external_domain AS "externalDomain",
              status, configuration, version, revoked_at AS "revokedAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM integration_connections
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE`,
      [connectionId, workspaceId],
    );
    if (!result.rowCount) throw new NotFoundException("Integration connection not found");
    return result.rows[0] as Record<string, unknown>;
  }

  private async acceptInvitationRecord(
    client: PoolClient,
    actorUser: ActorUser,
    invitationId: string,
  ) {
    await this.lockWorkspaceByInvitation(client, invitationId);
    const locked = await client.query<{
      id: string;
      workspace_id: string;
      email: string;
      status: string;
      expires_at: Date;
    }>(
      `SELECT id, workspace_id, email, status, expires_at
       FROM workspace_invitations WHERE id = $1 FOR UPDATE`,
      [invitationId],
    );
    if (!locked.rowCount) throw new NotFoundException("Invitation not found");
    const invitation = locked.rows[0];
    if (invitation.email.toLowerCase() !== actorUser.email.toLowerCase()) {
      throw new ForbiddenException("This invitation belongs to another email address");
    }
    if (invitation.status !== "pending") {
      throw new ConflictException(`Invitation is already ${invitation.status}`);
    }
    if (new Date(invitation.expires_at).getTime() <= Date.now()) {
      throw new GoneException("Invitation has expired");
    }
    await this.assertSeatAvailable(client, invitation.workspace_id, invitation.id);
    const membership = await client.query<{ id: string }>(
      `INSERT INTO workspace_memberships
        (workspace_id, user_id, status, joined_at)
       VALUES ($1, $2, 'active', now())
       ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET status = 'active', joined_at = COALESCE(workspace_memberships.joined_at, now())
       RETURNING id`,
      [invitation.workspace_id, actorUser.userId],
    );
    await client.query(
      `INSERT INTO member_roles (workspace_id, membership_id, role_id)
       SELECT $1, $2, role_id
       FROM invitation_roles
       WHERE invitation_id = $3
       ON CONFLICT (membership_id, role_id) DO NOTHING`,
      [invitation.workspace_id, membership.rows[0].id, invitation.id],
    );
    await client.query(
      `UPDATE workspace_invitations
       SET status = 'accepted', accepted_at = now()
       WHERE id = $1`,
      [invitation.id],
    );
    await this.recordChange(client, {
      workspaceId: invitation.workspace_id,
      actorUserId: actorUser.userId,
      action: "workspace.invitation_accepted",
      entityType: "workspace_membership",
      entityId: membership.rows[0].id,
      after: { invitationId: invitation.id, email: invitation.email },
    });
    return {
      workspaceId: invitation.workspace_id,
      membershipId: membership.rows[0].id,
      status: "active",
    };
  }

  private async lockWorkspaceByInvitation(
    client: PoolClient,
    invitationId: string,
  ): Promise<void> {
    const lock = await client.query(
      `SELECT workspace.id
       FROM workspaces workspace
       JOIN workspace_invitations invitation ON invitation.workspace_id = workspace.id
       WHERE invitation.id = $1 AND workspace.status = 'active'
       FOR UPDATE OF workspace`,
      [invitationId],
    );
    if (!lock.rowCount) throw new NotFoundException("Invitation not found");
  }

  private async requireWorkspace(client: PoolClient, workspaceId: string): Promise<WorkspaceRow> {
    const result = await client.query<WorkspaceRow>(
      "SELECT * FROM workspaces WHERE id = $1 AND status <> 'archived'",
      [workspaceId],
    );
    if (!result.rowCount) throw new NotFoundException("Workspace not found");
    return result.rows[0];
  }

  private async lockWorkspace(client: PoolClient, workspaceId: string): Promise<void> {
    const lock = await client.query(
      "SELECT id FROM workspaces WHERE id = $1 AND status = 'active' FOR UPDATE",
      [workspaceId],
    );
    if (!lock.rowCount) throw new NotFoundException("Workspace not found");
  }

  private async assertSeatAvailable(
    client: PoolClient,
    workspaceId: string,
    excludeInvitationId: string | null = null,
  ): Promise<void> {
    const capacity = await client.query<{
      seatLimit: number;
      activeMembers: number;
      pendingInvitations: number;
    }>(
      `SELECT subscription.seat_limit AS "seatLimit",
              (SELECT count(*)::int
               FROM workspace_memberships membership
               WHERE membership.workspace_id = subscription.workspace_id
                 AND membership.status IN ('active', 'invited')) AS "activeMembers",
              (SELECT count(*)::int
               FROM workspace_invitations invitation
               WHERE invitation.workspace_id = subscription.workspace_id
                 AND invitation.status = 'pending'
                 AND invitation.expires_at > now()
                 AND ($2::uuid IS NULL OR invitation.id <> $2::uuid)) AS "pendingInvitations"
       FROM workspace_subscriptions subscription
       WHERE subscription.workspace_id = $1`,
      [workspaceId, excludeInvitationId],
    );
    if (!capacity.rowCount) {
      throw new ConflictException("Workspace subscription is not configured");
    }
    const usage = capacity.rows[0];
    const usedSeats = usage.activeMembers + usage.pendingInvitations;
    if (usedSeats >= usage.seatLimit) {
      throw new ConflictException({
        message: "Workspace seat limit reached",
        seatLimit: usage.seatLimit,
        usedSeats,
        activeMembers: usage.activeMembers,
        pendingInvitations: usage.pendingInvitations,
      });
    }
  }

  private async insertLegalEntity(
    client: PoolClient,
    workspaceId: string,
    entityId: string,
    input: CreateLegalEntityDto,
  ): Promise<LegalEntityRow> {
    const result = await client.query<LegalEntityRow>(
      `INSERT INTO legal_entities
        (id, workspace_id, code, display_name, registered_name, country_code,
         base_currency, locale, timezone, tax_registration_number,
         registration_number, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        entityId,
        workspaceId,
        input.code,
        input.displayName,
        input.registeredName,
        input.countryCode,
        input.baseCurrency,
        input.locale,
        input.timezone,
        input.taxRegistrationNumber ?? null,
        input.registrationNumber ?? null,
        input.address ?? {},
      ],
    );
    return result.rows[0];
  }

  private async insertSystemRoles(
    client: PoolClient,
    workspaceId: string,
  ): Promise<Map<string, string>> {
    const roleIds = new Map<string, string>();
    for (const [code, name, description] of SYSTEM_ROLES) {
      const roleId = randomUUID();
      roleIds.set(code, roleId);
      await client.query(
        `INSERT INTO roles (id, workspace_id, code, name, description, is_system)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [roleId, workspaceId, code, name, description],
      );
    }
    for (const roleCode of ["owner", "administrator"] as const) {
      await client.query(
        `INSERT INTO role_permissions (workspace_id, role_id, permission_id)
         SELECT $1, $2, id FROM permissions`,
        [workspaceId, roleIds.get(roleCode)],
      );
    }
    for (const roleCode of ["member", "viewer"] as const) {
      await client.query(
        `INSERT INTO role_permissions (workspace_id, role_id, permission_id)
         SELECT $1, $2, id FROM permissions
         WHERE code IN ('legal_entities.view', 'integrations.view', 'catalog.view')
            OR code LIKE 'module.%.read'
            OR ($3 = 'member' AND code IN ('hrms.self', 'projects.view', 'projects.report'))`,
        [workspaceId, roleIds.get(roleCode), roleCode],
      );
    }
    return roleIds;
  }

  private async insertOnboarding(
    client: PoolClient,
    workspaceId: string,
  ): Promise<OnboardingRow> {
    const result = await client.query<OnboardingRow>(
      `INSERT INTO workspace_onboarding (workspace_id)
       VALUES ($1)
       RETURNING *`,
      [workspaceId],
    );
    return result.rows[0];
  }

  private async requireOnboarding(
    client: PoolClient,
    workspaceId: string,
    lock = false,
  ): Promise<OnboardingRow> {
    const result = await client.query<OnboardingRow>(
      `SELECT * FROM workspace_onboarding
       WHERE workspace_id = $1${lock ? " FOR UPDATE" : ""}`,
      [workspaceId],
    );
    if (!result.rowCount) throw new NotFoundException("Workspace onboarding state not found");
    return result.rows[0];
  }

  private async insertDefaultSequences(
    client: PoolClient,
    workspaceId: string,
    legalEntityId: string,
    entityCode: string,
  ): Promise<void> {
    for (const documentType of ["QUOTATION", "INVOICE", "PURCHASE_ORDER"]) {
      const shortCode = documentType === "PURCHASE_ORDER" ? "PO" : documentType.slice(0, 3);
      await client.query(
        `INSERT INTO document_sequences
          (workspace_id, legal_entity_id, document_type, prefix)
         VALUES ($1, $2, $3, $4)`,
        [workspaceId, legalEntityId, documentType, `${entityCode}-${shortCode}-`],
      );
    }
  }

  private async insertDefaultCrmAutomations(client: PoolClient, workspaceId: string): Promise<void> {
    for (const template of DEFAULT_CRM_AUTOMATION_TEMPLATES) {
      const definitionId = randomUUID();
      const versionId = randomUUID();
      const serialized = JSON.stringify(template.definition);
      await client.query(
        `INSERT INTO automation_definitions
          (id,workspace_id,code,name,description,status,run_once_per_aggregate)
         VALUES ($1,$2,$3,$4,$5,'draft',$6)
         ON CONFLICT (workspace_id,code) DO NOTHING`,
        [definitionId, workspaceId, template.code, template.name, template.description, template.runOncePerAggregate],
      );
      await client.query(
        `INSERT INTO automation_versions
          (id,workspace_id,definition_id,version_number,definition,checksum)
         SELECT $1,$2,$3,1,$4,$5
         WHERE EXISTS (SELECT 1 FROM automation_definitions WHERE workspace_id=$2 AND id=$3)
         ON CONFLICT (workspace_id,definition_id,version_number) DO NOTHING`,
        [versionId, workspaceId, definitionId, template.definition, createHash("sha256").update(serialized).digest("hex")],
      );
    }
  }

  private async recordChange(
    client: PoolClient,
    change: {
      workspaceId: string;
      actorUserId: string | null;
      source?: "user" | "internal";
      action: string;
      entityType: string;
      entityId: string;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    },
  ): Promise<void> {
    const eventId = randomUUID();
    const correlationId = randomUUID();
    const occurredAt = new Date().toISOString();
    const payload = {
      schemaVersion: 1,
      eventId,
      workspaceId: change.workspaceId,
      aggregateType: change.entityType,
      aggregateId: change.entityId,
        actorUserId: change.actorUserId,
      occurredAt,
      correlationId,
      causationId: null,
      data: change.after ?? {},
    };
    await client.query(
      `INSERT INTO audit_events
        (id, workspace_id, actor_user_id, source, action, entity_type, entity_id,
         before, after, correlation_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        eventId,
        change.workspaceId,
        change.actorUserId,
        change.source ?? "user",
        change.action,
        change.entityType,
        change.entityId,
        change.before ?? null,
        change.after ?? null,
        correlationId,
        occurredAt,
      ],
    );
    await client.query(
      `INSERT INTO outbox_events
        (id, workspace_id, aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        eventId,
        change.workspaceId,
        change.entityType,
        change.entityId,
        change.action,
        payload,
      ],
    );
  }

  private mapWorkspace(row: WorkspaceRow): Record<string, unknown> {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      defaultCurrency: row.default_currency,
      defaultLocale: row.default_locale,
      defaultTimezone: row.default_timezone,
      unitSystem: row.unit_system,
      weekStartsOn: row.week_starts_on,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapBranding(
    loginSlug: string,
    row?: { logoAssetId: string | null; logoUpdatedAt: Date | null },
  ) {
    return {
      logoAssetId: row?.logoAssetId ?? null,
      logoUrl: row?.logoAssetId
        ? `/api/auth/tenant-logo/${loginSlug}?v=${row.logoAssetId}`
        : null,
      logoUpdatedAt: row?.logoUpdatedAt ?? null,
    };
  }

  private mapLegalEntity(row: LegalEntityRow): Record<string, unknown> {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      code: row.code,
      displayName: row.display_name,
      registeredName: row.registered_name,
      countryCode: row.country_code,
      baseCurrency: row.base_currency,
      locale: row.locale,
      timezone: row.timezone,
      taxRegistrationNumber: row.tax_registration_number,
      registrationNumber: row.registration_number,
      address: row.address,
      status: row.status,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapOnboarding(row: OnboardingRow): Record<string, unknown> {
    return {
      workspaceId: row.workspace_id,
      status: row.status,
      currentStep: row.current_step === "complete" ? null : row.current_step,
      completedSteps: row.completed_steps,
      version: row.version,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }

  private toSlug(value: string): string {
    const slug = value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70);
    return slug || `workspace-${randomUUID().slice(0, 8)}`;
  }

  private rethrowConstraint(error: unknown, message: string): never {
    const code = typeof error === "object" && error && "code" in error
      ? String(error.code)
      : undefined;
    if (code === "23505") throw new ConflictException(message);
    if (["23503", "23514"].includes(code ?? "")) {
      throw new UnprocessableEntityException(message);
    }
    throw error;
  }
}
