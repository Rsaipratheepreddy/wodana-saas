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
        { id: "enquiry_ownership", code: "enquiry_ownership", name: "New enquiry ownership", description: "Adds a first-response task to each new enquiry. Who owns it, and when it moves to the next person, follow Sales settings whether this is on or off.", setupHref: "/workspace/crm/leads?section=assignment", availableChannels: ["in_app"], enabled: true, status: "active", version: 1, channels: ["in_app"], weekday: "friday" },
        { id: "response_escalation", code: "response_escalation", name: "Missed response escalation", description: "Adds an urgent task when the response target is missed. Moving the enquiry to the next person follows Sales settings whether this is on or off.", setupHref: "/workspace/crm/leads?section=sla", availableChannels: ["in_app"], enabled: true, status: "active", version: 1, channels: ["in_app"], weekday: "friday" },
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
    return id === "calendar" || id === "follow-ups" ? { ...crmScreenFixture(id), supporting: { currentUserId: authProfile.id } } : crmScreenFixture(id);
  }

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const page = base(id, membership.workspaceId);
  if (id === "calendar" || id === "follow-ups") page.supporting = { currentUserId: authProfile.id };

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

  const endpoints: Record<Exclude<CrmScreenId, "crm-overview">, string> = {
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
    const workspaceResponse = await fetch(businessApiUrl(`/workspaces/${membership.workspaceId}`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const workspace = workspaceResponse.ok ? await workspaceResponse.json() : null;
    page.supporting = { defaultCurrency: workspace?.workspace?.defaultCurrency, pipelines: pipelines.forbidden ? [] : records(pipelines.payload).items };
  }
  if (id === "automations") {
    const payload = primary.payload && typeof primary.payload === "object" ? primary.payload as { providers?: unknown } : {};
    page.supporting = { providers: Array.isArray(payload.providers) ? payload.providers : [] };
  }
  return page;
}
