import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  ProjectData,
  ProjectWorkPackage,
  ReleasedScopeLine,
  Task,
} from "./execution.types";

/**
 * Returns the contractual scope that is currently executable. Deducted lines
 * remain in the audit trail but are deliberately excluded from new planning.
 */
export function activeReleasedScopeLines(data: ProjectData): ReleasedScopeLine[] {
  const deducted = new Set(
    (data.variations ?? [])
      .filter((variation) => variation.direction === "deduction")
      .flatMap((variation) => variation.lines)
      .map((line) => line.deductsLineId)
      .filter((id): id is string => Boolean(id)),
  );
  return [
    ...(data.scope?.lines ?? []),
    ...(data.variations ?? [])
      .filter((variation) => variation.direction !== "deduction")
      .flatMap((variation) => variation.lines),
  ].filter((line) => !deducted.has(line.id));
}

export function assertUniqueWorkPackageScope(data: ProjectData) {
  const claimed = new Map<string, string>();
  for (const workPackage of data.workPackages ?? []) {
    if (workPackage.status === "cancelled") continue;
    for (const scopeLineId of workPackage.scopeLineIds) {
      const previous = claimed.get(scopeLineId);
      if (previous && previous !== workPackage.id)
        throw new ConflictException(
          "A released scope line can belong to only one active work package.",
        );
      claimed.set(scopeLineId, workPackage.id);
    }
  }
}

export function assertWorkPackageGraph(data: ProjectData) {
  const active = new Map(
    (data.workPackages ?? [])
      .filter((workPackage) => workPackage.status !== "cancelled")
      .map((workPackage) => [workPackage.id, workPackage]),
  );
  for (const workPackage of active.values()) {
    const predecessors = workPackage.predecessorPackageIds ?? [];
    if (new Set(predecessors).size !== predecessors.length)
      throw new ConflictException("A work package cannot repeat a dependency.");
    if (predecessors.includes(workPackage.id))
      throw new ConflictException("A work package cannot depend on itself.");
    if (predecessors.some((id) => !active.has(id)))
      throw new ConflictException("Choose active work-package dependencies.");
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id))
      throw new ConflictException("Work-package dependencies cannot form a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of active.get(id)?.predecessorPackageIds ?? [])
      visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of active.keys()) visit(id);
}

/**
 * Materialises one durable, traceable delivery package for each newly released
 * quotation line. It is idempotent, so retries and variation synchronisation
 * cannot create duplicate packages.
 */
export function syncScopeWorkPackages(data: ProjectData, now: string) {
  data.workPackages ??= [];
  assertUniqueWorkPackageScope(data);
  const claimed = new Set(
    data.workPackages
      .flatMap((workPackage) => workPackage.scopeLineIds),
  );
  const created: ProjectWorkPackage[] = [];
  for (const line of activeReleasedScopeLines(data)) {
    if (claimed.has(line.id)) continue;
    const workPackage: ProjectWorkPackage = {
      id: randomUUID(),
      scopeLineIds: [line.id],
      title: line.title,
      area: line.room,
      // Mixed is intentional: one contracted deliverable can contain design,
      // procurement, manufacture and site tasks. The package still needs an
      // accountable owner and an explicit Ready decision before work starts.
      deliveryRoute: "mixed",
      status: "planning",
      ownerId: "",
      plannedStart: "",
      plannedEnd: "",
      predecessorPackageIds: [],
      priority: "normal",
      risk: "on_track",
      nextAction: "",
      nextActionOwnerId: "",
      nextActionDate: "",
      recoveryPlan: "",
      blocker: "",
      createdAt: now,
      updatedAt: now,
    };
    data.workPackages.push(workPackage);
    claimed.add(line.id);
    created.push(workPackage);
  }
  return created;
}

export function workPackageForTask(data: ProjectData, task: Task) {
  if (!task.packageId) return undefined;
  const workPackage = (data.workPackages ?? []).find(
    (candidate) => candidate.id === task.packageId,
  );
  if (!workPackage)
    throw new ConflictException(
      "This task’s work package no longer exists. Re-plan the task before continuing.",
    );
  return workPackage;
}

export function routeSupportsLocation(
  route: ProjectWorkPackage["deliveryRoute"],
  location: Task["location"],
) {
  return route === "mixed"
    || (route === "site" && location === "site")
    || ((route === "factory" || route === "vendor") && location === "factory")
    || (route === "office" && location === "office");
}

/**
 * A deduction never silently removes operational history. It blocks the
 * affected package and forces a manager to split or re-plan the remaining work.
 */
export function blockWorkPackagesForDeduction(
  data: ProjectData,
  deductedScopeLineIds: string[],
  reason: string,
  now: string,
) {
  const affected = new Set(deductedScopeLineIds);
  for (const workPackage of data.workPackages ?? []) {
    if (!workPackage.scopeLineIds.some((scopeLineId) => affected.has(scopeLineId)))
      continue;
    workPackage.status = "blocked";
    workPackage.blocker = reason;
    workPackage.updatedAt = now;
  }
}
