import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { approvalStatus, decideApproval, requestApproval, type ApprovalDecision, type ApprovalStatus } from "../approvals/approval-engine.api";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { caseTitle } from "../client-portal/portal-notices";
import { lockLedger, readLedger, type LedgerView } from "../design/design-ledger.store";

type Db = Pick<PoolClient, "query">;

/**
 * E5-1 on E3: material and design changes made after the list was signed off are approved through the approval engine
 * (kind `ledger_change`, one open request per case) instead of a single reviewer. The request opens when the first
 * change after the lock is recorded (its amount follows the changes' price impact) and, once approved, the list is
 * locked again. A change request that carries the changes and is approved by the client closes it instead.
 */
const ledgerHref = (caseId: string) => `/workspace/pre-projects/cases/${caseId}/designs?stage=ledger`;

/** The price impact of what changed since the lock (the current versions not in it), for the approval's amount. */
export function pendingImpact(ledger: LedgerView) {
  return ledger.entries.filter((entry) => !entry.archivedAt && entry.current && entry.current.afterLock && entry.locked?.id !== entry.current.id)
    .reduce((sum, entry) => sum.add(entry.current!.priceImpact), Dec.ZERO);
}

/** Opens (or updates the amount of) the case's approval for changes after sign-off; nothing when the list matches its lock. */
export async function requestLedgerChangeApproval(db: Db, workspaceId: string, caseId: string, requesterUserId: string) {
  const ledger = await readLedger(db, workspaceId, caseId);
  if (ledger.state !== "changes_pending") return null;
  const facts = await caseTitle(db, workspaceId, caseId);
  return requestApproval(db, { workspaceId, kind: "ledger_change", subjectId: caseId, title: `Material changes after sign-off · ${facts.title || facts.clientName}`.slice(0, 300),
    href: ledgerHref(caseId), amount: ledger.currency ? pendingImpact(ledger).abs().toFixed(2) : null, currency: ledger.currency, requesterUserId });
}

export async function ledgerChangeApproval(db: Db, workspaceId: string, caseId: string) {
  return approvalStatus(db, workspaceId, "ledger_change", caseId);
}

/** Locks the list again after the approval (every change must carry the client's confirmation first, E5-2). */
async function relock(db: Db, workspaceId: string, caseId: string, userId: string, note: string | null) {
  const ledger = await readLedger(db, workspaceId, caseId);
  if (ledger.state !== "changes_pending") return ledger.lock?.number ?? null;
  if (ledger.lockProblem) throw new ConflictException(ledger.lockProblem);
  const number = await lockLedger(db, workspaceId, caseId, userId, "change_approved", note);
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "design.ledger_changes_approved.v1", entityType: "pre_project_case", entityId: caseId, after: { lock: number, via: "approval_engine" } });
  return number;
}

export type LedgerChangeDecision = { decision?: ApprovalDecision; note?: string | null; lockNumber: number; commandId?: string | null; expectedVersion?: number | null };

/**
 * A person decides the case's ledger-change approval at its current step (separation of duties, delegation and the
 * escalation rules are the engine's). When the request is fully approved, the list is locked again.
 */
export async function decideLedgerChange(db: Db, workspaceId: string, caseId: string, userId: string, input: LedgerChangeDecision) {
  const ledger = await readLedger(db, workspaceId, caseId);
  if ((ledger.lock?.number ?? 0) !== input.lockNumber) throw new ConflictException("The list changed in another window. Reload and try again.");
  if (!ledger.lock) throw new ConflictException("Lock the list at the design sign-off first.");
  if (ledger.state !== "changes_pending") throw new ConflictException("Nothing changed since the list was locked.");
  const decision = input.decision ?? "approve";
  if (decision === "approve" && ledger.lockProblem) throw new ConflictException(ledger.lockProblem);
  let open = await approvalStatus(db, workspaceId, "ledger_change", caseId);
  if (!open || open.status !== "pending") {
    // Changes recorded before the engine took over: the request opens for the person who recorded the latest one.
    const requester = (await db.query<{ userId: string | null }>(
      `SELECT recorded_by AS "userId" FROM design_ledger_versions WHERE workspace_id = $1 AND case_id = $2 AND after_lock AND recorded_by IS NOT NULL ORDER BY recorded_at DESC LIMIT 1`,
      [workspaceId, caseId])).rows[0]?.userId ?? userId;
    open = await requestLedgerChangeApproval(db, workspaceId, caseId, requester);
    if (!open) throw new ConflictException("Nothing changed since the list was locked.");
    if (requester === userId) throw new ForbiddenException("It's your own change; someone else approves it.");
  }
  const after = await decideApproval(db, { workspaceId, requestId: open.id, deciderUserId: userId, decision, note: input.note ?? null,
    commandId: input.commandId ?? null, expectedVersion: input.expectedVersion ?? null });
  if (after.status === "approved") await relock(db, workspaceId, caseId, userId, input.note?.trim() || null);
  return after;
}

/** The Approvals inbox decided the case's ledger-change request: approved → the list locks again. */
export async function applyLedgerChangeOutcome(db: Db, workspaceId: string, approval: ApprovalStatus, decision: ApprovalDecision, userId: string, note: string | null) {
  if (decision === "approve" && approval.status === "approved") await relock(db, workspaceId, approval.subjectId, userId, note);
}
