import { applyRfa } from "./project-rfa.command";
import { applyClientPublication, projectClientSections, publicProjectUpdates } from "./project-client-publication";
import { acceptedServiceQuantity, assertServiceAcceptance } from "./project-service-acceptance";
import { quoteBatchRemaining } from "./project-quote-allocation";
import { approveProjectDocument, rfaReadiness } from "./project-rfa";
import { applyDeliveryQuantities } from "./project-delivery-quantities.command";
import { deliveryQuantityReadiness, itemHasCommitments } from "./project-delivery-quantities";
import { itemDeliveryRoute, itemWorkLocations } from "./project-item-plan";
import { materialInventory, orderReceivingPosition } from "./project-inventory";
import { captureDecisionEvidence } from "./project-decision-evidence";
import { installationMaterialCapacity } from "./project-installation-materials";
import {clientProjectAlerts} from "./project-client-alerts";
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
  ProjectInitiationBaseline,
  ProjectRoleAssignment,
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
import {
  activeReleasedScopeLines,
  assertWorkPackageGraph,
  assertUniqueWorkPackageScope,
  routeSupportsLocation,
  workPackageForTask,
} from "./project-work-packages";
import { designReadinessForTask } from "./project-design-control";
import {
  assertSiteOutputWithinFactoryReceipts,
  factoryHandoffReadiness,
} from "./project-factory-handoff";
import { workPackageReadiness } from "./project-package-readiness";
import {
  addHandoverOutstandingItem,
  assertHandoverPacketCurrent,
  createAutomaticHandover,
  refreshHandoverPacket,
  setHandoverOutstandingStatus,
} from "./project-handover";
import { assertWarrantyCoverage } from "./project-warranty";
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
    nextClientMeetingOwnerId: "",
    clientNote: "",
  },
  roleAssignments: [],
  approvedMaterials: [],
  workPackages: [],
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
const projectRoles = [
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
    const outputBatches=t.location==='factory'?t.factoryLots:t.installationBatches;
    if (t.approved >= t.quantity)
      t.status = outputBatches?.some(batch=>batch.status!=="cancelled")
        ? outputBatches.filter(batch=>batch.status==="passed").reduce((total,batch)=>total+batch.quantity,0) >= t.quantity ? "completed" : "awaiting_inspection"
        : t.inspectionRequired
        ? t.status === "completed"
          ? "completed"
          : "awaiting_inspection"
        : "completed";
    else if (t.approved > 0) t.status = "in_progress";
    else if (t.status === "completed" || t.status === "awaiting_inspection")
      t.status = "planned";
  }
}

function assertSubmittableDailyReport(d: ProjectData, r: DailyReport) {
  r.workforce?.forEach((line, index) => {
    if (!line.trade.trim() || !Number.isInteger(line.people) || line.people < 1 || line.hours <= 0)
      throw new BadRequestException(`Complete trade, people and hours for crew line ${index + 1} before submitting.`);
  });
  if (!r.evidence.trim() && !d.files?.some((file) => file.recordId === r.id))
    throw new BadRequestException(
      "Add evidence or a site record reference before submitting.",
    );
  if (!r.entries.length && !r.issues.trim() && !r.summary?.trim())
    throw new BadRequestException(
      "Add work output or explain the no-work shift before submitting.",
    );
  if (r.safetyStatus !== "none" && !r.safety?.trim())
    throw new BadRequestException(
      "Describe the safety observation or incident before submitting.",
    );
  if (r.safetyStatus === "incident" && r.scheduleImpact === "none")
    throw new BadRequestException(
      "Record whether a safety incident puts the schedule at risk.",
    );
  if (r.scheduleImpact !== "none") {
    if (!r.impactReason?.trim())
      throw new BadRequestException(
        "Explain the schedule impact before submitting.",
      );
    if (!r.recoveryPlan?.trim())
      throw new BadRequestException(
        "Record the recovery plan before submitting.",
      );
    if (!r.nextUpdateOwnerId || !r.nextUpdateDate)
      throw new BadRequestException(
        "Assign the next update owner and date for a schedule risk.",
      );
    if (r.nextUpdateDate < r.date)
      throw new BadRequestException(
        "The next risk update cannot be before this shift report.",
      );
  }
}

export function publicProject(
  id: string,
  name: string,
  d: ProjectData,
  today = "",
): PublicProject {
  const clientSections = projectClientSections(d);
  const workflow = ensureProjectWorkflow(d);
  const stage = workflow.template.stages.find(
    (candidate) => candidate.key === workflow.currentStageKey,
  )!;
  // An internal correction replaces the client's update only after publication.
  const publishedReports = clientSections.progress ? d.reports.filter(r => r.status === "approved" && r.publishedAt) : [];
  const sharedReports = publishedReports.filter(r => !publishedReports.some(n => n.supersedes === r.id));
  const sharedTasks = new Set(sharedReports.flatMap(r=>r.entries.map(e=>e.taskId)));
  const sharedQuantity = (taskId: string) => Math.round(sharedReports.flatMap(r => r.entries).filter(e => e.taskId === taskId).reduce((sum, e) => sum + e.quantity, 0) * 10000) / 10000;
  const sharedStatus = (task: Task): Task["status"] => {
    const quantity = sharedQuantity(task.id);
    if (quantity <= 0) return "planned";
    if (!task.quantity || quantity < task.quantity) return "in_progress";
    const batches = (task.location === "factory" ? task.factoryLots : task.installationBatches)?.filter(batch => batch.status !== "cancelled") ?? [];
    const inspection = task.inspections?.at(-1);
    const passed = batches.length
      ? batches.filter(batch => batch.status === "passed" && batch.unit === task.unit).reduce((sum, batch) => sum + batch.quantity, 0) >= task.quantity
      : inspection?.passed && inspection.unit === task.unit && inspection.quantity >= task.quantity;
    return (!task.inspectionRequired && !batches.length) || passed ? "completed" : "awaiting_inspection";
  };
  const sharedData = { ...d, reports: sharedReports, tasks: d.tasks.map(task => ({ ...task, status: sharedStatus(task) })) };
  return {
    id,
    name,
    clientSections,
    clientUpdates: publicProjectUpdates(d),
    alerts: clientSections.updates && clientSections.progress ? clientProjectAlerts(d,today) : [],
    tasks: d.tasks.filter(t=>sharedTasks.has(t.id)).map(t=>({id:t.id,title:t.title,area:t.area,location:t.location,quantity:t.quantity,reportedQuantity:sharedQuantity(t.id),unit:t.unit,status:sharedStatus(t)})),
    phase: d.phase,
    stage: { key: stage.key, name: stage.visibleName },
    progress: clientSections.progress ? Math.round(progress(sharedData)) : 0,
    targetCompletion: d.controls?.targetCompletion || undefined,
    handoverDate: d.controls?.handoverDate || undefined,
    promise: d.controls?.promise || undefined,
    milestones: (clientSections.progress ? d.milestones ?? [] : [])
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
            ? Math.round(tasks.reduce((total, task) => total + progress(sharedData, task), 0) / tasks.length)
            : 0,
        };
      }),
    reports: sharedReports
      .map((r) => ({
        id: r.id,
        date: r.date,
        location: r.location,
        tomorrow: r.tomorrow,
        publishedAt: r.publishedAt,
        clientSummary: r.clientSummary,
        files: (d.files ?? [])
          .filter((f) => f.recordId === r.id && r.clientFileIds?.includes(f.id))
          .map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType })),
        work: r.entries.map((e) => ({
          title: d.tasks.find((t) => t.id === e.taskId)?.title ?? "Work item",
          quantity: e.quantity,
          unit: d.tasks.find((t) => t.id === e.taskId)?.unit ?? "",
          status: sharedData.tasks.find((t) => t.id === e.taskId)?.status,
        })),
      })),
    documents: (clientSections.documents ? d.documents : [])
      .filter((r) => r.published && r.status === "approved")
      .map((r) => ({
        id: r.id,
        title: r.title,
        kind: r.kind,
        revision: r.revision,
        url: r.url,
      })),
    handovers: (clientSections.handover ? d.handovers : [])
      .filter((r) => r.published)
      .map((r) => ({
        id: r.id,
        area: r.area,
        title: r.title,
        status: r.status,
        acceptedAt: r.acceptedAt,
        warrantyUntil: r.warrantyUntil,
        outstanding: r.outstanding,
        clientReviewDueDate: r.clientReviewDueDate,
        packet: r.packet
          ? {
              id: r.packet.id,
              version: r.packet.version,
              tasks: clientSections.progress ? r.packet.tasks : [],
              documents: clientSections.documents ? r.packet.documents : [],
            }
          : undefined,
        outstandingItems: (r.outstandingItems ?? []).map((item) => ({
          id: item.id,
          title: item.title,
          kind: item.kind,
          dueDate: item.dueDate,
          status: item.status,
        })),
      })),
    warrantyClaims: (clientSections.handover ? d.snags : [])
      .filter((snag) => Boolean(snag.handoverId) && d.handovers.some(
        (handover) => handover.id === snag.handoverId && handover.published,
      ))
      .map((snag) => ({
        id: snag.id,
        handoverId: snag.handoverId,
        title: snag.title,
        area: snag.area,
        severity: snag.severity,
        dueDate: snag.dueDate,
        status: snag.status,
        reportedAt: snag.reportedAt,
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
  reviewerIds?: string[];
  resourceIds: string[];
  resourceKinds?: Record<string, "crew" | "person" | "factory" | "vendor">;
  /** Project-owned sites prevalidated by the command handler. */
  siteIds?: string[];
  now: string;
  released: boolean;
  /** Set only after the linked case's latest design revisions are client-approved. */
  designOnlySignedOff?: boolean;
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
      "handover_outstanding_status",
      "follow",
      "retention_status",
      "publish_report",
      "unpublish_report",
      "publish_document",
      "client_update_save",
      "client_update_submit",
      "client_update_publish",
      "client_update_withdraw",
      "client_sections_save",
    ].includes(action)
  )
    throw new ConflictException(
      "Reopen the completed project with a reason before changing it.",
    );
  const publicationId = applyClientPublication(d, action, b, a);
  const controlId = publicationId === undefined ? applyControls(d, action, b, a) : undefined;
  if (publicationId !== undefined) {
    recordId = publicationId;
  } else if (controlId !== undefined) {
    recordId = controlId;
  } else if (action === "project_controls") {
    manage();
    const value = obj(b.controls),
      onHold = value.onHold === true,
      holdReason = str(value.holdReason, 1000, onHold),
      holdOwnerId = member(value.holdOwnerId);
    if (onHold && !holdOwnerId)
      throw new BadRequestException("Choose an owner for the project hold.");
    const targetCompletion = day(value.targetCompletion);
    const handoverDate = day(value.handoverDate);
    if (targetCompletion && handoverDate && handoverDate < targetCompletion)
      throw new BadRequestException(
        "Handover cannot be before the target completion.",
      );
    const nextAction = str(value.nextAction, 500);
    const nextActionOwnerId = member(value.nextActionOwnerId);
    const nextActionDate = day(value.nextActionDate);
    if (
      (nextAction || nextActionOwnerId || nextActionDate) &&
      (!nextAction || !nextActionOwnerId || !nextActionDate)
    )
      throw new BadRequestException(
        "Enter the next action, its owner and its due date together.",
      );
    const nextClientMeeting = day(value.nextClientMeeting);
    const nextClientMeetingOwnerId = member(value.nextClientMeetingOwnerId);
    if (Boolean(nextClientMeeting) !== Boolean(nextClientMeetingOwnerId))
      throw new BadRequestException(
        "Choose an owner whenever a next client meeting is scheduled.",
      );
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
      targetCompletion,
      handoverDate,
      nextAction,
      nextActionOwnerId,
      nextActionDate,
      nextClientMeeting,
      nextClientMeetingOwnerId,
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
  } else if (action === "record_site_visit") {
    manage();
    if (d.workflow?.template.code !== "palm_design_build_delivery" ||
        d.workflow.currentStageKey !== "site_visit")
      throw new ConflictException("Record the visit during the Palm site visit stage.");
    if (d.controls?.onHold)
      throw new ConflictException("Release the project hold before recording the site visit.");
    d.siteVisit = {
      visitedOn: day(b.visitedOn, true),
      scopeSummary: str(b.scopeSummary, 5000, true),
      feeReviewNote: str(b.feeReviewNote, 2000),
      evidenceReference: str(b.evidenceReference, 1000, true),
      recordedAt: a.now,
      recordedBy: a.userId ?? a.id,
    };
    recordId = "site-visit";
  } else if (action === "project_roles") {
    manage();
    if (!Array.isArray(b.assignments) || b.assignments.length > 12)
      throw new BadRequestException("Choose one person for each project role.");
    const assignments: ProjectRoleAssignment[] = b.assignments.map((input) => {
      const assignment = obj(input);
      return {
        role: choice(assignment.role, projectRoles),
        memberId: member(assignment.memberId),
      };
    });
    if (
      assignments.some((assignment) => !assignment.memberId) ||
      new Set(assignments.map((assignment) => assignment.role)).size !==
        assignments.length
    )
      throw new BadRequestException("Give every selected role one active member.");
    if (
      d.initiation?.status === "confirmed" &&
      d.initiation.baseline &&
      !assignments.some(
        (assignment) =>
          assignment.role === "project_manager" &&
          assignment.memberId === d.initiation!.baseline!.projectOwnerId,
      )
    )
      throw new ConflictException(
        "Keep the confirmed project owner in place or record a controlled initiation rebaseline.",
      );
    d.roleAssignments = assignments;
    recordId = "project-roles";
  } else if (
    action === "project_initiation" ||
    action === "revise_project_initiation"
  ) {
    manage();
    active();
    if (!d.scope || !d.initiation)
      throw new ConflictException(
        "Release the approved quotation before confirming project initiation.",
      );
    if (
      d.initiation.commercial.quoteId !== d.scope.quoteId ||
      (d.scope.quoteHash &&
        d.initiation.commercial.quoteHash !== d.scope.quoteHash)
    )
      throw new ConflictException(
        "The commercial release record is inconsistent. Reconcile the release before planning delivery.",
      );
    const value = obj(b.initiation);
    if (!Array.isArray(value.roleAssignments) || !value.roleAssignments.length || value.roleAssignments.length > projectRoles.length)
      throw new BadRequestException("Assign the project roles before confirming initiation.");
    const roleAssignments: ProjectRoleAssignment[] = value.roleAssignments.map(
      (input) => {
        const assignment = obj(input);
        return {
          role: choice(assignment.role, projectRoles),
          memberId: member(assignment.memberId),
        };
      },
    );
    if (
      new Set(roleAssignments.map((assignment) => assignment.role)).size !==
      roleAssignments.length
    )
      throw new BadRequestException("Give every selected role one active member.");
    const projectOwnerId = member(value.projectOwnerId);
    if (
      roleAssignments.filter((assignment) => assignment.role === "project_manager")
        .length !== 1 ||
      !roleAssignments.some(
        (assignment) =>
          assignment.role === "project_manager" &&
          assignment.memberId === projectOwnerId,
      )
    )
      throw new BadRequestException(
        "The project owner must be the assigned project manager.",
      );
    const teamMemberIds = ids(value.teamMemberIds).map(member);
    if (!teamMemberIds.length || !teamMemberIds.includes(projectOwnerId))
      throw new BadRequestException(
        "Include the project owner in the initial delivery team.",
      );
    if (
      roleAssignments.some(
        (assignment) => !teamMemberIds.includes(assignment.memberId),
      )
    )
      throw new BadRequestException(
        "Include every assigned role holder in the initial delivery team.",
      );
    const siteReadiness = choice(value.siteReadiness, [
      "not_required",
      "to_confirm",
      "confirmed",
    ] as const);
    const siteIds = ids(value.siteIds);
    if (
      siteIds.some((siteId) => !a.siteIds?.includes(siteId)) ||
      new Set(siteIds).size !== siteIds.length
    )
      throw new BadRequestException("Choose active sites that belong to this project.");
    if (siteReadiness === "not_required" && siteIds.length)
      throw new BadRequestException(
        "A project without site work cannot include project sites.",
      );
    if (siteReadiness === "confirmed" && !siteIds.length)
      throw new BadRequestException(
        "Confirm at least one active project site or mark site readiness to confirm.",
      );
    const clientContactEmail = str(value.clientContactEmail, 254);
    if (
      clientContactEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(clientContactEmail)
    )
      throw new BadRequestException("Enter a valid client contact email.");
    const operationalStart = day(value.operationalStart, true);
    const targetCompletion = day(value.targetCompletion, true);
    const handoverDate = day(value.handoverDate);
    if (targetCompletion < operationalStart)
      throw new BadRequestException(
        "Target completion must be on or after the operational start.",
      );
    if (handoverDate && handoverDate < targetCompletion)
      throw new BadRequestException(
        "Handover cannot be before the target completion.",
      );
    const baseline: ProjectInitiationBaseline = {
      projectOwnerId,
      teamMemberIds,
      siteReadiness,
      siteIds,
      objective: str(value.objective, 1000, true),
      clientPromise: str(value.clientPromise, 1000, true),
      clientContactName: str(value.clientContactName, 240),
      clientContactPhone: str(value.clientContactPhone, 80),
      clientContactEmail,
      accessNotes: str(value.accessNotes, 3000),
      operationalStart,
      targetCompletion,
      handoverDate,
    };
    const current = d.initiation;
    if (action === "project_initiation") {
      if (current.status === "confirmed")
        throw new ConflictException(
          "Project initiation is already confirmed. Record a controlled rebaseline instead.",
        );
    } else {
      if (current.status !== "confirmed" || !current.baseline)
        throw new ConflictException(
          "Confirm project initiation before revising its baseline.",
        );
      if (
        d.tasks.length ||
        d.reports.length ||
        d.materials.length ||
        d.orders.some((order) => !["enquiry", "draft", "cancelled"].includes(order.status)) ||
        (d.workPackages ?? []).some((workPackage) => workPackage.status !== "planning")
      )
        throw new ConflictException(
          "Detailed delivery planning has started. Use the project change process instead of revising initiation.",
        );
      if (!note)
        throw new BadRequestException("Explain why the project baseline is changing.");
      current.revisions.push({
        id: randomUUID(),
        baseline: structuredClone(current.baseline),
        reason: note,
        at: a.now,
        byId: a.userId ?? a.id,
        byName: a.name,
      });
    }
    d.roleAssignments = roleAssignments;
    d.initiation = {
      ...current,
      status: "confirmed",
      baseline,
      confirmedAt: a.now,
      confirmedById: a.userId ?? a.id,
      confirmedByName: a.name,
    };
    d.controls = {
      ...(d.controls ?? emptyProject().controls!),
      promise: baseline.clientPromise,
      targetCompletion: baseline.targetCompletion,
      handoverDate: baseline.handoverDate,
    };
    recordId = "project-initiation";
  } else if (action === "workflow_transition") {
    manage();
    const stages = d.workflow?.template.stages ?? [];
    const releaseIndex = stages.findIndex(stage => stage.releaseStart);
    const targetIndex = stages.findIndex(stage => stage.key === b.toStageKey);
    const beforePalmRelease = d.workflow?.template.code === "palm_design_build_delivery" &&
      targetIndex >= 0 && (releaseIndex < 0 || targetIndex < releaseIndex);
    if (!beforePalmRelease) active();
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
    const requestedPackageId = str(v.packageId, 80);
    const parent = str(v.parentId, 80)
      ? get(d.tasks, str(v.parentId, 80))
      : undefined;
    if (
      parent?.packageId &&
      requestedPackageId &&
      parent.packageId !== requestedPackageId
    )
      throw new ConflictException(
        "A subtask must stay in its parent work package.",
      );
    const requestedScopeIds = ids(v.scopeIds);
    let workPackage = requestedPackageId
      ? workPackageForTask(d, { packageId: requestedPackageId } as Task)
      : parent
        ? workPackageForTask(d, parent)
        : undefined;
    if (!workPackage && requestedScopeIds.length) {
      const matching = (d.workPackages ?? []).filter(
        (candidate) =>
          candidate.status !== "cancelled" &&
          requestedScopeIds.every((scopeLineId) =>
            candidate.scopeLineIds.includes(scopeLineId),
          ),
      );
      if (matching.length === 1) workPackage = matching[0];
      else if (matching.length > 1)
        throw new ConflictException(
          "Choose one work package before linking this task to released scope.",
        );
    }
    if (
      workPackage &&
      requestedScopeIds.some(
        (scopeLineId) => !workPackage!.scopeLineIds.includes(scopeLineId),
      )
    )
      throw new BadRequestException(
        "A task can only link scope that belongs to its work package.",
      );
    const t: Task = {
      id: recordId,
      parentId: parent?.id ?? "",
      packageId: workPackage?.id,
      package: workPackage?.title ?? str(v.package, 160, true),
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
      scopeIds: requestedScopeIds,
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
          !activeReleasedScopeLines(d).some((line) => line.id === id),
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
        old.weight !== t.weight || old.location !== t.location || old.inspectionRequired !== t.inspectionRequired)
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
  } else if (action === "delivery_quantities" || action === "revise_delivery_quantities") {
    recordId = applyDeliveryQuantities(d, b, a, action === "revise_delivery_quantities");
    note = action === "revise_delivery_quantities" ? str(b.reason, 3000, true) : b.status === "confirmed" ? "Confirmed delivery quantities." : "Saved delivery quantity draft.";
  } else if (action === "work_package") {
    manage();
    const value = obj(b.workPackage);
    const workPackage = get(d.workPackages ?? [], str(value.id, 80, true));
    const status = choice(value.status, [
      "planning",
      "ready",
      "in_progress",
      "on_hold",
      "blocked",
      "completed",
      "cancelled",
    ] as const);
    if (status === "in_progress" && workPackage.status !== "in_progress")
      throw new ConflictException(
        "Start a ready package through its first task, not by changing the package status directly.",
      );
    const ownerId = member(value.ownerId);
    const plannedStart = day(value.plannedStart);
    const plannedEnd = day(value.plannedEnd);
    const predecessorPackageIds = ids(value.predecessorPackageIds);
    const priority = choice(value.priority ?? "normal", [
      "normal",
      "high",
      "critical",
    ] as const);
    const risk = choice(value.risk ?? "on_track", [
      "on_track",
      "watch",
      "blocked",
    ] as const);
    const firstPendingTask = d.tasks.filter(task=>task.packageId===workPackage.id && !["completed","cancelled"].includes(task.status)).sort((a,b)=>a.start.localeCompare(b.start))[0];
    const nextAction = str(value.nextAction || (firstPendingTask?.ownerId ? firstPendingTask.title : ""), 500);
    const nextActionOwnerId = member(value.nextActionOwnerId || firstPendingTask?.ownerId);
    const nextActionDate = day(value.nextActionDate || (firstPendingTask?.ownerId ? firstPendingTask.start : ""));
    const recoveryPlan = str(value.recoveryPlan, 3000);
    const blocker = str(value.blocker, 1000);
    const supplyMethod = value.supplyMethod === undefined ? workPackage.supplyMethod : value.supplyMethod === "" ? undefined : choice(value.supplyMethod, ["make", "buy", "subcontract", "client"] as const);
    const siteWork = value.siteWork === undefined ? workPackage.siteWork : value.siteWork === "" ? undefined : choice(value.siteWork, ["none", "delivery", "install", "site_work"] as const);
    const workLocation = value.workLocation === undefined ? workPackage.workLocation : value.workLocation === "" ? undefined : choice(value.workLocation, ["factory", "supplier", "site", "office"] as const);
    if (workLocation && !itemWorkLocations(supplyMethod).includes(workLocation))
      throw new BadRequestException("Choose a work location that matches the supply responsibility.");
    const deliveryRoute = itemDeliveryRoute({supplyMethod, siteWork, workLocation, deliveryRoute: choice(value.deliveryRoute, ["site", "factory", "vendor", "office", "mixed"] as const)});
    const classificationChanged = supplyMethod !== workPackage.supplyMethod || siteWork !== workPackage.siteWork || deliveryRoute !== workPackage.deliveryRoute || workLocation !== workPackage.workLocation;
    if (classificationChanged && itemHasCommitments(d, workPackage))
      throw new ConflictException("This item has recorded work or supply commitments. Review the change and its affected records before changing its delivery plan.");
    if (supplyMethod && siteWork && d.tasks.some(task=>task.packageId===workPackage.id && !["completed","cancelled"].includes(task.status) && !routeSupportsLocation(deliveryRoute,task.location)))
      throw new ConflictException("Move or resolve incompatible tasks before changing this work order's delivery method.");
    if (plannedStart && plannedEnd && plannedEnd < plannedStart)
      throw new BadRequestException("Package finish must be on or after start.");
    if (
      (nextAction || nextActionOwnerId || nextActionDate) &&
      (!nextAction || !nextActionOwnerId || !nextActionDate)
    )
      throw new BadRequestException(
        "Enter the package next action, owner and due date together.",
      );
    if (risk === "blocked" && !recoveryPlan)
      throw new BadRequestException("Record a recovery plan for a blocked package risk.");
    if (
      d.controls?.targetCompletion &&
      plannedEnd &&
      plannedEnd > d.controls.targetCompletion &&
      !recoveryPlan
    )
      throw new BadRequestException(
        "This package finishes after the client target. Record the recovery plan.",
      );
    if (status === "ready" && !ownerId)
      throw new ConflictException(
        "Assign an accountable owner before marking a work package ready.",
      );
    if (["on_hold", "blocked", "cancelled"].includes(status) && !blocker)
      throw new BadRequestException("Record why this work package is unavailable.");
    const linkedTasks = d.tasks.filter((task) => task.packageId === workPackage.id);
    const plannedPackage = {
        ...workPackage,
        supplyMethod,
        workLocation,
        siteWork,
        ownerId,
        deliveryRoute,
        plannedStart,
        plannedEnd,
        predecessorPackageIds,
        priority,
        risk,
        nextAction,
        nextActionOwnerId,
        nextActionDate,
        recoveryPlan,
      };
    const graphCandidate = structuredClone(d);
    Object.assign(
      get(graphCandidate.workPackages ?? [], workPackage.id),
      plannedPackage,
    );
    assertWorkPackageGraph(graphCandidate);
    for (const dependencyId of predecessorPackageIds) {
      const dependency = get(d.workPackages ?? [], dependencyId);
      if (
        plannedStart &&
        dependency.plannedEnd &&
        plannedStart < dependency.plannedEnd
      )
        throw new BadRequestException(
          `${workPackage.title} cannot start before ${dependency.title} finishes.`,
        );
    }
    if (status === "ready") {
      const issues = workPackageReadiness(d, plannedPackage);
      if (issues.length) throw new ConflictException(issues[0].detail);
    }
    if (
      status === "completed" &&
      (!linkedTasks.some((task) => task.status !== "cancelled") ||
        linkedTasks.some((task) => !["completed", "cancelled"].includes(task.status)))
    )
      throw new ConflictException(
        "Complete the delivery work before completing this item. Cancelled tasks alone do not represent delivered work.",
      );
    if (
      status === "cancelled" &&
      linkedTasks.some(
        (task) =>
          task.approved > 0 ||
          !["planned", "blocked", "on_hold", "cancelled"].includes(task.status),
      )
    )
      throw new ConflictException(
        "Reported or active work cannot be removed from its released package.",
      );
    Object.assign(workPackage, {
      title: str(value.title, 240, true),
      area: str(value.area, 160),
      deliveryRoute,
      supplyMethod,
      workLocation,
      siteWork,
      status,
      ownerId,
      plannedStart,
      plannedEnd,
      predecessorPackageIds,
      priority,
      risk,
      nextAction,
      nextActionOwnerId,
      nextActionDate,
      recoveryPlan,
      blocker,
      updatedAt: a.now,
    });
    for (const task of linkedTasks) task.package = workPackage.title;
    recordId = workPackage.id;
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
        ) ||
        d.dispatches?.some(
          (dispatch) =>
            dispatch.receivingTaskId === t.id &&
            ["ready", "dispatched", "received"].includes(dispatch.status),
        ))
    )
      throw new ConflictException(
        "Resolve reported output, subtasks, dependent work and linked dispatches before cancelling.",
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
      if (t.location !== "office") {
        const designGate = designReadinessForTask(d, t);
        if (!designGate.ready)
          throw new ConflictException(
            "Link the approved design revision captured with this released scope before starting delivery work.",
          );
      }
      if (t.predecessors.some((id) => {
        const preceding=get(d.tasks,id);
        return preceding.status!=="completed" && !(t.location==="site" && preceding.location==="factory" && !["blocked","on_hold","cancelled"].includes(preceding.status));
      }))
        throw new ConflictException("Complete the preceding tasks first.");
      const handoff = factoryHandoffReadiness(d, t);
      if (!handoff.ready) throw new ConflictException(handoff.detail);
      const capacity = installationMaterialCapacity(d, t);
      if (capacity.controlled && (capacity.issue || capacity.quantity <= approvedQuantity(d, t.id)))
        throw new ConflictException(capacity.issue ?? "Issue accepted materials to this site task before starting the next installation quantity.");
      const approvalIssue = rfaReadiness(d, t.scopeIds);
      if (approvalIssue) throw new ConflictException(approvalIssue);
      const workPackage = workPackageForTask(d, t);
      if (workPackage) {
        const quantityIssue = deliveryQuantityReadiness(d, workPackage);
        if (quantityIssue) throw new ConflictException(quantityIssue);
        if (!routeSupportsLocation(workPackage.deliveryRoute, t.location))
          throw new ConflictException(
            "This task location does not match its work package delivery route.",
          );
        if (
          (workPackage.deliveryRoute === "vendor" || (workPackage.supplyMethod === "subcontract" && t.location === "factory")) &&
          a.resourceKinds &&
          a.resourceKinds[t.resourceId] !== "vendor"
        )
          throw new ConflictException(
            "Vendor-route work must be assigned to an active vendor resource.",
          );
        if (!["ready", "in_progress"].includes(workPackage.status))
          throw new ConflictException(
            "Mark the linked work package ready before starting its tasks.",
          );
        if (workPackage.status === "ready") {
          workPackage.status = "in_progress";
          workPackage.updatedAt = a.now;
        }
      }
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
    const safetyStatus = choice(
      v.safetyStatus ?? old?.safetyStatus ?? "none",
      ["none", "observation", "incident"] as const,
    );
    const scheduleImpact = choice(
      v.scheduleImpact ?? old?.scheduleImpact ?? "none",
      ["none", "watch", "blocked"] as const,
    );
    const workforceInput = v.workforce ?? old?.workforce;
    if (workforceInput !== undefined && (!Array.isArray(workforceInput) || workforceInput.length > 20))
      throw new BadRequestException("Use up to 20 crew lines.");
    const workforce = (workforceInput as unknown[] | undefined)?.map((line, index) => {
      const crew = obj(line);
      const trade = str(crew.trade, 120);
      const people = num(crew.people, 1000);
      const hours = num(crew.hours, 24);
      if (action === "report_submit" && (!trade || !Number.isInteger(people) || people < 1 || hours <= 0))
        throw new BadRequestException(`Enter valid people and hours for crew line ${index + 1}.`);
      return { trade, people, hours };
    }) ?? [];
    const crewPeople = workforce.reduce((total, line) => total + line.people, 0);
    const crewHours = workforce.reduce((total, line) => total + line.people * line.hours, 0);
    if (crewPeople > 10000) throw new BadRequestException("Too many people on this shift.");
    const r: DailyReport = {
      id: recordId,
      date: day(v.date, true),
      shift: str(v.shift, 80, true),
      location: choice(v.location, ["site", "factory"]),
      authorId: a.id,
      author: a.name,
      status: "draft",
      entries,
      hours: workforce.length ? (crewPeople ? Math.round(crewHours / crewPeople * 10000) / 10000 : 0) : num(v.hours, 24),
      people: workforce.length ? crewPeople : num(v.people, 10000),
      workforce,
      summary: str(v.summary, 1000),
      weather: str(v.weather, 500),
      safety: str(v.safety, 3000),
      safetyStatus,
      scheduleImpact,
      impactReason: str(v.impactReason ?? old?.impactReason, 3000),
      recoveryPlan: str(v.recoveryPlan ?? old?.recoveryPlan, 3000),
      nextUpdateOwnerId: member(v.nextUpdateOwnerId ?? old?.nextUpdateOwnerId) || undefined,
      nextUpdateDate: day(v.nextUpdateDate ?? old?.nextUpdateDate),
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
      assertSubmittableDailyReport(d, r);
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
      assertSubmittableDailyReport(d, r);
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
      // Sharing reviewed progress does not accept the work or bypass its QC gate.
      r.clientSummary = str(b.clientSummary, 2000);
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
        try {
          for (const e of r.entries) {
            const task = get(d.tasks, e.taskId);
            const approved = approvedQuantity(d, e.taskId);
            if (approved + 0.000001 < acceptedServiceQuantity(d, task.id))
              throw new ConflictException("Resolve accepted subcontract work before reducing its approved output.");
            if (approved + 0.000001 < [...(task.installationBatches??[]),...(task.factoryLots??[])].filter(batch=>batch.status!=="cancelled").reduce((total,batch)=>total+batch.quantity,0))
              throw new ConflictException("Cancel uninspected batches or resolve passed batch acceptance before reducing installed output.");
            const capacity = installationMaterialCapacity(d, task);
            if (capacity.controlled && (capacity.issue || approved > capacity.quantity + 0.000001))
              throw new ConflictException(capacity.issue ?? `Only ${capacity.quantity} ${task.unit} is backed by materials issued to this site task.`);
            if (approved > task.quantity + 0.00001)
              throw new ConflictException(
                "Output exceeds the planned quantity. Review the change or correct this report.",
              );
            if (task.location === "site")
              assertSiteOutputWithinFactoryReceipts(d, task, approved);
          }
        } catch (error) {
          r.status = "submitted";
          throw error;
        }
        r.reviewedBy = a.name;
        r.reviewedAt = a.now;
      }
    }
  } else if (action === "factory_lot") {
    active();
    const task=get(d.tasks,recordId);
    if(!a.manage && (!a.report || (task.ownerId!==a.id&&!task.assigneeIds.includes(a.id)))) throw new ForbiddenException("Only the assigned factory team can create a production lot.");
    if(task.location!=="factory" || ["cancelled","on_hold","blocked"].includes(task.status) || d.tasks.some(child=>child.parentId===task.id)) throw new ConflictException("Choose active measured factory work.");
    if(task.inspections?.length || (d.dispatches??[]).some(dispatch=>dispatch.taskId===task.id&&!dispatch.factoryLotId&&dispatch.status!=="cancelled")) throw new ConflictException("Keep existing whole-task inspection and dispatch history together; create lots before the first dispatch.");
    const quantity=num(b.quantity),title=str(b.title,240,true);
    const allocated=(task.factoryLots??[]).filter(lot=>lot.status!=="cancelled").reduce((total,lot)=>total+lot.quantity,0);
    if(!quantity || allocated+quantity>approvedQuantity(d,task.id)+0.000001) throw new ConflictException("Lot quantity must fit approved factory output not yet allocated.");
    (task.factoryLots??=[]).push({id:randomUUID(),title,quantity,unit:task.unit,createdBy:a.id,at:a.now,status:"pending_qc",reviews:[]});
  } else if (action === "factory_lot_review" || action === "factory_lot_cancel") {
    active();
    const task=get(d.tasks,recordId),lot=get(task.factoryLots??[],b.batchId);
    if(!["pending_qc","rework"].includes(lot.status)) throw new ConflictException("Review the current production lot status.");
    if(!note) throw new BadRequestException("Record the inspection or cancellation evidence.");
    if(action==="factory_lot_cancel") {manage();lot.status="cancelled";}
    else {
      review();
      if(lot.createdBy===a.id||task.ownerId===a.id||task.assigneeIds.includes(a.id)) throw new ForbiddenException("Another reviewer must inspect the factory team's lot.");
      if(["cancelled","on_hold","blocked"].includes(task.status)) throw new ConflictException("Resolve the task hold before inspecting this lot.");
      lot.reviews.push({by:a.id,at:a.now,passed:b.passed===true,evidence:note,evidenceFiles:captureDecisionEvidence(d,task.id,b.fileIds)});
      lot.status=b.passed===true?"passed":"rework";
    }
  } else if (action === "installation_batch") {
    active();
    const task=get(d.tasks,recordId);
    if(!a.manage && (!a.report || (task.ownerId!==a.id && !task.assigneeIds.includes(a.id)))) throw new ForbiddenException("Only the assigned site team can create an installation batch.");
    if(task.location!=="site" || ["cancelled","on_hold","blocked"].includes(task.status) || d.tasks.some(child=>child.parentId===task.id) || d.handovers.some(h=>["ready","accepted"].includes(h.status) && !h.installationBatchIds?.length && h.taskIds.includes(task.id))) throw new ConflictException("Create batches for site work not already offered as a full-task handover.");
    const quantity=num(b.quantity),title=str(b.title,240,true);
    const allocated=(task.installationBatches??[]).filter(batch=>batch.status!=="cancelled").reduce((total,batch)=>total+batch.quantity,0);
    if(!quantity || allocated+quantity>approvedQuantity(d,task.id)+0.000001) throw new ConflictException("Batch quantity must fit the approved installed output not yet allocated.");
    (task.installationBatches??=[]).push({id:randomUUID(),title,quantity,unit:task.unit,createdBy:a.id,at:a.now,status:"pending_qc",reviews:[]});
  } else if (action === "installation_batch_review" || action === "installation_batch_cancel") {
    active();
    const task=get(d.tasks,recordId),batch=get(task.installationBatches??[],b.batchId);
    if(!["pending_qc","rework"].includes(batch.status)) throw new ConflictException("Review the current batch status.");
    if(!note) throw new BadRequestException("Record the inspection or cancellation evidence.");
    if(action==="installation_batch_cancel") {manage();batch.status="cancelled";}
    else {
      review();
      if(batch.createdBy===a.id || task.ownerId===a.id || task.assigneeIds.includes(a.id)) throw new ForbiddenException("Another reviewer must inspect the site team's batch.");
      if(["cancelled","on_hold","blocked"].includes(task.status)) throw new ConflictException("Resolve the task hold before inspecting this batch.");
      const evidenceFiles=captureDecisionEvidence(d,task.id,b.fileIds);
      batch.reviews.push({by:a.id,at:a.now,passed:b.passed===true,evidence:note,evidenceFiles});batch.status=b.passed===true?"passed":"rework";
    }
  } else if (action === "inspect") {
    review();
    active();
    const t = get(d.tasks, recordId);
    if(t.factoryLots?.some(lot=>lot.status!=="cancelled")) throw new ConflictException("Review the production lots individually.");
    if(t.installationBatches?.some(batch=>batch.status!=="cancelled")) throw new ConflictException("Review the installation batches individually.");
    if(t.ownerId===a.id || t.assigneeIds.includes(a.id)) throw new ForbiddenException("Another reviewer must inspect the executing team's work.");
    if (t.approved < t.quantity || !t.inspectionRequired)
      throw new ConflictException(
        "Complete the measured work before inspection.",
      );
    if (!note) throw new BadRequestException("Add the inspection evidence.");
    const evidenceFiles = captureDecisionEvidence(d,t.id,b.fileIds);
    (t.inspections ??= []).push({id:randomUUID(),by:a.id,at:a.now,passed:b.passed===true,quantity:t.approved,unit:t.unit,evidence:note,evidenceFiles});
    t.status = b.passed === true ? "completed" : "blocked";
    t.blocker = b.passed === true ? "" : note;
  } else if (action === "material_output_basis") {
    manage();
    const material = get(d.materials, recordId);
    const task = get(d.tasks, material.taskId);
    if (task.location !== "site" || material.supply === "vendor" || ["completed", "cancelled"].includes(task.status))
      throw new ConflictException("Set a usage basis for an active site task's company or client material.");
    if (material.movements.some(m => ["issue", "return"].includes(m.kind)) || d.reports.some(r => r.entries.some(e => e.taskId === task.id)))
      throw new ConflictException("Set the usage basis before issuing material or reporting site output.");
    const perUnit = num(b.perUnit);
    if (!perUnit || !note) throw new BadRequestException("Enter material quantity per output unit and planning evidence.");
    material.outputBasis = {perUnit, outputUnit:task.unit, by:a.id, at:a.now, evidence:note};
  } else if (action === "material") {
    manage();
    const v = obj(b.material);
    recordId = str(v.id, 80) || randomUUID();
    const old = d.materials.find((m) => m.id === recordId);
    if (
      old &&
      (old.outputBasis || old.movements.length ||
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
      estimatedUnitCost: v.estimatedUnitCost === undefined || v.estimatedUnitCost === "" ? undefined : num(v.estimatedUnitCost),
      supply: choice(v.supply, ["company", "vendor", "client"]),
      taskId,
      scopeLineId: str(v.scopeLineId, 80) || old?.scopeLineId || "",
      needBy: day(v.needBy, true),
      movements: [],
    };
    if (value.scopeLineId && !activeReleasedScopeLines(d).some(line=>line.id===value.scopeLineId)) throw new BadRequestException("Choose an active approved BOQ item.");
    if (!value.required)
      throw new BadRequestException("Enter the required quantity.");
    if (old) Object.assign(old, value);
    else d.materials.push(value);
  } else if (action === "link_designs") {
    manage();
    let linked = 0;
    for (const t of d.tasks) {
      if (["cancelled", "completed"].includes(t.status) || t.location === "office")
        continue;
      const gate = designReadinessForTask(d, t);
      const current = d.documents.find((x) => x.id === t.drawingId);
      if (gate.ready && current?.status === "approved") continue;
      const candidates = gate.documentIds.length
        ? gate.documentIds
        : d.documents
            .filter(
              (x) =>
                x.status === "approved" &&
                x.scopeLineIds?.some((id) => t.scopeIds.includes(id)),
            )
            .map((x) => x.id);
      if (!candidates.length) continue;
      const preferred = candidates[candidates.length - 1];
      if (t.drawingId === preferred) continue;
      t.drawingId = preferred;
      linked++;
    }
    if (!linked)
      throw new ConflictException(
        "No approved drawing covers the tasks that still need one.",
      );
    note = `${linked} task${linked === 1 ? "" : "s"} linked to approved drawings.`;
  } else if (action === "materials_from_scope") {
    manage();
    const activeLines = activeReleasedScopeLines(d);
    const selected = b.scopeLineIds === undefined ? null : ids(b.scopeLineIds);
    if (selected && (!selected.length || selected.length > 100 || selected.some(id => !activeLines.some(line => line.id === id))))
      throw new BadRequestException("Select between 1 and 100 active released items.");
    const lines = selected ? activeLines.filter(line => selected.includes(line.id)) : activeLines;
    if (!lines.length)
      throw new ConflictException("No released scope to plan materials from.");
    const planned = new Set(
      d.materials.map((material) => material.scopeLineId).filter(Boolean),
    );
    let created = 0;
    for (const line of lines) {
      if (planned.has(line.id) || line.deductsLineId) continue;
      const task = d.tasks.find(
        (candidate) =>
          candidate.status !== "cancelled" &&
          (candidate.scopeIds ?? []).includes(line.id),
      );
      const needBy =
        task?.start || d.controls?.targetCompletion || a.now.slice(0, 10);
      const rows =
        line.pricingMode === "materials" && line.materialRows?.length
          ? line.materialRows
              .filter((row) => row.type === "material" || row.type === "finish")
              .map((row) => ({
                title: row.name || line.material || line.title,
                specification: [row.specification, line.room]
                  .filter(Boolean)
                  .join(" · "),
                unit: row.unit || line.unit,
                required: row.quantity || line.quantity,
                supply: row.suppliedByClient
                  ? ("client" as const)
                  : ("company" as const),
              }))
          : [
              {
                title: line.material || line.title,
                specification: [
                  line.title,
                  line.specification,
                  line.finish,
                  line.room,
                ]
                  .filter(Boolean)
                  .join(" · "),
                unit: line.unit,
                required: line.quantity,
                supply: line.customMaterials?.some(
                  (material) => material.suppliedByClient,
                )
                  ? ("client" as const)
                  : ("company" as const),
              },
            ];
      for (const row of rows) {
        if (!row.required) continue;
        d.materials.push({
          id: randomUUID(),
          title: row.title.slice(0, 240),
          specification: row.specification.slice(0, 2000),
          catalogId: "",
          catalogVersion: 0,
          unit: (row.unit || "nos").slice(0, 30),
          required: row.required,
          supply: row.supply,
          taskId: task?.id ?? "",
          scopeLineId: line.id,
          needBy,
          movements: [],
        });
        created++;
      }
    }
    if (!created)
      throw new ConflictException(
        "Every released scope item already has material requirements.",
      );
    note = `${created} material requirement${created === 1 ? "" : "s"} planned from the released scope.`;
  } else if (action === "material_scope_link") {
    manage();
    const material = get(d.materials, recordId);
    const scopeLineId = str(b.scopeLineId, 80, true);
    if (!activeReleasedScopeLines(d).some(line=>line.id===scopeLineId)) throw new BadRequestException("Choose an active approved BOQ item.");
    material.scopeLineId = scopeLineId;
    note = "Requirement linked to approved BOQ item.";
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
        .filter((x) => x.kind === "issue" && x.taskId === taskId)
        .reduce((s, x) => s + x.quantity, 0) -
      m.movements
        .filter((x) => x.kind === "return" && x.taskId === taskId)
        .reduce((s, x) => s + x.quantity, 0);
    if (kind === "return" && quantity > issued)
      throw new ConflictException("Returns cannot exceed issued material.");
    if (kind === "return" && m.outputBasis && taskId === m.taskId &&
        issued - quantity + 0.000001 < approvedQuantity(d, taskId) * m.outputBasis.perUnit)
      throw new ConflictException("This material supports approved installation. Return only the unused balance.");
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
  } else if (action === "record_supplier_offer") {
    buy();
    const order = get(d.orders, recordId);
    if (order.status !== "enquiry") throw new ConflictException("Record offers against an open supplier quote request.");
    const quantity = num(b.quantity), unitCost = num(b.unitCost);
    if (!quantity || !unitCost) throw new BadRequestException("Enter a positive offered quantity and unit price.");
    if (quantity > order.quantity) throw new BadRequestException("Offered quantity cannot exceed the requested quantity.");
    const offer = {id:randomUUID(),at:a.now,kind:"quotation" as const,quantity,unitCost,date:day(b.promisedDate,true),note:str(b.note,3000),evidence:str(b.evidence,2000,true)};
    order.vendorUpdates ??= [];
    order.vendorUpdates.push(offer);
  } else if (action === "reopen_order") {
    buy();
    review();
    const order=get(d.orders,recordId);
    if (order.status!=="closed") throw new ConflictException("Only a closed order can be reopened.");
    if (!note) throw new BadRequestException("Record why the order is being reopened.");
    if (d.financeClosed) throw new ConflictException("Reopen the final account before reopening the order.");
    order.status="acknowledged";
  } else if (action === "order_notes") {
    buy();
    const order = get(d.orders, recordId);
    order.notes = str(b.notes, 10000);
  } else if (action === "order_shipment") {
    buy();
    const order = get(d.orders, recordId);
    if (!["approved", "acknowledged"].includes(order.status)) throw new ConflictException("Track shipments against an open approved order.");
    if (orderReceivingPosition(d, order).remainingToArrive <= 0)
      throw new ConflictException("All ordered quantity has arrived. Inspect pending receipts or close the order instead.");
    const quantity = num(b.quantity);
    if (!quantity || quantity > order.quantity) throw new BadRequestException("Shipment quantity must be positive and cannot exceed the order quantity.");
    const shipment = {id: randomUUID(), at: a.now, status: choice(b.status, ["preparing", "dispatched", "arrived"]), carrier: str(b.carrier, 200), reference: str(b.reference, 240, true), expectedDate: day(b.expectedDate, true), quantity, note: str(b.note, 3000)};
    order.shipments ??= [];
    order.shipments.push(shipment);
  } else if (action === "supplier_invoice") {
    buy();
    if (d.financeClosed) throw new ConflictException("Reopen the final account before recording invoices.");
    const o = get(d.orders, str(b.orderId, 80, true));
    if (!["approved", "acknowledged", "closed"].includes(o.status)) throw new ConflictException("Choose an approved purchase order.");
    const existing = (d.supplierInvoices ?? []).find(i=>i.id===recordId);
    if (existing && existing.status !== "draft") throw new ConflictException("Approved invoices cannot be edited.");
    const number = str(b.number, 120, true);
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    d.supplierInvoices ??= [];
    if (d.supplierInvoices.some(i => i.id !== recordId && normalize(i.number) === normalize(number) && normalize(get(d.orders, i.orderId).vendor) === normalize(o.vendor)))
      throw new ConflictException("This supplier invoice number is already recorded.");
    const quantity = num(b.quantity), unitCost = num(b.unitCost), tax = num(b.tax);
    if (!quantity || !unitCost) throw new BadRequestException("Enter a positive quantity and unit cost.");
    const date = day(b.date, true), dueDate = day(b.dueDate, true);
    if (dueDate < date) throw new BadRequestException("Due date cannot be before invoice date.");
    recordId = existing?.id ?? randomUUID();
    const invoice: import("./execution.types").SupplierInvoice = {id: recordId, orderId: o.id, number, date, dueDate, quantity, unitCost, tax, evidence: str(b.evidence, 2000, true), status: "draft", payments: []};
    if (existing) Object.assign(existing, invoice); else d.supplierInvoices.push(invoice);
  } else if (action === "approve_supplier_invoice") {
    review();
    if (d.financeClosed) throw new ConflictException("Reopen the final account before changing supplier invoices.");
    const invoice = get(d.supplierInvoices ?? [], recordId);
    if (invoice.status !== "draft") throw new ConflictException("Invoice is already approved.");
    const o = get(d.orders, invoice.orderId);
    assertServiceAcceptance(d, o, 0);
    const returned = (d.supplierReturns ?? []).filter(r => r.orderId === o.id && ["dispatched", "credited"].includes(r.status)).reduce((n,r) => n+r.quantity,0);
    const accepted = o.receipts.reduce((n,r) => n+r.accepted,0)-returned;
    const billed = (d.supplierInvoices ?? []).filter(i => i.orderId === o.id && i.status === "approved").reduce((n,i) => n+i.quantity,0);
    if (invoice.quantity+billed > accepted + 0.000001) throw new ConflictException("Invoice quantity exceeds accepted, unbilled delivery. Record the receipt or resolve the return first.");
    if (Math.abs(invoice.unitCost-o.unitCost)>0.005) throw new ConflictException("Invoice rate differs from the approved order. Resolve the supplier invoice before approval.");
    invoice.status = "approved"; invoice.approvedBy = a.id;
  } else if (action === "supplier_payment") {
    review();
    if (d.financeClosed) throw new ConflictException("Reopen the final account before changing supplier invoices.");
    const invoice = get(d.supplierInvoices ?? [], recordId);
    if (invoice.status !== "approved") throw new ConflictException("Approve the invoice before recording payment.");
    const amount = num(b.amount), reference = str(b.reference, 240, true);
    if (!amount || amount + invoice.payments.reduce((n,p)=>n+p.amount,0) > invoice.quantity*invoice.unitCost+invoice.tax+0.005)
      throw new ConflictException("Payment must be positive and cannot exceed the invoice balance.");
    if ((d.supplierInvoices ?? []).some(i=>i.payments.some(p=>p.reference===reference))) throw new ConflictException("This payment reference is already recorded.");
    invoice.payments.push({id:randomUUID(),amount,reference,date:day(b.date,true)});
  } else if (action === "replace_enquiry") {
    buy();
    const original = get(d.orders, recordId);
    if (!["enquiry", "cancelled"].includes(original.status) || original.sourceEnquiry || original.replacedByRequestId)
      throw new ConflictException("Only the latest unselected supplier request can be replaced.");
    if (!original.vendorId || !original.materialId || !original.rfqSnapshot)
      throw new ConflictException("Create a new request from a linked requirement for this legacy record.");
    if (!note) throw new BadRequestException("Record why this request is being replaced.");
    if (d.orders.some(order => order.id !== original.id && order.vendorId === original.vendorId && order.materialId === original.materialId && order.status === "enquiry"))
      throw new ConflictException("An open request already exists for this supplier and requirement. Review it before replacing this request.");
    if (original.quoteRequestId && d.orders.some(order => order.quoteRequestId === original.quoteRequestId && order.sourceEnquiry && order.status !== "cancelled"))
      throw new ConflictException("This request batch has supplier selections. Resolve those selections before changing its scope.");
    const material = get(d.materials, original.materialId);
    if (material.unit !== original.unit || material.taskId !== original.taskId)
      throw new ConflictException("The requirement unit or consuming task changed. Plan a new request batch.");
    const draft = structuredClone(d), retired = get(draft.orders, original.id);
    const replacementId = randomUUID();
    applyExecution(draft, "enquiry", {order: {
      ...original, ...obj(b.supplier), id: replacementId, title: material.title,
      quantity: original.rfqSnapshot.quantity, unitCost: 0,
      quoteDueDate: day(b.quoteDueDate, true), promisedDate: day(b.promisedDate, true),
    }}, a);
    const replacement = get(draft.orders, replacementId);
    replacement.replacesRequestId = original.id;
    replacement.replacementReason = note;
    replacement.replacementBy = a.id;
    replacement.replacementAt = a.now;
    retired.status = "cancelled";
    retired.replacedByRequestId = replacementId;
    d.orders = draft.orders;
    d.audit = draft.audit;
    recordId = replacementId;
  } else if (action === "request_item_quotes") {
    buy();
    const rows = Array.isArray(b.requirements) ? b.requirements.map(obj) : [];
    if (!rows.length || rows.length > 100 || new Set(rows.map(row => row.materialId)).size !== rows.length)
      throw new BadRequestException("Select between 1 and 100 distinct material requirements.");
    // Apply every existing RFQ rule to a private draft. One invalid requirement
    // rejects the whole selection; no partially created RFQs or audit entries.
    const draft = structuredClone(d);
    for (const requirement of rows) applyExecution(draft, "request_supplier_quotes", {
      materialId: requirement.materialId, quantity: requirement.quantity,
      suppliers: b.suppliers, quoteDueDate: b.quoteDueDate, promisedDate: b.promisedDate,
    }, a);
    d.orders = draft.orders;
    d.audit = draft.audit;
    note = `${rows.length} requirements requested from suppliers. Draft requests created; nothing sent.`;
  } else if (action === "request_supplier_quotes") {
    buy();
    const suppliers = Array.isArray(b.suppliers) ? b.suppliers.map(obj) : [];
    if (!suppliers.length || suppliers.length > 25 || new Set(suppliers.map(s=>s.id)).size !== suppliers.length)
      throw new BadRequestException("Choose distinct suppliers.");
    const material = get(d.materials, b.materialId);
    const due = day(b.quoteDueDate, true);
    const quantity = num(b.quantity);
    if (!quantity) throw new BadRequestException("Enter the requested quantity.");
    if (suppliers.some(s=>d.orders.some(o=>o.vendorId===s.id && o.materialId===material.id && o.status==="enquiry")))
      throw new ConflictException("An open quote request already exists for one of these suppliers and this requirement.");
    const draft = structuredClone(d);
    recordId = randomUUID();
    for (const supplier of suppliers) {
      applyExecution(draft, "enquiry", {order:{title:material.title,materialId:material.id,taskId:material.taskId,
        kind:"material",quantity,unit:material.unit,unitCost:0,promisedDate:day(b.promisedDate,true),
        vendorId:supplier.id,vendor:supplier.name,vendorSiteId:supplier.siteId ?? "",vendorPhone:supplier.phone ?? "",
        vendorContact:supplier.email ?? supplier.phone ?? "",quoteRequestId:recordId,quoteDueDate:due}}, a);
    }
    d.orders = draft.orders;
    d.audit = draft.audit;
    note = `${suppliers.length} supplier quote requests created. Not sent.`;
  } else if (action === "order" || action === "enquiry") {
    buy();
    const v = obj(b.order);
    recordId = str(v.id, 80) || randomUUID();
    const old = d.orders.find((o) => o.id === recordId);
    if (old && old.status !== (action === "enquiry" ? "enquiry" : "draft"))
      throw new ConflictException("Only draft orders can be edited.");
    if (old && action === "enquiry" && (old.rfqSnapshot || old.vendorUpdates?.length))
      throw new ConflictException("This request is frozen. Cancel it and create a replacement request to change the scope.");
    const materialId = str(v.materialId, 80),
      material = materialId ? get(d.materials, materialId) : undefined,
      taskId = str(v.taskId, 80) || material?.taskId || "";
    if (material?.taskId && taskId !== material.taskId)
      throw new ConflictException("Use the consuming task linked to this material requirement.");
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
      vendorId: str(v.vendorId, 80) || undefined,
      vendorSiteId: str(v.vendorSiteId, 80) || undefined,
      vendorPhone: str(v.vendorPhone, 80) || undefined,
      quoteRequestId: old?.quoteRequestId || str(v.quoteRequestId, 80) || undefined,
      quoteDueDate: v.quoteDueDate ? day(v.quoteDueDate, true) : old?.quoteDueDate,
      vendorContact: str(v.vendorContact, 240),
      kind: choice(v.kind, ["material", "subcontract", "factory"]),
      materialId,
      taskId,
      quantity: num(v.quantity),
      unit: str(v.unit, 30, true),
      unitCost: num(v.unitCost),
      currency: d.scope?.currency ?? "AED",
      promisedDate: day(v.promisedDate, true),
      leadTimeDays: v.leadTimeDays === undefined || v.leadTimeDays === null || v.leadTimeDays === ""
        ? undefined
        : num(v.leadTimeDays, 730),
      status: (action === "enquiry" ? "enquiry" : "draft") as
        "enquiry" | "draft",
      acknowledgement: "",
      receipts: [],
    };
    if(value.kind==="factory"&&(!taskId||get(d.tasks,taskId).location!=="factory"))
      throw new BadRequestException("Link this factory order to its manufacturing task.");
    if (!value.quantity)
      throw new BadRequestException("Enter the order quantity.");
    if (value.leadTimeDays !== undefined && value.leadTimeDays < 1)
      throw new BadRequestException("Supplier lead time must be at least one day.");
    if (materialId && get(d.materials, materialId).unit !== value.unit)
      throw new ConflictException(
        "Order unit must match the material requirement.",
      );
    if ((old?.rfqSnapshot || old?.selectedOffer) && (value.materialId !== old.materialId || value.taskId !== old.taskId || value.unit !== old.unit || value.title !== old.title || value.kind !== old.kind || value.vendor !== old.vendor || value.vendorId !== old.vendorId))
      throw new ConflictException("Keep the selected request's item, supplier and unit. Create a separate request for different scope.");
    const task = taskId ? get(d.tasks, taskId) : undefined;
    if (old?.selectedOffer && (value.unitCost !== old.selectedOffer.unitCost || value.promisedDate !== old.selectedOffer.promisedDate))
      throw new ConflictException("Keep the selected quote price and delivery date. Cancel the selection and request a revised quote to change these terms.");
    if (old?.selectedOffer && value.quantity > Math.min(old.selectedOffer.quotedQuantity, quoteBatchRemaining(d.orders, old)) + 0.000001)
      throw new ConflictException("Order quantity exceeds the selected offer or remaining request batch quantity.");
    if (old) Object.assign(old, value);
    else d.orders.push({...value, ...(action === "enquiry" ? {rfqSnapshot: {
      capturedAt: a.now, capturedBy: a.id, projectRevision: d.revision,
      materialId, taskId, scopeLineId: material?.scopeLineId ?? "",
      catalogId: material?.catalogId ?? "", catalogVersion: material?.catalogVersion ?? 0,
      title: value.title, specification: material?.specification ?? task?.description ?? "",
      workTitle: task?.title ?? "", workArea: task?.area ?? "",
      quantity: value.quantity, unit: value.unit, currency: value.currency,
      promisedDate: value.promisedDate, quoteDueDate: value.quoteDueDate ?? "",
    }} : {})});
  } else if (action === "award_enquiry") {
    buy();
    const order = get(d.orders, recordId);
    if (order.status !== "enquiry")
      throw new ConflictException("Choose an open vendor enquiry.");
    if (!note)
      throw new BadRequestException(
        "Record the comparison and selection reason.",
      );
    const offer = order.vendorUpdates?.filter(update => update.kind === "quotation").at(-1);
    if (!offer || str(b.offerId, 80, true) !== offer.id)
      throw new ConflictException("The supplier offer changed. Review and select the latest recorded offer.");
    const awardedQuantity = b.quantity === undefined ? offer.quantity : num(b.quantity);
    if (!awardedQuantity || awardedQuantity > order.quantity) throw new BadRequestException("Order quantity must be within the requested quantity.");
    if (awardedQuantity > offer.quantity) throw new BadRequestException("Order quantity cannot exceed the supplier's offered quantity.");
    if (awardedQuantity > quoteBatchRemaining(d.orders, order) + 0.000001)
      throw new ConflictException("Selection exceeds the remaining request batch quantity. Review the other supplier selections.");
    const unitCost = num(offer.unitCost), promisedDate = day(offer.date, true);
    if (!unitCost) throw new BadRequestException("Enter a positive selected unit price.");
    order.selectedOffer = {offerId: offer.id, selectedBy: a.id, selectedAt: a.now, reason: note,
      quantity: awardedQuantity, quotedQuantity: offer.quantity, unitCost, promisedDate, evidence: offer.evidence};
    order.quantity = awardedQuantity;
    order.unitCost = unitCost;
    order.promisedDate = promisedDate;
    order.sourceEnquiry = order.number;
    order.number = `PO-${order.number.replace("RFQ-", "")}`;
    order.status = "draft";
  } else if (action === "order_amendment_assign") {
    const order = get(d.orders, recordId);
    const amendment = get(order.amendments ?? [], str(b.amendmentId, 80, true));
    if (!a.manage && !(a.buy && amendment.createdBy === a.id))
      throw new ForbiddenException("A project manager or the proposer with procurement permission must reassign this review.");
    if (amendment.status !== "submitted") throw new ConflictException("Only pending amendments can be reassigned.");
    const reviewerId = str(b.reviewerId, 80, true), dueDate = day(b.dueDate, true);
    if (reviewerId === amendment.createdBy || !a.reviewerIds?.includes(reviewerId))
      throw new BadRequestException("Choose an independent reviewer with access to this project.");
    if (!note) throw new BadRequestException("Record why this review is being reassigned.");
    if (reviewerId === amendment.reviewerId && dueDate === amendment.dueDate)
      throw new BadRequestException("Change the reviewer or due date before saving.");
    const assignment = {fromReviewerId: amendment.reviewerId ?? "", toReviewerId: reviewerId,
      fromDueDate: amendment.dueDate ?? "", toDueDate: dueDate, by: a.id, at: a.now, reason: note};
    amendment.assignments ??= [];
    amendment.assignments.push(assignment);
    amendment.reviewerId = reviewerId;
    amendment.dueDate = dueDate;
  } else if (action === "order_amendment" || action === "order_amendment_decide") {
    const order = get(d.orders, recordId);
    const assertAmendable = () => {
      if (!["approved", "acknowledged"].includes(order.status))
        throw new ConflictException("Amend an open approved order.");
      if (d.financeClosed) throw new ConflictException("Reopen the final account before amending an order.");
      if (order.receipts.length || order.shipments?.length ||
        order.vendorUpdates?.some(update => ["progress", "delivery"].includes(update.kind)) ||
        d.supplierInvoices?.some(invoice => invoice.orderId === order.id) ||
        d.supplierReturns?.some(ret => ret.orderId === order.id))
        throw new ConflictException("This order has fulfilment or financial records. Use a controlled return or financial adjustment instead.");
    };
    if (action === "order_amendment") {
      buy();
      assertAmendable();
      if (order.amendments?.some(amendment => amendment.status === "submitted"))
        throw new ConflictException("Resolve the pending amendment first.");
      const after = {unitCost: num(b.unitCost), promisedDate: day(b.promisedDate, true)};
      if (!after.unitCost || !note) throw new BadRequestException("Enter a positive unit price and amendment reason.");
      if (after.unitCost === order.unitCost && after.promisedDate === order.promisedDate)
        throw new BadRequestException("Change the price or delivery date before proposing an amendment.");
      const reviewerId = str(b.reviewerId, 80, true), dueDate = day(b.dueDate, true);
      if (reviewerId === a.id || !a.reviewerIds?.includes(reviewerId))
        throw new BadRequestException("Choose an independent reviewer with access to this project.");
      const amendment = {id: randomUUID(), status: "submitted" as const, createdBy: a.id, createdAt: a.now, reviewerId, dueDate,
        reason: note, evidence: str(b.evidence, 2000, true),
        before: {quantity: order.quantity, unitCost: order.unitCost, promisedDate: order.promisedDate, currency: order.currency}, after};
      order.amendments ??= [];
      order.amendments.push(amendment);
    } else {
      const amendment = get(order.amendments ?? [], str(b.amendmentId, 80, true));
      if (amendment.status !== "submitted") throw new ConflictException("This amendment has already been decided.");
      const decision = choice(b.decision, ["approved", "rejected", "withdrawn"]);
      if (decision === "withdrawn") {
        buy();
        if (amendment.createdBy !== a.id) throw new ForbiddenException("Only the proposer can withdraw this amendment.");
      } else {
        review();
        if (!amendment.reviewerId || amendment.reviewerId !== a.id)
          throw new ForbiddenException("Only the assigned reviewer can decide this amendment.");
        if (amendment.createdBy === a.id) throw new ForbiddenException("Another reviewer must decide this amendment.");
      }
      if (!note) throw new BadRequestException("Record the decision reason.");
      if (decision === "approved") {
        assertAmendable();
        active();
        if (order.quantity !== amendment.before.quantity || order.unitCost !== amendment.before.unitCost ||
          order.promisedDate !== amendment.before.promisedDate || order.currency !== amendment.before.currency)
          throw new ConflictException("Order terms changed. Reject this proposal and request a fresh amendment.");
        const otherCommitments = d.orders.filter(other => other.id !== order.id && ["approved", "acknowledged", "closed"].includes(other.status))
          .reduce((sum, other) => sum + other.quantity * other.unitCost, 0);
        if (!d.budget || otherCommitments + order.quantity * amendment.after.unitCost > d.budget)
          throw new ConflictException("The amendment exceeds the approved operational budget.");
        order.baselinePromisedDate ||= order.promisedDate;
        order.unitCost = amendment.after.unitCost;
        order.promisedDate = amendment.after.promisedDate;
        order.status = "approved";
        order.acknowledgement = "";
      }
      amendment.status = decision;
      amendment.decidedBy = a.id;
      amendment.decidedAt = a.now;
      amendment.decisionNote = note;
    }
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
    if (["submitted", "approved"].includes(status) && o.kind==="material" && !o.materialId)
      throw new ConflictException("Link the ordered item to a material requirement so receiving updates its stock.");
    if (["submitted", "approved"].includes(status) && o.materialId) {
      const material = get(d.materials, o.materialId);
      const position = materialInventory(material, d.orders.filter(order => order.id !== o.id), [], d.supplierReturns);
      if(o.quantity > position.shortfall + 0.000001) throw new ConflictException("This quantity exceeds the remaining requirement. Review existing orders or update the approved requirement first.");
    }
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
    if (status === "closed" && (b.confirmed !== true || !note))
      throw new BadRequestException("Review accepted quantities and confirm closure with an inspection reference.");
    const returnedQuantity = (d.supplierReturns ?? []).filter(r=>r.orderId===o.id && ["dispatched","credited"].includes(r.status)).reduce((n,r)=>n+r.quantity,0);
    if (status === "closed" && (d.supplierReturns ?? []).some(r=>r.orderId===o.id && !["credited","cancelled"].includes(r.status)))
      throw new ConflictException("Resolve the supplier return before closing this order.");
    if (status === "closed" && o.receipts.some(r => (r.pending ?? 0) > 0))
      throw new ConflictException("Inspect the remaining quantity before closing.");
    if (
      status === "closed" &&
      o.receipts.reduce((s, r) => s + r.accepted, 0) - returnedQuantity < o.quantity
    )
      throw new ConflictException(
        "Accept the remaining quantity before closing.",
      );
    if (status === "cancelled" && o.receipts.length)
      throw new ConflictException(
        "An order with receipts needs a controlled return or credit, not cancellation.",
      );
    if (["approved", "acknowledged"].includes(status)) o.baselinePromisedDate ||= o.promisedDate;
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
      rejected = num(b.rejected), pending = num(b.pending ?? 0);
    if (b.received !== undefined && Math.abs(num(b.received) - accepted - rejected - pending) > 0.000001)
      throw new BadRequestException("Arrived quantity must equal accepted plus rejected plus pending inspection quantity.");
    const receiptToday = a.today ?? a.now.slice(0,10);
    const receivedOn = b.receivedOn ? day(b.receivedOn,true) : receiptToday;
    if (accepted > 0) assertServiceAcceptance(d, o, accepted);
    if (receivedOn > receiptToday) throw new BadRequestException("Received date cannot be in the future.");
    if (!(accepted + rejected + pending) || !note)
      throw new BadRequestException(
        "Record received quantities and delivery/inspection evidence.",
      );
    const returnedQuantity = (d.supplierReturns ?? []).filter(r=>r.orderId===o.id && ["dispatched","credited"].includes(r.status)).reduce((n,r)=>n+r.quantity,0);
    if (o.receipts.reduce((s, r) => s + r.accepted + (r.pending ?? 0), 0) - returnedQuantity + accepted + pending > o.quantity)
      throw new ConflictException(
        "Accepted receipts and pending inspection cannot exceed the ordered quantity.",
      );
    const id = randomUUID();
    const evidenceFiles = captureDecisionEvidence(d,o.id,b.fileIds);
    const serviceTask = o.kind === "subcontract" ? get(d.tasks, o.taskId) : undefined;
    o.receipts.push({ id, accepted, rejected, pending, receivedBy:a.id, receivedOn, evidence: note, evidenceFiles, at: a.now,
      basis:serviceTask ? "service" : "goods",
      ...(serviceTask ? {serviceBasis:{taskId:serviceTask.id,unit:serviceTask.unit,approvedQuantity:serviceTask.approved,capturedAt:a.now}} : {}),
    });
    if (o.kind !== "subcontract" && o.materialId && accepted)
      get(d.materials, o.materialId).movements.push({
        id,
        kind: "receive",
        quantity: accepted,
        reference: `${o.number} · ${note}`,
        at: a.now,
      });
  } else if (action === "receipt_inspect") {
    review(); active();
    const o = get(d.orders, recordId);
    if (o.status !== "acknowledged") throw new ConflictException("Inspect against an acknowledged order.");
    const receipt = get(o.receipts, b.receiptId);
    if (receipt.receivedBy === a.id) throw new ForbiddenException("A different reviewer must inspect this receipt.");
    const pending = receipt.pending ?? 0;
    if (!pending || b.expectedPending === undefined || num(b.expectedPending) !== pending)
      throw new ConflictException("Pending inspection changed. Refresh the receipt before reviewing.");
    const accepted = num(b.accepted), rejected = num(b.rejected);
    if (accepted > 0) assertServiceAcceptance(d, o, accepted);
    if (!note || !(accepted + rejected) || accepted + rejected > pending)
      throw new BadRequestException("Record inspection evidence and quantities within the pending balance.");
    const material = o.materialId ? get(d.materials, o.materialId) : undefined;
    const evidenceFiles = captureDecisionEvidence(d,o.id,b.fileIds);
    const id = randomUUID();
    receipt.accepted += accepted;
    receipt.rejected += rejected;
    receipt.pending = pending - accepted - rejected;
    const inspectedServiceTask = o.kind === "subcontract" ? get(d.tasks, o.taskId) : undefined;
    (receipt.inspections ??= []).push({id, by:a.id, at:a.now, accepted, rejected, evidence:note,evidenceFiles,
      ...(inspectedServiceTask ? {serviceBasis:{taskId:inspectedServiceTask.id,unit:inspectedServiceTask.unit,approvedQuantity:inspectedServiceTask.approved,capturedAt:a.now}} : {}),
    });
    if (material && accepted && o.kind !== "subcontract") material.movements.push({id,kind:"receive",quantity:accepted,reference:`${o.number} · QC ${receipt.id} · ${note}`,at:a.now});
  } else if (["rfa_save","rfa_submit","rfa_review","rfa_decide","rfa_withdraw","rfa_revise"].includes(action)) {
    recordId = applyRfa(d, action, b, a);
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
      sourceDesignVersionId: str(v.sourceDesignVersionId, 80),
      sourceDesignAssetId: str(v.sourceDesignAssetId, 80),
      scopeLineIds: ids(v.scopeLineIds),
    };
    if (!value.url && !value.note)
      throw new BadRequestException(
        "Add the file link or controlled document reference.",
      );
    if (value.replaces) get(d.documents, value.replaces);
    if (value.sourceDesignVersionId) {
      const links = d.designBaseline?.links.filter(
        (link) => link.designVersionId === value.sourceDesignVersionId,
      ) ?? [];
      if (!links.length)
        throw new BadRequestException(
          "Choose an approved design revision captured with this project.",
        );
      if (
        value.sourceDesignAssetId &&
        !links.some((link) => link.assetId === value.sourceDesignAssetId)
      )
        throw new BadRequestException(
          "Choose the file captured for this approved design revision.",
        );
      if (!value.scopeLineIds.length)
        value.scopeLineIds = [...new Set(links.map((link) => link.scopeLineId))];
      if (
        value.scopeLineIds.some(
          (scopeLineId) => !links.some((link) => link.scopeLineId === scopeLineId),
        )
      )
        throw new BadRequestException(
          "A design document can only cover the released scope linked to that revision.",
        );
    } else if (value.scopeLineIds.length) {
      const released = activeReleasedScopeLines(d);
      if (
        value.scopeLineIds.some(
          (scopeLineId) => !released.some((line) => line.id === scopeLineId),
        )
      )
        throw new BadRequestException("Link documents only to active released scope.");
    }
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
    if (d.rfas?.some(request => request.documentId === doc.id)) throw new ConflictException("Use the linked RFA to submit or approve this document.");
    if (status === "review") {
      manage();
      if (doc.status !== "draft")
        throw new ConflictException("Submit a draft document.");
    } else {
      review();
      if (doc.status !== "review")
        throw new ConflictException("This document is not awaiting review.");
      approveProjectDocument(d, doc, a.name);
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
      assertWarrantyCoverage(d, {
        handoverId,
        area: str(v.area, 160, true),
        taskId: str(v.taskId, 80),
        onDate: a.today ?? a.now.slice(0, 10),
      });
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
      reportedAt: a.now,
      reportedBy: a.name,
      reportedVia: "team",
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
      if (s.resolutionBy === a.id)
        throw new ForbiddenException(
          "Another reviewer must verify the correction before closing this snag.",
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
    if (status === "ready") s.resolutionBy = a.id;
    if (status === "open") {
      delete s.resolutionBy;
      delete s.verifiedBy;
    }
  } else if (action === "handover") {
    manage();
    active();
    const v = obj(b.handover);
    recordId = str(v.id, 80) || randomUUID();
    const old = d.handovers.find((h) => h.id === recordId);
    if (old && !["draft", "returned"].includes(old.status))
      throw new ConflictException("A client-ready or accepted handover pack is fixed.");
    // Scope, documents and evidence intentionally come from the selected
    // area/package. A user cannot hand-pick a flattering subset of work.
    const value = createAutomaticHandover(d, {
      id: recordId,
      area: str(v.area, 160),
      sourcePackageId: str(v.sourcePackageId, 80),
      title: str(v.title, 240),
      warrantyUntil: day(v.warrantyUntil),
      clientReviewDueDate: day(v.clientReviewDueDate),
      clientApproverId: str(v.clientApproverId, 80),
      installationBatchIds: ids(v.installationBatchIds),
    });
    if (old?.packets?.length) value.packets = old.packets;
    if (old?.outstandingItems?.length) value.outstandingItems = old.outstandingItems;
    if (old) Object.assign(old, value);
    else d.handovers.push(value);
  } else if (action === "handover_outstanding") {
    manage();
    const handover = get(d.handovers, str(b.handoverId, 80, true));
    const value = obj(b.item);
    const ownerId = member(value.ownerId);
    if (!ownerId)
      throw new BadRequestException("Choose an owner for the remaining handover item.");
    const dueDate = day(value.dueDate, true);
    addHandoverOutstandingItem(handover, {
      id: str(value.id, 80) || randomUUID(),
      title: str(value.title, 240, true),
      kind: choice(value.kind, ["punch", "document", "training", "delivery", "other"] as const),
      blocking: value.blocking === true,
      ownerId,
      dueDate,
      status: "open",
      evidence: str(value.evidence, 3000),
      resolution: "",
    });
    recordId = handover.id;
  } else if (action === "handover_outstanding_status") {
    const handover = get(d.handovers, str(b.handoverId, 80, true));
    const item = get(
      handover.outstandingItems ?? [],
      str(b.itemId, 80, true),
    );
    const status = choice(
      b.status,
      ["open", "ready", "closed", "warranty"] as const,
    );
    if (status === "ready") {
      if (!a.manage && item.ownerId !== a.id)
        throw new ForbiddenException(
          "Only the assigned person can submit this handover commitment.",
        );
      if (item.status !== "open")
        throw new ConflictException("Review the current handover commitment status.");
    } else {
      review();
      if (status === "closed") {
        if (item.status !== "ready")
          throw new ConflictException(
            "Submit completion evidence before verifying this handover commitment.",
          );
        if (item.resolutionBy === a.id)
          throw new ForbiddenException(
            "Another reviewer must verify this handover commitment.",
          );
      }
    }
    setHandoverOutstandingStatus(
      handover,
      item.id,
      status,
      note,
      a.id,
    );
    recordId = handover.id;
  } else if (action === "handover_status") {
    review();
    active();
    const h = get(d.handovers, recordId),
      status = choice(b.status, ["ready", "accepted"] as const);
    if (
      (status === "ready" && !["draft", "returned"].includes(h.status)) ||
      (status === "accepted" && h.status !== "ready")
    )
      throw new ConflictException("Review the current handover stage.");
    if (status === "ready" && b.confirmed !== true)
      throw new ConflictException(
        "Review the readiness checklist and confirm before changing this handover.",
      );
    if (status === "ready") {
      h.clientApproverId = str(b.clientApproverId, 80) || h.clientApproverId || "";
      h.clientReviewDueDate = day(b.clientReviewDueDate);
      refreshHandoverPacket(d, h, a.id, a.now);
      h.returnedAt = "";
      h.returnedBy = "";
      h.returnedNote = "";
      h.decisionSource = undefined;
      h.decisionChallengeId = undefined;
      // A ready pack is client-visible only when it has an authenticated
      // client approver. Signed on-site acceptance remains a deliberate
      // fallback, not an accidental portal publication.
      h.published = Boolean(h.clientApproverId);
    } else {
      if (b.signedRecord !== true)
        throw new BadRequestException(
          "Use the authenticated client portal or explicitly record a signed acceptance.",
        );
      assertHandoverPacketCurrent(d, h);
      if (!note)
        throw new BadRequestException("Attach the signed client acceptance evidence.");
      const acceptedBy = str(b.acceptedBy, 240, true);
      const acceptanceFiles = captureDecisionEvidence(d,h.id,b.fileIds);
      h.acceptedBy = acceptedBy;
      h.acceptanceFiles = acceptanceFiles;
      h.acceptedAt = a.now;
      h.evidence = note;
      h.decisionSource = "signed_record";
      h.published = true;
    }
    h.status = status;
    if (
      d.handovers.length &&
      d.handovers.every((handover) => ["ready", "accepted"].includes(handover.status)) &&
      d.tasks.every(task=>["completed","cancelled"].includes(task.status)) &&
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
    if (b.financeClosed === true && (d.supplierInvoices ?? []).some(i => i.status === "draft" || i.quantity*i.unitCost+i.tax-i.payments.reduce((n,p)=>n+p.amount,0)>0.005)) throw new ConflictException("Resolve supplier invoices and unpaid balances before closing the final account.");
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
    if (
      b.financeClosed === true &&
      (!d.handovers.length || d.handovers.some((handover) => handover.status !== "accepted"))
    )
      throw new ConflictException(
        "Complete physical handover acceptance before closing the final account.",
      );
    if(b.financeClosed === true && d.tasks.some(task=>task.installationBatches?.some(batch=>batch.status!=="cancelled") && !["completed","cancelled"].includes(task.status))) throw new ConflictException("Complete the remaining work before closing the final account.");
    if(b.financeClosed === true && d.tasks.some(task=>(task.installationBatches??[]).some(batch=>batch.status!=="cancelled" && !d.handovers.some(h=>h.status==="accepted" && (h.installationBatchIds?.includes(batch.id) || (!h.installationBatchIds?.length && h.taskIds.includes(task.id))))))) throw new ConflictException("Accept every installation batch before closing the final account.");
    d.financeClosed = b.financeClosed === true;
    d.financeEvidence = d.financeClosed
      ? str(b.financeEvidence, 3000, true)
      : "";
  } else if (action === "complete_project") {
    review();
    assertCloseout(d);
    if (a.designOnlySignedOff) {
      if (d.workflow?.currentStageKey !== "design_specifications" ||
          d.tasks.some(task => !["completed", "cancelled"].includes(task.status)) ||
          (d.workPackages ?? []).some(work => !["completed", "cancelled"].includes(work.status)) ||
          d.snags.some(snag => snag.status !== "closed"))
        throw new ConflictException("Finish the design stage and close its tasks before completion.");
      recordId = completeProjectWorkflow(d, b.note, {
        id: a.userId ?? a.id, name: a.name, now: a.now,
      });
      d.phase = "completed";
    } else {
    if(d.tasks.some(task=>(task.installationBatches??[]).some(batch=>batch.status!=="cancelled" && !d.handovers.some(h=>h.status==="accepted" && (h.installationBatchIds?.includes(batch.id) || (!h.installationBatchIds?.length && h.taskIds.includes(task.id)))))))
      throw new ConflictException("Obtain client acceptance for every installation batch before closing the project.");
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
      d.handovers.some((h) =>
        (h.outstandingItems ?? []).some(
          (item) => !["closed", "warranty"].includes(item.status),
        ),
      ) ||
      d.tasks.some((t) => !["completed", "cancelled"].includes(t.status)) ||
      (d.workPackages ?? []).some(
        (workPackage) => !["completed", "cancelled"].includes(workPackage.status),
      ) ||
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
    }
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
  assertUniqueWorkPackageScope(d);
  for (const workPackage of d.workPackages ?? []) {
    const linkedTasks = d.tasks.filter((task) => task.packageId === workPackage.id);
    if (
      workPackage.status === "in_progress" &&
      linkedTasks.length &&
      linkedTasks.every((task) => ["completed", "cancelled"].includes(task.status))
    ) {
      workPackage.status = "completed";
      workPackage.updatedAt = a.now;
    }
  }
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
