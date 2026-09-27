import type {
  ClientTimelineEvent,
  ClientTimelineStatus,
  JobDetailProjection,
  JobIdentityList,
  JobIdentityProjection,
  JobPhase,
  JobSourceLink,
  JobTimelineEvent,
} from "@wodana/contracts";
import { tKey, type MessageKey } from "@/lib/i18n/keys";

export type {
  ClientTimelineEvent,
  ClientTimelineStatus,
  JobDetailProjection,
  JobIdentityList,
  JobIdentityProjection,
  JobPhase,
  JobSourceLink,
  JobTimelineEvent,
};

export const jobPhases: Array<{ id: JobPhase; label: string }> = [
  { id: "intake", label: tKey("Intake") },
  { id: "qualify", label: tKey("Qualify") },
  { id: "discover", label: tKey("Discover") },
  { id: "design_scope", label: tKey("Design & scope") },
  { id: "price", label: tKey("Price") },
  { id: "agree", label: tKey("Agree") },
  { id: "release", label: tKey("Release") },
  { id: "deliver", label: tKey("Deliver") },
  { id: "handover", label: tKey("Handover") },
  { id: "aftercare", label: tKey("Aftercare") },
];

/** Labels below are en.json keys: translate them where they render, `t(label as never)`. */
export function jobPhaseLabel(phase: JobPhase | "unknown") {
  return phase === "unknown"
    ? tKey("Limited access")
    : jobPhases.find((item) => item.id === phase)?.label ?? phase;
}

export function jobFlagLabels(job: JobIdentityProjection): string[] {
  return [
    job.flags.blocked.active ? tKey("Blocked") : null,
    job.flags.awaiting_client.active ? tKey("Awaiting client") : null,
    job.flags.at_risk.active ? tKey("At risk") : null,
  ].filter((value): value is MessageKey => Boolean(value));
}

export function jobStateLabel(job: JobIdentityProjection) {
  const flags = jobFlagLabels(job);
  return flags[0] ?? (job.accessLimited ? tKey("Limited access") : tKey("On track"));
}

export function jobStateTone(job: JobIdentityProjection): "neutral" | "success" | "warning" | "danger" | "info" {
  if (job.flags.blocked.active) return "danger";
  if (job.flags.at_risk.active || job.flags.awaiting_client.active) return "warning";
  if (job.accessLimited) return "neutral";
  return "success";
}

export function sourceLabel(type: JobSourceLink["type"]) {
  return ({
    enquiry: tKey("Enquiry"),
    lead: tKey("Qualified enquiry"),
    opportunity: tKey("Opportunity"),
    case: tKey("Planning case"),
    quote: tKey("Quotation"),
    project: tKey("Project"),
  } as const)[type];
}

export function sourceRoute(link: JobSourceLink): string | null {
  if (link.sourceState !== "available" || link.status !== "active") return null;
  if (link.type === "enquiry") return "/workspace/crm/leads";
  if (link.type === "lead") return `/workspace/crm/leads?lead=${link.id}`;
  if (link.type === "opportunity") return `/workspace/crm/opportunities?record=${link.id}`;
  if (link.type === "case") return `/workspace/pre-projects/cases/${link.id}/overview`;
  if (link.type === "quote" && link.caseId) return `/workspace/pre-projects/cases/${link.caseId}/quotations?quote=${link.id}`;
  if (link.type === "project") return `/workspace/projects/${link.id}/overview`;
  return null;
}

export function actionableJobs(items: JobIdentityProjection[]) {
  return items.filter((job) => job.nextAction || jobFlagLabels(job).length > 0);
}
