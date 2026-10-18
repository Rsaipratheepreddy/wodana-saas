import { wallClock, zonedInstant } from "../../booking/booking.domain";
import { workdays } from "../../project-core/work-calendar";
import { readProgressSettings } from "../../site/progress-delivery";
import type { Db, DueItem, ReminderSource } from "../engine/engine";
import { dayStart, encode, idsOf, keysOf, UUID } from "./support";

const minutesOf = (time: string) => { const [hour, minute] = time.split(":").map(Number); return (hour || 0) * 60 + (minute || 0); };

/** The site supervisors named on each project, else its managers (active). */
async function siteOwners(db: Db, workspaceId: string, projectIds: readonly string[]) {
  if (!projectIds.length) return new Map<string, string[]>();
  const rows = (await db.query<{ projectId: string; membershipId: string; supervisor: boolean }>(
    `SELECT DISTINCT assignment.project_id AS "projectId", assignment.membership_id AS "membershipId", 'site_supervisor' = ANY(assignment.role_keys) AS supervisor
       FROM project_assignments assignment
       JOIN workspace_memberships member ON member.workspace_id = assignment.workspace_id AND member.id = assignment.membership_id AND member.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = ANY($2::uuid[]) AND assignment.active
        AND ('site_supervisor' = ANY(assignment.role_keys) OR assignment.is_manager)
      ORDER BY 1, 3 DESC, 2`, [workspaceId, projectIds])).rows;
  const byProject = new Map<string, string[]>();
  for (const projectId of new Set(rows.map((row) => row.projectId))) {
    const mine = rows.filter((row) => row.projectId === projectId);
    const supervisors = mine.filter((row) => row.supervisor).map((row) => row.membershipId);
    byProject.set(projectId, supervisors.length ? supervisors : mine.map((row) => row.membershipId));
  }
  return byProject;
}

/**
 * site.daily_report (My day only; the site reminders keep their own notices): a worked day on a running site whose
 * daily report nobody submitted, once the firm's end-of-day time passed. The site supervisor (else the project
 * manager) sees it until a report for that day is submitted.
 */
export const siteReportSource: ReminderSource = {
  kind: "site.daily_report", module: "projects", audience: "staff", critical: false, notify: "module",
  viewPermission: "projects.view", template: { code: "" },
  async open(db, workspaceId, { clock, now, limit }) {
    const { dueTime } = await readProgressSettings(db, workspaceId);
    const isWorking = workdays({ workingDays: clock.workingDays, holidays: clock.holidays }).isWorking;
    const local = wallClock(now.getTime(), clock.timeZone);
    // Today once its end-of-day time passed, and the last worked day before it.
    const days: string[] = [];
    if (isWorking(local.date) && local.minutes >= minutesOf(dueTime)) days.push(local.date);
    let previous = local.date;
    for (let guard = 0; guard < 14; guard++) {
      previous = new Date(Date.parse(`${previous}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      if (isWorking(previous)) { days.push(previous); break; }
    }
    const items: DueItem[] = [];
    for (const day of days) {
      const rows = (await db.query<{ id: string; label: string; caseId: string | null }>(
        `SELECT project.id, concat_ws(' · ', nullif(project.reference, ''), project.name) AS label, project.case_id AS "caseId"
           FROM delivery_projects project
          WHERE project.workspace_id = $1 AND project.status = 'active' AND project.site_started_on IS NOT NULL AND project.site_started_on <= $2::date
            AND (project.site_finished_on IS NULL OR project.site_finished_on >= $2::date)
            AND NOT EXISTS (SELECT 1 FROM site_reports report WHERE report.workspace_id = project.workspace_id AND report.project_id = project.id
                             AND report.report_date = $2::date AND report.status IN ('submitted', 'approved'))
          ORDER BY project.id LIMIT $3`, [workspaceId, day, limit])).rows;
      const owners = await siteOwners(db, workspaceId, rows.map((row) => row.id));
      for (const row of rows) {
        const people = owners.get(row.id) ?? [];
        items.push({
          key: `site_report:${row.id}:${day}`, sourceType: "site_report", sourceId: `${row.id}:${day}`, jobSource: { type: "project", id: row.id }, projectId: row.id,
          caseId: row.caseId, partyId: null, ownerMembershipId: people[0] ?? null, ccMembershipIds: people.slice(1),
          dueAt: new Date(zonedInstant(day, minutesOf(dueTime), clock.timeZone, "compatible") ?? dayStart(day, clock).getTime()), title: "Daily site report",
          context: row.label, href: `/workspace/projects/${encode(row.id)}/site?new=report`, variables: {},
        });
      }
    }
    return items.slice(0, limit);
  },
  async stillOpen(db, workspaceId, keys) {
    const pairs = keys.map((key) => key.split(":")).filter((parts) => parts[0] === "site_report" && parts.length === 3 && UUID.test(parts[1]) && /^\d{4}-\d{2}-\d{2}$/.test(parts[2]));
    if (!pairs.length) return new Set();
    return new Set((await db.query<{ key: string }>(
      `SELECT 'site_report:' || project.id || ':' || wanted.day AS key
         FROM unnest($2::uuid[], $3::date[]) AS wanted(project_id, day)
         JOIN delivery_projects project ON project.workspace_id = $1 AND project.id = wanted.project_id AND project.status = 'active'
        WHERE NOT EXISTS (SELECT 1 FROM site_reports report WHERE report.workspace_id = project.workspace_id AND report.project_id = project.id
                           AND report.report_date = wanted.day AND report.status IN ('submitted', 'approved'))`,
      [workspaceId, pairs.map((parts) => parts[1]), pairs.map((parts) => parts[2])])).rows.map((row) => row.key));
  },
};

/** factory.production_due (My day only; the factory keeps its own notices): a work order due from the factory by today and not ready. */
export const productionDueSource: ReminderSource = {
  kind: "factory.production_due", module: "factory", audience: "staff", critical: false, notify: "module",
  viewPermission: "factory.view", poolPermission: "factory.manage", template: { code: "" },
  async open(db, workspaceId, { clock, limit }) {
    const rows = (await db.query<{ id: string; number: number; title: string; plannedEnd: string; projectId: string; project: string; caseId: string | null }>(
      `SELECT work_order.id, work_order.number, work_order.title, work_order.planned_end::text AS "plannedEnd", work_order.project_id AS "projectId",
              coalesce(project.name, '') AS project, project.case_id AS "caseId"
         FROM work_orders work_order
         LEFT JOIN delivery_projects project ON project.workspace_id = work_order.workspace_id AND project.id = work_order.project_id
        WHERE work_order.workspace_id = $1 AND work_order.status IN ('planned', 'released', 'in_production', 'on_hold') AND work_order.planned_end <= $2::date
        ORDER BY work_order.planned_end DESC, work_order.number LIMIT $3`, [workspaceId, clock.today, limit])).rows;
    return rows.map((row): DueItem => ({
      key: `work_order:${row.id}`, sourceType: "work_order", sourceId: row.id, jobSource: { type: "project", id: row.projectId }, projectId: row.projectId, caseId: row.caseId,
      partyId: null, ownerMembershipId: null, ccMembershipIds: [], dueAt: dayStart(row.plannedEnd, clock), title: row.title, context: row.project,
      href: `/workspace/factory/orders?order=${encode(row.id)}`, variables: {},
    }));
  },
  async stillOpen(db, workspaceId, keys, at) {
    const ids = idsOf(keys, "work_order");
    if (!ids.length) return new Set();
    return keysOf("work_order", (await db.query<{ id: string }>(
      `SELECT id FROM work_orders WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status IN ('planned', 'released', 'in_production', 'on_hold')
          AND planned_end IS NOT NULL AND ($3::date IS NULL OR planned_end <= $3::date)`, [workspaceId, ids, at?.today ?? null])).rows.map((row) => row.id));
  },
};

/** books.posting_issue (My day only; the Ledger tells its managers itself): an event that couldn't post to the Ledger yet. */
export const postingIssueSource: ReminderSource = {
  kind: "books.posting_issue", module: "ledger", audience: "staff", critical: false, notify: "module",
  viewPermission: "books.view", poolPermission: "books.manage", template: { code: "" },
  async open(db, workspaceId, { limit }) {
    const rows = (await db.query<{ id: string; label: string; sourceType: string; href: string; detail: string; firstSeenAt: Date; company: string | null }>(
      `SELECT issue.id, issue.source_label AS label, issue.source_type AS "sourceType", issue.source_href AS href, issue.detail, issue.first_seen_at AS "firstSeenAt",
              entity.display_name AS company
         FROM books_posting_issues issue
         LEFT JOIN legal_entities entity ON entity.workspace_id = issue.workspace_id AND entity.id = issue.legal_entity_id
        WHERE issue.workspace_id = $1 AND issue.resolved_at IS NULL
        ORDER BY issue.first_seen_at DESC LIMIT $2`, [workspaceId, limit])).rows;
    return rows.map((row): DueItem => ({
      key: `posting_issue:${row.id}`, sourceType: "books_posting_issue", sourceId: row.id, jobSource: null, projectId: null, caseId: null, partyId: null,
      ownerMembershipId: null, ccMembershipIds: [], dueAt: new Date(row.firstSeenAt), title: row.label || row.sourceType, context: [row.company, row.detail].filter(Boolean).join(" · "),
      href: "/workspace/ledger/attention", variables: {},
    }));
  },
  async stillOpen(db, workspaceId, keys) {
    const ids = idsOf(keys, "posting_issue");
    if (!ids.length) return new Set();
    return keysOf("posting_issue", (await db.query<{ id: string }>(
      `SELECT id FROM books_posting_issues WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND resolved_at IS NULL`, [workspaceId, ids])).rows.map((row) => row.id));
  },
};
