import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ProjectRole } from "./project-checks";
import { SUPPLY, type Supply } from "./project-scope";
import { workdays, type WorkCalendar } from "./work-calendar";

type Db = Pick<PoolClient, "query">;

/**
 * One step of a package's standard work: how many working days it takes, which team role does it, the
 * project stage it belongs to, whether it starts with the step before (otherwise it follows it), and
 * whether the package's materials must be there when it starts.
 */
export type TemplateTask = { title: string; days: number; role: string | null; stage: string | null; withPrevious: boolean; needsMaterials?: boolean };
export type WorkTemplate = { supply: Supply; tasks: TemplateTask[]; version: number };

const task = (title: string, days: number, role: string | null, stage: string | null, withPrevious = false, needsMaterials = false): TemplateTask =>
  ({ title, days, role, stage, withPrevious, ...(needsMaterials ? { needsMaterials } : {}) });

/** The standard work for each way a package is delivered. Firms change them in Settings → Projects. */
export const DEFAULT_WORK_TEMPLATES: Record<Supply, TemplateTask[]> = {
  make: [
    task("Shop drawings", 5, "technical_designer", "drawings"),
    task("Client approves the drawings", 3, "designer", "drawings"),
    task("Order the materials", 2, "procurement", "procurement"),
    task("Production", 15, "factory_lead", "production", false, true),
    task("Quality check", 1, "factory_lead", "production"),
    task("Deliver to site", 1, "installation_lead", "installation"),
    task("Install", 5, "installation_lead", "installation"),
  ],
  buy: [
    task("Place the order", 1, "procurement", "procurement"),
    task("Supplier confirms", 2, "procurement", "procurement"),
    task("Delivered to site", 10, "procurement", "installation"),
    task("Fit on site", 3, "installation_lead", "installation", false, true),
  ],
  ready_made: [
    task("Place the order", 1, "procurement", "procurement"),
    task("Delivered", 14, "procurement", "installation"),
    task("Place and check", 1, "installation_lead", "installation", false, true),
  ],
  subcontract: [
    task("Agree scope and price with the subcontractor", 3, "procurement", "procurement"),
    task("Work done", 10, "site_supervisor", "installation"),
    task("Inspect the work", 1, "site_supervisor", "snagging"),
  ],
  client: [
    task("Tell the client what to supply and when", 1, "account_manager", "procurement"),
    task("Received and checked on site", 5, "site_supervisor", "installation"),
    task("Install", 2, "installation_lead", "installation", false, true),
  ],
  site_work: [
    task("Site ready", 2, "site_supervisor", "installation"),
    task("Work done", 5, "site_supervisor", "installation", false, true),
    task("Inspect the work", 1, "site_supervisor", "snagging"),
  ],
};

/** The workspace's templates, created from the defaults the first time they're read (roles it doesn't have are left open). */
export async function ensureWorkTemplates(db: Db, workspaceId: string, roles: ProjectRole[]): Promise<WorkTemplate[]> {
  const known = new Set(roles.map((role) => role.key));
  for (const supply of SUPPLY)
    await db.query(`INSERT INTO work_templates (workspace_id, supply, tasks) VALUES ($1, $2, $3::jsonb) ON CONFLICT (workspace_id, supply) DO NOTHING`,
      [workspaceId, supply, JSON.stringify(DEFAULT_WORK_TEMPLATES[supply].map((item) => ({ ...item, role: item.role && known.has(item.role) ? item.role : null })))]);
  const rows = (await db.query<WorkTemplate>(`SELECT supply, tasks, version FROM work_templates WHERE workspace_id = $1`, [workspaceId])).rows;
  return SUPPLY.map((supply) => rows.find((row) => row.supply === supply)!);
}

export function parseTemplateTasks(value: unknown, roles: ProjectRole[]): TemplateTask[] {
  if (!Array.isArray(value) || value.length > 30) throw new BadRequestException("A template has up to 30 tasks.");
  const known = new Set(roles.map((role) => role.key));
  return value.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title || title.length > 200) throw new BadRequestException(`Name task ${index + 1}.`);
    const days = Number(item.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new BadRequestException(`"${title}" takes a whole number of working days, from 1 to 365.`);
    const role = item.role === null || item.role === undefined || item.role === "" ? null : String(item.role);
    if (role && !known.has(role)) throw new BadRequestException(`Choose one of the team roles for "${title}".`);
    const stage = typeof item.stage === "string" && /^[a-z0-9_]{1,64}$/.test(item.stage) ? item.stage : null;
    return { title, days, role, stage, withPrevious: index > 0 && item.withPrevious === true, ...(item.needsMaterials === true ? { needsMaterials: true } : {}) };
  });
}

/**
 * The template laid out from a start date on working days: each task follows the one before it, or
 * starts with it; a task takes its days from its first working day.
 */
export function schedulePackage(tasks: TemplateTask[], startDate: string, calendar: WorkCalendar) {
  const math = workdays(calendar);
  const planned: Array<TemplateTask & { startDate: string; dueDate: string }> = [];
  for (const item of tasks) {
    const previous = planned.at(-1);
    const start = !previous ? math.onOrAfter(startDate) : item.withPrevious ? previous.startDate : math.next(previous.dueDate);
    planned.push({ ...item, startDate: start, dueDate: math.shift(start, item.days - 1) });
  }
  return planned;
}
