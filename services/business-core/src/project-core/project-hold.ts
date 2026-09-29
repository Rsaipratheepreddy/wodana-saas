import type { PoolClient } from "pg";
import { workEvent } from "./project-work";
import { readCalendar, workdays } from "./work-calendar";

type Db = Pick<PoolClient, "query">;

/** How long a project has been on hold: calendar days and the working days lost (from the day it was held up to today). */
export async function holdLength(db: Db, workspaceId: string, projectId: string) {
  const row = (await db.query<{ heldOn: string | null; today: string }>(
    `SELECT (project.held_at AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS "heldOn",
            (now() AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS today
       FROM delivery_projects project JOIN workspaces workspace ON workspace.id = project.workspace_id
      WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0];
  if (!row?.heldOn) return { days: 0, workingDays: 0 };
  const math = workdays(await readCalendar(db, workspaceId));
  let workingDays = 0;
  for (let day = row.heldOn; day < row.today; day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10))
    if (math.isWorking(day)) workingDays += 1;
  const days = Math.max(0, Math.round((Date.parse(`${row.today}T00:00:00Z`) - Date.parse(`${row.heldOn}T00:00:00Z`)) / 86_400_000));
  return { days, workingDays };
}

/**
 * Resuming with "move the dates": open work moves later by the working days lost while the project was held
 * (each item keeps its length), and the handover date moves by the same working days. Finished work never moves.
 */
export async function shiftForHold(db: Db, workspaceId: string, projectId: string, actorUserId: string) {
  const { workingDays } = await holdLength(db, workspaceId, projectId);
  if (!workingDays) return { workingDays: 0, moved: 0, promiseDate: null as string | null };
  const math = workdays(await readCalendar(db, workspaceId));
  const items = (await db.query<{ id: string; startDate: string | null; dueDate: string | null }>(
    `SELECT id, start_date::text AS "startDate", due_date::text AS "dueDate" FROM work_items
      WHERE workspace_id = $1 AND project_id = $2 AND status NOT IN ('done', 'cancelled') AND (start_date IS NOT NULL OR due_date IS NOT NULL) FOR UPDATE`,
    [workspaceId, projectId])).rows;
  for (const item of items) {
    const startDate = item.startDate ? math.shift(item.startDate, workingDays) : null;
    const dueDate = item.dueDate ? math.shift(item.dueDate, workingDays) : null;
    await db.query(`UPDATE work_items SET start_date = $3, due_date = $4, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, item.id, startDate, dueDate]);
    await workEvent(db, workspaceId, item.id, "dates", { startDate, dueDate, fromStart: item.startDate, fromDue: item.dueDate, hold: workingDays }, actorUserId);
  }
  const promise = (await db.query<{ promiseDate: string | null }>(`SELECT promise_date::text AS "promiseDate" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, projectId])).rows[0]?.promiseDate ?? null;
  const promiseDate = promise ? math.shift(promise, workingDays) : null;
  if (promiseDate) await db.query(`UPDATE delivery_projects SET promise_date = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId, promiseDate]);
  return { workingDays, moved: items.length, promiseDate };
}
