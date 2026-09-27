import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { isPlatformOperatorRole, platformOperatorCan, type PlatformOperatorPermission } from "../auth/platform-operator-policy";
import { DatabaseService } from "../database/database.service";
import { assertValidIdempotencyKey } from "../workspaces/provisioning-idempotency";
import { SERVICE_ACTOR_ID } from "./control-notices.service";
import {
  SUPPORT_REQUEST_WINDOW_HOURS,
  SupportSessionRuleError,
  clampSupportMinutes,
  planSupportCommand,
  projectSupportState,
  supportAccessDecision,
  type SupportAccessDenial,
  type SupportSessionCommand,
} from "./control-plane.domain";
import { resolveTenantRegistry, type TenantRegistry } from "./tenant-registry";

export type SupportOperator = { userId: string; permissions: readonly PlatformOperatorPermission[] };

type SessionRow = {
  id: string; status: string; reason: string; accessLevel: string; durationMinutes: number;
  requestedBy: string; requestedByName: string | null; approvedBy: string | null; approvedByName: string | null;
  requestedAt: Date; approvedAt: Date | null; startsAt: Date | null; expiresAt: Date; endedAt: Date | null;
  endReason: string | null; decisionNote: string | null; version: number;
};

const DENIAL_MESSAGE: Record<SupportAccessDenial, string> = {
  no_session: "Tenant records open only inside your approved, active support session.",
  not_started: "Start your approved support session to open tenant records.",
  expired: "Your support session has ended. Request a new one.",
  operator_inactive: "Your operator access is no longer active. The support session was revoked.",
  role_changed: "Your role no longer allows support access. The support session was revoked.",
};

function correlation() { return randomUUID(); }

/**
 * Support sessions `requested → approved → active → expired | revoked` (§6.1). A second operator approves,
 * the requester starts the time box, and tenant records open only inside the requester's own active session.
 * A session whose operator lost the role is revoked, on the next read and by the sweep.
 */
@Injectable()
export class SupportSessionsService {
  constructor(private readonly database: DatabaseService) {}

  async list(key: string, operator: SupportOperator) {
    const registry = await resolveTenantRegistry(this.database, key);
    return this.database.tenantTransaction(registry.workspaceId, operator.userId, async (client) => {
      const sessions = await client.query<SessionRow>(`${this.select()} WHERE session.workspace_id = $1
        ORDER BY session.requested_at DESC LIMIT 50`, [registry.workspaceId]);
      const canApprove = operator.permissions.includes("support.approve");
      return {
        workspaceId: registry.workspaceId,
        sessions: sessions.rows.map((row) => {
          const status = projectSupportState(row);
          const mine = row.requestedBy === operator.userId;
          return { ...row, status,
            canApprove: status === "requested" && !mine && canApprove,
            canReject: (status === "requested" || status === "approved") && !mine && canApprove,
            canStart: status === "approved" && mine,
            canRevoke: ["requested", "approved", "active"].includes(status) && (mine || canApprove) };
        }),
        observedAt: new Date().toISOString(),
      };
    });
  }

  async request(key: string, input: { reason: string; durationMinutes: number }, suppliedKey: string | undefined,
    operator: SupportOperator) {
    let idempotencyKey: string;
    try { idempotencyKey = assertValidIdempotencyKey(suppliedKey); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    try { clampSupportMinutes(input.durationMinutes); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    const registry = await resolveTenantRegistry(this.database, key);
    return this.database.tenantTransaction(registry.workspaceId, operator.userId, async (client) => {
      const workspace = await client.query<{ status: string }>(`SELECT status::text FROM workspaces WHERE id = $1 FOR UPDATE`,
        [registry.workspaceId]);
      if (workspace.rows[0]?.status === "archived") throw new ConflictException("An archived organization has no support access.");
      const replay = await client.query<SessionRow>(`${this.select()} WHERE session.workspace_id = $1
        AND session.requested_by = $2 AND session.idempotency_key = $3`, [registry.workspaceId, operator.userId, idempotencyKey]);
      if (replay.rowCount) return { ...replay.rows[0], status: projectSupportState(replay.rows[0]), replayed: true };
      await this.expireDue(client, registry.workspaceId);
      const open = await client.query(`SELECT 1 FROM tenant_support_sessions WHERE workspace_id = $1 AND requested_by = $2
        AND status IN ('requested', 'approved', 'active')`, [registry.workspaceId, operator.userId]);
      if (open.rowCount) throw new ConflictException("You already have an open support session for this organization.");
      const created = await client.query<{ id: string }>(
        `INSERT INTO tenant_support_sessions
           (workspace_id, requested_by, access_level, reason, duration_minutes, expires_at, correlation_id, idempotency_key)
         VALUES ($1, $2, 'read_only', $3, $4, now() + ($5 * interval '1 hour'), $6, $7) RETURNING id`,
        [registry.workspaceId, operator.userId, input.reason.trim(), input.durationMinutes,
          SUPPORT_REQUEST_WINDOW_HOURS, correlation(), idempotencyKey],
      );
      await this.audit(client, operator.userId, "tenant.support_requested", registry,
        { supportSessionId: created.rows[0].id, durationMinutes: input.durationMinutes });
      const saved = await client.query<SessionRow>(`${this.select()} WHERE session.id = $1`, [created.rows[0].id]);
      return { ...saved.rows[0], replayed: false };
    });
  }

  async command(key: string, sessionId: string, command: SupportSessionCommand,
    input: { expectedVersion: number; note?: string }, operator: SupportOperator) {
    const registry = await resolveTenantRegistry(this.database, key);
    return this.database.tenantTransaction(registry.workspaceId, operator.userId, async (client) => {
      const found = await client.query<SessionRow>(`${this.select()} WHERE session.workspace_id = $1 AND session.id = $2
        FOR UPDATE OF session`, [registry.workspaceId, sessionId]);
      if (!found.rowCount) throw new NotFoundException("Support session was not found");
      const current = found.rows[0];
      if (current.version !== input.expectedVersion) throw new ConflictException("Support session changed. Refresh and try again.");
      let plan: ReturnType<typeof planSupportCommand>;
      try {
        plan = planSupportCommand({ command, status: current.status, expiresAt: current.expiresAt,
          requestedBy: current.requestedBy, actorUserId: operator.userId,
          actorCanApprove: operator.permissions.includes("support.approve"), durationMinutes: current.durationMinutes });
      } catch (error) {
        if (error instanceof SupportSessionRuleError) throw new ConflictException(error.message);
        throw error;
      }
      await client.query(
        `UPDATE tenant_support_sessions SET status = $3::varchar,
           approved_by = CASE WHEN $3::text = 'approved' THEN $4::uuid ELSE approved_by END,
           approved_at = CASE WHEN $3::text = 'approved' THEN now() ELSE approved_at END,
           starts_at = COALESCE($5::timestamptz, starts_at),
           expires_at = COALESCE($6::timestamptz, expires_at),
           ended_at = CASE WHEN $3::text IN ('rejected', 'revoked') THEN now() ELSE ended_at END,
           ended_by = CASE WHEN $3::text IN ('rejected', 'revoked') THEN $4::uuid ELSE ended_by END,
           end_reason = COALESCE($7::varchar, end_reason),
           decision_note = COALESCE($8::varchar, decision_note),
           version = version + 1, updated_at = now()
         WHERE workspace_id = $1 AND id = $2`,
        [registry.workspaceId, sessionId, plan.status, operator.userId, plan.startsAt ?? null, plan.expiresAt ?? null,
          plan.endReason ?? null, input.note?.trim() || null],
      );
      await this.audit(client, operator.userId, `tenant.support_${plan.status}`, registry, {
        supportSessionId: sessionId, before: { status: current.status, version: current.version },
        after: { status: plan.status, expiresAt: plan.expiresAt ?? current.expiresAt }, note: input.note ?? null });
      const saved = await client.query<SessionRow>(`${this.select()} WHERE session.id = $1`, [sessionId]);
      return saved.rows[0];
    });
  }

  /** Tenant members, visible only inside the operator's own active session. */
  async members(key: string, operator: SupportOperator) {
    return this.withAccess(key, operator, "members", async (client, registry) => {
      const members = await client.query(
        `SELECT membership.id, app_user.display_name AS "displayName", app_user.primary_email AS email,
                membership.status::text AS status, membership.joined_at AS "joinedAt",
                COALESCE(array_agg(DISTINCT role.name ORDER BY role.name) FILTER (WHERE role.name IS NOT NULL), '{}') AS roles
           FROM workspace_memberships membership
           JOIN users app_user ON app_user.id = membership.user_id
           LEFT JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
           LEFT JOIN roles role ON role.id = assigned.role_id
          WHERE membership.workspace_id = $1
          GROUP BY membership.id, app_user.id
          ORDER BY app_user.display_name`, [registry.workspaceId]);
      return { members: members.rows };
    });
  }

  /** The tenant's own activity (its people's actions), visible only inside the operator's active session. */
  async activity(key: string, operator: SupportOperator) {
    return this.withAccess(key, operator, "activity", async (client, registry) => {
      const events = await client.query(
        `SELECT event.id, event.action, event.entity_type AS "entityType", event.source,
                app_user.display_name AS "actorName", event.occurred_at AS "occurredAt"
           FROM audit_events event LEFT JOIN users app_user ON app_user.id = event.actor_user_id
          WHERE event.workspace_id = $1 ORDER BY event.occurred_at DESC LIMIT 100`, [registry.workspaceId]);
      return { events: events.rows };
    });
  }

  /** Sweep: sessions past their time become expired; sessions whose operator lost the role are revoked. */
  async sweep(workspaceId: string) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const expired = await this.expireDue(client, workspaceId);
      const open = await client.query<{ id: string; requestedBy: string; role: string | null; operatorStatus: string | null }>(
        `SELECT session.id, session.requested_by AS "requestedBy", operator.role, operator.status AS "operatorStatus"
           FROM tenant_support_sessions session
           LEFT JOIN platform_administrators operator ON operator.user_id = session.requested_by
          WHERE session.workspace_id = $1 AND session.status IN ('requested', 'approved', 'active')`, [workspaceId]);
      let revoked = 0;
      for (const session of open.rows) {
        const allowed = session.operatorStatus === "active" && session.role !== null
          && isPlatformOperatorRole(session.role) && platformOperatorCan(session.role, "support.request");
        if (!allowed) {
          await this.autoRevoke(client, workspaceId, session.id);
          revoked += 1;
        }
      }
      return { expired, revoked };
    });
  }

  private async withAccess<T>(key: string, operator: SupportOperator, view: string,
    work: (client: PoolClient, registry: TenantRegistry) => Promise<T>) {
    const registry = await resolveTenantRegistry(this.database, key);
    const outcome = await this.database.tenantTransaction(registry.workspaceId, operator.userId, async (client) => {
      const session = await client.query<SessionRow>(`${this.select()} WHERE session.workspace_id = $1
        AND session.requested_by = $2 AND session.status IN ('requested', 'approved', 'active')
        ORDER BY session.requested_at DESC LIMIT 1`, [registry.workspaceId, operator.userId]);
      const state = await client.query<{ role: string; status: string }>(
        `SELECT role, status FROM platform_administrators WHERE user_id = $1`, [operator.userId]);
      const role = state.rows[0]?.role ?? "";
      const decision = supportAccessDecision({
        session: session.rows[0] ?? null,
        operatorUserId: operator.userId,
        operatorActive: state.rows[0]?.status === "active",
        operatorCanRequestSupport: isPlatformOperatorRole(role) && platformOperatorCan(role, "support.request"),
      });
      if (!decision.allowed) {
        if (decision.revoke && session.rows[0]) await this.autoRevoke(client, registry.workspaceId, session.rows[0].id);
        await this.audit(client, operator.userId, "tenant.support_view_denied", registry, { view, reason: decision.reason });
        return { denied: decision.reason as SupportAccessDenial, session: null, value: null };
      }
      await this.audit(client, operator.userId, "tenant.support_viewed", registry,
        { view, supportSessionId: session.rows[0].id });
      return { denied: null, session: session.rows[0], value: await work(client, registry) };
    });
    if (outcome.denied || !outcome.session) {
      const reason = outcome.denied ?? "no_session";
      throw new ForbiddenException({ code: "support_session_required", reason, message: DENIAL_MESSAGE[reason] });
    }
    return { ...outcome.value as T, session: { id: outcome.session.id, expiresAt: outcome.session.expiresAt } };
  }

  private async expireDue(client: PoolClient, workspaceId: string) {
    const expired = await client.query(
      `UPDATE tenant_support_sessions SET status = 'expired', end_reason = 'expired', ended_at = expires_at,
         version = version + 1, updated_at = now()
       WHERE workspace_id = $1 AND status IN ('requested', 'approved', 'active') AND expires_at <= now()`, [workspaceId]);
    return expired.rowCount ?? 0;
  }

  private async autoRevoke(client: PoolClient, workspaceId: string, sessionId: string) {
    await client.query(
      `UPDATE tenant_support_sessions SET status = 'revoked', end_reason = 'operator_role_changed', ended_at = now(),
         version = version + 1, updated_at = now()
       WHERE workspace_id = $1 AND id = $2 AND status IN ('requested', 'approved', 'active')`, [workspaceId, sessionId]);
    await client.query(
      `INSERT INTO platform_operator_audit (actor_user_id, action, target_type, target_id, correlation_id, details)
       VALUES (NULL, 'tenant.support_auto_revoked', 'tenant', $1, $2, $3::jsonb)`,
      [workspaceId, correlation(), JSON.stringify({ workspaceId, supportSessionId: sessionId, reason: "operator_role_changed" })]);
  }

  private audit(client: PoolClient, actorUserId: string, action: string, registry: TenantRegistry, details: Record<string, unknown>) {
    return client.query(
      `INSERT INTO platform_operator_audit (actor_user_id, action, target_type, target_id, correlation_id, details)
       VALUES ($1, $2, 'tenant', $3, $4, $5::jsonb)`,
      [actorUserId, action, registry.externalTenantId, correlation(), JSON.stringify({ workspaceId: registry.workspaceId, ...details })]);
  }

  private select() {
    return `SELECT session.id, session.status, session.reason, session.access_level AS "accessLevel",
        session.duration_minutes AS "durationMinutes", session.requested_by AS "requestedBy",
        requester.display_name AS "requestedByName", session.approved_by AS "approvedBy",
        approver.display_name AS "approvedByName", session.requested_at AS "requestedAt",
        session.approved_at AS "approvedAt", session.starts_at AS "startsAt", session.expires_at AS "expiresAt",
        session.ended_at AS "endedAt", session.end_reason AS "endReason", session.decision_note AS "decisionNote",
        session.version
      FROM tenant_support_sessions session
      LEFT JOIN users requester ON requester.id = session.requested_by
      LEFT JOIN users approver ON approver.id = session.approved_by`;
  }
}
