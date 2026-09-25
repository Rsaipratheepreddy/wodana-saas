import "server-only";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { authenticatedBackendFetch } from "@/lib/auth/backend-session";
import type { CommercialState, PortalSettings, Quote } from "./types";

const e2eQuote: Quote = {
  id: "92000000-0000-4000-8000-000000000005",
  number: 1,
  kind: "quotation",
  status: "draft",
  title: "Jumeirah villa proposal",
  currency: "AED",
  validUntil: "2026-10-18",
  createdAt: "2026-09-11T08:00:00.000Z",
  discount: 0,
  taxRate: 5,
  terms: "Quotation is valid for 30 days. Production begins after the approved drawings, signed agreement and required advance payment.",
  exclusions: "Authority fees, structural modifications and work outside the confirmed scope.",
  inclusions: "Design coordination, manufacture, delivery and installation for the listed items.",
  total: 82687.5,
  requestIds: [],
  cover: {
    preparedFor: "Khalid Rahman",
    location: "Jumeirah Garden Villa, Dubai",
    subtitle: "Interior design & fit-out proposal",
  },
  presentation: {
    version: 1,
    pageBackground: "#E4E3DE",
    textColor: "#000000",
    accentColor: "#000000",
    pages: [],
  },
  rooms: [
    { id: "quote-room-dining", name: "Dining area" },
    { id: "quote-room-living", name: "Living area" },
    { id: "quote-room-bedroom", name: "Primary bedroom" },
  ],
  lines: [
    { id: "quote-line-table", room: "Dining area", title: "Dining table", specification: "Custom oval dining table, coordinated with the approved interior concept.", material: "Taj Mahal quartzite · natural veneer", finish: "Honed stone · satin veneer", variant: "220 × 100 × 75 cm", quantity: 1, unit: "no", unitCost: 16200, rate: 29000 },
    { id: "quote-line-chairs", room: "Dining area", title: "Dining chairs", specification: "Upholstered dining chair with curved timber back and commercial-grade fabric.", material: "Veneer · performance fabric", finish: "Warm oak · client-approved fabric", quantity: 6, unit: "nos", unitCost: 1850, rate: 3500 },
    { id: "quote-line-media", room: "Living area", title: "Media wall & buffet joinery", specification: "Floor-to-ceiling media composition with concealed services, LED lighting and coordinated storage.", material: "MR plywood · natural veneer · lacquer · LED", finish: "Warm oak · soft beige lacquer", quantity: 1, unit: "lot", unitCost: 15800, rate: 28750 },
  ],
  paymentTerms: [
    { id: "payment-advance", title: "Advance", percent: 50, trigger: "On agreement signing", requiredForRelease: true },
    { id: "payment-production", title: "Production", percent: 40, trigger: "Before dispatch", requiredForRelease: false },
    { id: "payment-handover", title: "Handover", percent: 10, trigger: "On client acceptance", requiredForRelease: false },
  ],
};

function e2eCommercial(caseId:string):CommercialState {
  return {
    workspaceId:"00000000-0000-4000-8000-000000000002",caseId,title:"Villa interiors",customerName:"Khalid Rahman",currency:"AED",
    contacts:[],canEdit:true,canApprove:true,canVerifyFinance:true,canRelease:true,canManagePortal:true,portalSlug:"e2e-client",portalEnabled:true,testMode:true,
    data:{revision:1,quotes:[e2eQuote],requests:[],agreement:null,payments:[],audit:[],release:null,ownerReview:null,dealFile:null,materialApprovals:[],credits:[]},
  };
}
export async function commercialRead<T>(path: string): Promise<T> {
  const p = await getAuthenticatedProfile(),
    w = p.memberships[0]?.workspaceId;
  if (!w) throw new Error("Workspace unavailable.");
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    if (path.startsWith("cases/")) return e2eCommercial(path.slice("cases/".length)) as T;
    if (path === "portal-settings") return {workspaceId:w,slug:"e2e-client",version:1,enabled:true,testMode:true,canManage:true,brand:{name:"Iglo Architects",logo:"",primaryColor:"#0f5c4a",accentColor:"#e99a72",welcomeTitle:"Welcome",welcomeText:"Review your project",supportPhone:"",layout:"minimal"}} as T;
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
