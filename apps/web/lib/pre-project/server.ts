import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import { briefFields, type CaseContent } from "./content";
import { type PreProjectCase, type PreProjectList, listSearch } from "./types";

const e2eCaseId = "00000000-0000-4000-8000-000000000001";
const e2eCase: PreProjectCase = {
  id: e2eCaseId,
  title: "Villa interiors",
  description: "Interior fit-out for a family villa.",
  status: "active",
  customerId: "00000000-0000-4000-8000-000000000011",
  customerName: "Khalid Rahman",
  opportunityId: "00000000-0000-4000-8000-000000000021",
  opportunityStatus: "qualified",
  leadId: "00000000-0000-4000-8000-000000000031",
  leadManagerName: "Iglo Administrator",
  amount: "109158.00",
  currencyCode: "AED",
  createdAt: "2026-09-06T10:00:00.000Z",
  updatedAt: "2026-09-09T10:00:00.000Z",
};

function isE2eBypass() {
  return process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true";
}

function e2eContent(workspaceId: string): CaseContent {
  return {
    workspaceId,
    caseId: e2eCaseId,
    canEdit: true,
    caseStatus: "active",
    fromCrm: true,
    crmContext: { description: e2eCase.description, opportunityAmount: e2eCase.amount, currencyCode: "AED" },
    rooms: [
      { id: "00000000-0000-4000-8000-000000000101", name: "Reception", version: 1 },
      { id: "00000000-0000-4000-8000-000000000102", name: "Meeting room", version: 1 },
      { id: "00000000-0000-4000-8000-000000000103", name: "Workplace", version: 1 },
    ],
    entries: [],
    brief: {
      ...(Object.fromEntries(Object.keys(briefFields).map((key) => [key, ""])) as Record<keyof typeof briefFields, string>),
      currencyCode: "AED",
      budgetAmount: "109158.00",
      version: 1,
    },
  };
}

async function context() {
  const profile = await getAuthenticatedProfile();
  const workspaceId = profile.memberships[0]?.workspaceId;
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!workspaceId) redirect("/login");
  return { workspaceId, token };
}
async function read(workspaceId: string, token: string | undefined, path: string) {
  if (!token) redirect("/login");
  const response = await fetch(businessApiUrl(`/workspaces/${workspaceId}/pre-projects${path}`), {
    headers: { authorization: `Bearer ${token}` }, cache: "no-store",
  }).catch(() => null);
  if (response?.status === 401) redirect("/login");
  return response;
}
export async function getPreProjects(query: URLSearchParams): Promise<PreProjectList> {
  const { workspaceId, token } = await context();
  const filters = listSearch(query);
  filters.delete("view"); filters.delete("section");
  if (isE2eBypass()) {
    const search = filters.get("search")?.toLowerCase() ?? "";
    const items = !search || `${e2eCase.title} ${e2eCase.customerName}`.toLowerCase().includes(search)
      ? [{ ...e2eCase, qualifiedLead: false }]
      : [];
    return { workspaceId, items, total: items.length, canCreate: true, canStartLead: true };
  }
  const response = await read(workspaceId, token, `?${filters}`);
  if (!response?.ok) return { workspaceId, items: [], total: 0, canCreate: false, error: response?.status === 403 ? "You don’t have permission to view pre-execution records. Ask your workspace administrator for access." : "Pre-execution could not be loaded. Please try again." };
  return { ...await response.json(), workspaceId };
}
export async function getPreProject(id: string): Promise<PreProjectCase | { error: string }> {
  const { workspaceId, token } = await context();
  if (isE2eBypass()) {
    if (id !== e2eCaseId) notFound();
    return e2eCase;
  }
  const response = await read(workspaceId, token, `/${id}`);
  if (response?.status === 404) notFound();
  if (!response?.ok) return { error: response?.status === 403 ? "You don’t have permission to open this pre-execution." : "This pre-execution could not be loaded. Please try again." };
  return response.json();
}

export async function getCaseContent(id:string,includeDesigns=false,includeSite=false):Promise<{data:import('./content').CaseContent;designs:import('./content').CaseDesign[];designOptions?:import('./content').DesignOptions;site?:import('./site').SiteData}|{error:string}> {
 const {workspaceId,token}=await context();
 if(isE2eBypass()){
  if(id!==e2eCaseId)notFound();
  return {data:e2eContent(workspaceId),designs:[],...(includeDesigns?{designOptions:{folders:[],reviewers:[],actorId:"e2e-user",canReview:true,canRecordClient:true,portal:{enabled:true,slug:"e2e-client",hasApprover:true}}}:{}) ,...(includeSite?{site:{items:[],members:[],timezone:"Asia/Dubai",weekStartsOn:1,canVerify:true}}:{})};
 }
 const [brief,designs,site]=await Promise.all([read(workspaceId,token,`/${id}/brief`),includeDesigns?read(workspaceId,token,`/${id}/designs`):Promise.resolve(null),includeSite?read(workspaceId,token,`/${id}/site`):Promise.resolve(null)]);
 if(!brief?.ok||(includeDesigns&&!designs?.ok)||(includeSite&&!site?.ok))return {error:'This section could not be loaded. Please reload to try again.'};
 const designData=designs?await designs.json():null;
 return {data:await brief.json(),designs:designData?.items??[],...(designData?{designOptions:designData}:{}),...(site?{site:await site.json()}:{})};
}
