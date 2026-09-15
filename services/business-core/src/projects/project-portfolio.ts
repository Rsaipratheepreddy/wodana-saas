import { progress } from "./execution.domain";
import type { ProjectData, Task } from "./execution.types";
import { projectWorkflowSummary } from "./project-workflow";

const range = (values: string[], mode: "first" | "last") => {
  const dates = values.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
  return dates.length ? (mode === "first" ? dates[0] : dates.at(-1)!) : null;
};

export function projectPortfolioSummary(data: ProjectData, today: string) {
  const normalized = {
    ...data,
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    reports: Array.isArray(data.reports) ? data.reports : [],
  };
  const parentIds = new Set(normalized.tasks.map((task) => task.parentId).filter(Boolean));
  const tasks = normalized.tasks.filter((task) => !parentIds.has(task.id));
  const count = (status: Task["status"]) => tasks.filter((task) => task.status === status).length;
  const incomplete = (task: Task) => !["completed", "cancelled"].includes(task.status);
  const milestones = data.milestones ?? [];
  const nextMilestone = milestones
    .filter((milestone) => !milestone.acceptedAt)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0];
  const milestoneProgress = nextMilestone
    ? nextMilestone.taskIds
        .map((id) => normalized.tasks.find((task) => task.id === id))
        .filter((task): task is Task => Boolean(task))
    : [];

  return {
    progress: Math.round(progress(normalized)),
    taskSummary: {
      total: tasks.length,
      planned: count("planned"),
      inProgress: count("in_progress"),
      awaitingInspection: count("awaiting_inspection"),
      blocked: count("blocked"),
      onHold: count("on_hold"),
      completed: count("completed"),
      cancelled: count("cancelled"),
      overdue: tasks.filter((task) => incomplete(task) && /^\d{4}-\d{2}-\d{2}$/.test(task.end) && task.end < today).length,
    },
    schedule: {
      baselineStart: range(tasks.map((task) => task.baselineStart), "first"),
      baselineEnd: range(tasks.map((task) => task.baselineEnd), "last"),
      currentStart: range(tasks.map((task) => task.start), "first"),
      currentEnd: range(tasks.map((task) => task.end), "last"),
    },
    milestoneSummary: {
      total: milestones.length,
      accepted: milestones.filter((milestone) => Boolean(milestone.acceptedAt)).length,
      next: nextMilestone
        ? {
            id: nextMilestone.id,
            title: nextMilestone.title,
            dueDate: nextMilestone.dueDate,
            progress: milestoneProgress.length
              ? Math.round(milestoneProgress.reduce((total, task) => total + progress(normalized, task), 0) / milestoneProgress.length)
              : 0,
          }
        : null,
    },
    workflow: projectWorkflowSummary(normalized),
    fileCount: data.files?.length ?? 0,
  };
}
