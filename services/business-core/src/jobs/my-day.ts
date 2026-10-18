import { NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { designTeamConfig } from "../design/design-journey.store";
import type { DesignTeamConfig } from "../design/design-team.domain";
import { readStaffPeople } from "../reminders/delivery/people";
import { readClock, readReminderSettings } from "../reminders/engine/context";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type { JourneyChapter, JourneyLane, JourneyView } from "./job-journey";
import type { JobsService } from "./jobs.service";

type Db = Pick<PoolClient, "query">;

/**
 * §0.3 My day on the job journey: the step now of every job this person sees that is theirs, late first, then due
 * today, then the rest. Nothing is computed twice here: the jobs and their steps come from the Jobs list and the job
 * page's own reading (JobsService.overview and JobsService.journey: same permission, same scope). This file only
 * decides which of those steps are mine and in what order.
 *
 * A step is mine when its owner is me (matched by membership, never by name: two people may share one), or when it has no named owner and its lane is worked by a seat I hold. Sales
 * and finance work from a shared queue, so a workspace seat is enough; design and delivery are staffed per job, so the
 * seat must be mine on that job (the case's team or the project's assignments, the project manager for delivery).
 * The client's lane is nobody's on the staff side.
 */

/** The standard seats (role codes from the setup kits) that work each lane. A firm's design-team settings add theirs. */
export const LANE_SEATS: Readonly<Record<Exclude<JourneyLane, "client">, readonly string[]>> = {
  sales: ["sales", "account_manager", "sales_admin"],
  design: ["designer", "junior_designer", "creative_director", "visualiser", "draftsman", "material_coordinator"],
  finance: ["finance", "finance_reviewer", "finance_approver", "operations_approver"],
  delivery: ["project_manager", "site_supervisor", "technical_lead", "quantity_surveyor", "buyer", "factory_lead", "qc_inspector"],
};
/** Lanes worked from a shared queue: holding the seat in the workspace is enough. */
export const SHARED_LANES: readonly JourneyLane[] = ["sales", "finance"];
/** How a project's manager is counted on its job: a delivery seat. */
export const PROJECT_MANAGER_SEAT = "project_manager";

export type SeatMap = Record<Exclude<JourneyLane, "client">, string[]>;

/** The lanes' seats with the firm's own design-team role codes (Settings › Design) added to the standard ones. */
export function laneSeats(config?: Partial<DesignTeamConfig> | null): SeatMap {
  const seats: SeatMap = { sales: [...LANE_SEATS.sales], design: [...LANE_SEATS.design], finance: [...LANE_SEATS.finance], delivery: [...LANE_SEATS.delivery] };
  const add = (lane: keyof SeatMap, code: string | null | undefined) => { if (code && !seats[lane].includes(code)) seats[lane].push(code); };
  if (config) {
    for (const slot of ["lead_designer", "junior_designer", "visualiser", "draftsman", "material_coordinator"] as const) add("design", config[slot]);
    add("sales", config.sales_admin);
    add("delivery", config.technicalLeadRoleCode);
  }
  return seats;
}

/** The lanes a set of seats (role codes) works. */
export function lanesOf(codes: Iterable<string>, seats: SeatMap = laneSeats()): Set<JourneyLane> {
  const held = new Set(codes);
  const lanes = new Set<JourneyLane>();
  for (const [lane, list] of Object.entries(seats) as Array<[keyof SeatMap, string[]]>) if (list.some((code) => held.has(code))) lanes.add(lane);
  return lanes;
}

export type MyDayViewer = {
  /** My membership in the workspace: a step's owner is matched by it. */
  membershipId: string | null;
  /** My display name, for an owner known only by name. */
  name: string | null;
  /** The shared lanes (sales, finance) my workspace seats work. */
  sharedLanes: ReadonlySet<JourneyLane>;
  /** Per job: the lanes my seats on that job work. */
  jobLanes: ReadonlyMap<string, ReadonlySet<JourneyLane>>;
  timeZone: string;
};
export type MineReason = "owner" | "seat";

const sameName = (a: string | null | undefined, b: string | null | undefined) => Boolean(a?.trim() && b?.trim() && a.trim() === b.trim());

/** Whether a named owner is me: by membership when the step knows it, else (an owner known only by name) by name. */
function ownerIsMe(owner: { id?: string | null; name: string | null }, viewer: MyDayViewer) {
  if (owner.id) return Boolean(viewer.membershipId) && owner.id === viewer.membershipId;
  return sameName(owner.name, viewer.name);
}

/** Why a job's step now is mine ("owner", "seat"), or null when it is someone else's. */
export function mineBecause(jobId: string, step: { owner: string | null; ownerId?: string | null; lane: JourneyLane }, viewer: MyDayViewer): MineReason | null {
  if (step.ownerId || step.owner?.trim()) return ownerIsMe({ id: step.ownerId, name: step.owner }, viewer) ? "owner" : null;
  if (step.lane === "client") return null;
  if (viewer.jobLanes.get(jobId)?.has(step.lane)) return "seat";
  return SHARED_LANES.includes(step.lane) && viewer.sharedLanes.has(step.lane) ? "seat" : null;
}

/** Whether a job could have a step of mine before its journey is read: a named owner that is me, or a seat that could match. */
export function couldBeMine(jobId: string, owner: string | null, viewer: MyDayViewer, ownerId: string | null = null) {
  if (ownerId || owner?.trim()) return ownerIsMe({ id: ownerId, name: owner }, viewer);
  return viewer.sharedLanes.size > 0 || (viewer.jobLanes.get(jobId)?.size ?? 0) > 0;
}

export type MyDayUrgency = "late" | "today" | "later";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day of an instant in a time zone (YYYY-MM-DD). */
export function dayIn(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Late when its day has passed (a date) or its time has (an instant); due today when it falls on today in my time zone;
 * otherwise later (ahead, or no date).
 */
export function urgencyOf(dueAt: string | null | undefined, now: Date, timeZone: string): MyDayUrgency {
  if (!dueAt) return "later";
  const today = dayIn(now, timeZone);
  if (DATE_ONLY.test(dueAt)) return dueAt < today ? "late" : dueAt === today ? "today" : "later";
  const at = new Date(dueAt);
  if (Number.isNaN(at.getTime())) return "later";
  if (at.getTime() < now.getTime()) return "late";
  return dayIn(at, timeZone) === today ? "today" : "later";
}

export type JobsMyDayItem = {
  jobId: string; reference: string; title: string | null; client: string | null; chapter: JourneyChapter;
  step: { key: string; label: string; lane: JourneyLane; doneWhen: string; owner: string | null; dueAt: string | null; href: string | null };
  urgency: MyDayUrgency; why: MineReason; progress: { done: number; total: number };
};
export type JobsMyDay = {
  generatedAt: string; today: string; timeZone: string;
  counts: { late: number; today: number; later: number; total: number };
  items: JobsMyDayItem[];
  /** More jobs than one reading covers: the oldest were not looked at. */
  truncated: boolean;
};

const RANK: Record<MyDayUrgency, number> = { late: 0, today: 1, later: 2 };
const dueTime = (value: string | null) => {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = Date.parse(DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
};

/** Late first, then due today, then the rest; within each the earliest due first (undated last), then by reference. */
export function orderMyDay<T extends Pick<JobsMyDayItem, "urgency" | "reference"> & { step: { dueAt: string | null } }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => RANK[a.urgency] - RANK[b.urgency] || dueTime(a.step.dueAt) - dueTime(b.step.dueAt) || a.reference.localeCompare(b.reference));
}

/** One row of My day from a job's journey (its step now) and the Jobs list row (its progress). */
export function myDayItem(journey: JourneyView, row: { progress: { done: number; total: number } }, why: MineReason, now: Date, timeZone: string): JobsMyDayItem | null {
  const step = journey.now;
  if (!step) return null;
  return {
    jobId: journey.jobId, reference: journey.reference, title: journey.title, client: journey.client, chapter: step.chapter,
    step: { key: step.key, label: step.label, lane: step.lane, doneWhen: step.doneWhen, owner: step.owner, dueAt: step.dueAt, href: step.href },
    urgency: urgencyOf(step.dueAt, now, timeZone), why, progress: row.progress,
  };
}

export function summarise(items: JobsMyDayItem[], now: Date, timeZone: string, truncated: boolean): JobsMyDay {
  const ordered = orderMyDay(items);
  const count = (urgency: MyDayUrgency) => ordered.filter((item) => item.urgency === urgency).length;
  return {
    generatedAt: now.toISOString(), today: dayIn(now, timeZone), timeZone,
    counts: { late: count("late"), today: count("today"), later: count("later"), total: ordered.length },
    items: ordered, truncated,
  };
}

/** Who is asking: their name, their seats (workspace and per job), and their time zone (as the reminders' My day reads it). */
export async function readViewer(db: Db, workspaceId: string, userId: string, jobIds: readonly string[], now: Date): Promise<MyDayViewer> {
  const me = (await db.query<{ id: string; name: string | null }>(
    `SELECT membership.id, account.display_name AS name FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id
      WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active'`, [workspaceId, userId])).rows[0];
  if (!me) throw new NotFoundException("Workspace not found.");
  const seats = laneSeats(await designTeamConfig(db, workspaceId));
  const codes = (await db.query<{ code: string }>(
    `SELECT DISTINCT role.code FROM effective_member_roles assigned
       JOIN roles role ON role.workspace_id = assigned.workspace_id AND role.id = assigned.role_id
      WHERE assigned.workspace_id = $1 AND assigned.membership_id = $2`, [workspaceId, me.id])).rows.map((row) => row.code);
  const sharedLanes = new Set([...lanesOf(codes, seats)].filter((lane) => SHARED_LANES.includes(lane)));
  // My seats on each job: the team on its case (or the case of its opportunity) and the assignments on its project.
  const onJobs = jobIds.length ? (await db.query<{ jobId: string; roles: string[] | null; manager: boolean }>(
    `SELECT link.job_id::text AS "jobId", array_remove(array_agg(DISTINCT seat.key), NULL) AS roles, bool_or(assignment.is_manager) AS manager
       FROM job_identity_links link
       JOIN project_assignments assignment ON assignment.workspace_id = link.workspace_id AND assignment.membership_id = $2 AND assignment.active AND (
             (link.record_type = 'case' AND assignment.case_id::text = link.record_id)
          OR (link.record_type = 'project' AND assignment.project_id::text = link.record_id)
          OR (link.record_type = 'opportunity' AND assignment.case_id IN (SELECT pre_case.id FROM pre_project_cases pre_case
                WHERE pre_case.workspace_id = link.workspace_id AND pre_case.opportunity_id::text = link.record_id))
          OR (link.record_type = 'case' AND assignment.project_id IN (SELECT project.id FROM delivery_projects project
                WHERE project.workspace_id = link.workspace_id AND project.case_id::text = link.record_id AND project.cancelled_at IS NULL)))
       LEFT JOIN LATERAL unnest(assignment.role_keys) AS seat(key) ON true
      WHERE link.workspace_id = $1 AND link.status = 'active' AND link.job_id = ANY($3::uuid[])
      GROUP BY link.job_id`, [workspaceId, me.id, [...jobIds]])).rows : [];
  const jobLanes = new Map(onJobs.map((row) => [row.jobId, lanesOf([...(row.roles ?? []), ...(row.manager ? [PROJECT_MANAGER_SEAT] : [])], seats)] as const));
  const clock = await readClock(db, workspaceId, now);
  const person = (await readStaffPeople(db, workspaceId, [me.id], await readReminderSettings(db, workspaceId), clock.timeZone)).get(me.id);
  return { membershipId: me.id, name: me.name, sharedLanes, jobLanes, timeZone: person?.timeZone ?? clock.timeZone };
}

/** The Jobs list is read a page at a time; My day looks at this many jobs at most (newest first). */
export const MY_DAY_PAGE = 100;
export const MY_DAY_MAX_JOBS = 1000;

export type MyDayDeps = {
  jobs: Pick<JobsService, "overview" | "journey">;
  access: Pick<WorkspaceAccessService, "asMember">;
  now?: () => Date;
};

/**
 * `GET jobs/my-day`. The Jobs list's reading decides what this person may see (its permission and scope, a refusal
 * included); the job page's reading gives each candidate's step now with its lane, done-when and link.
 */
export async function readJobsMyDay(deps: MyDayDeps, actor: RequestActor, workspaceId: string): Promise<JobsMyDay> {
  const now = deps.now?.() ?? new Date();
  type Row = Awaited<ReturnType<JobsService["overview"]>>["items"][number];
  const rows: Row[] = [];
  let total = 0;
  for (let offset = 0; offset < MY_DAY_MAX_JOBS; offset += MY_DAY_PAGE) {
    const page = await deps.jobs.overview(actor, workspaceId, String(MY_DAY_PAGE), String(offset));
    rows.push(...page.items);
    total = page.total;
    if (!page.items.length || offset + MY_DAY_PAGE >= page.total) break;
  }
  const open = rows.filter((row) => row.now && row.chapter);
  const viewer = await deps.access.asMember(actor, workspaceId, (client, user) => readViewer(client, workspaceId, user.userId, open.map((row) => row.id), now));
  const items: JobsMyDayItem[] = [];
  for (const row of open.filter((entry) => couldBeMine(entry.id, entry.now?.owner ?? null, viewer, entry.now?.ownerId ?? null))) {
    let journey: JourneyView;
    try { journey = await deps.jobs.journey(actor, workspaceId, row.id); }
    catch (error) {
      // Moved out of this person's sight since the list was read: not theirs any more.
      if (error instanceof NotFoundException) continue;
      throw error;
    }
    const why = journey.now ? mineBecause(row.id, journey.now, viewer) : null;
    const item = why ? myDayItem(journey, row, why, now, viewer.timeZone) : null;
    if (item) items.push(item);
  }
  return summarise(items, now, viewer.timeZone, total > rows.length);
}
