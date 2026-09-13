import "server-only";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { authenticatedBackendFetch } from "@/lib/auth/backend-session";
import type { CommercialState, PortalSettings } from "./types";

function e2eCommercial(caseId:string):CommercialState {
  return {
    workspaceId:"00000000-0000-4000-8000-000000000002",caseId,title:"Villa interiors",customerName:"Khalid Rahman",currency:"AED",
    contacts:[],canEdit:true,canApprove:true,canRelease:true,canManagePortal:true,portalSlug:"e2e-client",portalEnabled:true,testMode:true,
    data:{revision:1,quotes:[],requests:[],agreement:null,payments:[],audit:[],release:null,ownerReview:null,dealFile:null,materialApprovals:[],credits:[]},
  };
}
export async function commercialRead<T>(path: string): Promise<T> {
  const p = await getAuthenticatedProfile(),
    w = p.memberships[0]?.workspaceId;
  if (!w) throw new Error("Workspace unavailable.");
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    if (path.startsWith("cases/")) return e2eCommercial(path.slice("cases/".length)) as T;
    if (path === "portal-settings") return {workspaceId:w,slug:"e2e-client",version:1,enabled:true,testMode:true,canManage:true,brand:{name:"Iglo Architects",logo:"",primaryColor:"#76538f",accentColor:"#e99a72",welcomeTitle:"Welcome",welcomeText:"Review your project",supportPhone:"",layout:"minimal"}} as T;
  }
  const r = await authenticatedBackendFetch(
    `/workspaces/${w}/commercial/${path}`,
  );
  if (!r.upstream?.ok)
    throw new Error(
      "Commercial could not be loaded. Please reload or check your access.",
    );
  return r.upstream.json();
}
export const getCommercial = (id: string) =>
  commercialRead<CommercialState>(`cases/${id}`);
export const getPortalSettings = () =>
  commercialRead<PortalSettings>("portal-settings");
