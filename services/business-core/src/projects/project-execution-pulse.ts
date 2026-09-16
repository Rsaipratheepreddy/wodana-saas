import type {
  ProjectBooking,
  ProjectData,
  ProjectExecutionAction,
  ProjectExecutionPulse,
  ProjectResource,
  Task,
} from "./execution.types";
import { routeSupportsLocation, workPackageForTask } from "./project-work-packages";
import { designReadinessForTask } from "./project-design-control";
import { workPackageReadiness } from "./project-package-readiness";

const rank: Record<ProjectExecutionAction["priority"], number> = {
  critical: 0,
  high: 1,
  normal: 2,
};
const commandCentreRank: Partial<Record<ProjectExecutionAction["kind"], number>> = {
  resolve_project_hold: 0,
  resolve_project_risk: 1,
  recover_project_promise: 2,
  prepare_handover: 3,
  complete_client_action: 4,
  prepare_client_meeting: 5,
};

function action(
  item: Omit<ProjectExecutionAction, "id">,
): ProjectExecutionAction {
  return { ...item, id: `${item.kind}:${item.recordId}` };
}

function confirmedBooking(task: Task, bookings: ProjectBooking[]) {
  return bookings.some(
    (booking) =>
      booking.taskId === task.id &&
      booking.resourceId === task.resourceId &&
      booking.status === "confirmed" &&
      Boolean(task.start) &&
      Boolean(task.end) &&
      Boolean(booking.start) &&
      Boolean(booking.end) &&
      booking.start <= task.start &&
      booking.end >= task.end,
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

function projectOwnerId(data: ProjectData) {
  return data.initiation?.baseline?.projectOwnerId
    || data.roleAssignments?.find((assignment) => assignment.role === "project_manager")?.memberId
    || data.controls?.nextActionOwnerId
    || undefined;
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
  const controls = data.controls;
  const projectOwner = projectOwnerId(data);
  const projectHeld = Boolean(controls?.onHold);

  if (projectHeld)
    actions.push(action({
      kind: "resolve_project_hold",
      priority: "critical",
      title: "Resolve project hold",
      detail: controls?.holdReason || "Release the project hold or record the recovery plan before authorising more delivery work.",
      ownerId: controls?.holdOwnerId || projectOwner,
      recordId: "project-hold",
    }));

  if (data.phase !== "completed" && controls) {
    if (["urgent_action", "high_risk"].includes(controls.risk))
      actions.push(action({
        kind: "resolve_project_risk",
        priority: controls.risk === "high_risk" ? "critical" : "high",
        title: "Recover project risk",
        detail: "Review the forecast, accountable owner and client commitment before delivery drifts further.",
        ownerId: projectOwner,
        recordId: "project-risk",
      }));
    if (controls.targetCompletion && controls.targetCompletion <= today)
      actions.push(action({
        kind: "recover_project_promise",
        priority: controls.targetCompletion < today ? "critical" : "high",
        title: "Protect the client promise",
        detail: controls.targetCompletion < today
          ? `Target completion was ${controls.targetCompletion}. Reforecast and confirm the recovery plan with the client.`
          : "Target completion is today. Confirm the remaining plan and client communication.",
        ownerId: projectOwner,
        recordId: "target-completion",
      }));
    if (controls.handoverDate && controls.handoverDate <= today)
      actions.push(action({
        kind: "prepare_handover",
        priority: controls.handoverDate < today ? "critical" : "high",
        title: "Protect client handover",
        detail: controls.handoverDate < today
          ? `Client handover was due ${controls.handoverDate}. Review acceptance, outstanding work and the revised commitment.`
          : "Client handover is due today. Confirm acceptance, outstanding work and the client update.",
        ownerId: projectOwner,
        recordId: "handover",
      }));
    if (controls.nextAction && controls.nextActionDate && controls.nextActionDate <= today)
      actions.push(action({
        kind: "complete_client_action",
        priority: controls.nextActionDate < today ? "high" : "normal",
        title: controls.nextAction,
        detail: controls.nextActionDate < today
          ? `This client action was due ${controls.nextActionDate}. Complete it or record the new commitment.`
          : "This client action is due today. Complete it or record the next commitment.",
        ownerId: controls.nextActionOwnerId || projectOwner,
        recordId: "next-client-action",
      }));
    if (controls.nextClientMeeting && controls.nextClientMeeting <= today)
      actions.push(action({
        kind: "prepare_client_meeting",
        priority: "high",
        title: controls.nextClientMeeting < today ? "Close the client meeting" : "Prepare the client meeting",
        detail: controls.nextClientMeeting < today
          ? `The client meeting was scheduled for ${controls.nextClientMeeting}. Record its outcome and the next commitment.`
          : "Confirm the agenda, current forecast and decisions required before the client meeting.",
        ownerId: controls.nextClientMeetingOwnerId || projectOwner,
        recordId: "next-client-meeting",
      }));
  }

  for (const workPackage of projectHeld ? [] : workPackages) {
    if (workPackage.status === "planning") {
      const issue = workPackageReadiness(data, workPackage)[0];
      actions.push(action({
        kind: "prepare_package",
        priority: "normal",
        title: `Prepare ${workPackage.title}`,
        detail: issue?.detail ?? "Review the package plan before authorising delivery work.",
        workPackageId: workPackage.id,
        recordId: workPackage.id,
      }));
    }
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

  for (const task of projectHeld ? [] : data.tasks) {
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
      || Boolean(
        task.resourceId &&
        resource?.active &&
        confirmedBooking(task, bookings),
      );
    const designReady =
      task.location === "office" || designReadinessForTask(data, task).ready;
    if (task.status === "planned" && !designReady) {
      actions.push(action({
        kind: "resolve_design",
        priority: "high",
        title: `Link the approved design for ${task.title}`,
        detail: "Use the approved design revision captured with this released scope before starting delivery work.",
        workPackageId: workPackage?.id,
        taskId: task.id,
        recordId: task.id,
      }));
      continue;
    }
    if (task.status === "planned" && ready && !resourceReady) {
      actions.push(action({
        kind: "resolve_booking",
        priority: "high",
        title: `Book ${task.title}`,
        detail: "Assign an active team or factory and confirm a booking that covers the planned work dates.",
        workPackageId: workPackage?.id,
        taskId: task.id,
        recordId: task.id,
      }));
      continue;
    }
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
      || (commandCentreRank[left.kind] ?? 100) - (commandCentreRank[right.kind] ?? 100)
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
