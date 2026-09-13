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
    const reportNames = ["sources", "pipeline", "funnel", "sla", "assignment", "forecast"] as const;
    const responses = await Promise.all(reportNames.map((report) => backend(token, membership.workspaceId, `reports/${report}`)));
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
    page.supporting = { reports: reportNames };
    return page;
  }

  const endpoints: Record<Exclude<CrmScreenId, "crm-overview" | "crm-reports">, string> = {
    "follow-ups": "activities?limit=100",
    calendar: "activities?limit=100",
    customers: "parties?type=person&limit=100",
    organizations: "parties?type=organization&limit=100",
    opportunities: "opportunities?limit=100",
    activities: "activities?limit=100",
    conversations: "conversations?channel=whatsapp&limit=100",
    sequences: "sequences",
    automations: "automations",
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
    const runs = await backend(token, membership.workspaceId, "automation-runs");
    page.supporting = { runs: runs.forbidden ? [] : records(runs.payload).items };
  }
  return page;
}
