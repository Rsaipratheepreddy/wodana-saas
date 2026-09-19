/** P01 read-only Job projection. Source domains own all business facts. */
export type JobSourceType = "enquiry" | "lead" | "opportunity" | "case" | "quote" | "project";

export type JobPhase =
  | "intake" | "qualify" | "discover" | "design_scope" | "price"
  | "agree" | "release" | "deliver" | "handover" | "aftercare";

export type JobSourcePointer = { type: string; id: string; version: number };
export type JobOwner = { membershipId: string; name: string | null };
export type JobFlag = { active: boolean; reason: string | null; source: JobSourcePointer | null };

export type JobSourceLink = {
  type: JobSourceType;
  id: string;
  caseId: string | null;
  status: "active" | "detached";
  version: number;
  sourceState: "available" | "missing" | "detached";
};

export type JobIdentityProjection = {
  jobId: string;
  reference: string;
  createdAt: string;
  title: string | null;
  customer: { id: string; name: string } | null;
  links: JobSourceLink[];
  missingSourceCount: number;
  repairableLinkCount: number;
  phase: JobPhase | "unknown";
  phaseSource: JobSourcePointer | null;
  accessLimited: boolean;
  stage: {
    label: string;
    manual: boolean;
    version: number;
    reason: string | null;
    setBy: string | null;
    setByName: string | null;
    setAt: string | null;
  };
  owner: JobOwner | null;
  targetDate: string | null;
  flags: Record<"blocked" | "awaiting_client" | "at_risk", JobFlag>;
  nextAction: null | {
    title: string;
    owner: JobOwner | null;
    dueAt: string | null;
    reason: string;
    route: string;
    source: JobSourcePointer;
  };
};

export type JobTimelineEvent = {
  id: string;
  kind: "source_link" | "source_event" | "stage";
  title: string;
  detail: string | null;
  occurredAt: string;
  recordedAt: string;
  actor: { id: string; name: string | null } | null;
  source: JobSourcePointer | null;
};

export type ClientTimelineStatus = "draft" | "queued" | "sent" | "delivered" | "failed" | "manually_logged";

export type ClientTimelineEvent = {
  id: string;
  kind: "message" | "activity" | "portal";
  channel: "email" | "whatsapp" | "phone" | "sms" | "portal" | "internal" | "other";
  direction: "inbound" | "outbound" | "internal";
  status: ClientTimelineStatus;
  providerStatus: string | null;
  title: string;
  detail: string | null;
  occurredAt: string;
  actor: { id: string; name: string | null } | null;
  failureCode: string | null;
  source: { type: "conversation" | "activity" | "portal_decision"; id: string };
};

export type JobDetailProjection = JobIdentityProjection & {
  timeline: JobTimelineEvent[];
  clientTimeline: ClientTimelineEvent[];
  clientTimelineAccess: { communications: boolean; activities: boolean };
};

export type JobIdentityList = {
  items: JobIdentityProjection[];
  total: number;
  limit: number;
  offset: number;
};
