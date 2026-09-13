import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE,businessApiUrl,getAuthenticatedProfile } from "@/lib/auth/server";
import type { CatalogPageData, CatalogRecord } from "./catalog";

const e2eRecord = (kind: CatalogRecord["kind"], id: string, name: string, links: CatalogRecord["links"] = []): CatalogRecord => ({
 id,version:1,kind,code:id.toUpperCase(),name,description:"",market:"AE",aliases:[],attributes:[],sizes:[],sources:[],links,
 specificationStatus:"workspace_verified",dimension:kind==="unit"?"pack":"none",archived:false,starterVersion:"e2e",updatedAt:"2026-09-09T10:00:00.000Z",catalogId:"e2e-catalog",
});

function e2eCatalog(workspaceId:string):CatalogPageData {
 const group={...e2eRecord("catalog_group","e2e-catalog","My catalog"),catalogId:undefined,attributes:[{name:"Default catalog",value:"true"}]};
 return {workspaceId,currency:"AED",canManage:true,starter:{version:"e2e",count:12,market:"AE"},items:[
  group,
  e2eRecord("room","reception","Reception"),
  e2eRecord("room","meeting-room","Meeting room"),
  e2eRecord("room","workplace","Workplace"),
  e2eRecord("work","reception-counter","Reception counter",[{relation:"room",targetId:"reception"}]),
  e2eRecord("work","acoustic-wall","Acoustic wall treatment",[{relation:"room",targetId:"meeting-room"}]),
  e2eRecord("work","workstations","Workstations with cable management",[{relation:"room",targetId:"workplace"}]),
  e2eRecord("variant","standard-workstation","Standard workstation",[{relation:"work",targetId:"workstations"}]),
  e2eRecord("unit","nos","Number"),
  e2eRecord("material","plywood","MR plywood"),
  {...e2eRecord("construction","workstation-carcass","Carcass",[
   {relation:"work",targetId:"workstations"},{relation:"variant",targetId:"standard-workstation"},{relation:"material",targetId:"plywood"},{relation:"unit",targetId:"nos"},
  ]),attributes:[{name:"Quantity",value:"1"}],configuration:{recordRole:"component",required:"required"}},
 ]};
}
export async function getCatalogPageData():Promise<CatalogPageData> {
 const profile=await getAuthenticatedProfile(); const workspaceId=profile.memberships[0]?.workspaceId; const token=(await cookies()).get(ACCESS_COOKIE)?.value;
 if(!workspaceId||!token) redirect("/login");
 if(process.env.NODE_ENV!=="production"&&process.env.E2E_AUTH_BYPASS==="true")return e2eCatalog(workspaceId);
 const response=await fetch(businessApiUrl(`/workspaces/${workspaceId}/catalog?overview=true`),{headers:{authorization:`Bearer ${token}`},cache:"no-store",signal:AbortSignal.timeout(20_000)}).catch(()=>null);
 if(response?.status===401) redirect("/login");
 if(!response?.ok) return {workspaceId,canManage:false,items:[],starter:{version:"",count:0,market:""},error:response?.status===403?"You need catalog viewing permission. Ask your workspace administrator for access.":"The catalog could not be loaded. Please try again."};
 return response.json();
}
