import type { PoolClient } from "pg";
import { workdays, type WorkCalendar } from "./work-calendar";

type Db = Pick<PoolClient, "query">;

export const MISS_REASONS = ["blocked", "waiting_on_client", "materials_late", "underestimated", "people_unavailable", "reprioritised", "other"] as const;
export type MissReason = (typeof MISS_REASONS)[number];

export type SprintRow = {
  id: string; number: number; name: string; goal: string; startDate: string; endDate: string; status: "planned" | "active" | "closed"; version: number;
  /** Open work in the sprint now (tasks and issues; subtasks travel with their task). */
  items: number; itemsDone: number;
  /** What was committed when it started, and how much of that is done. */
  committed: number; committedDone: number;
  closedAt: string | null;
};

/** The project's sprints, newest last, with how much is in each and how much of the commitment is done. */
export async function readSprints(db: Db, workspaceId: string, projectId: string): Promise<SprintRow[]> {
  return (await db.query<SprintRow>(
    `SELECT sprint.id, sprint.number, sprint.name, sprint.goal, sprint.start_date::text AS "startDate", sprint.end_date::text AS "endDate", sprint.status, sprint.version,
            sprint.closed_at AS "closedAt",
            (SELECT count(*)::int FROM work_items item WHERE item.workspace_id = sprint.workspace_id AND item.sprint_id = sprint.id AND item.status <> 'cancelled') AS items,
            (SELECT count(*)::int FROM work_items item WHERE item.workspace_id = sprint.workspace_id AND item.sprint_id = sprint.id AND item.status = 'done') AS "itemsDone",
            (SELECT count(*)::int FROM work_sprint_commitments commitment WHERE commitment.workspace_id = sprint.workspace_id AND commitment.sprint_id = sprint.id AND commitment.outcome <> 'removed') AS committed,
            (SELECT count(*)::int FROM work_sprint_commitments commitment JOIN work_items item ON item.workspace_id = commitment.workspace_id AND item.id = commitment.item_id
              WHERE commitment.workspace_id = sprint.workspace_id AND commitment.sprint_id = sprint.id AND commitment.outcome <> 'removed'
                AND (commitment.outcome = 'done' OR (sprint.status = 'active' AND item.status = 'done'))) AS "committedDone"
       FROM work_sprints sprint WHERE sprint.workspace_id = $1 AND sprint.project_id = $2 ORDER BY sprint.number`, [workspaceId, projectId])).rows;
}

export type BurndownDay = { date: string; remaining: number | null; ideal: number };

/**
 * Committed work left at the end of each day of the sprint, against a straight line to zero across
 * its working days (days off keep the line flat). Days still to come have no actual value.
 */
export function burndown(input: { startDate: string; endDate: string; today: string; committed: Array<{ doneOn: string | null }>; calendar: WorkCalendar }): BurndownDay[] {
  const math = workdays(input.calendar);
  const total = input.committed.length;
  const working = Math.max(1, math.span(input.startDate, input.endDate));
  const days: BurndownDay[] = [];
  let worked = 0;
  for (let at = Date.parse(`${input.startDate}T00:00:00Z`); at <= Date.parse(`${input.endDate}T00:00:00Z`); at += 86_400_000) {
    const date = new Date(at).toISOString().slice(0, 10);
    if (math.isWorking(date)) worked++;
    const ideal = Math.round(total * (1 - worked / working) * 100) / 100;
    const remaining = date > input.today ? null : total - input.committed.filter((item) => item.doneOn && item.doneOn <= date).length;
    days.push({ date, remaining, ideal: Math.max(0, ideal) });
  }
  return days;
}

/** A sprint's burndown and, once closed, what was missed and why. */
export async function readSprintDetail(db: Db, workspaceId: string, projectId: string, sprintId: string, calendar: WorkCalendar) {
  const sprint = (await readSprints(db, workspaceId, projectId)).find((item) => item.id === sprintId);
  if (!sprint) return null;
  const facts = (await db.query<{ today: string; timezone: string }>(
    `SELECT (now() AT TIME ZONE coalesce(default_timezone, 'UTC'))::date::text AS today, coalesce(default_timezone, 'UTC') AS timezone FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
  const commitments = (await db.query<{ itemId: string; number: number; title: string; outcome: string; reason: MissReason | null; note: string; doneOn: string | null }>(
    `SELECT item.id AS "itemId", item.number, item.title, commitment.outcome, commitment.reason, commitment.note,
            CASE WHEN item.status = 'done' THEN (item.completed_at AT TIME ZONE $4)::date::text END AS "doneOn"
       FROM work_sprint_commitments commitment JOIN work_items item ON item.workspace_id = commitment.workspace_id AND item.id = commitment.item_id
      WHERE commitment.workspace_id = $1 AND commitment.sprint_id = $2 AND item.project_id = $3 ORDER BY item.number`,
    [workspaceId, sprintId, projectId, facts.timezone])).rows;
  const counted = commitments.filter((item) => item.outcome !== "removed");
  const added = (await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM work_items item WHERE item.workspace_id = $1 AND item.sprint_id = $2
        AND NOT EXISTS (SELECT 1 FROM work_sprint_commitments commitment WHERE commitment.workspace_id = item.workspace_id AND commitment.sprint_id = $2 AND commitment.item_id = item.id)`,
    [workspaceId, sprintId])).rows[0].count;
  return {
    sprint,
    days: sprint.status === "planned" ? [] : burndown({ startDate: sprint.startDate, endDate: sprint.endDate, today: facts.today,
      committed: counted.map((item) => ({ doneOn: item.outcome === "missed" ? null : item.doneOn })), calendar }),
    added,
    removed: commitments.filter((item) => item.outcome === "removed").length,
    missed: commitments.filter((item) => item.outcome === "missed").map(({ itemId, number, title, reason, note }) => ({ itemId, number, title, reason, note })),
    /** Committed and not done yet: what closing the sprint asks a reason for. */
    unfinished: sprint.status === "active" ? commitments.filter((item) => item.outcome === "open" && !item.doneOn).map(({ itemId, number, title }) => ({ itemId, number, title })) : [],
  };
}
