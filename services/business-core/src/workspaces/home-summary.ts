import { NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { readWaitingApprovals, type HomeApprovalAccess } from "./home-approvals";
import type { InboxViewer } from "../crm/conversations/inbox/inbox-visibility";

// Structural copy of HomeSummary in packages/contracts/src/home.ts (business-core does not depend on contracts).
export type HomeFocusSource =
  | "follow_up" | "response" | "unowned" | "confirm_client" | "reply" | "work" | "delivery" | "invoice" | "production"
  | "quote_review" | "receipt" | "order_approval" | "design_review" | "design_client" | "design_present" | "design_revise" | "petty_cash" | "leave";
export type HomeFocusItem = {
  id: string; source: HomeFocusSource; urgency: "overdue" | "today" | "waiting"; recordId: string;
  title: string; context: string; due: string | null; href: string; projectId?: string;
};
export type HomeUpcomingItem = {
  id: string; kind: "meeting" | "follow_up" | "work" | "delivery" | "payment" | "production";
  title: string; context: string; at: string; allDay: boolean; href: string;
};
export type HomeFunnelStage = { id: "enquiries" | "planning" | "quotes" | "projects" | "handover"; count: number; stuck: number; href: string };
export type HomeRecentRecord = { id: string; kind: "enquiry" | "case" | "project" | "order" | "work_order"; title: string; context: string; at: string; href: string };
export type HomeSummary = {
  generatedAt: string; timeZone: string; today: string;
  focus: { items: HomeFocusItem[]; total: number };
  upcoming: HomeUpcomingItem[]; horizonDays: 7 | 30;
  funnel: HomeFunnelStage[];
  recent: HomeRecentRecord[];
  projects: Array<{ id: string; name: string }>;
};

/** What the person may see, from their permissions (see WorkspacesService.homeSummary). */
export type HomeSummaryAccess = {
  /** crm.activities.view: their follow-ups and meetings. */
  followUps: boolean;
  /** crm.communications.view: client messages waiting for a reply. */
  replies: boolean;
  /** The inbox reach (plan §5b): only chats within it wait on the person. Without it, every chat counts. */
  inbox?: InboxViewer;
  /** crm.leads.view */
  leads: boolean;
  /** crm.leads.assign: every open enquiry nobody owns also waits on them. */
  assignLeads: boolean;
  /** pre_projects.view */
  planning: boolean;
  /** projects.view (the projects they are assigned to) */
  projects: boolean;
  /** projects.manage (every project) */
  manageProjects: boolean;
  /** receivables.view: client invoices due. */
  receivables: boolean;
  /** purchasing.view: supplier deliveries. */
  purchasing: boolean;
  /** factory.view: work orders due from the factory. */
  factory: boolean;
  approvals: HomeApprovalAccess;
};

type Db = Pick<PoolClient, "query">;
type Person = { workspaceId: string; membershipId: string; userId: string };
type Clock = { now: string; today: string; timeZone: string };
type Row = { recordId: string; linkId?: string | null; title: string | null; context: string | null; due: Date | string | null; urgency?: string; allDay?: boolean };

const FOCUS_LIMIT = 20;
const UPCOMING_LIMIT = 8;
const RECENT_LIMIT = 5;
const OPEN_LEADS = "('new','attempting_contact','connected','nurturing','paused')";
const segment = encodeURIComponent;
const text = (value: Date | string | null | undefined) => value === null || value === undefined ? null : value instanceof Date ? value.toISOString() : String(value);
/** The end of the workspace's local today, as an instant ($today date, $tz zone). */
const endOfToday = (today: string, tz: string) => `((${today}::date + 1)::timestamp AT TIME ZONE ${tz}::text)`;
/** Visible projects: all of them with projects.manage, else the ones the person is assigned to ($me membership, $all boolean). */
const visibleProject = (me: string, all: string) => `(${all}::boolean OR EXISTS (SELECT 1 FROM project_assignments assignment
  WHERE assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id AND assignment.membership_id = ${me} AND assignment.active))`;

/** A project the person leads (their assignment is the project manager's). */
const managedProject = (me: string) => `EXISTS (SELECT 1 FROM project_assignments seat WHERE seat.workspace_id = project.workspace_id
  AND seat.project_id = project.id AND seat.membership_id = ${me} AND seat.active AND seat.is_manager)`;

function validTimeZone(value: string | null | undefined) {
  const zone = value?.trim() || "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return zone; } catch { return "UTC"; }
}
const localDay = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/** Dated work from now to the horizon: meetings, follow-ups, work, deliveries, client payments and production. */
async function readUpcoming(db: Db, person: Person, clock: Clock, access: HomeSummaryAccess, days: number, team = false): Promise<HomeUpcomingItem[]> {
  const { workspaceId, membershipId } = person;
  const items: HomeUpcomingItem[] = [];
  const add = (kind: HomeUpcomingItem["kind"], rows: Row[], href: (row: Row) => string, allDay: boolean) =>
    items.push(...rows.map((row) => ({ id: `${kind}:${row.recordId}`, kind, title: row.title ?? "", context: row.context ?? "", at: text(row.due) ?? "", allDay, href: href(row) })));
  /** The end of the horizon's last local day ($today date, $days int, $tz zone). */
  const until = (today: string, daysParam: string, tz: string) => `((${today}::date + ${daysParam}::int)::timestamp AT TIME ZONE ${tz}::text)`;
  if (access.followUps) {
    add("meeting", (await db.query<Row>(
      `SELECT appointment.id::text AS "recordId", activity.id::text AS "linkId", activity.title, coalesce(party.display_name, '') AS context, appointment.starts_at AS due
         FROM crm_appointments appointment
         JOIN crm_activities activity ON activity.workspace_id = appointment.workspace_id AND activity.id = appointment.activity_id
         LEFT JOIN crm_leads lead ON lead.workspace_id = activity.workspace_id AND lead.id = activity.lead_id
         LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = activity.workspace_id AND opportunity.id = activity.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = activity.workspace_id AND party.id = coalesce(activity.party_id, lead.party_id, opportunity.party_id)
        WHERE appointment.workspace_id = $1 AND appointment.attendance_status = 'scheduled' AND activity.status = 'pending'
          AND (activity.owner_membership_id = $2::uuid OR appointment.attendee_membership_ids ? $2::uuid::text)
          AND appointment.starts_at >= $3::timestamptz AND appointment.starts_at < ${until("$4", "$6", "$5")}
        ORDER BY appointment.starts_at, appointment.id LIMIT ${UPCOMING_LIMIT}`,
      [workspaceId, membershipId, clock.now, clock.today, clock.timeZone, days])).rows, (row) => `/workspace/crm/follow-ups?record=${segment(row.linkId ?? "")}`, false);
    add("follow_up", (await db.query<Row>(
      `SELECT activity.id::text AS "recordId", activity.title, coalesce(party.display_name, '') AS context, activity.due_at AS due
         FROM crm_activities activity
         LEFT JOIN crm_leads lead ON lead.workspace_id = activity.workspace_id AND lead.id = activity.lead_id
         LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = activity.workspace_id AND opportunity.id = activity.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = activity.workspace_id AND party.id = coalesce(activity.party_id, lead.party_id, opportunity.party_id)
        WHERE activity.workspace_id = $1 AND activity.owner_membership_id = $2 AND activity.status = 'pending' AND activity.type <> 'note'
          AND activity.due_at >= ${endOfToday("$3", "$4")} AND activity.due_at < ${until("$3", "$5", "$4")}
          AND NOT EXISTS (SELECT 1 FROM crm_appointments appointment WHERE appointment.workspace_id = activity.workspace_id
            AND appointment.activity_id = activity.id AND appointment.attendance_status = 'scheduled')
        ORDER BY activity.due_at, activity.id LIMIT ${UPCOMING_LIMIT}`,
      [workspaceId, membershipId, clock.today, clock.timeZone, days])).rows, (row) => `/workspace/crm/follow-ups?record=${segment(row.recordId)}`, false);
  }
  if (access.projects) {
    // Their own work, the work on projects they manage and, when their week is quiet (`team`), what is due on their projects.
    add("work", (await db.query<Row & { linkId: string }>(
      `SELECT item.id::text AS "recordId", item.project_id::text AS "linkId", item.title,
              CASE WHEN item.assignee_membership_id = $2 THEN project.name ELSE concat_ws(' · ', project.name, person.display_name) END AS context,
              item.due_date::text AS due
         FROM work_items item
         JOIN delivery_projects project ON project.workspace_id = item.workspace_id AND project.id = item.project_id
         LEFT JOIN workspace_memberships member ON member.workspace_id = item.workspace_id AND member.id = item.assignee_membership_id
         LEFT JOIN users person ON person.id = member.user_id
        WHERE item.workspace_id = $1 AND item.status NOT IN ('done', 'cancelled')
          AND item.due_date > $3::date AND item.due_date <= $3::date + $4::int AND project.status IN ('active', 'on_hold')
          AND ${visibleProject("$2", "$5")}
          AND (item.assignee_membership_id = $2 OR ${managedProject("$2")} OR ($6::boolean AND ${visibleProject("$2", "false")}))
        ORDER BY item.due_date, item.number, item.id LIMIT ${UPCOMING_LIMIT}`,
      [workspaceId, membershipId, clock.today, days, access.manageProjects, team])).rows, (row) => `/workspace/projects/${segment(row.linkId ?? "")}/plan?item=${segment(row.recordId)}`, true);
  }
  if (access.purchasing) {
    add("delivery", (await db.query<Row>(
      `SELECT purchase.id::text AS "recordId", purchase.number AS title, coalesce(vendor.display_name, '') AS context,
              coalesce(purchase.promised_date, purchase.expected_date)::text AS due
         FROM purchase_orders purchase
         LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
        WHERE purchase.workspace_id = $1 AND purchase.status IN ('sent', 'confirmed', 'partly_received')
          AND coalesce(purchase.promised_date, purchase.expected_date) BETWEEN $2::date AND $2::date + $3::int
        ORDER BY due, purchase.id LIMIT ${UPCOMING_LIMIT}`,
      [workspaceId, clock.today, days])).rows, (row) => `/workspace/purchasing/orders?order=${segment(row.recordId)}`, true);
  }
  if (access.receivables) {
    add("payment", (await db.query<Row>(
      `SELECT invoice.id::text AS "recordId", coalesce(nullif(invoice.customer_name, ''), invoice.number) AS title, invoice.number AS context,
              invoice.due_date::text AS due
         FROM client_invoices invoice
         LEFT JOIN commercial_payments payment ON payment.workspace_id = invoice.workspace_id AND payment.case_id = invoice.case_id AND payment.id = invoice.payment_id
        WHERE invoice.workspace_id = $1 AND invoice.status = 'issued' AND coalesce(payment.status, '') <> 'verified'
          AND invoice.due_date BETWEEN $2::date AND $2::date + $3::int
        ORDER BY invoice.due_date, invoice.id LIMIT ${UPCOMING_LIMIT}`,
      [workspaceId, clock.today, days])).rows, (row) => `/workspace/finance/client-invoices?invoice=${segment(row.recordId)}`, true);
  }
  if (access.factory) {
    add("production", (await db.query<Row>(
      `SELECT work_order.id::text AS "recordId", work_order.title, coalesce(project.name, '') AS context, work_order.planned_end::text AS due
         FROM work_orders work_order
         LEFT JOIN delivery_projects project ON project.workspace_id = work_order.workspace_id AND project.id = work_order.project_id
        WHERE work_order.workspace_id = $1 AND work_order.status IN ('planned', 'released', 'in_production', 'on_hold')
          AND work_order.planned_end > $2::date AND work_order.planned_end <= $2::date + $3::int
        ORDER BY work_order.planned_end, work_order.number LIMIT ${UPCOMING_LIMIT}`,
      [workspaceId, clock.today, days])).rows, (row) => `/workspace/factory/orders?order=${segment(row.recordId)}`, true);
  }
  // Chronological on the workspace's calendar; on one day, all-day items come before timed ones.
  const key = (item: HomeUpcomingItem) => item.allDay ? `${item.at.slice(0, 10)} 0` : `${localDay(new Date(item.at), clock.timeZone)} 1 ${item.at}`;
  return items.sort((a, b) => key(a).localeCompare(key(b))).slice(0, UPCOMING_LIMIT);
}

/** The business flow the person can see, with counts that reconcile to each list they open. */
async function readFunnel(db: Db, person: Person, clock: Clock, access: HomeSummaryAccess): Promise<HomeFunnelStage[]> {
  const { workspaceId, membershipId } = person;
  const stages: HomeFunnelStage[] = [];
  if (access.leads) {
    // Stalled: untouched for a week, or its first-response time ran out.
    const row = (await db.query<{ count: number; stuck: number }>(
      `SELECT count(*)::int AS count,
              count(*) FILTER (WHERE lead.updated_at < $2::timestamptz - interval '7 days' OR EXISTS (
                SELECT 1 FROM crm_sla_instances sla WHERE sla.workspace_id = lead.workspace_id AND sla.lead_id = lead.id
                  AND (sla.status = 'breached' OR (sla.status = 'active' AND sla.due_at < $2::timestamptz))))::int AS stuck
         FROM crm_leads lead WHERE lead.workspace_id = $1 AND lead.status IN ${OPEN_LEADS}`,
      [workspaceId, clock.now])).rows[0];
    stages.push({ id: "enquiries", count: Number(row?.count ?? 0), stuck: Number(row?.stuck ?? 0), href: "/workspace/crm/leads" });
  }
  if (access.planning) {
    // An open case is in Quotes once a quotation is in review, with the client or accepted; before that it is in Planning.
    // Stalled: on hold, a planning case untouched for two weeks, or a quotation with the client for over a week.
    const row = (await db.query<{ planning: number; planningStuck: number; quotes: number; quotesStuck: number }>(
      `WITH open_cases AS (
         SELECT pre_case.status, pre_case.updated_at, live.status AS quote_status, live.updated_at AS quote_updated_at
           FROM pre_project_cases pre_case
           LEFT JOIN LATERAL (SELECT quote.status, quote.updated_at FROM commercial_quotes quote
             WHERE quote.workspace_id = pre_case.workspace_id AND quote.case_id = pre_case.id AND quote.kind = 'quotation'
               AND quote.status IN ('internal_review', 'internal_approved', 'issued', 'changes_requested', 'accepted')
             ORDER BY quote.updated_at DESC LIMIT 1) live ON true
          WHERE pre_case.workspace_id = $1 AND pre_case.status IN ('draft', 'active', 'on_hold')
       )
       SELECT count(*) FILTER (WHERE quote_status IS NULL)::int AS planning,
              count(*) FILTER (WHERE quote_status IS NULL AND (status = 'on_hold' OR updated_at < $2::timestamptz - interval '14 days'))::int AS "planningStuck",
              count(*) FILTER (WHERE quote_status IS NOT NULL)::int AS quotes,
              count(*) FILTER (WHERE quote_status IS NOT NULL AND (status = 'on_hold'
                OR (quote_status IN ('issued', 'changes_requested') AND quote_updated_at < $2::timestamptz - interval '7 days')))::int AS "quotesStuck"
         FROM open_cases`,
      [workspaceId, clock.now])).rows[0];
    stages.push({ id: "planning", count: Number(row?.planning ?? 0), stuck: Number(row?.planningStuck ?? 0), href: "/workspace/pre-projects" });
    stages.push({ id: "quotes", count: Number(row?.quotes ?? 0), stuck: Number(row?.quotesStuck ?? 0), href: "/workspace/pre-projects?section=quotations" });
  }
  if (access.projects) {
    // Handover = the project's current stage is one of its last two (the workflow template decides what they are).
    // Stalled: off track, at risk or past the promised date.
    const row = (await db.query<{ projects: number; projectsStuck: number; handover: number; handoverStuck: number }>(
      `WITH visible AS (
         SELECT project.health, project.promise_date,
                coalesce((SELECT min(stage.position) FROM project_stages stage WHERE stage.workspace_id = project.workspace_id
                   AND stage.project_id = project.id AND stage.status = 'current')
                   >= (SELECT max(stage.position) - 1 FROM project_stages stage WHERE stage.workspace_id = project.workspace_id
                   AND stage.project_id = project.id), false) AS closing
           FROM delivery_projects project
          WHERE project.workspace_id = $1 AND project.status IN ('active', 'on_hold') AND ${visibleProject("$3", "$4")}
       ), rated AS (
         SELECT closing, (health IN ('off_track', 'at_risk') OR coalesce(promise_date < $2::date, false)) AS stalled FROM visible
       )
       SELECT count(*) FILTER (WHERE NOT closing)::int AS projects, count(*) FILTER (WHERE NOT closing AND stalled)::int AS "projectsStuck",
              count(*) FILTER (WHERE closing)::int AS handover, count(*) FILTER (WHERE closing AND stalled)::int AS "handoverStuck"
         FROM rated`,
      [workspaceId, clock.today, membershipId, access.manageProjects])).rows[0];
    stages.push({ id: "projects", count: Number(row?.projects ?? 0), stuck: Number(row?.projectsStuck ?? 0), href: "/workspace/projects" });
    stages.push({ id: "handover", count: Number(row?.handover ?? 0), stuck: Number(row?.handoverStuck ?? 0), href: "/workspace/projects" });
  }
  return stages;
}

const recentHref = (kind: HomeRecentRecord["kind"], id: string) => ({
  enquiry: `/workspace/crm/leads?lead=${segment(id)}`,
  case: `/workspace/pre-projects/cases/${segment(id)}/overview`,
  project: `/workspace/projects/${segment(id)}`,
  order: `/workspace/purchasing/orders?order=${segment(id)}`,
  work_order: `/workspace/factory/orders?order=${segment(id)}`,
})[kind];

/**
 * Records to jump back into: the ones the person changed most recently (their audited work over 90 days), then
 * the ones in their care (their enquiries, cases and projects) by latest change. Only kinds they may open.
 */
async function readRecent(db: Db, person: Person, clock: Clock, access: HomeSummaryAccess): Promise<HomeRecentRecord[]> {
  const { workspaceId, membershipId, userId } = person;
  const flags = [access.leads, access.planning, access.projects, access.manageProjects, access.purchasing, access.factory];
  const rows = (await db.query<{ kind: HomeRecentRecord["kind"]; id: string; title: string | null; context: string | null; at: Date | string; mine: boolean }>(
    `WITH touched AS (
       SELECT event.entity_type, event.entity_id, max(event.occurred_at) AS at FROM audit_events event
        WHERE event.workspace_id = $1 AND event.actor_user_id = $2 AND event.entity_id IS NOT NULL
          AND event.occurred_at > $4::timestamptz - interval '90 days'
          AND event.entity_type IN ('crm_lead', 'pre_project_case', 'commercial_case', 'pre_project_design', 'project', 'delivery_project', 'purchase_order', 'work_order')
        GROUP BY event.entity_type, event.entity_id
     ), candidates AS (
       SELECT 'enquiry' AS kind, lead.id, party.display_name AS title, coalesce(enquiry.title, '') AS context, touched.at, true AS mine
         FROM touched JOIN crm_leads lead ON lead.workspace_id = $1 AND lead.id = touched.entity_id
         JOIN crm_parties party ON party.workspace_id = lead.workspace_id AND party.id = lead.party_id
         LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
        WHERE touched.entity_type = 'crm_lead' AND $5::boolean
       UNION ALL
       SELECT 'enquiry', lead.id, party.display_name, coalesce(enquiry.title, ''), lead.updated_at, false
         FROM crm_leads lead JOIN crm_parties party ON party.workspace_id = lead.workspace_id AND party.id = lead.party_id
         LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
        WHERE lead.workspace_id = $1 AND lead.owner_membership_id = $3 AND lead.status IN ${OPEN_LEADS} AND $5::boolean
       UNION ALL
       SELECT 'case', pre_case.id, opportunity.title, coalesce(party.display_name, ''), touched.at, true
         FROM touched
         LEFT JOIN pre_project_designs design ON touched.entity_type = 'pre_project_design' AND design.workspace_id = $1 AND design.id = touched.entity_id
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = $1
           AND pre_case.id = CASE WHEN touched.entity_type = 'pre_project_design' THEN design.case_id ELSE touched.entity_id END
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE touched.entity_type IN ('pre_project_case', 'commercial_case', 'pre_project_design') AND pre_case.status <> 'cancelled' AND $6::boolean
       UNION ALL
       SELECT 'case', pre_case.id, opportunity.title, coalesce(party.display_name, ''), pre_case.updated_at, false
         FROM pre_project_cases pre_case
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE pre_case.workspace_id = $1 AND pre_case.status IN ('draft', 'active', 'on_hold') AND $6::boolean
          AND (pre_case.owner_membership_id = $3 OR opportunity.owner_membership_id = $3)
       UNION ALL
       SELECT 'project', project.id, project.name, coalesce(project.reference, ''), touched.at, true
         FROM touched JOIN delivery_projects project ON project.workspace_id = $1 AND project.id = touched.entity_id
        WHERE touched.entity_type IN ('project', 'delivery_project') AND $7::boolean AND ${visibleProject("$3", "$8")}
       UNION ALL
       SELECT 'project', project.id, project.name, coalesce(project.reference, ''), project.updated_at, false
         FROM delivery_projects project
        WHERE project.workspace_id = $1 AND project.status IN ('active', 'on_hold') AND $7::boolean AND ${visibleProject("$3", "false")}
       UNION ALL
       SELECT 'order', purchase.id, purchase.number, coalesce(vendor.display_name, ''), touched.at, true
         FROM touched JOIN purchase_orders purchase ON purchase.workspace_id = $1 AND purchase.id = touched.entity_id
         LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
        WHERE touched.entity_type = 'purchase_order' AND $9::boolean
       UNION ALL
       SELECT 'work_order', work_order.id, work_order.title, coalesce(project.name, ''), touched.at, true
         FROM touched JOIN work_orders work_order ON work_order.workspace_id = $1 AND work_order.id = touched.entity_id
         LEFT JOIN delivery_projects project ON project.workspace_id = work_order.workspace_id AND project.id = work_order.project_id
        WHERE touched.entity_type = 'work_order' AND $10::boolean
     )
     SELECT kind, id::text AS id, max(title) AS title, max(context) AS context, max(at) AS at, bool_or(mine) AS mine
       FROM candidates GROUP BY kind, id
      ORDER BY bool_or(mine) DESC, max(at) DESC, id LIMIT ${RECENT_LIMIT}`,
    [workspaceId, userId, membershipId, clock.now, ...flags])).rows;
  return rows.map((row) => ({ id: row.id, kind: row.kind, title: row.title ?? "", context: row.context ?? "", at: text(row.at) ?? "", href: recentHref(row.kind, row.id) }));
}

/**
 * Home's overview for one person. Every query runs inside the caller's tenant RLS transaction, is bound to the
 * workspace, returns only bounded summaries, and reads a source only when the caller may see it.
 */
export async function readHomeSummary(db: Db, person: Person, access: HomeSummaryAccess, now: Date = new Date()): Promise<HomeSummary> {
  const workspace = (await db.query<{ timeZone: string | null }>(`SELECT default_timezone AS "timeZone" FROM workspaces WHERE id = $1`, [person.workspaceId])).rows[0];
  if (!workspace) throw new NotFoundException("Workspace not found");
  const timeZone = validTimeZone(workspace.timeZone);
  const clock: Clock = { now: now.toISOString(), today: localDay(now, timeZone), timeZone };

  // What is due today and overdue is My day's (the reminder engine's subjects, GET /my-day; Home's Today list and the
  // phone's Today read it). Focus keeps what waits for the person's decision.
  const focus = await readWaitingApprovals(db, person, access.approvals);

  // A quiet week reads further ahead, then what is due on the person's projects, so Home always says what's next.
  let horizonDays: 7 | 30 = 7;
  let upcoming = await readUpcoming(db, person, clock, access, 7);
  for (const [days, team] of [[30, false], [30, true]] as const) {
    if (upcoming.length >= 3) break;
    const wider = await readUpcoming(db, person, clock, access, days, team);
    if (wider.length > upcoming.length) { upcoming = wider; horizonDays = days; }
  }

  return {
    generatedAt: clock.now, timeZone, today: clock.today,
    focus: { items: focus.slice(0, FOCUS_LIMIT), total: focus.length },
    upcoming, horizonDays,
    funnel: await readFunnel(db, person, clock, access),
    recent: await readRecent(db, person, clock, access),
    projects: access.projects ? await readProjects(db, person, access) : [],
  };
}

/** The person's running projects (for actions that start on a project, such as a site report), most recent first. */
async function readProjects(db: Db, person: Person, access: HomeSummaryAccess): Promise<HomeSummary["projects"]> {
  return (await db.query<{ id: string; name: string }>(
    `SELECT project.id::text AS id, project.name FROM delivery_projects project
      WHERE project.workspace_id = $1 AND project.status IN ('active', 'on_hold') AND ${visibleProject("$2", "$3")}
      ORDER BY project.updated_at DESC, project.id LIMIT 8`,
    [person.workspaceId, person.membershipId, access.manageProjects])).rows;
}
