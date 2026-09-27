import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import type { TransitionTenantLifecycleDto } from "../workspaces/dto/tenant-operations.dto";
import { assertValidIdempotencyKey } from "../workspaces/provisioning-idempotency";
import { canonicalHash } from "../workspaces/tenant-operations.domain";
import {
  planTenantLifecycleTransition,
  tenantLifecycleBaseline,
  tenantLifecycleOptions,
  type TenantLifecycleState,
} from "../workspaces/tenant-lifecycle.domain";
import { ControlNoticesService, SERVICE_ACTOR_ID } from "./control-notices.service";
import { lifecycleNoticeEvent, type LifecycleAutomation } from "./control-plane.domain";
import { resolveTenantRegistry, type TenantRegistry } from "./tenant-registry";

type LifecycleContext = {
  workspaceStatus: string;
  onboardingStatus: string | null;
  ownerInvitationStatus: string | null;
  subscriptionStatus: string | null;
  latest: { id: string; state: TenantLifecycleState; version: number; graceEndsAt: Date | null } | null;
};

const AUTOMATION_REASON: Record<LifecycleAutomation["reasonCode"], string> = {
  payment_past_due: "Payment is past due. Grace started automatically.",
  grace_ended: "Grace ended without payment. Suspended automatically.",
};

function correlation(value?: string) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : randomUUID();
}

/**
 * Tenant lifecycle `draft → trial → active → grace → suspended → archived` (master plan §6.1).
 * Each change is a versioned, idempotent, audited row; suspension makes the organization read-only
 * (enforced by the write-block guard); every change tells the owners and the operators who can act.
 */
@Injectable()
export class TenantLifecycleService {
  constructor(private readonly database: DatabaseService, private readonly notices: ControlNoticesService) {}

  async overview(key: string, operatorUserId: string) {
    const registry = await resolveTenantRegistry(this.database, key);
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      const context = await this.context(client, registry.workspaceId);
      const history = await client.query<{ id: string; version: number; state: string; previousState: string;
        graceEndsAt: Date | null; reason: string; automated: boolean; createdBy: string | null;
        createdByName: string | null; createdAt: Date }>(
        `SELECT version.id, version.version, version.state, version.previous_state AS "previousState",
                version.grace_ends_at AS "graceEndsAt", version.reason, version.automated,
                version.created_by AS "createdBy", app_user.display_name AS "createdByName",
                version.created_at AS "createdAt"
           FROM tenant_lifecycle_versions version
           LEFT JOIN users app_user ON app_user.id = version.created_by
          WHERE version.workspace_id = $1 ORDER BY version.version DESC LIMIT 50`, [registry.workspaceId],
      );
      const states = await this.notices.deliveryStates(client, registry.workspaceId, history.rows.map((row) => row.id));
      const readiness = await this.readiness(client, registry.workspaceId);
      const state = context.latest?.state ?? tenantLifecycleBaseline(context);
      return {
        workspaceId: registry.workspaceId,
        externalTenantId: registry.externalTenantId,
        state,
        version: context.latest?.version ?? 0,
        workspaceStatus: context.workspaceStatus,
        graceEndsAt: context.latest?.graceEndsAt ?? null,
        nextStates: tenantLifecycleOptions(state),
        readiness: {
          onboardingStatus: context.onboardingStatus,
          ownerInvitationStatus: context.ownerInvitationStatus,
          ...readiness,
        },
        history: history.rows.map((row) => ({ ...row, noticeDeliveryState: states.get(row.id) ?? "not_required" })),
        notices: await this.notices.list(client, registry.workspaceId),
        observedAt: new Date().toISOString(),
      };
    });
  }

  async transition(key: string, input: TransitionTenantLifecycleDto, suppliedKey: string | undefined,
    operatorUserId: string, correlationId?: string) {
    let idempotencyKey: string;
    try { idempotencyKey = assertValidIdempotencyKey(suppliedKey); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    const registry = await resolveTenantRegistry(this.database, key);
    const requestHash = canonicalHash({ to: input.to, graceEndsAt: input.graceEndsAt ?? null,
      reason: input.reason.trim(), expectedVersion: input.expectedVersion });
    const outcome = await this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      const context = await this.context(client, registry.workspaceId, true);
      const replay = await client.query<{ id: string; requestHash: string; state: string; version: number }>(
        `SELECT id, request_hash AS "requestHash", state, version FROM tenant_lifecycle_versions
          WHERE workspace_id = $1 AND idempotency_key = $2`, [registry.workspaceId, idempotencyKey],
      );
      if (replay.rowCount) {
        if (replay.rows[0].requestHash !== requestHash) {
          throw new ConflictException("This lifecycle idempotency key was used for a different decision.");
        }
        const { requestHash: _hash, ...saved } = replay.rows[0];
        return { result: { ...saved, replayed: true }, direct: [] as string[] };
      }
      const previousVersion = context.latest?.version ?? 0;
      if (previousVersion !== input.expectedVersion) {
        throw new ConflictException("Lifecycle changed. Refresh before deciding again.");
      }
      const from = context.latest?.state ?? tenantLifecycleBaseline(context);
      if (input.to === "active" && (from === "draft" || from === "trial")
        && (context.onboardingStatus !== "completed" || context.ownerInvitationStatus !== "accepted")) {
        throw new ConflictException("The owner has to accept the invitation and finish onboarding before activation.");
      }
      if (input.to === "active") {
        const entitlement = await client.query<{ status: string }>(
          `SELECT status FROM effective_workspace_entitlements WHERE workspace_id = $1`, [registry.workspaceId]);
        if (entitlement.rowCount && entitlement.rows[0].status !== "active") {
          throw new ConflictException("Activate the organization's modules before activating it.");
        }
      }
      if (input.to === "archived") {
        const ready = await this.readiness(client, registry.workspaceId);
        if (!ready.retentionPolicySet || !ready.exportReady) {
          throw new ConflictException("Set a retention policy and download a current verified export before archiving.");
        }
        if (ready.legalHold) throw new ConflictException("Release the legal hold before archiving this organization.");
      }
      const saved = await this.apply(client, registry, {
        from, context, to: input.to, graceEndsAt: input.graceEndsAt ? new Date(input.graceEndsAt) : null,
        reason: input.reason.trim(), idempotencyKey, requestHash, actorUserId: operatorUserId,
        correlationId: correlation(correlationId),
      });
      return { result: { ...saved.row, replayed: false }, direct: saved.direct };
    });
    await this.notices.deliver(registry.workspaceId, outcome.direct, operatorUserId);
    return outcome.result;
  }

  /**
   * An automated change from the control-plane sweep (payment past due → grace, grace ended → suspended).
   * Idempotent per version it follows, so an overlapping run changes nothing twice.
   */
  async automate(workspaceId: string, decide: (input: { state: TenantLifecycleState; graceEndsAt: Date | null;
    client: PoolClient }) => Promise<LifecycleAutomation | null>) {
    const registry: TenantRegistry = await resolveTenantRegistry(this.database, workspaceId)
      .catch(() => ({ externalTenantId: workspaceId, workspaceId }));
    const outcome = await this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const context = await this.context(client, workspaceId, true);
      const state = context.latest?.state ?? tenantLifecycleBaseline(context);
      const plan = await decide({ state, graceEndsAt: context.latest?.graceEndsAt ?? null, client });
      if (!plan) return null;
      const version = context.latest?.version ?? 0;
      const idempotencyKey = `auto:${plan.to}:${version}`;
      const replay = await client.query(`SELECT 1 FROM tenant_lifecycle_versions WHERE workspace_id = $1 AND idempotency_key = $2`,
        [workspaceId, idempotencyKey]);
      if (replay.rowCount) return null;
      const saved = await this.apply(client, registry, {
        from: state, context, to: plan.to, graceEndsAt: plan.to === "grace" ? plan.graceEndsAt : null,
        reason: AUTOMATION_REASON[plan.reasonCode], idempotencyKey,
        requestHash: canonicalHash({ automated: plan, version }), actorUserId: null, correlationId: randomUUID(),
      });
      return saved;
    });
    if (!outcome) return null;
    await this.notices.deliver(workspaceId, outcome.direct, null);
    return outcome.row;
  }

  private async apply(client: PoolClient, registry: TenantRegistry, input: {
    from: TenantLifecycleState; context: LifecycleContext; to: TenantLifecycleState; graceEndsAt: Date | null;
    reason: string; idempotencyKey: string; requestHash: string; actorUserId: string | null; correlationId: string;
  }) {
    let plan: ReturnType<typeof planTenantLifecycleTransition>;
    try {
      plan = planTenantLifecycleTransition({ from: input.from, to: input.to, now: new Date(), graceEndsAt: input.graceEndsAt });
    } catch (error) {
      throw new ConflictException((error as Error).message);
    }
    if (input.context.workspaceStatus !== plan.workspaceStatus) {
      await client.query(`UPDATE workspaces SET status = $2::workspace_status, version = version + 1, updated_at = now(),
          archived_at = CASE WHEN $2 = 'archived' THEN now() ELSE archived_at END WHERE id = $1`,
      [registry.workspaceId, plan.workspaceStatus]);
    }
    const event = lifecycleNoticeEvent(input.from, input.to);
    const previousVersion = input.context.latest?.version ?? 0;
    const saved = await client.query<{ id: string; version: number; state: TenantLifecycleState; createdAt: Date }>(
      `INSERT INTO tenant_lifecycle_versions
         (workspace_id, version, state, previous_state, grace_ends_at, reason, notice_required,
          notice_delivery_state, idempotency_key, request_hash, correlation_id, created_by, automated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, version, state, created_at AS "createdAt"`,
      [registry.workspaceId, previousVersion + 1, input.to, input.from, input.graceEndsAt, input.reason,
        event !== null, event ? "pending" : "not_required", input.idempotencyKey, input.requestHash,
        input.correlationId, input.actorUserId, input.actorUserId === null],
    );
    if (input.to === "archived") {
      await client.query(
        `UPDATE tenant_support_sessions SET status = 'revoked', end_reason = 'tenant_archived', ended_at = now(),
           version = version + 1, updated_at = now()
         WHERE workspace_id = $1 AND status IN ('requested', 'approved', 'active')`, [registry.workspaceId]);
    }
    const before = { state: input.from, version: previousVersion, workspaceStatus: input.context.workspaceStatus };
    const after = { state: input.to, version: saved.rows[0].version, workspaceStatus: plan.workspaceStatus,
      graceEndsAt: input.graceEndsAt, reason: input.reason, automated: input.actorUserId === null };
    await client.query(
      `INSERT INTO audit_events (workspace_id, actor_user_id, source, action, entity_type, entity_id, before, after, correlation_id)
       VALUES ($1, $2, 'internal', 'tenant.lifecycle_transitioned', 'workspace', $1, $3::jsonb, $4::jsonb, $5)`,
      [registry.workspaceId, input.actorUserId, JSON.stringify(before), JSON.stringify(after), input.correlationId]);
    await client.query(
      `INSERT INTO platform_operator_audit (actor_user_id, action, target_type, target_id, correlation_id, details)
       VALUES ($1, $2, 'tenant', $3, $4, $5::jsonb)`,
      [input.actorUserId, input.actorUserId ? "tenant.lifecycle_transitioned" : "tenant.lifecycle_automated",
        registry.externalTenantId, input.correlationId, JSON.stringify({ workspaceId: registry.workspaceId, before, after })]);
    const direct = event ? await this.notices.queue(client, {
      workspaceId: registry.workspaceId, event, sourceType: "lifecycle_version", sourceId: saved.rows[0].id,
      actorUserId: input.actorUserId, date: input.graceEndsAt ?? await this.trialEnd(client, registry.workspaceId, input.to),
    }) : [];
    return {
      row: { ...saved.rows[0], previousState: input.from, workspaceStatus: plan.workspaceStatus,
        noticeDeliveryState: event ? "pending" : "not_required" },
      direct,
    };
  }

  private async trialEnd(client: PoolClient, workspaceId: string, to: TenantLifecycleState) {
    if (to !== "trial") return null;
    const found = await client.query<{ trialEndsAt: Date | null }>(
      `SELECT contract.trial_ends_at AS "trialEndsAt" FROM customer_account_organizations linked
         JOIN customer_account_contracts contract ON contract.account_id = linked.account_id
        WHERE linked.workspace_id = $1`, [workspaceId]);
    return found.rows[0]?.trialEndsAt ?? null;
  }

  private async readiness(client: PoolClient, workspaceId: string) {
    // One client runs one query at a time; these stay sequential.
    const policy = await client.query<{ legalHold: boolean }>(`SELECT legal_hold AS "legalHold" FROM workspace_data_policies WHERE workspace_id = $1`, [workspaceId]);
    const exported = await client.query<{ id: string; expiresAt: Date }>(
        `SELECT id, expires_at AS "expiresAt" FROM tenant_data_exports WHERE workspace_id = $1 AND status = 'verified'
            AND downloaded_at IS NOT NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`, [workspaceId]);
    const entitlement = await client.query<{ status: string }>(`SELECT status FROM effective_workspace_entitlements WHERE workspace_id = $1`, [workspaceId]);
    return {
      retentionPolicySet: Boolean(policy.rowCount),
      legalHold: policy.rows[0]?.legalHold ?? false,
      exportReady: Boolean(exported.rowCount),
      exportExpiresAt: exported.rows[0]?.expiresAt ?? null,
      entitlementStatus: entitlement.rows[0]?.status ?? "not_configured",
    };
  }

  private async context(client: PoolClient, workspaceId: string, lock = false): Promise<LifecycleContext> {
    const workspace = await client.query<{ status: string }>(
      `SELECT status::text FROM workspaces WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [workspaceId]);
    if (!workspace.rowCount) throw new NotFoundException("Organization was not found");
    const onboarding = await client.query<{ status: string }>(`SELECT status::text FROM workspace_onboarding WHERE workspace_id = $1`, [workspaceId]);
    const invitation = await client.query<{ status: string }>(
      `SELECT status::text FROM workspace_invitations WHERE workspace_id = $1 ORDER BY created_at LIMIT 1`, [workspaceId]);
    const subscription = await client.query<{ status: string }>(`SELECT status FROM workspace_subscriptions WHERE workspace_id = $1`, [workspaceId]);
    const latest = await client.query<LifecycleContext["latest"] & object>(
      `SELECT id, state, version, grace_ends_at AS "graceEndsAt" FROM tenant_lifecycle_versions
        WHERE workspace_id = $1 ORDER BY version DESC LIMIT 1`, [workspaceId]);
    return {
      workspaceStatus: workspace.rows[0].status,
      onboardingStatus: onboarding.rows[0]?.status ?? null,
      ownerInvitationStatus: invitation.rows[0]?.status ?? null,
      subscriptionStatus: subscription.rows[0]?.status ?? null,
      latest: latest.rows[0] ?? null,
    };
  }
}
