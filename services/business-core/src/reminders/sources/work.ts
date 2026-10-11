import { addDays } from "../../booking/booking.domain";
import type { DueItem, ReminderSource } from "../engine/engine";
import { dayStart, encode, idsOf, keysOf, managersByProject } from "./support";

/**
 * work.due (replaces processWorkDeadlines): project work and snags with a due date, on running projects. The assignee
 * hears the day before, on the day, and after (−1, 0, +1, +3); once it is late the project manager is copied in, as
 * the late notice used to go to both. Escalation (after two) goes to the owner's team lead, else the project manager,
 * then the owner. Done when the item is done or cancelled, or the project stops running.
 */
export const workDueSource: ReminderSource = {
  kind: "work.due", module: "projects", audience: "staff", critical: false, notify: "engine",
  viewPermission: "projects.view", template: { code: "reminders.work.due" },
  async open(db, workspaceId, { clock, limit }) {
    const rows = (await db.query<{ id: string; projectId: string; caseId: string | null; number: number; title: string; type: string; due: string; assignee: string | null; project: string }>(
      `SELECT item.id, item.project_id AS "projectId", project.case_id AS "caseId", item.number, item.title, item.type, item.due_date::text AS due,
              assignee.id AS assignee, concat_ws(' · ', nullif(project.reference, ''), project.name) AS project
         FROM work_items item
         JOIN delivery_projects project ON project.workspace_id = item.workspace_id AND project.id = item.project_id
         LEFT JOIN workspace_memberships assignee ON assignee.workspace_id = item.workspace_id AND assignee.id = item.assignee_membership_id AND assignee.status = 'active'
        WHERE item.workspace_id = $1 AND item.status NOT IN ('done', 'cancelled') AND item.due_date IS NOT NULL AND project.status = 'active'
          AND item.due_date BETWEEN $2::date AND $3::date
        ORDER BY item.due_date DESC, item.number LIMIT $4`,
      [workspaceId, addDays(clock.today, -90), addDays(clock.today, 14), limit])).rows;
    const managers = await managersByProject(db, workspaceId, rows.map((row) => row.projectId));
    return rows.map((row): DueItem => {
      const pms = managers.get(row.projectId) ?? [];
      const owner = row.assignee ?? pms[0] ?? null;
      const late = row.due < clock.today;
      return {
        key: `work:${row.id}`, sourceType: "work_item", sourceId: row.id, jobSource: { type: "project", id: row.projectId },
        projectId: row.projectId, caseId: row.caseId, partyId: null, ownerMembershipId: owner,
        ccMembershipIds: late ? pms.filter((id) => id !== owner) : [],
        dueAt: dayStart(row.due, clock), title: `#${row.number} ${row.title}`, context: row.project,
        href: `/workspace/projects/${encode(row.projectId)}/plan?item=${encode(row.id)}`, variables: { kind: row.type },
      };
    });
  },
  async stillOpen(db, workspaceId, keys, at) {
    const ids = idsOf(keys, "work");
    if (!ids.length) return new Set();
    // A due date moved more than two weeks out leaves the list until it comes near again (then with a new revision).
    return keysOf("work", (await db.query<{ id: string }>(
      `SELECT item.id FROM work_items item JOIN delivery_projects project ON project.workspace_id = item.workspace_id AND project.id = item.project_id
        WHERE item.workspace_id = $1 AND item.id = ANY($2::uuid[]) AND item.status NOT IN ('done', 'cancelled') AND item.due_date IS NOT NULL AND project.status = 'active'
          AND ($3::date IS NULL OR item.due_date <= $3::date)`,
      [workspaceId, ids, at ? addDays(at.today, 14) : null])).rows.map((row) => row.id));
  },
};
