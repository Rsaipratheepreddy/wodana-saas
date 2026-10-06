import type { PoolClient } from "pg";
import { caseTeam, caseTitle, tellClients, tellStaff } from "../client-portal/portal-notices";
import { impactLine } from "./change-request.domain";

type Db = Pick<PoolClient, "query">;

/**
 * Who hears what about a change request (plan §6.20, §6.24):
 *   change_request.raised   the client asked for a change          the stage owner, the design team and the project manager (app + email)
 *   approval (E3)           a change waits for approval             the policy's approvers (the engine tells them)
 *   decision_waiting        a change waits for the client           the project's decision-makers (branded email; portal card)
 *   change_request.decided  the client approved or declined it      whoever raised or submitted it, the design team and the project manager (app + email)
 */

/** The owners of where the job stands now: the active design stage's owner and the people holding the current project stage's role. */
export async function stageOwners(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ userId: string }>(
    `SELECT membership.user_id AS "userId" FROM design_journey_stages stage
       JOIN workspace_memberships membership ON membership.workspace_id = stage.workspace_id AND membership.id = stage.owner_membership_id AND membership.status = 'active'
      WHERE stage.workspace_id = $1 AND stage.case_id = $2 AND stage.status = 'active'
     UNION
     SELECT membership.user_id FROM delivery_projects project
       JOIN project_stages stage ON stage.workspace_id = project.workspace_id AND stage.project_id = project.id AND stage.status = 'current' AND stage.owner_role IS NOT NULL
       JOIN project_assignments assignment ON assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id AND assignment.active
                                          AND stage.owner_role = ANY(assignment.role_keys)
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE project.workspace_id = $1 AND project.case_id = $2 AND project.started_at IS NOT NULL`, [workspaceId, caseId])).rows.map((row) => row.userId);
}

const link = (caseId: string, id: string) => `/workspace/pre-projects/cases/${caseId}/variations?change=${id}`;

type Change = { id: string; caseId: string; reference: string; title: string; description: string; currency: string; priceImpact: string; timeImpactDays: number;
  status: string; declineNote: string | null; decidedByName: string | null };

export async function noticeChangeRaised(db: Db, workspaceId: string, change: Change, clientName: string) {
  const people = [...new Set([...(await stageOwners(db, workspaceId, change.caseId)), ...(await caseTeam(db, workspaceId, change.caseId, ["design", "managers"]))])];
  await tellStaff(db, { workspaceId, recipients: people, code: "change_request.raised", deepLink: link(change.caseId, change.id), key: change.id, email: true,
    variables: { clientName: (await caseTitle(db, workspaceId, change.caseId)).clientName || clientName, reference: change.reference, title: change.title, note: change.description.slice(0, 480) } });
}

/** The change waits for the client: a card in their portal and the branded email to the decision-makers. */
export async function noticeChangeToClient(db: Db, workspaceId: string, change: Change) {
  await tellClients(db, { workspaceId, caseId: change.caseId, event: "decision_waiting", recordId: `change:${change.id}`, title: `${change.reference} · ${change.title}`,
    note: impactLine(change.priceImpact, change.timeImpactDays, change.currency) });
}

export async function noticeChangeDecided(db: Db, workspaceId: string, change: Change, orders: Array<{ number: string }> = []) {
  const owners = (await db.query<{ userId: string }>(
    `SELECT DISTINCT unnest(ARRAY[submitted_by, raised_by]) AS "userId" FROM change_requests WHERE workspace_id = $1 AND id = $2`, [workspaceId, change.id])).rows
    .map((row) => row.userId).filter(Boolean);
  const people = [...new Set([...owners, ...(await caseTeam(db, workspaceId, change.caseId, ["design", "managers"]))])];
  const approved = change.status === "approved";
  const note = approved
    ? [impactLine(change.priceImpact, change.timeImpactDays, change.currency), orders.length ? `Open orders to check: ${orders.map((order) => order.number).join(", ")}` : ""].filter(Boolean).join(". ")
    : change.declineNote ?? "";
  await tellStaff(db, { workspaceId, recipients: people, code: "change_request.decided", deepLink: link(change.caseId, change.id), key: `${change.id}:${change.status}`, email: true,
    variables: { clientName: change.decidedByName ?? (await caseTitle(db, workspaceId, change.caseId)).clientName, reference: change.reference, title: change.title,
      decision: approved ? "approved" : "declined", note: note.slice(0, 480) } });
}
