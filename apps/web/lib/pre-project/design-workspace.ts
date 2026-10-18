import { personDisplayName } from "@/design-system/components/person";
import type { CaseDesign, DesignOptions } from "./content";
import { tKey, type MessageKey } from "@/lib/i18n/keys";

export type JourneyStageKey = "inspiration" | "kickoff" | "site_visit" | "concepts" | "space_planning" | "material_selection" | "renders" | "samples" | "approval";
/**
 * Work inside a step (PLM-141, PLM-144, PLM-151): the design team to allocate, the design site measure, the sample
 * collection; PLM-146: the finishes marked and sent to QS once the samples are approved.
 */
export type JourneyTaskKey = "team_allocation" | "site_measure" | "sample_collection" | "finishes_to_qs";
export type JourneyTaskView = {
  task: JourneyTaskKey; label: string; status: "open" | "done"; ownerId: string | null; ownerName: string | null; dueAt: string | null; completedAt: string | null;
  completedByName: string | null; note: string | null; version: number; overdue: boolean;
};
/** A part of the design team (PLM-151): who holds it on this job, and whether this person may set it. */
export type TeamSlotKey = "lead_designer" | "junior_designer" | "sales_admin" | "visualiser" | "draftsman" | "material_coordinator";
export type TeamSlotView = { slot: TeamSlotKey; role: string; label: string | null; member: { membershipId: string; name: string | null } | null; notApplicable: boolean; canSet: boolean };
/** The site visit as one thing: the old order's stage, or the design site measure inside the concept (PLM-141). */
export type SiteVisitState = {
  within: "stage" | "task"; open: boolean; done: boolean; version: number; dueAt: string | null; ownerName: string | null; scheduledAt: string | null; completedAt: string | null; overdue: boolean;
};
export const DELIVERABLE_STAGES: JourneyStageKey[] = ["space_planning", "concepts", "material_selection", "renders"];
export const isDeliverableStage = (stage: string | null | undefined) => DELIVERABLE_STAGES.includes(stage as JourneyStageKey);

export type JourneyStageView = {
  stage: JourneyStageKey; label: string; position?: number; status: "locked" | "active" | "done"; ownerName: string | null;
  dueAt: string | null; completedAt: string | null; note?: string | null; version: number; overdue: boolean;
  progress?: { total: number; approved: number; pending: number } | null;
  /** PLM-049/051: the client-facing deadline next to the internal `dueAt`. */
  clientDueAt?: string | null;
  /** PLM-049/051: revisions shown to the client on this stage against the package's included ones. */
  revisions?: { used: number; included: number; chargeable: boolean } | null;
  /** How the stage ended: completed, approved, chosen, skipped, not_required, material_list_confirmed, timer_ended, closed_early, signed_off. */
  outcome?: string | null; completedByName?: string | null;
  activityId?: string | null; bookingReminder?: boolean;
  scheduledAt?: string | null; scheduledEnd?: string | null; scheduledTimezone?: string | null; scheduledLocation?: { address?: string | null } | null;
};
/** A checklist line's status; pending is an open item. */
export type CheckStatus = "confirmed" | "pending" | "not_applicable";
/**
 * A question on the job's list: answered in words, or (`kind: "check"`) a checklist line marked with a status and an
 * optional requirement or reference note in `answer`.
 */
export type SiteChecklistItem = {
  key: string; question: string; scope?: string | null; section?: string | null; kind?: "answer" | "check"; required?: boolean;
  answer: string | null; status?: CheckStatus | null; answeredByName: string | null; answeredAt: string | null;
};
/**
 * PLM-154: the general questions by section, then the checklists that apply to the job, then the rest. `chosen` is the
 * designer's "Applies to this job" choice (null while it follows the matching), `choiceVersion` its version.
 */
export type SiteChecklistGroup = {
  scope: string | null; section?: string | null; everyJob?: boolean; matches: boolean; chosen?: boolean | null; applies?: boolean; required: boolean;
  choiceVersion?: number; pending?: number; keys: string[];
};
/** A group of answers as the project and the factory read them, with its pending lines. */
export type ChecklistGroupRead = {
  scope: string | null; section: string | null; everyJob?: boolean; pending: number;
  items: Array<{ key: string; question: string; kind: "answer" | "check"; answer: string | null; status: CheckStatus | null; answeredByName: string | null; answeredAt: string | null }>;
};
/** One answer as saved: words, or a checklist line's status and note. */
export type SiteAnswerInput = { key: string; answer: string; status?: CheckStatus | null };
export type SiteMeasurement = { title: string; status: string; files: number; roomId?: string | null };
export type JourneyView = {
  journey: {
    packageName: string | null; includedRevisions: number | null; includesSpacePlanning?: boolean; includesRenders?: boolean;
    /** `design` after Won with a package; `site_and_materials` for a furniture/joinery order (PLM-080/081). */
    kind?: "design" | "site_and_materials"; version?: number;
    approvedOn?: string | null; approvalAssetName?: string | null; approvalSigner?: string | null; approvalMethod?: string | null;
    estimateDueAt?: string | null; estimateQuoteId?: string | null;
    /** A design-only job (Full ID) ended with the design approval: no estimate follows. */
    designComplete?: boolean;
    /** 2: the order of 13 Oct 2026 (kick-off, concept with the site measure, renders, samples); 1: the order before. */
    flowVersion?: number; reviewerRoleCode?: string | null; conceptOptionsMax?: number | null;
    /** PLM-140/143: the render sign-off date agreed at the kick-off, and the client's sign-off once recorded. */
    renderSignoffDueOn?: string | null; renderSignedOn?: string | null; renderSignoffSigner?: string | null; renderSignoffAssetName?: string | null;
  } | null;
  tasks?: JourneyTaskView[];
  siteVisit?: SiteVisitState | null;
  checklistGroups?: SiteChecklistGroup[];
  /** PLM-151: the people a team-setter picks from (sent only to someone who may set a part of the team). */
  team?: { slots: TeamSlotView[]; candidates?: Array<{ id: string; displayName: string }>; missing: TeamSlotKey[]; reviewRole: string | null; version: number } | null;
  /** What the journey will be before it starts: a design package, or a furniture/joinery order's site visit and materials. */
  startsAs?: "design" | "site_and_materials" | null;
  stages: JourneyStageView[]; canStart?: boolean; canManage?: boolean; canEdit?: boolean; canReview?: boolean; canRecordClient?: boolean; timezone: string;
  measurements?: SiteMeasurement[]; siteEvidenceProblem?: string | null;
  checklist?: SiteChecklistItem[]; siteChecklistProblem?: string | null;
  /** The job's open items: pending lines of the checklists that apply. */
  pendingChecks?: number;
  /** The materials and decisions ledger in one line (plan §6.7a). */
  ledger?: { state: "empty" | "open" | "locked" | "changes_pending"; lockProblem: string | null; materials: number; waiting: number; outsourcedWaiting?: number; lock: { number: number } | null } | null;
  /** The firm books the showroom on its booking engine (Settings › Design). */
  showroomBooking?: boolean;
  /** After the sign-off: the Proposal 2 estimate it handed off to, or why not yet. */
  handoff?: { quoteId: string | null; problem: string | null };
  /** Where the site is: the property's address and position from the opportunity. */
  site?: { address: string | null; latitude: number | null; longitude: number | null } | null;
};

/**
 * The site visit open now, as a stage the visit flow works with: the old order's site visit stage, or the design site
 * measure inside the concept (PLM-141), whose version its commands carry.
 */
export function openSiteVisit(view: Pick<JourneyView, "stages" | "siteVisit"> | null | undefined): JourneyStageView | null {
  if (!view) return null;
  const stage = (Array.isArray(view.stages) ? view.stages : []).find((item) => item.stage === "site_visit" && item.status === "active");
  if (stage) return stage;
  const visit = view.siteVisit;
  if (!visit || visit.within !== "task" || !visit.open) return null;
  return { stage: "site_visit", label: "", status: "active", ownerName: visit.ownerName, dueAt: visit.dueAt, completedAt: visit.completedAt, version: visit.version, overdue: visit.overdue,
    scheduledAt: visit.scheduledAt };
}

/** The labels of the work inside a step. */
export const TASK_LABEL: Record<JourneyTaskKey, MessageKey> = {
  team_allocation: tKey("Design team"), site_measure: tKey("Design site measure"), sample_collection: tKey("Sample collection"), finishes_to_qs: tKey("Finishes to QS"),
};

/** The design team's parts as the firm names them by default (its own role labels come from Settings › Projects). */
export const TEAM_SLOT_LABEL: Record<TeamSlotKey, MessageKey> = {
  lead_designer: tKey("Lead designer"), junior_designer: tKey("Junior designer"), sales_admin: tKey("Sales Admin"), visualiser: tKey("Visualiser"), draftsman: tKey("Draftsman"),
  material_coordinator: tKey("Material Coordinator"),
};

/** The document type a new file in a stage starts with; the designer can change it. */
export const STAGE_DOCUMENT_TYPE: Record<string, string> = {
  space_planning: "Space plan / furniture layout", concepts: "Concept / mood board",
  material_selection: "Material / finish board", renders: "3D render / visualization",
};

export const DESIGN_STATUS_LABEL: Record<string, MessageKey> = {
  draft: tKey("Draft"), internal_review: tKey("In review"), internal_approved: tKey("Ready to present"), client_review: tKey("With client"),
  approved: tKey("Approved"), changes_requested: tKey("Changes requested"), rejected: tKey("Rejected"), expired: tKey("Client review expired"),
};
export const designStatusTone = (status: string): "neutral" | "info" | "warning" | "success" | "danger" =>
  status === "approved" ? "success" : ["changes_requested", "rejected", "expired"].includes(status) ? "danger" : ["internal_review", "client_review"].includes(status) ? "info" : status === "internal_approved" ? "warning" : "neutral";

export const latestOf = (design: CaseDesign) => design.versions[0];

/** What happens next on a design, as a translation key and its values. */
export function nextStep(design: CaseDesign, options: Pick<DesignOptions, "reviewers" | "internalReview">): { key: string; values?: Record<string, string> } {
  const latest = latestOf(design);
  if (!latest) return { key: tKey("Upload a file") };
  // PLM-145: without an internal review on the package, the designer shares it with the client directly.
  if (latest.status === "draft") return options.internalReview === false ? { key: tKey("Present to the client") } : { key: tKey("Send for review") };
  if (latest.status === "internal_review") {
    const name = personDisplayName(options.reviewers.find((item) => item.id === latest.reviewerId)?.name);
    return name ? { key: tKey("With {name}"), values: { name } } : { key: tKey("With the reviewer") };
  }
  if (latest.status === "internal_approved") return { key: tKey("Present to the client") };
  if (latest.status === "client_review") return { key: tKey("Waiting for the client") };
  if (latest.status === "approved") return { key: tKey("Approved") };
  return { key: tKey("Upload a revision") };
}

/** Stage progress wording as a translation key and its values: "2 of 3 approved", "Skipped", "Done". */
export function stageDetail(stage: JourneyStageView): { key: string; values?: Record<string, number> } {
  if (stage.status === "done") return { key: stage.outcome === "not_required" ? tKey("Not required for this order") : stage.outcome === "chosen" ? tKey("Client chose") : stage.outcome === "skipped" ? tKey("Skipped") : tKey("Done") };
  if (stage.status === "locked") return { key: tKey("Not started") };
  if (stage.progress && stage.progress.total) return { key: tKey("{approved} of {total} approved"), values: { approved: stage.progress.approved, total: stage.progress.total } };
  return { key: stage.overdue ? tKey("Overdue") : tKey("In progress") };
}
