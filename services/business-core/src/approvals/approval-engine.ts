import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import {
  amountChangeResets, amountText, ApprovalRuleError, currencyText, DEFAULT_APPROVAL_POLICIES, effectiveSteps, eligibility, escalationStep,
  isEscalated, isExpired, isSubjectKind, needsOwner, nextState, selectPolicy,
  type ApprovalDecision, type ApprovalRequestStatus, type ApprovalStatus, type ApprovalStepView, type ApprovalSubjectKind, type DecisionVia,
  type Eligibility, type Person, type PolicyStep, type PolicyStepInput, type PolicyVersion, type RequestFacts,
} from "./approval-policy";

type Db = Pick<PoolClient, "query">;

/** Errors from the pure rules surface as HTTP errors the screens show as they are. */
export function ruleError(error: unknown): never {
  if (error instanceof ApprovalRuleError)
    throw error.code === "forbidden" ? new ForbiddenException(error.message) : error.code === "conflict" ? new ConflictException(error.message) : new UnprocessableEntityException(error.message);
  throw error;
}
const guarded = <T>(work: () => T): T => { try { return work(); } catch (error) { return ruleError(error); } };

// ---------------------------------------------------------------- policies

type VersionRow = {
  id: string; policyId: string; version: number; name: string; kind: string; currency: string | null; minAmount: string | null; ownerAboveAmount: string | null;
  escalateAfterHours: number | null; waiverAllowed: boolean; resetTolerancePercent: string;
};
const VERSION_SELECT = `version.id, version.policy_id AS "policyId", version.version_number AS version, version.name, policy.subject_kind AS kind,
  version.currency_code AS currency, version.min_amount::text AS "minAmount", version.owner_above_amount::text AS "ownerAboveAmount",
  version.escalate_after_hours AS "escalateAfterHours", version.waiver_allowed AS "waiverAllowed", version.reset_tolerance_percent::text AS "resetTolerancePercent"`;

async function withSteps(db: Db, workspaceId: string, rows: VersionRow[]): Promise<PolicyVersion[]> {
  if (!rows.length) return [];
  const steps = (await db.query<PolicyStep & { versionId: string }>(
    `SELECT policy_version_id AS "versionId", position, approver_kind AS "approverKind", permission_code AS "permissionCode", role_code AS "roleCode",
            user_id AS "userId", label
       FROM approval_policy_steps WHERE workspace_id = $1 AND policy_version_id = ANY($2::uuid[]) ORDER BY position`,
    [workspaceId, rows.map((row) => row.id)])).rows;
  return rows.map((row) => ({
    ...row, minAmount: trim(row.minAmount), ownerAboveAmount: trim(row.ownerAboveAmount), resetTolerancePercent: trim(row.resetTolerancePercent) ?? "0",
    steps: steps.filter((step) => step.versionId === row.id).map(({ versionId: _versionId, ...step }) => step),
  }));
}

/** A numeric as people write it: no trailing zeros. */
export function trim(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

export async function policyVersion(db: Db, workspaceId: string, versionId: string): Promise<PolicyVersion> {
  const rows = (await db.query<VersionRow>(
    `SELECT ${VERSION_SELECT} FROM approval_policy_versions version JOIN approval_policies policy ON policy.workspace_id = version.workspace_id AND policy.id = version.policy_id
      WHERE version.workspace_id = $1 AND version.id = $2`, [workspaceId, versionId])).rows;
  const [version] = await withSteps(db, workspaceId, rows);
  if (!version) throw new NotFoundException("Approval policy not found");
  return version;
}

/** The current version of every active policy of a kind. */
export async function activePolicyVersions(db: Db, workspaceId: string, kind: string): Promise<PolicyVersion[]> {
  const rows = (await db.query<VersionRow>(
    `SELECT ${VERSION_SELECT} FROM approval_policies policy
       JOIN approval_policy_versions version ON version.workspace_id = policy.workspace_id AND version.policy_id = policy.id AND version.version_number = policy.current_version
      WHERE policy.workspace_id = $1 AND policy.subject_kind = $2 AND policy.status = 'active'`, [workspaceId, kind])).rows;
  return withSteps(db, workspaceId, rows);
}

/** Writes one immutable version of a policy (its steps in order). */
export async function insertPolicyVersion(db: Db, input: {
  workspaceId: string; policyId: string; version: number; name: string; currency: string | null; minAmount: string | null; ownerAboveAmount: string | null;
  escalateAfterHours: number | null; waiverAllowed: boolean; resetTolerancePercent: string; steps: PolicyStepInput[]; actorUserId: string | null;
}) {
  const version = (await db.query<{ id: string }>(
    `INSERT INTO approval_policy_versions (workspace_id, policy_id, version_number, name, currency_code, min_amount, owner_above_amount, escalate_after_hours,
       waiver_allowed, reset_tolerance_percent, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8, $9, $10::numeric, $11) RETURNING id`,
    [input.workspaceId, input.policyId, input.version, input.name, input.currency, input.minAmount, input.ownerAboveAmount, input.escalateAfterHours,
      input.waiverAllowed, input.resetTolerancePercent, input.actorUserId])).rows[0];
  for (const [index, step] of input.steps.entries()) {
    await db.query(
      `INSERT INTO approval_policy_steps (workspace_id, policy_version_id, position, approver_kind, permission_code, role_code, user_id, label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.workspaceId, version.id, index + 1, step.approverKind, step.permissionCode ?? null, step.roleCode ?? null, step.userId ?? null, step.label ?? ""]);
  }
  return version.id;
}

/**
 * The product default policy for a kind, created the first time the kind is used in a workspace (idempotent and safe
 * under concurrency: one default per kind). A kind a firm already configured is left alone.
 */
export async function ensureDefaultPolicy(db: Db, workspaceId: string, kind: ApprovalSubjectKind) {
  const existing = (await db.query(`SELECT 1 FROM approval_policies WHERE workspace_id = $1 AND subject_kind = $2 LIMIT 1`, [workspaceId, kind])).rowCount;
  if (existing) return;
  const preset = DEFAULT_APPROVAL_POLICIES[kind];
  const policy = (await db.query<{ id: string }>(
    `INSERT INTO approval_policies (workspace_id, subject_kind, name, is_default) VALUES ($1, $2, $3, true)
     ON CONFLICT (workspace_id, subject_kind) WHERE is_default DO NOTHING RETURNING id`, [workspaceId, kind, preset.name])).rows[0];
  if (!policy) return;
  await insertPolicyVersion(db, { workspaceId, policyId: policy.id, version: 1, name: preset.name, currency: null, minAmount: null, ownerAboveAmount: null,
    escalateAfterHours: null, waiverAllowed: false, resetTolerancePercent: "0", steps: preset.steps, actorUserId: null });
  await recordAudit(db, { workspaceId, actorUserId: null, source: "internal", action: "approvals.policy_seeded.v1", entityType: "approval_policy", entityId: policy.id,
    after: { kind, name: preset.name, steps: preset.steps } });
}

// ---------------------------------------------------------------- people

/** A person's permissions and roles in the workspace (active membership only). */
export async function personFacts(db: Db, workspaceId: string, userId: string): Promise<Person> {
  const row = (await db.query<{ permissions: string[]; roles: string[] }>(
    `SELECT coalesce(array_agg(DISTINCT permission.code) FILTER (WHERE permission.code IS NOT NULL), '{}') AS permissions,
            coalesce(array_agg(DISTINCT role.code) FILTER (WHERE role.code IS NOT NULL), '{}') AS roles
       FROM workspace_memberships membership
       LEFT JOIN effective_member_roles assigned ON assigned.membership_id = membership.id AND assigned.workspace_id = membership.workspace_id
       LEFT JOIN roles role ON role.id = assigned.role_id
       LEFT JOIN role_permissions granted ON granted.role_id = assigned.role_id
       LEFT JOIN permissions permission ON permission.id = granted.permission_id
      WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active'`, [workspaceId, userId])).rows[0];
  return { userId, permissions: new Set(row?.permissions ?? []), roles: new Set(row?.roles ?? []) };
}

/** The people who asked this person to cover for them now (an active delegation to them). */
export async function delegatorsOf(db: Db, workspaceId: string, userId: string, now = new Date()): Promise<Person[]> {
  const ids = (await db.query<{ userId: string }>(
    `SELECT DISTINCT user_id AS "userId" FROM approval_delegations
      WHERE workspace_id = $1 AND delegate_user_id = $2 AND cancelled_at IS NULL AND starts_at <= $3 AND ends_at > $3`,
    [workspaceId, userId, now])).rows.map((row) => row.userId);
  return Promise.all(ids.map((id) => personFacts(db, workspaceId, id)));
}

/** Active people who satisfy a step (a permission, a role or the named person), with their active delegates. */
export async function stepApprovers(db: Db, workspaceId: string, step: Pick<PolicyStep, "approverKind" | "permissionCode" | "roleCode" | "userId">, now = new Date(), limit = 50) {
  const direct = (await db.query<{ userId: string; name: string }>(
    `SELECT DISTINCT membership.user_id AS "userId", coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name
       FROM workspace_memberships membership
       JOIN users account ON account.id = membership.user_id AND account.status = 'active'
       LEFT JOIN effective_member_roles assigned ON assigned.membership_id = membership.id AND assigned.workspace_id = membership.workspace_id
       LEFT JOIN roles role ON role.id = assigned.role_id
       LEFT JOIN role_permissions granted ON granted.role_id = assigned.role_id
       LEFT JOIN permissions permission ON permission.id = granted.permission_id
      WHERE membership.workspace_id = $1 AND membership.status = 'active'
        AND (($2 = 'permission' AND permission.code = $3) OR ($2 = 'role' AND role.code = $4) OR ($2 = 'person' AND membership.user_id = $5::uuid))
      LIMIT $6`,
    [workspaceId, step.approverKind, step.permissionCode, step.roleCode, step.userId, limit])).rows;
  const delegates = direct.length ? (await db.query<{ userId: string; name: string; forUserId: string }>(
    `SELECT delegation.delegate_user_id AS "userId", coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name, delegation.user_id AS "forUserId"
       FROM approval_delegations delegation JOIN users account ON account.id = delegation.delegate_user_id AND account.status = 'active'
      WHERE delegation.workspace_id = $1 AND delegation.user_id = ANY($2::uuid[]) AND delegation.cancelled_at IS NULL
        AND delegation.starts_at <= $3 AND delegation.ends_at > $3`,
    [workspaceId, direct.map((person) => person.userId), now])).rows : [];
  return { direct, delegates };
}

// ---------------------------------------------------------------- requests

type RequestRow = {
  id: string; kind: string; subjectId: string; title: string; href: string | null; amount: string | null; currency: string | null; previousAmount: string | null;
  policyVersionId: string; ownerStep: boolean; status: ApprovalRequestStatus; currentStep: number; stepSince: Date; expiresAt: Date | null;
  requestedBy: string; requesterName: string | null; requestedAt: Date; version: number;
};
const REQUEST_SELECT = `request.id, request.subject_kind AS kind, request.subject_id AS "subjectId", request.title, request.href,
  request.amount::text AS amount, request.currency_code AS currency, request.previous_amount::text AS "previousAmount",
  request.policy_version_id AS "policyVersionId", request.owner_step AS "ownerStep", request.status, request.current_step AS "currentStep",
  request.step_since AS "stepSince", request.expires_at AS "expiresAt", request.requested_by AS "requestedBy",
  coalesce(nullif(btrim(requester.display_name), ''), requester.primary_email) AS "requesterName", request.requested_at AS "requestedAt", request.version`;
const REQUEST_FROM = `approval_requests request LEFT JOIN users requester ON requester.id = request.requested_by`;

type DecisionRow = {
  stepPosition: number; decision: string; decidedBy: string | null; decidedByName: string | null; onBehalfOf: string | null; onBehalfOfName: string | null;
  via: DecisionVia; note: string | null; decidedAt: Date; commandId: string | null;
};

async function decisionsOf(db: Db, workspaceId: string, requestId: string): Promise<DecisionRow[]> {
  return (await db.query<DecisionRow>(
    `SELECT decision.step_position AS "stepPosition", decision.decision, decision.decided_by AS "decidedBy",
            coalesce(nullif(btrim(decider.display_name), ''), decider.primary_email) AS "decidedByName", decision.on_behalf_of AS "onBehalfOf",
            coalesce(nullif(btrim(principal.display_name), ''), principal.primary_email) AS "onBehalfOfName", decision.via, decision.note,
            decision.decided_at AS "decidedAt", decision.command_id AS "commandId"
       FROM approval_decisions decision
       LEFT JOIN users decider ON decider.id = decision.decided_by
       LEFT JOIN users principal ON principal.id = decision.on_behalf_of
      WHERE decision.workspace_id = $1 AND decision.request_id = $2 ORDER BY decision.decided_at, decision.id`, [workspaceId, requestId])).rows;
}

async function requestRow(db: Db, workspaceId: string, where: { id?: string; kind?: string; subjectId?: string; pendingOnly?: boolean }, lock = false) {
  const conditions = ["request.workspace_id = $1"];
  const values: unknown[] = [workspaceId];
  if (where.id) { values.push(where.id); conditions.push(`request.id = $${values.length}`); }
  if (where.kind) { values.push(where.kind); conditions.push(`request.subject_kind = $${values.length}`); }
  if (where.subjectId) { values.push(where.subjectId); conditions.push(`request.subject_id = $${values.length}`); }
  if (where.pendingOnly) conditions.push(`request.status = 'pending'`);
  return (await db.query<RequestRow>(
    `SELECT ${REQUEST_SELECT} FROM ${REQUEST_FROM} WHERE ${conditions.join(" AND ")}
      ORDER BY (request.status = 'pending') DESC, request.requested_at DESC, request.id DESC LIMIT 1 ${lock ? "FOR UPDATE OF request" : ""}`, values)).rows[0] ?? null;
}

function facts(row: RequestRow, version: PolicyVersion, decisions: DecisionRow[]): RequestFacts {
  return {
    status: row.status, requesterUserId: row.requestedBy, currentStep: row.currentStep, stepSince: row.stepSince, expiresAt: row.expiresAt,
    steps: effectiveSteps(version, row.ownerStep), escalateAfterHours: version.escalateAfterHours, waiverAllowed: version.waiverAllowed,
    earlier: decisions.filter((decision) => decision.decision === "approve" && decision.stepPosition < row.currentStep)
      .map((decision) => ({ decidedBy: decision.decidedBy, onBehalfOf: decision.onBehalfOf })),
  };
}

async function statusOf(db: Db, workspaceId: string, row: RequestRow, now = new Date()): Promise<ApprovalStatus> {
  const version = await policyVersion(db, workspaceId, row.policyVersionId);
  const decisions = await decisionsOf(db, workspaceId, row.id);
  const requestFacts = facts(row, version, decisions);
  const steps: ApprovalStepView[] = requestFacts.steps.map((step) => {
    const decided = [...decisions].reverse().find((decision) => decision.stepPosition === step.position && ["approve", "return", "reject"].includes(decision.decision));
    const state: ApprovalStepView["state"] = decided?.decision === "approve" && (step.position < row.currentStep || row.status === "approved") ? "done"
      : decided && decided.decision !== "approve" && step.position === row.currentStep ? (decided.decision === "return" ? "returned" : "rejected")
      : row.status === "pending" && step.position === row.currentStep ? "current" : "upcoming";
    return {
      position: step.position, label: step.label, approverKind: step.approverKind, state,
      decidedBy: state === "upcoming" || state === "current" ? null : decided?.decidedByName ?? null,
      onBehalfOf: state === "upcoming" || state === "current" ? null : decided?.onBehalfOfName ?? null,
      via: state === "upcoming" || state === "current" ? null : decided?.via ?? null,
      decidedAt: state === "upcoming" || state === "current" ? null : decided?.decidedAt.toISOString() ?? null,
      note: state === "upcoming" || state === "current" ? null : decided?.note ?? null,
    };
  });
  let waitingFor: string[] = [];
  if (row.status === "pending") {
    const blocked = new Set([row.requestedBy, ...requestFacts.earlier.flatMap((decision) => [decision.decidedBy, decision.onBehalfOf])]);
    const escalated = isEscalated(requestFacts, now);
    const current = requestFacts.steps[row.currentStep - 1];
    const people = [...(current ? (await stepApprovers(db, workspaceId, current, now)).direct : []),
      ...(escalated ? (await stepApprovers(db, workspaceId, escalationStep(requestFacts), now)).direct : [])];
    waitingFor = [...new Set(people.filter((person) => !blocked.has(person.userId)).map((person) => person.name))].slice(0, 3);
  }
  return {
    id: row.id, kind: row.kind, subjectId: row.subjectId, title: row.title, href: row.href, status: row.status,
    amount: trim(row.amount), currency: row.currency, previousAmount: trim(row.previousAmount),
    policy: { id: version.policyId, versionId: version.id, version: version.version, name: version.name },
    requestedBy: { userId: row.requestedBy, name: row.requesterName ?? "" }, requestedAt: row.requestedAt.toISOString(),
    currentStep: row.currentStep, stepSince: row.stepSince.toISOString(), escalated: row.status === "pending" && isEscalated(requestFacts, now),
    expiresAt: row.expiresAt?.toISOString() ?? null, steps, waitingFor, version: row.version,
  };
}

/** The latest request for a subject (the open one first), or null when it was never requested. */
export async function approvalStatus(db: Db, workspaceId: string, kind: string, subjectId: string, now = new Date()): Promise<ApprovalStatus | null> {
  const row = await requestRow(db, workspaceId, { kind, subjectId });
  return row ? statusOf(db, workspaceId, row, now) : null;
}

export async function approvalStatusById(db: Db, workspaceId: string, requestId: string, now = new Date()): Promise<ApprovalStatus | null> {
  const row = await requestRow(db, workspaceId, { id: requestId });
  return row ? statusOf(db, workspaceId, row, now) : null;
}

/** Whether this person may decide the request's current step now, and how (for screens and the inbox). */
export async function canDecideApproval(db: Db, workspaceId: string, requestId: string, userId: string, now = new Date()): Promise<Eligibility> {
  const row = await requestRow(db, workspaceId, { id: requestId });
  if (!row) return { canDecide: false, via: null, onBehalfOf: null, reason: "decided" };
  const version = await policyVersion(db, workspaceId, row.policyVersionId);
  return eligibility(facts(row, version, await decisionsOf(db, workspaceId, row.id)), await personFacts(db, workspaceId, userId), await delegatorsOf(db, workspaceId, userId, now), now);
}

export type RequestApprovalInput = {
  workspaceId: string;
  kind: ApprovalSubjectKind;
  subjectId: string;
  title: string;
  href?: string | null;
  /** Decimal text in the document currency (numeric(20,4)); null for a request without an amount. */
  amount: string | number | null;
  currency: string | null;
  requesterUserId: string;
  /** The approval can't be granted after this (a quote's validity, E3-5). */
  expiresAt?: string | Date | null;
  /** Tell the current step's approvers (in the app and by email). Off for a module that sends its own notices. */
  notify?: boolean;
  /**
   * Steps already decided before the engine existed (a request in flight at upgrade): recorded as `legacy` decisions,
   * in order, by the people who made them.
   */
  priorApprovals?: Array<{ deciderUserId: string; decidedAt?: string | null }>;
};

function checkSubject(input: { kind: string; subjectId: string }) {
  if (!isSubjectKind(input.kind)) throw new UnprocessableEntityException("Unknown approval kind");
  if (!/^[0-9a-f-]{36}$/i.test(input.subjectId)) throw new UnprocessableEntityException("Choose what is being approved");
}

/**
 * Opens a request for a subject under the policy that covers its amount, at the first step. Idempotent: an open
 * request for the same subject and amount is returned as it is; a different amount goes through the reset rule.
 */
export async function requestApproval(db: Db, input: RequestApprovalInput, now = new Date()): Promise<ApprovalStatus> {
  checkSubject(input);
  const amount = guarded(() => amountText(input.amount));
  const currency = guarded(() => currencyText(input.currency));
  if ((amount === null) !== (currency === null)) throw new UnprocessableEntityException("An amount needs its currency");
  const title = input.title.trim().slice(0, 300);
  if (!title) throw new UnprocessableEntityException("Name what is being approved");
  const open = await requestRow(db, input.workspaceId, { kind: input.kind, subjectId: input.subjectId, pendingOnly: true }, true);
  if (open) {
    const same = (open.amount === null ? amount === null : amount !== null && trim(open.amount) === trim(amount)) && open.currency === currency;
    if (same) return statusOf(db, input.workspaceId, open, now);
    return (await amendApprovalAmount(db, { workspaceId: input.workspaceId, kind: input.kind, subjectId: input.subjectId, amount, currency, actorUserId: input.requesterUserId,
      title, href: input.href ?? null, notify: input.notify }, now)).status;
  }
  return openRequest(db, { ...input, amount, currency, title, previousAmount: null, supersedesId: null }, now);
}

async function openRequest(db: Db, input: Omit<RequestApprovalInput, "amount" | "currency"> & { amount: string | null; currency: string | null; previousAmount: string | null; supersedesId: string | null }, now: Date) {
  await ensureDefaultPolicy(db, input.workspaceId, input.kind);
  const version = selectPolicy(await activePolicyVersions(db, input.workspaceId, input.kind), input.amount, input.currency);
  if (!version) throw new UnprocessableEntityException("No approval policy covers this. Set one up in Settings → Approvals.");
  const ownerStep = needsOwner(version, input.amount, input.currency);
  const row = (await db.query<{ id: string }>(
    `INSERT INTO approval_requests (workspace_id, subject_kind, subject_id, title, href, amount, currency_code, previous_amount, policy_version_id, owner_step,
       step_since, expires_at, requested_by, requested_at, supersedes_id)
     VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8::numeric, $9, $10, $11, $12, $13, $11, $14) RETURNING id`,
    [input.workspaceId, input.kind, input.subjectId, input.title, input.href ?? null, input.amount, input.currency, input.previousAmount, version.id, ownerStep,
      now, input.expiresAt ?? null, input.requesterUserId, input.supersedesId])).rows[0];
  const steps = effectiveSteps(version, ownerStep);
  let current = 1;
  for (const prior of (input.priorApprovals ?? []).slice(0, steps.length - 1)) {
    await db.query(
      `INSERT INTO approval_decisions (workspace_id, request_id, step_position, decision, decided_by, via, decided_at) VALUES ($1, $2, $3, 'approve', $4, 'legacy', coalesce($5::timestamptz, now()))`,
      [input.workspaceId, row.id, current, prior.deciderUserId, prior.decidedAt ?? null]);
    current += 1;
  }
  if (current > 1) await db.query(`UPDATE approval_requests SET current_step = $3 WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, row.id, current]);
  await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.requesterUserId, action: "approvals.requested.v1", entityType: "approval_request", entityId: row.id,
    after: { kind: input.kind, subjectId: input.subjectId, amount: input.amount, currency: input.currency, previousAmount: input.previousAmount,
      policyVersionId: version.id, ownerStep, supersedesId: input.supersedesId, legacySteps: current - 1 } });
  const status = await statusOf(db, input.workspaceId, (await requestRow(db, input.workspaceId, { id: row.id }))!, now);
  if (input.notify !== false) await tellApprovers(db, input.workspaceId, status, input.requesterUserId, now);
  return status;
}

export type DecideApprovalInput = {
  workspaceId: string;
  /** The request, or the subject whose open request is decided. */
  requestId?: string;
  kind?: ApprovalSubjectKind;
  subjectId?: string;
  deciderUserId: string;
  decision: ApprovalDecision;
  note?: string | null;
  /** The version the decider saw; a different one means someone else acted first (409). */
  expectedVersion?: number | null;
  /** The step the decider saw; deciding a later or earlier step than the current one is refused. */
  expectedStep?: number | null;
  /** Makes the decision replay-safe: the same command twice decides once. */
  commandId?: string | null;
  /** The requester deciding their own request, where the policy allows a recorded waiver. */
  waiveSeparation?: boolean;
  /** Tell the next approvers or the requester. Off for a module that sends its own notices. */
  notify?: boolean;
};

const REASONS: Record<NonNullable<Eligibility["reason"]>, string> = {
  decided: "This was already decided.",
  expired: "This expired while it waited. Extend it or issue it again.",
  own: "It's your own; someone else decides.",
  earlier_step: "You decided an earlier step; someone else decides this one.",
  not_yours: "This step isn't yours to decide.",
};

/**
 * Decides the current step. The request row is locked first, so two approvers acting at once are serialised: one
 * decision wins and the other is told the final state (409). Audited; idempotent per `commandId`.
 */
export async function decideApproval(db: Db, input: DecideApprovalInput, now = new Date()): Promise<ApprovalStatus> {
  if (!["approve", "return", "reject"].includes(input.decision)) throw new UnprocessableEntityException("Approve, return or reject");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
  if (input.decision !== "approve" && !note) throw new UnprocessableEntityException("Say what needs to change");
  if (input.commandId) {
    const replay = (await db.query<{ requestId: string }>(`SELECT request_id AS "requestId" FROM approval_decisions WHERE workspace_id = $1 AND command_id = $2`,
      [input.workspaceId, input.commandId])).rows[0];
    if (replay) return (await approvalStatusById(db, input.workspaceId, replay.requestId, now))!;
  }
  const row = input.requestId ? await requestRow(db, input.workspaceId, { id: input.requestId }, true)
    : input.kind && input.subjectId ? await requestRow(db, input.workspaceId, { kind: input.kind, subjectId: input.subjectId }, true) : null;
  if (!row) throw new NotFoundException("Nothing is waiting for approval here");
  // The same command, sent again while the first held the lock: it already decided.
  if (input.commandId && (await db.query(`SELECT 1 FROM approval_decisions WHERE workspace_id = $1 AND command_id = $2`, [input.workspaceId, input.commandId])).rowCount)
    return statusOf(db, input.workspaceId, row, now);
  if (row.status !== "pending") {
    const final = await statusOf(db, input.workspaceId, row, now);
    const by = [...final.steps].reverse().find((step) => step.decidedBy)?.decidedBy;
    throw new ConflictException({ message: `This was already ${row.status}${by ? ` by ${by}` : ""}.`, approval: final });
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && input.expectedVersion !== row.version)
    throw new ConflictException({ message: "Someone acted on this first. Reload to see where it stands.", approval: await statusOf(db, input.workspaceId, row, now) });
  if (input.expectedStep !== undefined && input.expectedStep !== null && input.expectedStep !== row.currentStep)
    throw new ConflictException({ message: "This is at another step now. Reload to see where it stands.", approval: await statusOf(db, input.workspaceId, row, now) });
  const version = await policyVersion(db, input.workspaceId, row.policyVersionId);
  const decisions = await decisionsOf(db, input.workspaceId, row.id);
  const requestFacts = facts(row, version, decisions);
  if (input.decision === "approve" && isExpired(requestFacts, now)) throw new ConflictException(REASONS.expired);
  const allowed = eligibility(requestFacts, await personFacts(db, input.workspaceId, input.deciderUserId), await delegatorsOf(db, input.workspaceId, input.deciderUserId, now), now);
  if (!allowed.canDecide) throw new ForbiddenException(REASONS[allowed.reason ?? "not_yours"]);
  if (allowed.via === "waiver") {
    if (!input.waiveSeparation) throw new ForbiddenException("It's your own. Record a waiver with the reason to decide it yourself.");
    if (!note) throw new UnprocessableEntityException("Say why you decide your own request");
  }
  const next = nextState(requestFacts, input.decision);
  await db.query(
    `INSERT INTO approval_decisions (workspace_id, request_id, step_position, decision, decided_by, on_behalf_of, via, note, command_id, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [input.workspaceId, row.id, row.currentStep, input.decision, input.deciderUserId, allowed.onBehalfOf, allowed.via, note || null, input.commandId ?? null, now]);
  await db.query(
    `UPDATE approval_requests SET status = $3, current_step = $4, step_since = CASE WHEN $4 <> current_step THEN $5 ELSE step_since END,
            decided_at = CASE WHEN $6 THEN $5 ELSE decided_at END, version = version + 1
      WHERE workspace_id = $1 AND id = $2`,
    [input.workspaceId, row.id, next.status, next.currentStep, now, next.final]);
  await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.deciderUserId, action: `approvals.${input.decision === "approve" ? (next.final ? "approved" : "step_approved") : input.decision === "return" ? "returned" : "rejected"}.v1`,
    entityType: "approval_request", entityId: row.id,
    before: { status: row.status, step: row.currentStep, version: row.version },
    after: { kind: row.kind, subjectId: row.subjectId, status: next.status, step: next.currentStep, via: allowed.via, onBehalfOf: allowed.onBehalfOf, note: note || null } });
  const status = await statusOf(db, input.workspaceId, (await requestRow(db, input.workspaceId, { id: row.id }))!, now);
  if (input.notify !== false) {
    if (next.final) await tellRequester(db, input.workspaceId, status, input.deciderUserId, input.decision, note);
    else await tellApprovers(db, input.workspaceId, status, input.deciderUserId, now);
  }
  return status;
}

export type AmendApprovalInput = {
  workspaceId: string; kind: ApprovalSubjectKind; subjectId: string; amount: string | number | null; currency: string | null; actorUserId: string;
  title?: string | null; href?: string | null; notify?: boolean;
};

/**
 * E3-3: the subject's amount changed. Under the same policy, with the same Owner rule and within the tolerance, the
 * open request keeps its approvals (the change is recorded on it). Otherwise its approvals reset: the open request is
 * superseded, or a new one follows an approved one, with the old and new amounts, requested by whoever changed it.
 */
export async function amendApprovalAmount(db: Db, input: AmendApprovalInput, now = new Date()): Promise<{ reset: boolean; status: ApprovalStatus }> {
  checkSubject(input);
  const amount = guarded(() => amountText(input.amount));
  const currency = guarded(() => currencyText(input.currency));
  const row = await requestRow(db, input.workspaceId, { kind: input.kind, subjectId: input.subjectId }, true);
  if (!row || !["pending", "approved"].includes(row.status)) {
    if (!input.title) throw new NotFoundException("Nothing was requested for this yet");
    return { reset: true, status: await openRequest(db, { workspaceId: input.workspaceId, kind: input.kind, subjectId: input.subjectId, title: input.title, href: input.href,
      amount, currency, requesterUserId: input.actorUserId, notify: input.notify, previousAmount: null, supersedesId: null }, now) };
  }
  const version = await policyVersion(db, input.workspaceId, row.policyVersionId);
  await ensureDefaultPolicy(db, input.workspaceId, input.kind);
  const target = selectPolicy(await activePolicyVersions(db, input.workspaceId, input.kind), amount, currency);
  // The request keeps its version (E3-4) unless the amount moves it under another policy.
  const samePolicy = target?.policyId === version.policyId;
  const resets = amountChangeResets({
    before: { amount: trim(row.amount), currency: row.currency, policyId: version.policyId, ownerStep: row.ownerStep },
    after: { amount: trim(amount), currency, policyId: target?.policyId ?? null, ownerStep: target ? needsOwner(samePolicy ? version : target, amount, currency) : false },
    tolerancePercent: version.resetTolerancePercent,
  });
  const decided = (await decisionsOf(db, input.workspaceId, row.id)).some((decision) => decision.decision === "approve");
  if (!resets || (row.status === "pending" && !decided && samePolicy && needsOwner(version, amount, currency) === row.ownerStep)) {
    if (trim(row.amount) !== trim(amount) || row.currency !== currency) {
      await db.query(`UPDATE approval_requests SET amount = $3::numeric, currency_code = $4, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
        [input.workspaceId, row.id, amount, currency]);
      await db.query(
        `INSERT INTO approval_decisions (workspace_id, request_id, step_position, decision, decided_by, via, from_amount, to_amount, decided_at)
         VALUES ($1, $2, $3, 'amended', $4, 'system', $5::numeric, $6::numeric, $7)`,
        [input.workspaceId, row.id, row.currentStep, input.actorUserId, row.amount, amount, now]);
      await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "approvals.amount_amended.v1", entityType: "approval_request", entityId: row.id,
        before: { amount: row.amount, currency: row.currency }, after: { amount, currency, reset: false } });
    }
    return { reset: false, status: await statusOf(db, input.workspaceId, (await requestRow(db, input.workspaceId, { id: row.id }))!, now) };
  }
  if (row.status === "pending") {
    await db.query(`UPDATE approval_requests SET status = 'superseded', version = version + 1 WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, row.id]);
  }
  const status = await openRequest(db, {
    workspaceId: input.workspaceId, kind: input.kind, subjectId: input.subjectId, title: input.title?.trim() || row.title, href: input.href ?? row.href,
    amount, currency, requesterUserId: input.actorUserId, notify: input.notify, previousAmount: row.amount, supersedesId: row.id,
  }, now);
  await db.query(`UPDATE approval_requests SET superseded_by_id = $3 WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, row.id, status.id]);
  await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "approvals.reset.v1", entityType: "approval_request", entityId: row.id,
    before: { amount: row.amount, currency: row.currency, status: row.status }, after: { amount, currency, newRequestId: status.id } });
  return { reset: true, status };
}

/** Withdraws the open request for a subject (the subject was withdrawn or deleted). */
export async function cancelApproval(db: Db, input: { workspaceId: string; kind: ApprovalSubjectKind; subjectId: string; actorUserId: string | null; reason: string }, now = new Date()) {
  const row = await requestRow(db, input.workspaceId, { kind: input.kind, subjectId: input.subjectId, pendingOnly: true }, true);
  if (!row) return null;
  await db.query(`UPDATE approval_requests SET status = 'cancelled', decided_at = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, row.id, now]);
  await db.query(
    `INSERT INTO approval_decisions (workspace_id, request_id, step_position, decision, decided_by, via, note, decided_at) VALUES ($1, $2, $3, 'cancelled', $4, 'system', $5, $6)`,
    [input.workspaceId, row.id, row.currentStep, input.actorUserId, input.reason.slice(0, 1000), now]);
  await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "approvals.cancelled.v1", entityType: "approval_request", entityId: row.id,
    before: { status: row.status }, after: { status: "cancelled", reason: input.reason } });
  return statusOf(db, input.workspaceId, (await requestRow(db, input.workspaceId, { id: row.id }))!, now);
}

// ---------------------------------------------------------------- the inbox

export type PendingForPerson = { status: ApprovalStatus; eligibility: Eligibility };

/** Open requests this person may decide now (and their own, which others decide), oldest first. */
export async function pendingForPerson(db: Db, workspaceId: string, userId: string, options: { excludeKinds?: ReadonlySet<string>; now?: Date } = {}): Promise<PendingForPerson[]> {
  const now = options.now ?? new Date();
  const rows = (await db.query<RequestRow>(
    `SELECT ${REQUEST_SELECT} FROM ${REQUEST_FROM} WHERE request.workspace_id = $1 AND request.status = 'pending' ORDER BY request.step_since LIMIT 200`, [workspaceId])).rows
    .filter((row) => !options.excludeKinds?.has(row.kind));
  if (!rows.length) return [];
  const person = await personFacts(db, workspaceId, userId);
  const delegators = await delegatorsOf(db, workspaceId, userId, now);
  const out: PendingForPerson[] = [];
  for (const row of rows) {
    const version = await policyVersion(db, workspaceId, row.policyVersionId);
    const allowed = eligibility(facts(row, version, await decisionsOf(db, workspaceId, row.id)), person, delegators, now);
    if (allowed.canDecide || row.requestedBy === userId) out.push({ status: await statusOf(db, workspaceId, row, now), eligibility: allowed });
  }
  return out;
}

/**
 * E3-1: requests whose current step waited past its escalation hours. The next approvers (the Owner past the last
 * step) are told once, and the escalation is recorded on the request's history. Run from the daily approval chaser.
 */
export async function escalateWaitingApprovals(db: Db, workspaceId: string, now = new Date()) {
  const rows = (await db.query<RequestRow & { hours: number }>(
    `SELECT ${REQUEST_SELECT}, version_row.escalate_after_hours AS hours
       FROM ${REQUEST_FROM} JOIN approval_policy_versions version_row ON version_row.workspace_id = request.workspace_id AND version_row.id = request.policy_version_id
      WHERE request.workspace_id = $1 AND request.status = 'pending' AND version_row.escalate_after_hours IS NOT NULL
        AND request.step_since + make_interval(hours => version_row.escalate_after_hours) <= $2
        AND NOT EXISTS (SELECT 1 FROM approval_decisions decision WHERE decision.workspace_id = request.workspace_id AND decision.request_id = request.id
                         AND decision.decision = 'escalated' AND decision.step_position = request.current_step)
      LIMIT 100`, [workspaceId, now])).rows;
  let escalated = 0;
  for (const row of rows) {
    const inserted = await db.query(
      `INSERT INTO approval_decisions (workspace_id, request_id, step_position, decision, via, decided_at) VALUES ($1, $2, $3, 'escalated', 'system', $4)
       ON CONFLICT (workspace_id, request_id, step_position) WHERE decision = 'escalated' DO NOTHING`, [workspaceId, row.id, row.currentStep, now]);
    if (!inserted.rowCount) continue;
    const version = await policyVersion(db, workspaceId, row.policyVersionId);
    const requestFacts = facts(row, version, await decisionsOf(db, workspaceId, row.id));
    const target = escalationStep(requestFacts);
    const blocked = new Set([row.requestedBy, ...requestFacts.earlier.flatMap((decision) => [decision.decidedBy, decision.onBehalfOf])]);
    const { direct } = await stepApprovers(db, workspaceId, target, now);
    const current = requestFacts.steps[row.currentStep - 1];
    for (const person of direct.filter((item) => !blocked.has(item.userId))) {
      await notifyUserInApp(db, { workspaceId, recipientUserId: person.userId, code: "approvals.escalated_step", eventType: "approvals.escalated_step",
        variables: { title: row.title, hours: String(row.hours), step: current?.label || "approval" }, deepLink: row.href ?? "/workspace/approvals",
        idempotencyKey: `approvals.escalated_step:${row.id}:${row.currentStep}:${person.userId}` });
    }
    await recordAudit(db, { workspaceId, actorUserId: null, source: "internal", action: "approvals.escalated.v1", entityType: "approval_request", entityId: row.id,
      after: { step: row.currentStep, hours: row.hours, to: target.label } });
    escalated += 1;
  }
  return { escalated };
}

// ---------------------------------------------------------------- notices

const moneyText = (status: Pick<ApprovalStatus, "amount" | "currency" | "previousAmount">) =>
  status.amount && status.currency ? ` · ${status.currency} ${status.previousAmount ? `${status.previousAmount} → ` : ""}${status.amount}` : "";

/** The current step's approvers (and their delegates) hear it is theirs; the requester and earlier deciders never. */
export async function tellApprovers(db: Db, workspaceId: string, status: ApprovalStatus, actorUserId: string, now = new Date()) {
  if (status.status !== "pending") return 0;
  const row = (await requestRow(db, workspaceId, { id: status.id }))!;
  const version = await policyVersion(db, workspaceId, row.policyVersionId);
  const requestFacts = facts(row, version, await decisionsOf(db, workspaceId, row.id));
  const step = requestFacts.steps[row.currentStep - 1];
  if (!step) return 0;
  const blocked = new Set([row.requestedBy, actorUserId, ...requestFacts.earlier.flatMap((decision) => [decision.decidedBy, decision.onBehalfOf])]);
  const { direct, delegates } = await stepApprovers(db, workspaceId, step, now);
  const recipients = [...direct.map((person) => person.userId), ...delegates.filter((person) => !blocked.has(person.forUserId)).map((person) => person.userId)];
  const actor = (await db.query<{ name: string }>(`SELECT coalesce(nullif(btrim(display_name), ''), primary_email) AS name FROM users WHERE id = $1`, [actorUserId])).rows[0]?.name ?? "Someone";
  let told = 0;
  for (const userId of [...new Set(recipients)].filter((id) => !blocked.has(id))) {
    const message = { workspaceId, recipientUserId: userId, code: "approvals.requested", eventType: "approvals.requested",
      variables: { title: status.title, actor, amountText: moneyText(status), step: step.label || "approval" }, deepLink: status.href ?? "/workspace/approvals" };
    const key = `approvals.requested:${status.id}:${row.currentStep}:${userId}`;
    const result = await notifyUserInApp(db, { ...message, idempotencyKey: key });
    await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
    if (result.queued) told += 1;
  }
  return told;
}

async function tellRequester(db: Db, workspaceId: string, status: ApprovalStatus, actorUserId: string, decision: ApprovalDecision, note: string) {
  if (status.requestedBy.userId === actorUserId) return;
  const actor = (await db.query<{ name: string }>(`SELECT coalesce(nullif(btrim(display_name), ''), primary_email) AS name FROM users WHERE id = $1`, [actorUserId])).rows[0]?.name ?? "Someone";
  await notifyUserInApp(db, { workspaceId, recipientUserId: status.requestedBy.userId, code: "approvals.decided", eventType: "approvals.decided",
    variables: { title: status.title, actor, outcome: decision === "approve" ? "approved" : decision === "return" ? "returned" : "rejected", note: note || "" },
    deepLink: status.href ?? "/workspace/approvals", idempotencyKey: `approvals.decided:${status.id}` });
}
