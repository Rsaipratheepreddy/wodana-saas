import type { PoolClient } from "pg";
import { composeClientView, readBrand, type ClientPhoto, type ClientView } from "./daily-progress";
import { MAX_RANGE_DAYS, shiftDay } from "./day-cards";

type Db = Pick<PoolClient, "query">;

/** One day of a progress report: the client's card of each report that day, merged. */
export type ReportDay = {
  date: string; summary: string; noWork: boolean; photos: ClientPhoto[];
  completed: string[]; advanced: Array<{ title: string; progress: number }>; next: string[]; notes: string[];
};

/**
 * A progress report for a period (the "Progress report" PDF): a cover with the project, the period and where it
 * stands, then one section per day. Built only from the client's card of each approved day — as it went when it
 * was sent, or as it would go — so nothing internal (crew, costs, materials, internal issues, notes) can be printed.
 * Days kept internal or taken off the client's page are left out.
 */
export type ProgressReport = {
  brand: { name: string; logoUrl: string | null };
  project: { name: string; reference: string | null; stage: string | null; stageNumber: number | null; stageCount: number | null; progress: number | null; handoverDate: string | null };
  from: string; to: string;
  days: ReportDay[];
};

/** Several reports' cards for one day as one: summaries in order, lists without repeats, the photos of all (at most 12). */
export function mergeDayViews(date: string, views: Array<Pick<ClientView, "summary" | "noWork" | "hero" | "photos" | "completed" | "advanced" | "next" | "notes">>): ReportDay {
  const unique = (items: string[]) => [...new Set(items.map((item) => item.trim()).filter(Boolean))];
  const advanced = new Map<string, number>();
  for (const view of views) for (const item of view.advanced ?? []) advanced.set(item.title, Math.max(advanced.get(item.title) ?? 0, item.progress));
  const completed = unique(views.flatMap((view) => view.completed ?? []));
  const photos: ClientPhoto[] = [];
  for (const view of views) for (const photo of [view.hero, ...(view.photos ?? [])]) if (photo && !photos.some((item) => item.id === photo.id)) photos.push(photo);
  return {
    date,
    summary: unique(views.map((view) => view.summary ?? "")).join("\n\n"),
    noWork: views.length > 0 && views.every((view) => view.noWork),
    photos: photos.slice(0, 12),
    completed,
    advanced: [...advanced].filter(([title]) => !completed.includes(title)).map(([title, progress]) => ({ title, progress })),
    next: unique(views.flatMap((view) => view.next ?? [])),
    notes: unique(views.flatMap((view) => view.notes ?? [])),
  };
}

export async function readProgressReport(db: Db, workspaceId: string, projectId: string, input: { from: string; to: string }): Promise<ProgressReport | null> {
  let { from } = input;
  const { to } = input;
  if (from > to) from = to;
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > (MAX_RANGE_DAYS - 1) * 86_400_000) from = shiftDay(to, -(MAX_RANGE_DAYS - 1));
  const project = (await db.query<{ name: string; reference: string | null; promiseDate: string | null }>(
    `SELECT name, reference, promise_date::text AS "promiseDate" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0];
  if (!project) return null;
  const reports = (await db.query<{ id: string; date: string; view: ClientView | null }>(
    `SELECT id, report_date::text AS date, client_view AS view FROM site_reports
      WHERE workspace_id = $1 AND project_id = $2 AND report_date BETWEEN $3::date AND $4::date AND status = 'approved' AND delivery <> 'internal' AND client_hidden_at IS NULL
      ORDER BY report_date, created_at`, [workspaceId, projectId, from, to])).rows;
  const byDay = new Map<string, ClientView[]>();
  let latest: ClientView | null = null;
  for (const report of reports) {
    const view = report.view ?? await composeClientView(db, workspaceId, report.id);
    if (!view) continue;
    byDay.set(report.date, [...(byDay.get(report.date) ?? []), view]);
    latest = view;
  }
  const brand = await readBrand(db, workspaceId);
  return {
    brand: { name: brand.name, logoUrl: brand.logoUrl },
    project: { name: project.name, reference: project.reference, stage: latest?.project.stage ?? null, stageNumber: latest?.project.stageNumber ?? null,
      stageCount: latest?.project.stageCount ?? null, progress: latest?.project.progress ?? null, handoverDate: project.promiseDate },
    from, to,
    days: [...byDay].map(([date, views]) => mergeDayViews(date, views)),
  };
}
