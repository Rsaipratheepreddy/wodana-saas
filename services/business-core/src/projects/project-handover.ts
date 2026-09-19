import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { assertCloseout } from "./execution-controls";
import type {
  Handover,
  HandoverOutstandingItem,
  HandoverPacket,
  ProjectData,
  ProjectDocument,
  Task,
} from "./execution.types";

type HandoverSource = {
  source: "area" | "work_package";
  sourcePackageId?: string;
  area: string;
  title: string;
  taskIds: string[];
  scopeLineIds: string[];
};

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

function deliveryLeaves(data: ProjectData) {
  const parents = new Set(
    data.tasks.filter((task) => task.parentId).map((task) => task.parentId),
  );
  return data.tasks.filter(
    (task) => task.status !== "cancelled" && !parents.has(task.id),
  );
}

/**
 * Handover scope is derived from live execution, never hand-keyed task IDs.
 * A package is the precise partial-delivery route; an area collects the
 * package/task leaves for a full room or zone handover.
 */
export function deriveHandoverSource(
  data: ProjectData,
  input: { area?: string; sourcePackageId?: string; title?: string },
): HandoverSource {
  const packageId = input.sourcePackageId?.trim() ?? "";
  if (packageId) {
    const workPackage = (data.workPackages ?? []).find(
      (candidate) => candidate.id === packageId && candidate.status !== "cancelled",
    );
    if (!workPackage)
      throw new BadRequestException("Choose an active delivery package.");
    const taskIds = deliveryLeaves(data)
      .filter((task) => task.packageId === workPackage.id)
      .map((task) => task.id);
    if (!taskIds.length)
      throw new ConflictException(
        "Plan the delivery work for this package before preparing handover.",
      );
    return {
      source: "work_package",
      sourcePackageId: workPackage.id,
      area: workPackage.area,
      title: input.title?.trim() || `${workPackage.title} · acceptance`,
      taskIds,
      scopeLineIds: [...workPackage.scopeLineIds],
    };
  }

  const area = input.area?.trim() ?? "";
  if (!area) throw new BadRequestException("Choose an area or delivery package.");
  const tasks = deliveryLeaves(data).filter((task) => task.area === area);
  if (!tasks.length)
    throw new ConflictException(
      "Plan delivery work for this area before preparing handover.",
    );
  return {
    source: "area",
    area,
    title: input.title?.trim() || `${area} · acceptance`,
    taskIds: tasks.map((task) => task.id),
    scopeLineIds: unique([
      ...tasks.flatMap((task) => task.scopeIds),
      ...(data.workPackages ?? [])
        .filter((workPackage) => workPackage.area === area && workPackage.status !== "cancelled")
        .flatMap((workPackage) => workPackage.scopeLineIds),
    ]),
  };
}

function sourceForExistingHandover(data: ProjectData, handover: Handover): HandoverSource {
  if (handover.source === "work_package" || handover.source === "area")
    return deriveHandoverSource(data, {
      area: handover.source === "area" ? handover.area : undefined,
      sourcePackageId: handover.sourcePackageId,
      title: handover.title,
    });

  // Existing projects retain their prior controlled links. New records always
  // use one of the automatic sources above.
  const tasks = handover.taskIds.map((id) => {
    const task = data.tasks.find((candidate) => candidate.id === id);
    if (!task) throw new ConflictException("A linked handover task no longer exists.");
    return task;
  });
  return {
    source: "area",
    area: handover.area,
    title: handover.title,
    taskIds: handover.taskIds,
    scopeLineIds: unique(tasks.flatMap((task) => task.scopeIds)),
  };
}

function documentsForSource(data: ProjectData, source: HandoverSource) {
  const scope = new Set(source.scopeLineIds);
  return data.documents.filter((document) => {
    if (document.status !== "approved" || !document.published) return false;
    // Unscoped project closeout records are intentionally shared at project
    // level. Scoped records must match this exact package/area scope.
    return !document.scopeLineIds?.length || document.scopeLineIds.some((id) => scope.has(id));
  });
}

function packetDocument(document: ProjectDocument): HandoverPacket["documents"][number] {
  return {
    id: document.id,
    title: document.title,
    kind: document.kind,
    revision: document.revision,
    url: document.url,
  };
}

function relatedOpenSnags(data: ProjectData, handover: Handover, taskIds: string[]) {
  const tasks = new Set(taskIds);
  return data.snags.filter(
    (snag) =>
      snag.status !== "closed" &&
      (snag.handoverId === handover.id ||
        (snag.taskId ? tasks.has(snag.taskId) : snag.area === handover.area)),
  );
}

function assertMaterialCloseout(data: ProjectData, tasks: Task[]) {
  for (const task of tasks.filter((candidate) =>
    candidate.scopeIds.some((scopeId) =>
      Boolean(data.scope?.lines.find((line) => line.id === scopeId)?.material.trim()),
    ),
  )) {
    const planned = data.materials.filter((material) => material.taskId === task.id);
    if (!planned.length)
      throw new ConflictException(
        `Add material planning and procurement evidence for ${task.title}.`,
      );
    if (
      planned.some(
        (material) =>
          material.movements
            .filter((movement) => movement.kind === "receive")
            .reduce((sum, movement) => sum + movement.quantity, 0) < material.required,
      )
    )
      throw new ConflictException(
        `Receive the required accepted materials for ${task.title} before handover.`,
      );
  }
}

function assertOutstandingItems(handover: Handover, forAcceptance: boolean) {
  const items = handover.outstandingItems ?? [];
  for (const item of items) {
    if (!item.title || !item.ownerId || !item.dueDate)
      throw new ConflictException(
        "Give every remaining handover item a title, owner and due date.",
      );
    if (item.blocking && item.status !== "closed")
      throw new ConflictException("Resolve blocking handover items before client acceptance.");
    if (
      forAcceptance &&
      !item.blocking &&
      !["closed", "warranty"].includes(item.status) &&
      !item.evidence
    )
      throw new ConflictException(
        "Record the client-visible evidence for each remaining handover commitment.",
      );
  }
}

/** Revalidates a frozen pack against the current controlled records. */
export function assertHandoverPacketCurrent(data: ProjectData, handover: Handover) {
  const packet = handover.packet;
  if (!packet) throw new ConflictException("Prepare and review the handover pack first.");
  const source = sourceForExistingHandover(data, handover);
  if (
    JSON.stringify([...source.scopeLineIds].sort()) !==
      JSON.stringify([...packet.scopeLineIds].sort()) ||
    JSON.stringify([...source.taskIds].sort()) !== JSON.stringify(packet.tasks.map((task) => task.id).sort())
  )
    throw new ConflictException(
      "The delivery scope changed after this pack was prepared. Return it for a fresh review.",
    );
  const tasks = packet.tasks.map((snapshot) => {
    const task = data.tasks.find((candidate) => candidate.id === snapshot.id);
    if (!task || task.status !== "completed")
      throw new ConflictException("Complete and inspect the linked tasks before handover.");
    return task;
  });
  if (!packet.documents.length)
    throw new ConflictException("Add approved closeout documents before handover.");
  for (const snapshot of packet.documents) {
    const document = data.documents.find((candidate) => candidate.id === snapshot.id);
    if (
      !document ||
      document.status !== "approved" ||
      !document.published ||
      document.revision !== snapshot.revision
    )
      throw new ConflictException(
        "A closeout document changed after the pack was prepared. Return it for a fresh review.",
      );
  }
  assertCloseout(data, packet.tasks.map((task) => task.id));
  const snags = relatedOpenSnags(data, handover, packet.tasks.map((task) => task.id));
  if (snags.length)
    throw new ConflictException("Resolve the affected open defects before client handover.");
  assertMaterialCloseout(data, tasks);
  assertOutstandingItems(handover, true);
}

/** Generates a new immutable packet from its live source at readiness time. */
export function refreshHandoverPacket(
  data: ProjectData,
  handover: Handover,
  preparedBy: string,
  now: string,
) {
  const source = sourceForExistingHandover(data, handover);
  const tasks = source.taskIds.map((id) => {
    const task = data.tasks.find((candidate) => candidate.id === id);
    if (!task) throw new ConflictException("A linked handover task no longer exists.");
    return task;
  });
  handover.source = source.source;
  handover.sourcePackageId = source.sourcePackageId;
  handover.area = source.area;
  handover.title = source.title;
  handover.taskIds = source.taskIds;
  handover.documentIds = documentsForSource(data, source).map((document) => document.id);
  const packet: HandoverPacket = {
    id: randomUUID(),
    version: (handover.packets?.length ?? 0) + 1,
    createdAt: now,
    preparedBy,
    source: source.source,
    sourcePackageId: source.sourcePackageId,
    scopeLineIds: source.scopeLineIds,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      area: task.area,
      location: task.location,
      quantity: task.quantity,
      unit: task.unit,
    })),
    documents: documentsForSource(data, source).map(packetDocument),
    commissioningIds: (data.commissioning ?? [])
      .filter((record) => source.taskIds.includes(record.taskId) && record.status === "passed")
      .map((record) => record.id),
    dispatchIds: (data.dispatches ?? [])
      .filter(
        (record) =>
          source.taskIds.includes(record.taskId) ||
          Boolean(record.receivingTaskId && source.taskIds.includes(record.receivingTaskId)),
      )
      .filter((record) => record.status === "received")
      .map((record) => record.id),
  };
  handover.packet = packet;
  handover.packets = [...(handover.packets ?? []), packet];
  assertHandoverPacketCurrent(data, handover);
  return packet;
}

export function createAutomaticHandover(
  data: ProjectData,
  input: { id: string; area?: string; sourcePackageId?: string; title?: string; warrantyUntil: string; clientReviewDueDate?: string; clientApproverId?: string },
): Handover {
  const source = deriveHandoverSource(data, input);
  const duplicate = data.handovers.find(
    (handover) =>
      handover.id !== input.id &&
      handover.status !== "returned" &&
      ((source.source === "work_package" && handover.sourcePackageId === source.sourcePackageId) ||
        (source.source === "area" && handover.source === "area" && handover.area === source.area)),
  );
  if (duplicate)
    throw new ConflictException("This delivery source already has an active handover pack.");
  return {
    id: input.id,
    area: source.area,
    title: source.title,
    status: "draft" as const,
    source: source.source,
    sourcePackageId: source.sourcePackageId,
    documentIds: [],
    taskIds: source.taskIds,
    evidence: "",
    acceptedBy: "",
    acceptedAt: "",
    warrantyUntil: input.warrantyUntil,
    outstanding: "",
    outstandingItems: [],
    clientApproverId: input.clientApproverId ?? "",
    clientReviewDueDate: input.clientReviewDueDate ?? "",
    published: false,
  };
}

export function addHandoverOutstandingItem(
  handover: Handover,
  item: HandoverOutstandingItem,
) {
  if (handover.status === "accepted")
    throw new ConflictException("Record post-acceptance work as a warranty defect.");
  handover.outstandingItems ??= [];
  if (handover.outstandingItems.some((candidate) => candidate.id === item.id))
    throw new ConflictException("This handover item already exists.");
  handover.outstandingItems.push(item);
}

export function setHandoverOutstandingStatus(
  handover: Handover,
  itemId: string,
  status: HandoverOutstandingItem["status"],
  evidence: string,
  verifiedBy: string,
) {
  const item = handover.outstandingItems?.find((candidate) => candidate.id === itemId);
  if (!item) throw new BadRequestException("Handover item not found.");
  if (status === "warranty" && (!handover.warrantyUntil || handover.status !== "accepted"))
    throw new ConflictException("Transfer an item to warranty only after an accepted handover with a warranty date.");
  if (["ready", "closed", "warranty"].includes(status) && !evidence)
    throw new BadRequestException("Record completion evidence for this handover item.");
  item.status = status;
  if (evidence) item.evidence = evidence;
  if (status === "ready") {
    item.resolution = evidence;
    item.resolutionBy = verifiedBy;
    item.verifiedBy = undefined;
  } else if (["closed", "warranty"].includes(status)) {
    item.resolution = evidence;
    item.verifiedBy = verifiedBy;
  } else {
    item.resolutionBy = undefined;
    item.verifiedBy = undefined;
  }
}

/** Client decisions have a distinct identity; staff cannot type a name and mimic one. */
export function decideHandoverFromPortal(
  data: ProjectData,
  input: {
    handoverId: string;
    grantId: string;
    grantName: string;
    decision: "accept" | "changes";
    note: string;
    challengeId: string;
    now: string;
  },
) {
  const handover = data.handovers.find((candidate) => candidate.id === input.handoverId);
  if (!handover) throw new BadRequestException("Handover pack not found.");
  if (handover.clientApproverId !== input.grantId)
    throw new ForbiddenException("This handover is not assigned to you.");
  const expectedStatus = input.decision === "accept" ? "accepted" : "returned";
  if (
    handover.decisionChallengeId === input.challengeId &&
    handover.status === expectedStatus
  )
    return { handover, replayed: true };
  if (handover.status !== "ready")
    throw new ConflictException("This handover is no longer awaiting your decision.");
  if (input.decision === "changes") {
    if (!input.note) throw new BadRequestException("Explain the changes needed.");
    handover.status = "returned";
    handover.returnedAt = input.now;
    handover.returnedBy = input.grantName;
    handover.returnedNote = input.note;
    handover.decisionSource = "client_portal";
    handover.decisionChallengeId = input.challengeId;
    handover.published = false;
    // A client return is a delivery correction, never a silently completed
    // handover stage.
    if (data.phase === "handover") data.phase = "active";
  } else {
    assertHandoverPacketCurrent(data, handover);
    handover.status = "accepted";
    handover.acceptedBy = input.grantName;
    handover.acceptedAt = input.now;
    handover.evidence = `Verified client portal decision ${input.challengeId}`;
    handover.decisionSource = "client_portal";
    handover.decisionChallengeId = input.challengeId;
    handover.published = true;
  }
  data.audit.push({
    id: randomUUID(),
    at: input.now,
    author: input.grantName,
    action: input.decision === "accept" ? "client_handover_accepted" : "client_handover_returned",
    recordId: handover.id,
    note: input.decision === "accept" ? "Client portal decision recorded." : input.note,
  });
  return { handover, replayed: false };
}
