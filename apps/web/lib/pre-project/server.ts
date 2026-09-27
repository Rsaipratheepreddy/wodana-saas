import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";
import { briefFields, type CaseContent } from "./content";
import { type PreProjectCase, type PreProjectList, listSearch } from "./types";
import type { DefinitionPageData, DefinitionState, ReadinessState } from "./definition";

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
  phase: "define", version: 1, ownerMembershipId: "00000000-0000-4000-8000-000000000003", engagementOwnerName: "Iglo Administrator",
  targetDate: null, priority: "normal", riskLevel: "none", activatedAt: "2026-09-06T10:00:00.000Z", holdReason: null, cancellationReason: null, releasedAt: null, canManageLifecycle: true,
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
    coverage: { roomCount: 3, coveredRoomCount: 0, uncoveredRooms: [{ id: "00000000-0000-4000-8000-000000000101", name: "Reception" }, { id: "00000000-0000-4000-8000-000000000102", name: "Meeting room" }, { id: "00000000-0000-4000-8000-000000000103", name: "Workplace" }], wholeProjectRequirementCount: 0, undecidedItemIds: [], clientDraftItemIds: [], missingMeasurementItemIds: [], verifiedMeasurementItemIds: [] },
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
export async function getPreProjects(query: URLSearchParams, pendingDeal = false): Promise<PreProjectList> {
  const { workspaceId, token } = await context();
  const filters = listSearch(query);
  filters.delete("view"); filters.delete("section");
  if (pendingDeal) filters.set("pendingDeal", "true");
  if (isE2eBypass()) {
    const search = filters.get("search")?.toLowerCase() ?? "";
    const items = !search || `${e2eCase.title} ${e2eCase.customerName}`.toLowerCase().includes(search)
      ? [{ ...e2eCase, qualifiedLead: false }]
      : [];
    return { workspaceId, items, total: items.length, canCreate: true, canStartLead: true };
  }
  const response = await read(workspaceId, token, `?${filters}`);
  if (!response?.ok) { const t = await getServerT(); return { workspaceId, items: [], total: 0, canCreate: false, error: response?.status === 403 ? t("You don’t have permission to view planning records. Ask your workspace administrator for access.") : t("Planning could not be loaded. Please try again.") }; }
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
  if (!response?.ok) { const t = await getServerT(); return { error: response?.status === 403 ? t("You don’t have permission to open this planning.") : t("This planning could not be loaded. Please try again.") }; }
  return response.json();
}

export async function getCaseOverviewData(): Promise<{ workspaceId: string; members: { id: string; displayName: string }[] }> {
  const { workspaceId, token } = await context();
  if (isE2eBypass()) return { workspaceId, members: [{ id: e2eCase.ownerMembershipId!, displayName: e2eCase.engagementOwnerName! }] };
  const response = await fetch(businessApiUrl(`/workspaces/${workspaceId}/members`), {
    headers: { authorization: `Bearer ${token}` }, cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return { workspaceId, members: [] };
  const members = await response.json() as { id: string; displayName: string; status: string }[];
  return { workspaceId, members: members.filter((member) => member.status === "active").map(({ id, displayName }) => ({ id, displayName })) };
}

export async function getCaseContent(id:string,includeDesigns=false,includeSite=false):Promise<{data:import('./content').CaseContent;designs:import('./content').CaseDesign[];designOptions?:import('./content').DesignOptions;site?:import('./site').SiteData}|{error:string}> {
 const {workspaceId,token}=await context();
 if(isE2eBypass()){
  if(id!==e2eCaseId)notFound();
  return {data:e2eContent(workspaceId),designs:[],...(includeDesigns?{designOptions:{folders:[],reviewers:[],actorId:"e2e-user",canReview:true,canRecordClient:true,portal:{enabled:true,slug:"e2e-client",hasApprover:true}}}:{}) ,...(includeSite?{site:{items:[],members:[],timezone:"Asia/Dubai",weekStartsOn:1,canVerify:true}}:{})};
 }
 const [brief,designs,site]=await Promise.all([read(workspaceId,token,`/${id}/brief`),includeDesigns?read(workspaceId,token,`/${id}/designs`):Promise.resolve(null),includeSite?read(workspaceId,token,`/${id}/site`):Promise.resolve(null)]);
 if(!brief?.ok||(includeDesigns&&!designs?.ok)||(includeSite&&!site?.ok)){const t=await getServerT();return {error:t('This section could not be loaded. Please reload to try again.')};}
 const designData=designs?await designs.json():null;
 return {data:await brief.json(),designs:designData?.items??[],...(designData?{designOptions:designData}:{}),...(site?{site:await site.json()}:{})};
}

export async function getDefinitionPageData(id: string): Promise<DefinitionPageData> {
  const { workspaceId, token } = await context();
  if (isE2eBypass()) {
    if (id !== e2eCaseId) notFound();
    return {
      workspaceId,
      caseId: id,
      definition: {
        caseStatus: e2eCase.status,
        draft: {
          sourceHash: "local-e2e-definition",
          readyToPublish: false,
          issues: [{ code: "missing_requirements", detail: "Add and review project requirements before sending the scope." }],
        },
        current: null,
        history: [],
        confirmed: false,
        nextAction: "complete_requirements",
        canPublish: false,
        canRecordClientDecision: false,
      },
      readiness: {
        ready: false,
        summary: { includedItemCount: 0, readyItemCount: 0, blockerCount: 1, warningCount: 0 },
        blockers: [{ code: "missing_scope", label: "Scope", detail: "Add a scope item before preparing a quotation." }],
      },
    };
  }
  const [definition, readiness] = await Promise.all([
    read(workspaceId, token, `/${id}/definition-baselines`),
    read(workspaceId, token, `/${id}/readiness?target=pricing`),
  ]);
  if (!definition?.ok || !readiness?.ok) { const t = await getServerT(); return { error: definition?.status === 403 || readiness?.status === 403 ? t("You don’t have access to this scope confirmation.") : t("Scope confirmation could not be loaded. Please try again.") }; }
  return { workspaceId, caseId: id, definition: await definition.json() as DefinitionState, readiness: await readiness.json() as ReadinessState };
}

export type DesignQueueItem = { designId: string; caseId: string; title: string; stage: string | null; roomName: string | null; clientName: string; caseTitle: string; status: string; step: "review" | "record_client" | "present" | "revise"; since: string; dueAt: string | null };
/** Designs waiting on the signed-in person across active planning cases. */
export async function getDesignQueue(): Promise<{ items: DesignQueueItem[]; error?: string }> {
  const { workspaceId, token } = await context();
  if (isE2eBypass()) return { items: [] };
  const response = await read(workspaceId, token, "/design-queue");
  if (!response?.ok) { const t = await getServerT(); return { items: [], error: t("Design reviews could not be loaded.") }; }
  return await response.json() as { items: DesignQueueItem[] };
}
