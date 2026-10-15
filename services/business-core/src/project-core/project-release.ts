import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { productionPaid, readProject, readStages } from "./project-core.store";
import { routeHolds } from "./project-drawings";

type Db = Pick<PoolClient, "query">;

/** Active people holding any of these permissions: membership and user. */
export async function permissionHolders(db: Db, workspaceId: string, codes: string[]) {
  return (await db.query<{ membershipId: string; userId: string }>(
    `SELECT DISTINCT membership.id AS "membershipId", membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = ANY($2::text[])
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId, codes])).rows;
}

/**
 * PLM-056: when the deal for the main quotation is approved, the people who start projects hear at once that it is
 * ready, so they name its project manager and start it (a project never starts without one, and no stage starts
 * without one). Once per case and person; nothing when the project has already started.
 */
export async function noticeReadyToStart(db: Db, input: { workspaceId: string; caseId: string; actorUserId: string | null }) {
  const facts = (await db.query<{ title: string; clientName: string; started: boolean }>(
    `SELECT concat_ws(' · ', opportunity.reference, opportunity.title) AS title, coalesce(party.display_name, opportunity.title) AS "clientName",
            EXISTS (SELECT 1 FROM delivery_projects project WHERE project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id AND project.started_at IS NOT NULL) AS started
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [input.workspaceId, input.caseId])).rows[0];
  if (!facts || facts.started) return 0;
  const actor = input.actorUserId ? (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [input.actorUserId])).rows[0]?.name ?? "" : "";
  let sent = 0;
  for (const person of await permissionHolders(db, input.workspaceId, ["projects.manage"])) {
    if (person.userId === input.actorUserId) continue;
    const message = { workspaceId: input.workspaceId, recipientUserId: person.userId, code: "project.ready_to_start", eventType: "project.ready_to_start",
      variables: { title: facts.title, clientName: facts.clientName, actor: actor || "Someone", note: `${actor || "Someone"} approved the deal. Name the project manager and start the project.` },
      deepLink: `/workspace/projects?start=${input.caseId}` };
    const key = `project.ready_to_start:${input.caseId}:${person.userId}`;
    const result = await notifyUserInApp(db, { ...message, idempotencyKey: key });
    await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
    if (result.queued) sent += 1;
  }
  return sent;
}

/**
 * PLM-068: once a running project's route asks for a factory slot (a stage still ahead holds the check) and the
 * payment due before production is verified (the joinery deposit; at once when the quote marks none), the factory
 * lead and the people who run the factory hear to book the slot. Once per project and person; nothing once a slot
 * is recorded.
 */
export async function noticeFactorySlotDue(db: Db, workspaceId: string, projectId: string, actorUserId: string | null) {
  const project = await readProject(db, workspaceId, projectId);
  if (!project || project.status !== "active") return 0;
  const stages = await readStages(db, workspaceId, [projectId]);
  if (!routeHolds(stages.filter((stage) => stage.status !== "done"), ["factory_slot_booked"])) return 0;
  const booked = (await db.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 AND factory_slot_on IS NOT NULL`, [workspaceId, projectId])).rowCount;
  if (booked || !(await productionPaid(db, workspaceId, project.caseId, project.quoteId))) return 0;
  const factoryLeads = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND 'factory_lead' = ANY(assignment.role_keys)`, [workspaceId, projectId])).rows;
  const recipients = new Set([...factoryLeads.map((row) => row.userId), ...(await permissionHolders(db, workspaceId, ["factory.manage"])).map((row) => row.userId)]);
  // Nobody runs the factory yet: the project manager books it.
  if (!recipients.size) for (const row of (await db.query<{ userId: string }>(
    `SELECT membership.user_id AS "userId" FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager`, [workspaceId, projectId])).rows) recipients.add(row.userId);
  let sent = 0;
  for (const userId of recipients) {
    if (userId === actorUserId) continue;
    const message = { workspaceId, recipientUserId: userId, code: "project.factory_slot_due", eventType: "project.factory_slot_due",
      variables: { title: `${project.reference} · ${project.name}`, clientName: project.clientName, actor: "", revision: "", note: "", date: "" }, deepLink: `/workspace/projects/${projectId}` };
    const key = `project.factory_slot_due:${projectId}:${userId}`;
    const result = await notifyUserInApp(db, { ...message, idempotencyKey: key });
    await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
    if (result.queued) sent += 1;
  }
  return sent;
}
