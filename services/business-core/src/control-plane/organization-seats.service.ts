import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { seatPosition } from "./control-plane.domain";
import { resolveTenantRegistry } from "./tenant-registry";

/**
 * Seats for one organization (§6.1): the limit is checked at invite and at accept (under the workspace
 * lock); lowering it below the seats in use keeps every member and blocks new invites until there is room.
 */
@Injectable()
export class OrganizationSeatsService {
  constructor(private readonly database: DatabaseService) {}

  async view(key: string, operatorUserId: string) {
    const registry = await resolveTenantRegistry(this.database, key);
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, (client) => this.read(client, registry.workspaceId));
  }

  async change(key: string, input: { expectedVersion: number; seatLimit: number; reason: string }, operatorUserId: string) {
    const registry = await resolveTenantRegistry(this.database, key);
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      await client.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [registry.workspaceId]);
      const subscription = await client.query<{ seatLimit: number; version: number }>(
        `SELECT seat_limit AS "seatLimit", version FROM workspace_subscriptions WHERE workspace_id = $1 FOR UPDATE`,
        [registry.workspaceId]);
      if (!subscription.rowCount) throw new NotFoundException("This organization has no subscription");
      const before = subscription.rows[0];
      if (before.version !== input.expectedVersion) throw new ConflictException("Seats changed. Refresh and try again.");
      if (before.seatLimit === input.seatLimit) return this.read(client, registry.workspaceId);
      const contract = await client.query<{ seatLimit: number; elsewhere: number }>(
        `SELECT contract.seat_limit AS "seatLimit",
                COALESCE((SELECT sum(other.seat_limit)::int FROM customer_account_organizations sibling
                            JOIN workspace_subscriptions other ON other.workspace_id = sibling.workspace_id
                           WHERE sibling.account_id = linked.account_id AND sibling.workspace_id <> $1), 0) AS elsewhere
           FROM customer_account_organizations linked
           JOIN customer_account_contracts contract ON contract.account_id = linked.account_id
          WHERE linked.workspace_id = $1`, [registry.workspaceId]);
      const allowed = contract.rows[0];
      if (allowed && allowed.elsewhere + input.seatLimit > allowed.seatLimit) {
        throw new ConflictException(`The account contract allows ${allowed.seatLimit} seats across its organizations.`);
      }
      await client.query(
        `UPDATE workspace_subscriptions SET seat_limit = $2, version = version + 1, updated_by = $3, updated_at = now()
          WHERE workspace_id = $1`, [registry.workspaceId, input.seatLimit, operatorUserId]);
      // Keep the account's allocation history in step when the organization has one.
      await client.query(
        `INSERT INTO organization_billing_allocation_versions
           (workspace_id, account_contract_version_id, version, status, allocated_amount, seat_limit, project_limit,
            effective_from, effective_until, reason, created_by)
         SELECT workspace_id, account_contract_version_id, version + 1, status, allocated_amount, $2, project_limit,
                now(), effective_until, $3, $4
           FROM organization_billing_allocation_versions
          WHERE workspace_id = $1 ORDER BY version DESC LIMIT 1`,
        [registry.workspaceId, input.seatLimit, input.reason, operatorUserId]);
      const correlationId = randomUUID();
      const after = { seatLimit: input.seatLimit, reason: input.reason };
      await client.query(
        `INSERT INTO audit_events (workspace_id, actor_user_id, source, action, entity_type, entity_id, before, after, correlation_id)
         VALUES ($1, $2, 'internal', 'tenant.seat_limit_changed', 'workspace_subscription', $1, $3::jsonb, $4::jsonb, $5)`,
        [registry.workspaceId, operatorUserId, JSON.stringify({ seatLimit: before.seatLimit }), JSON.stringify(after), correlationId]);
      await client.query(
        `INSERT INTO platform_operator_audit (actor_user_id, action, target_type, target_id, correlation_id, details)
         VALUES ($1, 'tenant.seat_limit_changed', 'tenant', $2, $3, $4::jsonb)`,
        [operatorUserId, registry.externalTenantId, correlationId,
          JSON.stringify({ workspaceId: registry.workspaceId, before: { seatLimit: before.seatLimit }, after, reason: input.reason })]);
      return this.read(client, registry.workspaceId);
    });
  }

  private async read(client: PoolClient, workspaceId: string) {
    const capacity = await client.query<{ seatLimit: number; activeMembers: number; invitedMembers: number;
      pendingInvitations: number }>(
      `SELECT seat_limit AS "seatLimit", active_members AS "activeMembers", invited_members AS "invitedMembers",
              pending_invitations AS "pendingInvitations" FROM workspace_seat_capacity($1, NULL)`, [workspaceId]);
    const subscription = await client.query<{ version: number }>(
      `SELECT version FROM workspace_subscriptions WHERE workspace_id = $1`, [workspaceId]);
    const contract = await client.query<{ seatLimit: number }>(
      `SELECT contract.seat_limit AS "seatLimit" FROM customer_account_organizations linked
         JOIN customer_account_contracts contract ON contract.account_id = linked.account_id
        WHERE linked.workspace_id = $1`, [workspaceId]);
    const history = await client.query<{ id: string; before: { seatLimit?: number } | null; after: { seatLimit?: number; reason?: string } | null;
      createdAt: Date; createdByName: string | null }>(
      `SELECT event.id, event.before, event.after, event.occurred_at AS "createdAt", app_user.display_name AS "createdByName"
         FROM audit_events event LEFT JOIN users app_user ON app_user.id = event.actor_user_id
        WHERE event.workspace_id = $1 AND event.action = 'tenant.seat_limit_changed'
        ORDER BY event.occurred_at DESC LIMIT 20`, [workspaceId]);
    const row = capacity.rows[0];
    return {
      workspaceId,
      version: subscription.rows[0]?.version ?? 0,
      position: seatPosition({ limit: row?.seatLimit ?? null, activeMembers: row?.activeMembers ?? 0,
        invitedMembers: row?.invitedMembers ?? 0, pendingInvitations: row?.pendingInvitations ?? 0 }),
      activeMembers: row?.activeMembers ?? 0,
      invitedMembers: row?.invitedMembers ?? 0,
      pendingInvitations: row?.pendingInvitations ?? 0,
      contractSeatLimit: contract.rows[0]?.seatLimit ?? null,
      history: history.rows.map((event) => ({ id: event.id, from: event.before?.seatLimit ?? null, to: event.after?.seatLimit ?? null,
        reason: event.after?.reason ?? null, createdAt: event.createdAt, createdByName: event.createdByName })),
      observedAt: new Date().toISOString(),
    };
  }
}
