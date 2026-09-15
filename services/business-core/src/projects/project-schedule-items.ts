import type { ProjectData, ProjectResource, Task } from "./execution.types";

export type ScheduleProjectContext = {
  id: string;
  name: string;
  dealReference: string;
  clientName: string;
  data: ProjectData;
};

type Department = { id: string; code: string; name: string; visibleName: string; color: string };
type ScheduleResourceContext = ProjectResource & { department?: Department | null };

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function projectScheduleItems(
  project: ScheduleProjectContext,
  resources: ScheduleResourceContext[],
  from: string,
  to: string,
) {
  const items: Array<Record<string, unknown> & { date: string; department: Department | null }> = [];
  const task = (id?: string) => id ? project.data.tasks.find((candidate) => candidate.id === id) : undefined;
  const resourceFor = (work?: Task) => work
    ? resources.find((resource) => resource.id === work.resourceId)
    : undefined;
  const add = (
    kind: string,
    id: string,
    title: string,
    date: unknown,
    status: string,
    work?: Task,
    ownerId?: string,
  ) => {
    if (!validDate(date) || date < from || date > to) return;
    const resource = resourceFor(work);
    items.push({
      id: `${kind}:${id}`,
      source: "project",
      kind,
      projectId: project.id,
      projectName: project.name,
      dealReference: project.dealReference,
      clientName: project.clientName,
      taskId: work?.id ?? null,
      resource: resource ? { id: resource.id, name: resource.name, kind: resource.kind } : null,
      department: resource?.department ?? null,
      ownerId: ownerId || work?.ownerId || null,
      date,
      allDay: true,
      title: [project.dealReference, project.clientName, title].filter(Boolean).join(" — "),
      status,
    });
  };
  for (const milestone of project.data.milestones ?? [])
    add("milestone", milestone.id, milestone.title, milestone.dueDate,
      milestone.acceptedAt ? "accepted" : "open", task(milestone.taskIds[0]), milestone.ownerId);
  for (const dispatch of project.data.dispatches ?? [])
    if (dispatch.status !== "cancelled") add("delivery", dispatch.id, dispatch.title, dispatch.dueDate,
      dispatch.status, task(dispatch.taskId));
  for (const inspection of project.data.commissioning ?? [])
    add("inspection", inspection.id, inspection.title, inspection.dueDate,
      inspection.status, task(inspection.taskId), inspection.ownerId);
  for (const snag of project.data.snags ?? [])
    add("snag", snag.id, snag.title, snag.dueDate, snag.status, task(snag.taskId), snag.ownerId);
  for (const order of project.data.orders ?? [])
    if (order.status !== "cancelled") add("procurement_delivery", order.id, order.title, order.promisedDate,
      order.status, task(order.taskId));
  const controls = project.data.controls;
  if (controls) {
    add("next_action", "next-action", controls.nextAction || "Next project action",
      controls.nextActionDate, "planned", undefined, controls.nextActionOwnerId);
    add("handover", "handover", "Client handover", controls.handoverDate, "planned");
    add("target_completion", "target-completion", "Target completion", controls.targetCompletion, "planned");
  }
  return items.sort((left, right) => `${left.date}:${left.kind}`.localeCompare(`${right.date}:${right.kind}`));
}
