import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { DatabaseService } from "../database/database.service";
import { WorkspaceAccessService } from "./workspace-access.service";
import type { UpdateTenantManagementDto } from "./dto/update-tenant-management.dto";
import { deriveBillingAccessPolicy } from "./tenant-operations.domain";
import {
  explainTenantMemberAccess,
  tenantSeatSummary,
  type DirectRoleSource,
  type TeamRoleSource,
} from "./tenant-access.domain";

type SubscriptionRow = {
  planCode: string;
  status: string;
  billingCycle: string;
  amount: string;
  currency: string;
  seatLimit: number;
  projectLimit: number;
  startedAt: Date;
  renewsAt: Date | null;
  note: string | null;
  version: number;
  updatedAt: Date;
};

@Injectable()
export class TenantManagementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async listManagedTenants() {
    const registry = await this.database.query<{
      externalTenantId: string;
      workspaceId: string;
    }>(
      `SELECT external_tenant_id AS "externalTenantId", workspace_id AS "workspaceId"
       FROM tenant_provisioning_requests
       WHERE external_tenant_id NOT LIKE 'auth-smoke-%'
       ORDER BY created_at DESC`,
    );
    return Promise.all(registry.rows.map((tenant) =>
      this.database.tenantTransaction(tenant.workspaceId, tenant.workspaceId, (client) =>
        this.loadManagedTenant(client, tenant.externalTenantId, tenant.workspaceId),
      ),
    ));
  }

  async getManagedTenant(externalTenantId: string) {
    const registry = await this.findRegistry(externalTenantId);
    return this.database.tenantTransaction(registry.workspaceId, registry.workspaceId, (client) =>
      this.loadManagedTenant(client, registry.externalTenantId, registry.workspaceId),
    );
  }

  async getTenantStatus(externalTenantId: string) {
    const tenant = await this.getManagedTenant(externalTenantId);
    const subscription = tenant.subscription;
    const seats = tenant.usage;
    const tenantState = await this.database.tenantTransaction(tenant.workspace.id, tenant.workspace.id, async (client) => {
      const domain = await client.query<{
        hostname: string; dnsStatus: string; dnsVerifiedAt: Date | null;
        certificateStatus: string; certificateExpiresAt: Date | null; routingStatus: string; rollbackStatus: string;
      }>(
        `SELECT hostname, dns_status AS "dnsStatus", dns_verified_at AS "dnsVerifiedAt",
                certificate_status AS "certificateStatus", certificate_expires_at AS "certificateExpiresAt",
                routing_status AS "routingStatus", rollback_status AS "rollbackStatus"
         FROM workspace_domains WHERE workspace_id = $1 AND removed_at IS NULL
         ORDER BY (routing_status = 'active') DESC, created_at DESC LIMIT 1`, [tenant.workspace.id],
      );
      const entitlements = await client.query<{
        planCode: string; planVersion: number; status: "scheduled" | "active" | "suspended";
        modules: string[]; version: number; updatedAt: Date;
      }>(
        `SELECT plan_code AS "planCode", plan_version AS "planVersion", status, modules,
                version, updated_at AS "updatedAt"
         FROM effective_workspace_entitlements WHERE workspace_id = $1`,
        [tenant.workspace.id],
      );
      return { domain: domain.rows[0] ?? null, entitlements: entitlements.rows[0] ?? null };
    });
    const domain = tenantState.domain;

    return {
      account: tenant.account ? {
        id: tenant.account.id,
        displayName: tenant.account.displayName,
        status: tenant.account.status,
        organizationCount: tenant.account.organizationCount,
        organizationLimit: tenant.account.organizationLimit,
        isDefaultOrganization: tenant.account.isDefaultOrganization,
        contractStatus: tenant.account.contractStatus,
        contractPlanCode: tenant.account.contractPlanCode,
        contractPlanVersion: tenant.account.contractPlanVersion,
      } : null,
      organization: {
        id: tenant.workspace.id,
        name: tenant.workspace.name,
        slug: tenant.workspace.slug,
        status: tenant.workspace.status,
        version: tenant.workspace.version,
        updatedAt: tenant.workspace.updatedAt,
      },
      owner: tenant.owner,
      onboarding: tenant.onboarding,
      ownerInvitation: tenant.ownerInvitation ? {
        status: tenant.ownerInvitation.status,
        expiresAt: tenant.ownerInvitation.expiresAt,
        acceptedAt: tenant.ownerInvitation.acceptedAt,
        deliveryStatus: tenant.ownerInvitation.deliveryStatus ?? "untracked",
        deliveryAttempts: tenant.ownerInvitation.deliveryAttempts ?? 0,
        deliveryAttemptedAt: tenant.ownerInvitation.deliveryAttemptedAt ?? null,
      } : null,
      seats: {
        limit: subscription?.seatLimit ?? null,
        activeMembers: seats.members,
        invitedMembers: seats.invitedMembers ?? 0,
        pendingInvitations: seats.pendingInvitations,
        reserved: seats.reservedSeats,
        available: subscription ? Math.max(0, subscription.seatLimit - seats.reservedSeats) : null,
      },
      plan: subscription ? {
        code: subscription.planCode,
        status: subscription.status,
        billingCycle: subscription.billingCycle,
        currency: subscription.currency,
        amount: subscription.amount,
        renewsAt: subscription.renewsAt,
        projectLimit: subscription.projectLimit,
        version: subscription.version,
        updatedAt: subscription.updatedAt,
      } : null,
      domain: domain ? {
        platformSlug: tenant.workspace.slug, hostname: domain.hostname,
        customDomainStatus: domain.dnsStatus === "failed" || domain.rollbackStatus === "pending" || domain.rollbackStatus === "failed"
          ? "needs_attention" as const
          : domain.routingStatus === "active"
            ? domain.dnsStatus === "verified" && domain.dnsVerifiedAt && domain.dnsVerifiedAt.getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000
              && domain.certificateStatus === "issued" && domain.certificateExpiresAt && domain.certificateExpiresAt.getTime() > Date.now()
              ? "active" as const : "needs_attention" as const
            : domain.dnsStatus === "verified" ? "verified" as const : "requested" as const,
        dnsStatus: domain.dnsStatus, certificateStatus: domain.certificateStatus,
        routingStatus: domain.routingStatus, rollbackStatus: domain.rollbackStatus,
      } : { platformSlug: tenant.workspace.slug, customDomainStatus: "not_configured" as const },
      commercialEntitlements: tenantState.entitlements ?? { status: "not_configured" as const },
      observedAt: new Date().toISOString(),
    };
  }

  async getTenantAccess(externalTenantId: string) {
    const registry = await this.findRegistry(externalTenantId);
    return this.database.tenantTransaction(registry.workspaceId, registry.workspaceId, async (client) => {
      const [workspace, entitlementResult, capacityResult, membersResult, invitationsResult] = await Promise.all([
        client.query<{ id: string; name: string; slug: string }>(
          `SELECT id,name,slug FROM workspaces WHERE id=$1`, [registry.workspaceId],
        ),
        client.query<{ status: string; modules: string[]; planCode: string; planVersion: number; version: number }>(
          `SELECT status,modules,plan_code AS "planCode",plan_version AS "planVersion",version
           FROM effective_workspace_entitlements WHERE workspace_id=$1`, [registry.workspaceId],
        ),
        client.query<{
          seatLimit: number; activeMembers: number; invitedMembers: number;
          pendingInvitations: number; reservedSeats: number; availableSeats: number;
        }>(
          `SELECT seat_limit AS "seatLimit",active_members AS "activeMembers",
                  invited_members AS "invitedMembers",pending_invitations AS "pendingInvitations",
                  reserved_seats AS "reservedSeats",available_seats AS "availableSeats"
           FROM workspace_seat_capacity($1,NULL)`, [registry.workspaceId],
        ),
        client.query<{
          id: string; userId: string; email: string; displayName: string; status: string;
          joinedAt: Date | null; directRoles: DirectRoleSource[]; inheritedRoles: TeamRoleSource[];
          grantedPermissions: string[];
        }>(
          `SELECT membership.id,membership.user_id AS "userId",app_user.primary_email AS email,
                  app_user.display_name AS "displayName",membership.status,
                  membership.joined_at AS "joinedAt",
                  COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                      'id',role.id,'code',role.code,'name',role.name
                    ) ORDER BY role.code)
                    FROM member_roles assigned JOIN roles role ON role.id=assigned.role_id
                    WHERE assigned.membership_id=membership.id
                  ),'[]'::jsonb) AS "directRoles",
                  COALESCE((
                    SELECT jsonb_agg(DISTINCT jsonb_build_object(
                      'teamId',team.id,'teamName',team.name,'roleId',role.id,
                      'roleCode',role.code,'roleName',role.name
                    ))
                    FROM effective_member_roles inherited
                    JOIN workspace_teams team ON team.id=inherited.team_id
                    JOIN roles role ON role.id=inherited.role_id
                    WHERE inherited.membership_id=membership.id AND inherited.team_id IS NOT NULL
                  ),'[]'::jsonb) AS "inheritedRoles",
                  COALESCE((
                    SELECT array_agg(DISTINCT permission.code ORDER BY permission.code)
                    FROM effective_member_roles effective_role
                    JOIN role_permissions granted ON granted.role_id=effective_role.role_id
                    JOIN permissions permission ON permission.id=granted.permission_id
                    WHERE effective_role.membership_id=membership.id
                  ),'{}'::text[]) AS "grantedPermissions"
           FROM workspace_memberships membership
           JOIN users app_user ON app_user.id=membership.user_id
           WHERE membership.workspace_id=$1
           ORDER BY app_user.display_name,app_user.primary_email`, [registry.workspaceId],
        ),
        client.query<{
          id: string; email: string; status: string; expiresAt: Date; createdAt: Date;
          reservesSeat: boolean; directRoles: DirectRoleSource[];
          teams: Array<{ id: string; name: string; roleCodes: string[] }>;
        }>(
          `SELECT invitation.id,invitation.email,
                  CASE WHEN invitation.status='pending' AND invitation.expires_at<=now()
                       THEN 'expired' ELSE invitation.status::text END AS status,
                  invitation.expires_at AS "expiresAt",invitation.created_at AS "createdAt",
                  (invitation.status='pending' AND invitation.expires_at>now()) AS "reservesSeat",
                  COALESCE((
                    SELECT jsonb_agg(jsonb_build_object('id',role.id,'code',role.code,'name',role.name)
                                     ORDER BY role.code)
                    FROM invitation_roles assigned JOIN roles role ON role.id=assigned.role_id
                    WHERE assigned.invitation_id=invitation.id
                  ),'[]'::jsonb) AS "directRoles",
                  COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                      'id',team.id,'name',team.name,
                      'roleCodes',COALESCE((SELECT array_agg(role.code ORDER BY role.code)
                        FROM workspace_team_roles grant_role JOIN roles role ON role.id=grant_role.role_id
                        WHERE grant_role.team_id=team.id),'{}'::text[])
                    ) ORDER BY team.name)
                    FROM invitation_teams invited_team JOIN workspace_teams team ON team.id=invited_team.team_id
                    WHERE invited_team.invitation_id=invitation.id
                  ),'[]'::jsonb) AS teams
           FROM workspace_invitations invitation
           WHERE invitation.workspace_id=$1
           ORDER BY invitation.created_at DESC`, [registry.workspaceId],
        ),
      ]);
      if (!workspace.rowCount) throw new NotFoundException("Client was not found");
      const entitlement = entitlementResult.rows[0] ?? null;
      const capacity = capacityResult.rows[0] ?? null;
      const seats = tenantSeatSummary(capacity ? {
        ...capacity,
      } : {
        seatLimit: null, activeMembers: 0, invitedMembers: 0,
        pendingInvitations: 0, reservedSeats: 0, availableSeats: null,
      });

      return {
        externalTenantId: registry.externalTenantId,
        organization: workspace.rows[0],
        entitlement: entitlement ?? { status: "not_configured", modules: [] },
        seats,
        members: membersResult.rows.map((member) => ({
          id: member.id,
          userId: member.userId,
          email: member.email,
          displayName: member.displayName,
          status: member.status,
          joinedAt: member.joinedAt,
          access: explainTenantMemberAccess({
            status: member.status,
            directRoles: member.directRoles,
            inheritedRoles: member.inheritedRoles,
            grantedPermissions: member.grantedPermissions,
            entitlements: entitlement,
          }),
        })),
        invitations: invitationsResult.rows,
        observedAt: new Date().toISOString(),
      };
    });
  }

  async updateManagedTenant(
    externalTenantId: string, input: UpdateTenantManagementDto,
    operatorUserId?: string, _correlationId?: string,
  ) {
    const registry = await this.findRegistry(externalTenantId);
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId ?? registry.workspaceId, async (client) => {
      const beforeWorkspace = await client.query<{ status: string; version: number }>(
        `SELECT status, version FROM workspaces WHERE id = $1 FOR UPDATE`,
        [registry.workspaceId],
      );
      const beforeSubscription = await this.subscription(client, registry.workspaceId, true);
      if (!beforeWorkspace.rowCount || !beforeSubscription) throw new NotFoundException("Client was not found");
      if (
        beforeWorkspace.rows[0].version !== input.expectedWorkspaceVersion
        || beforeSubscription.version !== input.expectedSubscriptionVersion
      ) {
        throw new ConflictException("This client changed while you were editing. Refresh and try again.");
      }

      const carriesLegacyBillingMutation = input.planCode !== undefined
        || input.subscriptionStatus !== undefined
        || input.billingCycle !== undefined
        || input.amount !== undefined
        || input.seatLimit !== undefined
        || input.projectLimit !== undefined
        || input.renewsAt !== undefined
        || input.note !== undefined;
      if (carriesLegacyBillingMutation) {
        throw new ConflictException(
          "Billing is account-controlled. Use the versioned account contract and organization allocation commands.",
        );
      }

      if (!input.workspaceStatus || input.workspaceStatus === beforeWorkspace.rows[0].status) {
        return this.loadManagedTenant(client, registry.externalTenantId, registry.workspaceId);
      }
      throw new ConflictException("Workspace access uses versioned lifecycle decisions. Open Tenant operations → Lifecycle.");
    });
  }

  getWorkspaceBilling(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client) => {
      const workspace = await client.query<{
        id: string; name: string; status: string; defaultCurrency: string;
      }>(
        `SELECT id, name, status, default_currency AS "defaultCurrency"
         FROM workspaces WHERE id = $1`,
        [workspaceId],
      );
      if (!workspace.rowCount) throw new NotFoundException("Workspace not found");
      const account = await client.query<{ id: string; displayName: string }>(
        `SELECT account.id, account.display_name AS "displayName"
         FROM customer_account_organizations linked
         JOIN customer_accounts account ON account.id = linked.account_id
         WHERE linked.workspace_id = $1`,
        [workspaceId],
      );
      const usage = await this.usage(client, workspaceId);
      if (!account.rowCount) {
        return {
          workspace: workspace.rows[0],
          account: null,
          contract: { status: "not_configured" as const, taxValidationState: "unverified" as const },
          organizationAllocation: { status: "not_configured" as const },
          collection: { status: "not_configured" as const },
          accessPolicy: deriveBillingAccessPolicy({}),
          usage,
          accountUsageSnapshot: null,
          documents: [],
          authority: "account_contract" as const,
          taxCompliance: "unverified" as const,
          observedAt: new Date().toISOString(),
        };
      }
      const accountId = account.rows[0].id;
      const [contract, allocation, collection, usageSnapshot, documents] = await Promise.all([
        client.query<{
          version: number; status: "trial_uncontracted" | "contracted" | "expired"; planCode: string;
          planVersion: number; currency: string; billingCycle: string; recurringAmount: string;
          seatLimit: number; projectLimit: number; trialEndsAt: Date | null; termStartsAt: Date;
          renewsAt: Date | null; endsAt: Date | null; taxValidationState: "unverified";
          effectiveFrom: Date; effectiveUntil: Date | null;
        }>(`SELECT version,status,plan_code AS "planCode",plan_version AS "planVersion",currency,
              billing_cycle AS "billingCycle",recurring_amount::text AS "recurringAmount",
              seat_limit AS "seatLimit",project_limit AS "projectLimit",trial_ends_at AS "trialEndsAt",
              term_starts_at AS "termStartsAt",renews_at AS "renewsAt",ends_at AS "endsAt",
              tax_validation_state AS "taxValidationState",effective_from AS "effectiveFrom",
              effective_until AS "effectiveUntil"
            FROM effective_account_contracts WHERE account_id=$1`, [accountId]),
        client.query<{
          version: number; status: string; allocatedAmount: string; seatLimit: number; projectLimit: number;
          effectiveFrom: Date; effectiveUntil: Date | null;
        }>(`SELECT version,status,allocated_amount::text AS "allocatedAmount",seat_limit AS "seatLimit",
              project_limit AS "projectLimit",effective_from AS "effectiveFrom",effective_until AS "effectiveUntil"
            FROM effective_organization_billing_allocations WHERE workspace_id=$1`, [workspaceId]),
        client.query<{
          version: number; status: "current" | "grace" | "past_due" | "collections" | "suspended" | "closed";
          overdueAmount: string; currency: string; effectiveAt: Date; nextReviewAt: Date | null;
        }>(`SELECT version,status,overdue_amount::text AS "overdueAmount",currency,
              effective_at AS "effectiveAt",next_review_at AS "nextReviewAt"
            FROM account_collection_state_versions WHERE account_id=$1 ORDER BY version DESC LIMIT 1`, [accountId]),
        client.query<{
          periodStart: Date; periodEnd: Date; capturedAt: Date; source: string;
          totals: Record<string, number>;
        }>(`SELECT period_start AS "periodStart",period_end AS "periodEnd",captured_at AS "capturedAt",
              source,totals FROM account_usage_snapshots
            WHERE account_id=$1 ORDER BY period_end DESC,captured_at DESC LIMIT 1`, [accountId]),
        client.query<{
          id: string; documentType: "invoice" | "credit_note" | "receipt"; documentNumber: string | null;
          status: string; currency: string; totalAmount: string; balanceAmount: string;
          issuedAt: Date | null; dueAt: Date | null; settledAt: Date | null;
          taxValidationState: "unverified"; createdAt: Date; updatedAt: Date;
        }>(`SELECT id,document_type AS "documentType",document_number AS "documentNumber",status,currency,
              total_amount::text AS "totalAmount",balance_amount::text AS "balanceAmount",
              issued_at AS "issuedAt",due_at AS "dueAt",settled_at AS "settledAt",
              tax_validation_state AS "taxValidationState",created_at AS "createdAt",updated_at AS "updatedAt"
            FROM account_billing_documents WHERE account_id=$1
            ORDER BY COALESCE(due_at,issued_at,created_at) DESC,id DESC LIMIT 50`, [accountId]),
      ]);
      const contractRow = contract.rows[0];
      const currentContract = contractRow ? {
        version: contractRow.version, status: contractRow.status, planCode: contractRow.planCode,
        planVersion: contractRow.planVersion, currency: contractRow.currency, billingCycle: contractRow.billingCycle,
        recurringAmount: contractRow.recurringAmount, seatLimit: contractRow.seatLimit,
        projectLimit: contractRow.projectLimit, trialEndsAt: contractRow.trialEndsAt,
        termStartsAt: contractRow.termStartsAt, renewsAt: contractRow.renewsAt, endsAt: contractRow.endsAt,
        taxValidationState: contractRow.taxValidationState, effectiveFrom: contractRow.effectiveFrom,
        effectiveUntil: contractRow.effectiveUntil,
      } : null;
      const allocationRow = allocation.rows[0];
      const currentAllocation = allocationRow ? {
        version: allocationRow.version, status: allocationRow.status, allocatedAmount: allocationRow.allocatedAmount,
        seatLimit: allocationRow.seatLimit, projectLimit: allocationRow.projectLimit,
        effectiveFrom: allocationRow.effectiveFrom, effectiveUntil: allocationRow.effectiveUntil,
      } : null;
      const collectionRow = collection.rows[0];
      const currentCollection = collectionRow ? {
        version: collectionRow.version, status: collectionRow.status, overdueAmount: collectionRow.overdueAmount,
        currency: collectionRow.currency, effectiveAt: collectionRow.effectiveAt,
        nextReviewAt: collectionRow.nextReviewAt,
      } : null;
      const publicDocuments = documents.rows.map((document) => ({
        id: document.id, documentType: document.documentType, documentNumber: document.documentNumber,
        status: document.status, currency: document.currency, totalAmount: document.totalAmount,
        balanceAmount: document.balanceAmount, issuedAt: document.issuedAt, dueAt: document.dueAt,
        settledAt: document.settledAt, taxValidationState: document.taxValidationState,
        createdAt: document.createdAt, updatedAt: document.updatedAt,
      }));
      const snapshotRow = usageSnapshot.rows[0];
      const publicSnapshot = snapshotRow ? {
        periodStart: snapshotRow.periodStart, periodEnd: snapshotRow.periodEnd,
        capturedAt: snapshotRow.capturedAt, source: snapshotRow.source, totals: snapshotRow.totals,
      } : null;
      return {
        workspace: workspace.rows[0],
        account: account.rows[0],
        contract: currentContract ?? { status: "not_configured", taxValidationState: "unverified" },
        organizationAllocation: currentAllocation ?? { status: "not_configured" },
        collection: currentCollection ?? { status: "not_configured" },
        accessPolicy: deriveBillingAccessPolicy({
          contractStatus: currentContract?.status,
          trialEndsAt: currentContract?.trialEndsAt,
          collectionStatus: currentCollection?.status,
          nextReviewAt: currentCollection?.nextReviewAt,
        }),
        usage,
        accountUsageSnapshot: publicSnapshot,
        documents: publicDocuments,
        authority: "account_contract",
        taxCompliance: "unverified",
        observedAt: new Date().toISOString(),
      };
    });
  }

  private async findRegistry(externalTenantId: string) {
    const result = await this.database.query<{
      externalTenantId: string; workspaceId: string;
    }>(
      `SELECT external_tenant_id AS "externalTenantId", workspace_id AS "workspaceId"
       FROM tenant_provisioning_requests WHERE external_tenant_id = $1`,
      [externalTenantId],
    );
    if (!result.rowCount) throw new NotFoundException("Client was not found");
    return result.rows[0];
  }

  private async loadManagedTenant(client: PoolClient, externalTenantId: string, workspaceId: string) {
    const workspace = await client.query<{
      id: string; name: string; slug: string; status: string; defaultCurrency: string;
      defaultLocale: string; defaultTimezone: string; version: number; createdAt: Date; updatedAt: Date;
    }>(
      `SELECT id, name, slug, status, default_currency AS "defaultCurrency",
              default_locale AS "defaultLocale", default_timezone AS "defaultTimezone",
              version, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM workspaces WHERE id = $1`,
      [workspaceId],
    );
    if (!workspace.rowCount) throw new NotFoundException("Client was not found");
    const owner = await client.query<{ name: string; email: string }>(
        `SELECT app_user.display_name AS name, app_user.primary_email AS email
         FROM users app_user
         WHERE app_user.id = (SELECT created_by FROM workspaces WHERE id = $1)`,
        [workspaceId],
      );
    const onboarding = await client.query<{ status: string; currentStep: string | null; completedSteps: string[] }>(
        `SELECT status, NULLIF(current_step, 'complete') AS "currentStep",
                completed_steps AS "completedSteps"
         FROM workspace_onboarding WHERE workspace_id = $1`,
        [workspaceId],
      );
    const invitation = await client.query<{
      status: string; expiresAt: Date; acceptedAt: Date | null;
      deliveryStatus: string; deliveryAttempts: number; deliveryAttemptedAt: Date | null;
    }>(
        `SELECT CASE WHEN invitation.status = 'pending' AND invitation.expires_at <= now()
                     THEN 'expired' ELSE invitation.status::text END AS status,
                invitation.expires_at AS "expiresAt", invitation.accepted_at AS "acceptedAt",
                COALESCE(delivery.status, 'untracked') AS "deliveryStatus",
                COALESCE(delivery.attempts, 0) AS "deliveryAttempts",
                delivery.last_attempted_at AS "deliveryAttemptedAt"
         FROM workspace_invitations invitation
         LEFT JOIN workspace_invitation_delivery delivery ON delivery.invitation_id = invitation.id
         WHERE invitation.workspace_id = $1
         ORDER BY invitation.created_at LIMIT 1`,
        [workspaceId],
      );
    const integrations = await client.query<{ provider: string; status: string; count: number }>(
        `SELECT provider, status::text, count(*)::int AS count
         FROM integration_connections WHERE workspace_id = $1
         GROUP BY provider, status ORDER BY provider`,
        [workspaceId],
      );
    const subscription = await this.subscription(client, workspaceId);
    const usage = await this.usage(client, workspaceId);
    const account = await client.query<{
      id: string;
      displayName: string;
      status: string;
      contractStatus: string | null;
      contractPlanCode: string | null;
      contractPlanVersion: number | null;
      organizationLimit: number;
      organizationCount: number;
      version: number;
      isDefaultOrganization: boolean;
    }>(
      `SELECT account.id, account.display_name AS "displayName", account.status,
              contract.status AS "contractStatus", contract.plan_code AS "contractPlanCode",
              contract.plan_version AS "contractPlanVersion",
              account.organization_limit AS "organizationLimit", account.version,
              linked.is_default AS "isDefaultOrganization",
              (SELECT count(*)::int FROM customer_account_organizations counted
               WHERE counted.account_id = account.id) AS "organizationCount"
       FROM customer_account_organizations linked
       JOIN customer_accounts account ON account.id = linked.account_id
       LEFT JOIN customer_account_contracts contract ON contract.account_id = account.id
       WHERE linked.workspace_id = $1`,
      [workspaceId],
    );
    return {
      externalTenantId,
      account: account.rows[0] ?? null,
      workspace: workspace.rows[0],
      owner: owner.rows[0] ?? null,
      onboarding: onboarding.rows[0] ?? { status: "not_started", currentStep: "workspace_profile", completedSteps: [] },
      ownerInvitation: invitation.rows[0] ?? null,
      integrations: integrations.rows,
      subscription,
      usage,
    };
  }

  private async usage(client: PoolClient, workspaceId: string) {
    const [capacity, projects] = await Promise.all([
      this.seatCapacity(client, workspaceId),
      client.query<{ projects: number }>(
        `SELECT count(*)::int AS projects FROM pre_project_cases
         WHERE workspace_id = $1 AND status <> 'cancelled'`, [workspaceId],
      ),
    ]);
    return {
      /** The enforced seat limit, whether it comes from an account allocation or the workspace plan. */
      seatLimit: capacity.seatLimit,
      members: capacity.activeMembers,
      invitedMembers: capacity.invitedMembers,
      pendingInvitations: capacity.pendingInvitations,
      reservedSeats: capacity.reservedSeats,
      projects: projects.rows[0]?.projects ?? 0,
    };
  }

  private async seatUsage(client: PoolClient, workspaceId: string) {
    const capacity = await this.seatCapacity(client, workspaceId);
    return {
      activeMembers: capacity.activeMembers,
      invitedMembers: capacity.invitedMembers,
      pendingInvitations: capacity.pendingInvitations,
      usedSeats: capacity.reservedSeats,
    };
  }

  private async seatCapacity(client: PoolClient, workspaceId: string) {
    const result = await client.query<{
      seatLimit: number;
      activeMembers: number;
      invitedMembers: number;
      pendingInvitations: number;
      reservedSeats: number;
      availableSeats: number;
    }>(
      `SELECT seat_limit AS "seatLimit", active_members AS "activeMembers",
              invited_members AS "invitedMembers", pending_invitations AS "pendingInvitations",
              reserved_seats AS "reservedSeats", available_seats AS "availableSeats"
       FROM workspace_seat_capacity($1, NULL)`, [workspaceId],
    );
    return result.rows[0] ?? {
      seatLimit: 0, activeMembers: 0, invitedMembers: 0,
      pendingInvitations: 0, reservedSeats: 0, availableSeats: 0,
    };
  }

  private async subscription(client: PoolClient, workspaceId: string, lock = false) {
    const result = await client.query<SubscriptionRow>(
      `SELECT plan_code AS "planCode", status, billing_cycle AS "billingCycle",
              amount::text, currency, seat_limit AS "seatLimit", project_limit AS "projectLimit",
              started_at AS "startedAt", renews_at AS "renewsAt", note, version,
              updated_at AS "updatedAt"
       FROM workspace_subscriptions WHERE workspace_id = $1${lock ? " FOR UPDATE" : ""}`,
      [workspaceId],
    );
    return result.rows[0] ?? null;
  }

}
