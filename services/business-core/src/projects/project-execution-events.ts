import type { ProjectData } from "./execution.types";

export type ProjectExecutionEvent = {
  action: string;
  data: Record<string, unknown>;
};

/**
 * The durable project event contract is deliberately small. It gives tenant
 * automations enough context to notify, create a follow-up or call a webhook
 * without leaking full project content into the event stream.
 */
export function projectExecutionEvents(
  projectId: string,
  projectName: string,
  data: ProjectData,
  action: string,
  recordId: string,
): ProjectExecutionEvent[] {
  const report = data.reports.find((item) => item.id === recordId);
  const task = data.tasks.find((item) => item.id === recordId);
  const dispatch = data.dispatches?.find((item) => item.id === recordId);
  const commissioning = data.commissioning?.find((item) => item.id === recordId);
  const common = {
    projectId,
    projectName,
    projectReference: data.controls?.reference ?? "",
    executionRevision: data.revision,
    recordId,
  };
  const event = (name: string, extra: Record<string, unknown> = {}) => ({
    action: name,
    data: { ...common, ...extra },
  });

  if (report) {
    const reportData = {
      report: {
        id: report.id,
        date: report.date,
        shift: report.shift,
        location: report.location,
        status: report.status,
        scheduleImpact: report.scheduleImpact ?? "none",
        safetyStatus: report.safetyStatus ?? "none",
        nextUpdateDate: report.nextUpdateDate ?? "",
        nextUpdateOwnerId: report.nextUpdateOwnerId ?? "",
      },
    };
    const primary = action === "report_submit" || action === "submit_report"
      ? "project.daily_report.submitted.v1"
      : action === "return_report"
        ? "project.daily_report.returned.v1"
        : action === "approve_report"
          ? "project.daily_report.approved.v1"
          : action === "publish_report" || action === "unpublish_report"
            ? "project.daily_report.client_visibility_changed.v1"
            : "project.daily_report.saved.v1";
    const events = [event(primary, reportData)];
    if (
      ["report_submit", "submit_report", "approve_report"].includes(action) &&
      (report.scheduleImpact ?? "none") !== "none"
    )
      events.push(event("project.daily_report.schedule_risk.v1", reportData));
    if (
      ["report_submit", "submit_report", "approve_report"].includes(action) &&
      report.safetyStatus === "incident"
    )
      events.push(event("project.daily_report.safety_incident.v1", reportData));
    return events;
  }

  if (commissioning) {
    const status = commissioning.status;
    const eventName = action === "commissioning_status"
      ? `project.commissioning.${status}.v1`
      : "project.commissioning.saved.v1";
    return [event(eventName, {
      commissioning: {
        id: commissioning.id,
        title: commissioning.title,
        taskId: commissioning.taskId,
        ownerId: commissioning.ownerId,
        dueDate: commissioning.dueDate,
        status,
      },
    })];
  }
  if (dispatch) {
    const eventName = action === "dispatch_status"
      ? `project.dispatch.${dispatch.status}.v1`
      : "project.dispatch.saved.v1";
    return [event(eventName, {
      dispatch: {
        id: dispatch.id,
        title: dispatch.title,
        taskId: dispatch.taskId,
        receivingTaskId: dispatch.receivingTaskId,
        dueDate: dispatch.dueDate,
        status: dispatch.status,
      },
    })];
  }

  if (task && action === "task_status")
    return [event("project.task.status_changed.v1", {
      task: { id: task.id, title: task.title, location: task.location, status: task.status, end: task.end, ownerId: task.ownerId },
    })];
  if (["task", "booking", "cancel_booking", "reschedule"].includes(action))
    return [event("project.schedule.updated.v1", task ? {
      task: { id: task.id, title: task.title, location: task.location, start: task.start, end: task.end, ownerId: task.ownerId },
    } : {})];
  if (action === "project_controls")
    return [event("project.controls.updated.v1", {
      controls: {
        risk: data.controls?.risk ?? "on_track",
        targetCompletion: data.controls?.targetCompletion ?? "",
        handoverDate: data.controls?.handoverDate ?? "",
        onHold: Boolean(data.controls?.onHold),
      },
    })];
  return [event("project.execution.updated.v1", { command: action })];
}
