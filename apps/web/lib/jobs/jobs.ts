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
  { id: "intake", label: "Intake" },
  { id: "qualify", label: "Qualify" },
  { id: "discover", label: "Discover" },
  { id: "design_scope", label: "Design & scope" },
  { id: "price", label: "Price" },
  { id: "agree", label: "Agree" },
  { id: "release", label: "Release" },
  { id: "deliver", label: "Deliver" },
  { id: "handover", label: "Handover" },
  { id: "aftercare", label: "Aftercare" },
];

export function jobPhaseLabel(phase: JobPhase | "unknown") {
  return phase === "unknown"
    ? "Limited access"
    : jobPhases.find((item) => item.id === phase)?.label ?? phase;
}

export function jobFlagLabels(job: JobIdentityProjection): string[] {
  return [
    job.flags.blocked.active ? "Blocked" : null,
    job.flags.awaiting_client.active ? "Awaiting client" : null,
    job.flags.at_risk.active ? "At risk" : null,
  ].filter((value): value is string => Boolean(value));
}

export function jobStateLabel(job: JobIdentityProjection) {
  const flags = jobFlagLabels(job);
  return flags[0] ?? (job.accessLimited ? "Limited access" : "On track");
}

export function jobStateTone(job: JobIdentityProjection): "neutral" | "success" | "warning" | "danger" | "info" {
  if (job.flags.blocked.active) return "danger";
  if (job.flags.at_risk.active || job.flags.awaiting_client.active) return "warning";
  if (job.accessLimited) return "neutral";
  return "success";
}

export function sourceLabel(type: JobSourceLink["type"]) {
  return ({
    enquiry: "Enquiry",
    lead: "Qualified enquiry",
    opportunity: "Opportunity",
    case: "Planning case",
    quote: "Quotation",
    project: "Project",
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
