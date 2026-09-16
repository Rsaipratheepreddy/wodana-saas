import type { ProjectData, ProjectWorkPackage } from "./execution.types";
import { designReadinessForTask } from "./project-design-control";
import { routeSupportsLocation } from "./project-work-packages";

export type WorkPackageReadinessIssue = {
  code:
    | "owner"
    | "tasks"
    | "task_owner"
    | "task_status"
    | "task_readiness"
    | "design"
    | "route"
    | "company_supply"
    | "vendor_supply";
  detail: string;
};

function availableQuantity(
  material: ProjectData["materials"][number],
) {
  return material.movements.reduce(
    (total, movement) =>
      total +
      (["receive", "return"].includes(movement.kind)
        ? movement.quantity
        : -movement.quantity),
    0,
  );
}

/**
 * A package is ready only when it is genuinely executable. This is deliberately
 * stricter than task creation: planning may be incomplete, but Ready means the
 * team is allowed to commit the project to the next operational step.
 */
export function workPackageReadiness(
  data: ProjectData,
  workPackage: ProjectWorkPackage,
): WorkPackageReadinessIssue[] {
  const issues: WorkPackageReadinessIssue[] = [];
  if (!workPackage.ownerId)
    issues.push({
      code: "owner",
      detail: "Assign an accountable work-package owner.",
    });
  const tasks = data.tasks.filter((task) => task.packageId === workPackage.id);
  if (!tasks.length) {
    issues.push({
      code: "tasks",
      detail: "Plan at least one delivery task before marking this package ready.",
    });
    return issues;
  }
  for (const task of tasks) {
    if (["completed", "cancelled"].includes(task.status)) continue;
    if (!task.ownerId)
      issues.push({
        code: "task_owner",
        detail: `Assign an owner to ${task.title}.`,
      });
    if (["blocked", "on_hold"].includes(task.status))
      issues.push({
        code: "task_status",
        detail: `Resolve the recorded blocker on ${task.title} before marking this package ready.`,
      });
    if (!Object.values(task.readiness).every(Boolean))
      issues.push({
        code: "task_readiness",
        detail: `Confirm scope, access and material readiness for ${task.title}.`,
      });
    if (!routeSupportsLocation(workPackage.deliveryRoute, task.location))
      issues.push({
        code: "route",
        detail: `${task.title} is planned for ${task.location}, which does not match this package's delivery route.`,
      });
    if (task.location !== "office" && !designReadinessForTask(data, task).ready)
      issues.push({
        code: "design",
        detail: `Link the approved design evidence for ${task.title}.`,
      });
  }
  for (const material of data.materials.filter((item) =>
    tasks.some((task) => task.id === item.taskId),
  )) {
    if (material.supply === "company" && availableQuantity(material) < material.required)
      issues.push({
        code: "company_supply",
        detail: `${material.title} is not fully available for its planned work.`,
      });
    if (
      material.supply === "vendor" &&
      !data.orders.some(
        (order) =>
          order.taskId === material.taskId &&
          ["acknowledged", "closed"].includes(order.status),
      )
    )
      issues.push({
        code: "vendor_supply",
        detail: `${material.title} needs an acknowledged vendor commitment.`,
      });
  }
  return issues;
}
