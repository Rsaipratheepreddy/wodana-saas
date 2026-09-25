import type { ProjectState, Task } from "@/lib/projects/execution";

/** Everything a factory job needs before it can start, with the screen that fixes each gap. */
export function productionReadiness(state: ProjectState, t: Task) {
  const d = state.data,
    resource = state.resources.find((r) => r.id === t.resourceId),
    orders = d.orders.filter(
      (o) =>
        o.taskId === t.id && o.kind === "factory" && o.status !== "cancelled",
    ),
    external = resource?.kind === "vendor" || orders.length > 0;
  return {
    external,
    resource,
    orders,
    checks: [
      {
        title: "Commercial release",
        ready: state.commercialReady,
        href: `/workspace/pre-projects/cases/${state.caseId}/execution-release`,
      },
      { title: "Scope & measurements", ready: t.readiness.scope },
      {
        title: "Approved drawing",
        ready: d.documents.some(
          (x) => x.id === t.drawingId && x.status === "approved",
        ),
        href: `/workspace/projects/${state.id}/documents?record=${t.drawingId}`,
      },
      {
        title: "Materials ready",
        ready: t.readiness.materials,
        href: `/workspace/projects/${state.id}/material-planning`,
      },
      {
        title: "Owner & access",
        ready: Boolean(t.ownerId) && t.readiness.access,
      },
      {
        title: "Preceding work",
        ready: t.predecessors.every((id) =>
          d.tasks.some((x) => x.id === id && x.status === "completed"),
        ),
      },
      {
        title: "Capacity confirmed",
        ready:
          resource?.active === true &&
          state.bookings.some(
            (b) =>
              b.taskId === t.id &&
              b.projectId === state.id &&
              b.status === "confirmed",
          ),
      },
      ...(external
        ? [
            {
              title: "Factory order confirmed",
              ready:
                orders.some((o) =>
                  ["acknowledged", "closed"].includes(o.status),
                ) &&
                orders
                  .filter((o) => o.status !== "enquiry")
                  .every((o) => ["acknowledged", "closed"].includes(o.status)),
              href: `/workspace/projects/${state.id}/procurement${orders[0] ? `?record=${orders[0].id}` : ""}`,
            },
          ]
        : []),
    ],
  };
}
