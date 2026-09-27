import type { CaseDesign, DesignOptions } from "./content";
import { tKey, type MessageKey } from "@/lib/i18n/keys";

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

export const DESIGN_STATUS_LABEL: Record<string, MessageKey> = {
  draft: tKey("Draft"), internal_review: tKey("In review"), internal_approved: tKey("Ready to present"), client_review: tKey("With client"),
  approved: tKey("Approved"), changes_requested: tKey("Changes requested"), rejected: tKey("Rejected"), expired: tKey("Client review expired"),
};
export const designStatusTone = (status: string): "neutral" | "info" | "warning" | "success" | "danger" =>
  status === "approved" ? "success" : ["changes_requested", "rejected", "expired"].includes(status) ? "danger" : ["internal_review", "client_review"].includes(status) ? "info" : status === "internal_approved" ? "warning" : "neutral";

export const latestOf = (design: CaseDesign) => design.versions[0];

/** What happens next on a design, as a translation key and its values. */
export function nextStep(design: CaseDesign, options: Pick<DesignOptions, "reviewers">): { key: string; values?: Record<string, string> } {
  const latest = latestOf(design);
  if (!latest) return { key: tKey("Upload a file") };
  if (latest.status === "draft") return { key: tKey("Send for review") };
  if (latest.status === "internal_review") {
    const name = options.reviewers.find((item) => item.id === latest.reviewerId)?.name;
    return name ? { key: tKey("With {name}"), values: { name } } : { key: tKey("With the reviewer") };
  }
  if (latest.status === "internal_approved") return { key: tKey("Present to the client") };
  if (latest.status === "client_review") return { key: tKey("Waiting for the client") };
  if (latest.status === "approved") return { key: tKey("Approved") };
  return { key: tKey("Upload a revision") };
}

/** Stage progress wording as a translation key and its values: "2 of 3 approved", "Skipped", "Done". */
export function stageDetail(stage: JourneyStageView): { key: string; values?: Record<string, number> } {
  if (stage.status === "done") return { key: stage.progress && stage.progress.total === 0 && isDeliverableStage(stage.stage) ? tKey("Skipped") : tKey("Done") };
  if (stage.status === "locked") return { key: tKey("Not started") };
  if (stage.progress && stage.progress.total) return { key: tKey("{approved} of {total} approved"), values: { approved: stage.progress.approved, total: stage.progress.total } };
  return { key: stage.overdue ? tKey("Overdue") : tKey("In progress") };
}
