import "server-only";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import { meetsRule } from "@/lib/workspace/access";
import type { AnswerOptions, EnquiryTypeSummary, FlowDetail, RoleOption } from "./flow-model";

export type EnquiryTypesPageData = { canManage: boolean; workspaceId: string; types: EnquiryTypeSummary[]; loadError?: boolean };
export type FlowBuilderData = { canManage: boolean; workspaceId: string;
  flow: FlowDetail | null;
  roles: RoleOption[];
  answerOptions: AnswerOptions;
  /** The workspace's own names for its pipeline columns, by stage code. */
  columnNames: Record<string, string>;
};

const CODE = /^[a-z][a-z0-9_]{0,59}$/;

async function session() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const canManage = meetsRule([["crm.settings.manage"]], { permissions: membership.allowedPermissions, roles: membership.roles });
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const get = async <T>(path: string, fallback?: T): Promise<T> => {
    const response = await fetch(businessApiUrl(`/workspaces/${membership.workspaceId}/${path}`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null);
    if (response?.status === 401) redirect("/login");
    if (response?.status === 404 && path.startsWith("crm/enquiry-types/")) notFound();
    if (!response?.ok) {
      if (fallback !== undefined) return fallback;
      throw new Error("Enquiry types could not be loaded.");
    }
    return await response.json() as T;
  };
  return { canManage, workspaceId: membership.workspaceId, get };
}

export async function getEnquiryTypesPageData(): Promise<EnquiryTypesPageData> {
  const { canManage, workspaceId, get } = await session();
  if (!canManage) return { canManage, workspaceId, types: [] };
  // A failed read shows the page's error state with a retry, not the route's error screen.
  const types = await get<{ data: EnquiryTypeSummary[] } | null>("crm/enquiry-types", null);
  return { canManage, workspaceId, types: types?.data ?? [], loadError: !types };
}

/** The steps builder for one enquiry type. */
export async function getFlowBuilderData(typeId: string): Promise<FlowBuilderData> {
  const { canManage, workspaceId, get } = await session();
  if (!canManage) return { canManage, workspaceId, flow: null, roles: [], answerOptions: {}, columnNames: {} };
  const [flow, roles, options, design, pipelines] = await Promise.all([
    get<FlowDetail>(`crm/enquiry-types/${typeId}`),
    get<Array<{ code: string; name: string }>>("roles", []),
    get<{ budgetRanges?: Array<{ id: string; label: string }>; customerTypes?: Array<{ id: string; label: string }> }>("crm/lead-options", {}),
    get<{ packages?: Array<{ code: string; name: string; status?: string }> }>("design/settings", {}),
    get<{ data?: Array<{ isDefault?: boolean; stages?: Array<{ code: string; name: string }> }> } | Array<{ isDefault?: boolean; stages?: Array<{ code: string; name: string }> }>>("crm/pipelines", []),
  ]);
  const choices = (items: Array<{ id: string; label: string }> | undefined) => (items ?? []).filter((item) => CODE.test(item.id)).map((item) => ({ value: item.id, label: item.label }));
  const pipelineList = Array.isArray(pipelines) ? pipelines : pipelines.data ?? [];
  const pipeline = pipelineList.find((item) => item.isDefault) ?? pipelineList[0];
  return {
    canManage, workspaceId, flow,
    roles: (Array.isArray(roles) ? roles : []).map((role) => ({ code: role.code, name: role.name })),
    answerOptions: {
      clientType: choices(options.customerTypes),
      budgetBand: choices(options.budgetRanges),
      package: (design.packages ?? []).filter((item) => item.status !== "archived" && CODE.test(item.code)).map((item) => ({ value: item.code, label: item.name })),
    },
    columnNames: Object.fromEntries((pipeline?.stages ?? []).map((stage) => [stage.code, stage.name])),
  };
}
