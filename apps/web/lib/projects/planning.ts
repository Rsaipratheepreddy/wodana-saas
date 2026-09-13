export const DEMO_TODAY = "2026-09-07";
export const PLAN_STORAGE_KEY = "wodana:projects:demo:plan:v1";
export const trades = ["Survey", "Electrical", "Plumbing", "Joinery", "Finishes"] as const;
export type Trade = typeof trades[number];
export type WorkKind = "site" | "factory";
export type WorkStatus = "draft" | "booked" | "in-progress" | "complete";
export type PlanTask = {
  id: string; title: string; boq: string; area: string; trade: Trade; kind: WorkKind;
  start: string; end: string; teamId: string; status: WorkStatus; progress: number;
  dependencyId: string; drawings: boolean; materials: boolean; access: boolean; notes: string;
};
export type PlanTeam = { id: string; name: string; initials: string; lead: string; size: number; trade: Trade; kind: WorkKind };
export type ResourceBooking = { id: string; teamId: string; title: string; project: string; start: string; end: string; type: "other-project" | "leave" };

export const planTeams: PlanTeam[] = [
  { id: "survey", name: "Survey team", initials: "ST", lead: "Omar Hassan", size: 2, trade: "Survey", kind: "site" },
  { id: "electrical", name: "Electrical team", initials: "ET", lead: "Arun Kumar", size: 4, trade: "Electrical", kind: "site" },
  { id: "plumbing", name: "Plumbing team", initials: "PT", lead: "Faisal Ali", size: 3, trade: "Plumbing", kind: "site" },
  { id: "factory-a", name: "Joinery team A", initials: "JA", lead: "Ravi Menon", size: 6, trade: "Joinery", kind: "factory" },
  { id: "factory-b", name: "Joinery team B", initials: "JB", lead: "Joseph D’Souza", size: 5, trade: "Joinery", kind: "factory" },
  { id: "finishes", name: "Finishes team", initials: "FT", lead: "Bilal Ahmed", size: 4, trade: "Finishes", kind: "site" },
  { id: "installation", name: "Installation team", initials: "IT", lead: "Suresh Nair", size: 4, trade: "Joinery", kind: "site" },
];
export const otherBookings: ResourceBooking[] = [
  { id: "hills-joinery", teamId: "factory-a", title: "Wardrobe fabrication", project: "Dubai Hills residence", start: "2026-09-07", end: "2026-09-09", type: "other-project" },
  { id: "marina-finishes", teamId: "finishes", title: "Final paint & touch-ups", project: "Marina apartment", start: "2026-09-07", end: "2026-09-09", type: "other-project" },
  { id: "business-install", teamId: "installation", title: "Reception installation", project: "Business Bay office", start: "2026-09-07", end: "2026-09-10", type: "other-project" },
  { id: "install-leave", teamId: "installation", title: "Team unavailable", project: "Scheduled time off", start: "2026-09-12", end: "2026-09-12", type: "leave" },
];
export const seedTasks: PlanTask[] = [
  { id: "survey-task", title: "Site survey & setting out", boq: "PRE-01", area: "Whole villa", trade: "Survey", kind: "site", start: "2026-09-03", end: "2026-09-04", teamId: "survey", status: "complete", progress: 100, dependencyId: "", drawings: true, materials: true, access: true, notes: "Measurements verified against drawing A-101, revision 03." },
  { id: "electrical-task", title: "Electrical first fix", boq: "MEP-01", area: "Ground floor", trade: "Electrical", kind: "site", start: "2026-09-07", end: "2026-09-09", teamId: "electrical", status: "in-progress", progress: 35, dependencyId: "survey-task", drawings: true, materials: true, access: true, notes: "Conduits and back boxes. Inspection before wall closure." },
  { id: "joinery-task", title: "Wardrobe fabrication", boq: "JNR-01", area: "Master bedroom", trade: "Joinery", kind: "factory", start: "2026-09-08", end: "2026-09-11", teamId: "factory-a", status: "draft", progress: 0, dependencyId: "survey-task", drawings: true, materials: false, access: true, notes: "Veneer delivery due 8 September. Confirm material receipt before starting." },
  { id: "plumbing-task", title: "Plumbing first fix", boq: "MEP-02", area: "Bathrooms", trade: "Plumbing", kind: "site", start: "2026-09-08", end: "2026-09-10", teamId: "plumbing", status: "booked", progress: 0, dependencyId: "survey-task", drawings: true, materials: true, access: true, notes: "Pressure test before closing the service walls." },
  { id: "ceiling-task", title: "Ceiling framework", boq: "FIN-01", area: "Ground floor", trade: "Finishes", kind: "site", start: "2026-09-10", end: "2026-09-12", teamId: "finishes", status: "booked", progress: 0, dependencyId: "electrical-task", drawings: true, materials: true, access: true, notes: "Start after electrical first fix has passed inspection." },
  { id: "painting-task", title: "Wall preparation & painting", boq: "FIN-02", area: "Ground floor", trade: "Finishes", kind: "site", start: "2026-09-14", end: "2026-09-16", teamId: "", status: "draft", progress: 0, dependencyId: "ceiling-task", drawings: true, materials: true, access: true, notes: "Approved finish: warm white. Protect completed joinery." },
  { id: "wardrobe-task", title: "Wardrobe installation", boq: "JNR-01", area: "Master bedroom", trade: "Joinery", kind: "site", start: "2026-09-17", end: "2026-09-19", teamId: "installation", status: "booked", progress: 0, dependencyId: "joinery-task", drawings: true, materials: false, access: true, notes: "Factory dispatch and site receipt required before installation." },
  { id: "kitchen-task", title: "Kitchen cabinet installation", boq: "JNR-02", area: "Kitchen", trade: "Joinery", kind: "site", start: "2026-09-21", end: "2026-09-23", teamId: "installation", status: "draft", progress: 0, dependencyId: "plumbing-task", drawings: false, materials: false, access: true, notes: "Final shop drawing and supplier delivery pending." },
];

export const statusLabels: Record<WorkStatus, string> = { draft: "Draft", booked: "Booked", "in-progress": "In progress", complete: "Complete" };
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function addDays(value: string, amount: number): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
}
export function dateLabel(value: string, month = true): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", ...(month ? { month: "short" as const } : {}), timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
export function isWorkingDay(date: string): boolean { return new Date(`${date}T00:00:00Z`).getUTCDay() !== 0; }
export function workDays(start: string, end: string): string[] {
  if (!validDate(start) || !validDate(end) || start > end) return [];
  const days: string[] = [];
  for (let date = start; date <= end && days.length < 367; date = addDays(date, 1)) if (isWorkingDay(date)) days.push(date);
  return days;
}
export function overlaps(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  return start <= end && workDays(start, end).length > 0;
}
export function teamConflicts(task: PlanTask, tasks: PlanTask[]): Array<{ title: string; project: string; start: string; end: string }> {
  if (!task.teamId) return [];
  return [
    ...otherBookings.filter(b => b.teamId === task.teamId && overlaps(task, b)),
    ...tasks.filter(t => t.id !== task.id && t.teamId === task.teamId && t.status !== "draft" && overlaps(task, t)).map(t => ({ ...t, project: "Jumeirah villa interiors" })),
  ];
}
export function suitableTeams(task: PlanTask, tasks: PlanTask[]): PlanTeam[] {
  return planTeams.filter(t => t.trade === task.trade && t.kind === task.kind && !teamConflicts({ ...task, teamId: t.id }, tasks).length);
}
export function bookingIssues(task: PlanTask, tasks: PlanTask[]): string[] {
  const issues: string[] = [];
  const team = planTeams.find(t => t.id === task.teamId);
  if (!team) issues.push("Choose a team to reserve its time.");
  else if (team.trade !== task.trade || team.kind !== task.kind) issues.push("Choose a team with the right trade and work location.");
  for (const clash of teamConflicts(task, tasks)) issues.push(`${clash.project}: ${clash.title}, ${dateLabel(clash.start)}–${dateLabel(clash.end)}.`);
  const previous = tasks.find(t => t.id === task.dependencyId);
  if (previous && previous.end >= task.start) issues.push(`Start after ${previous.title} ends on ${dateLabel(previous.end)}.`);
  // Moving a predecessor must not silently invalidate already reserved downstream work.
  for (const next of tasks.filter(t => t.dependencyId === task.id && t.status !== "draft" && t.start <= task.end)) issues.push(`${next.title} is booked for ${dateLabel(next.start)}. Adjust its booking before extending this task.`);
  return issues;
}
export function readinessIssues(task: PlanTask, tasks: PlanTask[]): string[] {
  const issues: string[] = [];
  if (!task.drawings) issues.push("Drawings awaiting approval");
  if (!task.materials) issues.push("Materials not ready");
  if (!task.access) issues.push(task.kind === "factory" ? "Factory release pending" : "Site access / release pending");
  const previous = tasks.find(t => t.id === task.dependencyId);
  if (previous && previous.status !== "complete") issues.push(`Waiting for ${previous.title}`);
  return issues;
}
export function taskNeedsAttention(task: PlanTask, tasks: PlanTask[]): boolean {
  return task.status !== "complete" && (bookingIssues(task, tasks).length > 0 || readinessIssues(task, tasks).length > 0);
}
export function validateTask(task: PlanTask, tasks: PlanTask[]): string[] {
  const errors: string[] = [];
  if (!task.title.trim()) errors.push("Enter a task name.");
  if (!task.area.trim()) errors.push("Enter the area or room.");
  if (!task.boq.trim()) errors.push("Enter the BOQ reference.");
  if (!validDate(task.start) || !validDate(task.end) || task.start > task.end) errors.push("Choose a valid start and finish date.");
  else if (Date.parse(task.end) - Date.parse(task.start) > 90 * 86400000) errors.push("Split work longer than 90 days into smaller tasks.");
  else if (!workDays(task.start, task.end).length) errors.push("Choose at least one working day. Sunday is off in this demo.");
  if (task.teamId && !planTeams.some(t => t.id === task.teamId && t.trade === task.trade && t.kind === task.kind)) errors.push("Choose a team with the right trade and work location.");
  const visited = new Set([task.id]);
  let dependency = task.dependencyId;
  while (dependency) {
    if (visited.has(dependency)) { errors.push("This dependency creates a loop. Choose a different predecessor."); break; }
    visited.add(dependency);
    const previous = tasks.find(t => t.id === dependency);
    if (!previous) { errors.push("The predecessor no longer exists."); break; }
    dependency = previous.dependencyId;
  }
  if (task.progress < 0 || task.progress > 100 || !Number.isFinite(task.progress)) errors.push("Progress must be between 0 and 100%.");
  if (!errors.length && task.status !== "draft") errors.push(...bookingIssues(task, tasks));
  if (!errors.length && (task.status === "in-progress" || task.status === "complete")) errors.push(...readinessIssues(task, tasks));
  if (task.status !== "complete" && tasks.some(t => t.dependencyId === task.id && (t.status === "in-progress" || t.status === "complete"))) errors.push("Dependent work has already started. Keep this predecessor complete.");
  return [...new Set(errors)];
}

export function newTask(id: string): PlanTask {
  return { id, title: "", boq: "", area: "", trade: "Joinery", kind: "site", start: DEMO_TODAY, end: addDays(DEMO_TODAY, 2), teamId: "", status: "draft", progress: 0, dependencyId: "", drawings: false, materials: false, access: false, notes: "" };
}
export function decodePlan(raw: string | null): PlanTask[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 500 || !value.every(t => {
      if (!t || typeof t !== "object") return false;
      return ["id", "title", "boq", "area", "start", "end", "teamId", "dependencyId", "notes"].every(k => typeof t[k] === "string") &&
        ["drawings", "materials", "access"].every(k => typeof t[k] === "boolean") && trades.includes(t.trade) &&
        ["site", "factory"].includes(t.kind) && Object.keys(statusLabels).includes(t.status) &&
        typeof t.progress === "number" && t.progress >= 0 && t.progress <= 100 && validDate(t.start) && validDate(t.end) &&
        t.start <= t.end && Date.parse(t.end) - Date.parse(t.start) <= 90 * 86400000;
    })) return null;
    if (new Set(value.map(t => t.id)).size !== value.length) return null;
    return value as PlanTask[];
  } catch { return null; }
}
