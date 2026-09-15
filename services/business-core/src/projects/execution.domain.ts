import { applyControls, assertCloseout } from "./execution-controls";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  ProjectData,
  Task,
  DailyReport,
  PublicProject,
} from "./execution.types";
import {
  completeProjectWorkflow,
  ensureProjectWorkflow,
  reopenProjectWorkflow,
  transitionProjectWorkflow,
} from "./project-workflow";
export const emptyProject = (): ProjectData => ({
  revision: 0,
  phase: "planning",
  controls: {
    reference: "",
    priority: "normal",
    risk: "on_track",
    onHold: false,
    holdReason: "",
    holdSince: "",
    holdOwnerId: "",
    promise: "",
    targetCompletion: "",
    handoverDate: "",
    nextAction: "",
    nextActionOwnerId: "",
    nextActionDate: "",
    nextClientMeeting: "",
    clientNote: "",
  },
  roleAssignments: [],
  approvedMaterials: [],
  scope: null,
  tasks: [],
  reports: [],
  materials: [],
  orders: [],
  documents: [],
  snags: [],
  handovers: [],
  comments: [],
  audit: [],
  processed: [],
  budget: 0,
  forecast: 0,
  financeClosed: false,
  financeEvidence: "",
});
export function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new BadRequestException("Invalid record.");
  return v as Record<string, unknown>;
}
export function str(v: unknown, max = 500, required = false) {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    throw new BadRequestException(
      required ? "Complete the required fields." : "Text is too long.",
    );
  return v.trim();
}
export function num(v: unknown, max = 1e9) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max)
    throw new BadRequestException("Enter a valid non-negative number.");
  return Math.round(v * 10000) / 10000;
}
export function choice<T extends string>(v: unknown, values: readonly T[]): T {
  if (!values.includes(v as T))
    throw new BadRequestException("Choose a valid option.");
  return v as T;
}
export function ids(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 200)
    throw new BadRequestException("Too many linked records.");
  return [...new Set(v.map((x) => str(x, 80, true)))];
}
export function day(v: unknown, required = false) {
  const s = str(v, 10, required);
  if (
    s &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(s) ||
      !Number.isFinite(Date.parse(s)) ||
      new Date(s).toISOString().slice(0, 10) !== s)
  )
    throw new BadRequestException("Choose a valid date.");
  return s;
}
export function url(v: unknown) {
  const s = str(v, 2000);
  if (s) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      throw new BadRequestException("Use a complete HTTPS file link.");
    }
    if (u.protocol !== "https:" || u.username || u.password)
      throw new BadRequestException("Use a complete HTTPS file link.");
  }
  return s;
}
export function get<T extends { id: string }>(rows: T[], id: unknown): T {
  const r = rows.find((r) => r.id === id);
  if (!r) throw new NotFoundException("This record is no longer available.");
  return r;
}
export function approvedQuantity(data: ProjectData, id: string) {
  const superseded = new Set(
    data.reports
      .filter((r) => r.status === "approved")
      .map((r) => r.supersedes)
      .filter(Boolean),
  );
  return (
    Math.round(
      data.reports
        .filter((r) => r.status === "approved" && !superseded.has(r.id))
        .flatMap((r) => r.entries)
        .filter((e) => e.taskId === id)
        .reduce((s, e) => s + e.quantity, 0) * 10000,
    ) / 10000
  );
}
export function progress(data: ProjectData, task?: Task): number {
  const children = task
    ? data.tasks.filter(
        (t) => t.parentId === task.id && t.status !== "cancelled",
      )
    : data.tasks.filter((t) => !t.parentId && t.status !== "cancelled");
  if (children.length) {
    const weight = children.reduce((s, t) => s + t.weight, 0);
    return weight
      ? children.reduce((s, t) => s + progress(data, t) * t.weight, 0) / weight
      : 0;
  }
  return task && task.quantity
    ? Math.min(100, (approvedQuantity(data, task.id) / task.quantity) * 100)
    : 0;
}
export function assertGraph(tasks: Task[]) {
  const graph = new Map(
      tasks.map((t) => [
        t.id,
        [...t.predecessors, ...(t.parentId ? [t.parentId] : [])],
      ]),
    ),
    visited = new Set<string>(),
    active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id))
      throw new ConflictException(
        "A task cannot depend on itself or its descendants.",
      );
    if (visited.has(id)) return;
    if (!graph.has(id))
      throw new BadRequestException("A linked task is missing.");
    active.add(id);
    for (const p of graph.get(id)!) visit(p);
    active.delete(id);
    visited.add(id);
  };
  tasks.forEach((t) => visit(t.id));
}
export function refreshProgress(d: ProjectData) {
  const ordered: Task[] = [];
  const visit = (task: Task) => {
    d.tasks.filter((child) => child.parentId === task.id).forEach(visit);
    ordered.push(task);
  };
  d.tasks.filter((task) => !task.parentId).forEach(visit);
  for (const t of ordered) {
    t.approved = approvedQuantity(d, t.id);
    if (
      t.status === "cancelled" ||
      t.status === "on_hold" ||
      t.status === "blocked"
    )
      continue;
    if (d.tasks.some((c) => c.parentId === t.id)) {
      if (progress(d, t) >= 100)
        t.status = d.tasks
          .filter((c) => c.parentId === t.id)
          .every((c) => c.status === "completed" || c.status === "cancelled")
          ? "completed"
          : "awaiting_inspection";
      else if (progress(d, t) > 0) t.status = "in_progress";
      else if (t.status === "completed" || t.status === "awaiting_inspection")
        t.status = "planned";
      continue;
    }
    if (t.approved >= t.quantity)
      t.status = t.inspectionRequired
        ? t.status === "completed"
          ? "completed"
          : "awaiting_inspection"
        : "completed";
    else if (t.approved > 0) t.status = "in_progress";
    else if (t.status === "completed" || t.status === "awaiting_inspection")
      t.status = "planned";
  }
}
export function publicProject(
  id: string,
  name: string,
  d: ProjectData,
): PublicProject {
  const workflow = ensureProjectWorkflow(d);
  const stage = workflow.template.stages.find(
    (candidate) => candidate.key === workflow.currentStageKey,
  )!;
  return {
    id,
    name,
    phase: d.phase,
    stage: { key: stage.key, name: stage.visibleName },
    progress: Math.round(progress(d)),
    targetCompletion: d.controls?.targetCompletion || undefined,
    handoverDate: d.controls?.handoverDate || undefined,
    promise: d.controls?.promise || undefined,
    milestones: (d.milestones ?? [])
      .filter((milestone) => milestone.visibleToClient)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((milestone) => {
        const tasks = milestone.taskIds
          .map((taskId) => d.tasks.find((task) => task.id === taskId))
          .filter((task): task is Task => Boolean(task));
        return {
          id: milestone.id,
          title: milestone.title,
          dueDate: milestone.dueDate,
          acceptedAt: milestone.acceptedAt,
          progress: tasks.length
            ? Math.round(tasks.reduce((total, task) => total + progress(d, task), 0) / tasks.length)
            : 0,
        };
      }),
    reports: d.reports
      .filter(
        (r) =>
          r.status === "approved" &&
          r.publishedAt &&
          !d.reports.some(
            (n) => n.status === "approved" && n.supersedes === r.id,
          ),
      )
      .map((r) => ({
        id: r.id,
        date: r.date,
        location: r.location,
        tomorrow: r.tomorrow,
        publishedAt: r.publishedAt,
        files: (d.files ?? [])
          .filter((f) => f.recordId === r.id && r.clientFileIds?.includes(f.id))
          .map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType })),
        work: r.entries.map((e) => ({
          title: d.tasks.find((t) => t.id === e.taskId)?.title ?? "Work item",
          quantity: e.quantity,
          unit: d.tasks.find((t) => t.id === e.taskId)?.unit ?? "",
        })),
      })),
    documents: d.documents
      .filter((r) => r.published && r.status === "approved")
      .map((r) => ({
        id: r.id,
        title: r.title,
        kind: r.kind,
        revision: r.revision,
        url: r.url,
      })),
    handovers: d.handovers
      .filter((r) => r.published)
      .map((r) => ({
        id: r.id,
        area: r.area,
        title: r.title,
        status: r.status,
        acceptedAt: r.acceptedAt,
        warrantyUntil: r.warrantyUntil,
        outstanding: r.outstanding,
      })),
  };
}
export type ExecutionActor = {
  today?: string;
  id: string;
  userId?: string;
  name: string;
  manage: boolean;
  review: boolean;
  report: boolean;
  buy: boolean;
  memberIds: string[];
  resourceIds: string[];
  now: string;
  released: boolean;
};
export function applyExecution(
  d: ProjectData,
  action: string,
  b: Record<string, unknown>,
  a: ExecutionActor,
) {
  const manage = () => {
    if (!a.manage)
      throw new ForbiddenException("A project planner must make this change.");
  };
  const review = () => {
    if (!a.review)
      throw new ForbiddenException(
        "A designated reviewer must make this decision.",
      );
  };
  const buy = () => {
    if (!a.buy)
      throw new ForbiddenException("Procurement permission is required.");
  };
  const active = () => {
    if (!a.released)
      throw new ConflictException(
        "Complete the Pre-execution release checklist before execution.",
      );
  };
  const member = (v: unknown) => {
    const id = str(v, 80);
    if (id && !a.memberIds.includes(id))
      throw new BadRequestException("Choose an active workspace member.");
    return id;
  };
  let recordId = str(b.id, 80),
    note = str(b.note, 3000);
  const newId = () => recordId || randomUUID();
  if (
    d.phase === "completed" &&
    ![
      "comment",
      "comment_status",
      "edit_comment",
      "reopen_project",
      "warranty_snag",
      "snag_status",
      "follow",
      "retention_status",
      "publish_report",
      "unpublish_report",
      "publish_document",
    ].includes(action)
  )
    throw new ConflictException(
      "Reopen the completed project with a reason before changing it.",
    );
  const controlId = applyControls(d, action, b, a);
  if (controlId !== undefined) {
    recordId = controlId;
  } else if (action === "project_controls") {
    manage();
    const value = obj(b.controls),
      onHold = value.onHold === true,
      holdReason = str(value.holdReason, 1000, onHold),
      holdOwnerId = member(value.holdOwnerId);
    if (onHold && !holdOwnerId)
      throw new BadRequestException("Choose an owner for the project hold.");
    const previous = d.controls;
    d.controls = {
      reference: str(value.reference, 80, true),
      priority: choice(value.priority, ["normal", "high", "critical"] as const),
      risk: choice(value.risk, ["on_track", "get_ready", "urgent_action", "high_risk", "complete"] as const),
      onHold,
      holdReason,
      holdSince: onHold
        ? previous?.onHold
          ? previous.holdSince
          : a.now
        : "",
      holdOwnerId: onHold ? holdOwnerId : "",
      promise: str(value.promise, 500),
      targetCompletion: day(value.targetCompletion),
      handoverDate: day(value.handoverDate),
      nextAction: str(value.nextAction, 500),
      nextActionOwnerId: member(value.nextActionOwnerId),
      nextActionDate: day(value.nextActionDate),
      nextClientMeeting: day(value.nextClientMeeting),
      clientNote: str(value.clientNote, 3000),
    };
    if (
      previous &&
      (previous.onHold !== onHold ||
        (onHold &&
          (previous.holdReason !== d.controls.holdReason ||
            previous.holdOwnerId !== d.controls.holdOwnerId)))
    ) {
      const action = !previous.onHold
        ? "placed"
        : onHold
          ? "updated"
          : "released";
      d.holdHistory ??= [];
      d.holdHistory.push({
        id: randomUUID(),
        action,
        reason: onHold ? d.controls.holdReason : previous.holdReason,
        ownerId: onHold ? d.controls.holdOwnerId : previous.holdOwnerId,
        at: a.now,
        byId: a.userId ?? a.id,
        byName: a.name,
      });
    }
    recordId = "project-controls";
  } else if (action === "project_roles") {
    manage();
    if (!Array.isArray(b.assignments) || b.assignments.length > 12)
      throw new BadRequestException("Choose one person for each project role.");
    const roles = [
      "sales_manager",
      "senior_designer",
      "junior_designer",
      "technical_designer",
      "visualizer",
      "project_manager",
      "creative_director",
      "finance",
      "procurement_production",
      "crm_owner",
      "sales_assistant",
      "surveyor",
    ] as const;
    d.roleAssignments = b.assignments.map((input) => {
      const assignment = obj(input);
      return {
        role: choice(assignment.role, roles),
        memberId: member(assignment.memberId),
      };
    });
    if (
      d.roleAssignments.some((assignment) => !assignment.memberId) ||
      new Set(d.roleAssignments.map((assignment) => assignment.role)).size !==
        d.roleAssignments.length
    )
      throw new BadRequestException("Give every selected role one active member.");
    recordId = "project-roles";
  } else if (action === "workflow_transition") {
    manage();
    recordId = transitionProjectWorkflow(d, b.toStageKey, b.note, {
      id: a.userId ?? a.id,
      name: a.name,
      now: a.now,
    });
  } else if (action === "milestone") {
    manage();
    const value = obj(b.milestone);
    recordId = str(value.id, 80) || randomUUID();
    d.milestones ??= [];
    const old = d.milestones.find((m) => m.id === recordId);
    if (old?.acceptedAt)
      throw new ConflictException("An accepted milestone is fixed.");
    const taskIds = ids(value.taskIds);
    if (!taskIds.length)
      throw new BadRequestException(
        "Link the work required for this milestone.",
      );
    taskIds.forEach((id) => get(d.tasks, id));
    const milestone = {
      id: recordId,
      title: str(value.title, 240, true),
      dueDate: day(value.dueDate, true),
      baselineDate: old?.baselineDate ?? day(value.dueDate, true),
      ownerId: member(value.ownerId),
      taskIds,
      visibleToClient: value.visibleToClient === true,
      evidence: "",
    };
    if (old) Object.assign(old, milestone);
    else d.milestones.push(milestone);
  } else if (action === "accept_milestone") {
    review();
    active();
    const milestone = get(d.milestones ?? [], recordId);
    if (milestone.acceptedAt)
      throw new ConflictException("This milestone is already accepted.");
    if (milestone.taskIds.some((id) => get(d.tasks, id).status !== "completed"))
      throw new ConflictException(
        "Complete and inspect the milestone work first.",
      );
    milestone.evidence = str(b.note, 3000, true);
    milestone.acceptedAt = a.now;
  } else if (action === "task") {
    manage();
    const v = obj(b.task);
    recordId = str(v.id, 80) || randomUUID();
    const old = d.tasks.find((t) => t.id === recordId);
    const quantity = num(v.quantity);
    if (!quantity)
      throw new BadRequestException(
        "Planned quantity must be greater than zero.",
      );
    const t: Task = {
      id: recordId,
      parentId: str(v.parentId, 80),
      package: str(v.package, 160, true),
      title: str(v.title, 240, true),
      description: str(v.description, 3000),
      area: str(v.area, 160),
      location: choice(v.location, ["site", "factory", "office"]),
      ownerId: member(v.ownerId),
      assigneeIds: ids(v.assigneeIds).map(member),
      resourceId: str(v.resourceId, 80),
      start: day(v.start, true),
      end: day(v.end, true),
      baselineStart: old?.baselineStart || day(v.start, true),
      baselineEnd: old?.baselineEnd || day(v.end, true),
      predecessors: ids(v.predecessors),
      quantity,
      unit: str(v.unit, 30, true),
      weight: num(v.weight, 1000) || 1,
      approved: old?.approved ?? 0,
      status: old?.status ?? "planned",
      priority: choice(v.priority, ["normal", "high", "urgent"]),
      inspectionRequired: v.inspectionRequired === true,
      scopeIds: ids(v.scopeIds),
      drawingId: str(v.drawingId, 80),
      readiness: {
        scope: obj(v.readiness).scope === true,
        access: obj(v.readiness).access === true,
        materials: obj(v.readiness).materials === true,
      },
      blocker: old?.blocker ?? "",
    };
    if (t.end < t.start)
      throw new BadRequestException("Finish must be on or after start.");
    if (t.resourceId && !a.resourceIds.includes(t.resourceId))
      throw new BadRequestException("Choose an active resource.");
    if (t.drawingId) get(d.documents, t.drawingId);
    if (
      t.scopeIds.some(
        (id) =>
          ![
            ...(d.scope?.lines ?? []),
            ...(d.variations ?? [])
              .filter((v) => v.direction !== "deduction")
              .flatMap((v) => v.lines),
          ].some((l) => l.id === id),
      )
    )
      throw new BadRequestException("Link a line from the released BOQ.");
    if (
      old &&
      (d.reports.some((r) => r.entries.some((e) => e.taskId === old.id)) ||
        old.approved > 0) &&
      (old.quantity !== t.quantity ||
        old.unit !== t.unit ||
        old.parentId !== t.parentId ||
        old.weight !== t.weight)
    )
      throw new ConflictException(
        "Reported work keeps its quantity, unit, parent and progress weight. Create an approved scope change instead.",
      );
    if (
      t.parentId &&
      d.reports.some((r) => r.entries.some((e) => e.taskId === t.parentId))
    )
      throw new ConflictException(
        "A reported task cannot become a parent. Create a new package task.",
      );
    const next = d.tasks.filter((x) => x.id !== t.id).concat(t);
    assertGraph(next);
    if (old) Object.assign(old, t);
    else d.tasks.push(t);
  } else if (action === "task_status") {
    manage();
    const t = get(d.tasks, recordId);
    const status = choice(b.status, [
      "planned",
      "in_progress",
      "blocked",
      "on_hold",
      "cancelled",
    ]);
    if (["blocked", "on_hold", "cancelled"].includes(status) && !note)
      throw new BadRequestException("Record the reason.");
    if (
      status === "cancelled" &&
      (t.approved > 0 ||
        d.tasks.some((c) => c.parentId === t.id && c.status !== "cancelled") ||
        d.tasks.some(
          (c) => c.predecessors.includes(t.id) && c.status !== "cancelled",
        ))
    )
      throw new ConflictException(
        "Resolve reported output, subtasks and dependent work before cancelling.",
      );
    if (status === "in_progress") {
      active();
      if (d.controls?.onHold)
        throw new ConflictException(
          `Project is on hold${d.controls.holdReason ? `: ${d.controls.holdReason}` : "."}`,
        );
      if (!t.ownerId || !Object.values(t.readiness).every(Boolean))
        throw new ConflictException(
          "Assign an owner and confirm scope, access and material readiness.",
        );
      if (
        t.location !== "office" &&
        (!t.drawingId || get(d.documents, t.drawingId).status !== "approved")
      )
        throw new ConflictException(
          "Link the approved drawing or specification.",
        );
      if (t.predecessors.some((id) => get(d.tasks, id).status !== "completed"))
        throw new ConflictException("Complete the preceding tasks first.");
    }
    t.status = status;
    if (status === "cancelled")
      for (const material of d.materials)
        material.reservations = material.reservations?.filter(
          (r) => r.taskId !== t.id,
        );
    t.blocker = note;
  } else if (action === "report" || action === "report_submit") {
    if (!a.report && !a.manage)
      throw new ForbiddenException("You cannot report this work.");
    const v = obj(b.report);
    recordId = str(v.id, 80) || randomUUID();
    const old = d.reports.find((r) => r.id === recordId);
    if (
      old &&
      (old.authorId !== a.id || !["draft", "returned"].includes(old.status))
    )
      throw new ConflictException(
        "Only the author can edit a draft or returned report.",
      );
    if (!Array.isArray(v.entries) || v.entries.length > 100)
      throw new BadRequestException("Use up to 100 task updates.");
    const entries = v.entries.map((x) => {
      const e = obj(x),
        t = get(d.tasks, e.taskId);
      if (d.tasks.some((c) => c.parentId === t.id))
        throw new BadRequestException("Report on the subtask, not its parent.");
      if (!a.manage && t.ownerId !== a.id && !t.assigneeIds.includes(a.id))
        throw new ForbiddenException("Report only your assigned work.");
      if (t.status === "cancelled")
        throw new ConflictException("Cancelled work cannot receive progress.");
      return { taskId: t.id, quantity: num(e.quantity) };
    });
    if (new Set(entries.map((e) => e.taskId)).size !== entries.length)
      throw new BadRequestException("Include each task once per report.");
    const r: DailyReport = {
      id: recordId,
      date: day(v.date, true),
      shift: str(v.shift, 80, true),
      location: choice(v.location, ["site", "factory"]),
      authorId: a.id,
      author: a.name,
      status: "draft",
      entries,
      hours: num(v.hours, 24),
      people: num(v.people, 10000),
      summary: str(v.summary, 240),
      weather: str(v.weather, 500),
      safety: str(v.safety, 3000),
      materials: str(v.materials, 3000),
      issues: str(v.issues, 3000),
      tomorrow: str(v.tomorrow, 3000),
      evidence: str(v.evidence, 3000),
      note: "",
      supersedes: str(v.supersedes, 80) || undefined,
    };
    if (!Number.isInteger(r.people))
      throw new BadRequestException(
        "Enter a whole number of people for this shift.",
      );
    if (entries.some((e) => get(d.tasks, e.taskId).location !== r.location))
      throw new BadRequestException(
        "Report site and factory output in separate shifts.",
      );
    if (r.date > (a.today ?? a.now.slice(0, 10)))
      throw new BadRequestException(
        "Daily updates cannot be dated in the future.",
      );
    if (r.supersedes) {
      const previous = get(d.reports, r.supersedes);
      if (previous.status !== "approved" || previous.authorId !== a.id)
        throw new ConflictException("Revise your own approved report.");
      if (
        d.reports.some(
          (x) =>
            x.id !== r.id &&
            x.supersedes === previous.id &&
            x.status !== "returned",
        )
      )
        throw new ConflictException(
          "A revision already exists for this report.",
        );
    }
    if (action === "report_submit") {
      active();
      if (!r.evidence.trim() && !d.files?.some((f) => f.recordId === r.id))
        throw new BadRequestException(
          "Add evidence or a site record reference before submitting.",
        );
      if (!r.entries.length && !r.issues.trim() && !r.summary?.trim())
        throw new BadRequestException(
          "Add work output or explain the no-work shift before submitting.",
        );
      r.status = "submitted";
    }
    if (old) Object.assign(old, r);
    else d.reports.push(r);
  } else if (
    [
      "submit_report",
      "return_report",
      "approve_report",
      "publish_report",
      "unpublish_report",
    ].includes(action)
  ) {
    const r = get(d.reports, recordId);
    if (action === "submit_report") {
      active();
      if (r.authorId !== a.id || !["draft", "returned"].includes(r.status))
        throw new ConflictException("Submit your draft report.");
      if (!r.evidence.trim() && !d.files?.some((f) => f.recordId === r.id))
        throw new BadRequestException(
          "Add evidence or a site record reference before submitting.",
        );
      if (!r.entries.length && !r.issues.trim() && !r.summary?.trim())
        throw new BadRequestException(
          "Add work output or explain the no-work shift before submitting.",
        );
      r.status = "submitted";
    } else if (action === "unpublish_report") {
      review();
      delete r.publishedAt;
      r.clientFileIds = [];
    } else if (action === "publish_report") {
      review();
      if (r.status !== "approved")
        throw new ConflictException("Approve the report before publishing.");
      const fileIds = ids(b.fileIds);
      if (!fileIds.length)
        throw new ConflictException(
          "Select at least one report photo or evidence file before sharing with the client.",
        );
      if (
        fileIds.some(
          (id) => !d.files?.some((f) => f.id === id && f.recordId === r.id),
        )
      )
        throw new BadRequestException(
          "Select files attached to this approved report.",
        );
      if (
        r.entries.some((entry) => {
          const task = get(d.tasks, entry.taskId);
          return task.inspectionRequired && task.status !== "completed";
        })
      )
        throw new ConflictException(
          "Complete the required inspections before sharing this report with the client.",
        );
      r.clientFileIds = fileIds;
      r.publishedAt = a.now;
    } else {
      review();
      if (r.status !== "submitted")
        throw new ConflictException("This report is not waiting for review.");
      if (r.authorId === a.id)
        throw new ForbiddenException(
          "Another reviewer must approve or return your report.",
        );
      if (action === "return_report") {
        if (!note)
          throw new BadRequestException("Explain what needs to change.");
        r.status = "returned";
        r.note = note;
      } else {
        active();
        for (const e of r.entries) {
          const t = get(d.tasks, e.taskId);
          if (
            !["in_progress", "awaiting_inspection", "completed"].includes(
              t.status,
            )
          )
            throw new ConflictException(
              `Start ${t.title} after readiness checks before approving output.`,
            );
        }
        r.status = "approved";
        for (const e of r.entries) {
          if (
            approvedQuantity(d, e.taskId) >
            get(d.tasks, e.taskId).quantity + 0.00001
          )
            throw new ConflictException(
              "Output exceeds the planned quantity. Review the change or correct this report.",
            );
        }
        r.reviewedBy = a.name;
        r.reviewedAt = a.now;
      }
    }
  } else if (action === "inspect") {
    review();
    active();
    const t = get(d.tasks, recordId);
    if (t.approved < t.quantity || !t.inspectionRequired)
      throw new ConflictException(
        "Complete the measured work before inspection.",
      );
    if (!note) throw new BadRequestException("Add the inspection evidence.");
    t.status = b.passed === true ? "completed" : "blocked";
    t.blocker = b.passed === true ? "" : note;
  } else if (action === "material") {
    manage();
    const v = obj(b.material);
    recordId = str(v.id, 80) || randomUUID();
    const old = d.materials.find((m) => m.id === recordId);
    if (
      old &&
      (old.movements.length ||
        d.orders.some((order) => order.materialId === old.id))
    )
      throw new ConflictException(
        "An ordered or received material is fixed. Add a separate requirement.",
      );
    const taskId = str(v.taskId, 80);
    if (taskId) get(d.tasks, taskId);
    const value = {
      id: recordId,
      title: str(v.title, 240, true),
      specification: str(v.specification, 2000),
      catalogId: str(v.catalogId, 80),
      catalogVersion: num(v.catalogVersion ?? 0),
      unit: str(v.unit, 30, true),
      required: num(v.required),
      supply: choice(v.supply, ["company", "vendor", "client"]),
      taskId,
      needBy: day(v.needBy, true),
      movements: [],
    };
    if (!value.required)
      throw new BadRequestException("Enter the required quantity.");
    if (old) Object.assign(old, value);
    else d.materials.push(value);
  } else if (action === "reserve_material") {
    manage();
    active();
    const material = get(d.materials, recordId),
      task = get(d.tasks, b.taskId),
      quantity = num(b.quantity);
    if (quantity > 0 && ["cancelled", "completed"].includes(task.status))
      throw new ConflictException("Reserve stock for unfinished work.");
    if (!note)
      throw new BadRequestException("Record the stock allocation reference.");
    const balance = material.movements.reduce(
      (n, m) =>
        n + (["receive", "return"].includes(m.kind) ? m.quantity : -m.quantity),
      0,
    );
    material.reservations ??= [];
    const others = material.reservations
      .filter((r) => r.taskId !== task.id)
      .reduce((n, r) => n + r.quantity, 0);
    if (quantity > balance - others)
      throw new ConflictException(
        "Accepted stock is already reserved or unavailable.",
      );
    material.reservations = material.reservations.filter(
      (r) => r.taskId !== task.id,
    );
    if (quantity)
      material.reservations.push({
        taskId: task.id,
        quantity,
        reference: note,
        at: a.now,
      });
  } else if (action === "material_move") {
    manage();
    active();
    const m = get(d.materials, recordId),
      kind = choice(b.kind, ["issue", "return", "waste", "receive"]),
      quantity = num(b.quantity);
    if (!quantity || !note)
      throw new BadRequestException(
        "Enter quantity and the stock or delivery reference.",
      );
    if (kind === "receive" && m.supply === "company")
      throw new ConflictException(
        "Receive company purchases against an approved order.",
      );
    const balance = m.movements.reduce(
      (s, x) =>
        s + (["receive", "return"].includes(x.kind) ? x.quantity : -x.quantity),
      0,
    );
    const taskId = str(b.taskId, 80) || m.taskId;
    if (taskId) get(d.tasks, taskId);
    const otherReservations = (m.reservations ?? [])
      .filter((r) => kind !== "issue" || r.taskId !== taskId)
      .reduce((n, r) => n + r.quantity, 0);
    if (
      ["issue", "waste"].includes(kind) &&
      otherReservations > 0 &&
      quantity > balance - otherReservations
    )
      throw new ConflictException(
        "This stock is reserved for other work. Review the reservation before issuing or wasting it.",
      );
    if (["issue", "waste"].includes(kind) && quantity > balance)
      throw new ConflictException(
        "There is not enough accepted stock to issue this quantity.",
      );
    const issued =
      m.movements
        .filter((x) => x.kind === "issue")
        .reduce((s, x) => s + x.quantity, 0) -
      m.movements
        .filter((x) => x.kind === "return")
        .reduce((s, x) => s + x.quantity, 0);
    if (kind === "return" && quantity > issued)
      throw new ConflictException("Returns cannot exceed issued material.");
    m.movements.push({
      taskId,
      id: randomUUID(),
      kind,
      quantity,
      reference: note,
      at: a.now,
    });
    if (kind === "issue") {
      const reservation = m.reservations?.find((r) => r.taskId === taskId);
      if (reservation)
        reservation.quantity = Math.max(0, reservation.quantity - quantity);
    }
  } else if (action === "order" || action === "enquiry") {
    buy();
    const v = obj(b.order);
    recordId = str(v.id, 80) || randomUUID();
    const old = d.orders.find((o) => o.id === recordId);
    if (old && old.status !== (action === "enquiry" ? "enquiry" : "draft"))
      throw new ConflictException("Only draft orders can be edited.");
    const materialId = str(v.materialId, 80),
      taskId = str(v.taskId, 80);
    if (materialId && get(d.materials, materialId).supply !== "company")
      throw new ConflictException(
        "This material is supplied by the client or vendor package. Do not buy it twice.",
      );
    if (taskId) get(d.tasks, taskId);
    const value = {
      id: recordId,
      number:
        old?.number ??
        `${action === "enquiry" ? "RFQ" : "PO"}-${String(d.orders.length + 1).padStart(3, "0")}`,
      title: str(v.title, 240, true),
      vendor: str(v.vendor, 240, true),
      vendorContact: str(v.vendorContact, 240),
      kind: choice(v.kind, ["material", "subcontract", "factory"]),
      materialId,
      taskId,
      quantity: num(v.quantity),
      unit: str(v.unit, 30, true),
      unitCost: num(v.unitCost),
      currency: d.scope?.currency ?? "AED",
      promisedDate: day(v.promisedDate, true),
      status: (action === "enquiry" ? "enquiry" : "draft") as
        "enquiry" | "draft",
      acknowledgement: "",
      receipts: [],
    };
    if(value.kind==="factory"&&(!taskId||get(d.tasks,taskId).location!=="factory"))
      throw new BadRequestException("Link this factory order to its manufacturing task.");
    if (!value.quantity)
      throw new BadRequestException("Enter the order quantity.");
    if (materialId && get(d.materials, materialId).unit !== value.unit)
      throw new ConflictException(
        "Order unit must match the material requirement.",
      );
    if (old) Object.assign(old, value);
    else d.orders.push(value);
  } else if (action === "award_enquiry") {
    buy();
    const order = get(d.orders, recordId);
    if (order.status !== "enquiry")
      throw new ConflictException("Choose an open vendor enquiry.");
    if (!note)
      throw new BadRequestException(
        "Record the comparison and selection reason.",
      );
    order.unitCost = num(b.unitCost);
    order.promisedDate = day(b.promisedDate, true);
    order.sourceEnquiry = order.number;
    order.number = `PO-${order.number.replace("RFQ-", "")}`;
    order.status = "draft";
  } else if (action === "order_status") {
    buy();
    const o = get(d.orders, recordId),
      status = choice(b.status, [
        "submitted",
        "approved",
        "acknowledged",
        "closed",
        "cancelled",
      ]);
    const transitions = {
      submitted: ["draft"],
      approved: ["submitted"],
      acknowledged: ["approved"],
      closed: ["acknowledged"],
      cancelled: ["enquiry", "draft", "submitted", "approved", "acknowledged"],
    };
    if (!transitions[status].includes(o.status))
      throw new ConflictException(
        "The order changed. Review its current state.",
      );
    if (status === "approved") {
      review();
      active();
      if (!d.budget)
        throw new ConflictException(
          "Set the approved operational budget in Commercial first.",
        );
      const commitments = d.orders
        .filter((x) =>
          ["approved", "acknowledged", "closed"].includes(x.status),
        )
        .reduce((s, x) => s + x.quantity * x.unitCost, 0);
      if (commitments + o.quantity * o.unitCost > d.budget)
        throw new ConflictException(
          "The order exceeds the approved budget. Review the budget change first.",
        );
    }
    if (status === "acknowledged" && !note)
      throw new BadRequestException(
        "Record the vendor acknowledgement and promised date.",
      );
    if (
      status === "closed" &&
      o.receipts.reduce((s, r) => s + r.accepted, 0) < o.quantity
    )
      throw new ConflictException(
        "Accept the remaining quantity before closing.",
      );
    if (status === "cancelled" && o.receipts.length)
      throw new ConflictException(
        "An order with receipts needs a controlled return or credit, not cancellation.",
      );
    o.status = status;
    if (status === "acknowledged") {
      o.acknowledgement = note;
      if (b.promisedDate) o.promisedDate = day(b.promisedDate, true);
    }
  } else if (action === "receipt") {
    buy();
    active();
    const o = get(d.orders, recordId);
    if (o.status !== "acknowledged")
      throw new ConflictException("Receive against an acknowledged order.");
    const accepted = num(b.accepted),
      rejected = num(b.rejected);
    if (!(accepted + rejected) || !note)
      throw new BadRequestException(
        "Record received quantities and delivery/inspection evidence.",
      );
    if (o.receipts.reduce((s, r) => s + r.accepted, 0) + accepted > o.quantity)
      throw new ConflictException(
        "Accepted receipts cannot exceed the ordered quantity.",
      );
    const id = randomUUID();
    o.receipts.push({ id, accepted, rejected, evidence: note, at: a.now });
    if (o.materialId && accepted)
      get(d.materials, o.materialId).movements.push({
        id,
        kind: "receive",
        quantity: accepted,
        reference: `${o.number} · ${note}`,
        at: a.now,
      });
  } else if (action === "document") {
    manage();
    const v = obj(b.document);
    recordId = str(v.id, 80) || randomUUID();
    const old = d.documents.find((x) => x.id === recordId);
    if (old && old.status !== "draft")
      throw new ConflictException(
        "Create a new revision to change a reviewed document.",
      );
    const value = {
      id: recordId,
      title: str(v.title, 240, true),
      kind: choice(v.kind, [
        "drawing",
        "specification",
        "permit",
        "as_built",
        "manual",
        "warranty",
        "other",
      ]),
      revision: str(v.revision, 40, true),
      url: url(v.url),
      note: str(v.note, 3000),
      status: "draft" as const,
      replaces: str(v.replaces, 80),
      published: false,
    };
    if (!value.url && !value.note)
      throw new BadRequestException(
        "Add the file link or controlled document reference.",
      );
    if (value.replaces) get(d.documents, value.replaces);
    if (
      d.documents.some(
        (x) =>
          x.id !== value.id &&
          x.title === value.title &&
          x.revision === value.revision,
      )
    )
      throw new ConflictException("That document revision already exists.");
    if (old) Object.assign(old, value);
    else d.documents.push(value);
  } else if (action === "document_status") {
    const doc = get(d.documents, recordId),
      status = choice(b.status, ["review", "approved"]);
    if (status === "review") {
      manage();
      if (doc.status !== "draft")
        throw new ConflictException("Submit a draft document.");
    } else {
      review();
      if (doc.status !== "review")
        throw new ConflictException("This document is not awaiting review.");
      if (doc.replaces) {
        const old = get(d.documents, doc.replaces);
        old.status = "superseded";
        old.published = false;
        for (const t of d.tasks.filter(
          (t) =>
            t.drawingId === old.id &&
            t.status !== "completed" &&
            t.status !== "cancelled",
        )) {
          t.status = "blocked";
          t.blocker =
            "Drawing revised. Review affected work and link the approved revision.";
        }
      }
      doc.approvedBy = a.name;
    }
    doc.status = status;
  } else if (action === "publish_document") {
    review();
    const doc = get(d.documents, recordId);
    if (doc.status !== "approved")
      throw new ConflictException("Publish only an approved document.");
    doc.published = b.published === true;
  } else if (action === "snag" || action === "warranty_snag") {
    if (!a.report && !a.manage)
      throw new ForbiddenException("Project access is required.");
    const v = obj(b.snag);
    const handoverId =
      action === "warranty_snag" ? str(v.handoverId, 80, true) : undefined;
    if (handoverId) {
      const handover = get(d.handovers, handoverId);
      if (handover.status !== "accepted")
        throw new ConflictException(
          "Record a warranty defect against an accepted handover.",
        );
      if (str(v.area, 160, true) !== handover.area)
        throw new BadRequestException("Use the accepted handover area.");
    }
    recordId = str(v.id, 80) || randomUUID();
    if (d.snags.some((s) => s.id === recordId))
      throw new ConflictException(
        "Use the correction and verification actions.",
      );
    const taskId = str(v.taskId, 80);
    if (taskId) get(d.tasks, taskId);
    d.snags.push({
      handoverId,
      id: recordId,
      title: str(v.title, 240, true),
      taskId,
      area: str(v.area, 160, true),
      ownerId: member(v.ownerId),
      severity: choice(v.severity, ["minor", "major", "critical"]),
      dueDate: day(v.dueDate, true),
      status: "open",
      evidence: str(v.evidence, 3000, true),
      resolution: "",
      verifiedBy: undefined,
    });
  } else if (action === "snag_status") {
    const s = get(d.snags, recordId),
      status = choice(b.status, ["ready", "closed", "open"]);
    if (d.phase === "completed" && !s.handoverId)
      throw new ConflictException(
        "Reopen the project before changing a construction snag.",
      );
    if (status === "closed") {
      review();
      if (s.status !== "ready")
        throw new ConflictException(
          "Submit correction evidence before verification.",
        );
      s.verifiedBy = a.name;
    } else if (!a.manage && s.ownerId !== a.id)
      throw new ForbiddenException(
        "Only the assigned person can submit the correction.",
      );
    if (!note)
      throw new BadRequestException(
        "Add the correction, verification or reopening evidence.",
      );
    s.status = status;
    s.resolution = note;
  } else if (action === "handover") {
    manage();
    const v = obj(b.handover);
    recordId = str(v.id, 80) || randomUUID();
    const old = d.handovers.find((h) => h.id === recordId);
    if (old && old.status !== "draft")
      throw new ConflictException("Ready or accepted handovers are fixed.");
    const taskIds = ids(v.taskIds),
      documentIds = ids(v.documentIds);
    taskIds.forEach((id) => {
      if (get(d.tasks, id).area !== str(v.area, 160, true))
        throw new BadRequestException("Choose tasks in the handover area.");
    });
    documentIds.forEach((id) => get(d.documents, id));
    const value = {
      id: recordId,
      area: str(v.area, 160, true),
      title: str(v.title, 240, true),
      status: "draft" as const,
      documentIds,
      taskIds,
      evidence: str(v.evidence, 3000),
      acceptedBy: "",
      acceptedAt: "",
      warrantyUntil: day(v.warrantyUntil),
      outstanding: str(v.outstanding, 3000),
      published: false,
    };
    if (old) Object.assign(old, value);
    else d.handovers.push(value);
  } else if (action === "handover_status") {
    review();
    active();
    const h = get(d.handovers, recordId),
      status = choice(b.status, ["ready", "accepted"]);
    if (
      (status === "ready" && h.status !== "draft") ||
      (status === "accepted" && h.status !== "ready")
    )
      throw new ConflictException("Review the current handover stage.");
    if (status === "ready" && b.confirmed !== true)
      throw new ConflictException(
        "Review the readiness checklist and confirm before changing this handover.",
      );
    if (
      !h.taskIds.length ||
      h.taskIds.some((id) => get(d.tasks, id).status !== "completed")
    )
      throw new ConflictException(
        "Complete and inspect the linked tasks first.",
      );
    if (
      !h.documentIds.length ||
      h.documentIds.some((id) => {
        const document = get(d.documents, id);
        return document.status !== "approved" || !document.published;
      })
    )
      throw new ConflictException(
        "Approve and publish the closeout documents to the client first.",
      );
    const open = d.snags.filter((s) => s.status !== "closed");
    if (open.length)
      throw new ConflictException(
        "Close every project snag before confirming handover readiness.",
      );
    const tasks = h.taskIds.map((id) => get(d.tasks, id));
    const materialTasks = tasks.filter((task) =>
      task.scopeIds.some((scopeId) =>
        Boolean(d.scope?.lines.find((line) => line.id === scopeId)?.material.trim()),
      ),
    );
    for (const task of materialTasks) {
      const planned = d.materials.filter((material) => material.taskId === task.id);
      if (!planned.length)
        throw new ConflictException(
          `Add material planning and procurement evidence for ${task.title}.`,
        );
      if (
        planned.some(
          (material) =>
            material.movements
              .filter((movement) => movement.kind === "receive")
              .reduce((sum, movement) => sum + movement.quantity, 0) <
            material.required,
        )
      )
        throw new ConflictException(
          `Receive the required accepted materials for ${task.title} before handover.`,
        );
    }
    if (status === "accepted") {
      if (!note)
        throw new BadRequestException("Record the client acceptance evidence.");
      h.acceptedBy = str(b.acceptedBy, 240, true);
      h.acceptedAt = a.now;
      h.evidence = note;
      h.published = true;
    }
    h.status = status;
    assertCloseout(d, h.taskIds);
    if (
      d.handovers.length &&
      d.handovers.every((handover) => ["ready", "accepted"].includes(handover.status)) &&
      d.snags.every((snag) => snag.status === "closed")
    )
      d.phase = "handover";
  } else if (action === "commercial") {
    review();
    d.budget = num(b.budget);
    d.forecast = num(b.forecast);
    const committed = d.orders
      .filter((o) => ["approved", "acknowledged", "closed"].includes(o.status))
      .reduce((s, o) => s + o.quantity * o.unitCost, 0);
    if (d.budget < committed)
      throw new ConflictException(
        "Budget cannot be below approved commitments.",
      );
    if (!note)
      throw new BadRequestException(
        "Reference the approved budget or forecast decision.",
      );
    if (
      b.financeClosed === true &&
      (d.retentions?.some((r) => r.status !== "verified") ||
        d.supplierReturns?.some((r) => r.status !== "credited"))
    )
      throw new ConflictException(
        "Reconcile retention and supplier credits before closing the final account.",
      );
    d.financeClosed = b.financeClosed === true;
    d.financeEvidence = d.financeClosed
      ? str(b.financeEvidence, 3000, true)
      : "";
  } else if (action === "complete_project") {
    review();
    assertCloseout(d);
    if (
      d.orders.some(
        (order) => !["closed", "cancelled", "enquiry"].includes(order.status),
      ) ||
      d.milestones?.some((milestone) => !milestone.acceptedAt)
    )
      throw new ConflictException(
        "Close outstanding orders and accept the project milestones before completion.",
      );
    if (
      !d.handovers.length ||
      d.handovers.some((h) => h.status !== "accepted") ||
      d.tasks.some((t) => !["completed", "cancelled"].includes(t.status)) ||
      d.snags.some((s) => s.status !== "closed") ||
      !d.financeClosed
    )
      throw new ConflictException(
        "Complete all work, handovers, snags and financial reconciliation first.",
      );
    recordId = completeProjectWorkflow(d, b.note, {
      id: a.userId ?? a.id,
      name: a.name,
      now: a.now,
    });
    d.phase = "completed";
  } else if (action === "reopen_project") {
    review();
    if (!note)
      throw new BadRequestException("Record why the project is reopening.");
    recordId = reopenProjectWorkflow(d, b.note, {
      id: a.userId ?? a.id,
      name: a.name,
      now: a.now,
    });
    d.phase = "active";
    d.financeClosed = false;
  } else if (action === "comment_status" || action === "edit_comment") {
    const comment = get(d.comments, b.commentId);
    if (comment.authorId !== a.id && !a.manage && !a.review)
      throw new ForbiddenException(
        "Only the author or project manager can update this thread.",
      );
    recordId = comment.recordId;
    if (action === "comment_status") {
      comment.resolved = b.resolved === true;
    } else {
      if (comment.legacy)
        throw new ConflictException(
          "Imported comments are fixed evidence. Add a reply to clarify the record.",
        );
      if (comment.authorId !== a.id)
        throw new ForbiddenException("Only the author can edit a comment.");
      comment.edits ??= [];
      comment.edits.push({ text: comment.text, at: a.now });
      comment.text = str(b.text, 4000, true);
    }
  } else if (action === "comment") {
    if (!a.report && !a.manage && !a.review && !a.buy)
      throw new ForbiddenException("Project access is required.");
    if (
      ![
        ...d.tasks,
        ...d.orders,
        ...d.reports,
        ...d.snags,
        ...d.documents,
        ...d.handovers,
        ...(d.dispatches ?? []),
        ...(d.commissioning ?? []),
        ...(d.technicalQueries ?? []),
        ...(d.transmittals ?? []),
        ...(d.retentions ?? []),
        ...(d.supplierReturns ?? []),
      ].some((r) => r.id === recordId)
    )
      throw new BadRequestException("Choose a project record.");
    const parentId = str(b.parentId, 80);
    if (parentId && get(d.comments, parentId).recordId !== recordId)
      throw new BadRequestException("Reply within this record.");
    if (parentId && get(d.comments, parentId).resolved)
      throw new ConflictException("Reopen the thread before replying.");
    d.comments.push({
      mentions: ids(b.mentions).map(member),
      id: randomUUID(),
      recordId,
      parentId,
      text: str(b.text, 4000, true),
      author: a.name,
      authorId: a.id,
      at: a.now,
      resolved: false,
    });
  } else throw new BadRequestException("Unknown project action.");
  refreshProgress(d);
  d.audit.push({
    id: randomUUID(),
    at: a.now,
    author: a.name,
    action,
    recordId,
    note,
  });
  return recordId;
}
