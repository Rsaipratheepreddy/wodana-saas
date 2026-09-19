import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import { crmScreenFixture, type CrmRecord, type CrmScreenId, type CrmScreenPageData } from "./screens";

type BackendResult = { forbidden: boolean; payload: unknown };

function records(payload: unknown): { items: CrmRecord[]; nextCursor: string | null } {
  if (Array.isArray(payload)) return { items: payload as CrmRecord[], nextCursor: null };
  if (!payload || typeof payload !== "object") return { items: [], nextCursor: null };
  const page = payload as { data?: unknown; items?: unknown; nextCursor?: unknown };
  const items = Array.isArray(page.data) ? page.data : Array.isArray(page.items) ? page.items : [];
  return { items: items as CrmRecord[], nextCursor: typeof page.nextCursor === "string" ? page.nextCursor : null };
}

async function backend(token: string, workspaceId: string, path: string): Promise<BackendResult> {
  const response = await fetch(
    businessApiUrl(`/workspaces/${workspaceId}/crm/${path}`),
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
  ).catch(() => null);
  if (!response) throw new Error("The CRM service is unavailable.");
  if (response.status === 401) redirect("/login");
  if (response.status === 403) return { forbidden: true, payload: null };
  if (!response.ok) throw new Error("CRM data could not be loaded.");
  return { forbidden: false, payload: await response.json() };
}

function base(id: CrmScreenId, workspaceId: string): CrmScreenPageData {
  return {
    canView: true,
    id,
    items: [],
    nextCursor: null,
    referenceTime: new Date().toISOString(),
    supporting: {},
    workspaceId,
  };
}

export async function getCrmScreenPageData(id: CrmScreenId): Promise<CrmScreenPageData> {
  const authProfile = await getAuthenticatedProfile();
  const membership = authProfile.memberships[0];
  if (!membership) redirect("/login");

  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    if (id === "automations") return {
      ...crmScreenFixture(id),
      items: [
        { id: "enquiry_ownership", code: "enquiry_ownership", name: "New enquiry ownership", description: "Assign every new enquiry using the CRM queue and create its first response action.", setupHref: "/workspace/crm/leads?section=assignment", availableChannels: ["in_app"], enabled: true, status: "active", version: 1, channels: ["in_app"], weekday: "friday" },
        { id: "response_escalation", code: "response_escalation", name: "Missed response escalation", description: "Create an urgent action when the configured response target is missed.", setupHref: "/workspace/crm/leads?section=sla", availableChannels: ["in_app"], enabled: true, status: "active", version: 1, channels: ["in_app"], weekday: "friday" },
        { id: "decision_reminders", code: "decision_reminders", name: "Client decision reminders", description: "Remind the request owner when an unanswered client decision reaches its due date.", setupHref: "/workspace/pre-projects/variations", availableChannels: ["in_app"], enabled: false, status: "not_configured", version: 0, channels: ["in_app"], weekday: "friday" },
        { id: "weekly_progress", code: "weekly_progress", name: "Weekly project progress", description: "Send assigned project team members a concise progress summary.", setupHref: "/workspace/projects", availableChannels: ["in_app", "email"], enabled: false, status: "not_configured", version: 0, channels: ["in_app"], weekday: "friday" },
      ],
      supporting: { providers: [
        { channel: "in_app", connected: true, delivered: 1, failed: 0, lastDeliveredAt: null, pricing: "Included with Wodana", receiptState: "built_in" },
        { channel: "email", connected: false, delivered: 0, failed: 0, lastDeliveredAt: null, pricing: "Your email provider plan applies", receiptState: "not_connected" },
        { channel: "whatsapp", connected: false, delivered: 0, failed: 0, lastDeliveredAt: null, pricing: "Meta conversation pricing applies", receiptState: "not_connected" },
        { channel: "push", connected: false, delivered: 0, failed: 0, lastDeliveredAt: null, pricing: "Included with Wodana", receiptState: "not_connected" },
      ] },
    };
    return crmScreenFixture(id);
  }

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const page = base(id, membership.workspaceId);

  if (id === "crm-overview") {
    const today = await backend(token, membership.workspaceId, "today");
    if (today.forbidden) return { ...page, canView: false };
    const todayPayload = today.payload as { items?: Array<Record<string, unknown>>; summary?: Record<string, unknown>; total?: number; monthlyLeadSources?: Array<Record<string, unknown>>; leadPipeline?: Array<Record<string, unknown>> } | null;
    page.items = (todayPayload?.items ?? []).map((item, index) => ({
      ...item,
      id: `${item.kind ?? "item"}-${item.recordId ?? index}`,
    }));
    page.supporting = {
      summary: todayPayload?.summary ?? {},
      total: todayPayload?.total ?? page.items.length,
      monthlyLeadSources: todayPayload?.monthlyLeadSources ?? [],
      leadPipeline: todayPayload?.leadPipeline ?? [],
    };
    return page;
  }

  if (id === "crm-reports") {
    // Keep the server responses intact. Each report has a different contract
    // (for example SLA has a summary and owner breakdown), so flattening them
    // into one generic table loses meaning and produces a misleading UI.
    const reportNames = ["sources", "lead-flow", "funnel", "pipeline", "sla", "assignment", "forecast"] as const;
    const responses = await Promise.all(reportNames.map((report) => backend(token, membership.workspaceId, `reports/${report}${report === "lead-flow" ? "?groupBy=mainSource" : ""}`)));
    if (responses.every((response) => response.forbidden)) return { ...page, canView: false };
    page.items = responses.flatMap((response, reportIndex) => {
      if (response.forbidden || !response.payload || typeof response.payload !== "object") return [];
      const payload = response.payload as { rows?: Array<Record<string, unknown>> };
      return (payload.rows ?? []).map((row, rowIndex) => ({
        ...row,
        id: `${reportNames[reportIndex]}-${rowIndex}`,
        report: reportNames[reportIndex],
      }));
    });
    page.supporting = {
      reports: reportNames,
      results: Object.fromEntries(reportNames.map((report, index) => [report, responses[index]?.forbidden ? null : responses[index]?.payload])),
    };
    return page;
  }

  const endpoints: Record<Exclude<CrmScreenId, "crm-overview" | "crm-reports">, string> = {
    "follow-ups": "activities?limit=100",
    calendar: "activities?limit=100",
    // Customer work is one relationship graph. Do not split people and companies
    // into separate product flows: the API returns both party types and the client
    // record decides how they relate to an enquiry or opportunity.
    customers: "parties?limit=100&includeArchived=true",
    organizations: "parties?type=organization&limit=100",
    opportunities: "opportunities?limit=100",
    activities: "activities?limit=100",
    // The backend supports email, WhatsApp, phone and internal threads. Filtering
    // the root inbox to WhatsApp hid valid customer work from the user.
    conversations: "conversations?limit=100",
    sequences: "sequences",
    automations: "automation-presets",
  };
  const primary = await backend(token, membership.workspaceId, endpoints[id]);
  if (primary.forbidden) return { ...page, canView: false };
  const primaryRecords = records(primary.payload);
  page.items = primaryRecords.items;
  page.nextCursor = primaryRecords.nextCursor;

  if (id === "opportunities") {
    const pipelines = await backend(token, membership.workspaceId, "pipelines");
    page.supporting = { pipelines: pipelines.forbidden ? [] : records(pipelines.payload).items };
  }
  if (id === "automations") {
    const payload = primary.payload && typeof primary.payload === "object" ? primary.payload as { providers?: unknown } : {};
    page.supporting = { providers: Array.isArray(payload.providers) ? payload.providers : [] };
  }
  return page;
}
