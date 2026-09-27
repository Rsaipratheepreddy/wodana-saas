import { tKey, type MessageKey } from "@/lib/i18n/keys";
import type { EnquiryFieldsState } from "./enquiry-fields";
import type { LeadOptions, EnquiryDetails } from "./lead-options";

export const CRM_LEAD_STATUSES = [
  "new",
  "attempting_contact",
  "connected",
  "nurturing",
  "qualified",
  "disqualified",
  "paused",
  "duplicate",
] as const;

export type CrmLeadStatus = (typeof CRM_LEAD_STATUSES)[number];

// Mirrors the CRM service workflow. Table, board, and inspector use the same moves.
export const CRM_LEAD_TRANSITIONS: Record<CrmLeadStatus, CrmLeadStatus[]> = {
  new: ["attempting_contact", "connected", "nurturing", "qualified", "paused", "disqualified"],
  attempting_contact: ["new", "connected", "nurturing", "qualified", "paused", "disqualified"],
  connected: ["new", "attempting_contact", "nurturing", "qualified", "paused", "disqualified"],
  nurturing: ["new", "attempting_contact", "connected", "qualified", "paused", "disqualified"],
  qualified: ["new", "attempting_contact", "connected", "nurturing", "paused", "disqualified"],
  paused: ["new", "attempting_contact", "connected", "nurturing", "qualified", "disqualified"],
  disqualified: ["new", "attempting_contact", "connected", "nurturing", "qualified", "paused"],
  // A duplicate is closed and linked to the original enquiry; it does not move (PLM-093).
  duplicate: [],
};

// Keep persisted legacy values readable; the product exposes four stages. Labels are keys: translate with t().
export const CRM_LEAD_STAGES = [
  { id: "new", label: tKey("New") },
  { id: "connected", label: tKey("Contacted") },
  { id: "qualified", label: tKey("Qualified") },
  { id: "disqualified", label: tKey("Disqualified") },
] as const;
export function leadStage(status: string): "new" | "connected" | "qualified" | "disqualified" {
  return status === "new" || status === "qualified" || status === "disqualified" ? status : "connected";
}
export function leadStageLabel(status: string): MessageKey {
  if (status === "duplicate") return tKey("Duplicate");
  return CRM_LEAD_STAGES.find((stage) => stage.id === leadStage(status))!.label;
}
export function leadStageOptions(status: string) {
  if (status === "duplicate") return [];
  return CRM_LEAD_STAGES.filter((stage) => stage.id !== leadStage(status));
}

export type CrmLeadListItem = {
  id: string;
  status: CrmLeadStatus;
  priority: string;
  fitScore: number | string | null;
  engagementScore: number | string | null;
  ownerMembershipId: string | null;
  queueId: string | null;
  nextActionAt: string | null;
  ownershipDueAt?: string | null;
  version: number;
  isConverted?: boolean;
  createdAt: string;
  updatedAt: string;
  partyId: string;
  partyName: string;
  enquiryId: string;
  reference?: string;
  details?: EnquiryDetails;
  intakeMethod?: string;
  formId?: string | null;
  formAnswers?: Array<{ questionId: string; title: string; type: string; field?: string; value: string | string[] }> | null;
  /** The workspace's own enquiry fields, by field id. */
  customFields?: Record<string, unknown> | null;
  title: string;
  source: string;
  channel: string;
  serviceType: string | null;
  ownerName: string | null;
  queueName: string | null;
  slaStatus: string | null;
  slaWarningAt: string | null;
  slaDueAt: string | null;
};

export type CrmWorkspaceMember = {
  id: string;
  displayName: string;
  email: string;
  status: string;
};

export type CrmQueueMember = {
  membershipId: string;
  name: string;
  capacity: number;
  weight: number;
  isAvailable: boolean;
  skills: string[];
  languages: string[];
  territories: string[];
  unavailableUntil: string | null;
};

export type CrmQueue = {
  id: string;
  code: string;
  name: string;
  status: string;
  businessUnitId: string | null;
  isFallback: boolean;
  takeoverAfterMinutes?: number | null;
  roundRobinCursor: string | null;
  version: number;
  members: CrmQueueMember[];
};

export type CrmAssignmentPolicy = {
  id: string;
  name: string;
  priority: number;
  status: string;
  fallbackQueueId: string;
  preserveRelationshipOwner: boolean;
  version: number;
  rules: Array<{
    id: string;
    name: string;
    priority: number;
    queueId: string;
    conditions: Record<string, unknown>;
    status: string;
    version: number;
  }>;
};

export type CrmSlaPolicy = {
  id: string;
  name: string;
  eventType: string;
  warningAfterMinutes: number;
  breachAfterMinutes: number;
  calculationMode?: "elapsed" | "business";
  schedule: Record<string, unknown>;
  status: string;
  version: number;
  createdAt?: string;
  updatedAt?: string;
};

export type CrmIntakeItem = {
  id: string;
  source: string;
  channel: string;
  intakeMethod: string;
  externalEventId: string | null;
  status: string;
  failureCode: string | null;
  failureMessage: string | null;
  correlationId: string;
  receivedAt: string;
  processedAt: string | null;
  version: number;
  enquiryId: string | null;
  title: string | null;
  partyId: string | null;
  leadId: string | null;
  candidateCount: number;
};

export type CrmPipeline = {
  id: string;
  code: string;
  name: string;
  status: string;
  isDefault: boolean;
  version: number;
  stages: Array<{
    id: string;
    code: string;
    name: string;
    position: number;
    probability: number | string;
    forecastCategory: string;
    entryRequirements: Record<string, unknown>;
    status: string;
  }>;
};

export type CrmLeadDetail = {
  id: string;
  partyId: string;
  status: CrmLeadStatus;
  ownerMembershipId: string | null;
  queueId: string | null;
  priority: string;
  fitScore: number | string | null;
  engagementScore: number | string | null;
  nextActionAt: string | null;
  disqualificationReason: string | null;
  pausedReason: string | null;
  qualifiedAt: string | null;
  closedAt: string | null;
  version: number;
  qualification: Array<{ questionKey: string; value: unknown; capturedAt: string }>;
  assignments: Array<{
    id: string;
    previousOwnerMembershipId: string | null;
    ownerMembershipId: string | null;
    queueId: string | null;
    assignmentMethod: string;
    ruleId: string | null;
    explanation: Record<string, unknown> | null;
    reason: string | null;
    assignedAt: string;
  }>;
  sla: Array<{
    id: string;
    status: string;
    startedAt: string;
    warningAt: string;
    dueAt: string;
    warnedAt: string | null;
    breachedAt: string | null;
  }>;
};

export type CrmActivity = {
  id: string;
  type: string;
  status: string;
  title: string;
  description: string | null;
  ownerMembershipId: string | null;
  ownerName: string | null;
  priority: string;
  dueAt: string | null;
  completedAt: string | null;
  completionOutcome: string | null;
  isNextAction: boolean;
  customerVisible: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type LeadsPageData = {
  defaultCurrency?: string;
  defaultLocale?: string;
  currentMembershipId?: string;
  /** Role codes of the signed-in member; sources limited to roles are hidden from others. */
  currentRoles?: string[];
  leadOptions?: LeadOptions;
  enquiryFields?: EnquiryFieldsState;
  canView: boolean;
  items: CrmLeadListItem[];
  queues: CrmQueue[];
  assignmentPolicies: CrmAssignmentPolicy[];
  slaPolicies: CrmSlaPolicy[];
  intake: CrmIntakeItem[];
  pipelines: CrmPipeline[];
  members: CrmWorkspaceMember[];
  nextCursor: string | null;
  referenceTime: string;
  workspaceId: string;
};

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";
const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const QUEUE_ID = "61000000-0000-4000-8000-000000000001";

export const leadsPageFixture: LeadsPageData = {
  defaultLocale: "en-AE",
  canView: true,
  workspaceId: WORKSPACE_ID,
  nextCursor: null,
  referenceTime: "2026-09-06T08:00:00.000Z",
  members: [{ id: OWNER_ID, displayName: "Iglo Administrator", email: "admin@igloarchitects.com", status: "active" }],
  queues: [{
    id: QUEUE_ID,
    code: "design_enquiries",
    name: "Design enquiries",
    status: "active",
    businessUnitId: null,
    isFallback: true,
    roundRobinCursor: OWNER_ID,
    version: 1,
    members: [{ membershipId: OWNER_ID, name: "Iglo Administrator", capacity: 25, weight: 1, isAvailable: true, skills: ["interior_design", "fit_out", "architecture"], languages: ["en"], territories: ["Dubai"], unavailableUntil: null }],
  }],
  assignmentPolicies: [{
    id: "65000000-0000-4000-8000-000000000001",
    name: "Iglo design enquiry routing",
    priority: 10,
    status: "active",
    fallbackQueueId: QUEUE_ID,
    preserveRelationshipOwner: true,
    version: 1,
    rules: [{ id: "66000000-0000-4000-8000-000000000001", name: "Design services", priority: 10, queueId: QUEUE_ID, conditions: { serviceType: ["interior_design", "fit_out", "architecture"] }, status: "active", version: 1 }],
  }],
  slaPolicies: [{ id: "67000000-0000-4000-8000-000000000001", name: "First response", eventType: "first_response", warningAfterMinutes: 60, breachAfterMinutes: 120, schedule: {}, status: "active", version: 1 }],
  intake: [
    { id: "68000000-0000-4000-8000-000000000001", source: "referral", channel: "phone", intakeMethod: "manual", externalEventId: null, status: "ready", failureCode: null, failureMessage: null, correlationId: "fixture-1", receivedAt: "2026-09-06T05:20:00.000Z", processedAt: "2026-09-06T05:20:02.000Z", version: 2, enquiryId: "64000000-0000-4000-8000-000000000001", title: "Dubai wellness clinic design", partyId: "63000000-0000-4000-8000-000000000001", leadId: "62000000-0000-4000-8000-000000000001", candidateCount: 0 },
    { id: "68000000-0000-4000-8000-000000000002", source: "website", channel: "web", intakeMethod: "form", externalEventId: "web-1082", status: "duplicate_candidate", failureCode: null, failureMessage: null, correlationId: "fixture-2", receivedAt: "2026-09-06T07:42:00.000Z", processedAt: null, version: 1, enquiryId: null, title: null, partyId: null, leadId: null, candidateCount: 1 },
  ],
  pipelines: [{
    id: "69000000-0000-4000-8000-000000000001",
    code: "design_sales",
    name: "Design sales",
    status: "active",
    isDefault: true,
    version: 1,
    stages: [
      { id: "69100000-0000-4000-8000-000000000001", code: "discovery", name: "Discovery", position: 10, probability: 20, forecastCategory: "pipeline", entryRequirements: {}, status: "active" },
      { id: "69100000-0000-4000-8000-000000000002", code: "proposal", name: "Proposal", position: 20, probability: 50, forecastCategory: "best_case", entryRequirements: {}, status: "active" },
    ],
  }],
  items: [
    {
      id: "62000000-0000-4000-8000-000000000001",
      status: "attempting_contact",
      priority: "high",
      fitScore: "78.00",
      engagementScore: "64.00",
      ownerMembershipId: OWNER_ID,
      queueId: QUEUE_ID,
      nextActionAt: "2026-09-06T09:30:00.000Z",
      version: 3,
      createdAt: "2026-09-06T05:20:00.000Z",
      updatedAt: "2026-09-06T06:10:00.000Z",
      partyId: "63000000-0000-4000-8000-000000000001",
      partyName: "Dr Maya Nair",
      enquiryId: "64000000-0000-4000-8000-000000000001",
      title: "Dubai wellness clinic design",
      source: "referral",
      channel: "phone",
      serviceType: "fit_out",
      ownerName: "Iglo Administrator",
      queueName: "Design enquiries",
      slaStatus: "active",
      slaWarningAt: "2026-09-06T08:30:00.000Z",
      slaDueAt: "2026-09-06T10:00:00.000Z",
    },
    {
      id: "62000000-0000-4000-8000-000000000002",
      status: "connected",
      priority: "normal",
      fitScore: "72.00",
      engagementScore: "81.00",
      ownerMembershipId: OWNER_ID,
      queueId: QUEUE_ID,
      nextActionAt: "2026-09-08T06:00:00.000Z",
      version: 2,
      createdAt: "2026-09-05T09:15:00.000Z",
      updatedAt: "2026-09-06T05:45:00.000Z",
      partyId: "63000000-0000-4000-8000-000000000002",
      partyName: "Leena Mathew",
      enquiryId: "64000000-0000-4000-8000-000000000002",
      title: "Jumeirah neighbourhood café concept",
      source: "instagram",
      channel: "web",
      serviceType: "interior_design",
      ownerName: "Iglo Administrator",
      queueName: "Design enquiries",
      slaStatus: null,
      slaWarningAt: null,
      slaDueAt: null,
    },
    {
      id: "62000000-0000-4000-8000-000000000003",
      status: "nurturing",
      priority: "normal",
      fitScore: "69.00",
      engagementScore: "48.00",
      ownerMembershipId: OWNER_ID,
      queueId: QUEUE_ID,
      nextActionAt: "2026-09-09T07:00:00.000Z",
      version: 3,
      createdAt: "2026-09-04T11:00:00.000Z",
      updatedAt: "2026-09-05T14:10:00.000Z",
      partyId: "63000000-0000-4000-8000-000000000003",
      partyName: "Hassan Qureshi",
      enquiryId: "64000000-0000-4000-8000-000000000003",
      title: "Tilal Al Ghaf villa customization",
      source: "developer",
      channel: "email",
      serviceType: "interior_design",
      ownerName: "Iglo Administrator",
      queueName: "Design enquiries",
      slaStatus: null,
      slaWarningAt: null,
      slaDueAt: null,
    },
    {
      id: "62000000-0000-4000-8000-000000000004",
      status: "paused",
      priority: "normal",
      fitScore: "55.00",
      engagementScore: "32.00",
      ownerMembershipId: OWNER_ID,
      queueId: QUEUE_ID,
      nextActionAt: null,
      version: 3,
      createdAt: "2026-09-03T08:35:00.000Z",
      updatedAt: "2026-09-05T08:00:00.000Z",
      partyId: "63000000-0000-4000-8000-000000000004",
      partyName: "Noura Haddad",
      enquiryId: "64000000-0000-4000-8000-000000000004",
      title: "Bluewaters apartment refresh",
      source: "website",
      channel: "web",
      serviceType: "interior_design",
      ownerName: "Iglo Administrator",
      queueName: "Design enquiries",
      slaStatus: null,
      slaWarningAt: null,
      slaDueAt: null,
    },
    {
      id: "62000000-0000-4000-8000-000000000005",
      status: "qualified",
      priority: "high",
      fitScore: "92.00",
      engagementScore: "88.00",
      ownerMembershipId: OWNER_ID,
      queueId: QUEUE_ID,
      nextActionAt: null,
      version: 4,
      createdAt: "2026-09-02T07:20:00.000Z",
      updatedAt: "2026-09-05T12:30:00.000Z",
      partyId: "63000000-0000-4000-8000-000000000005",
      partyName: "Amira Al Mansoori",
      enquiryId: "64000000-0000-4000-8000-000000000005",
      title: "Emirates Hills villa interior renovation",
      source: "instagram",
      channel: "web",
      serviceType: "interior_design",
      ownerName: "Iglo Administrator",
      queueName: "Design enquiries",
      slaStatus: null,
      slaWarningAt: null,
      slaDueAt: null,
    },
  ],
};
