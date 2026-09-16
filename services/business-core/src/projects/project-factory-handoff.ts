import { ConflictException } from "@nestjs/common";
import type { ProjectData, Task } from "./execution.types";

export type FactoryHandoffReadiness = {
  ready: boolean;
  missingFactoryTaskIds: string[];
  detail: string;
};

export function unresolvedFactoryDispatchRejections(
  data: ProjectData,
  factoryTaskId: string,
) {
  return (data.dispatches ?? []).filter((dispatch) =>
    dispatch.taskId === factoryTaskId &&
    dispatch.rejectionSnagId &&
    data.snags.some(
      (snag) => snag.id === dispatch.rejectionSnagId && snag.status !== "closed",
    ),
  );
}

function directFactoryPredecessors(data: ProjectData, task: Task) {
  if (task.location !== "site") return [];
  return (task.predecessors ?? [])
    .map((id) => data.tasks.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is Task => candidate?.location === "factory");
}

/**
 * A site task can begin only after each directly linked factory predecessor has
 * at least one independently received, accepted delivery for that exact task.
 * Partial installation remains possible through planned task quantities; the
 * project manager still confirms material readiness before work starts.
 */
export function factoryHandoffReadiness(
  data: ProjectData,
  task: Task,
): FactoryHandoffReadiness {
  const predecessors = directFactoryPredecessors(data, task);
  const missing = predecessors.filter((factoryTask) =>
    !(data.dispatches ?? []).some(
      (dispatch) =>
        dispatch.taskId === factoryTask.id &&
        dispatch.receivingTaskId === task.id &&
        dispatch.status === "received" &&
        dispatch.accepted > 0,
    ),
  );
  if (!missing.length)
    return { ready: true, missingFactoryTaskIds: [], detail: "" };
  return {
    ready: false,
    missingFactoryTaskIds: missing.map((task) => task.id),
    detail: `Receive accepted factory output for ${missing.map((task) => task.title).join(", ")} before starting ${task.title}.`,
  };
}

/**
 * Dispatches can go to a warehouse or client without a receiving task. If a
 * receiving site task is selected, it must be a live leaf task that explicitly
 * depends on this factory operation and shares its delivery scope where scope
 * has already been assigned.
 */
export function assertFactoryDispatchReceiver(
  data: ProjectData,
  factoryTask: Task,
  receivingTaskId: string,
) {
  if (factoryTask.location !== "factory")
    throw new ConflictException("Choose a factory operation before recording a dispatch.");
  if (!receivingTaskId) return;
  const receivingTask = data.tasks.find((task) => task.id === receivingTaskId);
  if (!receivingTask)
    throw new ConflictException("Choose a site task in this project to receive the dispatch.");
  if (receivingTask.location !== "site")
    throw new ConflictException("A factory dispatch can link only to a site task.");
  if (data.tasks.some((task) => task.parentId === receivingTask.id && task.status !== "cancelled"))
    throw new ConflictException("Receive factory output against a measurable site task, not a parent task.");
  if (["completed", "cancelled"].includes(receivingTask.status))
    throw new ConflictException("The receiving site task is already closed. Plan a controlled recovery task instead.");
  if (!(receivingTask.predecessors ?? []).includes(factoryTask.id))
    throw new ConflictException("Link the factory operation as a predecessor of the receiving site task before dispatching.");
  if (factoryTask.unit !== receivingTask.unit)
    throw new ConflictException("Factory and receiving site tasks must use the same unit before dispatching.");
  if (
    factoryTask.packageId &&
    receivingTask.packageId &&
    factoryTask.packageId !== receivingTask.packageId
  )
    throw new ConflictException("Factory output can only move to a site task in the same work package.");
  const factoryScopeIds = factoryTask.scopeIds ?? [];
  const receivingScopeIds = receivingTask.scopeIds ?? [];
  if (
    factoryScopeIds.length &&
    receivingScopeIds.length &&
    !factoryScopeIds.some((scopeId) => receivingScopeIds.includes(scopeId))
  )
    throw new ConflictException("Factory output and the receiving site task must share released scope.");
}
