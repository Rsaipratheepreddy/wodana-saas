import { MemberProfileService } from "./member-profile.service";
import { loadInboxViewer } from "../crm/conversations/inbox/inbox-visibility";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { seedDefaultQuickReplies } from "../crm/conversations/inbox/default-quick-replies";
import { acceptPendingInvitation } from "./invitation-acceptance";
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
import { checkTaxNumber, normaliseTaxNumber, readTaxNumberRuleFor } from "../purchasing/tax-registration";
import { entityImageUrl } from "./entity-letterhead";
import { ActorUser, RequestActor } from "../auth/actor";
import { IdentityService } from "../auth/identity.service";
import { DatabaseService } from "../database/database.service";
import { writeBlockFor } from "../auth/tenant-write-block.guard";
import { CreateIntegrationConnectionDto } from "../integrations/dto/create-integration-connection.dto";
import { UpdateIntegrationConnectionDto } from "../integrations/dto/update-integration-connection.dto";
import { CreateBusinessUnitDto } from "./dto/create-business-unit.dto";
import { CreateTeamDto } from "./dto/create-team.dto";
import { CreateLegalEntityDto } from "./dto/create-legal-entity.dto";
import { CreateRoleDto } from "./dto/create-role.dto";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { InviteMemberDto } from "./dto/invite-member.dto";
import { ProvisionTenantDto } from "./dto/provision-tenant.dto";
import type { TenantContractContactDto, TenantSetupSelectionsDto } from "./dto/tenant-provisioning-draft.dto";
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
import { UpdateWorkspaceAppearanceDto } from "./dto/update-workspace-appearance.dto";
import { UpdateHomeLayoutDto } from "./dto/update-home-layout.dto";
import { readHomeOverview } from "./home-overview";
import { readHomeMetrics } from "./home-metrics";
import { readHomeSummary } from "./home-summary";
import { WorkspaceAccessService } from "./workspace-access.service";
import { DEFAULT_CRM_AUTOMATION_TEMPLATES } from "../crm/automations/default-automation-templates";
import { parseProjectWorkflowTemplate } from "../projects/project-workflow";
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
import { ConfigurationRevisionsService } from "./configuration-revisions.service";
import { invitationGreetingName, placeholderDisplayName } from "./invitation-recipient";
import { parseRoleTemplateCodes, ROLE_TEMPLATE_CODES, roleTemplatesFor } from "./role-templates";
import { describeAccess, expandAccess } from "./access-levels";
import { parseSalesPipelineTemplate, seedDefaultSalesPipeline } from "../crm/default-sales-pipeline";
import { seedKitPaymentPlan } from "../commercial/default-payment-plan";
import { RestoreConfigurationRevisionDto } from "./dto/restore-configuration-revision.dto";

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
  phone: string | null;
  email: string | null;
  logo_asset_id: string | null;
  letterhead_asset_id: string | null;
  letterhead_footer: string | null;
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
/** The roles every workspace is made with, whatever its kit. */
export const SYSTEM_ROLE_CODES: readonly string[] = SYSTEM_ROLES.map(([code]) => code);


@Injectable()
export class WorkspacesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly identities: IdentityService,
    private readonly access: WorkspaceAccessService,
    private readonly brandStorage: BrandAssetStorageService,
    private readonly transactionalEmail: TransactionalEmailService,
    private readonly revisions: ConfigurationRevisionsService = new ConfigurationRevisionsService(),
  ) {}

  async create(actor: RequestActor, input: CreateWorkspaceDto) {
    const actorUser = await this.identities.resolveActor(actor);
    const accountId = randomUUID();
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
          await this.insertRoleTemplates(client, workspaceId, parseRoleTemplateCodes(undefined));
          await client.query(
            `INSERT INTO member_roles (workspace_id, membership_id, role_id)
             VALUES ($1, $2, $3)`,
            [workspaceId, membershipId, roleIds.get("owner")],
          );

          await this.insertOnboarding(client, workspaceId);
          await this.insertDefaultSequences(client, workspaceId, legalEntityId, input.firstLegalEntity.code);
          await this.insertDefaultCrmAutomations(client, workspaceId);
          await seedDefaultSalesPipeline(client, workspaceId, parseSalesPipelineTemplate(undefined));
          await seedDefaultNotificationTemplates(client, workspaceId);
          await seedDefaultQuickReplies(client, workspaceId);
          await client.query(
            `INSERT INTO workspace_subscriptions (workspace_id, currency, renews_at)
             VALUES ($1, $2, now() + interval '14 days')`,
            [workspaceId, input.defaultCurrency],
          );
          await this.insertCustomerAccountFoundation(client, {
            accountId,
            workspaceId,
            ownerUserId: actorUser.userId,
            displayName: input.name,
            externalCustomerId: null,
          });
          await this.recordChange(client, {
            workspaceId,
            actorUserId: actorUser.userId,
            action: "workspace.created",
            entityType: "workspace",
            entityId: workspaceId,
            after: this.mapWorkspace(workspace.rows[0]),
          });

          return {
            account: {
              id: accountId,
              displayName: input.name,
              organizationLimit: 1,
              isDefaultOrganization: true,
            },
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

  async provisionTenant(
    input: ProvisionTenantDto & { account?: TenantContractContactDto; defaults?: TenantSetupSelectionsDto }, suppliedIdempotencyKey?: string,
    operatorUserId?: string, correlationId?: string,
  ) {
    let idempotencyKey: string;
    try {
      idempotencyKey = assertValidIdempotencyKey(suppliedIdempotencyKey);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const requestHash = provisioningRequestHash(input);
    const accountId = randomUUID();
    const workspaceId = randomUUID();
    const legalEntityId = randomUUID();
    const invitationId = randomUUID();
    const auditCorrelationId = correlationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(correlationId)
      ? correlationId : randomUUID();
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
            replayed: true as const,
            ownerInvitation: {
              ...(replay.ownerInvitation as Record<string, unknown>),
              invitationToken: null,
              tokenNotice: "Token omitted on replay; explicitly rotate it if the original was lost.",
            },
          };
        }

        if (Boolean(input.account) !== Boolean(input.defaults)) {
          throw new BadRequestException("Account contact and setup versions must be supplied together");
        }
        const setup = input.defaults ? await this.resolveTenantSetup(client, input.defaults) : null;
        if (setup) {
          const region = setup.region.configuration;
          if (input.defaultCurrency !== region.currency || input.defaultLocale !== region.locale
            || input.defaultTimezone !== region.timezone || input.unitSystem !== region.unitSystem
            || input.weekStartsOn !== region.weekStartsOn
            || input.firstLegalEntity.countryCode !== region.countryCode) {
            throw new BadRequestException("Organization regional defaults do not match the pinned region version");
          }
        }

        const insertedOwner = await client.query<{ id: string }>(
          `INSERT INTO users (primary_email, display_name, preferred_locale, preferred_timezone)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (primary_email) DO NOTHING
           RETURNING id`,
          [input.owner.email, input.owner.displayName, input.defaultLocale, input.defaultTimezone],
        );
        const existingOwner = insertedOwner.rowCount ? null : await client.query<{ id: string }>(
          `SELECT id FROM users WHERE primary_email = $1`, [input.owner.email],
        );
        const ownerUserId = insertedOwner.rows[0]?.id ?? existingOwner?.rows[0]?.id;
        if (!ownerUserId) throw new ConflictException("Owner identity could not be resolved");
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
        // The firm kit says which people a firm of this kind employs; without a kit, every template.
        await this.insertRoleTemplates(client, workspaceId, parseRoleTemplateCodes(setup?.firmKit.configuration.roleTemplates));
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
        await client.query(
          `INSERT INTO workspace_invitation_delivery (invitation_id, workspace_id)
           VALUES ($1, $2)`,
          [invitationId, workspaceId],
        );
        const onboarding = await this.insertOnboarding(client, workspaceId);
        await this.insertDefaultSequences(
          client,
          workspaceId,
          legalEntityId,
          input.firstLegalEntity.code,
        );
        await this.insertDefaultCrmAutomations(client, workspaceId);
        await seedDefaultNotificationTemplates(client, workspaceId);
        await seedDefaultQuickReplies(client, workspaceId);
        // The kit's Sales pipeline, so a salesperson's first conversion needs no CRM-settings permission.
        await seedDefaultSalesPipeline(client, workspaceId, parseSalesPipelineTemplate(setup?.firmKit.configuration.salesPipeline));
        if (setup) {
          // The kit's payment plan becomes the workspace's default for new quotes (Q-34).
          await seedKitPaymentPlan(client, workspaceId, (setup.firmKit.configuration as Record<string, unknown>).paymentTemplate);
          const workflow = parseProjectWorkflowTemplate(setup.firmKit.configuration.projectWorkflow);
          await client.query(
            `INSERT INTO project_workflow_templates
               (workspace_id, code, name, description, is_default, version, stages, created_by)
             VALUES ($1, $2, $3, $4, true, $5, $6, $7)`,
            [workspaceId, workflow.code, workflow.name, workflow.description,
              workflow.version, JSON.stringify(workflow.stages), ownerUserId],
          );
        }

        const workspaceResponse = this.mapWorkspace(workspace.rows[0]);
        if (setup) {
          const plan = setup.plan.configuration;
          await client.query(
            `INSERT INTO workspace_subscriptions
              (workspace_id, plan_code, billing_cycle, seat_limit, project_limit, currency, renews_at)
             VALUES ($1, $2, $3, $4, $5, $6, now() + interval '14 days')`,
            [workspaceId, input.defaults!.plan.code, plan.billingCycle, input.defaults!.seatLimit ?? plan.seatLimit, plan.projectLimit, input.defaultCurrency],
          );
          await client.query(
            `INSERT INTO workspace_setup_versions
              (workspace_id, region_code, region_version, firm_kit_code, firm_kit_version,
               plan_code, plan_version, configuration_snapshot)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [workspaceId, input.defaults!.region.code, input.defaults!.region.version,
              input.defaults!.firmKit.code, input.defaults!.firmKit.version,
              input.defaults!.plan.code, input.defaults!.plan.version, setup],
          );
        } else {
          await client.query(
            `INSERT INTO workspace_subscriptions (workspace_id, currency, renews_at)
             VALUES ($1, $2, now() + interval '14 days')`,
            [workspaceId, input.defaultCurrency],
          );
        }
        await this.insertCustomerAccountFoundation(client, {
          accountId,
          workspaceId,
          ownerUserId,
          displayName: input.account?.displayName ?? input.name,
          externalCustomerId: input.externalTenantId,
          contractContactName: input.account?.contactName ?? null,
          contractContactEmail: input.account?.contactEmail ?? null,
        });
        if (setup) {
          const plan = setup.plan.configuration;
          await client.query(
            `INSERT INTO customer_account_contracts
              (account_id, plan_code, plan_version, currency, billing_cycle,
               seat_limit, project_limit, trial_ends_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '14 days')`,
            [accountId, input.defaults!.plan.code, input.defaults!.plan.version,
              input.defaultCurrency, plan.billingCycle, input.defaults!.seatLimit ?? plan.seatLimit, plan.projectLimit],
          );
        }
        const legalEntityResponse = this.mapLegalEntity(legalEntity);
        const onboardingResponse = this.mapOnboarding(onboarding);
        const safeResponse = {
          externalTenantId: input.externalTenantId,
          account: {
            id: accountId,
            displayName: input.account?.displayName ?? input.name,
            organizationLimit: 1,
            isDefaultOrganization: true,
            contractContactName: input.account?.contactName ?? null,
            contractContactEmail: input.account?.contactEmail ?? null,
            contractStatus: setup ? "trial_uncontracted" : null,
            contractPlanCode: input.defaults?.plan.code ?? null,
            contractPlanVersion: input.defaults?.plan.version ?? null,
          },
          workspace: workspaceResponse,
          legalEntity: legalEntityResponse,
          ownerInvitation: {
            id: invitationId,
            email: input.owner.email,
            role: "owner",
            status: "pending",
            expiresAt,
            acceptedAt: null,
            deliveryStatus: "not_requested",
            invitationToken: null,
            tokenNotice: "Token returned only on initial provisioning or explicit rotation.",
          },
          onboarding: onboardingResponse,
          setupVersions: input.defaults ?? null,
          replayed: false,
        };

        await this.recordChange(client, {
          workspaceId,
          actorUserId: operatorUserId ?? null,
          source: "internal",
          action: "workspace.provisioned",
          entityType: "workspace",
          entityId: workspaceId,
          correlationId: auditCorrelationId,
          after: { ...workspaceResponse, externalTenantId: input.externalTenantId },
        });
        await this.recordChange(client, {
          workspaceId,
          actorUserId: operatorUserId ?? null,
          source: "internal",
          action: "workspace.owner_invited",
          entityType: "workspace_invitation",
          entityId: invitationId,
          correlationId: auditCorrelationId,
          after: { email: input.owner.email, role: "owner", expiresAt },
        });
        await client.query(
          `INSERT INTO tenant_provisioning_requests
            (external_tenant_id, idempotency_key, request_hash, workspace_id,
             response_body, expires_at)
           VALUES ($1, $2, $3, $4, $5, now() + interval '30 days')`,
          [input.externalTenantId, idempotencyKey, requestHash, workspaceId, safeResponse],
        );
        if (operatorUserId) {
          await client.query(
            `INSERT INTO platform_operator_audit
               (actor_user_id, action, target_type, target_id, correlation_id, details)
             VALUES ($1, 'tenant.provisioned', 'tenant', $2, $3, $4)`,
            [operatorUserId, input.externalTenantId, auditCorrelationId,
              { workspaceId, accountId }],
          );
        }

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

  async provisionApprovedOrganization(
    client: PoolClient,
    input: CreateWorkspaceDto,
    ownerUserId: string,
    accountId: string,
  ) {
    const workspaceId = randomUUID();
    const legalEntityId = randomUUID();
    const membershipId = randomUUID();
    const slug = input.slug ?? this.toSlug(input.name);

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
    await client.query(
      `INSERT INTO workspace_memberships
        (id, workspace_id, user_id, status, joined_at)
       VALUES ($1, $2, $3, 'active', now())`,
      [membershipId, workspaceId, ownerUserId],
    );
    const roleIds = await this.insertSystemRoles(client, workspaceId);
    await this.insertRoleTemplates(client, workspaceId, parseRoleTemplateCodes(undefined));
    await client.query(
      `INSERT INTO member_roles (workspace_id, membership_id, role_id)
       VALUES ($1, $2, $3)`,
      [workspaceId, membershipId, roleIds.get("owner")],
    );
    const onboarding = await this.insertOnboarding(client, workspaceId);
    await this.insertDefaultSequences(
      client,
      workspaceId,
      legalEntityId,
      input.firstLegalEntity.code,
    );
    await this.insertDefaultCrmAutomations(client, workspaceId);
    await seedDefaultSalesPipeline(client, workspaceId, parseSalesPipelineTemplate(undefined));
          await seedDefaultNotificationTemplates(client, workspaceId);
    await seedDefaultQuickReplies(client, workspaceId);
    await client.query(
      `INSERT INTO workspace_subscriptions (workspace_id, currency, renews_at)
       VALUES ($1, $2, now() + interval '14 days')`,
      [workspaceId, input.defaultCurrency],
    );
    await client.query(
      `INSERT INTO customer_account_organizations (account_id, workspace_id, is_default)
       VALUES ($1, $2, false)`,
      [accountId, workspaceId],
    );
    await this.recordChange(client, {
      workspaceId,
      actorUserId: null,
      source: "internal",
      action: "customer_account.organization_provisioned",
      entityType: "workspace",
      entityId: workspaceId,
      after: { ...this.mapWorkspace(workspace.rows[0]), accountId, isDefaultOrganization: false },
    });
    return {
      workspace: this.mapWorkspace(workspace.rows[0]),
      legalEntity: this.mapLegalEntity(legalEntity),
      onboarding: this.mapOnboarding(onboarding),
      membership: { id: membershipId, role: "owner", status: "active" },
    };
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
        deliveryStatus: string;
        deliveryAttempts: number;
        deliveryAttemptedAt: Date | null;
        providerMessageId: string | null;
      }>(
        `SELECT invitation.id, invitation.email,
                CASE WHEN invitation.status = 'pending' AND invitation.expires_at <= now()
                     THEN 'expired' ELSE invitation.status::text END AS status,
                invitation.expires_at AS "expiresAt", invitation.accepted_at AS "acceptedAt",
                COALESCE(delivery.status, 'untracked') AS "deliveryStatus",
                COALESCE(delivery.attempts, 0) AS "deliveryAttempts",
                delivery.last_attempted_at AS "deliveryAttemptedAt",
                delivery.provider_message_id AS "providerMessageId"
         FROM workspace_invitations invitation
         LEFT JOIN workspace_invitation_delivery delivery ON delivery.invitation_id = invitation.id
         WHERE invitation.id = $1 AND invitation.workspace_id = $2`,
        [ownerInvitationId, workspaceId],
      );
      if (!invitation.rowCount) throw new NotFoundException("Owner invitation not found");
      const account = await client.query<{
        id: string;
        displayName: string;
        contractContactName: string | null;
        contractContactEmail: string | null;
        contractStatus: string | null;
        contractPlanCode: string | null;
        contractPlanVersion: number | null;
        organizationLimit: number;
        version: number;
        isDefaultOrganization: boolean;
      }>(
        `SELECT account.id, account.display_name AS "displayName",
                account.contract_contact_name AS "contractContactName",
                account.contract_contact_email AS "contractContactEmail",
                contract.status AS "contractStatus", contract.plan_code AS "contractPlanCode",
                contract.plan_version AS "contractPlanVersion",
                account.organization_limit AS "organizationLimit", account.version,
                linked.is_default AS "isDefaultOrganization"
         FROM customer_account_organizations linked
         JOIN customer_accounts account ON account.id = linked.account_id
         LEFT JOIN customer_account_contracts contract ON contract.account_id = account.id
         WHERE linked.workspace_id = $1`,
        [workspaceId],
      );
      return {
        account: account.rows[0] ?? null,
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

  async resendProvisionedOwnerInvitation(
    externalTenantId: string, operatorUserId?: string, correlationId?: string,
    suppliedIdempotencyKey?: string,
  ) {
    let idempotencyKey: string | null = null;
    if (suppliedIdempotencyKey !== undefined) {
      try { idempotencyKey = assertValidIdempotencyKey(suppliedIdempotencyKey); }
      catch (error) { throw new BadRequestException((error as Error).message); }
    }
    const auditCorrelationId = correlationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(correlationId)
      ? correlationId : randomUUID();
    const provisioned = await this.database.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM tenant_provisioning_requests WHERE external_tenant_id = $1`,
      [externalTenantId],
    );
    if (!provisioned.rowCount) throw new NotFoundException("Provisioned tenant not found");
    const workspaceId = provisioned.rows[0].workspace_id;
    const rotated = await this.database.tenantTransaction(workspaceId, operatorUserId ?? workspaceId, async (client) => {
      await this.lockWorkspace(client, workspaceId);
      const pending = await client.query<{ id: string; email: string; recipientName: string | null; workspaceName: string; expiresAt: Date }>(
        `SELECT invitation.id, invitation.email, app_user.display_name AS "recipientName",
                workspace.name AS "workspaceName", invitation.expires_at AS "expiresAt"
         FROM workspace_invitations invitation
         JOIN invitation_roles assigned ON assigned.invitation_id = invitation.id
         JOIN roles role ON role.id = assigned.role_id
         JOIN workspaces workspace ON workspace.id = invitation.workspace_id
         LEFT JOIN users app_user ON app_user.primary_email = invitation.email
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
      if (idempotencyKey) {
        const prior = await client.query<{ status: string; providerMessageId: string | null }>(
          `SELECT status, provider_message_id AS "providerMessageId"
           FROM workspace_invitation_delivery_commands
           WHERE invitation_id = $1 AND idempotency_key = $2`,
          [pending.rows[0].id, idempotencyKey],
        );
        if (prior.rowCount) {
          return {
            id: pending.rows[0].id, email: pending.rows[0].email, role: "owner",
            status: "pending", expiresAt: pending.rows[0].expiresAt, acceptedAt: null,
            invitationToken: null, deliveryStatus: prior.rows[0].status,
            providerMessageId: prior.rows[0].providerMessageId,
            recipientName: invitationGreetingName(pending.rows[0].recipientName, pending.rows[0].email),
            workspaceName: pending.rows[0].workspaceName,
            tokenHash: null,
            replayed: true as const,
            tokenNotice: "Token omitted on replay; use a new send key to rotate it if the original was lost.",
          };
        }
        const inFlight = await client.query(
          `SELECT 1 FROM workspace_invitation_delivery_commands
           WHERE invitation_id = $1 AND status = 'pending'
             AND created_at > now() - interval '60 seconds' LIMIT 1`,
          [pending.rows[0].id],
        );
        if (inFlight.rowCount) throw new ConflictException("Owner invitation delivery is still in progress");
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
      await client.query(
        `INSERT INTO workspace_invitation_delivery (invitation_id, workspace_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (invitation_id) DO UPDATE SET status = 'pending',
           provider = NULL, provider_message_id = NULL, updated_at = now()`,
        [pending.rows[0].id, workspaceId],
      );
      await client.query(
        `UPDATE workspace_invitation_delivery_commands SET status = 'superseded', updated_at = now()
         WHERE invitation_id = $1 AND status <> 'superseded'`,
        [pending.rows[0].id],
      );
      if (idempotencyKey) {
        await client.query(
          `INSERT INTO workspace_invitation_delivery_commands
             (workspace_id, invitation_id, idempotency_key)
           VALUES ($1, $2, $3)`,
          [workspaceId, pending.rows[0].id, idempotencyKey],
        );
      }
      await this.recordChange(client, {
        workspaceId,
        actorUserId: operatorUserId ?? null,
        source: "internal",
        action: "workspace.owner_invitation_rotated",
        entityType: "workspace_invitation",
        entityId: pending.rows[0].id,
        correlationId: auditCorrelationId,
        after: { email: pending.rows[0].email, role: "owner", expiresAt },
      });
      if (operatorUserId) {
        await client.query(
          `INSERT INTO platform_operator_audit
             (actor_user_id, action, target_type, target_id, correlation_id, details)
           VALUES ($1, 'tenant.owner_invitation_rotated', 'tenant', $2, $3, $4)`,
          [operatorUserId, externalTenantId, auditCorrelationId,
            { workspaceId, invitationId: pending.rows[0].id }],
        );
      }
      return {
        id: pending.rows[0].id,
        email: pending.rows[0].email,
        role: "owner",
        status: "pending",
        expiresAt,
        acceptedAt: null,
        invitationToken,
        deliveryStatus: "pending",
        providerMessageId: null,
        recipientName: invitationGreetingName(pending.rows[0].recipientName, pending.rows[0].email),
        workspaceName: pending.rows[0].workspaceName,
        tokenHash,
        replayed: false as const,
        tokenNotice: "This replacement token is returned once and is never stored in plaintext.",
      };
    });
    if (rotated.replayed) {
      const { recipientName: _recipientName, workspaceName: _workspaceName,
        tokenHash: _tokenHash, ...publicReplay } = rotated;
      return publicReplay;
    }
    const delivery = await this.transactionalEmail.sendWorkspaceInvitation({
      workspaceId,
      email: rotated.email,
      expiresAt: rotated.expiresAt,
      invitationToken: rotated.invitationToken,
      inviterName: "Wodana",
      recipientName: rotated.recipientName,
      roleCodes: ["owner"],
      workspaceName: rotated.workspaceName,
    });
    await this.database.tenantTransaction(workspaceId, operatorUserId ?? workspaceId, async (client) => {
      await client.query(
        `UPDATE workspace_invitation_delivery SET status = $3, attempts = attempts + 1,
           provider = $4, provider_message_id = $5, last_attempted_at = now(), updated_at = now()
         WHERE invitation_id = $1 AND workspace_id = $2
           AND EXISTS (SELECT 1 FROM workspace_invitations invitation
                       WHERE invitation.id = $1 AND invitation.token_hash = $6)`,
        [rotated.id, workspaceId, delivery.status, delivery.provider, delivery.messageId, rotated.tokenHash],
      );
      if (idempotencyKey) {
        await client.query(
          `UPDATE workspace_invitation_delivery_commands
           SET status = $3, provider_message_id = $4, updated_at = now()
           WHERE invitation_id = $1 AND idempotency_key = $2 AND status = 'pending'`,
          [rotated.id, idempotencyKey, delivery.status, delivery.messageId],
        );
      }
      await this.recordChange(client, {
        workspaceId,
        actorUserId: operatorUserId ?? null,
        source: "internal",
        action: "workspace.owner_invitation_delivery_attempted",
        entityType: "workspace_invitation",
        entityId: rotated.id,
        correlationId: auditCorrelationId,
        after: { status: delivery.status, provider: delivery.provider, providerMessageId: delivery.messageId },
      });
      if (operatorUserId) {
        await client.query(
          `INSERT INTO platform_operator_audit
             (actor_user_id, action, target_type, target_id, correlation_id, details)
           VALUES ($1, 'tenant.owner_invitation_delivery_attempted', 'tenant', $2, $3, $4)`,
          [operatorUserId, externalTenantId, auditCorrelationId,
            { workspaceId, invitationId: rotated.id, status: delivery.status, provider: delivery.provider }],
        );
      }
    });
    const { recipientName: _recipientName, workspaceName: _workspaceName,
      tokenHash: _tokenHash, ...publicResult } = rotated;
    return { ...publicResult, deliveryStatus: delivery.status, providerMessageId: delivery.messageId };
  }

  async list(actor: RequestActor) {
    const actorUser = await this.identities.resolveActor(actor);
    return this.database.actorTransaction(actorUser.userId, async (client) => {
      const result = await client.query<WorkspaceRow & {
        account_id: string | null;
        account_name: string | null;
        is_default_organization: boolean;
      }>(
        `SELECT workspace.*, linked.account_id,
                account.display_name AS account_name,
                COALESCE(linked.is_default, false) AS is_default_organization
         FROM workspaces workspace
         JOIN workspace_memberships membership ON membership.workspace_id = workspace.id
         LEFT JOIN customer_account_organizations linked ON linked.workspace_id = workspace.id
         LEFT JOIN customer_accounts account ON account.id = linked.account_id
         WHERE membership.user_id = $1
           AND membership.status = 'active'
           AND workspace.status = 'active'
         ORDER BY workspace.name`,
        [actorUser.userId],
      );
      return result.rows.map((row) => ({
        ...this.mapWorkspace(row),
        accountId: row.account_id,
        accountName: row.account_name,
        isDefaultOrganization: row.is_default_organization,
      }));
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
        primaryColor: string | null;
        secondaryColor: string | null;
        headingFont: string | null;
        bodyFont: string | null;
      }>(
        `SELECT branding.logo_asset_id AS "logoAssetId",
                asset.updated_at AS "logoUpdatedAt",
                branding.primary_color AS "primaryColor",
                branding.secondary_color AS "secondaryColor",
                branding.heading_font AS "headingFont",
                branding.body_font AS "bodyFont"
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

  async homeLayout(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const result = await client.query(
        `SELECT home_layout AS widgets, home_layout_version AS version FROM workspace_memberships
         WHERE workspace_id=$1 AND user_id=$2 AND status='active'`, [workspaceId, user.userId],
      );
      if (!result.rows[0]) throw new NotFoundException("Workspace membership not found");
      return result.rows[0];
    });
  }

  async homeOverview(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const membership = await client.query<{ id: string }>(
        `SELECT id FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'`,
        [workspaceId, user.userId],
      );
      if (!membership.rows[0]) throw new NotFoundException("Workspace membership not found");
      const [sales, planning, projects, manageProjects] = await Promise.all([
        this.access.hasPermission(client, workspaceId, user.userId, "crm.activities.view"),
        this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.view"),
        this.access.hasPermission(client, workspaceId, user.userId, "projects.view"),
        this.access.hasPermission(client, workspaceId, user.userId, "projects.manage"),
      ]);
      return readHomeOverview(client, workspaceId, membership.rows[0].id, { sales, planning, projects, manageProjects });
    });
  }

  /** Live Home metrics in one tenant transaction; each section only when the caller holds its permission. */
  async homeMetrics(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const membership = await client.query<{ id: string }>(
        `SELECT id FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'`,
        [workspaceId, user.userId],
      );
      if (!membership.rows[0]) throw new NotFoundException("Workspace membership not found");
      const can = (permission: string) => this.access.hasPermission(client, workspaceId, user.userId, permission);
      const [enquiries, quotes, payments, projects, manageProjects, activity, settings, data, followUps, orders] = await Promise.all([
        can("crm.leads.view"), can("pre_projects.view"), can("receivables.view"), can("projects.view"),
        can("projects.manage"), can("audit.view"), can("workspace.settings.manage"), can("data.manage"),
        can("crm.activities.view"), can("purchasing.view"),
      ]);
      return readHomeMetrics(client, workspaceId, membership.rows[0].id, {
        enquiries, quotes, payments, projects, manageProjects, activity, storage: settings || data, followUps, orders,
      });
    });
  }

  /**
   * Home's overview for the caller in one tenant transaction: what needs them today, what is coming up, the
   * business flow they can see and the records to jump back into. Every source follows their permissions.
   */
  async homeSummary(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const membership = await client.query<{ id: string }>(
        `SELECT id FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'`,
        [workspaceId, user.userId],
      );
      if (!membership.rows[0]) throw new NotFoundException("Workspace membership not found");
      const codes = [
        "crm.activities.view", "crm.communications.view", "crm.leads.view", "crm.leads.assign", "pre_projects.view", "projects.view",
        "projects.manage", "receivables.view", "purchasing.view", "factory.view", "pre_projects.review_designs",
        "pre_projects.record_client_design_decisions", "commercial.estimate", "commercial.approve", "commercial.finance.verify",
        "purchasing.approve", "hrms.manage",
      ] as const;
      const granted = await Promise.all(codes.map((code) => this.access.hasPermission(client, workspaceId, user.userId, code)));
      const can = (code: (typeof codes)[number]) => granted[codes.indexOf(code)];
      const inbox = await loadInboxViewer((permission) => this.access.hasPermission(client, workspaceId, user.userId, permission));
      return readHomeSummary(client, { workspaceId, membershipId: membership.rows[0].id, userId: user.userId }, {
        followUps: can("crm.activities.view"), replies: can("crm.communications.view"), inbox, leads: can("crm.leads.view"),
        assignLeads: can("crm.leads.assign"), planning: can("pre_projects.view"), projects: can("projects.view") || can("projects.manage"),
        manageProjects: can("projects.manage"), receivables: can("receivables.view"), purchasing: can("purchasing.view"), factory: can("factory.view"),
        approvals: {
          designs: can("pre_projects.view"), reviewDesigns: can("pre_projects.review_designs"),
          recordClientDesigns: can("pre_projects.record_client_design_decisions"),
          reviewQuotes: can("commercial.estimate") || can("commercial.approve"), verifyPayments: can("commercial.finance.verify"),
          approveOrders: can("purchasing.approve"), manageLeave: can("hrms.manage"),
          projects: can("projects.view") || can("projects.manage"), manageProjects: can("projects.manage"),
        },
      });
    });
  }

  async updateHomeLayout(actor: RequestActor, workspaceId: string, input: UpdateHomeLayoutDto) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      // Personal presentation only: a member cannot target another user or change access.
      const result = await client.query(
        `UPDATE workspace_memberships SET home_layout=$3::jsonb, home_layout_version=home_layout_version+1
         WHERE workspace_id=$1 AND user_id=$2 AND status='active' AND home_layout_version=$4
         RETURNING home_layout AS widgets, home_layout_version AS version`,
        [workspaceId, user.userId, JSON.stringify(input.widgets), input.version],
      );
      if (!result.rows[0]) throw new ConflictException("Your Home layout changed elsewhere. Reload it before saving.");
      return result.rows[0];
    });
  }

  async terminologyHistory(actor: RequestActor, workspaceId: string, key: string) {
    if (!workspaceTerminologyDefault(key)) throw new BadRequestException("Choose a supported terminology key");
    return this.access.asMember(actor, workspaceId, (client) =>
      this.revisions.history(client, workspaceId, "workspace_terminology", key));
  }

  async updateAppearance(
    actor: RequestActor,
    workspaceId: string,
    input: UpdateWorkspaceAppearanceDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.edit", "workspace.settings.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const beforeWorkspace = await this.requireWorkspace(client, workspaceId);
        const beforeBranding = await client.query<{
          primaryColor: string | null;
          secondaryColor: string | null;
          headingFont: string | null;
          bodyFont: string | null;
        }>(
          `SELECT primary_color AS "primaryColor", secondary_color AS "secondaryColor",
                  heading_font AS "headingFont", body_font AS "bodyFont"
           FROM tenant_login_branding
           WHERE workspace_id = $1`,
          [workspaceId],
        );
        const before = beforeBranding.rows[0] ?? {
          primaryColor: null, secondaryColor: null, headingFont: null, bodyFont: null,
        };
        const appearance = {
          primaryColor: input.primaryColor,
          secondaryColor: input.secondaryColor === undefined ? before.secondaryColor : input.secondaryColor,
          headingFont: input.headingFont === undefined ? before.headingFont : input.headingFont,
          bodyFont: input.bodyFont === undefined ? before.bodyFont : input.bodyFont,
        };
        const workspace = await client.query<WorkspaceRow>(
          `UPDATE workspaces
           SET version = version + 1, updated_at = now()
           WHERE id = $1 AND version = $2
           RETURNING *`,
          [workspaceId, input.workspaceVersion],
        );
        if (!workspace.rowCount) {
          throw new ConflictException("Workspace appearance changed; reload and try again");
        }
        await client.query(
          `INSERT INTO tenant_login_branding
             (workspace_id, login_slug, display_name, primary_color, secondary_color, heading_font, body_font)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (workspace_id)
           DO UPDATE SET primary_color = EXCLUDED.primary_color,
                         secondary_color = EXCLUDED.secondary_color,
                         heading_font = EXCLUDED.heading_font,
                         body_font = EXCLUDED.body_font,
                         updated_at = now()`,
          [workspaceId, beforeWorkspace.slug, beforeWorkspace.name,
            appearance.primaryColor, appearance.secondaryColor, appearance.headingFont, appearance.bodyFont],
        );
        const response = {
          workspace: this.mapWorkspace(workspace.rows[0]),
          ...appearance,
        };
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: input.primaryColor
            ? "workspace.appearance_updated"
            : "workspace.appearance_restored",
          entityType: "workspace_branding",
          entityId: workspaceId,
          before,
          after: appearance,
        });
        return response;
      },
    );
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
        await this.revisions.ensureBaseline(client, {
          workspaceId,
          resourceType: "workspace_terminology",
          resourceId: key,
          sourceVersion: before.version,
          snapshot: this.terminologyRevisionSnapshot(before),
          actorUserId: actorUser.userId,
        });
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
        await this.revisions.record(client, {
          workspaceId,
          resourceType: "workspace_terminology",
          resourceId: key,
          sourceVersion: response.version,
          action: "saved",
          snapshot: this.terminologyRevisionSnapshot(response),
          actorUserId: actorUser.userId,
        });
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
        await this.revisions.ensureBaseline(client, {
          workspaceId,
          resourceType: "workspace_terminology",
          resourceId: key,
          sourceVersion: before.version,
          snapshot: this.terminologyRevisionSnapshot(before),
          actorUserId: actorUser.userId,
        });
        const removed = await client.query(
          `DELETE FROM workspace_terminology
           WHERE workspace_id = $1 AND key = $2 AND version = $3`,
          [workspaceId, key, version],
        );
        if (!removed.rowCount) throw new ConflictException("Terminology changed; reload and try again");
        const response = resolveWorkspaceTerminology([]).items.find((item) => item.key === key)!;
        await this.revisions.record(client, {
          workspaceId,
          resourceType: "workspace_terminology",
          resourceId: key,
          sourceVersion: response.version,
          action: "restored_default",
          snapshot: this.terminologyRevisionSnapshot(response),
          actorUserId: actorUser.userId,
        });
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

  async rollbackTerminology(
    actor: RequestActor,
    workspaceId: string,
    key: string,
    input: RestoreConfigurationRevisionDto,
  ) {
    if (!workspaceTerminologyDefault(key)) throw new BadRequestException("Choose a supported terminology key");
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.edit", "workspace.settings.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const existing = await client.query<WorkspaceTerminologyOverride>(
          `SELECT key,visible_name AS "visibleName",visible_name_plural AS "visibleNamePlural",
                  version,updated_at AS "updatedAt"
           FROM workspace_terminology WHERE workspace_id=$1 AND key=$2 FOR UPDATE`,
          [workspaceId, key],
        );
        const before = resolveWorkspaceTerminology(existing.rows).items.find((item) => item.key === key)!;
        if (before.version !== input.version) {
          throw new ConflictException("Terminology changed; reload and try again");
        }
        const revision = await this.revisions.requireRevision(
          client,
          workspaceId,
          "workspace_terminology",
          key,
          input.revisionId,
        );
        const target = revision.snapshot;
        if (
          target.key !== key ||
          typeof target.visibleName !== "string" ||
          typeof target.visibleNamePlural !== "string" ||
          typeof target.overridden !== "boolean"
        ) throw new BadRequestException("This terminology revision cannot be restored");

        await this.revisions.ensureBaseline(client, {
          workspaceId,
          resourceType: "workspace_terminology",
          resourceId: key,
          sourceVersion: before.version,
          snapshot: this.terminologyRevisionSnapshot(before),
          actorUserId: actorUser.userId,
        });

        let response;
        if (!target.overridden) {
          if (existing.rowCount) {
            const removed = await client.query(
              `DELETE FROM workspace_terminology WHERE workspace_id=$1 AND key=$2 AND version=$3`,
              [workspaceId, key, input.version],
            );
            if (!removed.rowCount) throw new ConflictException("Terminology changed; reload and try again");
          }
          response = resolveWorkspaceTerminology([]).items.find((item) => item.key === key)!;
        } else if (existing.rowCount) {
          const saved = await client.query<WorkspaceTerminologyOverride>(
            `UPDATE workspace_terminology
             SET visible_name=$1,visible_name_plural=$2,version=version+1,updated_by=$3,updated_at=now()
             WHERE workspace_id=$4 AND key=$5 AND version=$6
             RETURNING key,visible_name AS "visibleName",visible_name_plural AS "visibleNamePlural",
                       version,updated_at AS "updatedAt"`,
            [target.visibleName, target.visibleNamePlural, actorUser.userId, workspaceId, key, input.version],
          );
          if (!saved.rowCount) throw new ConflictException("Terminology changed; reload and try again");
          response = resolveWorkspaceTerminology(saved.rows).items.find((item) => item.key === key)!;
        } else {
          const saved = await client.query<WorkspaceTerminologyOverride>(
            `INSERT INTO workspace_terminology
              (workspace_id,key,visible_name,visible_name_plural,updated_by)
             VALUES($1,$2,$3,$4,$5)
             RETURNING key,visible_name AS "visibleName",visible_name_plural AS "visibleNamePlural",
                       version,updated_at AS "updatedAt"`,
            [workspaceId, key, target.visibleName, target.visibleNamePlural, actorUser.userId],
          );
          response = resolveWorkspaceTerminology(saved.rows).items.find((item) => item.key === key)!;
        }

        await this.revisions.record(client, {
          workspaceId,
          resourceType: "workspace_terminology",
          resourceId: key,
          sourceVersion: response.version,
          action: "rolled_back",
          snapshot: this.terminologyRevisionSnapshot(response),
          actorUserId: actorUser.userId,
          sourceRevisionId: revision.id,
        });
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.terminology_rolled_back",
          entityType: "workspace_terminology",
          entityId: workspaceId,
          before: { ...before },
          after: { ...response, sourceRevisionId: revision.id },
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
        await this.assertMoneyIdentityUnchanged(client, workspaceId, beforeEntity, {
          baseCurrency: input.defaultCurrency, countryCode: input.countryCode,
        });

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
        const uploadUrl = await this.brandStorage.createUploadUrl(objectKey, input.mimeType, input.byteSize);
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
        await this.brandStorage.confirmUpload(asset.object_key, stored.body, asset.mime_type);

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
           WHERE workspace_id = $1 AND status = 'active' AND id <> $2 AND purpose = 'workspace_logo'`,
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

  async readPublicCompanyLogo(loginSlug: string, variant: "display" | "square" = "display") {
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
      const objectKey = asset.rows[0].variants[variant] ?? asset.rows[0].variants.display ?? asset.rows[0].object_key;
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
        if (input.taxRegistrationNumber) input.taxRegistrationNumber = checkTaxNumber(input.taxRegistrationNumber, await readTaxNumberRuleFor(client, input.countryCode));
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
        await this.assertMoneyIdentityUnchanged(client, workspaceId, before, input);
        // A new or changed tax number must have the format of the business's country (PLM-111/112).
        if (input.taxRegistrationNumber && normaliseTaxNumber(input.taxRegistrationNumber) !== normaliseTaxNumber(before.tax_registration_number ?? "")) {
          input.taxRegistrationNumber = checkTaxNumber(input.taxRegistrationNumber, await readTaxNumberRuleFor(client, input.countryCode ?? before.country_code));
        }
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
        if (input.phone !== undefined) add("phone", input.phone || null);
        if (input.email !== undefined) add("email", input.email || null);
        if (input.letterheadFooter !== undefined) add("letterhead_footer", input.letterheadFooter || null);
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
                (SELECT COALESCE(array_agg(grant_role.role_id ORDER BY grant_role.role_id), '{}')
                 FROM workspace_team_roles grant_role WHERE grant_role.team_id = team.id) AS "roleIds",
                (SELECT COALESCE(array_agg(routing.queue_id ORDER BY routing.queue_id), '{}')
                 FROM workspace_team_queue_settings routing WHERE routing.team_id = team.id) AS "queueIds",
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
        if ((input.roleIds?.length ?? 0) > 0 && !await this.access.hasPermission(client, workspaceId, actorUser.userId, "workspace.roles.manage")) {
          throw new ForbiddenException("Role management permission is required to set team access");
        }
        if ((input.queueIds?.length ?? 0) > 0 && !await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.settings.manage")) {
          throw new ForbiddenException("CRM settings permission is required to set team routing");
        }
        await this.replaceTeamAccess(client, workspaceId, teamId, input.roleIds ?? [], input.queueIds ?? [], actorUser.userId);
        const response = await this.requireTeam(client, workspaceId, teamId);
        await this.revisions.record(client, {
          workspaceId, resourceType: "workspace_team", resourceId: teamId,
          sourceVersion: Number(response.version), action: "created", snapshot: response,
          actorUserId: actorUser.userId,
        });
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
        await this.revisions.ensureBaseline(client, {
          workspaceId, resourceType: "workspace_team", resourceId: teamId,
          sourceVersion: Number(before.version), snapshot: before, actorUserId: actorUser.userId,
        });
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
        if (input.roleIds !== undefined || input.queueIds !== undefined) {
          if (input.roleIds !== undefined && !await this.access.hasPermission(client, workspaceId, actorUser.userId, "workspace.roles.manage")) {
            throw new ForbiddenException("Role management permission is required to change team access");
          }
          if (input.queueIds !== undefined && !await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.settings.manage")) {
            throw new ForbiddenException("CRM settings permission is required to change team routing");
          }
          await this.replaceTeamAccess(
            client, workspaceId, teamId,
            input.roleIds ?? (before.roleIds as string[]),
            input.queueIds ?? (before.queueIds as string[]),
            actorUser.userId,
          );
        }
        const response = await this.requireTeam(client, workspaceId, teamId);
        await this.revisions.record(client, {
          workspaceId, resourceType: "workspace_team", resourceId: teamId,
          sourceVersion: Number(response.version), action: "saved", snapshot: response,
          actorUserId: actorUser.userId,
        });
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
        await this.revisions.ensureBaseline(client, {
          workspaceId, resourceType: "workspace_team", resourceId: teamId,
          sourceVersion: Number(before.version), snapshot: before, actorUserId: actorUser.userId,
        });
        const archived = await client.query(
          `UPDATE workspace_teams SET status = 'archived', version = version + 1
           WHERE id = $1 AND workspace_id = $2 AND version = $3 AND status = 'active'
           RETURNING id, status, version`,
          [teamId, workspaceId, version],
        );
        if (!archived.rowCount) throw new ConflictException("Team changed; reload and try again");
        const response = await this.requireTeam(client, workspaceId, teamId, true);
        await this.revisions.record(client, {
          workspaceId, resourceType: "workspace_team", resourceId: teamId,
          sourceVersion: Number(response.version), action: "archived", snapshot: response,
          actorUserId: actorUser.userId,
        });
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

  async teamHistory(actor: RequestActor, workspaceId: string, teamId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["module.teams.read", "legal_entities.view"], (client) =>
      this.revisions.history(client, workspaceId, "workspace_team", teamId));
  }

  async rollbackTeam(
    actor: RequestActor,
    workspaceId: string,
    teamId: string,
    input: RestoreConfigurationRevisionDto,
  ) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.teams.edit", "legal_entities.manage"],
      async (client, actorUser) => {
        await this.lockWorkspace(client, workspaceId);
        const before = await this.requireTeam(client, workspaceId, teamId, true);
        if (Number(before.version) !== input.version) throw new ConflictException("Team changed; reload and try again");
        const revision = await this.revisions.requireRevision(client, workspaceId, "workspace_team", teamId, input.revisionId);
        const target = revision.snapshot;
        if (
          target.code !== before.code || typeof target.name !== "string" ||
          typeof target.businessUnitId !== "string" || !["active", "archived"].includes(String(target.status)) ||
          !Array.isArray(target.members) || !Array.isArray(target.roleIds) || !Array.isArray(target.queueIds)
        ) throw new UnprocessableEntityException("This team revision cannot be restored");
        await this.requireBusinessUnit(client, workspaceId, target.businessUnitId);
        const beforeRoleIds = before.roleIds as string[];
        const beforeQueueIds = before.queueIds as string[];
        const targetRoleIds = target.roleIds as string[];
        const targetQueueIds = target.queueIds as string[];
        const accessChanged = (left: string[], right: string[]) =>
          left.length !== right.length || [...left].sort().some((value, index) => value !== [...right].sort()[index]);
        if (accessChanged(beforeRoleIds, targetRoleIds) && !await this.access.hasPermission(client, workspaceId, actorUser.userId, "workspace.roles.manage")) {
          throw new ForbiddenException("Role management permission is required to restore team access");
        }
        if (accessChanged(beforeQueueIds, targetQueueIds) && !await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.settings.manage")) {
          throw new ForbiddenException("CRM settings permission is required to restore team routing");
        }
        const members = target.members as Array<{ membershipId?: unknown; isLead?: unknown }>;
        const memberIds = members.map((member) => member.membershipId).filter((id): id is string => typeof id === "string");
        if (memberIds.length !== members.length || target.roleIds.some((id) => typeof id !== "string") || target.queueIds.some((id) => typeof id !== "string")) {
          throw new UnprocessableEntityException("This team revision has invalid access defaults");
        }
        const leadMembershipId = members.find((member) => member.isLead)?.membershipId;
        await this.revisions.ensureBaseline(client, {
          workspaceId, resourceType: "workspace_team", resourceId: teamId,
          sourceVersion: Number(before.version), snapshot: before, actorUserId: actorUser.userId,
        });
        const updated = await client.query(
          `UPDATE workspace_teams SET business_unit_id=$1,name=$2,description=$3,status=$4,version=version+1,updated_at=now()
           WHERE workspace_id=$5 AND id=$6 AND version=$7 RETURNING id`,
          [target.businessUnitId, target.name, typeof target.description === "string" ? target.description : null, target.status, workspaceId, teamId, input.version],
        );
        if (!updated.rowCount) throw new ConflictException("Team changed; reload and try again");
        await this.replaceTeamMembers(client, workspaceId, teamId, memberIds, typeof leadMembershipId === "string" ? leadMembershipId : null);
        await this.replaceTeamAccess(client, workspaceId, teamId, targetRoleIds, targetQueueIds, actorUser.userId);
        const after = await this.requireTeam(client, workspaceId, teamId, true);
        await this.revisions.record(client, {
          workspaceId, resourceType: "workspace_team", resourceId: teamId,
          sourceVersion: Number(after.version), action: "rolled_back", snapshot: after,
          actorUserId: actorUser.userId, sourceRevisionId: revision.id,
        });
        await this.recordChange(client, {
          workspaceId, actorUserId: actorUser.userId, action: "workspace.team_rolled_back",
          entityType: "workspace_team", entityId: teamId, before,
          after: { ...after, sourceRevisionId: revision.id },
        });
        return after;
      },
    );
  }

  async listRoles(actor: RequestActor, workspaceId: string) {
    // A member who can create, edit or delete roles must be able to see the
    // catalogue before acting; those grants do not imply the other mutations.
    return this.access.withAnyPermission(actor, workspaceId, [
      "module.roles.read", "module.roles.write", "module.roles.edit", "module.roles.delete", "workspace.roles.manage",
      "module.members.read", "module.members.write", "module.members.edit", "module.members.delete", "workspace.members.manage",
    ], async (client) => {
      const roles = await client.query(
        `SELECT role.id, role.code, role.name, role.description, role.is_system AS "isSystem",
                role.version,
                (SELECT count(*)::int FROM member_roles assigned
                 WHERE assigned.role_id = role.id) AS "memberCount",
                (SELECT count(*)::int FROM workspace_team_roles assigned
                 WHERE assigned.role_id = role.id) AS "teamCount",
                (SELECT count(*)::int FROM invitation_roles assigned
                 JOIN workspace_invitations invitation ON invitation.id = assigned.invitation_id
                 WHERE assigned.role_id = role.id AND invitation.status = 'pending') AS "pendingInvitationCount",
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
      // A custom role keeping a template's code was built from it and can be reset to it.
      return roles.rows.map((role) => ({ ...role, templateCode: !role.isSystem && ROLE_TEMPLATE_CODES.includes(role.code) ? role.code : null }));
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
        await this.assertRoleDelegation(client, workspaceId, actorUser.userId, input.permissionCodes);
        await this.assertRoleNameFree(client, workspaceId, input.name);

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

  /** Nobody edits themselves out of Roles & permissions: their other roles must still let them change roles. */
  private async assertKeepsOwnRoleAccess(client: PoolClient, workspaceId: string, userId: string, roleId: string, nextCodes: readonly string[]) {
    const ROLE_EDITING = ["workspace.roles.manage", "module.roles.edit"];
    if (nextCodes.some((code) => ROLE_EDITING.includes(code))) return;
    const held = await client.query<{ fromThisRole: boolean; elsewhere: boolean }>(
      `SELECT bool_or(assigned.role_id = $3) AS "fromThisRole",
              bool_or(assigned.role_id <> $3 AND permission.code = ANY($4::text[])) AS elsewhere
         FROM workspace_memberships membership
         JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = assigned.role_id
         JOIN permissions permission ON permission.id = granted.permission_id
        WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active'
          AND permission.code = ANY($4::text[])`,
      [workspaceId, userId, roleId, ROLE_EDITING]);
    if (held.rows[0]?.fromThisRole && !held.rows[0]?.elsewhere) {
      throw new ConflictException("You can't remove your own access to roles and permissions. Ask another owner or administrator.");
    }
  }

  /** Two roles never share a name (ignoring case and spaces): people pick roles by name in Invite and Access. */
  private async assertRoleNameFree(client: PoolClient, workspaceId: string, name: string, exceptRoleId?: string) {
    const taken = await client.query(
      `SELECT 1 FROM roles WHERE workspace_id = $1 AND lower(btrim(name)) = lower(btrim($2)) AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1`,
      [workspaceId, name, exceptRoleId ?? null]);
    if (taken.rowCount) throw new ConflictException(`A role named ${name.trim()} already exists. Choose another name, or change that role.`);
  }

  /**
   * Roles & permissions by module: one level per module plus advanced extras, expanded to permission codes with
   * the shared model (access-levels.json). Version-checked and audited like any role change.
   */
  async setRoleAccess(actor: RequestActor, workspaceId: string, roleId: string, input: { version: number; levels?: Record<string, unknown>; extras?: unknown }) {
    const permissionCodes = expandAccess(input);
    return this.updateRole(actor, workspaceId, roleId, { version: input.version, permissionCodes } as UpdateRoleDto,
      { action: "role.access_updated", details: { access: describeAccess(permissionCodes) } });
  }

  /** A role built from a template gets the template's permissions back (and Woddy, which every staff role has). */
  async resetRoleToTemplate(actor: RequestActor, workspaceId: string, roleId: string, version: number) {
    const role = await this.access.withAnyPermission(actor, workspaceId, ["module.roles.edit", "workspace.roles.manage"], (client) => this.requireRole(client, workspaceId, roleId));
    const template = role.isSystem ? undefined : roleTemplatesFor([String(role.code)])[0];
    if (!template) throw new UnprocessableEntityException("This role was not built from a template");
    return this.updateRole(actor, workspaceId, roleId, { version, permissionCodes: [...new Set([...template.permissions, "ai.suggestions.use"])].sort() } as UpdateRoleDto,
      { action: "role.reset_to_template", details: { template: template.code } });
  }

  async updateRole(
    actor: RequestActor,
    workspaceId: string,
    roleId: string,
    input: UpdateRoleDto,
    audit: { action: string; details: Record<string, unknown> } = { action: "role.updated", details: {} },
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
        await this.assertRoleDelegation(client, workspaceId, actorUser.userId, before.permissions as string[]);
        if (
          input.name === undefined
          && input.description === undefined
          && input.permissionCodes === undefined
        ) {
          return before;
        }
        if (input.name !== undefined) await this.assertRoleNameFree(client, workspaceId, input.name, roleId);
        const permissions = input.permissionCodes === undefined
          ? undefined
          : await this.resolvePermissions(client, input.permissionCodes);
        if (input.permissionCodes !== undefined) {
          await this.assertRoleDelegation(client, workspaceId, actorUser.userId, input.permissionCodes);
          await this.assertKeepsOwnRoleAccess(client, workspaceId, actorUser.userId, roleId, input.permissionCodes);
        }
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
          permissions: [...(input.permissionCodes ?? before.permissions as string[])].sort(),
          templateCode: ROLE_TEMPLATE_CODES.includes(String(updated.rows[0].code)) ? updated.rows[0].code : null,
        } as Record<string, unknown>;
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: audit.action,
          entityType: "role",
          entityId: roleId,
          before,
          after: { ...response, ...audit.details },
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
        await this.assertRoleDelegation(client, workspaceId, actorUser.userId, before.permissions as string[]);
        const assignments = await client.query<{ members: number; invitations: number; teams: number }>(
          `SELECT
             (SELECT count(*)::int FROM member_roles WHERE role_id = $1) AS members,
             (SELECT count(*)::int FROM workspace_team_roles WHERE role_id = $1) AS teams,
             (SELECT count(*)::int FROM invitation_roles assigned
              JOIN workspace_invitations invitation ON invitation.id = assigned.invitation_id
              WHERE assigned.role_id = $1 AND invitation.status = 'pending') AS invitations`,
          [roleId],
        );
        if (assignments.rows[0].members > 0 || assignments.rows[0].invitations > 0 || assignments.rows[0].teams > 0) {
          throw new ConflictException({
            message: "Reassign members, teams, and pending invitations before deleting this role",
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
        const teamIds = Array.from(new Set(input.teamIds ?? []));
        if (!input.roleCodes.length && !teamIds.length) {
          throw new UnprocessableEntityException("Choose a role or a team for this invitation");
        }
        if (teamIds.length) {
          const teams = await client.query<{ id: string }>(
            `SELECT id FROM workspace_teams WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND status='active'`,
            [workspaceId, teamIds],
          );
          if (teams.rowCount !== teamIds.length) throw new UnprocessableEntityException("One or more teams are not active");
        }
        await this.assertMemberRoleDelegation(client, workspaceId, actorUser.userId, roles.rows.map((role) => role.id), teamIds);

        const displayName = input.displayName?.trim() || placeholderDisplayName(input.email);
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
        for (const teamId of teamIds) {
          await client.query(
            `INSERT INTO invitation_teams (workspace_id, invitation_id, team_id) VALUES ($1,$2,$3)`,
            [workspaceId, invitation.rows[0].id, teamId],
          );
        }
        await this.recordChange(client, {
          workspaceId,
          actorUserId: actorUser.userId,
          action: "workspace.member_invited",
          entityType: "workspace_invitation",
          entityId: invitation.rows[0].id,
          after: { displayName, email: input.email, roleCodes: input.roleCodes, teamIds, expiresAt },
        });

        return {
          invitation: {
            id: invitation.rows[0].id,
            email: input.email,
            displayName,
            roleCodes: input.roleCodes,
            teamIds,
            expiresAt,
            invitationToken,
            tokenNotice: "This token is returned once and is never stored in plaintext.",
          },
          message: {
            email: input.email,
            expiresAt,
            invitationToken,
            inviterName: actorUser.displayName,
            recipientName: invitationGreetingName(input.displayName, input.email),
            roleCodes: input.roleCodes,
            workspaceName: workspace.name,
            workspaceId,
          },
        };
      },
    );
    const emailDelivery = await this.transactionalEmail.sendWorkspaceInvitation(created.message);
    return { ...created.invitation, emailDelivery };
  }

  async listMembers(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, [
      "module.members.read", "module.members.write", "module.members.edit", "module.members.delete", "workspace.members.manage",
    ], async (client) => {
      const members = await client.query(
        `SELECT membership.id, membership.status, membership.joined_at AS "joinedAt",
                membership.version,
                app_user.id AS "userId", app_user.primary_email AS email,
                app_user.display_name AS "displayName",
                profile.avatar_preset AS "avatarPreset", profile.photo_updated_at AS "photoUpdatedAt",
                COALESCE(json_agg(role.code ORDER BY role.code)
                  FILTER (WHERE role.code IS NOT NULL), '[]') AS roles,
                (SELECT COALESCE(json_agg(DISTINCT inherited_role.code), '[]')
                 FROM effective_member_roles inherited
                 JOIN roles inherited_role ON inherited_role.id=inherited.role_id
                 WHERE inherited.membership_id=membership.id AND inherited.team_id IS NOT NULL) AS "inheritedRoles",
                (SELECT COALESCE(json_agg(json_build_object('id', team.id, 'name', team.name)), '[]')
                 FROM workspace_team_members team_member
                 JOIN workspace_teams team ON team.id=team_member.team_id AND team.status='active'
                 WHERE team_member.membership_id=membership.id) AS teams
         FROM workspace_memberships membership
         JOIN users app_user ON app_user.id = membership.user_id
         LEFT JOIN workspace_member_profiles profile ON profile.workspace_id = membership.workspace_id AND profile.user_id = membership.user_id
         LEFT JOIN member_roles assigned ON assigned.membership_id = membership.id
         LEFT JOIN roles role ON role.id = assigned.role_id
         WHERE membership.workspace_id = $1
         GROUP BY membership.id, app_user.id, profile.avatar_preset, profile.photo_updated_at
         ORDER BY app_user.display_name`,
        [workspaceId],
      );
      return members.rows.map(({ photoUpdatedAt, ...member }) => ({ ...member, photoUrl: MemberProfileService.photoUrl(workspaceId, String(member.userId), photoUpdatedAt as Date | null) }));
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
        if (input.roleCodes?.length === 0) {
          const inherited = await client.query(
            `SELECT 1 FROM workspace_team_members member_team
             JOIN workspace_teams team ON team.id=member_team.team_id AND team.status='active'
             JOIN workspace_team_roles grant_role ON grant_role.team_id=team.id
             WHERE member_team.workspace_id=$1 AND member_team.membership_id=$2
             LIMIT 1`,
            [workspaceId, membershipId],
          );
          if (!inherited.rowCount) throw new BadRequestException("A member needs a direct role or an active team role");
        }
        const currentRoles = await client.query<{ roleId: string }>(
          `SELECT DISTINCT role_id AS "roleId" FROM effective_member_roles WHERE membership_id=$1`,
          [membershipId],
        );
        await this.assertMemberRoleDelegation(client, workspaceId, actorUser.userId,
          [...new Set([...currentRoles.rows.map((role) => role.roleId), ...(requestedRoles?.rows.map((role) => role.id) ?? [])])], []);
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

  /**
   * The workspace's seats as People shows them before anyone invites (SP-3): the limit, members using a seat,
   * pending invitations reserving one, and what's free. Null limit when no subscription is set up.
   */
  async seats(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.members.read", "module.members.write", "module.members.delete", "workspace.members.manage"],
      async (client) => {
        const row = (await client.query<{ seatLimit: number; activeMembers: number; pendingInvitations: number; reservedSeats: number }>(
          `SELECT seat_limit AS "seatLimit", active_members AS "activeMembers", pending_invitations AS "pendingInvitations", reserved_seats AS "reservedSeats"
             FROM workspace_seat_capacity($1, NULL)`, [workspaceId])).rows[0];
        if (!row) return { limit: null, used: 0, reserved: 0, available: null };
        return { limit: Number(row.seatLimit), used: Number(row.activeMembers), reserved: Number(row.pendingInvitations),
          available: Math.max(0, Number(row.seatLimit) - Number(row.reservedSeats)) };
      },
    );
  }

  async listInvitations(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.members.read", "module.members.write", "module.members.delete", "workspace.members.manage"],
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
                  (SELECT COALESCE(json_agg(json_build_object('id', team.id, 'name', team.name)), '[]')
                   FROM invitation_teams invited_team JOIN workspace_teams team ON team.id=invited_team.team_id
                   WHERE invited_team.invitation_id=invitation.id) AS teams,
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
        await this.assertInvitationDelegation(client, workspaceId, actorUser.userId, invitationId);
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
        await this.assertInvitationDelegation(client, workspaceId, actorUser.userId, invitationId);
        // An invitation past its expiry no longer holds a seat. Reviving it must take a free seat,
        // otherwise a resend could push the workspace over its limit after the seat was reused.
        const expired = await client.query(
          `SELECT 1 FROM workspace_invitations WHERE id = $1 AND workspace_id = $2 AND expires_at <= now()`,
          [invitationId, workspaceId],
        );
        if (expired.rowCount) await this.assertSeatAvailable(client, workspaceId);
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
            recipientName: invitationGreetingName(recipient?.displayName, String(response.email)),
            roleCodes: recipient?.roleCodes ?? [],
            workspaceName: workspace.name,
            workspaceId,
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
        // A connection left waiting (the provider's window closed or failed) can start again; its old attempt
        // goes stale with the version bump, so it can never complete afterwards.
        if (before.status === status && status !== "pending") {
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
       WHERE id = $1 AND workspace_id = $2 AND status = 'pending' AND purpose = 'workspace_logo'`,
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

  private terminologyRevisionSnapshot(item: {
    key: string;
    visibleName: string;
    visibleNamePlural: string;
    overridden: boolean;
    version: number;
  }) {
    return {
      key: item.key,
      visibleName: item.visibleName,
      visibleNamePlural: item.visibleNamePlural,
      overridden: item.overridden,
      version: item.version,
    };
  }

  private async requireTeam(
    client: PoolClient,
    workspaceId: string,
    teamId: string,
    includeArchived = false,
  ): Promise<Record<string, unknown>> {
    const result = await client.query(
      `SELECT team.id, team.business_unit_id AS "businessUnitId", team.code,
              team.name, team.description, team.status, team.version,
              (SELECT COALESCE(array_agg(grant_role.role_id ORDER BY grant_role.role_id), '{}')
               FROM workspace_team_roles grant_role WHERE grant_role.team_id = team.id) AS "roleIds",
              (SELECT COALESCE(array_agg(routing.queue_id ORDER BY routing.queue_id), '{}')
               FROM workspace_team_queue_settings routing WHERE routing.team_id = team.id) AS "queueIds",
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
       WHERE team.id = $1 AND team.workspace_id = $2 AND ($3::boolean OR team.status = 'active')
       GROUP BY team.id`,
      [teamId, workspaceId, includeArchived],
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

  private async replaceTeamAccess(
    client: PoolClient,
    workspaceId: string,
    teamId: string,
    roleIds: string[],
    queueIds: string[],
    actorUserId: string,
  ): Promise<void> {
    const uniqueRoleIds = Array.from(new Set(roleIds));
    const uniqueQueueIds = Array.from(new Set(queueIds));
    if (uniqueRoleIds.length && !await this.access.hasPermission(client, workspaceId, actorUserId, "workspace.roles.manage")) {
      throw new ForbiddenException("Role management permission is required to grant team access");
    }
    if (uniqueQueueIds.length && !await this.access.hasPermission(client, workspaceId, actorUserId, "crm.settings.manage")) {
      throw new ForbiddenException("CRM settings permission is required to route enquiries to a team");
    }
    if (uniqueRoleIds.length) {
      const roles = await client.query<{ id: string }>(
        `SELECT id FROM roles WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND code NOT IN ('owner','administrator')`,
        [workspaceId, uniqueRoleIds],
      );
      if (roles.rowCount !== uniqueRoleIds.length) throw new UnprocessableEntityException("Team roles must be valid non-administrator roles");
    }
    if (uniqueQueueIds.length) {
      const queues = await client.query<{ id: string }>(
        `SELECT id FROM crm_queues WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND status='active'`,
        [workspaceId, uniqueQueueIds],
      );
      if (queues.rowCount !== uniqueQueueIds.length) throw new UnprocessableEntityException("One or more enquiry queues are not active");
    }
    await client.query(`DELETE FROM workspace_team_roles WHERE workspace_id=$1 AND team_id=$2`, [workspaceId, teamId]);
    await client.query(`DELETE FROM workspace_team_queue_settings WHERE workspace_id=$1 AND team_id=$2`, [workspaceId, teamId]);
    for (const roleId of uniqueRoleIds) {
      await client.query(`INSERT INTO workspace_team_roles(workspace_id,team_id,role_id) VALUES($1,$2,$3)`, [workspaceId, teamId, roleId]);
    }
    for (const queueId of uniqueQueueIds) {
      await client.query(`INSERT INTO workspace_team_queue_settings(workspace_id,team_id,queue_id) VALUES($1,$2,$3)`, [workspaceId, teamId, queueId]);
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

  private async assertRoleDelegation(
    client: PoolClient,
    workspaceId: string,
    actorUserId: string,
    permissionCodes: readonly string[],
  ): Promise<void> {
    const grants = await client.query<{ roleCode: string; permissionCode: string | null }>(
      `SELECT DISTINCT role.code AS "roleCode", permission.code AS "permissionCode"
       FROM workspace_memberships membership
       JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
       JOIN roles role ON role.id = assigned.role_id
       LEFT JOIN role_permissions granted ON granted.role_id = role.id
       LEFT JOIN permissions permission ON permission.id = granted.permission_id
       WHERE membership.workspace_id = $1 AND membership.user_id = $2
         AND membership.status = 'active'`,
      [workspaceId, actorUserId],
    );
    if (grants.rows.some(({ roleCode }) => roleCode === "owner" || roleCode === "administrator")) return;
    const effective = new Set(await this.access.effectivePermissions(
      client,
      workspaceId,
      grants.rows.map(({ permissionCode }) => permissionCode).filter((code): code is string => Boolean(code)),
    ));
    if (effective.has("workspace.roles.manage")) return;
    if (permissionCodes.some((code) => !effective.has(code))) {
      throw new ForbiddenException("You cannot manage a role containing permissions outside your own access");
    }
  }

  private async assertMemberRoleDelegation(
    client: PoolClient,
    workspaceId: string,
    actorUserId: string,
    roleIds: string[],
    teamIds: string[],
  ): Promise<void> {
    const actorGrants = await client.query<{ roleCode: string; permissionCode: string | null }>(
      `SELECT DISTINCT role.code AS "roleCode", permission.code AS "permissionCode"
       FROM workspace_memberships membership
       JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
       JOIN roles role ON role.id = assigned.role_id
       LEFT JOIN role_permissions granted ON granted.role_id = role.id
       LEFT JOIN permissions permission ON permission.id = granted.permission_id
       WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active'`,
      [workspaceId, actorUserId],
    );
    if (actorGrants.rows.some(({ roleCode }) => roleCode === "owner" || roleCode === "administrator")) return;

    const delegated = await client.query<{ roleCode: string; permissionCode: string | null }>(
      `SELECT DISTINCT role.code AS "roleCode", permission.code AS "permissionCode"
       FROM roles role
       LEFT JOIN role_permissions granted ON granted.role_id = role.id
       LEFT JOIN permissions permission ON permission.id = granted.permission_id
       WHERE role.workspace_id=$1 AND (
         role.id=ANY($2::uuid[]) OR EXISTS (
           SELECT 1 FROM workspace_team_roles assigned
           WHERE assigned.role_id=role.id AND assigned.team_id=ANY($3::uuid[])
         )
       )`,
      [workspaceId, roleIds, teamIds],
    );
    if (delegated.rows.some(({ roleCode }) => roleCode === "owner" || roleCode === "administrator")) {
      throw new ForbiddenException("Only an Owner or Administrator can assign privileged workspace roles");
    }
    const effective = new Set(await this.access.effectivePermissions(client, workspaceId,
      actorGrants.rows.map(({ permissionCode }) => permissionCode).filter((code): code is string => Boolean(code))));
    if (delegated.rows.some(({ permissionCode }) => permissionCode && !effective.has(permissionCode))) {
      throw new ForbiddenException("You cannot grant access beyond your own permissions");
    }
  }

  private async assertInvitationDelegation(
    client: PoolClient,
    workspaceId: string,
    actorUserId: string,
    invitationId: string,
  ): Promise<void> {
    const assigned = await client.query<{ roleId: string }>(
      `SELECT DISTINCT role_id AS "roleId" FROM invitation_roles WHERE invitation_id=$1
       UNION
       SELECT DISTINCT granted.role_id AS "roleId"
       FROM invitation_teams invited_team
       JOIN workspace_team_roles granted ON granted.team_id=invited_team.team_id
       WHERE invited_team.invitation_id=$1`,
      [invitationId],
    );
    await this.assertMemberRoleDelegation(client, workspaceId, actorUserId,
      assigned.rows.map((role) => role.roleId), []);
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
    const membership = await acceptPendingInvitation(client, { invitationId: invitation.id, userId: actorUser.userId });
    await this.recordChange(client, {
      workspaceId: invitation.workspace_id,
      actorUserId: actorUser.userId,
      action: "workspace.invitation_accepted",
      entityType: "workspace_membership",
      entityId: membership.membershipId,
      after: { invitationId: invitation.id, email: invitation.email },
    });
    return {
      workspaceId: invitation.workspace_id,
      membershipId: membership.membershipId,
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
    if (lock.rowCount) return;
    // A suspended organization is read-only; the refusal says so instead of hiding the workspace.
    const current = await client.query<{ status: string }>("SELECT status::text AS status FROM workspaces WHERE id = $1", [workspaceId]);
    const blocked = writeBlockFor(current.rows[0]?.status);
    if (blocked) throw blocked;
    throw new NotFoundException("Workspace not found");
  }

  private async assertSeatAvailable(
    client: PoolClient,
    workspaceId: string,
    excludeInvitationId: string | null = null,
  ): Promise<void> {
    const capacity = await client.query<{
      seatLimit: number;
      activeMembers: number;
      invitedMembers: number;
      pendingInvitations: number;
      reservedSeats: number;
    }>(
      `SELECT seat_limit AS "seatLimit", active_members AS "activeMembers",
              invited_members AS "invitedMembers", pending_invitations AS "pendingInvitations",
              reserved_seats AS "reservedSeats"
       FROM workspace_seat_capacity($1, $2)`,
      [workspaceId, excludeInvitationId],
    );
    if (!capacity.rowCount) {
      throw new ConflictException("Workspace subscription is not configured");
    }
    const usage = capacity.rows[0];
    const usedSeats = usage.reservedSeats;
    if (usedSeats >= usage.seatLimit) {
      throw new ConflictException({
        message: "Workspace seat limit reached",
        seatLimit: usage.seatLimit,
        usedSeats,
        activeMembers: usage.activeMembers,
        invitedMembers: usage.invitedMembers,
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
         registration_number, address, phone, email, letterhead_footer)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
        input.phone || null,
        input.email || null,
        input.letterheadFooter || null,
      ],
    );
    return result.rows[0];
  }

  private async insertCustomerAccountFoundation(
    client: PoolClient,
    input: {
      accountId: string;
      workspaceId: string;
      ownerUserId: string;
      displayName: string;
      externalCustomerId: string | null;
      contractContactName?: string | null;
      contractContactEmail?: string | null;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO customer_accounts
        (id, external_customer_id, display_name, created_by, contract_contact_name, contract_contact_email)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.accountId, input.externalCustomerId, input.displayName, input.ownerUserId,
        input.contractContactName ?? null, input.contractContactEmail ?? null],
    );
    await client.query(
      `INSERT INTO customer_account_memberships
        (account_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [input.accountId, input.ownerUserId],
    );
    await client.query(
      `INSERT INTO customer_account_organizations
        (account_id, workspace_id, is_default)
       VALUES ($1, $2, true)`,
      [input.accountId, input.workspaceId],
    );
  }

  private async resolveTenantSetup(client: PoolClient, selected: TenantSetupSelectionsDto) {
    const profiles = await client.query<{
      kind: "region" | "firm_kit" | "plan";
      code: string;
      version: number;
      configuration: Record<string, unknown>;
    }>(
      `SELECT kind, code, version, configuration FROM tenant_setup_profiles
       WHERE selectable = true AND (
         (kind = 'region' AND code = $1 AND version = $2)
         OR (kind = 'firm_kit' AND code = $3 AND version = $4)
         OR (kind = 'plan' AND code = $5 AND version = $6))`,
      [selected.region.code, selected.region.version,
        selected.firmKit.code, selected.firmKit.version,
        selected.plan.code, selected.plan.version],
    );
    if (profiles.rowCount !== 3) {
      throw new BadRequestException("Select published region, firm kit and plan versions");
    }
    const region = profiles.rows.find((profile) => profile.kind === "region")!;
    const firmKit = profiles.rows.find((profile) => profile.kind === "firm_kit")!;
    const plan = profiles.rows.find((profile) => profile.kind === "plan")!;
    parseProjectWorkflowTemplate(firmKit.configuration.projectWorkflow);
    parseRoleTemplateCodes(firmKit.configuration.roleTemplates);
    parseSalesPipelineTemplate(firmKit.configuration.salesPipeline);
    if (!Number.isInteger(plan.configuration.seatLimit) || Number(plan.configuration.seatLimit) < 1
      || !Number.isInteger(plan.configuration.projectLimit) || Number(plan.configuration.projectLimit) < 1
      || !["monthly", "yearly", "custom"].includes(String(plan.configuration.billingCycle))) {
      throw new BadRequestException("The pinned plan defaults are invalid");
    }
    return { region, firmKit, plan };
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
            OR ($3 = 'member' AND code IN ('hrms.self', 'projects.view', 'projects.report', 'ai.suggestions.use'))`,
        [workspaceId, roleIds.get(roleCode), roleCode],
      );
    }
    return roleIds;
  }

  /** Materialises the kit's role templates as editable roles. A permission the catalog lacks is a defect, not a silent gap. */
  private async insertRoleTemplates(client: PoolClient, workspaceId: string, templateCodes: readonly string[]) {
    for (const role of roleTemplatesFor(templateCodes)) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO roles (workspace_id, code, name, description, is_system)
         VALUES ($1, $2, $3, $4, false) RETURNING id`,
        [workspaceId, role.code, role.name, role.description],
      );
      const granted = await client.query(
        `INSERT INTO role_permissions (workspace_id, role_id, permission_id)
         SELECT $1, $2, id FROM permissions WHERE code = ANY($3::text[])`,
        [workspaceId, result.rows[0].id, [...role.permissions]],
      );
      if (granted.rowCount !== role.permissions.length) {
        throw new Error(`Role template ${role.code} names a permission the catalog does not have`);
      }
      // Every staff role can ask Woddy; the workspace AI switch and credits still decide whether it answers.
      await client.query(
        `INSERT INTO role_permissions (workspace_id, role_id, permission_id)
         SELECT $1, $2, id FROM permissions WHERE code = 'ai.suggestions.use'
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [workspaceId, result.rows[0].id],
      );
    }
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
    for (const documentType of ["QUOTATION", "INVOICE", "CREDIT_NOTE", "PURCHASE_ORDER"]) {
      const shortCode = documentType === "PURCHASE_ORDER" ? "PO" : documentType === "CREDIT_NOTE" ? "CN" : documentType.slice(0, 3);
      await client.query(
        `INSERT INTO document_sequences
          (workspace_id, legal_entity_id, document_type, prefix)
         VALUES ($1, $2, $3, $4)`,
        [workspaceId, legalEntityId, documentType, `${entityCode}-${shortCode}-{YYYY}-`],
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
      correlationId?: string;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    },
  ): Promise<void> {
    const eventId = randomUUID();
    const correlationId = change.correlationId ?? randomUUID();
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
    row?: {
      logoAssetId: string | null; logoUpdatedAt: Date | null; primaryColor: string | null;
      secondaryColor: string | null; headingFont: string | null; bodyFont: string | null;
    },
  ) {
    return {
      logoAssetId: row?.logoAssetId ?? null,
      logoUrl: row?.logoAssetId
        ? `/api/auth/tenant-logo/${loginSlug}?v=${row.logoAssetId}`
        : null,
      logoUpdatedAt: row?.logoUpdatedAt ?? null,
      primaryColor: row?.primaryColor ?? null,
      secondaryColor: row?.secondaryColor ?? null,
      headingFont: row?.headingFont ?? null,
      bodyFont: row?.bodyFont ?? null,
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
      // PLM-112: what the business's documents print.
      phone: row.phone ?? null,
      email: row.email ?? null,
      letterheadFooter: row.letterhead_footer ?? null,
      logoUrl: entityImageUrl(row.workspace_id, row.logo_asset_id ?? null),
      letterheadUrl: entityImageUrl(row.workspace_id, row.letterhead_asset_id ?? null),
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

  /** Currency and country are fixed once a legal entity has quotes, payments or receipts. */
  private async assertMoneyIdentityUnchanged(
    client: PoolClient,
    workspaceId: string,
    entity: { id: string; base_currency: string; country_code: string },
    next: { baseCurrency?: string; countryCode?: string },
  ) {
    const changing = (next.baseCurrency !== undefined && next.baseCurrency !== entity.base_currency)
      || (next.countryCode !== undefined && next.countryCode !== entity.country_code);
    if (!changing) return;
    const used = await client.query<{ used: boolean }>(
      "SELECT legal_entity_has_financial_records($1, $2) AS used", [workspaceId, entity.id],
    );
    if (used.rows[0]?.used) {
      throw new ConflictException(
        "This legal entity already has quotes or payments, so its currency and country can't change. Add a new legal entity for another country or currency.",
      );
    }
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
