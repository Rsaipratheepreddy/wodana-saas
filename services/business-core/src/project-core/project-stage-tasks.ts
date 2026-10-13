import type { PoolClient } from "pg";
import { LEAD_ROLE, orderDrawingLine, TASK_CHECKS, type CheckKind } from "./project-checks";
import { ensureSettings, evaluateStages, readProject, readStages, readTeam, type TeamMember } from "./project-core.store";
import { drawingsClientRoleOf, routeDrawingCheck } from "./project-drawings";
import { INSTALLATION_ROLE } from "./project-installation";
import { tellKeepInformed } from "./project-keep-informed";
import { noticeWork } from "./project-notices";
import { OPEN, workEvent, type WorkStatus } from "./project-work";
import { readCalendar, workdays } from "./work-calendar";

type Db = Pick<PoolClient, "query">;

/** The task each record-driven check opens (its title is the work, as on any other task). */
export const STAGE_TASK_TITLES: Record<string, string> = {
  technical_measure_done: "Technical site measure",
  drawings_uploaded: "Technical drawings",
  drawings_site_checked: "Technical site check",
  drawings_design_checked: "Check the drawings match the design",
  drawings_client_approved: "Client approval of the drawings",
  factory_slot_booked: "Book the factory slot",
  installation_scheduled: "Schedule delivery and installation",
  permit_collected: "Collect the building permit",
};

/**
 * The role whose person does the work; the stage owner when it has none of its own, the project manager last. The
 * technical measure is the project manager's (PLM-149); the design check and the client's approval go to the role that
 * talks to the client about drawings (`clientRole`, the lead designer) when the firm chose one, else the project manager.
 */
export function stageTaskAssignee(kind: CheckKind, ownerRole: string | null, team: TeamMember[], clientRole: string | null = null) {
  const holder = (role: string | null) => (role ? team.find((member) => member.roles.includes(role))?.membershipId ?? null : null);
  const lead = holder(LEAD_ROLE) ?? team.find((member) => member.lead)?.membershipId ?? null;
  if (kind === "technical_measure_done") return lead;
  if (kind === "drawings_client_approved" || kind === "drawings_design_checked") return holder(clientRole) ?? lead;
  if (kind === "factory_slot_booked") return holder("factory_lead") ?? holder(ownerRole) ?? lead;
  // PLM-069: the installation team (the stage's owner) schedules it.
  if (kind === "installation_scheduled") return holder(ownerRole) ?? holder(INSTALLATION_ROLE) ?? lead;
  // The permit is collected ahead of the delivery by the stage's owner (the installation team), else the project manager.
  if (kind === "permit_collected") return holder(ownerRole) ?? holder(INSTALLATION_ROLE) ?? lead;
  return holder(ownerRole) ?? lead;
}

/**
 * The current stage's record-driven tasks (PLM-057, 058, 059, 068). The first of its task checks that doesn't pass
 * yet has an open task for its person (created once, opened again when its turn comes back: a site check or the
 * client sending the drawings back); a check that passes closes its task; later checks wait for their turn. Tasks
 * of a finished stage are done; those of a stage skipped or gone back to stop. The site check is also the project
 * manager's: they hear it with the technical drawer. Runs after every project command and in the daily run.
 */
export async function syncStageTasks(db: Db, workspaceId: string, projectId: string, actorUserId: string | null) {
  const project = await readProject(db, workspaceId, projectId);
  if (!project || project.status !== "active") return 0;
  const stages = await readStages(db, workspaceId, [projectId]);
  const current = stages.find((stage) => stage.status === "current");
  const actor = actorUserId ?? (await db.query<{ userId: string }>(`SELECT coalesce(started_by, created_by) AS "userId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, projectId])).rows[0]?.userId;
  if (!actor) return 0;
  const tasks = (await db.query<{ id: string; number: number; title: string; status: WorkStatus; stageId: string; check: string; assignee: string | null; version: number }>(
    `SELECT id, number, title, status, stage_id AS "stageId", stage_check AS "check", assignee_membership_id AS assignee, version FROM work_items
      WHERE workspace_id = $1 AND project_id = $2 AND stage_check IS NOT NULL FOR UPDATE`, [workspaceId, projectId])).rows;
  const set = async (task: (typeof tasks)[number], status: WorkStatus, because: string) => {
    await db.query(
      `UPDATE work_items SET status = $3::varchar, completed_at = CASE WHEN $3::varchar = 'done' THEN now() END, completed_by = CASE WHEN $3::varchar = 'done' THEN $4::uuid END,
              version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, task.id, status, actor]);
    await workEvent(db, workspaceId, task.id, "status", { from: task.status, to: status, because }, actor);
  };
  // A finished stage's checks all passed (its tasks are done); a skipped one, or one gone back to, no longer needs them.
  for (const task of tasks) if (task.stageId !== current?.id && OPEN(task.status))
    await set(task, stages.find((stage) => stage.id === task.stageId)?.status === "done" ? "done" : "cancelled", "stage");
  if (!current) return 0;
  const team = (await readTeam(db, workspaceId, [projectId])).get(projectId) ?? [];
  const [stage] = await evaluateStages(db, workspaceId, project, [current], team);
  const lead = team.find((member) => member.lead)?.membershipId ?? null;
  const settings = await ensureSettings(db, workspaceId);
  // PLM-149: the design check and the client's approval go to the role that talks to the client about drawings.
  const clientRole = drawingsClientRoleOf(settings, routeDrawingCheck(stages));
  let opened = 0;
  let turn = true;
  // The drawing line runs in its own order (the measure, the drawings, the check, the client's approval), whatever the stage lists.
  for (const check of orderDrawingLine(stage.checks).filter((item) => TASK_CHECKS.includes(item.kind))) {
    const task = tasks.find((item) => item.stageId === stage.id && item.check === check.key);
    if (check.passed) { if (task && OPEN(task.status)) await set(task, "done", "record"); continue; }
    if (!turn) { if (task && OPEN(task.status)) await set(task, "cancelled", "waiting"); continue; }
    turn = false;
    if (task && OPEN(task.status)) continue;
    const assignee = task?.assignee ?? stageTaskAssignee(check.kind, stage.ownerRole, team, clientRole);
    let item: { id: string; number: number; title: string };
    let dueDate: string | null = null;
    if (task) {
      await set(task, "todo", "turn");
      item = task;
    } else {
      const number = (await db.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM work_items WHERE workspace_id = $1 AND project_id = $2`,
        [workspaceId, projectId])).rows[0].next;
      const title = STAGE_TASK_TITLES[check.kind] ?? check.kind;
      // PLM-149: the technical measure is due the firm's working days after its task opens (overdue alerts: the reminder engine's work.due).
      if (check.kind === "technical_measure_done" && settings.technicalMeasureDays) {
        const today = (await db.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`,
          [workspaceId])).rows[0].today;
        dueDate = workdays(await readCalendar(db, workspaceId)).shift(today, settings.technicalMeasureDays);
      }
      const id = (await db.query<{ id: string }>(
        `INSERT INTO work_items (id, workspace_id, project_id, number, type, stage_id, stage_check, title, assignee_membership_id, created_by, due_date)
         VALUES (gen_random_uuid(), $1, $2, $3, 'task', $4, $5, $6, $7, $8, $9::date) RETURNING id`,
        [workspaceId, projectId, number, stage.id, check.key, title, assignee, actor, dueDate])).rows[0].id;
      await workEvent(db, workspaceId, id, "created", { stage: stage.key, check: check.kind }, actor);
      item = { id, number, title };
    }
    opened += 1;
    // The person whose work it is hears it (by email too); the site check is the project manager's as well, the technical measure the factory lead's.
    const factoryLead = team.find((member) => member.roles.includes("factory_lead"))?.membershipId ?? null;
    const told = [assignee, ...(check.kind === "drawings_site_checked" && lead ? [lead] : []), ...(check.kind === "technical_measure_done" && factoryLead ? [factoryLead] : [])]
      .filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
    if (told.length) await noticeWork(db, { workspaceId, projectId, key: `stage-task:${item.id}:${task ? task.version + 1 : 1}`, actorUserId: actorUserId ?? "",
      notice: { code: "work.assigned", item: { ...item, dueDate }, memberships: told } });
    // PLM-055: the technical drawings started; the people kept informed (the designer) hear it once.
    if (check.kind === "drawings_uploaded" && !task) await tellKeepInformed(db, { workspaceId, projectId, event: "drawings_started", key: "first", actorUserId, date: "" });
  }
  return opened;
}

/** Links a stage task carries to what its work needs (PLM-057): the site's measurements, the designs, the material list, the drawings. */
export function stageTaskLinks(kind: string | null, project: { id: string; caseId: string }) {
  const caseBase = `/workspace/pre-projects/cases/${project.caseId}`;
  const projectBase = `/workspace/projects/${project.id}`;
  const drawings = { key: "drawings", href: `${projectBase}/scope?view=drawings` };
  if (kind === "drawings_uploaded") return [drawings, { key: "measurements", href: `${caseBase}/measurements` }, { key: "materials", href: `${projectBase}/scope?view=materials` },
    { key: "designs", href: `${caseBase}/designs` }];
  if (kind === "drawings_site_checked") return [drawings, { key: "measurements", href: `${caseBase}/measurements` }];
  // PLM-149: the technical measure is recorded on the drawings view; the design check compares the drawings with the designs.
  if (kind === "technical_measure_done") return [drawings, { key: "measurements", href: `${caseBase}/measurements` }];
  if (kind === "drawings_design_checked") return [drawings, { key: "designs", href: `${caseBase}/designs` }];
  if (kind === "drawings_client_approved") return [drawings];
  if (kind === "factory_slot_booked") return [{ key: "factory_slot", href: projectBase }];
  if (kind === "installation_scheduled") return [{ key: "installation", href: projectBase }];
  if (kind === "permit_collected") return [{ key: "permit", href: projectBase }];
  return [];
}
