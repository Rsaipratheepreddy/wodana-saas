export type CrmScreenId =
  | "crm-overview"
  | "follow-ups"
  | "calendar"
  | "customers"
  | "organizations"
  | "opportunities"
  | "activities"
  | "conversations"
  | "sequences"
  | "automations"
  | "crm-reports";

export type CrmRecord = Record<string, unknown> & { id: string };

export type CrmScreenPageData = {
  canView: boolean;
  id: CrmScreenId;
  items: CrmRecord[];
  nextCursor: string | null;
  referenceTime: string;
  supporting: Record<string, unknown>;
  workspaceId: string;
};

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";
const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CREATED_AT = "2026-09-05T08:30:00.000Z";
const UPDATED_AT = "2026-09-06T07:15:00.000Z";

const people: CrmRecord[] = [
  {
    id: "71000000-0000-4000-8000-000000000001",
    type: "person",
    displayName: "Amira Al Mansoori",
    lifecycle: "customer",
    status: "active",
    ownerMembershipId: OWNER_ID,
    contacts: [
      { id: "contact-amira-email", type: "email", rawValue: "amira.almansoori@example.ae", isPrimary: true, isVerified: true },
      { id: "contact-amira-phone", type: "phone", rawValue: "+971 50 111 0101", isPrimary: true, isVerified: true },
    ],
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: "71000000-0000-4000-8000-000000000002",
    type: "person",
    displayName: "Khalid Rahman",
    lifecycle: "opportunity",
    status: "active",
    ownerMembershipId: OWNER_ID,
    contacts: [{ id: "contact-khalid-email", type: "email", rawValue: "khalid.rahman@example.ae", isPrimary: true, isVerified: true }],
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: "71000000-0000-4000-8000-000000000003",
    type: "person",
    displayName: "Dr Maya Nair",
    lifecycle: "lead",
    status: "active",
    ownerMembershipId: OWNER_ID,
    contacts: [{ id: "contact-maya-phone", type: "phone", rawValue: "+971 50 111 0107", isPrimary: true, isVerified: true }],
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
];

const organizations: CrmRecord[] = [
  {
    id: "72000000-0000-4000-8000-000000000001",
    type: "organization",
    displayName: "Al Noor Developments LLC",
    lifecycle: "customer",
    status: "active",
    ownerMembershipId: OWNER_ID,
    contacts: [{ id: "contact-alnoor", type: "email", rawValue: "projects@alnoor-demo.example", isPrimary: true, isVerified: true }],
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: "72000000-0000-4000-8000-000000000002",
    type: "organization",
    displayName: "Pearl Hospitality Group",
    lifecycle: "prospect",
    status: "active",
    ownerMembershipId: OWNER_ID,
    contacts: [{ id: "contact-pearl", type: "email", rawValue: "development@pearlhospitality-demo.example", isPrimary: true, isVerified: true }],
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
];

const opportunities: CrmRecord[] = [
  {
    id: "73000000-0000-4000-8000-000000000001",
    reference: "D-0001",
    title: "Emirates Hills villa interior renovation",
    partyName: "Amira Al Mansoori",
    pipelineId: "pipeline-1",
    stageId: "stage-1",
    pipelineName: "Design & build sales",
    stageName: "Proposal",
    status: "open",
    amount: 1850000,
    currencyCode: "AED",
    probability: 55,
    ownerName: "Iglo Administrator",
    expectedCloseAt: "2026-10-21T10:00:00.000Z",
    nextActionAt: "2026-09-09T10:00:00.000Z",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: "73000000-0000-4000-8000-000000000002",
    reference: "D-0002",
    title: "DIFC executive office fit-out",
    partyName: "Khalid Rahman",
    pipelineId: "pipeline-1",
    stageId: "stage-2",
    pipelineName: "Design & build sales",
    stageName: "Negotiation",
    status: "open",
    amount: 3200000,
    currencyCode: "AED",
    probability: 80,
    ownerName: "Iglo Administrator",
    expectedCloseAt: "2026-10-21T10:00:00.000Z",
    nextActionAt: "2026-09-09T10:00:00.000Z",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
];

const activities: CrmRecord[] = [
  {
    id: "74000000-0000-4000-8000-000000000001",
    type: "meeting",
    status: "pending",
    title: "Follow up: Emirates Hills villa interior renovation",
    ownerName: "Iglo Administrator",
    priority: "normal",
    dueAt: "2026-09-09T10:00:00.000Z",
    isNextAction: true,
    customerVisible: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: "74000000-0000-4000-8000-000000000002",
    type: "task",
    status: "pending",
    title: "Review enquiry: Dubai wellness clinic design",
    ownerName: "Iglo Administrator",
    priority: "high",
    dueAt: "2026-09-07T10:00:00.000Z",
    isNextAction: true,
    customerVisible: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
];

const conversations: CrmRecord[] = [
  {
    id: "75000000-0000-4000-8000-000000000001",
    partyName: "Amira Al Mansoori",
    channel: "internal",
    subject: "Emirates Hills villa interior renovation",
    status: "open",
    unreadCount: 0,
    lastMessageDirection: "internal",
    lastMessageText: "Full interior architecture scope, lighting and landscape interfaces.",
    lastMessageStatus: "sent",
    lastMessageAt: UPDATED_AT,
  },
  {
    id: "75000000-0000-4000-8000-000000000002",
    partyName: "Dr Maya Nair",
    channel: "phone",
    subject: "Dubai wellness clinic design",
    status: "open",
    unreadCount: 1,
    lastMessageDirection: "inbound",
    lastMessageText: "Could we review the clinic brief tomorrow morning?",
    lastMessageStatus: "delivered",
    lastMessageAt: "2026-09-06T07:40:00.000Z",
  },
];

const sequences: CrmRecord[] = [
  {
    id: "76000000-0000-4000-8000-000000000001",
    name: "Proposal follow-up",
    status: "draft",
    version: 1,
    exitConditions: { customerReply: true, opportunityClosed: true },
    steps: [
      { id: "step-1", position: 0, type: "email", delayMinutes: 1440 },
      { id: "step-2", position: 1, type: "task", delayMinutes: 2880 },
      { id: "step-3", position: 2, type: "email", delayMinutes: 7200 },
    ],
  },
];

const automations: CrmRecord[] = [
  { id: "77000000-0000-4000-8000-000000000001", code: "new_lead_assignment", name: "New lead assignment", description: "Route and assign each new design enquiry.", status: "active", activeVersionNumber: 1, runOncePerAggregate: true, version: 1 },
  { id: "77000000-0000-4000-8000-000000000002", code: "appointment_reminder", name: "Appointment reminder", description: "Remind customers before scheduled design consultations.", status: "draft", activeVersionNumber: null, runOncePerAggregate: false, version: 1 },
];

const reports: CrmRecord[] = [
  { id: "sources-instagram-web", report: "sources", source: "instagram", channel: "web", enquiries: 3, leads: 3, opportunities: 1, won: 0 },
  { id: "sources-referral-email", report: "sources", source: "referral", channel: "email", enquiries: 2, leads: 2, opportunities: 2, won: 0 },
  { id: "pipeline-proposal-open", report: "pipeline", pipeline: "Design & build sales", stage: "Proposal", status: "open", count: 1, currency: "AED", value: 1850000 },
  { id: "pipeline-negotiation-open", report: "pipeline", pipeline: "Design & build sales", stage: "Negotiation", status: "open", count: 1, currency: "AED", value: 3200000 },
  { id: "sla-active", report: "sla", status: "active", count: 4, averageMinutes: 37 },
];

export function crmScreenFixture(id: CrmScreenId): CrmScreenPageData {
  const itemsByScreen: Record<CrmScreenId, CrmRecord[]> = {
    "crm-overview": [
      { id: "78000000-0000-4000-8000-000000000001", kind: "due_today", title: "Review Dubai wellness clinic brief", partyName: "Dr Maya Nair", partyLifecycle: "prospect", reason: "Activity is due today", dueAt: "2026-09-06T10:00:00.000Z", priority: 4 },
      { id: "78000000-0000-4000-8000-000000000002", kind: "customer_reply", title: "Dr Maya Nair", partyName: "Dr Maya Nair", partyLifecycle: "prospect", reason: "Customer reply requires action", dueAt: "2026-09-06T07:40:00.000Z", priority: 1 },
    ],
    "follow-ups": activities,
    calendar: activities,
    customers: [...people, ...organizations],
    organizations,
    opportunities,
    activities,
    conversations,
    sequences,
    automations,
    "crm-reports": reports,
  };
  return {
    canView: true,
    id,
    items: itemsByScreen[id],
    nextCursor: null,
    referenceTime: "2026-09-06T08:00:00.000Z",
    supporting: id === "crm-overview"
      ? {
          summary: { activeLeads: 5, unassignedLeads: 1, openOpportunities: 2, customers: 3, pendingFollowUps: 4, wonThisMonth: 1 },
          total: 2,
          monthlyLeadSources: [
            { monthKey: "2026-04", monthLabel: "Apr", source: "website", count: 3 },
            { monthKey: "2026-04", monthLabel: "Apr", source: "instagram", count: 2 },
            { monthKey: "2026-05", monthLabel: "May", source: "referral", count: 4 },
            { monthKey: "2026-06", monthLabel: "Jun", source: "website", count: 2 },
            { monthKey: "2026-07", monthLabel: "Jul", source: "instagram", count: 5 },
            { monthKey: "2026-08", monthLabel: "Aug", source: "referral", count: 3 },
            { monthKey: "2026-09", monthLabel: "Sep", source: "website", count: 4 },
          ],
          leadPipeline: [
            { id: "61000000-0000-4000-8000-000000000001", status: "new", partyName: "Dr Maya Nair", title: "Dubai wellness clinic design", source: "website", ownerName: "Iglo Administrator", priority: "high", nextActionAt: "2026-09-07T10:00:00.000Z" },
            { id: "61000000-0000-4000-8000-000000000002", status: "attempting_contact", partyName: "Khalid Rahman", title: "DIFC executive office fit-out", source: "referral", ownerName: "Iglo Administrator", priority: "normal", nextActionAt: "2026-09-08T10:00:00.000Z" },
            { id: "61000000-0000-4000-8000-000000000003", status: "connected", partyName: "Amira Al Mansoori", title: "Emirates Hills villa interior renovation", source: "instagram", ownerName: "Iglo Administrator", priority: "normal", nextActionAt: "2026-09-09T10:00:00.000Z" },
          ],
        }
      : id === "opportunities"
        ? { pipelines: [{ id: "pipeline-1", name: "Design & build sales", status: "active", isDefault: true, stages: [{ id: "stage-1", name: "Proposal", status: "active", position: 1 }, { id: "stage-2", name: "Negotiation", status: "active", position: 2 }] }] }
        : id === "automations"
          ? { runs: [{ id: "run-1", status: "completed", definitionId: automations[0].id, createdAt: UPDATED_AT }] }
          : {},
    workspaceId: WORKSPACE_ID,
  };
}
