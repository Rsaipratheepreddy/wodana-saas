import { BadRequestException, Injectable } from "@nestjs/common";
import { RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { ReportRangeQueryDto } from "./dto/reporting.dto";
import { loadLeadOptions } from "../leads/lead-options";

const WALK_IN = /walk[\s_-]?in/i;
/** S-28: an enquiry closed because the client never answered: its own bucket, apart from "not interested". */
const UNREACHABLE = `lead.status='disqualified' AND EXISTS (SELECT 1 FROM crm_activities attempt WHERE attempt.workspace_id=lead.workspace_id AND attempt.lead_id=lead.id
  AND attempt.status='completed' AND attempt.completion_outcome='unreachable')`;

/** "source/channel" for every channel the taxonomy calls a walk-in, by its code or its label ("Showroom Walk-in"). */
export function walkInChannelsOf(options: { channels: Record<string, Array<{ id: string; label: string }>> }) {
  return Object.entries(options.channels).flatMap(([source, channels]) =>
    channels.filter((channel) => WALK_IN.test(channel.id) || WALK_IN.test(channel.label)).map((channel) => `${source}/${channel.id}`));
}

@Injectable()
export class CrmReportingService {
  constructor(private readonly access: WorkspaceAccessService) {}

  report(actor: RequestActor, workspaceId: string, report: string, query: ReportRangeQueryDto) {
    const permissions = ["crm.reports.view"];
    if (report === "pipeline" || report === "forecast") permissions.push("crm.opportunities.sensitive_values");
    return this.access.withPermissions(actor, workspaceId, permissions, async (client) => {
      const { from, to } = this.range(query);
      if (report === "lead-flow") {
        const dimensions: Record<string, string> = {
          mainSource: "enquiry.source", channel: "enquiry.channel",
          source: "enquiry.source || ' / ' || enquiry.channel", enquiryType: "enquiry.service_type",
          customerType: "enquiry.details->>'customerType'", budget: "enquiry.details->>'budgetRange'",
          emirate: "enquiry.details->>'emirate'",
          area: "COALESCE(NULLIF(enquiry.details->>'area',''), enquiry.details->>'location')",
          owner: "account.display_name", team: "queue.name", intake: "intake.intake_method",
          freshness: `CASE
            WHEN lead.status IN ('qualified','disqualified') THEN 'closed'
            WHEN greatest(lead.updated_at,enquiry.updated_at) < now()-interval '7 days' THEN 'stale'
            ELSE 'current' END`,
          day: "to_char(date_trunc('day', lead.created_at AT TIME ZONE workspace.default_timezone), 'YYYY-MM-DD')",
          week: "to_char(date_trunc('week', lead.created_at AT TIME ZONE workspace.default_timezone), 'YYYY-MM-DD')",
          month: "to_char(date_trunc('month', lead.created_at AT TIME ZONE workspace.default_timezone), 'YYYY-MM')",
        };
        // One of the workspace's own dropdown fields: group by its stored answer (lists by their joined text).
        const customField = query.groupBy?.startsWith("cf:") ? query.groupBy.slice(3) : null;
        if (customField) {
          const field = await client.query(`SELECT 1 FROM crm_custom_field_definitions WHERE workspace_id=$1 AND id=$2 AND entity_type='enquiry' AND status='active' AND data_type IN ('select','multi_select','text')`, [workspaceId, customField]);
          if (!field.rowCount) throw new BadRequestException("Invalid report grouping");
          dimensions[query.groupBy!] = `(SELECT COALESCE(value.value_text, (SELECT string_agg(item, ', ') FROM jsonb_array_elements_text(value.value_json) item)) FROM crm_custom_field_values value
            WHERE value.workspace_id=lead.workspace_id AND value.entity_type='enquiry' AND value.entity_id=enquiry.id AND value.definition_id=$4::uuid)`;
        }
        const dimension = dimensions[query.groupBy ?? "source"];
        if (!dimension) throw new BadRequestException("Invalid report grouping");
        const groupId = query.groupBy === "owner" ? "lead.owner_membership_id::text" : query.groupBy === "team" ? "lead.queue_id::text" : dimension;
        const grouped = await client.query(`SELECT COALESCE(${groupId}, 'not_set') AS id, COALESCE(NULLIF(${dimension}, ''), 'Not set') AS label,
          count(*)::int AS leads,
          count(*) FILTER (WHERE lead.owner_membership_id IS NULL)::int AS unassigned,
          count(*) FILTER (WHERE lead.status='qualified')::int AS qualified,
          count(*) FILTER (WHERE lead.status='disqualified')::int AS disqualified,
          count(*) FILTER (WHERE ${UNREACHABLE})::int AS unreachable,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM crm_opportunities opportunity WHERE opportunity.workspace_id=lead.workspace_id AND opportunity.lead_id=lead.id AND opportunity.status='won'))::int AS won,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM crm_opportunities opportunity WHERE opportunity.workspace_id=lead.workspace_id AND opportunity.lead_id=lead.id AND opportunity.status='lost'))::int AS lost,
          count(*) FILTER (WHERE lead.status NOT IN ('qualified','disqualified') AND greatest(lead.updated_at,enquiry.updated_at) < now()-interval '7 days')::int AS stale,
          round(avg(extract(epoch FROM now()-greatest(lead.updated_at,enquiry.updated_at))/86400)::numeric,1) AS "averageDaysSinceUpdate",
          round(100.0*count(*) FILTER (WHERE lead.status='qualified')/NULLIF(count(*),0),1) AS "qualificationRate"
          FROM crm_leads lead JOIN crm_enquiries enquiry ON enquiry.id=lead.enquiry_id AND enquiry.workspace_id=lead.workspace_id
          JOIN crm_intake_events intake ON intake.id=enquiry.intake_event_id AND intake.workspace_id=lead.workspace_id
          JOIN workspaces workspace ON workspace.id=lead.workspace_id
          LEFT JOIN workspace_memberships membership ON membership.id=lead.owner_membership_id AND membership.workspace_id=lead.workspace_id
          LEFT JOIN users account ON account.id=membership.user_id
          LEFT JOIN crm_queues queue ON queue.id=lead.queue_id AND queue.workspace_id=lead.workspace_id
          WHERE lead.workspace_id=$1 AND lead.created_at >= $2 AND lead.created_at < $3
          GROUP BY ${dimension}, ${groupId} ORDER BY label`, customField ? [workspaceId, from, to, customField] : [workspaceId, from, to]);
        const processing = await client.query(`SELECT status,count(*)::int AS count FROM crm_intake_events
          WHERE workspace_id=$1 AND received_at >= $2 AND received_at < $3 GROUP BY status`, [workspaceId, from, to]);
        const summary = await client.query(`SELECT count(*)::int AS leads,
          count(*) FILTER (WHERE lead.owner_membership_id IS NULL)::int AS unassigned,
          count(*) FILTER (WHERE lead.status='qualified')::int AS qualified,
          count(*) FILTER (WHERE lead.status='disqualified')::int AS disqualified,
          count(*) FILTER (WHERE ${UNREACHABLE})::int AS unreachable,
          count(*) FILTER (WHERE lead.status NOT IN ('qualified','disqualified') AND greatest(lead.updated_at,enquiry.updated_at) < now()-interval '7 days')::int AS stale
          FROM crm_leads lead JOIN crm_enquiries enquiry ON enquiry.id=lead.enquiry_id AND enquiry.workspace_id=lead.workspace_id
          WHERE lead.workspace_id=$1 AND lead.created_at >= $2 AND lead.created_at < $3`, [workspaceId, from, to]);
        // S-14: walk-ins are whichever channels the workspace's own taxonomy names as walk-ins (a showroom and an
        // office walk-in, under any source), not one hard-coded source and channel.
        const walkInChannels = walkInChannelsOf(await loadLeadOptions(client, workspaceId));
        const walkIns = walkInChannels.length ? await client.query(`SELECT intake.intake_method AS "intakeMethod",count(*)::int AS count,
          count(lead.id)::int AS leads, count(lead.id) FILTER (WHERE lead.status='qualified')::int AS qualified,
          count(lead.id) FILTER (WHERE lead.status='disqualified')::int AS disqualified,
          count(*) FILTER (WHERE intake.status='duplicate_candidate')::int AS duplicates
          FROM crm_intake_events intake LEFT JOIN crm_enquiries enquiry ON enquiry.intake_event_id=intake.id AND enquiry.workspace_id=intake.workspace_id
          LEFT JOIN crm_leads lead ON lead.enquiry_id=enquiry.id AND lead.workspace_id=enquiry.workspace_id
          WHERE intake.workspace_id=$1 AND (intake.source || '/' || intake.channel) = ANY($4::text[]) AND intake.received_at >= $2 AND intake.received_at < $3
          GROUP BY intake.intake_method`, [workspaceId, from, to, walkInChannels]) : { rows: [] };
        const totals = summary.rows[0] ?? { leads: 0, unassigned: 0, qualified: 0, disqualified: 0, unreachable: 0, stale: 0 };
        const groupedLeads = grouped.rows.reduce((total, row) => total + Number(row.leads ?? 0), 0);
        return {
          report,
          from: from.toISOString(),
          to: to.toISOString(),
          groupBy: query.groupBy ?? "source",
          rows: grouped.rows,
          summary: totals,
          reconciliation: { totalLeads: Number(totals.leads ?? 0), groupedLeads, matches: groupedLeads === Number(totals.leads ?? 0) },
          processing: processing.rows,
          walkIns: walkIns.rows,
        };
      }
      if (report === "sla") {
        const withinTarget = `(instance.responded_at IS NOT NULL AND
          CASE
            WHEN instance.response_elapsed_minutes IS NOT NULL
              AND (instance.policy_snapshot->>'breachAfterMinutes') ~ '^[0-9]+$'
              THEN instance.response_elapsed_minutes < (instance.policy_snapshot->>'breachAfterMinutes')::int
            ELSE instance.responded_at < instance.due_at
          END)`;
        const effectiveBreach = `(instance.breached_at IS NOT NULL
          OR (instance.responded_at IS NOT NULL AND NOT ${withinTarget})
          OR (instance.responded_at IS NULL AND instance.status IN ('active','warning','breached') AND instance.due_at <= now()))`;
        const rows = await client.query(
          `SELECT instance.status,count(*)::int AS count,
             count(*) FILTER (WHERE instance.responded_at IS NOT NULL)::int AS responded,
             count(*) FILTER (WHERE ${withinTarget})::int AS "withinTarget",
             count(*) FILTER (WHERE ${effectiveBreach})::int AS breached,
             round((avg(instance.response_elapsed_minutes) FILTER (WHERE instance.responded_at IS NOT NULL))::numeric,2) AS "averageMinutes"
           FROM crm_sla_instances instance
           WHERE instance.workspace_id=$1 AND instance.started_at >= $2 AND instance.started_at < $3
           GROUP BY instance.status ORDER BY instance.status`,
          [workspaceId, from, to],
        );
        const summary = await client.query(
          `SELECT count(*)::int AS total,
             count(*) FILTER (WHERE instance.responded_at IS NOT NULL)::int AS responded,
             count(*) FILTER (WHERE ${withinTarget})::int AS "withinTarget",
             count(*) FILTER (WHERE ${effectiveBreach})::int AS breached,
             count(*) FILTER (WHERE instance.status IN ('active','warning','breached','paused'))::int AS open,
             count(*) FILTER (WHERE instance.status='paused')::int AS paused,
             count(*) FILTER (WHERE instance.status='stopped' AND instance.responded_at IS NULL)::int AS "noResponseStops",
             round(100.0*count(*) FILTER (WHERE ${withinTarget})
               / NULLIF(count(*) FILTER (WHERE instance.responded_at IS NOT NULL),0),1) AS "responseComplianceRate",
             round((avg(instance.response_elapsed_minutes) FILTER (WHERE instance.responded_at IS NOT NULL))::numeric,2) AS "averageResponseMinutes",
             round((percentile_cont(0.5) WITHIN GROUP (ORDER BY instance.response_elapsed_minutes)
               FILTER (WHERE instance.responded_at IS NOT NULL))::numeric,2) AS "medianResponseMinutes",
             round((percentile_cont(0.9) WITHIN GROUP (ORDER BY instance.response_elapsed_minutes)
               FILTER (WHERE instance.responded_at IS NOT NULL))::numeric,2) AS "p90ResponseMinutes"
           FROM crm_sla_instances instance
           WHERE instance.workspace_id=$1 AND instance.started_at >= $2 AND instance.started_at < $3`,
          [workspaceId, from, to],
        );
        const owners = await client.query(
          `SELECT instance.owner_membership_id AS "ownerMembershipId",
             COALESCE(account.display_name,'Unassigned') AS owner,
             instance.queue_id AS "queueId",COALESCE(queue.name,'No queue') AS queue,
             count(*)::int AS total,
             count(*) FILTER (WHERE instance.responded_at IS NOT NULL)::int AS responded,
             count(*) FILTER (WHERE ${withinTarget})::int AS "withinTarget",
             count(*) FILTER (WHERE ${effectiveBreach})::int AS breached,
             round((avg(instance.response_elapsed_minutes) FILTER (WHERE instance.responded_at IS NOT NULL))::numeric,2) AS "averageResponseMinutes"
           FROM crm_sla_instances instance
           LEFT JOIN workspace_memberships membership
             ON membership.workspace_id=instance.workspace_id AND membership.id=instance.owner_membership_id
           LEFT JOIN users account ON account.id=membership.user_id
           LEFT JOIN crm_queues queue ON queue.workspace_id=instance.workspace_id AND queue.id=instance.queue_id
           WHERE instance.workspace_id=$1 AND instance.started_at >= $2 AND instance.started_at < $3
           GROUP BY instance.owner_membership_id,account.display_name,instance.queue_id,queue.name
           ORDER BY breached DESC,total DESC,owner`,
          [workspaceId, from, to],
        );
        const total = Number(summary.rows[0]?.total ?? 0);
        const groupedTotal = rows.rows.reduce((count, row) => count + Number(row.count ?? 0), 0);
        return {
          report,
          from: from.toISOString(),
          to: to.toISOString(),
          rows: rows.rows,
          summary: summary.rows[0] ?? {},
          reconciliation: { total, groupedTotal, matches: total === groupedTotal },
          owners: owners.rows,
        };
      }
      const reports: Record<string, { sql: string; values: unknown[] }> = {
        funnel: { sql: `SELECT history.to_status AS status, COALESCE(stage.name, history.to_status::text) AS stage, count(*)::int AS count FROM crm_stage_history history LEFT JOIN crm_pipeline_stages stage ON stage.id = history.to_stage_id WHERE history.workspace_id = $1 AND history.changed_at >= $2 AND history.changed_at < $3 GROUP BY history.to_status, stage.name ORDER BY count DESC`, values: [workspaceId, from, to] },
        sources: { sql: `SELECT enquiry.source, enquiry.channel, count(DISTINCT enquiry.id)::int AS enquiries, count(DISTINCT lead.id)::int AS leads, count(DISTINCT opportunity.id)::int AS opportunities, count(DISTINCT opportunity.id) FILTER (WHERE opportunity.status = 'won')::int AS won FROM crm_enquiries enquiry LEFT JOIN crm_leads lead ON lead.enquiry_id = enquiry.id AND lead.workspace_id = enquiry.workspace_id LEFT JOIN crm_opportunities opportunity ON opportunity.lead_id = lead.id AND opportunity.workspace_id = lead.workspace_id WHERE enquiry.workspace_id = $1 AND enquiry.created_at >= $2 AND enquiry.created_at < $3 GROUP BY enquiry.source, enquiry.channel ORDER BY enquiries DESC`, values: [workspaceId, from, to] },
        assignment: { sql: `SELECT history.assignment_method AS method, account.display_name AS owner, count(*)::int AS count FROM crm_assignment_history history LEFT JOIN workspace_memberships membership ON membership.id = history.owner_membership_id LEFT JOIN users account ON account.id = membership.user_id WHERE history.workspace_id = $1 AND history.assigned_at >= $2 AND history.assigned_at < $3 GROUP BY history.assignment_method, account.display_name ORDER BY count DESC`, values: [workspaceId, from, to] },
        pipeline: { sql: `SELECT pipeline.name AS pipeline, stage.name AS stage, opportunity.status, count(*)::int AS count, opportunity.currency_code AS currency, sum(opportunity.amount) AS value FROM crm_opportunities opportunity JOIN crm_pipelines pipeline ON pipeline.id = opportunity.pipeline_id JOIN crm_pipeline_stages stage ON stage.id = opportunity.stage_id WHERE opportunity.workspace_id = $1 AND opportunity.created_at >= $2 AND opportunity.created_at < $3 GROUP BY pipeline.name, stage.name, stage.position, opportunity.status, opportunity.currency_code ORDER BY pipeline.name, stage.position`, values: [workspaceId, from, to] },
        forecast: { sql: `WITH latest AS (SELECT DISTINCT ON (opportunity_id) * FROM crm_forecast_snapshots WHERE workspace_id = $1 AND captured_at < $2 ORDER BY opportunity_id, captured_at DESC, id DESC) SELECT COALESCE(reporting_currency_code, currency_code) AS currency, status, count(*)::int AS count, sum(COALESCE(reporting_amount, amount)) AS amount, sum(COALESCE(reporting_amount, amount) * COALESCE(probability, 0) / 100) AS "weightedAmount" FROM latest GROUP BY COALESCE(reporting_currency_code, currency_code), status ORDER BY currency, status`, values: [workspaceId, to] },
      };
      const selected = reports[report];
      if (!selected) throw new BadRequestException("Unknown CRM report");
      const result = await client.query(selected.sql, selected.values);
      return { report, from: from.toISOString(), to: to.toISOString(), rows: result.rows };
    });
  }

  private range(query: ReportRangeQueryDto) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 90 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new BadRequestException("Invalid report range");
    return { from, to };
  }
}
