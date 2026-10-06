import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { decideChange } from "./change-request.store";

type Db = Pick<PoolClient, "query">;

/** What e-sign passes on when a change request's link is signed (the request row and the signer's typed name). */
export type ChangeSignedEvent = { request: { id: string; workspaceId: string; caseId: string; grantId: string | null }; signedName: string; signedAt: string };

/**
 * R11: signing a change request's link is the client's approval, decided exactly like the portal's (the same store
 * command), in the signing transaction: if the change can't be approved any more, nothing is signed. The link was
 * sent to a decision-maker; one who lost that role can't approve with it.
 */
export async function changeRequestSigned(db: Db, event: ChangeSignedEvent) {
  const { request } = event;
  const change = (await db.query<{ id: string; caseId: string }>(
    `SELECT id, case_id AS "caseId" FROM change_requests WHERE workspace_id = $1 AND esign_request_id = $2`, [request.workspaceId, request.id])).rows[0];
  if (!change) throw new ConflictException("This link isn't for a change waiting for you any more. Ask the team for a new one.");
  if (request.grantId) {
    const grant = (await db.query(`SELECT 1 FROM client_portal_grants WHERE workspace_id = $1 AND case_id = $2 AND id = $3 AND active AND role = 'approver'`,
      [request.workspaceId, change.caseId, request.grantId])).rowCount;
    if (!grant) throw new ForbiddenException("You're no longer this project's decision-maker. Ask the team for a new link.");
  }
  await decideChange(db, request.workspaceId, change.caseId, change.id, { decision: "approve", method: "signed_link", name: event.signedName, grantId: request.grantId });
}
