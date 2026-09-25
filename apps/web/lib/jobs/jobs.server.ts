import "server-only";

import { redirect } from "next/navigation";
import { authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import type { JobDetailProjection, JobIdentityList, JobIdentityProjection } from "./jobs";

const fixtureId = "91000000-0000-4000-8000-000000000001";
const sourceIds = {
  enquiry: "92000000-0000-4000-8000-000000000001",
  lead: "92000000-0000-4000-8000-000000000002",
  opportunity: "92000000-0000-4000-8000-000000000003",
  case: "92000000-0000-4000-8000-000000000004",
  quote: "92000000-0000-4000-8000-000000000005",
  project: "92000000-0000-4000-8000-000000000006",
} as const;

const baseFixture: JobIdentityProjection = {
  jobId: fixtureId,
  reference: "JOB-2026-001",
  createdAt: "2026-09-10T06:30:00.000Z",
  title: "Jumeirah villa interiors",
  customer: { id: "93000000-0000-4000-8000-000000000001", name: "Amira Hassan" },
  links: [
    { type: "enquiry", id: sourceIds.enquiry, caseId: null, status: "active", version: 2, sourceState: "available" },
    { type: "lead", id: sourceIds.lead, caseId: null, status: "active", version: 4, sourceState: "available" },
    { type: "opportunity", id: sourceIds.opportunity, caseId: null, status: "active", version: 3, sourceState: "available" },
    { type: "case", id: sourceIds.case, caseId: sourceIds.case, status: "active", version: 8, sourceState: "available" },
    { type: "quote", id: sourceIds.quote, caseId: sourceIds.case, status: "active", version: 5, sourceState: "available" },
    { type: "project", id: sourceIds.project, caseId: sourceIds.case, status: "active", version: 6, sourceState: "available" },
  ],
  missingSourceCount: 0,
  repairableLinkCount: 0,
  phase: "deliver",
  phaseSource: { type: "project", id: sourceIds.project, version: 6 },
  accessLimited: false,
  stage: { label: "Site preparation", manual: true, version: 1, reason: "Site mobilization is confirmed.", setBy: "94000000-0000-4000-8000-000000000001", setByName: "Iglo Administrator", setAt: "2026-09-17T08:00:00.000Z" },
  owner: { membershipId: "94000000-0000-4000-8000-000000000001", name: "Omar Rahman" },
  targetDate: "2026-10-02T00:00:00.000Z",
  flags: {
    blocked: { active: false, reason: null, source: null },
    awaiting_client: { active: false, reason: null, source: null },
    at_risk: { active: true, reason: "A delivery dependency needs review.", source: { type: "project", id: sourceIds.project, version: 6 } },
  },
  nextAction: {
    title: "Confirm joinery production slot",
    owner: { membershipId: "94000000-0000-4000-8000-000000000001", name: "Omar Rahman" },
    dueAt: "2026-09-20T08:00:00.000Z",
    reason: "Project control next action",
    route: `/workspace/projects/${sourceIds.project}`,
    source: { type: "project", id: sourceIds.project, version: 6 },
  },
};

const secondFixture: JobIdentityProjection = {
  ...baseFixture,
  jobId: "91000000-0000-4000-8000-000000000002",
  reference: "JOB-2026-002",
  title: "DIFC executive office fit-out",
  customer: { id: "93000000-0000-4000-8000-000000000002", name: "Pearl Hospitality Group" },
  links: baseFixture.links.slice(0, 3).map((link, index) => ({ ...link, id: `95000000-0000-4000-8000-00000000000${index + 1}` })),
  phase: "qualify",
  phaseSource: { type: "opportunity", id: "95000000-0000-4000-8000-000000000003", version: 2 },
  stage: { label: "Qualifying", manual: false, version: 0, reason: null, setBy: null, setByName: null, setAt: null },
  owner: null,
  targetDate: "2026-09-25T00:00:00.000Z",
  flags: {
    blocked: { active: false, reason: null, source: null },
    awaiting_client: { active: true, reason: "The brief is waiting for client confirmation.", source: { type: "opportunity", id: "95000000-0000-4000-8000-000000000003", version: 2 } },
    at_risk: { active: false, reason: null, source: null },
  },
  nextAction: {
    title: "Confirm the project brief",
    owner: null,
    dueAt: "2026-09-19T06:00:00.000Z",
    reason: "CRM next action",
    route: "/workspace/crm/opportunities?record=95000000-0000-4000-8000-000000000003",
    source: { type: "opportunity", id: "95000000-0000-4000-8000-000000000003", version: 2 },
  },
};

function detailFixture(job: JobIdentityProjection): JobDetailProjection {
  return {
    ...job,
    clientTimelineAccess: { communications: true, activities: true },
    clientTimeline: [
      { id: "message:97000000-0000-4000-8000-000000000001", kind: "message", channel: "whatsapp", direction: "outbound", status: "delivered", providerStatus: "read", title: "Design review reminder", detail: "Your design pack is ready to review.", occurredAt: "2026-09-17T07:30:00.000Z", actor: { id: "94000000-0000-4000-8000-000000000001", name: "Iglo Administrator" }, failureCode: null, source: { type: "conversation", id: "97000000-0000-4000-8000-000000000002" } },
      { id: "activity:97000000-0000-4000-8000-000000000003", kind: "activity", channel: "phone", direction: "outbound", status: "manually_logged", providerStatus: null, title: "Scope confirmation call", detail: "Client confirmed the living room scope.", occurredAt: "2026-09-16T11:00:00.000Z", actor: { id: "94000000-0000-4000-8000-000000000001", name: "Iglo Administrator" }, failureCode: null, source: { type: "activity", id: "97000000-0000-4000-8000-000000000003" } },
    ],
    timeline: [
      { id: "96000000-0000-4000-8000-000000000001", kind: "stage", title: `Stage set to ${job.stage.label}`, detail: job.stage.reason, occurredAt: job.stage.setAt ?? "2026-09-17T08:00:00.000Z", recordedAt: job.stage.setAt ?? "2026-09-17T08:00:00.000Z", actor: { id: "94000000-0000-4000-8000-000000000001", name: "Iglo Administrator" }, source: null },
      { id: "96000000-0000-4000-8000-000000000002", kind: "source_link", title: "Source connected", detail: "Project created from the released commercial baseline.", occurredAt: "2026-09-16T10:00:00.000Z", recordedAt: "2026-09-16T10:00:00.000Z", actor: { id: "94000000-0000-4000-8000-000000000001", name: "Iglo Administrator" }, source: job.phaseSource },
      { id: "96000000-0000-4000-8000-000000000003", kind: "source_event", title: "Quotation accepted", detail: null, occurredAt: "2026-09-15T09:30:00.000Z", recordedAt: "2026-09-15T09:30:00.000Z", actor: { id: "94000000-0000-4000-8000-000000000001", name: "Iglo Administrator" }, source: { type: "quote", id: sourceIds.quote, version: 5 } },
    ],
  };
}

export function jobFixtureList(): JobIdentityList {
  return { items: [baseFixture, secondFixture], total: 2, limit: 50, offset: 0 };
}

export async function jobsRead(): Promise<{ workspaceId: string; data: JobIdentityList; loadError?: string }> {
  const profile = await getAuthenticatedProfile();
  const workspaceId = profile.memberships[0]?.workspaceId;
  if (!workspaceId) redirect("/login");
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    return { workspaceId, data: jobFixtureList() };
  }
  const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/jobs?limit=100&offset=0`);
  if (result.unauthenticated) redirect("/login");
  if (!result.upstream?.ok) return {
    workspaceId,
    data: { items: [], total: 0, limit: 100, offset: 0 },
    loadError: "Jobs are temporarily unavailable. Refresh when the service is ready.",
  };
  return { workspaceId, data: await result.upstream.json() as JobIdentityList };
}

export async function jobRead(jobId: string): Promise<{ workspaceId: string; data: JobDetailProjection }> {
  const profile = await getAuthenticatedProfile();
  const workspaceId = profile.memberships[0]?.workspaceId;
  if (!workspaceId) redirect("/login");
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    const job = jobFixtureList().items.find((item) => item.jobId === jobId) ?? baseFixture;
    return { workspaceId, data: detailFixture(job) };
  }
  const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/jobs/${jobId}`);
  if (result.unauthenticated) redirect("/login");
  if (result.upstream?.status === 404) redirect("/workspace/crm/jobs");
  if (!result.upstream?.ok) throw new Error("This Job could not be loaded. Check your access or refresh.");
  return { workspaceId, data: await result.upstream.json() as JobDetailProjection };
}
