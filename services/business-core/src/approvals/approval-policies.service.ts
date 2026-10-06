import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import {
  activePolicyVersions, approvalStatus, approvalStatusById, ensureDefaultPolicy, insertPolicyVersion, policyVersion, ruleError, trim,
} from "./approval-engine";
import { APPROVAL_SUBJECT_KINDS, isSubjectKind, validatePolicyInput, type ApprovalSubjectKind, type PolicyVersion } from "./approval-policy";

const MANAGE = "workspace.settings.manage";
/** The kinds a firm sees in Settings → Approvals: the ones a module requests today. */
export const CONFIGURABLE_KINDS: ApprovalSubjectKind[] = ["deal_file", "opportunity_value", "quote_qs", "refund", "payable_request"];

type PolicyRow = { id: string; kind: string; name: string; status: "active" | "archived"; currentVersion: number; version: number; isDefault: boolean; updatedAt: Date };

export type PolicyView = {
  id: string; kind: string; name: string; status: "active" | "archived"; isDefault: boolean; version: number; currentVersion: number; updatedAt: string;
  currency: string | null; minAmount: string | null; ownerAboveAmount: string | null; escalateAfterHours: number | null; waiverAllowed: boolean;
  resetTolerancePercent: string; steps: Array<PolicyVersion["steps"][number] & { personName: string | null }>; pending: number;
};

/**
 * Settings → Approvals (E3): the policies per kind, and who covers for whom while away. A policy edit is a new
 * version (requests already waiting keep theirs, E3-4); every change is version-checked and audited.
 */
@Injectable()
export class ApprovalPoliciesService {
  constructor(private readonly access: WorkspaceAccessService) {}

  list(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, (client, user) => this.snapshot(client, workspaceId, user.userId));
  }

  private async snapshot(client: PoolClient, workspaceId: string, userId: string) {
    {
      for (const kind of CONFIGURABLE_KINDS) await ensureDefaultPolicy(client, workspaceId, kind);
      const policies = (await client.query<PolicyRow>(
        `SELECT id, subject_kind AS kind, name, status, current_version AS "currentVersion", version, is_default AS "isDefault", updated_at AS "updatedAt"
           FROM approval_policies WHERE workspace_id = $1 ORDER BY subject_kind, is_default DESC, created_at`, [workspaceId])).rows;
      const views: PolicyView[] = [];
      for (const policy of policies) views.push(await this.view(client, workspaceId, policy));
      return {
        kinds: CONFIGURABLE_KINDS, policies: views,
        canManage: await this.access.hasPermission(client, workspaceId, userId, MANAGE),
        people: (await client.query<{ userId: string; name: string }>(
          `SELECT membership.user_id AS "userId", coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name
             FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id AND account.status = 'active'
            WHERE membership.workspace_id = $1 AND membership.status = 'active' ORDER BY lower(coalesce(nullif(btrim(account.display_name), ''), account.primary_email)) LIMIT 500`,
          [workspaceId])).rows,
        roles: (await client.query<{ code: string; name: string }>(`SELECT code, name FROM roles WHERE workspace_id = $1 ORDER BY name`, [workspaceId])).rows,
      };
    }
  }

  private async view(client: PoolClient, workspaceId: string, policy: PolicyRow): Promise<PolicyView> {
    const current = (await client.query<{ id: string }>(
      `SELECT id FROM approval_policy_versions WHERE workspace_id = $1 AND policy_id = $2 AND version_number = $3`, [workspaceId, policy.id, policy.currentVersion])).rows[0];
    const version = await policyVersion(client, workspaceId, current.id);
    const people = new Map((await client.query<{ id: string; name: string }>(
      `SELECT id, coalesce(nullif(btrim(display_name), ''), primary_email) AS name FROM users WHERE id = ANY($1::uuid[])`,
      [version.steps.map((step) => step.userId).filter(Boolean)])).rows.map((row) => [row.id, row.name]));
    const pending = (await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM approval_requests request JOIN approval_policy_versions version ON version.workspace_id = request.workspace_id AND version.id = request.policy_version_id
        WHERE request.workspace_id = $1 AND version.policy_id = $2 AND request.status = 'pending'`, [workspaceId, policy.id])).rows[0]?.count ?? 0;
    return {
      id: policy.id, kind: policy.kind, name: policy.name, status: policy.status, isDefault: policy.isDefault, version: policy.version, currentVersion: policy.currentVersion,
      updatedAt: policy.updatedAt.toISOString(), currency: version.currency, minAmount: version.minAmount, ownerAboveAmount: version.ownerAboveAmount,
      escalateAfterHours: version.escalateAfterHours, waiverAllowed: version.waiverAllowed, resetTolerancePercent: version.resetTolerancePercent,
      steps: version.steps.map((step) => ({ ...step, personName: step.userId ? people.get(step.userId) ?? null : null })), pending,
    };
  }

  /** A new policy for a kind (for example "Deal File above 500,000 with the Owner"). */
  create(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    const kind = body.kind;
    if (!isSubjectKind(kind)) throw new UnprocessableEntityException("Choose what the policy approves");
    const input = this.validate(kind, body);
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      await this.checkPeople(client, workspaceId, input.steps);
      await this.checkOverlap(client, workspaceId, kind, null, input);
      const policy = (await client.query<{ id: string }>(
        `INSERT INTO approval_policies (workspace_id, subject_kind, name, created_by, updated_by) VALUES ($1, $2, $3, $4, $4) RETURNING id`,
        [workspaceId, kind, input.name, user.userId])).rows[0];
      await insertPolicyVersion(client, { workspaceId, policyId: policy.id, version: 1, ...input, actorUserId: user.userId });
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "approvals.policy_created.v1", entityType: "approval_policy", entityId: policy.id, after: { kind, ...input } });
      return this.snapshot(client, workspaceId, user.userId);
    });
  }

  /** Saves an edit as the next version; requests already waiting keep the version they started under. */
  update(actor: RequestActor, workspaceId: string, policyId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const policy = await this.lock(client, workspaceId, policyId);
      if (!isSubjectKind(policy.kind)) throw new UnprocessableEntityException("Unknown approval kind");
      if (Number(body.version) !== policy.version) throw new ConflictException("Someone changed this policy. Reload to see it.");
      const input = this.validate(policy.kind, body);
      await this.checkPeople(client, workspaceId, input.steps);
      await this.checkOverlap(client, workspaceId, policy.kind, policyId, input);
      const before = await this.view(client, workspaceId, policy);
      const next = policy.currentVersion + 1;
      await insertPolicyVersion(client, { workspaceId, policyId, version: next, ...input, actorUserId: user.userId });
      await client.query(`UPDATE approval_policies SET name = $3, current_version = $4, version = version + 1, updated_by = $5 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, policyId, input.name, next, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "approvals.policy_changed.v1", entityType: "approval_policy", entityId: policyId,
        before, after: { version: next, ...input } });
      return this.snapshot(client, workspaceId, user.userId);
    });
  }

  /** Archives or restores a policy. The last active policy of a kind can't be archived: something must approve it. */
  setStatus(actor: RequestActor, workspaceId: string, policyId: string, body: Record<string, unknown>) {
    const status = body.status === "archived" ? "archived" : body.status === "active" ? "active" : null;
    if (!status) throw new UnprocessableEntityException("Archive or restore");
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const policy = await this.lock(client, workspaceId, policyId);
      if (Number(body.version) !== policy.version) throw new ConflictException("Someone changed this policy. Reload to see it.");
      if (policy.status === status) return this.snapshot(client, workspaceId, user.userId);
      if (status === "archived") {
        const others = (await client.query(`SELECT 1 FROM approval_policies WHERE workspace_id = $1 AND subject_kind = $2 AND status = 'active' AND id <> $3 AND is_default`,
          [workspaceId, policy.kind, policyId])).rowCount;
        if (policy.isDefault || !others) throw new ConflictException("Keep the main policy: it approves everything the others don't cover.");
      }
      await client.query(`UPDATE approval_policies SET status = $3, version = version + 1, updated_by = $4 WHERE workspace_id = $1 AND id = $2`, [workspaceId, policyId, status, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "approvals.policy_status.v1", entityType: "approval_policy", entityId: policyId,
        before: { status: policy.status }, after: { status } });
      return this.snapshot(client, workspaceId, user.userId);
    });
  }

  private validate(kind: ApprovalSubjectKind, body: Record<string, unknown>) {
    try { return validatePolicyInput(kind, body); } catch (error) { return ruleError(error); }
  }

  private async lock(client: PoolClient, workspaceId: string, policyId: string) {
    const policy = (await client.query<PolicyRow>(
      `SELECT id, subject_kind AS kind, name, status, current_version AS "currentVersion", version, is_default AS "isDefault", updated_at AS "updatedAt"
         FROM approval_policies WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, policyId])).rows[0];
    if (!policy) throw new NotFoundException("Approval policy not found");
    return policy;
  }

  private async checkPeople(client: PoolClient, workspaceId: string, steps: Array<{ userId?: string | null; roleCode?: string | null }>) {
    for (const step of steps) {
      if (step.userId && !(await client.query(`SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, step.userId])).rowCount)
        throw new UnprocessableEntityException("Choose someone in your team");
      if (step.roleCode && !(await client.query(`SELECT 1 FROM roles WHERE workspace_id = $1 AND code = $2`, [workspaceId, step.roleCode])).rowCount)
        throw new UnprocessableEntityException("Choose one of your roles");
    }
  }

  /** Two active policies may not claim the same amounts in the same currency: one would never apply. */
  private async checkOverlap(client: PoolClient, workspaceId: string, kind: string, policyId: string | null, input: { currency: string | null; minAmount: string | null }) {
    const clash = (await activePolicyVersions(client, workspaceId, kind)).find((version) =>
      version.policyId !== policyId && version.currency === input.currency && trim(version.minAmount) === trim(input.minAmount));
    if (clash) throw new ConflictException(`"${clash.name}" already covers these amounts. Change its amount or this one's.`);
  }

  // ------------------------------------------------------------ away cover

  delegations(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, (client, user) => this.cover(client, workspaceId, user.userId));
  }

  private async cover(client: PoolClient, workspaceId: string, userId: string) {
    return {
      canManage: await this.access.hasPermission(client, workspaceId, userId, MANAGE),
      viewerId: userId,
      delegations: (await client.query(
        `SELECT delegation.id, delegation.user_id AS "userId", coalesce(nullif(btrim(away.display_name), ''), away.primary_email) AS "userName",
                delegation.delegate_user_id AS "delegateUserId", coalesce(nullif(btrim(cover.display_name), ''), cover.primary_email) AS "delegateName",
                delegation.starts_at AS "startsAt", delegation.ends_at AS "endsAt", delegation.note, delegation.version,
                (delegation.starts_at <= now() AND delegation.ends_at > now()) AS active
           FROM approval_delegations delegation
           JOIN users away ON away.id = delegation.user_id JOIN users cover ON cover.id = delegation.delegate_user_id
          WHERE delegation.workspace_id = $1 AND delegation.cancelled_at IS NULL AND delegation.ends_at > now()
          ORDER BY delegation.starts_at LIMIT 200`, [workspaceId])).rows,
    };
  }

  /** Someone covers approvals for a person who is away. People set their own; an administrator sets anyone's. */
  delegate(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const userId = typeof body.userId === "string" && body.userId ? body.userId : user.userId;
      const delegateUserId = typeof body.delegateUserId === "string" ? body.delegateUserId : "";
      if (userId !== user.userId && !(await this.access.hasPermission(client, workspaceId, user.userId, MANAGE)))
        throw new UnprocessableEntityException("You can set cover for yourself only");
      if (!delegateUserId || delegateUserId === userId) throw new UnprocessableEntityException("Choose who covers");
      for (const id of [userId, delegateUserId])
        if (!(await client.query(`SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, id])).rowCount)
          throw new UnprocessableEntityException("Choose someone in your team");
      const startsAt = typeof body.startsAt === "string" && !Number.isNaN(Date.parse(body.startsAt)) ? new Date(body.startsAt) : new Date();
      const endsAt = typeof body.endsAt === "string" && !Number.isNaN(Date.parse(body.endsAt)) ? new Date(body.endsAt) : null;
      if (!endsAt || endsAt <= startsAt) throw new UnprocessableEntityException("Choose when the cover ends");
      if (endsAt.getTime() - startsAt.getTime() > 180 * 86_400_000) throw new UnprocessableEntityException("Cover lasts up to 180 days");
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
      const row = (await client.query<{ id: string }>(
        `INSERT INTO approval_delegations (workspace_id, user_id, delegate_user_id, starts_at, ends_at, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [workspaceId, userId, delegateUserId, startsAt, endsAt, note, user.userId])).rows[0];
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "approvals.delegated.v1", entityType: "approval_delegation", entityId: row.id,
        after: { userId, delegateUserId, startsAt, endsAt, note } });
      return this.cover(client, workspaceId, user.userId);
    });
  }

  cancelDelegation(actor: RequestActor, workspaceId: string, delegationId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const row = (await client.query<{ userId: string; createdBy: string; version: number }>(
        `SELECT user_id AS "userId", created_by AS "createdBy", version FROM approval_delegations WHERE workspace_id = $1 AND id = $2 AND cancelled_at IS NULL FOR UPDATE`,
        [workspaceId, delegationId])).rows[0];
      if (!row) return this.cover(client, workspaceId, user.userId);
      if (Number(body.version) !== row.version) throw new ConflictException("This cover changed. Reload to see it.");
      if (![row.userId, row.createdBy].includes(user.userId) && !(await this.access.hasPermission(client, workspaceId, user.userId, MANAGE)))
        throw new UnprocessableEntityException("Only the person away or an administrator ends this cover");
      await client.query(`UPDATE approval_delegations SET cancelled_at = now(), cancelled_by = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, delegationId, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "approvals.delegation_ended.v1", entityType: "approval_delegation", entityId: delegationId });
      return this.cover(client, workspaceId, user.userId);
    });
  }

  /** One subject's approval, for a module screen that shows its steps. */
  status(actor: RequestActor, workspaceId: string, kind: string, subjectId: string) {
    if (!APPROVAL_SUBJECT_KINDS.includes(kind as ApprovalSubjectKind)) throw new UnprocessableEntityException("Unknown approval kind");
    return this.access.asMember(actor, workspaceId, (client) => approvalStatus(client, workspaceId, kind, subjectId));
  }

  request(actor: RequestActor, workspaceId: string, requestId: string) {
    return this.access.asMember(actor, workspaceId, async (client) => {
      const status = await approvalStatusById(client, workspaceId, requestId);
      if (!status) throw new NotFoundException("Approval not found");
      return status;
    });
  }
}
