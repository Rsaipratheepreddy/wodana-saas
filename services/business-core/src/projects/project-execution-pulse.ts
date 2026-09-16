import type {
  ProjectBooking,
  ProjectData,
  ProjectExecutionAction,
  ProjectExecutionPulse,
  ProjectResource,
  Task,
} from "./execution.types";
import { routeSupportsLocation, workPackageForTask } from "./project-work-packages";

const rank: Record<ProjectExecutionAction["priority"], number> = {
  critical: 0,
  high: 1,
  normal: 2,
};

function action(
  item: Omit<ProjectExecutionAction, "id">,
): ProjectExecutionAction {
  return { ...item, id: `${item.kind}:${item.recordId}` };
}

function confirmedBooking(taskId: string, bookings: ProjectBooking[]) {
  return bookings.some(
    (booking) => booking.taskId === taskId && booking.status === "confirmed",
  );
}

function taskPackage(data: ProjectData, task: Task) {
  try {
    return workPackageForTask(data, task);
  } catch {
    // Legacy projects may have tasks that pre-date packages. They remain
    // visible and actionable; the package planner can adopt them deliberately.
    return undefined;
  }
}

/**
 * A deterministic, explainable focus list. It never changes a project; it
 * only surfaces the most valuable safe next action for the current operator.
 */
export function projectExecutionPulse(
  data: ProjectData,
  today: string,
  resources: ProjectResource[] = [],
  bookings: ProjectBooking[] = [],
): ProjectExecutionPulse {
  const actions: ProjectExecutionAction[] = [];
  const workPackages = data.workPackages ?? [];

  for (const workPackage of workPackages) {
    if (workPackage.status === "planning")
      actions.push(action({
        kind: "prepare_package",
        priority: "normal",
        title: `Prepare ${workPackage.title}`,
        detail: "Assign an owner and confirm the delivery route before scheduling work.",
        workPackageId: workPackage.id,
        recordId: workPackage.id,
      }));
    if (["blocked", "on_hold"].includes(workPackage.status))
      actions.push(action({
        kind: "resolve_package",
        priority: "critical",
        title: `Unblock ${workPackage.title}`,
        detail: workPackage.blocker || "Review the package constraint before continuing.",
        workPackageId: workPackage.id,
        recordId: workPackage.id,
      }));
  }

  for (const task of data.tasks) {
    if (["completed", "cancelled"].includes(task.status)) continue;
    const workPackage = taskPackage(data, task);
    const overdue = Boolean(task.end) && task.end < today;
    if (["blocked", "on_hold"].includes(task.status)) {
      actions.push(action({
        kind: "resolve_task",
        priority: "critical",
        title: `Resolve ${task.title}`,
        detail: task.blocker || "Remove the recorded task constraint before restarting work.",
        workPackageId: workPackage?.id,
        taskId: task.id,
        recordId: task.id,
      }));
      continue;
    }
    if (task.status === "awaiting_inspection") {
      actions.push(action({
        kind: "inspect_task",
        priority: "high",
        title: `Inspect ${task.title}`,
        detail: "Approved progress is waiting for an independent quality check.",
        workPackageId: workPackage?.id,
        taskId: task.id,
        recordId: task.id,
      }));
      continue;
    }
    if (overdue && ["planned", "in_progress"].includes(task.status)) {
      actions.push(action({
        kind: "recover_task",
        priority: "critical",
        title: `Recover ${task.title}`,
        detail: `The forecast finished on ${task.end}. Review scope, capacity and the next workable date.`,
        workPackageId: workPackage?.id,
        taskId: task.id,
        recordId: task.id,
      }));
      continue;
    }
    const ready = Object.values(task.readiness).every(Boolean)
      && (!workPackage || ["ready", "in_progress"].includes(workPackage.status))
      && (!workPackage || routeSupportsLocation(workPackage.deliveryRoute, task.location));
    const resource = resources.find((candidate) => candidate.id === task.resourceId);
    const resourceReady = task.location === "office"
      || !task.resourceId
      || (resource?.active && confirmedBooking(task.id, bookings));
    if (task.status === "planned" && ready && resourceReady)
      actions.push(action({
        kind: "start_task",
        priority: "high",
        title: `Start ${task.title}`,
        detail: "Scope, readiness and the scheduled team are in place.",
        workPackageId: workPackage?.id,
        taskId: task.id,
        recordId: task.id,
      }));
  }

  for (const report of data.reports.filter((report) => report.status === "submitted"))
    actions.push(action({
      kind: "review_report",
      priority: "high",
      title: `Review ${report.date} ${report.shift} report`,
      detail: "Verify quantities and evidence before updating the project forecast.",
      recordId: report.id,
    }));

  for (const order of data.orders.filter((order) => ["submitted", "approved"].includes(order.status)))
    actions.push(action({
      kind: "confirm_order",
      priority: "high",
      title: `Confirm ${order.title}`,
      detail: "Obtain the supplier acknowledgement and reviewed delivery date.",
      taskId: order.taskId || undefined,
      recordId: order.id,
    }));

  const nextActions = actions
    .sort((left, right) => rank[left.priority] - rank[right.priority]
      || left.title.localeCompare(right.title))
    .slice(0, 10);
  const overdueTasks = data.tasks.filter(
    (task) => !["completed", "cancelled"].includes(task.status) && task.end && task.end < today,
  ).length;
  const blockedPackages = workPackages.filter(
    (workPackage) => ["blocked", "on_hold"].includes(workPackage.status),
  ).length;
  const critical = nextActions.some((item) => item.priority === "critical");

  return {
    health: critical ? "blocked" : nextActions.some((item) => item.priority === "high")
      ? "attention"
      : nextActions.length ? "watch" : "clear",
    counts: {
      packages: workPackages.length,
      readyPackages: workPackages.filter((workPackage) => workPackage.status === "ready").length,
      activePackages: workPackages.filter((workPackage) => workPackage.status === "in_progress").length,
      blockedPackages,
      overdueTasks,
      awaitingInspection: data.tasks.filter((task) => task.status === "awaiting_inspection").length,
    },
    nextActions,
  };
}
