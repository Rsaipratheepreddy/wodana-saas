import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../purchasing/orders";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { moneyAccess, projectViewer } from "./project-access";
import { projectBalance, readMilestones } from "./project-milestones";
import { readBudgets, readProjectCommitted, readProjectCosts, readProjectIncome } from "./project-money";
import { deliveryHealth } from "./project-health";
import { readSignals } from "./project-signals";

type Db = PoolClient;

/** What the Overview's recent activity shows: the steps people act on, never every field change. */
const ACTIVITY = [
  "project.started", "project.complete_stage", "project.skip_stage", "project.reopen_stage", "project.hold", "project.resume", "project.cancel", "project.completed",
  "project.reopen", "project.post_update", "project.set_member", "project.send_materials", "project.record_materials_decision", "project.apply_variation",
  "project.approve_client_update", "client_portal.materials_decision", "client_portal.handover_decision", "client_portal.warranty_claim", "client_portal.issue",
  "work.create", "work.update", "work.plan_package", "work.start_sprint", "work.close_sprint", "site.submit", "site.approve", "site.return",
  "handover.issue", "handover.accept", "handover.refuse", "warranty.record_claim", "warranty.decide_claim",
];

export type ActivityRow = { id: string; at: string; action: string; source: string; actor: string; subject: string; detail: Record<string, unknown> };

/**
 * A project's Overview, read on the server: what holds it up (each blocker counted from its record and linked
 * to its filtered list), the plan per stage, the key dates, the money at a glance for the people who see it,
 * and the recent activity. Nothing here changes anything.
 */
@Injectable()
export class ProjectOverviewService {
  constructor(private readonly access: WorkspaceAccessService) {}

  overview(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await projectViewer(client, this.access, workspaceId, projectId, user.userId);
      const rights = await moneyAccess(client, this.access, workspaceId, user.userId, viewer);
      const signals = await readSignals(client, workspaceId, viewer.project);
      const blockers = [...signals.blockers];
      let money: null | { currency: string; agreed: string; invoiced: string; received: string; due: string; toInvoice: number; next: { title: string; amount: string; dueDate: string | null; state: string } | null;
        spent: string | null; committed: string | null; available: string | null; costCurrency: string | null; budget?: string | null } = null;
      if (rights.client) {
        const income = await readProjectIncome(client, workspaceId, viewer.project);
        const balance = await projectBalance(client, workspaceId, viewer.project);
        const { milestones } = await readMilestones(client, workspaceId, viewer.project);
        const next = milestones.find((milestone) => milestone.state !== "verified") ?? null;
        money = { currency: balance.currency, agreed: balance.agreed, invoiced: Dec.of(income.invoiced).toFixed(currencyDecimals(balance.currency)), received: balance.received, due: balance.due, toInvoice: balance.toInvoice.length,
          next: next ? { title: next.title, amount: next.amount, dueDate: next.dueDate, state: next.state } : null, spent: null, committed: null, available: null, costCurrency: null };
        if (rights.costs) {
          const costs = await readProjectCosts(client, workspaceId, projectId);
          const committed = await readProjectCommitted(client, workspaceId, projectId);
          // The cost budget, when the packages have one (the sum of every budget set on the project).
          const budgets = await readBudgets(client, workspaceId, projectId);
          const budget = budgets.length ? budgets.reduce((sum, item) => sum.add(item.amount), Dec.ZERO).toFixed(4) : null;
          money = { ...money, spent: costs.total, committed: committed.total, costCurrency: costs.currency, budget };
          if (costs.currency === income.currency) {
            const available = Dec.of(income.received).sub(costs.total).sub(committed.total);
            money.available = available.toFixed(4);
            // Spending beyond what the client has paid: money is short for the work in hand.
            if (available.cmp(0) < 0) blockers.push({ key: "funds_short", count: 1, items: [`${costs.currency} ${available.neg().toFixed(currencyDecimals(costs.currency))}`], href: `/workspace/projects/${projectId}/money` });
          }
        }
      }
      const site = (await client.query<{ started: string | null; finished: string | null }>(
        `SELECT site_started_on::text AS started, site_finished_on::text AS finished FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0];
      // Where the work is: the project's check-in site, else the property on the opportunity it came from.
      const place = (await client.query<{ address: string | null; latitude: number | null; longitude: number | null }>(
        `SELECT address, latitude, longitude FROM (
           SELECT 1 AS rank, nullif(location.address, '') AS address, location.latitude, location.longitude FROM work_locations location
            WHERE location.workspace_id = $1 AND location.project_id = $2 AND location.kind = 'site' AND location.active
           UNION ALL
           SELECT 2, discovery.property_location, discovery.latitude::float8, discovery.longitude::float8 FROM delivery_projects project
             JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
             JOIN crm_opportunity_discovery discovery ON discovery.workspace_id = pre_case.workspace_id AND discovery.opportunity_id = pre_case.opportunity_id
            WHERE project.workspace_id = $1 AND project.id = $2) places
         WHERE address IS NOT NULL OR latitude IS NOT NULL ORDER BY rank LIMIT 1`, [workspaceId, projectId])).rows[0] ?? null;
      // Who to call: the client and the sales person on the opportunity the project came from.
      const people = (await client.query<{ clientPhone: string | null; clientEmail: string | null; salesName: string | null; salesEmail: string | null }>(
        `SELECT (SELECT point.raw_value FROM crm_contact_points point WHERE point.workspace_id = party.workspace_id AND point.party_id = party.id AND point.type = 'phone' AND point.status = 'active'
                  ORDER BY point.is_primary DESC, point.created_at LIMIT 1) AS "clientPhone",
                (SELECT point.raw_value FROM crm_contact_points point WHERE point.workspace_id = party.workspace_id AND point.party_id = party.id AND point.type = 'email' AND point.status = 'active'
                  ORDER BY point.is_primary DESC, point.created_at LIMIT 1) AS "clientEmail",
                seller.display_name AS "salesName", seller.primary_email AS "salesEmail"
           FROM delivery_projects project
           JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
           JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
           JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
           LEFT JOIN workspace_memberships seat ON seat.workspace_id = opportunity.workspace_id AND seat.id = opportunity.owner_membership_id
           LEFT JOIN users seller ON seller.id = seat.user_id
          WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0];
      // The crew on site in the latest report sent for review, by trade.
      const crew = (await client.query<{ date: string; trade: string; people: number }>(
        `SELECT report.report_date::text AS date, workforce.trade, workforce.people::int AS people
           FROM site_report_workforce workforce
           JOIN site_reports report ON report.workspace_id = workforce.workspace_id AND report.id = workforce.report_id
          WHERE report.workspace_id = $1 AND report.project_id = $2
            AND report.report_date = (SELECT max(latest.report_date) FROM site_reports latest WHERE latest.workspace_id = $1 AND latest.project_id = $2 AND latest.status IN ('submitted', 'approved'))
            AND report.status IN ('submitted', 'approved')
          ORDER BY workforce.people DESC, workforce.trade`, [workspaceId, projectId])).rows;
      // The latest site reports: what happened on site, in the supervisor's words.
      const reports = (await client.query<{ id: string; date: string; status: string; byName: string; text: string }>(
        `SELECT report.id, report.report_date::text AS date, report.status, author.display_name AS "byName",
                coalesce(nullif(btrim(report.notes), ''), nullif(btrim(report.client_summary), ''), nullif(btrim(report.no_work_reason), ''), '') AS text
           FROM site_reports report JOIN users author ON author.id = report.author_id
          WHERE report.workspace_id = $1 AND report.project_id = $2 AND report.status IN ('submitted', 'approved')
          ORDER BY report.report_date DESC, report.created_at DESC LIMIT 3`, [workspaceId, projectId])).rows;
      const health = deliveryHealth({ stated: viewer.project.health, status: viewer.project.status, today: signals.today, promise: viewer.project.promiseDate,
        planEnd: signals.planEnd, lateWork: signals.work.late, lateOrders: signals.lateOrders.length, criticalSnags: signals.work.criticalSnags });
      return {
        health,
        contacts: { client: { phone: people?.clientPhone ?? null, email: people?.clientEmail ?? null }, sales: people?.salesName ? { name: people.salesName, email: people.salesEmail } : null },
        workforce: crew.length ? { date: crew[0].date, people: crew.reduce((sum, row) => sum + row.people, 0), trades: crew.map(({ trade, people }) => ({ trade, people })) } : null,
        siteReports: reports,
        site: place,
        today: signals.today, work: signals.work, blockers, decisions: signals.decisions, stagePlan: signals.stagePlan,
        dates: { start: viewer.project.startDate, promise: viewer.project.promiseDate, planEnd: signals.planEnd, siteStarted: site?.started ?? null, siteFinished: site?.finished ?? null },
        money, activity: await readProjectActivity(client, workspaceId, projectId),
      };
    });
  }

  /** The project's payment milestones with invoice and receipt, for Money → Client; the deal's revision rides along for the receipt commands. */
  milestones(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await projectViewer(client, this.access, workspaceId, projectId, user.userId);
      const rights = await moneyAccess(client, this.access, workspaceId, user.userId, viewer);
      if (!rights.client) return { milestones: [], caseRevision: null, caseId: viewer.project.caseId, currency: viewer.project.currency, canReport: false, canVerify: false, visible: false };
      const { milestones, caseRevision } = await readMilestones(client, workspaceId, viewer.project);
      const open = ["active", "on_hold", "completed"].includes(viewer.project.status);
      return {
        milestones, caseRevision, caseId: viewer.project.caseId, currency: viewer.project.currency, visible: true,
        canReport: open && await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.edit"),
        canVerify: open && await this.access.hasPermission(client, workspaceId, user.userId, "commercial.finance.verify"),
      };
    });
  }
}

/** The latest steps on a project and its work, with who took them and what they concerned. */
export async function readProjectActivity(client: Db, workspaceId: string, projectId: string): Promise<ActivityRow[]> {
  return (await client.query<ActivityRow>(
    `SELECT event.id, event.occurred_at AS at, event.action, event.source, coalesce(actor.display_name, '') AS actor,
            coalesce(CASE WHEN event.entity_type = 'work_item' THEN '#' || item.number || ' ' || item.title END, stage.name, report.report_date::text,
                     pack.title || ' (R' || pack.revision || ')', named.display_name, event.after->>'note', event.after->>'label', '') AS subject,
            jsonb_strip_nulls(jsonb_build_object('health', event.after->>'health', 'role', event.after->>'role', 'decision', event.after->>'decision', 'status', event.after->>'status',
              'number', event.after->>'number', 'label', event.after->>'label', 'revision', event.after->>'revision')) AS detail
       FROM audit_events event
       LEFT JOIN users actor ON actor.id = event.actor_user_id
       LEFT JOIN work_items item ON event.entity_type = 'work_item' AND item.workspace_id = event.workspace_id AND item.id = event.entity_id
       LEFT JOIN project_stages stage ON stage.workspace_id = event.workspace_id AND stage.project_id = $2 AND stage.key = event.after->>'stage'
       LEFT JOIN site_reports report ON report.workspace_id = event.workspace_id AND report.id::text = event.after->>'reportId'
       LEFT JOIN handover_packs pack ON pack.workspace_id = event.workspace_id AND pack.id::text = event.after->>'packId'
       LEFT JOIN workspace_memberships member ON event.action = 'project.set_member' AND member.workspace_id = event.workspace_id AND member.id::text = event.after->>'to'
       LEFT JOIN users named ON named.id = member.user_id
      WHERE event.workspace_id = $1
        AND ((event.entity_type = 'project' AND event.entity_id = $2)
             OR (event.entity_type = 'work_item' AND event.entity_id IN (SELECT id FROM work_items WHERE workspace_id = $1 AND project_id = $2)))
        AND event.action = ANY($3::text[])
        AND (event.action <> 'work.update' OR event.after->>'status' = 'done')
      ORDER BY event.occurred_at DESC LIMIT 12`, [workspaceId, projectId, ACTIVITY])).rows;
}
