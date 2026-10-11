import type { PoolClient } from "pg";
import { tellClients } from "../client-portal/portal-notices";
import type { ClientDelivery, ClientDeliveryResult, DueItem, ReminderSource } from "../reminders/engine/engine";
import { changeReference, impactLine } from "./change-request.domain";

type Db = Pick<PoolClient, "query">;

/**
 * The change-request decision as a reminder source for the reminder engine (plan §6.24a): a change sent to the client
 * and not decided is due from the day it was sent; it is done once the client decides (or it is withdrawn, or the
 * project closes). The client gets the portal's decision_waiting message (WhatsApp where approved, else the branded
 * email); the engine's first escalation is the staff copy to the project manager.
 *
 * Not registered yet: the contract (reminders-contract.ts, packages/contracts and the 0289 CHECK lists) has no
 * `client.change_decision` kind. Until it does, processChangeDecisions (change-request-reminders.ts) sends these
 * reminders from the daily run. To plug it in: add the kind to the contract (module "projects", audience "client",
 * priority "decision", cadence like client.quote_decision), register `changeDecisionReminderSource` in
 * reminders/sources, and drop processChangeDecisions from the daily run.
 */
export const CHANGE_DECISION_REMINDER_KIND = "client.change_decision";

export type ChangeDecisionReminderSource = Omit<ReminderSource, "kind"> & { kind: typeof CHANGE_DECISION_REMINDER_KIND };

const projectLink = (projectId: string, id: string) => `/workspace/projects/${projectId}/changes/${id}`;

export const changeDecisionReminderSource: ChangeDecisionReminderSource = {
  kind: CHANGE_DECISION_REMINDER_KIND,
  module: "projects",
  audience: "client",
  critical: false,
  notify: "engine",
  viewPermission: "projects.view",
  template: { code: "portal.decision_waiting" },

  async open(db: Db, workspaceId: string, options: { now: Date; limit: number }): Promise<DueItem[]> {
    const rows = (await db.query<{ id: string; projectId: string; caseId: string; number: number; title: string; currency: string; priceImpact: string; timeImpactDays: number;
      sentAt: string; partyId: string | null; ownerMembershipId: string | null; project: string }>(
      `SELECT change.id, change.project_id AS "projectId", change.case_id AS "caseId", change.number, change.title, trim(change.currency) AS currency,
              change.price_impact::text AS "priceImpact", change.time_impact_days AS "timeImpactDays", change.sent_at AS "sentAt", opportunity.party_id AS "partyId",
              (SELECT assignment.membership_id FROM project_assignments assignment WHERE assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id
                  AND assignment.active AND assignment.is_manager ORDER BY assignment.membership_id LIMIT 1) AS "ownerMembershipId",
              project.reference || ' · ' || project.name AS project
         FROM change_requests change
         JOIN delivery_projects project ON project.workspace_id = change.workspace_id AND project.id = change.project_id AND project.status IN ('active', 'on_hold')
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = change.workspace_id AND pre_case.id = change.case_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
        WHERE change.workspace_id = $1 AND change.status = 'with_client' AND change.sent_at IS NOT NULL AND change.sent_at <= $2
        ORDER BY change.sent_at LIMIT $3`, [workspaceId, options.now, options.limit])).rows;
    return rows.map((row) => {
      const reference = changeReference(row.number);
      return {
        key: `change:${row.id}`, sourceType: "change_request", sourceId: row.id, jobSource: { type: "project", id: row.projectId } as DueItem["jobSource"],
        projectId: row.projectId, caseId: row.caseId, partyId: row.partyId, ownerMembershipId: row.ownerMembershipId, ccMembershipIds: [],
        dueAt: new Date(row.sentAt), title: `${reference} · ${row.title}`, context: row.project, href: projectLink(row.projectId, row.id),
        variables: { reference, title: row.title, project: row.project, impact: impactLine(row.priceImpact, row.timeImpactDays, row.currency) },
      };
    });
  },

  async stillOpen(db: Db, workspaceId: string, keys: readonly string[]) {
    const ids = keys.filter((key) => key.startsWith("change:")).map((key) => key.slice("change:".length));
    if (!ids.length) return new Set<string>();
    const open = (await db.query<{ id: string }>(
      `SELECT change.id FROM change_requests change
         JOIN delivery_projects project ON project.workspace_id = change.workspace_id AND project.id = change.project_id AND project.status IN ('active', 'on_hold')
        WHERE change.workspace_id = $1 AND change.id::text = ANY($2::text[]) AND change.status = 'with_client'`, [workspaceId, ids])).rows;
    return new Set(open.map((row) => `change:${row.id}`));
  },

  async deliverClient(db: Db, workspaceId: string, delivery: ClientDelivery): Promise<ClientDeliveryResult> {
    if (!delivery.subject.caseId) return { status: "skipped", notificationId: null, reason: "no_recipient" };
    const told = await tellClients(db, { workspaceId, caseId: delivery.subject.caseId, event: "decision_waiting", recordId: delivery.idempotencyKey,
      title: `${delivery.variables.reference ?? ""} · ${delivery.variables.title ?? ""}`, note: delivery.variables.impact ?? "" });
    return told.queued ? { status: "queued", notificationId: null, reason: null } : { status: "skipped", notificationId: null, reason: told.reason ?? "not_sent" };
  },
};
