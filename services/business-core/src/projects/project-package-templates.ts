import { BadRequestException, ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ProjectData, Task } from "./execution.types";
import { activeReleasedScopeLines } from "./project-scope-lines";

export const PACKAGE_TASK_TEMPLATES = ["manufactured", "ready_made", "site_work", "design"] as const;
export type PackageTaskTemplate = (typeof PACKAGE_TASK_TEMPLATES)[number];

type Step = {
  title: (item: string) => string;
  location: Task["location"];
  days: number;
  /** Scope-bound steps carry the released line's quantity and unit; others are one unit of work. */
  unit?: string;
  inspection?: boolean;
};

/** Standard steps per package type. Planners edit dates, owners and details after applying. */
const STEPS: Record<PackageTaskTemplate, Step[]> = {
  manufactured: [
    { title: (item) => `Measure site · ${item}`, location: "site", days: 1, unit: "visit" },
    { title: (item) => `Shop drawing · ${item}`, location: "office", days: 3, unit: "set" },
    { title: (item) => `Produce · ${item}`, location: "factory", days: 10 },
    { title: (item) => `Install · ${item}`, location: "site", days: 3, inspection: true },
  ],
  ready_made: [
    { title: (item) => `Order · ${item}`, location: "office", days: 2, unit: "order" },
    { title: (item) => `Deliver and install · ${item}`, location: "site", days: 2, inspection: true },
  ],
  site_work: [{ title: (item) => item, location: "site", days: 5, inspection: true }],
  design: [{ title: (item) => item, location: "office", days: 5 }],
};

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

/**
 * Creates the standard dependent task chain for one work package from its released scope.
 * Runs inside the project command, so permissions, audit and idempotency are the command's.
 */
export function applyPackageTaskTemplate(data: ProjectData, packageId: string, template: PackageTaskTemplate, today: string) {
  const workPackage = (data.workPackages ?? []).find((candidate) => candidate.id === packageId);
  if (!workPackage) throw new BadRequestException("Choose a work package from this project.");
  if (workPackage.status === "cancelled" || workPackage.status === "completed")
    throw new ConflictException("This work package is closed.");
  if (data.tasks.some((task) => task.packageId === packageId && task.status !== "cancelled"))
    throw new ConflictException("This work package already has tasks. Edit them instead of applying a template.");
  const lines = activeReleasedScopeLines(data).filter((line) => workPackage.scopeLineIds.includes(line.id));
  if (!lines.length) throw new ConflictException("This work package has no active released scope.");
  if (lines.some((line) => !(line.quantity > 0) || !line.unit))
    throw new ConflictException("Released scope needs a quantity and unit before tasks can be planned.");

  const created: Task[] = [];
  let start = /^\d{4}-\d{2}-\d{2}$/.test(workPackage.plannedStart) ? workPackage.plannedStart : today;
  for (const line of lines) {
    let previous: Task | undefined;
    for (const step of STEPS[template]) {
      const end = addDays(start, step.days - 1);
      const task: Task = {
        id: randomUUID(),
        parentId: "",
        packageId: workPackage.id,
        package: workPackage.title,
        title: step.title(line.title),
        description: "",
        area: line.room || workPackage.area,
        location: step.location,
        ownerId: "",
        assigneeIds: [],
        resourceId: "",
        start,
        end,
        baselineStart: start,
        baselineEnd: end,
        predecessors: previous ? [previous.id] : [],
        quantity: step.unit ? 1 : line.quantity,
        unit: step.unit ?? line.unit,
        weight: 1,
        approved: 0,
        status: "planned",
        priority: workPackage.priority === "critical" ? "urgent" : workPackage.priority === "high" ? "high" : "normal",
        inspectionRequired: step.inspection === true,
        scopeIds: step.unit ? [] : [line.id],
        drawingId: "",
        readiness: { scope: false, access: false, materials: false },
        blocker: "",
      };
      created.push(task);
      previous = task;
      start = addDays(end, 1);
    }
  }
  data.tasks.push(...created);
  return created;
}
