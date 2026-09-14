import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { DatabaseService } from "../database/database.service";
import {
  assertValidIdempotencyKey,
  provisioningRequestHash,
} from "./provisioning-idempotency";
import { WorkspaceAccessService } from "./workspace-access.service";
import { WorkspacesService } from "./workspaces.service";
import type {
  ApproveOrganizationRequestDto,
  CreateOrganizationRequestDto,
  RejectOrganizationRequestDto,
  UpdateCustomerAccountLimitDto,
} from "./dto/organization-request.dto";
import type { CreateWorkspaceDto } from "./dto/create-workspace.dto";

type AccountAccess = {
  accountId: string;
  accountRole: "owner" | "administrator" | "member";
  actorUserId: string;
};

type AccountRow = {
  id: string;
  externalCustomerId: string | null;
  displayName: string;
  status: string;
  organizationLimit: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type OrganizationRequestRow = {
  id: string;
  accountId: string;
  sourceWorkspaceId: string;
  requestedBy: string;
  requestedByName?: string;
  requestedByEmail?: string;
  idempotencyKey: string;
  requestHash: string;
  name: string;
  slug: string;
  configuration: CreateWorkspaceDto;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decisionReason: string | null;
  reviewedAt: Date | null;
  approvedWorkspaceId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export function resolveApprovalOrganizationLimit(
  currentLimit: number,
  organizationCount: number,
  requestedLimit?: number,
): number {
  if (requestedLimit !== undefined) {
    if (requestedLimit < organizationCount + 1) {
      throw new ConflictException(
        `Organization limit must be at least ${organizationCount + 1} for this approval`,
      );
    }
    if (requestedLimit < currentLimit) {
      throw new ConflictException("Approval cannot reduce the existing organization limit");
    }
  }
  const resolved = requestedLimit ?? currentLimit;
  if (organizationCount >= resolved) {
    throw new ConflictException({
      message: "Customer account organization limit reached",
      organizationLimit: resolved,
      organizationCount,
      requiredOrganizationLimit: organizationCount + 1,
    });
  }
  return resolved;
}

@Injectable()
export class CustomerAccountsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async getAccount(actor: RequestActor, workspaceId: string) {
    const access = await this.requireAccountAccess(actor, workspaceId);
    return this.database.actorTransaction(access.actorUserId, async (client) => {
      const account = await this.requireAccount(client, access.accountId);
      const organizations = await client.query<{
        id: string;
        name: string;
        slug: string;
        status: string;
        isDefault: boolean;
        membershipId: string;
        membershipStatus: string;
        roles: string[];
      }>(
        `SELECT workspace.id, workspace.name, workspace.slug, workspace.status,
                linked.is_default AS "isDefault", membership.id AS "membershipId",
                membership.status AS "membershipStatus",
                COALESCE(array_agg(role.code ORDER BY role.code)
                  FILTER (WHERE role.code IS NOT NULL), ARRAY[]::varchar[]) AS roles
         FROM customer_account_organizations linked
         JOIN workspaces workspace ON workspace.id = linked.workspace_id
         JOIN workspace_memberships membership
           ON membership.workspace_id = workspace.id
          AND membership.user_id = $2
          AND membership.status = 'active'
         LEFT JOIN member_roles assigned ON assigned.membership_id = membership.id
         LEFT JOIN roles role ON role.id = assigned.role_id
         WHERE linked.account_id = $1
           AND workspace.status = 'active'
         GROUP BY workspace.id, linked.is_default, membership.id
         ORDER BY linked.is_default DESC, workspace.name`,
        [access.accountId, access.actorUserId],
      );
      const total = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM customer_account_organizations
         WHERE account_id = $1`,
        [access.accountId],
      );
      const organizationCount = total.rows[0]?.count ?? 0;
      return {
        ...account,
        accountRole: access.accountRole,
        organizationCount,
        availableOrganizationSlots: Math.max(0, account.organizationLimit - organizationCount),
        canRequestOrganization: account.status === "active"
          && ["owner", "administrator"].includes(access.accountRole),
        organizations: organizations.rows,
      };
    });
  }

  async listRequests(actor: RequestActor, workspaceId: string) {
    const account = await this.requireManagingAccountAccess(actor, workspaceId);
    const result = await this.database.query<OrganizationRequestRow>(
      `${this.requestSelect()}
       WHERE request.account_id = $1
       ORDER BY request.created_at DESC`,
      [account.accountId],
    );
    return result.rows.map((row) => this.mapRequest(row));
  }

  async requestOrganization(
    actor: RequestActor,
    workspaceId: string,
    input: CreateOrganizationRequestDto,
    suppliedIdempotencyKey?: string,
  ) {
    let idempotencyKey: string;
    try {
      idempotencyKey = assertValidIdempotencyKey(suppliedIdempotencyKey);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const access = await this.requireManagingAccountAccess(actor, workspaceId);
    const { reason, ...requestedWorkspace } = input;
    const configuration: CreateWorkspaceDto = {
      ...requestedWorkspace,
      slug: requestedWorkspace.slug ?? this.toSlug(requestedWorkspace.name),
    };
    const requestHash = provisioningRequestHash({ configuration, reason: reason || null });

    return this.database.tenantTransaction(workspaceId, access.actorUserId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `customer-account:${access.accountId}`,
      ]);
      const account = await this.requireAccount(client, access.accountId, true);
      if (account.status !== "active") {
        throw new ConflictException("This customer account is not active");
      }
      const existing = await client.query<OrganizationRequestRow>(
        `${this.requestSelect()}
         WHERE request.account_id = $1 AND request.idempotency_key = $2
         LIMIT 1`,
        [access.accountId, idempotencyKey],
      );
      if (existing.rowCount) {
        if (existing.rows[0].requestHash !== requestHash) {
          throw new ConflictException(
            "This idempotency key was already used for a different organization request",
          );
        }
        return { ...this.mapRequest(existing.rows[0]), replayed: true };
      }
      const sameSlug = await client.query(
        `SELECT 1 FROM organization_requests
         WHERE account_id = $1 AND lower(slug) = lower($2) AND status = 'pending'
         LIMIT 1`,
        [access.accountId, configuration.slug],
      );
      if (sameSlug.rowCount) {
        throw new ConflictException("A pending request already uses this organization slug");
      }
      const requestId = randomUUID();
      const inserted = await client.query<OrganizationRequestRow>(
        `${this.requestInsert()}
         RETURNING id, account_id AS "accountId", source_workspace_id AS "sourceWorkspaceId",
                   requested_by AS "requestedBy", idempotency_key AS "idempotencyKey",
                   request_hash AS "requestHash", name, slug, configuration, reason, status,
                   decision_reason AS "decisionReason", reviewed_at AS "reviewedAt",
                   approved_workspace_id AS "approvedWorkspaceId", version,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          requestId,
          access.accountId,
          workspaceId,
          access.actorUserId,
          idempotencyKey,
          requestHash,
          configuration.name,
          configuration.slug,
          configuration,
          reason || null,
        ],
      );
      await this.recordAccountChange(client, {
        workspaceId,
        actorUserId: access.actorUserId,
        action: "customer_account.organization_requested",
        entityId: requestId,
        after: this.mapRequest(inserted.rows[0]),
      });
      return { ...this.mapRequest(inserted.rows[0]), replayed: false };
    });
  }

  async cancelRequest(
    actor: RequestActor,
    workspaceId: string,
    requestId: string,
    expectedVersion: number,
  ) {
    const access = await this.requireManagingAccountAccess(actor, workspaceId);
    return this.database.tenantTransaction(workspaceId, access.actorUserId, async (client) => {
      const found = await client.query<OrganizationRequestRow>(
        `${this.requestSelect()}
         WHERE request.id = $1 AND request.account_id = $2
         FOR UPDATE OF request`,
        [requestId, access.accountId],
      );
      if (!found.rowCount) throw new NotFoundException("Organization request not found");
      const before = found.rows[0];
      if (before.status !== "pending") {
        throw new ConflictException("Only a pending organization request can be cancelled");
      }
      if (before.version !== expectedVersion) {
        throw new ConflictException("Organization request changed; reload and try again");
      }
      const updated = await client.query<OrganizationRequestRow>(
        `UPDATE organization_requests
         SET status = 'cancelled', version = version + 1
         WHERE id = $1 AND status = 'pending' AND version = $2
         RETURNING id, account_id AS "accountId", source_workspace_id AS "sourceWorkspaceId",
                   requested_by AS "requestedBy", idempotency_key AS "idempotencyKey",
                   request_hash AS "requestHash", name, slug, configuration, reason, status,
                   decision_reason AS "decisionReason", reviewed_at AS "reviewedAt",
                   approved_workspace_id AS "approvedWorkspaceId", version,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [requestId, expectedVersion],
      );
      if (!updated.rowCount) throw new ConflictException("Organization request changed; reload and try again");
      const response = this.mapRequest(updated.rows[0]);
      await this.recordAccountChange(client, {
        workspaceId,
        actorUserId: access.actorUserId,
        action: "customer_account.organization_request_cancelled",
        entityId: requestId,
        before: this.mapRequest(before),
        after: response,
      });
      return response;
    });
  }

  async listRequestsForReview(status?: OrganizationRequestRow["status"]) {
    const result = await this.database.query<OrganizationRequestRow & { accountName: string }>(
      `SELECT request.id, request.account_id AS "accountId",
              request.source_workspace_id AS "sourceWorkspaceId",
              request.requested_by AS "requestedBy",
              requester.display_name AS "requestedByName",
              requester.primary_email AS "requestedByEmail",
              request.idempotency_key AS "idempotencyKey",
              request.request_hash AS "requestHash", request.name, request.slug,
              request.configuration, request.reason, request.status,
              request.decision_reason AS "decisionReason",
              request.reviewed_at AS "reviewedAt",
              request.approved_workspace_id AS "approvedWorkspaceId",
              request.version, request.created_at AS "createdAt",
              request.updated_at AS "updatedAt",
              account.display_name AS "accountName"
       FROM organization_requests request
       JOIN customer_accounts account ON account.id = request.account_id
       JOIN users requester ON requester.id = request.requested_by
       WHERE ($1::text IS NULL OR request.status = $1)
       ORDER BY CASE WHEN request.status = 'pending' THEN 0 ELSE 1 END,
                request.created_at ASC`,
      [status ?? null],
    );
    return result.rows.map((row) => ({
      ...this.mapRequest(row),
      accountName: row.accountName,
    }));
  }

  async getAccountForManagement(accountId: string) {
    return this.database.transaction(async (client) => {
      const account = await this.requireAccount(client, accountId);
      const organizations = await client.query<{
        id: string;
        name: string;
        slug: string;
        status: string;
        version: number;
        isDefault: boolean;
        seatLimit: number;
        projectLimit: number;
        subscriptionStatus: string;
      }>(
        `SELECT workspace.id, workspace.name, workspace.slug, workspace.status,
                workspace.version, linked.is_default AS "isDefault",
                subscription.seat_limit AS "seatLimit",
                subscription.project_limit AS "projectLimit",
                subscription.status AS "subscriptionStatus"
         FROM customer_account_organizations linked
         JOIN workspaces workspace ON workspace.id = linked.workspace_id
         JOIN workspace_subscriptions subscription ON subscription.workspace_id = workspace.id
         WHERE linked.account_id = $1
         ORDER BY linked.is_default DESC, workspace.name`,
        [accountId],
      );
      const requests = await client.query<OrganizationRequestRow>(
        `${this.requestSelect()}
         WHERE request.account_id = $1
         ORDER BY request.created_at DESC`,
        [accountId],
      );
      return {
        ...account,
        organizationCount: organizations.rowCount,
        availableOrganizationSlots: Math.max(
          0,
          account.organizationLimit - (organizations.rowCount ?? 0),
        ),
        organizations: organizations.rows,
        requests: requests.rows.map((row) => this.mapRequest(row)),
      };
    });
  }

  async approveRequest(requestId: string, input: ApproveOrganizationRequestDto) {
    try {
      return await this.database.transaction(async (client) => {
        const found = await client.query<OrganizationRequestRow>(
          `${this.requestSelect()}
           WHERE request.id = $1
           FOR UPDATE OF request`,
          [requestId],
        );
        if (!found.rowCount) throw new NotFoundException("Organization request not found");
        const before = found.rows[0];
        if (before.status === "approved") {
          return { ...this.mapRequest(before), replayed: true };
        }
        if (before.status !== "pending") {
          throw new ConflictException("Only a pending organization request can be approved");
        }
        if (before.version !== input.expectedVersion) {
          throw new ConflictException("Organization request changed; reload and try again");
        }
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `customer-account:${before.accountId}`,
        ]);
        const account = await this.requireAccount(client, before.accountId, true);
        if (account.status !== "active") {
          throw new ConflictException("This customer account is not active");
        }
        const count = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM customer_account_organizations WHERE account_id = $1`,
          [before.accountId],
        );
        const organizationCount = count.rows[0]?.count ?? 0;
        const organizationLimit = resolveApprovalOrganizationLimit(
          account.organizationLimit,
          organizationCount,
          input.organizationLimit,
        );
        if (organizationLimit !== account.organizationLimit) {
          await client.query(
            `UPDATE customer_accounts
             SET organization_limit = $1, version = version + 1
             WHERE id = $2`,
            [organizationLimit, account.id],
          );
        }

        const organization = await this.workspaces.provisionApprovedOrganization(
          client,
          before.configuration,
          before.requestedBy,
          before.accountId,
        );
        const updated = await client.query<OrganizationRequestRow>(
          `UPDATE organization_requests
           SET status = 'approved', decision_reason = $1, reviewed_at = now(),
               approved_workspace_id = $2, version = version + 1
           WHERE id = $3 AND status = 'pending' AND version = $4
           RETURNING id, account_id AS "accountId", source_workspace_id AS "sourceWorkspaceId",
                     requested_by AS "requestedBy", idempotency_key AS "idempotencyKey",
                     request_hash AS "requestHash", name, slug, configuration, reason, status,
                     decision_reason AS "decisionReason", reviewed_at AS "reviewedAt",
                     approved_workspace_id AS "approvedWorkspaceId", version,
                     created_at AS "createdAt", updated_at AS "updatedAt"`,
          [input.decisionReason || null, organization.workspace.id, requestId, input.expectedVersion],
        );
        if (!updated.rowCount) throw new ConflictException("Organization request changed; reload and try again");
        await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [
          before.sourceWorkspaceId,
        ]);
        await client.query("SELECT set_config('app.current_actor_id', $1, true)", [before.requestedBy]);
        const response = this.mapRequest(updated.rows[0]);
        await this.recordAccountChange(client, {
          workspaceId: before.sourceWorkspaceId,
          actorUserId: null,
          source: "internal",
          action: "customer_account.organization_approved",
          entityId: requestId,
          before: this.mapRequest(before),
          after: { ...response, organizationLimit },
        });
        return { ...response, organization, organizationLimit, replayed: false };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictException("An organization with this slug or legal-entity code already exists");
      }
      throw error;
    }
  }

  async rejectRequest(requestId: string, input: RejectOrganizationRequestDto) {
    return this.database.transaction(async (client) => {
      const found = await client.query<OrganizationRequestRow>(
        `${this.requestSelect()}
         WHERE request.id = $1
         FOR UPDATE OF request`,
        [requestId],
      );
      if (!found.rowCount) throw new NotFoundException("Organization request not found");
      const before = found.rows[0];
      if (before.status !== "pending") {
        throw new ConflictException("Only a pending organization request can be rejected");
      }
      if (before.version !== input.expectedVersion) {
        throw new ConflictException("Organization request changed; reload and try again");
      }
      const updated = await client.query<OrganizationRequestRow>(
        `UPDATE organization_requests
         SET status = 'rejected', decision_reason = $1, reviewed_at = now(),
             version = version + 1
         WHERE id = $2 AND status = 'pending' AND version = $3
         RETURNING id, account_id AS "accountId", source_workspace_id AS "sourceWorkspaceId",
                   requested_by AS "requestedBy", idempotency_key AS "idempotencyKey",
                   request_hash AS "requestHash", name, slug, configuration, reason, status,
                   decision_reason AS "decisionReason", reviewed_at AS "reviewedAt",
                   approved_workspace_id AS "approvedWorkspaceId", version,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [input.decisionReason, requestId, input.expectedVersion],
      );
      if (!updated.rowCount) throw new ConflictException("Organization request changed; reload and try again");
      await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [before.sourceWorkspaceId]);
      await client.query("SELECT set_config('app.current_actor_id', $1, true)", [before.requestedBy]);
      const response = this.mapRequest(updated.rows[0]);
      await this.recordAccountChange(client, {
        workspaceId: before.sourceWorkspaceId,
        actorUserId: null,
        source: "internal",
        action: "customer_account.organization_rejected",
        entityId: requestId,
        before: this.mapRequest(before),
        after: response,
      });
      return response;
    });
  }

  async updateOrganizationLimit(accountId: string, input: UpdateCustomerAccountLimitDto) {
    return this.database.transaction(async (client) => {
      const account = await this.requireAccount(client, accountId, true);
      if (account.version !== input.expectedVersion) {
        throw new ConflictException("Customer account changed; reload and try again");
      }
      const count = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM customer_account_organizations WHERE account_id = $1`,
        [accountId],
      );
      const organizationCount = count.rows[0]?.count ?? 0;
      if (input.organizationLimit < organizationCount) {
        throw new ConflictException({
          message: "Organization limit cannot be lower than the existing organization count",
          organizationLimit: input.organizationLimit,
          organizationCount,
        });
      }
      const updated = await client.query<AccountRow>(
        `UPDATE customer_accounts
         SET organization_limit = $1, version = version + 1
         WHERE id = $2 AND version = $3
         RETURNING id, external_customer_id AS "externalCustomerId",
                   display_name AS "displayName", status,
                   organization_limit AS "organizationLimit", version,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [input.organizationLimit, accountId, input.expectedVersion],
      );
      if (!updated.rowCount) throw new ConflictException("Customer account changed; reload and try again");
      const defaultWorkspace = await client.query<{ workspaceId: string; createdBy: string }>(
        `SELECT linked.workspace_id AS "workspaceId", account.created_by AS "createdBy"
         FROM customer_account_organizations linked
         JOIN customer_accounts account ON account.id = linked.account_id
         WHERE linked.account_id = $1 AND linked.is_default = true`,
        [accountId],
      );
      if (defaultWorkspace.rowCount) {
        await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [
          defaultWorkspace.rows[0].workspaceId,
        ]);
        await client.query("SELECT set_config('app.current_actor_id', $1, true)", [
          defaultWorkspace.rows[0].createdBy,
        ]);
        await this.recordAccountChange(client, {
          workspaceId: defaultWorkspace.rows[0].workspaceId,
          actorUserId: null,
          source: "internal",
          action: "customer_account.organization_limit_updated",
          entityId: accountId,
          before: account,
          after: updated.rows[0],
        });
      }
      return { ...updated.rows[0], organizationCount };
    });
  }

  private async requireAccountAccess(actor: RequestActor, workspaceId: string): Promise<AccountAccess> {
    return this.access.asMember(actor, workspaceId, async (client, actorUser) => {
      const account = await client.query<{ accountId: string; accountRole: AccountAccess["accountRole"] }>(
        `SELECT linked.account_id AS "accountId", account_member.role AS "accountRole"
         FROM customer_account_organizations linked
         JOIN customer_account_memberships account_member
           ON account_member.account_id = linked.account_id
          AND account_member.user_id = $2
          AND account_member.status = 'active'
         WHERE linked.workspace_id = $1`,
        [workspaceId, actorUser.userId],
      );
      if (!account.rowCount) {
        throw new ForbiddenException("Customer account access is required");
      }
      return { ...account.rows[0], actorUserId: actorUser.userId };
    });
  }

  private async requireManagingAccountAccess(
    actor: RequestActor,
    workspaceId: string,
  ): Promise<AccountAccess> {
    const account = await this.access.withAnyPermission(
      actor,
      workspaceId,
      ["module.organization.edit", "workspace.settings.manage"],
      async (client, actorUser) => {
        const result = await client.query<{ accountId: string; accountRole: AccountAccess["accountRole"] }>(
          `SELECT linked.account_id AS "accountId", account_member.role AS "accountRole"
           FROM customer_account_organizations linked
           JOIN customer_account_memberships account_member
             ON account_member.account_id = linked.account_id
            AND account_member.user_id = $2
            AND account_member.status = 'active'
           WHERE linked.workspace_id = $1`,
          [workspaceId, actorUser.userId],
        );
        if (!result.rowCount || !["owner", "administrator"].includes(result.rows[0].accountRole)) {
          throw new ForbiddenException("Customer account owner or administrator access is required");
        }
        return { ...result.rows[0], actorUserId: actorUser.userId };
      },
    );
    return account;
  }

  private async requireAccount(client: PoolClient, accountId: string, lock = false): Promise<AccountRow> {
    const result = await client.query<AccountRow>(
      `SELECT id, external_customer_id AS "externalCustomerId",
              display_name AS "displayName", status,
              organization_limit AS "organizationLimit", version,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM customer_accounts WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
      [accountId],
    );
    if (!result.rowCount) throw new NotFoundException("Customer account not found");
    return result.rows[0];
  }

  private requestSelect() {
    return `SELECT request.id, request.account_id AS "accountId",
                   request.source_workspace_id AS "sourceWorkspaceId",
                   request.requested_by AS "requestedBy",
                   requester.display_name AS "requestedByName",
                   requester.primary_email AS "requestedByEmail",
                   request.idempotency_key AS "idempotencyKey",
                   request.request_hash AS "requestHash", request.name, request.slug,
                   request.configuration, request.reason, request.status,
                   request.decision_reason AS "decisionReason",
                   request.reviewed_at AS "reviewedAt",
                   request.approved_workspace_id AS "approvedWorkspaceId",
                   request.version, request.created_at AS "createdAt",
                   request.updated_at AS "updatedAt"
            FROM organization_requests request
            JOIN users requester ON requester.id = request.requested_by`;
  }

  private requestInsert() {
    return `INSERT INTO organization_requests
              (id, account_id, source_workspace_id, requested_by, idempotency_key,
               request_hash, name, slug, configuration, reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
  }

  private mapRequest(row: OrganizationRequestRow) {
    return {
      id: row.id,
      accountId: row.accountId,
      sourceWorkspaceId: row.sourceWorkspaceId,
      requestedBy: {
        userId: row.requestedBy,
        displayName: row.requestedByName ?? null,
        email: row.requestedByEmail ?? null,
      },
      name: row.name,
      slug: row.slug,
      configuration: row.configuration,
      reason: row.reason,
      status: row.status,
      decisionReason: row.decisionReason,
      reviewedAt: row.reviewedAt,
      approvedWorkspaceId: row.approvedWorkspaceId,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async recordAccountChange(
    client: PoolClient,
    change: {
      workspaceId: string;
      actorUserId: string | null;
      source?: "user" | "internal";
      action: string;
      entityId: string;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    },
  ) {
    const eventId = randomUUID();
    const correlationId = randomUUID();
    const occurredAt = new Date().toISOString();
    await client.query(
      `INSERT INTO audit_events
        (id, workspace_id, actor_user_id, source, action, entity_type, entity_id,
         before, after, correlation_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, 'customer_account', $6, $7, $8, $9, $10)`,
      [
        eventId,
        change.workspaceId,
        change.actorUserId,
        change.source ?? "user",
        change.action,
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
       VALUES ($1, $2, 'customer_account', $3, $4, $5)`,
      [
        eventId,
        change.workspaceId,
        change.entityId,
        change.action,
        {
          schemaVersion: 1,
          eventId,
          workspaceId: change.workspaceId,
          aggregateType: "customer_account",
          aggregateId: change.entityId,
          actorUserId: change.actorUserId,
          occurredAt,
          correlationId,
          causationId: null,
          data: change.after ?? {},
        },
      ],
    );
  }

  private toSlug(value: string) {
    const slug = value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "");
    if (!slug) throw new BadRequestException("Organization name must contain letters or numbers");
    return slug;
  }
}
