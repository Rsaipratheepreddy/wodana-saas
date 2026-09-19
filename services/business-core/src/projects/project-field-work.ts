import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import { approvedQuantity, day, num, obj, str } from "./execution.domain";
import type { ProjectData, Task } from "./execution.types";

export type ProjectFieldPermissions = {
  manage: boolean;
  review: boolean;
  report: boolean;
  buy: boolean;
};

export type ProjectFieldProject = {
  id: string;
  name: string;
  customer: string;
  revision: number;
  memberId: string;
  members: { id: string; name: string }[];
  tasks: {
    id: string;
    title: string;
    area: string;
    ownerId: string;
    location: "site" | "factory";
    status: Task["status"];
    start: string;
    end: string;
    quantity: number;
    approved: number;
    remaining: number;
    unit: string;
    canReport: boolean;
    photoCount: number;
  }[];
  deliveries: {
    id: string;
    title: string;
    receivingTaskId: string;
    destination: string;
    dueDate: string;
    quantity: number;
    unit: string;
    reference: string;
    canReceive: boolean;
    photoCount: number;
  }[];
  purchaseReceipts: {
    id: string;
    number: string;
    title: string;
    vendor: string;
    promisedDate: string;
    ordered: number;
    accepted: number;
    remaining: number;
    unit: string;
    photoCount: number;
  }[];
  snags: {
    id: string;
    title: string;
    taskId: string;
    area: string;
    ownerId: string;
    owner: string;
    severity: "minor" | "major" | "critical";
    dueDate: string;
    status: "open" | "ready" | "closed";
    evidence: string;
    resolution: string;
    canResolve: boolean;
    canVerify: boolean;
    canReopen: boolean;
    photoCount: number;
  }[];
  handovers: {
    id: string;
    title: string;
    area: string;
    status: "draft" | "ready" | "returned" | "accepted";
    warrantyUntil: string;
    clientReviewDueDate: string;
    returnedNote: string;
    packet?: {
      version: number;
      tasks: { id: string; title: string; area: string; quantity: number; unit: string }[];
      documents: { id: string; title: string; kind: string; revision: string; url: string }[];
    };
    outstandingItems: {
      id: string;
      title: string;
      kind: "punch" | "document" | "training" | "delivery" | "other";
      blocking: boolean;
      ownerId: string;
      owner: string;
      dueDate: string;
      status: "open" | "ready" | "closed" | "warranty";
      evidence: string;
      resolution: string;
      canResolve: boolean;
      canVerify: boolean;
      canReopen: boolean;
    }[];
  }[];
};

const assigned = (task: Task, memberId: string, permissions: ProjectFieldPermissions) =>
  permissions.manage || task.ownerId === memberId || task.assigneeIds.includes(memberId);

/**
 * A deliberately narrow field projection. It contains quantities and assigned
 * operational records, but no client contacts, employee calendars, supplier
 * contacts, unit cost, budget, margin or finance evidence.
 */
export function projectFieldProject(
  meta: {
    id: string;
    name: string;
    customer: string;
    members?: { id: string; name: string }[];
  },
  data: ProjectData,
  memberId: string,
  permissions: ProjectFieldPermissions,
): ProjectFieldProject {
  const tasks = data.tasks.filter(
    (task) =>
      task.location !== "office" &&
      task.status !== "cancelled" &&
      !data.tasks.some((candidate) => candidate.parentId === task.id && candidate.status !== "cancelled") &&
      assigned(task, memberId, permissions),
  );
  const taskIds = new Set(tasks.map((task) => task.id));
  const files = data.files ?? [];
  return {
    id: meta.id,
    name: meta.name,
    customer: meta.customer,
    revision: data.revision,
    memberId,
    members: meta.members ?? [],
    tasks: tasks.map((task) => {
      const approved = approvedQuantity(data, task.id);
      return {
        id: task.id,
        title: task.title,
        area: task.area,
        ownerId: task.ownerId,
        location: task.location as "site" | "factory",
        status: task.status,
        start: task.start,
        end: task.end,
        quantity: task.quantity,
        approved,
        remaining: Math.max(0, Math.round((task.quantity - approved) * 10000) / 10000),
        unit: task.unit,
        canReport:
          permissions.report &&
          ["in_progress", "awaiting_inspection"].includes(task.status),
        photoCount: files.filter((file) => file.recordId === task.id).length,
      };
    }),
    deliveries: (data.dispatches ?? [])
      .filter(
        (dispatch) =>
          dispatch.status === "dispatched" &&
          taskIds.has(dispatch.receivingTaskId),
      )
      .map((dispatch) => ({
        id: dispatch.id,
        title: dispatch.title,
        receivingTaskId: dispatch.receivingTaskId,
        destination: dispatch.destination,
        dueDate: dispatch.dueDate,
        quantity: dispatch.quantity,
        unit: dispatch.unit,
        reference: dispatch.reference,
        canReceive:
          dispatch.preparedBy !== memberId &&
          (permissions.review || permissions.manage || taskIds.has(dispatch.receivingTaskId)),
        photoCount: files.filter((file) => file.recordId === dispatch.id).length,
      })),
    purchaseReceipts: permissions.buy
      ? data.orders
          .filter(
            (order) =>
              order.status === "acknowledged" &&
              (!order.taskId || taskIds.has(order.taskId) || permissions.manage),
          )
          .map((order) => {
            const accepted = order.receipts.reduce((sum, receipt) => sum + receipt.accepted, 0);
            return {
              id: order.id,
              number: order.number,
              title: order.title,
              vendor: order.vendor,
              promisedDate: order.promisedDate,
              ordered: order.quantity,
              accepted,
              remaining: Math.max(0, Math.round((order.quantity - accepted) * 10000) / 10000),
              unit: order.unit,
              photoCount: files.filter((file) => file.recordId === order.id).length,
            };
          })
          .filter((order) => order.remaining > 0)
      : [],
    snags: data.snags
      .filter(
        (snag) =>
          permissions.manage ||
          permissions.review ||
          snag.ownerId === memberId ||
          Boolean(snag.taskId && taskIds.has(snag.taskId)),
      )
      .map((snag) => ({
        id: snag.id,
        title: snag.title,
        taskId: snag.taskId,
        area: snag.area,
        ownerId: snag.ownerId,
        owner:
          meta.members?.find((member) => member.id === snag.ownerId)?.name ??
          "Project member",
        severity: snag.severity,
        dueDate: snag.dueDate,
        status: snag.status,
        evidence: snag.evidence,
        resolution: snag.resolution,
        canResolve:
          snag.status === "open" &&
          (permissions.manage || snag.ownerId === memberId),
        canVerify:
          snag.status === "ready" &&
          permissions.review &&
          snag.resolutionBy !== memberId,
        canReopen: snag.status !== "open" && permissions.manage,
        photoCount: files.filter((file) => file.recordId === snag.id).length,
      })),
    handovers: data.handovers.map((handover) => ({
      id: handover.id,
      title: handover.title,
      area: handover.area,
      status: handover.status,
      warrantyUntil: handover.warrantyUntil,
      clientReviewDueDate: handover.clientReviewDueDate ?? "",
      returnedNote: handover.returnedNote ?? "",
      packet: handover.packet
        ? {
            version: handover.packet.version,
            tasks: handover.packet.tasks.map((task) => ({
              id: task.id,
              title: task.title,
              area: task.area,
              quantity: task.quantity,
              unit: task.unit,
            })),
            documents: handover.packet.documents.map((document) => ({
              id: document.id,
              title: document.title,
              kind: document.kind,
              revision: document.revision,
              url: document.url,
            })),
          }
        : undefined,
      outstandingItems: (handover.outstandingItems ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        blocking: item.blocking,
        ownerId: item.ownerId,
        owner:
          meta.members?.find((member) => member.id === item.ownerId)?.name ??
          "Project member",
        dueDate: item.dueDate,
        status: item.status,
        evidence: item.evidence,
        resolution: item.resolution,
        canResolve:
          item.status === "open" &&
          (permissions.manage || item.ownerId === memberId),
        canVerify:
          item.status === "ready" &&
          permissions.review &&
          item.resolutionBy !== memberId,
        canReopen:
          item.status !== "open" &&
          (permissions.manage || permissions.review),
      })),
    })),
  };
}

function stableId(value: unknown, label: string) {
  const id = str(value, 80, true);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
    throw new BadRequestException(`Use a stable ${label} identifier.`);
  return id;
}

/** Maps the three native field actions onto the canonical execution commands. */
export function projectFieldCommand(
  data: ProjectData,
  memberId: string,
  permissions: ProjectFieldPermissions,
  input: unknown,
) {
  const body = obj(input);
  const action = str(body.action, 40, true);
  const revision = num(body.revision, Number.MAX_SAFE_INTEGER);
  const requestId = stableId(body.requestId, "request");
  if (action === "report_task" || action === "draft_report_task") {
    if (!permissions.report && !permissions.manage)
      throw new ForbiddenException("Reporting permission is required.");
    const taskId = str(body.taskId, 80, true);
    const task = data.tasks.find((candidate) => candidate.id === taskId);
    if (!task || !assigned(task, memberId, permissions))
      throw new ForbiddenException("Report only work assigned to you.");
    if (!["in_progress", "awaiting_inspection"].includes(task.status))
      throw new ConflictException("Start the assigned task before reporting output.");
    const quantity = num(body.quantity);
    if (!quantity) throw new BadRequestException("Enter the completed quantity.");
    return {
      action: action === "report_task" ? "report_submit" : "report",
      requestId,
      revision,
      report: {
        id: stableId(body.recordId, "report"),
        date: day(body.date, true),
        shift: str(body.shift, 80) || "Field update",
        location: task.location,
        entries: [{ taskId, quantity }],
        hours: num(body.hours ?? 0, 24),
        people: num(body.people ?? 0, 10000),
        summary: str(body.summary, 240),
        weather: "",
        safety: "",
        safetyStatus: "none",
        scheduleImpact: ["none", "watch", "blocked"].includes(
          String(body.scheduleImpact),
        )
          ? body.scheduleImpact
          : "none",
        impactReason: str(body.impactReason, 3000),
        recoveryPlan: str(body.recoveryPlan, 3000),
        nextUpdateOwnerId: str(body.nextUpdateOwnerId, 80),
        nextUpdateDate: day(body.nextUpdateDate),
        materials: "",
        issues: str(body.issues, 3000),
        tomorrow: "",
        evidence: str(body.evidence, 3000, action === "report_task"),
      },
    };
  }
  if (action === "submit_report") {
    if (!permissions.report && !permissions.manage)
      throw new ForbiddenException("Reporting permission is required.");
    return {
      action: "submit_report",
      requestId,
      revision,
      id: stableId(body.recordId, "report"),
    };
  }
  if (action === "create_snag") {
    if (!permissions.report && !permissions.manage)
      throw new ForbiddenException("Project access is required.");
    const taskId = str(body.taskId, 80);
    if (taskId) {
      const task = data.tasks.find((candidate) => candidate.id === taskId);
      if (!task || !assigned(task, memberId, permissions))
        throw new ForbiddenException("Record snags only against assigned work.");
    }
    return {
      action: "snag",
      requestId,
      revision,
      snag: {
        id: stableId(body.recordId, "snag"),
        title: str(body.title, 240, true),
        taskId,
        area: str(body.area, 160, true),
        ownerId: str(body.ownerId, 80, true),
        severity: ["minor", "major", "critical"].includes(String(body.severity))
          ? body.severity
          : "minor",
        dueDate: day(body.dueDate, true),
        evidence: str(body.evidence, 3000, true),
      },
    };
  }
  if (action === "snag_status") {
    const id = stableId(body.recordId, "snag");
    if (!data.snags.some((snag) => snag.id === id))
      throw new BadRequestException("Choose an available snag.");
    return {
      action: "snag_status",
      requestId,
      revision,
      id,
      status: ["open", "ready", "closed"].includes(String(body.status))
        ? body.status
        : "open",
      note: str(body.evidence, 3000, true),
    };
  }
  if (action === "create_warranty_snag") {
    if (!permissions.report && !permissions.manage)
      throw new ForbiddenException("Project access is required.");
    const handoverId = stableId(body.handoverId, "handover");
    const handover = data.handovers.find((candidate) => candidate.id === handoverId);
    if (!handover)
      throw new BadRequestException("Choose an available handover.");
    return {
      action: "warranty_snag",
      requestId,
      revision,
      snag: {
        id: stableId(body.recordId, "snag"),
        handoverId,
        title: str(body.title, 240, true),
        taskId: str(body.taskId, 80),
        area: handover.area,
        ownerId: str(body.ownerId, 80, true),
        severity: ["minor", "major", "critical"].includes(String(body.severity))
          ? body.severity
          : "minor",
        dueDate: day(body.dueDate, true),
        evidence: str(body.evidence, 3000, true),
      },
    };
  }
  if (action === "handover_outstanding_status") {
    const handoverId = stableId(body.handoverId, "handover");
    const handover = data.handovers.find((candidate) => candidate.id === handoverId);
    const itemId = stableId(body.recordId, "handover item");
    if (!handover?.outstandingItems?.some((item) => item.id === itemId))
      throw new BadRequestException("Choose an available handover item.");
    return {
      action: "handover_outstanding_status",
      requestId,
      revision,
      handoverId,
      itemId,
      status: ["open", "ready", "closed", "warranty"].includes(String(body.status))
        ? body.status
        : "open",
      note: str(body.evidence, 3000, true),
    };
  }
  if (action === "receive_dispatch") {
    const id = str(body.recordId, 80, true);
    const dispatch = data.dispatches?.find((candidate) => candidate.id === id);
    const receivingTask = dispatch
      ? data.tasks.find((candidate) => candidate.id === dispatch.receivingTaskId)
      : undefined;
    if (!dispatch || !receivingTask || !assigned(receivingTask, memberId, permissions))
      throw new ForbiddenException("Receive only a delivery assigned to your work.");
    if (dispatch.preparedBy === memberId)
      throw new ForbiddenException("Another team member must receive this delivery.");
    return {
      action: "dispatch_status",
      requestId,
      revision,
      id,
      status: "received",
      accepted: num(body.accepted),
      rejected: num(body.rejected),
      evidence: str(body.evidence, 3000, true),
    };
  }
  if (action === "receive_order") {
    if (!permissions.buy)
      throw new ForbiddenException("Procurement permission is required.");
    const id = str(body.recordId, 80, true);
    const order = data.orders.find((candidate) => candidate.id === id);
    const task = order?.taskId
      ? data.tasks.find((candidate) => candidate.id === order.taskId)
      : undefined;
    if (!order || (task && !assigned(task, memberId, permissions)))
      throw new ForbiddenException("Receive only an order assigned to your work.");
    return {
      action: "receipt",
      requestId,
      revision,
      id,
      accepted: num(body.accepted),
      rejected: num(body.rejected),
      note: str(body.evidence, 3000, true),
    };
  }
  throw new BadRequestException("Choose a supported field action.");
}
