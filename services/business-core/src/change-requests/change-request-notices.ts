import type { PoolClient } from "pg";
import { caseTeam, caseTitle, tellClients, tellStaff } from "../client-portal/portal-notices";
import { permissionHolders } from "../commercial/commercial-notices";
import { impactLine } from "./change-request.domain";

type Db = Pick<PoolClient, "query">;

/**
 * Who hears what about a change request (plan §6.20, §6.24). Staff notices go in the app and by email; every email is
 * rendered by the delivery worker through renderBrandedEmail with the tenant's brand (TransactionalEmailService.brand()).
 * Client notices go through the portal's own channel (WhatsApp where the tenant's template is approved, else the
 * branded email). The person who acted is never told about their own step.
 *
 * On a planning record (no project yet):
 *   change_request.raised    the client asked for a change         the stage owner, the design team and the project manager
 *   approval (E3)            a change waits for approval            the policy's approvers (the engine tells them)
 *   decision_waiting         a change waits for the client          the project's decision-makers (portal card + client message)
 *   change_request.decided   the client approved or declined it     whoever raised or submitted it, the design team and the project manager
 *
 * On a started project:
 *   change_request.project_raised  raised (team, mobile or client)  the project manager, the quantity surveyor (to price) and the approvers on the team
 *   approval (E3)                  priced, waiting for approval    the policy's approvers (the engine tells them)
 *   change_request.ready           approved inside the firm        the project manager and whoever sent it for approval
 *   decision_waiting               sent to the client               the client's decision-makers (portal + client message)
 *   change_request.sent            sent to the client               the project manager and whoever raised it
 *   change_request.decided         the client approved or declined  the project manager, the sales owner, the QS and whoever raised or submitted it
 *   change_request.invoice         approved: money to bill or credit finance (who verifies client payments, who handles finance requests)
 *   change_request.materials       approved: what to make or buy    the factory lead and procurement on the project, the factory and purchasing managers
 *   change_request.schedule_moved  applied: new dates               the whole project team and everyone whose work moved (work.moved per task as well)
 *   change_request.apply_blocked   approved but couldn't be applied the project manager
 *   change_request.client_decision still waiting for the client     the reminder engine (change-request-reminder-source.ts): the client on the
 *                                                                  rule's days, then the staff copy to the project manager (Settings › Reminders)
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

// ---------------------------------------------------------------- changes on a started project

const projectLink = (projectId: string, id: string) => `/workspace/projects/${projectId}/changes/${id}`;

export type ProjectChangeNotice = { id: string; projectId: string; caseId: string; reference: string; title: string; currency: string; priceImpact: string; timeImpactDays: number;
  raisedBy: string | null; submittedBy: string | null };

/** The people on a project by what they do there: its lead, holders of some roles, and (optionally) everyone. */
export async function projectPeople(db: Db, workspaceId: string, projectId: string, who: { lead?: boolean; roles?: string[]; everyone?: boolean; memberships?: string[] }) {
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active
        AND ($3 OR ($4 AND assignment.is_manager) OR assignment.role_keys && $5::varchar[] OR assignment.membership_id = ANY($6::uuid[]))
     UNION
     SELECT membership.user_id FROM workspace_memberships membership WHERE membership.workspace_id = $1 AND membership.status = 'active' AND membership.id = ANY($6::uuid[])`,
    [workspaceId, projectId, who.everyone ?? false, who.lead ?? false, who.roles ?? [], who.memberships ?? []])).rows.map((row) => row.userId);
}

async function facts(db: Db, workspaceId: string, caseId: string, actorUserId: string | null) {
  const title = await caseTitle(db, workspaceId, caseId);
  const actor = actorUserId ? (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorUserId])).rows[0]?.name ?? "Someone" : "Someone";
  return { project: title.title, clientName: title.clientName, actor };
}

/** Raised on a project: the project manager, the QS who prices it and the approvers on the team hear it. */
export async function noticeProjectChangeRaised(db: Db, workspaceId: string, change: ProjectChangeNotice, raisedBy: { userId: string | null; name: string }, note: string) {
  const team = await projectPeople(db, workspaceId, change.projectId, { lead: true, roles: ["quantity_surveyor"] });
  const approvers = new Set(await permissionHolders(db, workspaceId, "commercial.approve", 200));
  const onTeam = await projectPeople(db, workspaceId, change.projectId, { everyone: true });
  const people = [...new Set([...team, ...onTeam.filter((userId) => approvers.has(userId))])];
  const known = await facts(db, workspaceId, change.caseId, raisedBy.userId);
  await tellStaff(db, { workspaceId, recipients: people, code: "change_request.project_raised", deepLink: projectLink(change.projectId, change.id), key: change.id, email: true,
    except: raisedBy.userId, variables: { ...known, actor: raisedBy.name || known.actor, reference: change.reference, title: change.title, note: note.slice(0, 480) } });
}

/** Approved inside the firm: the project manager and whoever sent it for approval send it to the client. */
export async function noticeProjectChangeReady(db: Db, workspaceId: string, change: ProjectChangeNotice, actorUserId: string) {
  const people = [...new Set([...(await projectPeople(db, workspaceId, change.projectId, { lead: true })), ...(change.submittedBy ? [change.submittedBy] : [])])];
  await tellStaff(db, { workspaceId, recipients: people, code: "change_request.ready", deepLink: projectLink(change.projectId, change.id), key: `${change.id}:ready`, email: true,
    except: actorUserId, variables: { ...(await facts(db, workspaceId, change.caseId, actorUserId)), reference: change.reference, title: change.title,
      impact: impactLine(change.priceImpact, change.timeImpactDays, change.currency) } });
}

/** Sent to the client: their decision-makers (portal and client message) and the project manager and the raiser. */
export async function noticeProjectChangeSent(db: Db, workspaceId: string, change: ProjectChangeNotice, actorUserId: string, version: number) {
  const impact = impactLine(change.priceImpact, change.timeImpactDays, change.currency);
  const told = await tellClients(db, { workspaceId, caseId: change.caseId, event: "decision_waiting", recordId: `change:${change.id}:v${version}`, title: `${change.reference} · ${change.title}`, note: impact });
  const people = [...new Set([...(await projectPeople(db, workspaceId, change.projectId, { lead: true })), ...(change.raisedBy ? [change.raisedBy] : [])])];
  await tellStaff(db, { workspaceId, recipients: people, code: "change_request.sent", deepLink: projectLink(change.projectId, change.id), key: `${change.id}:sent:${version}`, email: true,
    except: actorUserId, variables: { ...(await facts(db, workspaceId, change.caseId, actorUserId)), reference: change.reference, title: change.title, impact } });
  return told;
}

export type ApplyOutcome = {
  label: string; payment: string; added: string[]; removed: string[]; orders: string[]; make: boolean; buy: boolean;
  handoverBefore: string | null; handoverAfter: string | null; stages: Array<{ name: string; delay: number }>; movedMemberships: string[];
};

/** The client decided: the people who own the change hear it; once applied, finance, the factory and purchasing, and the team for the new dates. */
export async function noticeProjectChangeDecided(db: Db, workspaceId: string, change: ProjectChangeNotice & { status: string; declineNote: string | null; decidedByName: string | null },
  outcome: ApplyOutcome | null) {
  const link = projectLink(change.projectId, change.id);
  const known = await facts(db, workspaceId, change.caseId, null);
  const salesOwner = (await db.query<{ userId: string }>(
    `SELECT owner.user_id AS "userId" FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       JOIN workspace_memberships owner ON owner.workspace_id = opportunity.workspace_id AND owner.id = opportunity.owner_membership_id AND owner.status = 'active'
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, change.caseId])).rows.map((row) => row.userId);
  const owners = [...new Set([...(await projectPeople(db, workspaceId, change.projectId, { lead: true, roles: ["quantity_surveyor", "account_manager"] })), ...salesOwner,
    ...[change.raisedBy, change.submittedBy].filter((userId): userId is string => Boolean(userId))])];
  const approved = change.status === "approved" || change.status === "applied";
  const note = approved ? [impactLine(change.priceImpact, change.timeImpactDays, change.currency), outcome ? `Applied as ${outcome.label}` : ""].filter(Boolean).join(". ") : change.declineNote ?? "";
  await tellStaff(db, { workspaceId, recipients: owners, code: "change_request.decided", deepLink: link, key: `${change.id}:${approved ? "approved" : "declined"}`, email: true,
    variables: { clientName: change.decidedByName ?? known.clientName, reference: change.reference, title: change.title, decision: approved ? "approved" : "declined", note: note.slice(0, 480) } });
  if (!approved || !outcome) return;
  const variables = { ...known, reference: change.reference, title: change.title, variation: outcome.label };
  if (outcome.payment) {
    const finance = [...new Set([...(await permissionHolders(db, workspaceId, "commercial.finance.verify", 100)), ...(await permissionHolders(db, workspaceId, "finance_requests.manage", 100))])];
    await tellStaff(db, { workspaceId, recipients: finance, code: "change_request.invoice", deepLink: link, key: `${change.id}:invoice`, email: true,
      variables: { ...variables, amount: impactLine(change.priceImpact, 0, change.currency), payment: outcome.payment } });
  }
  if (outcome.added.length || outcome.removed.length) {
    const roles = [...(outcome.make || outcome.removed.length ? ["factory_lead"] : []), ...(outcome.buy || outcome.removed.length ? ["procurement"] : [])];
    const managers = [...(outcome.make ? await permissionHolders(db, workspaceId, "factory.manage", 50) : []), ...(outcome.buy || outcome.orders.length ? await permissionHolders(db, workspaceId, "purchasing.manage", 50) : [])];
    const people = [...new Set([...(roles.length ? await projectPeople(db, workspaceId, change.projectId, { roles }) : []), ...managers])];
    const parts = [outcome.added.length ? `Added: ${outcome.added.join(", ")}` : "", outcome.removed.length ? `Removed or reduced: ${outcome.removed.join(", ")}` : "",
      outcome.orders.length ? `Orders to check: ${outcome.orders.join(", ")}` : ""].filter(Boolean);
    await tellStaff(db, { workspaceId, recipients: people, code: "change_request.materials", deepLink: link, key: `${change.id}:materials`, email: true,
      variables: { ...variables, note: parts.join(". ").slice(0, 480) } });
  }
  if (outcome.handoverBefore !== outcome.handoverAfter || outcome.stages.length) {
    const people = await projectPeople(db, workspaceId, change.projectId, { everyone: true, memberships: outcome.movedMemberships });
    const parts = [outcome.handoverBefore !== outcome.handoverAfter ? `Handover ${outcome.handoverBefore ?? "?"} → ${outcome.handoverAfter ?? "?"}` : "",
      ...outcome.stages.filter((stage) => stage.delay > 0).map((stage) => `${stage.name} +${stage.delay} ${stage.delay === 1 ? "day" : "days"}`)].filter(Boolean);
    await tellStaff(db, { workspaceId, recipients: people, code: "change_request.schedule_moved", deepLink: link, key: `${change.id}:schedule`, email: true,
      variables: { ...variables, note: parts.join(". ").slice(0, 480) } });
  }
}

/** Approved by the client but applying it was refused: the project manager applies it from the change. */
export async function noticeProjectChangeBlocked(db: Db, workspaceId: string, change: ProjectChangeNotice, problem: string) {
  const people = await projectPeople(db, workspaceId, change.projectId, { lead: true });
  await tellStaff(db, { workspaceId, recipients: people, code: "change_request.apply_blocked", deepLink: projectLink(change.projectId, change.id), key: `${change.id}:blocked`, email: true,
    variables: { ...(await facts(db, workspaceId, change.caseId, null)), reference: change.reference, title: change.title, note: problem.slice(0, 480) } });
}
