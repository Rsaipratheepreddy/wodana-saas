import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base=process.env.CATALOG_API_URL??"http://127.0.0.1:8131/api/v1";
if(!["127.0.0.1","localhost"].includes(new URL(base).hostname)||process.env.NODE_ENV==="production")throw new Error("Catalog smoke runs only against local development.");
const login=await fetch(base+"/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"admin@igloarchitects.com",password:process.env.DEMO_PASSWORD??"IgloDemo#2026",tenantSlug:"iglo-architects"})});
assert.equal(login.status,201);const {accessToken}=await login.json();
const headers={authorization:`Bearer ${accessToken}`,"content-type":"application/json"};
async function request(path,method="GET",body,status=200){const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,status,`${method} ${path}: ${data.message??r.status}`);return data;}
const profile=await request("/me");const workspaceId=profile.memberships.find(m=>m.workspaceSlug==="iglo-architects").workspaceId;
const path=`/workspaces/${workspaceId}/catalog`;
const first=await request(path+"/starter","POST",{},201);const second=await request(path+"/starter","POST",{},201);assert.equal(second.created,0);
const list=await request(path);assert(list.items.length>=491);assert.equal(list.canManage,true);
const id=randomUUID();let saved;
const input={id,version:0,kind:"room",code:`SMOKE_${id.slice(0,8).toUpperCase()}`,name:`Catalog smoke ${id.slice(0,8)}`,description:"Temporary local persistence test; archived after verification.",market:"CUSTOM",aliases:[],attributes:[],sizes:[],sources:[],links:[],specificationStatus:"needs_specification",dimension:"none"};
try {
 saved=await request(path+"/records","PUT",input);assert.equal(saved.version,1);
 const retry=await request(path+"/records","PUT",input);assert.equal(retry.version,1);
 await request(path+"/records","PUT",{...input,id:randomUUID()},409);
 saved=await request(path+"/records","PUT",{...input,version:1,name:input.name+" updated"});assert.equal(saved.version,2);
 await request(path+"/records","PUT",{...input,version:1},409);
 await request(path+"/starter","POST",{},201);
 const after=await request(path);assert.equal(after.items.find(r=>r.id===id).name,saved.name);
 const material=list.items.find(r=>r.kind==="material");const {archived,starterVersion,updatedAt,...body}=material;
 await request(path+"/records","PUT",{...body,id:randomUUID(),version:0,code:`BAD_${id.slice(0,8)}`.toUpperCase(),name:`Invalid material ${id}`,links:body.links.map(l=>l.relation==="category"?{...l,targetId:randomUUID()}:l)},400);
 await request(path+"/records","PUT",{...input,id:randomUUID(),sizes:[{label:"bad",lengthMm:-1}]},400);
 const unit=list.items.find(r=>r.kind==="unit"&&r.name==="Sheet");await request(`${path}/records/${unit.id}`,"PATCH",{version:unit.version,archived:true},409);
 const other=randomUUID();await request(`/workspaces/${other}/catalog`,"GET",undefined,404);
 const noAuth=await fetch(base+path);assert.equal(noAuth.status,401);
 console.log(JSON.stringify({starterAdded:first.created,total:list.items.length,checks:["create/read/update","exact retry","duplicate rejection","version conflict","starter preserves edits","invalid and foreign reference rejection","negative size rejection","dependency archive guard","workspace membership","authentication"]}));
} finally {
 if(saved){const archived=await request(`${path}/records/${id}`,"PATCH",{version:saved.version,archived:true});assert.equal(archived.archived,true);}
}
