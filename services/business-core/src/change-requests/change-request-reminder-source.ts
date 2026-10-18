import { Injectable, type OnModuleInit } from "@nestjs/common";
import { deliverClientDefault } from "../reminders/delivery/client-router";
import type { Db, DueItem, ReminderSource } from "../reminders/engine/engine";
import { ReminderSourceRegistryService } from "../reminders/sources/registry.service";
import { changeReference, impactLine } from "./change-request.domain";

const projectLink = (projectId: string, id: string) => `/workspace/projects/${projectId}/changes/${id}`;
const changeKey = (id: string) => `change:${id}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The change ids behind `change:<id>` keys (anything else is not this source's). */
function changeIds(keys: readonly string[]) {
  return keys.filter((key) => key.startsWith("change:") && UUID.test(key.slice(7))).map((key) => key.slice(7));
}

/**
 * change_request.client_decision (plan §6.20, §6.24a): a change sent to the client that they haven't decided. It is due
 * from the moment it went to them; the client's decision-makers hear on the rule's days (Settings › Reminders → Change
 * waiting on the client; 2 and 5 days by default) on WhatsApp ("A decision is waiting") or by branded email, at most
 * one client reminder a day, and after the rule's count the project manager (the subject's owner) gets the staff copy.
 * Done once the client approves or declines it, the team withdraws it, or the project closes.
 */
export const changeDecisionReminderSource: ReminderSource = {
  kind: "change_request.client_decision", module: "projects", audience: "client", critical: false, notify: "engine",
  viewPermission: "projects.view", template: { code: "reminders.change_request.client_decision" },
  async open(db, workspaceId, { now, limit }) {
    const rows = (await db.query<{ id: string; projectId: string; caseId: string; number: number; title: string; currency: string; priceImpact: string; timeImpactDays: number;
      sentAt: Date; partyId: string | null; client: string; project: string; managerMembershipId: string | null }>(
      `SELECT change.id, change.project_id AS "projectId", change.case_id AS "caseId", change.number, change.title, trim(change.currency) AS currency,
              change.price_impact::text AS "priceImpact", change.time_impact_days AS "timeImpactDays", change.sent_at AS "sentAt", opportunity.party_id AS "partyId",
              coalesce(party.display_name, opportunity.title, '') AS client, project.reference || ' · ' || project.name AS project,
              (SELECT assignment.membership_id FROM project_assignments assignment
                 JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
                WHERE assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id AND assignment.active AND assignment.is_manager
                ORDER BY assignment.membership_id LIMIT 1) AS "managerMembershipId"
         FROM change_requests change
         JOIN delivery_projects project ON project.workspace_id = change.workspace_id AND project.id = change.project_id AND project.status IN ('active', 'on_hold')
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = change.workspace_id AND pre_case.id = change.case_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE change.workspace_id = $1 AND change.status = 'with_client' AND change.sent_at IS NOT NULL
          AND change.sent_at <= $2::timestamptz AND change.sent_at >= $2::timestamptz - interval '90 days'
        ORDER BY change.sent_at DESC, change.id LIMIT $3`, [workspaceId, now, limit])).rows;
    return rows.map((row): DueItem => {
      const reference = changeReference(row.number);
      return {
        key: changeKey(row.id), sourceType: "change_request", sourceId: row.id, jobSource: { type: "project", id: row.projectId },
        projectId: row.projectId, caseId: row.caseId, partyId: row.partyId, ownerMembershipId: row.managerMembershipId, ccMembershipIds: [],
        dueAt: new Date(row.sentAt), title: `${reference} · ${row.title}`, context: row.client, href: projectLink(row.projectId, row.id),
        // The client reads their project where the team reads the client's name.
        variables: { client: row.client, clientContext: row.project, reference, impact: impactLine(row.priceImpact, row.timeImpactDays, row.currency) },
      };
    });
  },
  async stillOpen(db, workspaceId, keys) {
    const ids = changeIds(keys);
    if (!ids.length) return new Set<string>();
    const open = (await db.query<{ id: string }>(
      `SELECT change.id FROM change_requests change
         JOIN delivery_projects project ON project.workspace_id = change.workspace_id AND project.id = change.project_id AND project.status IN ('active', 'on_hold')
        WHERE change.workspace_id = $1 AND change.id = ANY($2::uuid[]) AND change.status = 'with_client'`, [workspaceId, ids])).rows;
    return new Set(open.map((row) => changeKey(row.id)));
  },
  deliverClient(db: Db, workspaceId, delivery) {
    return deliverClientDefault(db, workspaceId, { ...delivery, variables: { ...delivery.variables, context: delivery.variables.clientContext ?? "" } },
      { whatsappEvent: "portal.decision_waiting", section: "decisions", approversOnly: true });
  },
};

/** Registers the change-request decision with the reminder engine when the module starts (one reminder system). */
@Injectable()
export class ChangeRequestReminders implements OnModuleInit {
  constructor(private readonly reminders: ReminderSourceRegistryService) {}
  onModuleInit() { this.reminders.register(changeDecisionReminderSource); }
}
