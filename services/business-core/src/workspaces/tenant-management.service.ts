import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { DatabaseService } from "../database/database.service";
import { WorkspaceAccessService } from "./workspace-access.service";
import type { UpdateTenantManagementDto } from "./dto/update-tenant-management.dto";

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

  async updateManagedTenant(externalTenantId: string, input: UpdateTenantManagementDto) {
    const registry = await this.findRegistry(externalTenantId);
    return this.database.tenantTransaction(registry.workspaceId, registry.workspaceId, async (client) => {
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

      if (input.seatLimit !== undefined) {
        const seatUsage = await this.seatUsage(client, registry.workspaceId);
        if (input.seatLimit < seatUsage.usedSeats) {
          throw new ConflictException({
            message: "Seat limit cannot be lower than current members and pending invitations",
            seatLimit: input.seatLimit,
            ...seatUsage,
          });
        }
      }

      if (input.workspaceStatus && input.workspaceStatus !== beforeWorkspace.rows[0].status) {
        await client.query(
          `UPDATE workspaces SET status = $1, version = version + 1, updated_at = now()
           WHERE id = $2`,
          [input.workspaceStatus, registry.workspaceId],
        );
      }

      await client.query(
        `UPDATE workspace_subscriptions SET
           plan_code = COALESCE($1, plan_code),
           status = COALESCE($2, status),
           billing_cycle = COALESCE($3, billing_cycle),
           amount = COALESCE($4, amount),
           seat_limit = COALESCE($5, seat_limit),
           project_limit = COALESCE($6, project_limit),
           renews_at = CASE WHEN $7 THEN $8::timestamptz ELSE renews_at END,
           note = CASE WHEN $9 THEN $10 ELSE note END,
           version = version + 1,
           updated_at = now()
         WHERE workspace_id = $11`,
        [
          input.planCode ?? null,
          input.subscriptionStatus ?? null,
          input.billingCycle ?? null,
          input.amount ?? null,
          input.seatLimit ?? null,
          input.projectLimit ?? null,
          input.renewsAt !== undefined,
          input.renewsAt ?? null,
          input.note !== undefined,
          input.note || null,
          registry.workspaceId,
        ],
      );

      const after = await this.loadManagedTenant(client, registry.externalTenantId, registry.workspaceId);
      await client.query(
        `INSERT INTO audit_events
          (workspace_id, actor_user_id, source, action, entity_type, entity_id, before, after, correlation_id)
         VALUES ($1, NULL, 'internal', 'tenant.billing_updated', 'workspace_subscription', $1, $2, $3, gen_random_uuid())`,
        [
          registry.workspaceId,
          JSON.stringify({ workspace: beforeWorkspace.rows[0], subscription: beforeSubscription }),
          JSON.stringify({ workspace: after.workspace, subscription: after.subscription }),
        ],
      );
      return after;
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
      const subscription = await this.subscription(client, workspaceId);
      const usage = await this.usage(client, workspaceId);
      return {
        workspace: workspace.rows[0],
        subscription: subscription ? this.publicSubscription(subscription) : null,
        usage,
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
    const invitation = await client.query<{ status: string; expiresAt: Date; acceptedAt: Date | null }>(
        `SELECT CASE WHEN status = 'pending' AND expires_at <= now() THEN 'expired' ELSE status::text END AS status,
                expires_at AS "expiresAt", accepted_at AS "acceptedAt"
         FROM workspace_invitations WHERE workspace_id = $1
         ORDER BY created_at LIMIT 1`,
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
    return {
      externalTenantId,
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
    const result = await client.query<{
      members: number;
      pendingInvitations: number;
      reservedSeats: number;
      projects: number;
    }>(
      `SELECT
        (SELECT count(*)::int FROM workspace_memberships WHERE workspace_id = $1 AND status = 'active') AS members,
        (SELECT count(*)::int FROM workspace_invitations
         WHERE workspace_id = $1 AND status = 'pending' AND expires_at > now()) AS "pendingInvitations",
        ((SELECT count(*)::int FROM workspace_memberships
          WHERE workspace_id = $1 AND status IN ('active', 'invited'))
         + (SELECT count(*)::int FROM workspace_invitations
            WHERE workspace_id = $1 AND status = 'pending' AND expires_at > now())) AS "reservedSeats",
        (SELECT count(*)::int FROM pre_project_cases WHERE workspace_id = $1 AND status <> 'archived') AS projects`,
      [workspaceId],
    );
    return result.rows[0] ?? { members: 0, pendingInvitations: 0, reservedSeats: 0, projects: 0 };
  }

  private async seatUsage(client: PoolClient, workspaceId: string) {
    const result = await client.query<{
      activeMembers: number;
      pendingInvitations: number;
      usedSeats: number;
    }>(
      `SELECT
        (SELECT count(*)::int FROM workspace_memberships
         WHERE workspace_id = $1 AND status IN ('active', 'invited')) AS "activeMembers",
        (SELECT count(*)::int FROM workspace_invitations
         WHERE workspace_id = $1 AND status = 'pending' AND expires_at > now()) AS "pendingInvitations",
        ((SELECT count(*)::int FROM workspace_memberships
          WHERE workspace_id = $1 AND status IN ('active', 'invited'))
         + (SELECT count(*)::int FROM workspace_invitations
            WHERE workspace_id = $1 AND status = 'pending' AND expires_at > now())) AS "usedSeats"`,
      [workspaceId],
    );
    return result.rows[0] ?? { activeMembers: 0, pendingInvitations: 0, usedSeats: 0 };
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

  private publicSubscription(subscription: SubscriptionRow) {
    const { note: _note, ...publicData } = subscription;
    return publicData;
  }
}
