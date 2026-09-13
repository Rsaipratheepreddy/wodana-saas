import { Injectable } from "@nestjs/common";
import { RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";

@Injectable()
export class CrmTodayService {
  constructor(private readonly access: WorkspaceAccessService) {}

  get(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client, actorUser) => {
      const membership = await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, actorUser.userId]);
      const membershipId = membership.rows[0]?.id;
      const [canReadMessages, canReadActivities, canReadOpportunities] = await Promise.all(["crm.communications.view", "crm.activities.view", "crm.opportunities.view"].map((permission) => this.access.hasPermission(client, workspaceId, actorUser.userId, permission)));
      const workspace = await client.query(`SELECT default_timezone FROM workspaces WHERE id = $1`, [workspaceId]);
      const timezone = workspace.rows[0]?.default_timezone ?? "UTC";
      const canReadCustomers = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.parties.view");
      const summary = await client.query(`SELECT
        (SELECT count(*)::int FROM crm_leads WHERE workspace_id=$1 AND status IN ('new','attempting_contact','connected','nurturing','paused')) AS "activeLeads",
        (SELECT count(*)::int FROM crm_leads WHERE workspace_id=$1 AND owner_membership_id IS NULL AND status IN ('new','attempting_contact','connected','nurturing','paused')) AS "unassignedLeads",
        CASE WHEN $2::boolean THEN (SELECT count(*)::int FROM crm_opportunities WHERE workspace_id=$1 AND status='open') ELSE NULL END AS "openOpportunities",
        CASE WHEN $3::boolean THEN (SELECT count(*)::int FROM crm_parties WHERE workspace_id=$1 AND lifecycle='customer' AND status='active') ELSE NULL END AS customers,
        CASE WHEN $4::boolean THEN (SELECT count(*)::int FROM crm_activities WHERE workspace_id=$1 AND status='pending' AND due_at IS NOT NULL AND type <> 'note') ELSE NULL END AS "pendingFollowUps",
        CASE WHEN $2::boolean THEN (SELECT count(*)::int FROM crm_opportunities WHERE workspace_id=$1 AND status='won' AND closed_at >= ((date_trunc('month', now() AT TIME ZONE $5) AT TIME ZONE $5))) ELSE NULL END AS "wonThisMonth"`, [workspaceId, canReadOpportunities, canReadCustomers, canReadActivities, timezone]);
      const monthlyLeadSources = await client.query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', now() AT TIME ZONE $2) - interval '5 months',
             date_trunc('month', now() AT TIME ZONE $2),
             interval '1 month'
           ) AS month_start
         ), sources AS (
           SELECT DISTINCT COALESCE(NULLIF(lower(source::text), ''), 'other') AS source
           FROM crm_enquiries
           WHERE workspace_id = $1
             AND created_at >= ((date_trunc('month', now() AT TIME ZONE $2) - interval '5 months') AT TIME ZONE $2)
         )
         SELECT to_char(month.month_start, 'YYYY-MM') AS "monthKey",
                to_char(month.month_start, 'Mon') AS "monthLabel",
                source.source,
                count(enquiry.id)::int AS count
         FROM months month
         CROSS JOIN sources source
         LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = $1
           AND COALESCE(NULLIF(lower(enquiry.source::text), ''), 'other') = source.source
           AND (enquiry.created_at AT TIME ZONE $2) >= month.month_start
           AND (enquiry.created_at AT TIME ZONE $2) < month.month_start + interval '1 month'
         GROUP BY month.month_start, source.source
         ORDER BY month.month_start, source.source`,
        [workspaceId, timezone],
      );
      const leadPipeline = await client.query(
        `SELECT lead.id, lead.status, lead.priority, lead.next_action_at AS "nextActionAt",
                party.display_name AS "partyName", enquiry.title, enquiry.source,
                account.display_name AS "ownerName"
         FROM crm_leads lead
         JOIN crm_parties party ON party.id = lead.party_id AND party.workspace_id = lead.workspace_id
         JOIN crm_enquiries enquiry ON enquiry.id = lead.enquiry_id AND enquiry.workspace_id = lead.workspace_id
         LEFT JOIN workspace_memberships membership ON membership.id = lead.owner_membership_id AND membership.workspace_id = lead.workspace_id
         LEFT JOIN users account ON account.id = membership.user_id
         WHERE lead.workspace_id = $1
         ORDER BY lead.next_action_at NULLS LAST, lead.updated_at DESC, lead.id
         LIMIT 80`,
        [workspaceId],
      );
      const result = await client.query(
        `WITH items AS (
           SELECT 1 AS priority, 'customer_reply' AS kind, conversation.id AS "recordId",
                  party.display_name AS title, 'Customer reply requires action' AS reason,
                  conversation.last_message_at AS "dueAt", '/crm/conversations/' || conversation.id AS "deepLink",
                  conversation.party_id AS "partyId", conversation.lead_id AS "leadId", NULL::uuid AS "opportunityId"
           FROM crm_conversations conversation
           JOIN crm_parties party ON party.id = conversation.party_id AND party.workspace_id = conversation.workspace_id
           WHERE $3::boolean AND conversation.workspace_id = $1 AND conversation.status = 'open'
             AND conversation.last_inbound_at IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM crm_messages outbound
               WHERE outbound.workspace_id = conversation.workspace_id
                 AND outbound.conversation_id = conversation.id
                 AND outbound.direction = 'outbound'
                 AND outbound.status IN ('sent','delivered','read')
                 AND outbound.created_at >= conversation.last_inbound_at
             )
             AND ($2::uuid IS NULL OR conversation.owner_membership_id = $2 OR conversation.owner_membership_id IS NULL)
           UNION ALL
           SELECT 2, 'sla_breach', sla.id, party.display_name,
                  'Response SLA breached', sla.due_at, '/crm/leads/' || lead.id,
                  lead.party_id, lead.id, NULL::uuid
           FROM crm_sla_instances sla
           JOIN crm_leads lead ON lead.id = sla.lead_id AND lead.workspace_id = sla.workspace_id
           JOIN crm_parties party ON party.id = lead.party_id AND party.workspace_id = lead.workspace_id
           WHERE sla.workspace_id = $1 AND sla.status = 'breached' AND ($2::uuid IS NULL OR lead.owner_membership_id = $2)
           UNION ALL
           SELECT 3, 'overdue_activity', activity.id, activity.title,
                  'Commitment is overdue', activity.due_at, '/crm/activities/' || activity.id,
                  activity.party_id, activity.lead_id, activity.opportunity_id
           FROM crm_activities activity
           WHERE $4::boolean AND activity.workspace_id = $1 AND activity.status = 'pending' AND activity.due_at < now()
             AND ($2::uuid IS NULL OR activity.owner_membership_id = $2 OR activity.owner_membership_id IS NULL)
           UNION ALL
           SELECT 4, 'due_today', activity.id, activity.title,
                  'Activity is due today', activity.due_at, '/crm/activities/' || activity.id,
                  activity.party_id, activity.lead_id, activity.opportunity_id
           FROM crm_activities activity
           WHERE $4::boolean AND activity.workspace_id = $1 AND activity.status = 'pending'
             AND activity.due_at >= now() AND activity.due_at < ((date_trunc('day', now() AT TIME ZONE $6) + interval '1 day') AT TIME ZONE $6)
             AND ($2::uuid IS NULL OR activity.owner_membership_id = $2 OR activity.owner_membership_id IS NULL)
           UNION ALL
           SELECT 5, 'upcoming_activity', activity.id, activity.title,
                  'Follow-up is coming up', activity.due_at, '/crm/activities/' || activity.id,
                  activity.party_id, activity.lead_id, activity.opportunity_id
           FROM crm_activities activity
           WHERE $4::boolean AND activity.workspace_id = $1 AND activity.status = 'pending'
             AND activity.type <> 'note'
             AND activity.due_at >= ((date_trunc('day', now() AT TIME ZONE $6) + interval '1 day') AT TIME ZONE $6)
             AND activity.due_at < ((date_trunc('day', now() AT TIME ZONE $6) + interval '8 days') AT TIME ZONE $6)
             AND NOT EXISTS (SELECT 1 FROM crm_appointments appointment WHERE appointment.workspace_id = activity.workspace_id AND appointment.activity_id = activity.id)
             AND ($2::uuid IS NULL OR activity.owner_membership_id = $2 OR activity.owner_membership_id IS NULL)
           UNION ALL
           SELECT 6, 'meeting_preparation', activity.id, activity.title,
                  'Upcoming meeting', appointment.starts_at, '/crm/activities/' || activity.id,
                  activity.party_id, activity.lead_id, activity.opportunity_id
           FROM crm_appointments appointment JOIN crm_activities activity ON activity.id = appointment.activity_id AND activity.workspace_id = appointment.workspace_id
           WHERE $4::boolean AND appointment.workspace_id = $1 AND appointment.attendance_status = 'scheduled' AND activity.status = 'pending'
             AND appointment.starts_at BETWEEN now() AND now() + interval '24 hours'
             AND ($2::uuid IS NULL OR activity.owner_membership_id = $2 OR activity.owner_membership_id IS NULL)
           UNION ALL
           SELECT 7, 'stale_lead', lead.id, party.display_name,
                  'No activity for 7 days', lead.updated_at + interval '7 days', '/crm/leads/' || lead.id,
                  lead.party_id, lead.id, NULL::uuid
           FROM crm_leads lead JOIN crm_parties party ON party.id = lead.party_id AND party.workspace_id = lead.workspace_id
           WHERE lead.workspace_id = $1 AND lead.status IN ('new','attempting_contact','connected','nurturing','paused')
             AND lead.updated_at < now() - interval '7 days' AND ($2::uuid IS NULL OR lead.owner_membership_id = $2 OR lead.owner_membership_id IS NULL)
           UNION ALL
           SELECT 7, 'stale_opportunity', opportunity.id, opportunity.title,
                  'No activity for 14 days', opportunity.updated_at + interval '14 days', '/crm/opportunities/' || opportunity.id,
                  opportunity.party_id, NULL::uuid, opportunity.id
           FROM crm_opportunities opportunity
           WHERE $5::boolean AND opportunity.workspace_id = $1 AND opportunity.status = 'open'
             AND opportunity.updated_at < now() - interval '14 days' AND ($2::uuid IS NULL OR opportunity.owner_membership_id = $2 OR opportunity.owner_membership_id IS NULL)
         ), queue AS (
           SELECT *, count(*) OVER()::int AS "queueTotal" FROM items
           ORDER BY priority, "dueAt" NULLS LAST, "recordId" LIMIT 200
         )
         SELECT queue.*, party.id AS "resolvedPartyId", party.display_name AS "partyName",
                party.lifecycle AS "partyLifecycle"
         FROM queue
         LEFT JOIN crm_leads lead ON lead.id = queue."leadId" AND lead.workspace_id = $1
         LEFT JOIN crm_opportunities opportunity ON opportunity.id = queue."opportunityId" AND opportunity.workspace_id = $1
         LEFT JOIN crm_parties party ON party.id = COALESCE(queue."partyId", lead.party_id, opportunity.party_id)
           AND party.workspace_id = $1
         ORDER BY queue.priority, queue."dueAt" NULLS LAST, queue."recordId"`,
        [workspaceId, membershipId ?? null, canReadMessages, canReadActivities, canReadOpportunities, timezone],
      );
      const counts = result.rows.reduce<Record<string, number>>((total, item) => {
        const kind = String(item.kind);
        total[kind] = (total[kind] ?? 0) + 1;
        return total;
      }, {});
      return {
        generatedAt: new Date().toISOString(),
        total: result.rows[0]?.queueTotal ?? 0,
        counts,
        summary: summary.rows[0],
        monthlyLeadSources: monthlyLeadSources.rows,
        leadPipeline: leadPipeline.rows,
        items: result.rows.map((item) => ({ ...item, canViewParty: canReadCustomers })),
      };
    });
  }
}
