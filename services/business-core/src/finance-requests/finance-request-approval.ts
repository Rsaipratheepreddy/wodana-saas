import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import type { ApprovalDecision, ApprovalStatus } from "../approvals/approval-policy";
import { isOpen } from "./finance-requests";
import { readRequests } from "./finance-requests.store";
import { addEvent, recordOnLinkedRecords, tellRequest } from "./finance-request-notices";

type Db = Pick<PoolClient, "query">;

/**
 * What a final approval decision on a refund or payable request does to it, in the decision's transaction
 * (from the Approvals inbox or the request itself): approved, Finance may process it; returned, it goes back
 * to its requester with the approver's note; rejected, it's closed with why. Earlier steps change nothing.
 */
export async function applyFinanceRequestDecision(db: Db, workspaceId: string, approval: ApprovalStatus, _decision: ApprovalDecision, actorUserId: string, note: string | null) {
  if (!["approved", "returned", "rejected"].includes(approval.status)) return;
  await db.query(`SELECT 1 FROM finance_requests WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, approval.subjectId]);
  const request = (await readRequests(db, workspaceId, { id: approval.subjectId }))[0];
  if (!request || !isOpen(request.status)) return;
  const said = (note ?? "").trim();
  if (approval.status === "approved") {
    await db.query(`UPDATE finance_requests SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, request.id]);
    const eventId = await addEvent(db, workspaceId, request.id, { kind: "approval", note: said || "Approved", actorId: actorUserId });
    await recordAudit(db, { workspaceId, actorUserId, action: "finance_request.approved", entityType: "finance_request", entityId: request.id, after: { approvalId: approval.id } });
    await tellRequest(db, workspaceId, request.id, "approved", actorUserId, said, eventId);
    return;
  }
  if (approval.status === "returned") {
    await db.query(`UPDATE finance_requests SET status = 'needs_info', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, request.id]);
    const eventId = await addEvent(db, workspaceId, request.id, { kind: "needs_info", from: request.status, to: "needs_info", note: said, actorId: actorUserId });
    await recordAudit(db, { workspaceId, actorUserId, action: "finance_request.returned", entityType: "finance_request", entityId: request.id,
      before: { status: request.status }, after: { status: "needs_info", note: said } });
    await tellRequest(db, workspaceId, request.id, "needs_info", actorUserId, said, eventId);
    return;
  }
  const reason = said || "Not approved.";
  await db.query(`UPDATE finance_requests SET status = 'rejected', closed_by = $3, closed_at = now(), close_note = $4, version = version + 1, updated_at = now()
    WHERE workspace_id = $1 AND id = $2`, [workspaceId, request.id, actorUserId, reason.slice(0, 1000)]);
  const eventId = await addEvent(db, workspaceId, request.id, { kind: "rejected", from: request.status, to: "rejected", note: reason, actorId: actorUserId });
  await recordAudit(db, { workspaceId, actorUserId, action: "finance_request.rejected", entityType: "finance_request", entityId: request.id,
    before: { status: request.status }, after: { status: "rejected", note: reason, by: "approval" } });
  await recordOnLinkedRecords(db, workspaceId, request, "finance_request_rejected", actorUserId);
  await tellRequest(db, workspaceId, request.id, "rejected", actorUserId, reason, eventId);
}
