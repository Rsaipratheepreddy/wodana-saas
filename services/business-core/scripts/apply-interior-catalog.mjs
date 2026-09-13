import fs from 'node:fs';
import assert from 'node:assert/strict';
const [planFile, mode='review']=process.argv.slice(2);
assert(planFile && ['review','apply'].includes(mode),'Pass a reviewed plan and review/apply.');
const plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
const token=fs.readFileSync(process.env.CATALOG_TOKEN_FILE,'utf8').trim();
const base=process.env.CATALOG_API_URL??'https://api.wodana.ai/api/v1';
const workspaceId=process.env.CATALOG_WORKSPACE_ID??'d004d45c-7140-4b0c-a68d-e87d012c2390';
const root=`/workspaces/${workspaceId}/catalog`;
const fields=['description','market','aliases','attributes','sizes','sources','links','specificationStatus','dimension','baseFactor','configuration','id','catalogId','kind','code','name'];
const sort=value=>Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;
const canonical=row=>JSON.stringify(sort(Object.fromEntries(fields.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]))));
async function request(path,method='GET',body){
 const response=await fetch(base+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
 const data=await response.json();if(!response.ok)throw new Error(`${response.status} ${path}: ${JSON.stringify(data)}`);return data;
}
const state=await request(root);const byId=new Map(state.items.map(row=>[row.id,row]));
assert(byId.has(plan.catalogId),'Expected catalog is not in this workspace.');
const allAddIds=new Set(plan.additions.map(row=>row.id));
const refIds=new Set(plan.additions.flatMap(row=>row.links.map(link=>link.targetId)).filter(id=>!allAddIds.has(id)));
const references=[...refIds].map(id=>{const row=byId.get(id);assert(row&&!row.archived,`Unavailable dependency ${id}`);return {id,version:row.version};});
const imports={catalogId:plan.catalogId,records:plan.additions,references};
for(const row of plan.updates){
 const current=byId.get(row.id);assert(current&&!current.archived,`Record unavailable: ${row.name}`);
 assert(canonical(current)===canonical(row)||current.version===row.version,`Concurrent edit: ${row.name}`);
}
const preview=await request(root+'/import','POST',{...imports,dryRun:true});
console.log(JSON.stringify({mode,create:preview.created,reuse:preview.reused,updates:plan.updates.length}));
if(mode==='apply'){
 const imported=await request(root+'/import','POST',imports);assert(imported.created+imported.reused===plan.additions.length);
 let updated=0,reused=0;
 for(const row of plan.updates){
  if(canonical(byId.get(row.id))===canonical(row)){reused++;continue;}
  await request(root+'/records','PUT',row);updated++;
  if(updated%25===0)console.log(`Updated ${updated} catalog records`);
 }
 const after=await request(root);const current=new Map(after.items.map(row=>[row.id,row]));
 for(const row of [...plan.additions,...plan.updates])assert.equal(canonical(current.get(row.id)),canonical(row),`Saved catalog mismatch: ${row.name}`);
 console.log(JSON.stringify({created:imported.created,updated,reused,verified:plan.additions.length+plan.updates.length,catalogName:current.get(plan.catalogId).name}));
}
