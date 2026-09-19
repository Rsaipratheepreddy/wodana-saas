import type {
  ProjectBooking,
  ProjectConnectedPlan,
  ProjectData,
  ProjectResource,
} from "./execution.types";

function activeTask(status: ProjectData["tasks"][number]["status"]) {
  return !["completed", "cancelled"].includes(status);
}

/**
 * Builds one privacy-safe delivery plan from contractual packages and
 * operational supplier/resource facts. Employee calendars and leave are used
 * to confirm bookings, but are never copied into this projection.
 */
export function projectConnectedPlan(
  data: ProjectData,
  resources: ProjectResource[],
  bookings: ProjectBooking[],
  today: string,
): ProjectConnectedPlan {
  const packages = (data.workPackages ?? []).filter(
    (workPackage) => workPackage.status !== "cancelled",
  );
  const taskPackage = new Map(
    data.tasks
      .filter((task) => task.packageId)
      .map((task) => [task.id, task.packageId!]),
  );
  return {
    promise: {
      statement: data.controls?.promise ?? "",
      targetCompletion: data.controls?.targetCompletion ?? "",
      handoverDate: data.controls?.handoverDate ?? "",
    },
    packages: packages.map((workPackage) => {
      const tasks = data.tasks.filter(
        (task) => task.packageId === workPackage.id && task.status !== "cancelled",
      );
      const taskIds = new Set(tasks.map((task) => task.id));
      const derivedDependencies = tasks.flatMap((task) =>
        task.predecessors
          .map((id) => taskPackage.get(id))
          .filter((id): id is string => Boolean(id) && id !== workPackage.id),
      );
      const predecessorPackageIds = [
        ...new Set([
          ...(workPackage.predecessorPackageIds ?? []),
          ...derivedDependencies,
        ]),
      ];
      const supplierCommitments = data.orders
        .filter(
          (order) => taskIds.has(order.taskId) && order.status !== "cancelled",
        )
        .map((order) => ({
          orderId: order.id,
          number: order.number,
          vendor: order.vendor,
          status: order.status,
          promisedDate: order.promisedDate,
          leadTimeDays: order.leadTimeDays ?? null,
          taskId: order.taskId,
        }));
      const capacityCommitments = tasks
        .filter((task) => task.location !== "office" && activeTask(task.status))
        .map((task) => {
          const booking = bookings.find(
            (candidate) =>
              candidate.taskId === task.id &&
              candidate.resourceId === task.resourceId &&
              ["draft", "tentative", "confirmed"].includes(candidate.status),
          );
          const resource = resources.find(
            (candidate) => candidate.id === task.resourceId,
          );
          return {
            taskId: task.id,
            resourceId: task.resourceId,
            resourceName: resource?.name ?? "Unassigned",
            resourceKind: resource?.kind ?? null,
            bookingStatus: booking?.status ?? ("missing" as const),
            start: booking?.start ?? task.start,
            end: booking?.end ?? task.end,
          };
        });
      const issues: ProjectConnectedPlan["packages"][number]["issues"] = [];
      if (!workPackage.ownerId)
        issues.push({ code: "owner", detail: "Assign a package owner." });
      if (!workPackage.plannedStart || !workPackage.plannedEnd)
        issues.push({ code: "schedule", detail: "Set package dates." });
      if (
        !workPackage.nextAction ||
        !workPackage.nextActionOwnerId ||
        !workPackage.nextActionDate
      )
        issues.push({
          code: "next_action",
          detail: "Record the next action, owner and due date.",
        });
      const openDependency = predecessorPackageIds
        .map((id) => packages.find((candidate) => candidate.id === id))
        .find((candidate) => candidate?.status !== "completed");
      if (openDependency)
        issues.push({
          code: "dependency",
          detail: `Waiting for ${openDependency.title}.`,
        });
      const lateSupplier = supplierCommitments.find((order) => {
        const task = tasks.find((candidate) => candidate.id === order.taskId);
        return (
          task &&
          !["closed", "cancelled"].includes(order.status) &&
          order.promisedDate > task.start
        );
      });
      if (lateSupplier)
        issues.push({
          code: "supplier",
          detail: `${lateSupplier.vendor} promises ${lateSupplier.promisedDate}, after linked work starts.`,
        });
      if (
        capacityCommitments.some(
          (commitment) => commitment.bookingStatus !== "confirmed",
        )
      )
        issues.push({
          code: "capacity",
          detail: "Confirm crew, factory or vendor capacity for active work.",
        });
      if (
        data.controls?.targetCompletion &&
        workPackage.plannedEnd &&
        workPackage.plannedEnd > data.controls.targetCompletion
      )
        issues.push({
          code: "promise",
          detail: `Forecast exceeds the ${data.controls.targetCompletion} client target.`,
        });
      if (
        (workPackage.risk === "blocked" ||
          issues.some((issue) => issue.code === "promise")) &&
        !workPackage.recoveryPlan?.trim()
      )
        issues.push({
          code: "recovery",
          detail: "Record the recovery plan before committing this package.",
        });
      if (
        workPackage.nextActionDate &&
        workPackage.nextActionDate < today &&
        !issues.some((issue) => issue.code === "next_action")
      )
        issues.push({
          code: "next_action",
          detail: `Next action was due ${workPackage.nextActionDate}.`,
        });
      return {
        id: workPackage.id,
        title: workPackage.title,
        area: workPackage.area,
        status: workPackage.status,
        ownerId: workPackage.ownerId,
        priority: workPackage.priority ?? "normal",
        risk: workPackage.risk ?? "on_track",
        plannedStart: workPackage.plannedStart,
        plannedEnd: workPackage.plannedEnd,
        predecessorPackageIds,
        nextAction: workPackage.nextAction ?? "",
        nextActionOwnerId: workPackage.nextActionOwnerId ?? "",
        nextActionDate: workPackage.nextActionDate ?? "",
        recoveryPlan: workPackage.recoveryPlan ?? "",
        supplierCommitments,
        capacityCommitments,
        issues,
      };
    }),
  };
}
