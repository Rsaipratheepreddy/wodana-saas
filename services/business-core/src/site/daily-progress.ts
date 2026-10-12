import type { PoolClient } from "pg";
import { readProgress, type WorkStatus } from "../project-core/project-work";
import { readCalendar, workdays } from "../project-core/work-calendar";

type Db = Pick<PoolClient, "query">;

/**
 * Daily progress: what the supervisor is asked about (today's planned work, tomorrow's), and the client's card
 * written from a report. The card is built field by field from named columns only — never notes, costs, crew,
 * materials or internal issues — so nothing internal can reach the client by accident.
 */

/** One of today's planned tasks, with how far it is. */
export type TodayTask = {
  id: string; number: number; title: string; status: WorkStatus; progress: number | null; startDate: string | null; dueDate: string | null;
  overdue: boolean; packageName: string | null; assigneeName: string | null;
};

/** The quick steps a supervisor taps for a task's progress. "Started" is recorded as 10. */
export const PROGRESS_STEPS = [10, 25, 50, 75, 100] as const;

const LEAF = `NOT EXISTS (SELECT 1 FROM work_items child WHERE child.workspace_id = item.workspace_id AND child.parent_id = item.id AND child.status <> 'cancelled')`;
const TASK_COLUMNS = `item.id, item.number, item.title, item.status, item.progress, item.start_date::text AS "startDate", item.due_date::text AS "dueDate",
  (item.status NOT IN ('done', 'cancelled') AND coalesce(item.due_date < $3::date, false)) AS overdue, package.name AS "packageName",
  coalesce(person.display_name, person.primary_email) AS "assigneeName"`;
const TASK_JOINS = `FROM work_items item
  LEFT JOIN project_packages package ON package.workspace_id = item.workspace_id AND package.id = item.package_id
  LEFT JOIN workspace_memberships membership ON membership.workspace_id = item.workspace_id AND membership.id = item.assignee_membership_id
  LEFT JOIN users person ON person.id = membership.user_id`;

/**
 * Today's planned work on a project, from the plan: tasks (never their parents: the subtasks are the work) that
 * should have started by the day — scheduled for it, overdue, or already in progress — and the ones finished that
 * day. Late and running work first.
 */
export async function readTodayPlan(db: Db, workspaceId: string, projectId: string, day: string): Promise<TodayTask[]> {
  return (await db.query<TodayTask>(
    `SELECT ${TASK_COLUMNS} ${TASK_JOINS}
       JOIN workspaces workspace ON workspace.id = item.workspace_id
      WHERE item.workspace_id = $1 AND item.project_id = $2 AND item.type = 'task' AND ${LEAF}
        AND ((item.status NOT IN ('done', 'cancelled') AND (item.status IN ('in_progress', 'in_review') OR coalesce(item.start_date, item.due_date) <= $3::date))
          OR (item.status = 'done' AND (item.completed_at AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date = $3::date))
      ORDER BY (item.status = 'done'), coalesce(item.due_date < $3::date, false) DESC, coalesce(item.due_date, item.start_date) NULLS LAST, item.number
      LIMIT 40`, [workspaceId, projectId, day])).rows;
}

/** The next working day after `day` (the workspace's working week and holidays), and the plan's open work for it. */
export async function readTomorrowPlan(db: Db, workspaceId: string, projectId: string, day: string) {
  const next = workdays(await readCalendar(db, workspaceId)).next(day);
  const tasks = (await db.query<{ id: string; title: string }>(
    `SELECT item.id, item.title ${TASK_JOINS}
      WHERE item.workspace_id = $1 AND item.project_id = $2 AND item.type = 'task' AND ${LEAF} AND item.status NOT IN ('done', 'cancelled')
        AND coalesce(item.start_date, item.due_date) <= $3::date
      ORDER BY coalesce(item.due_date, item.start_date) NULLS LAST, item.number LIMIT 8`, [workspaceId, projectId, next])).rows;
  return { day: next, tasks };
}

/** A photo as the client sees it: where it was taken and whether it's a before or after of another. */
export type ClientPhoto = { id: string; area: string | null; phase: "before" | "after" | null; pairId: string | null };

/**
 * Exactly what the client gets for a day: the project and where it stands, the summary, the photos the manager
 * picked (the hero first), what was finished, what moved forward, what's next and anything the team chose to tell
 * them. Stored as the report's immutable `client_view` when it's sent.
 */
export type ClientView = {
  reportId: string;
  date: string;
  project: { name: string; reference: string | null; stage: string | null; stageNumber: number | null; stageCount: number | null; progress: number | null;
    handoverDate: string | null; daysToHandover: number | null };
  brand: { name: string; logoUrl: string | null; accentColor: string | null };
  summary: string;
  noWork: boolean;
  hero: ClientPhoto | null;
  photos: ClientPhoto[];
  completed: string[];
  advanced: Array<{ title: string; progress: number }>;
  next: string[];
  notes: string[];
};

/** The facts a summary is written from: nothing a client shouldn't read. */
export type SummaryFacts = {
  project: string; stage: string | null; progress: number | null; noWork: boolean; completed: string[]; advanced: Array<{ title: string; progress: number }>;
  next: string[]; areas: string[]; photos: number; notes: string[];
};

const PHOTOS = 6;

/** "a", "a and b", "a, b and c". */
export function joinList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The friendly words a report gets without AI (or when AI is off or out of credits): two to four sentences. */
export function templateSummary(facts: SummaryFacts) {
  const next = facts.next.slice(0, 3);
  if (facts.noWork) return [`There was no work on site today.`, next.length ? `Next up: ${joinList(next)}.` : ""].filter(Boolean).join(" ");
  const sentences: string[] = [];
  if (facts.completed.length) sentences.push(`Today the team finished ${joinList(facts.completed.slice(0, 4))}.`);
  if (facts.advanced.length) sentences.push(`${facts.completed.length ? "Work also moved forward on" : "Today the team moved forward on"} ${joinList(facts.advanced.slice(0, 3).map((item) => item.title))}.`);
  if (!sentences.length) sentences.push(facts.areas.length ? `The team was on site today, working in ${joinList(facts.areas.slice(0, 3))}.` : "The team was on site today.");
  if (facts.progress) sentences.push(facts.stage ? `${facts.project} is ${facts.progress}% complete, in the ${facts.stage} stage.` : `${facts.project} is ${facts.progress}% complete.`);
  if (next.length) sentences.push(`Next up: ${joinList(next)}.`);
  return sentences.slice(0, 4).join(" ");
}

type ReportFacts = {
  id: string; projectId: string; caseId: string; reportDate: string; noWorkReason: string; summary: string; heroPhotoId: string | null;
  projectName: string; reference: string | null; promiseDate: string | null;
};

async function reportFacts(db: Db, workspaceId: string, reportId: string) {
  return (await db.query<ReportFacts>(
    `SELECT report.id, report.project_id AS "projectId", project.case_id AS "caseId", report.report_date::text AS "reportDate", report.no_work_reason AS "noWorkReason",
            report.client_summary AS summary, report.hero_photo_id AS "heroPhotoId", project.name AS "projectName", project.reference, project.promise_date::text AS "promiseDate"
       FROM site_reports report JOIN delivery_projects project ON project.workspace_id = report.workspace_id AND project.id = report.project_id
      WHERE report.workspace_id = $1 AND report.id = $2`, [workspaceId, reportId])).rows[0];
}

/** What the day's report says for the client: finished and moved-forward work, next, the client-visible notes, the picked photos. */
async function clientParts(db: Db, workspaceId: string, report: ReportFacts) {
  const tasks = (await db.query<{ title: string; progress: number; previous: number | null }>(
    `SELECT item.title, entry.progress, entry.previous FROM site_report_tasks entry JOIN work_items item ON item.workspace_id = entry.workspace_id AND item.id = entry.work_item_id
      WHERE entry.workspace_id = $1 AND entry.report_id = $2 AND NOT entry.hidden ORDER BY entry.position, item.number`, [workspaceId, report.id])).rows;
  const next = (await db.query<{ title: string }>(
    `SELECT title FROM site_report_next WHERE workspace_id = $1 AND report_id = $2 AND NOT hidden ORDER BY position LIMIT 6`, [workspaceId, report.id])).rows.map((row) => row.title);
  const notes = (await db.query<{ description: string }>(
    `SELECT description FROM site_report_issues WHERE workspace_id = $1 AND report_id = $2 AND NOT internal ORDER BY position LIMIT 3`, [workspaceId, report.id])).rows.map((row) => row.description);
  const photos = (await db.query<ClientPhoto>(
    `SELECT photo.id, room.name AS area, photo.phase, photo.pair_id AS "pairId"
       FROM site_report_photos photo
       LEFT JOIN pre_project_rooms room ON room.workspace_id = photo.workspace_id AND room.case_id = $3 AND room.id = photo.area_id
      WHERE photo.workspace_id = $1 AND photo.report_id = $2 AND photo.for_client AND photo.mime_type LIKE 'image/%'
      ORDER BY photo.id = $4 DESC, photo.position, photo.created_at LIMIT ${PHOTOS}`, [workspaceId, report.id, report.caseId, report.heroPhotoId])).rows;
  // A pair is only a pair when both halves go to the client.
  const shown = new Set(photos.map((photo) => photo.id));
  const picked = photos.map((photo) => (photo.pairId && !shown.has(photo.pairId) ? { ...photo, pairId: null } : photo));
  return {
    completed: tasks.filter((task) => task.progress === 100).map((task) => task.title),
    advanced: tasks.filter((task) => task.progress < 100 && task.progress > (task.previous ?? 0)).map((task) => ({ title: task.title, progress: task.progress })),
    next, notes, photos: picked,
  };
}

async function projectStanding(db: Db, workspaceId: string, projectId: string) {
  const stages = (await db.query<{ name: string; status: string }>(
    `SELECT name, status FROM project_stages WHERE workspace_id = $1 AND project_id = $2 AND status <> 'skipped' ORDER BY position`, [workspaceId, projectId])).rows;
  const current = stages.findIndex((stage) => stage.status === "current");
  const progress = (await readProgress(db, workspaceId, projectId)).project;
  return { stage: current >= 0 ? stages[current].name : null, stageNumber: current >= 0 ? current + 1 : null, stageCount: stages.length || null, progress };
}

/** The facts the summary is written from (the report's own, nothing internal). */
export async function readSummaryFacts(db: Db, workspaceId: string, reportId: string): Promise<SummaryFacts | null> {
  const report = await reportFacts(db, workspaceId, reportId);
  if (!report) return null;
  const parts = await clientParts(db, workspaceId, report);
  const standing = await projectStanding(db, workspaceId, report.projectId);
  const areas = (await db.query<{ name: string }>(
    `SELECT DISTINCT room.name FROM site_report_photos photo JOIN pre_project_rooms room ON room.workspace_id = photo.workspace_id AND room.case_id = $3 AND room.id = photo.area_id
      WHERE photo.workspace_id = $1 AND photo.report_id = $2 ORDER BY room.name LIMIT 4`, [workspaceId, reportId, report.caseId])).rows.map((row) => row.name);
  const photoCount = (await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM site_report_photos WHERE workspace_id = $1 AND report_id = $2`, [workspaceId, reportId])).rows[0].count;
  return { project: report.projectName, stage: standing.stage, progress: standing.progress, noWork: Boolean(report.noWorkReason.trim()), completed: parts.completed,
    advanced: parts.advanced, next: parts.next, areas, photos: photoCount, notes: parts.notes };
}

/** The tenant's brand as the client sees it (the branding record only). */
export async function readBrand(db: Db, workspaceId: string): Promise<ClientView["brand"]> {
  const row = (await db.query<{ name: string; loginSlug: string | null; logoUrl: string | null; logoAssetId: string | null; accentColor: string | null }>(
    `SELECT coalesce(branding.display_name, workspace.name) AS name, branding.login_slug AS "loginSlug", branding.logo_url AS "logoUrl", branding.logo_asset_id AS "logoAssetId",
            branding.primary_color AS "accentColor"
       FROM workspaces workspace LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id WHERE workspace.id = $1`, [workspaceId])).rows[0];
  const logoUrl = row?.logoAssetId && row.loginSlug ? `/api/auth/tenant-logo/${encodeURIComponent(row.loginSlug)}?v=${row.logoAssetId}`
    : row?.logoUrl && /^https:\/\//.test(row.logoUrl) ? row.logoUrl : null;
  return { name: row?.name ?? "", logoUrl, accentColor: row?.accentColor && /^#[0-9a-f]{6}$/i.test(row.accentColor) ? row.accentColor : null };
}

const DAY = 86_400_000;

/** The client's card for a report, as it would be sent now. */
export async function composeClientView(db: Db, workspaceId: string, reportId: string): Promise<ClientView | null> {
  const report = await reportFacts(db, workspaceId, reportId);
  if (!report) return null;
  const parts = await clientParts(db, workspaceId, report);
  const standing = await projectStanding(db, workspaceId, report.projectId);
  const facts: SummaryFacts = { project: report.projectName, stage: standing.stage, progress: standing.progress, noWork: Boolean(report.noWorkReason.trim()),
    completed: parts.completed, advanced: parts.advanced, next: parts.next, areas: [...new Set(parts.photos.map((photo) => photo.area).filter((area): area is string => Boolean(area)))],
    photos: parts.photos.length, notes: parts.notes };
  const [hero, ...photos] = parts.photos;
  return {
    reportId: report.id, date: report.reportDate,
    project: { name: report.projectName, reference: report.reference, ...standing, handoverDate: report.promiseDate,
      daysToHandover: report.promiseDate ? Math.round((Date.parse(`${report.promiseDate}T00:00:00Z`) - Date.parse(`${report.reportDate}T00:00:00Z`)) / DAY) : null },
    brand: await readBrand(db, workspaceId),
    summary: report.summary.trim() || templateSummary(facts),
    noWork: facts.noWork,
    hero: hero ?? null, photos,
    completed: parts.completed, advanced: parts.advanced, next: parts.next, notes: parts.notes,
  };
}

/**
 * The email words of a sent day, as the day's card reads: the summary, then one block per part (a heading line and
 * one line per item) — done today, moving forward, next up and anything the team chose to tell. The branded email
 * (renderBrandedEmail) makes each block a paragraph and keeps its lines.
 */
export function clientEmailNote(view: ClientView) {
  const block = (title: string, items: string[]) => (items.length ? [title, ...items.map((item) => `• ${item}`)].join("\n") : "");
  return [
    view.summary,
    block("Done today", view.completed.slice(0, 8)),
    block("Moving forward", (view.advanced ?? []).slice(0, 6).map((item) => `${item.title} · ${item.progress}%`)),
    block("Next up", view.next.slice(0, 5)),
    block("Good to know", (view.notes ?? []).slice(0, 3)),
  ].filter(Boolean).join("\n\n");
}

/** The prompt Woddy writes a client summary from: the facts as data, nothing else. */
export const SUMMARY_SYSTEM = [
  "You are Woddy, writing today's short progress note from an interior design and fit-out firm to its client, the homeowner.",
  "Write 2 to 4 warm, plain sentences from the supplied facts only: what was finished or moved forward today and what comes next.",
  "Never invent anything. Never mention prices, costs, money, people's names, crews, suppliers, problems or internal notes. No greeting and no sign-off.",
  "Reply as {\"summary\": \"...\"}.",
].join("\n");

/** Checks Woddy's answer: one summary of a sensible length. */
export function validateSummary(value: unknown) {
  const summary = value && typeof value === "object" ? (value as { summary?: unknown }).summary : null;
  if (typeof summary !== "string") throw new Error("No summary.");
  const text = summary.replace(/\s+/g, " ").trim();
  if (text.length < 20 || text.length > 900) throw new Error("The summary doesn't fit.");
  return text;
}
