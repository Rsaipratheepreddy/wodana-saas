import { toMinor } from "@/lib/money-exact";
import type { Health, HealthReason, ProjectDetail, ProjectOverview, ProjectStage } from "./types";

/**
 * A project read as a record (§5c D.7): the status strip's values and the stage timeline, from the project and
 * its Overview read. A value that isn't known is null, so the page leaves it out.
 */
const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** How many days the current or a coming stage is past the end of its planned work (0 when it isn't). */
export function stageLateDays(stage: Pick<ProjectStage, "id" | "status">, plan: ProjectOverview["stagePlan"] | undefined, today: string | undefined) {
  const window = plan?.[stage.id];
  if (!today || !window?.end || window.open <= 0 || !(stage.status === "current" || stage.status === "upcoming") || window.end >= today) return 0;
  return daysBetween(window.end, today);
}

/** The work done across the plan: closed items of all items planned per stage. */
export function workDone(overview: Pick<ProjectOverview, "stagePlan"> | null | undefined) {
  if (!overview) return null;
  const rows = Object.values(overview.stagePlan);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  if (!total) return null;
  return { done: total - rows.reduce((sum, row) => sum + row.open, 0), total };
}

/** Share (whole percent) of `part` in `whole`, in exact minor units; null when the whole is zero or unknown. */
export function share(part: string | null | undefined, whole: string | null | undefined, currency: string) {
  if (part === null || part === undefined || whole === null || whole === undefined) return null;
  const total = toMinor(whole, currency);
  if (total <= 0) return null;
  return Math.round((toMinor(part, currency) * 100) / total);
}

/**
 * How far the project is, in whole percent: the plan's own measure (packages weighed by value), never below the
 * stages already behind it ((current stage number − 1) of the stages, the same floor as the client portal).
 */
export function projectPercent(detail: Pick<ProjectDetail, "progress" | "stages"> & { project: Pick<ProjectDetail["project"], "status"> }) {
  if (detail.project.status === "completed") return 100;
  const current = detail.stages.find((stage) => stage.status === "current");
  const floor = current && detail.stages.length ? Math.round((current.position / detail.stages.length) * 100) : null;
  if (detail.progress === null || detail.progress === undefined) return floor;
  return Math.max(detail.progress, floor ?? 0);
}

export type ProjectStripValues = {
  health: Health; reasons: HealthReason[];
  stage: { name: string; position: number; count: number } | null;
  handover: { date: string; days: number } | null;
  work: { done: number; total: number } | null;
  /** How far the project is (percent), never below the stages behind it. */
  progress: number | null;
  /** Spent and committed of the cost budget, when a budget is set and the person sees costs. */
  budgetUsed: number | null;
  /** Received of the agreed value, when the person sees the client side. */
  paid: number | null;
};

/** The status strip: health from the records, the stage, the handover and how far off it is, work done, budget and payments. */
export function projectStrip(detail: ProjectDetail, overview: ProjectOverview | null | undefined): ProjectStripValues {
  const { project } = detail;
  const current = detail.stages.find((stage) => stage.status === "current");
  const money = overview?.money;
  const spent = money?.spent !== null && money?.spent !== undefined ? (toMinor(money.spent, money.costCurrency) + toMinor(money.committed ?? "0", money.costCurrency)) : null;
  return {
    health: overview?.health?.health ?? project.health,
    reasons: overview?.health?.reasons ?? [],
    stage: current ? { name: current.name, position: current.position + 1, count: detail.stages.length } : null,
    handover: project.promiseDate && overview ? { date: project.promiseDate, days: daysBetween(overview.today, project.promiseDate) } : null,
    work: workDone(overview),
    progress: project.status === "cancelled" ? null : projectPercent(detail),
    budgetUsed: money?.budget && spent !== null && money.costCurrency ? (() => { const budget = toMinor(money.budget, money.costCurrency); return budget > 0 ? Math.round((spent * 100) / budget) : null; })() : null,
    paid: money ? share(money.received, money.agreed, money.currency) : null,
  };
}

export type ProjectStep = {
  id: string; name: string; state: "done" | "current" | "upcoming" | "skipped" | "blocked";
  /** Done on (ISO), or the planned window of its work (YYYY-MM-DD). */
  doneAt: string | null; plannedStart: string | null; plannedEnd: string | null;
  lateDays: number; person: { id: string; name: string } | null; role: string | null;
};

/** The project's stages as steps: done with its date, the current one with who and its plan, the ones to come. */
export function projectTimeline(detail: ProjectDetail, overview: ProjectOverview | null | undefined): ProjectStep[] {
  const held = detail.project.status === "on_hold";
  return detail.stages.map((stage) => {
    const window = overview?.stagePlan[stage.id];
    const owner = stage.owner ?? (stage.ownerRole ? detail.team.find((role) => role.role === stage.ownerRole)?.member ?? null : null);
    return {
      id: stage.id, name: stage.name, state: stage.status === "current" && held ? "blocked" : stage.status,
      doneAt: stage.status === "done" ? stage.completedAt : null,
      plannedStart: stage.status === "done" || stage.status === "skipped" ? null : window?.start ?? null,
      plannedEnd: stage.status === "done" || stage.status === "skipped" ? null : window?.end ?? null,
      lateDays: stageLateDays(stage, overview?.stagePlan, overview?.today),
      person: owner ? { id: owner.membershipId, name: owner.name } : null,
      role: stage.ownerRole,
    };
  });
}

/** The people on the project, one row each with every role they hold, in the order roles are set up. */
export function projectPeople(detail: ProjectDetail) {
  const people = new Map<string, { id: string; name: string; email: string | null; roles: string[] }>();
  for (const role of detail.team) {
    if (!role.member) continue;
    const entry = people.get(role.member.membershipId) ?? { id: role.member.membershipId, name: role.member.name, email: role.member.email ?? null, roles: [] };
    entry.roles.push(role.label);
    people.set(role.member.membershipId, entry);
  }
  return { named: [...people.values()], missing: detail.team.filter((role) => !role.member).map((role) => role.label) };
}
