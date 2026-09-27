import { personDisplayName } from "@/design-system/components/person";
import type { CaseDesign, DesignOptions } from "./content";

export type JourneyStageKey = "inspiration" | "site_visit" | "concepts" | "space_planning" | "material_selection" | "renders" | "approval";
export const DELIVERABLE_STAGES: JourneyStageKey[] = ["space_planning", "concepts", "material_selection", "renders"];
export const isDeliverableStage = (stage: string | null | undefined) => DELIVERABLE_STAGES.includes(stage as JourneyStageKey);

export type JourneyStageView = {
  stage: JourneyStageKey; label: string; position: number; status: "locked" | "active" | "done"; ownerName: string | null;
  dueAt: string | null; completedAt: string | null; note: string | null; version: number; overdue: boolean;
  progress: { total: number; approved: number; pending: number } | null;
};
export type JourneyView = {
  journey: { packageName: string; includedRevisions: number | null; includesSpacePlanning: boolean; includesRenders: boolean } | null;
  stages: JourneyStageView[]; canStart?: boolean; timezone: string;
};

/** The document type a new file in a stage starts with; the designer can change it. */
export const STAGE_DOCUMENT_TYPE: Record<string, string> = {
  space_planning: "Space plan / furniture layout", concepts: "Concept / mood board",
  material_selection: "Material / finish board", renders: "3D render / visualization",
};

export const DESIGN_STATUS_LABEL: Record<string, string> = {
  draft: "Draft", internal_review: "In review", internal_approved: "Ready to present", client_review: "With client",
  approved: "Approved", changes_requested: "Changes requested", rejected: "Rejected", expired: "Client review expired",
};
export const designStatusTone = (status: string): "neutral" | "info" | "warning" | "success" | "danger" =>
  status === "approved" ? "success" : ["changes_requested", "rejected", "expired"].includes(status) ? "danger" : ["internal_review", "client_review"].includes(status) ? "info" : status === "internal_approved" ? "warning" : "neutral";

export const latestOf = (design: CaseDesign) => design.versions[0];

/** What happens next on a design, as a translation key and its values. */
export function nextStep(design: CaseDesign, options: Pick<DesignOptions, "reviewers">): { key: string; values?: Record<string, string> } {
  const latest = latestOf(design);
  if (!latest) return { key: "Upload a file" };
  if (latest.status === "draft") return { key: "Send for review" };
  if (latest.status === "internal_review") return { key: "With {name}", values: { name: personDisplayName(options.reviewers.find((item) => item.id === latest.reviewerId)?.name) || "the reviewer" } };
  if (latest.status === "internal_approved") return { key: "Present to the client" };
  if (latest.status === "client_review") return { key: "Waiting for the client" };
  if (latest.status === "approved") return { key: "Approved" };
  return { key: "Upload a revision" };
}

/** Stage progress wording as a translation key and its values: "2 of 3 approved", "Skipped", "Done". */
export function stageDetail(stage: JourneyStageView): { key: string; values?: Record<string, number> } {
  if (stage.status === "done") return { key: stage.progress && stage.progress.total === 0 && isDeliverableStage(stage.stage) ? "Skipped" : "Done" };
  if (stage.status === "locked") return { key: "Not started" };
  if (stage.progress && stage.progress.total) return { key: "{approved} of {total} approved", values: { approved: stage.progress.approved, total: stage.progress.total } };
  return { key: stage.overdue ? "Overdue" : "In progress" };
}
