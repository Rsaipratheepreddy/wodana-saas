import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { canonicalHash } from "../crm/shared/crm-types";

type Db = Pick<PoolClient, "query">;

/**
 * The project BOQ's lifecycle (PLM-167 / PLM-168): the live BOQ starts as a draft when the project starts, the technical
 * team verifies it (quantities, specifications), the QS approves it (a snapshot is kept as BOQ R-n), and the project
 * manager locks it. Anyone involved can return it to draft with a reason; a variation applied to the live BOQ returns
 * it to draft by itself. QS approval is the firm's internal check of the BOQ; it is never the client's approval.
 */
export const BOQ_STATUSES = ["draft", "technical_verified", "qs_approved", "locked"] as const;
export type BoqStatus = (typeof BOQ_STATUSES)[number];
export const BOQ_ACTIONS = ["verify", "qs_approve", "return", "lock"] as const;
export type BoqAction = (typeof BOQ_ACTIONS)[number];
/** The project command names the Scope tab sends, one per action. */
export const BOQ_COMMANDS: Record<string, BoqAction> = { verify_boq: "verify", qs_approve_boq: "qs_approve", return_boq: "return", lock_boq: "lock" };
/** The project role that verifies the BOQ when the firm names none. */
export const DEFAULT_BOQ_TECHNICAL_ROLE = "technical_designer";

/** The next status after an action, or why the action can't happen now. Pure. */
export function boqTransition(status: BoqStatus, action: BoqAction): BoqStatus {
  switch (action) {
    case "verify":
      if (status !== "draft") throw new ConflictException(status === "technical_verified" ? "The BOQ is already verified." : "The BOQ is already approved. Return it to draft to verify it again.");
      return "technical_verified";
    case "qs_approve":
      if (status === "draft") throw new ConflictException("The technical team verifies the BOQ before the QS approves it.");
      if (status !== "technical_verified") throw new ConflictException(status === "locked" ? "The BOQ is locked." : "The BOQ is already approved.");
      return "qs_approved";
    case "lock":
      if (status !== "qs_approved") throw new ConflictException(status === "locked" ? "The BOQ is already locked." : "The QS approves the BOQ before it is locked.");
      return "locked";
    case "return":
      if (status === "draft") throw new ConflictException("The BOQ is already a draft.");
      return "draft";
  }
}

/** Who may do what to the BOQ: the project manager (or anyone who manages projects), the technical team, the QS. Pure. */
export type BoqRights = { manager: boolean; technical: boolean; qs: boolean };
export function canActOnBoq(action: BoqAction, rights: BoqRights) {
  switch (action) {
    case "verify": return rights.manager || rights.technical;
    case "qs_approve": return rights.qs;
    case "return": return rights.manager || rights.technical || rights.qs;
    case "lock": return rights.manager;
  }
}

/** The actions each status offers (before rights): what the Scope tab shows as buttons. Pure. */
export function boqActionsFor(status: BoqStatus): BoqAction[] {
  return BOQ_ACTIONS.filter((action) => { try { boqTransition(status, action); return true; } catch { return false; } });
}

/** The project role whose holders verify the BOQ: the firm's choice when it is one of its roles, else the technical designer when the firm has it. */
export function boqTechnicalRoleOf(settings: { boqTechnicalRole: string | null; roles: Array<{ key: string }> }) {
  if (settings.boqTechnicalRole && settings.roles.some((role) => role.key === settings.boqTechnicalRole)) return settings.boqTechnicalRole;
  return settings.roles.some((role) => role.key === DEFAULT_BOQ_TECHNICAL_ROLE) ? DEFAULT_BOQ_TECHNICAL_ROLE : null;
}

export type BoqRevisionRow = { id: string; number: number; label: string; total: string; cost: string | null; lines: number; note: string; approvedByName: string; approvedAt: string; currency: string };
export type BoqStateEvent = { id: string; kind: string; detail: Record<string, unknown>; byName: string | null; at: string };
export type BoqState = {
  status: BoqStatus; revision: number; label: string | null; version: number;
  verifiedByName: string | null; verifiedAt: string | null; approvedByName: string | null; approvedAt: string | null;
  lockedByName: string | null; lockedAt: string | null; returnedByName: string | null; returnedAt: string | null; returnReason: string;
  /** Whether the live BOQ still matches the latest approved revision (false once a line changed since). */
  current: boolean;
  history: BoqStateEvent[];
  revisions: BoqRevisionRow[];
};

const STATE_SELECT = `SELECT state.status, state.revision, state.version, verifier.display_name AS "verifiedByName", state.verified_at AS "verifiedAt",
  approver.display_name AS "approvedByName", state.approved_at AS "approvedAt", locker.display_name AS "lockedByName", state.locked_at AS "lockedAt",
  returner.display_name AS "returnedByName", state.returned_at AS "returnedAt", state.return_reason AS "returnReason"
  FROM project_boq_states state
  LEFT JOIN users verifier ON verifier.id = state.verified_by
  LEFT JOIN users approver ON approver.id = state.approved_by
  LEFT JOIN users locker ON locker.id = state.locked_by
  LEFT JOIN users returner ON returner.id = state.returned_by`;

/** The BOQ's state for other modules and the Scope tab. A project with no row (started before the lifecycle) is a draft at revision 0. */
export async function readBoqState(db: Db, workspaceId: string, projectId: string): Promise<BoqState> {
  const row = (await db.query<Omit<BoqState, "label" | "current" | "history" | "revisions">>(`${STATE_SELECT} WHERE state.workspace_id = $1 AND state.project_id = $2`, [workspaceId, projectId])).rows[0]
    ?? { status: "draft" as BoqStatus, revision: 0, version: 0, verifiedByName: null, verifiedAt: null, approvedByName: null, approvedAt: null, lockedByName: null, lockedAt: null,
      returnedByName: null, returnedAt: null, returnReason: "" };
  const revisions = (await db.query<BoqRevisionRow & { contentHash: string }>(
    `SELECT revision.id, revision.number, revision.label, revision.total::text AS total, revision.cost::text AS cost, revision.lines, revision.note, revision.currency,
            approver.display_name AS "approvedByName", revision.approved_at AS "approvedAt", revision.content_hash AS "contentHash"
       FROM project_boq_revisions revision JOIN users approver ON approver.id = revision.approved_by
      WHERE revision.workspace_id = $1 AND revision.project_id = $2 ORDER BY revision.number DESC`, [workspaceId, projectId])).rows;
  const history = (await db.query<BoqStateEvent>(
    `SELECT event.id, event.kind, event.detail, person.display_name AS "byName", event.at FROM project_boq_state_events event LEFT JOIN users person ON person.id = event.actor_user_id
      WHERE event.workspace_id = $1 AND event.project_id = $2 ORDER BY event.at DESC, event.id LIMIT 100`, [workspaceId, projectId])).rows;
  const latest = revisions[0];
  const current = latest ? (await boqSnapshot(db, workspaceId, projectId)).contentHash === latest.contentHash : false;
  return { ...row, revision: Number(row.revision), label: row.revision ? `R${row.revision}` : null, current, history,
    revisions: revisions.map(({ contentHash: _hash, ...revision }) => revision) };
}

/** Whether the project BOQ is approved by the QS (or locked): the ordering gate's question (PLM-159 / PLM-163). */
export async function boqApproved(db: Db, workspaceId: string, projectId: string) {
  const status = (await db.query<{ status: BoqStatus }>(`SELECT status FROM project_boq_states WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0]?.status ?? "draft";
  return status === "qs_approved" || status === "locked";
}

/** Makes sure the project has its BOQ state row, as a draft, once (idempotent). Returns true the first time. */
export async function ensureBoqDraft(db: Db, workspaceId: string, projectId: string, actorUserId: string | null, note = "") {
  const inserted = (await db.query(`INSERT INTO project_boq_states (workspace_id, project_id) VALUES ($1, $2) ON CONFLICT (workspace_id, project_id) DO NOTHING`, [workspaceId, projectId])).rowCount;
  if (!inserted) return false;
  await stateEvent(db, workspaceId, projectId, "drafted", { note }, actorUserId);
  return true;
}

/**
 * The live BOQ as the QS approves it: each active line with its quantity, rate, amount and the cost ordered for it so far
 * (its purchase order lines, placed or in draft), with the totals and a fingerprint.
 */
export async function boqSnapshot(db: Db, workspaceId: string, projectId: string) {
  const lines = (await db.query<{ id: string; position: number; title: string; description: string; unit: string; quantity: string; rate: string; net: string; areaName: string | null;
    packageName: string | null; catalogItemId: string | null; sourceLineId: string; origin: string; orderedCost: string | null }>(
    `SELECT line.id, line.position, line.title, line.description, line.unit, line.quantity::text AS quantity, line.rate::text AS rate, line.net::text AS net, room.name AS "areaName",
            package.name AS "packageName", line.catalog_item_id AS "catalogItemId", line.source_line_id AS "sourceLineId", seal.revision_label AS origin,
            (SELECT sum(ordered.net)::text FROM purchase_order_lines ordered JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
              WHERE ordered.workspace_id = line.workspace_id AND ordered.boq_line_id = line.id AND purchase.status <> 'cancelled') AS "orderedCost"
       FROM project_boq_lines line
       JOIN project_scope_seals seal ON seal.workspace_id = line.workspace_id AND seal.id = line.origin_seal_id
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = project.case_id AND room.id = line.area_id
       LEFT JOIN project_packages package ON package.workspace_id = line.workspace_id AND package.id = line.package_id
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active'
      ORDER BY line.position, line.id`, [workspaceId, projectId])).rows;
  const currency = (await db.query<{ currency: string }>(`SELECT currency FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0]?.currency ?? "";
  const total = lines.reduce((sum, line) => sum.add(line.net), Dec.ZERO).toFixed(4);
  const costed = lines.filter((line) => line.orderedCost !== null);
  const cost = costed.length ? costed.reduce((sum, line) => sum.add(line.orderedCost!), Dec.ZERO).toFixed(4) : null;
  // The fingerprint covers what the QS approved: the lines, their quantities, rates and amounts (not the costs, which move as orders are placed).
  const contentHash = canonicalHash(lines.map((line) => ({ id: line.id, quantity: line.quantity, rate: line.rate, net: line.net, title: line.title, unit: line.unit })));
  return { lines, currency, total, cost, contentHash };
}

/**
 * One step of the lifecycle: checks the transition and the person's rights, records who and when, writes the history,
 * and at QS approval keeps the snapshot as the next revision. Returns the new state and the people to tell.
 */
export async function applyBoqAction(db: Db, workspaceId: string, projectId: string, action: BoqAction, input: { reason?: unknown; actorUserId: string; rights: BoqRights }) {
  if (!canActOnBoq(action, input.rights)) throw new ForbiddenException(action === "qs_approve" ? "Only the QS approves the BOQ." : action === "lock" ? "Only the project manager locks the BOQ."
    : action === "verify" ? "Only the technical team or the project manager verifies the BOQ." : "You can't return this BOQ.");
  await db.query(`INSERT INTO project_boq_states (workspace_id, project_id) VALUES ($1, $2) ON CONFLICT (workspace_id, project_id) DO NOTHING`, [workspaceId, projectId]);
  const current = (await db.query<{ status: BoqStatus; revision: number }>(`SELECT status, revision FROM project_boq_states WHERE workspace_id = $1 AND project_id = $2 FOR UPDATE`,
    [workspaceId, projectId])).rows[0];
  const next = boqTransition(current.status, action);
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
  if (action === "return" && !reason) throw new BadRequestException("Say why the BOQ goes back to draft.");
  const set = (sql: string, values: unknown[]) => db.query(`UPDATE project_boq_states SET ${sql}, status = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND project_id = $2`,
    [workspaceId, projectId, next, ...values]);
  let label: string | null = current.revision ? `R${current.revision}` : null;
  if (action === "verify") {
    await set(`verified_by = $4, verified_at = now(), returned_by = NULL, returned_at = NULL, return_reason = ''`, [input.actorUserId]);
    await stateEvent(db, workspaceId, projectId, "verified", { note: reason }, input.actorUserId);
  } else if (action === "qs_approve") {
    const snapshot = await boqSnapshot(db, workspaceId, projectId);
    if (!snapshot.lines.length) throw new ConflictException("The BOQ has no items to approve.");
    const number = Number(current.revision) + 1;
    label = `R${number}`;
    await db.query(
      `INSERT INTO project_boq_revisions (id, workspace_id, project_id, number, label, snapshot, content_hash, currency, total, cost, lines, note, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)`,
      [randomUUID(), workspaceId, projectId, number, label, JSON.stringify({ lines: snapshot.lines, total: snapshot.total, cost: snapshot.cost, currency: snapshot.currency }),
        snapshot.contentHash, snapshot.currency, snapshot.total, snapshot.cost, snapshot.lines.length, reason, input.actorUserId]);
    await set(`approved_by = $4, approved_at = now(), revision = $5`, [input.actorUserId, number]);
    await stateEvent(db, workspaceId, projectId, "qs_approved", { revision: label, total: snapshot.total, cost: snapshot.cost, lines: snapshot.lines.length, note: reason }, input.actorUserId);
  } else if (action === "lock") {
    await set(`locked_by = $4, locked_at = now()`, [input.actorUserId]);
    await stateEvent(db, workspaceId, projectId, "locked", { revision: label }, input.actorUserId);
  } else {
    await set(`returned_by = $4, returned_at = now(), return_reason = $5, verified_by = NULL, verified_at = NULL, locked_by = NULL, locked_at = NULL`, [input.actorUserId, reason]);
    await stateEvent(db, workspaceId, projectId, "returned", { from: current.status, reason }, input.actorUserId);
  }
  return { from: current.status, status: next, label, reason };
}

/** A variation changed the live BOQ: a verified or approved BOQ goes back to draft, saying which variation did it. */
export async function boqChanged(db: Db, workspaceId: string, projectId: string, by: string, actorUserId: string | null) {
  const changed = (await db.query<{ status: BoqStatus }>(
    `UPDATE project_boq_states SET status = 'draft', verified_by = NULL, verified_at = NULL, locked_by = NULL, locked_at = NULL, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND project_id = $2 AND status <> 'draft' RETURNING status`, [workspaceId, projectId])).rows[0];
  if (!changed) return false;
  await stateEvent(db, workspaceId, projectId, "changed", { by }, actorUserId);
  return true;
}

async function stateEvent(db: Db, workspaceId: string, projectId: string, kind: string, detail: Record<string, unknown>, actorUserId: string | null) {
  await db.query(`INSERT INTO project_boq_state_events (id, workspace_id, project_id, kind, detail, actor_user_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [randomUUID(), workspaceId, projectId, kind, JSON.stringify(detail), actorUserId]);
}

/** The active members who hold a permission (the QS: commercial.estimate; buyers: purchasing.manage), as membership ids. */
export async function membershipsWithPermission(db: Db, workspaceId: string, permission: string) {
  return (await db.query<{ id: string }>(
    `SELECT DISTINCT membership.id FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = $2
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId, permission])).rows.map((row) => row.id);
}
