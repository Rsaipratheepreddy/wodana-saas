import { rfaReadiness } from "./project-rfa";
import { deliveryQuantityReadiness } from "./project-delivery-quantities";
import type { ProjectData, ProjectWorkPackage } from "./execution.types";
import { designReadinessForTask } from "./project-design-control";
import { routeSupportsLocation } from "./project-work-packages";

export type WorkPackageReadinessIssue = {
  code:
    | "rfa"
    | "delivery_quantities"
    | "owner"
    | "schedule"
    | "next_action"
    | "dependency"
    | "recovery"
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
  const onHand = material.movements.reduce(
    (total, movement) =>
      total +
      (["receive", "return"].includes(movement.kind)
        ? movement.quantity
        : -movement.quantity),
    0,
  );
  const issuedToTask = material.taskId ? material.movements.reduce((total, movement) => total +
    (movement.taskId === material.taskId ? movement.kind === "issue" ? movement.quantity : movement.kind === "return" ? -movement.quantity : 0 : 0), 0) : 0;
  const reservedElsewhere = (material.reservations ?? []).filter(r => !material.taskId || r.taskId !== material.taskId).reduce((total, r) => total + r.quantity, 0);
  return Math.max(0, onHand - reservedElsewhere) + Math.max(0, issuedToTask);
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
  const approvalIssue = rfaReadiness(data, workPackage.scopeLineIds);
  if (approvalIssue) issues.push({code:"rfa",detail:approvalIssue});
  const quantityIssue = deliveryQuantityReadiness(data, workPackage);
  if (quantityIssue) issues.push({code:"delivery_quantities",detail:quantityIssue});
  if (!workPackage.ownerId)
    issues.push({
      code: "owner",
      detail: "Assign an accountable work-package owner.",
    });
  if (!workPackage.plannedStart || !workPackage.plannedEnd)
    issues.push({
      code: "schedule",
      detail: "Set the work-package start and finish dates.",
    });
  if (
    !workPackage.nextAction ||
    !workPackage.nextActionOwnerId ||
    !workPackage.nextActionDate
  )
    issues.push({
      code: "next_action",
      detail: "Record the package's next action, owner and due date.",
    });
  const incompleteDependency = (workPackage.predecessorPackageIds ?? [])
    .map((id) => (data.workPackages ?? []).find((candidate) => candidate.id === id))
    .find((candidate) => candidate?.status !== "completed");
  if (incompleteDependency)
    issues.push({
      code: "dependency",
      detail: `Complete ${incompleteDependency.title} before marking this package ready.`,
    });
  if (
    (workPackage.risk === "blocked" ||
      Boolean(
        data.controls?.targetCompletion &&
          workPackage.plannedEnd &&
          workPackage.plannedEnd > data.controls.targetCompletion,
      )) &&
    !workPackage.recoveryPlan?.trim()
  )
    issues.push({
      code: "recovery",
      detail: "Record a recovery plan for this package risk.",
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
