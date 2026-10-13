import { addDays } from "../../booking/booking.domain";
import { inspectionSettings, stageName } from "../../factory/factory-inspections";
import { ensureFactorySettings } from "../../factory/factory";
import type { DueItem, ReminderSource } from "../engine/engine";
import { dayStart, encode, idsOf, keysOf, managersByProject } from "./support";

/**
 * factory.inspection_due (PLM-150): a design inspection the factory marked ready and the designer hasn't recorded by its
 * due day (the firm's working days after it was asked for). The inspecting designer hears on the day and after (0, +1,
 * +3 working days); once it is late the project manager is copied in, and escalation goes to the project manager, then
 * the owner. An inspection with nobody to do it belongs to the project manager. Done once it is passed or failed, its
 * work order is cancelled, the project stops running, or the firm switches inspections off.
 */
export const inspectionDueSource: ReminderSource = {
  kind: "factory.inspection_due", module: "factory", audience: "staff", critical: false, notify: "engine",
  viewPermission: "projects.view", poolPermission: "projects.manage", template: { code: "reminders.factory.inspection_due" },
  async open(db, workspaceId, { clock, limit }) {
    const rows = (await db.query<{ id: string; projectId: string; caseId: string | null; number: number; title: string; stage: "raw" | "final"; round: number; due: string;
      inspector: string | null; project: string }>(
      `SELECT inspection.id, inspection.project_id AS "projectId", project.case_id AS "caseId", wo.number, wo.title, inspection.stage, inspection.round, inspection.due_on::text AS due,
              inspector.id AS inspector, concat_ws(' · ', nullif(project.reference, ''), project.name) AS project
         FROM factory_inspections inspection
         JOIN work_orders wo ON wo.workspace_id = inspection.workspace_id AND wo.id = inspection.work_order_id AND wo.status <> 'cancelled'
         JOIN delivery_projects project ON project.workspace_id = inspection.workspace_id AND project.id = inspection.project_id
         JOIN workspace_factory_settings inspecting ON inspecting.workspace_id = inspection.workspace_id AND inspecting.inspections_enabled
         LEFT JOIN workspace_memberships inspector ON inspector.workspace_id = inspection.workspace_id AND inspector.id = inspection.inspector_membership_id AND inspector.status = 'active'
        WHERE inspection.workspace_id = $1 AND inspection.status = 'due' AND project.status = 'active' AND inspection.due_on BETWEEN $2::date AND $3::date
        ORDER BY inspection.due_on DESC, wo.number LIMIT $4`,
      [workspaceId, addDays(clock.today, -90), addDays(clock.today, 14), limit])).rows;
    if (!rows.length) return [];
    const stages = inspectionSettings(await ensureFactorySettings(db, workspaceId)).stages;
    const managers = await managersByProject(db, workspaceId, rows.map((row) => row.projectId));
    return rows.map((row): DueItem => {
      const pms = managers.get(row.projectId) ?? [];
      const owner = row.inspector ?? pms[0] ?? null;
      const late = row.due < clock.today;
      const stage = stageName(row.stage, stages);
      return {
        key: `inspection:${row.id}`, sourceType: "factory_inspection", sourceId: row.id, jobSource: { type: "project", id: row.projectId },
        projectId: row.projectId, caseId: row.caseId, partyId: null, ownerMembershipId: owner,
        ccMembershipIds: late ? pms.filter((id) => id !== owner) : [],
        dueAt: dayStart(row.due, clock), title: `${stage.charAt(0).toUpperCase()}${stage.slice(1)}${row.round > 1 ? ` (round ${row.round})` : ""} · WO-${String(row.number).padStart(4, "0")} ${row.title}`,
        context: row.project, href: `/workspace/inspections/${encode(row.id)}`, variables: { stage: row.stage },
      };
    });
  },
  async stillOpen(db, workspaceId, keys, at) {
    const ids = idsOf(keys, "inspection");
    if (!ids.length) return new Set();
    return keysOf("inspection", (await db.query<{ id: string }>(
      `SELECT inspection.id FROM factory_inspections inspection
         JOIN work_orders wo ON wo.workspace_id = inspection.workspace_id AND wo.id = inspection.work_order_id AND wo.status <> 'cancelled'
         JOIN delivery_projects project ON project.workspace_id = inspection.workspace_id AND project.id = inspection.project_id
         JOIN workspace_factory_settings inspecting ON inspecting.workspace_id = inspection.workspace_id AND inspecting.inspections_enabled
        WHERE inspection.workspace_id = $1 AND inspection.id = ANY($2::uuid[]) AND inspection.status = 'due' AND project.status = 'active'
          AND ($3::date IS NULL OR inspection.due_on <= $3::date)`,
      [workspaceId, ids, at ? addDays(at.today, 14) : null])).rows.map((row) => row.id));
  },
};
