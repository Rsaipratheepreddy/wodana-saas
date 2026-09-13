import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.env.CATALOG_API_URL??'http://127.0.0.1:8131/api/v1';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname)||process.env.NODE_ENV==='production')throw new Error('Catalog smoke runs only against local development.');
const login=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@igloarchitects.com',password:process.env.DEMO_PASSWORD??'IgloDemo#2026',tenantSlug:'iglo-architects'})});
assert.equal(login.status,201);const {accessToken}=await login.json();
const headers={'content-type':'application/json',authorization:`Bearer ${accessToken}`};
async function req(path,method='GET',body,status=200){const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
const me=await req('/me'),wid=me.memberships.find(m=>m.workspaceSlug==='iglo-architects').workspaceId,p=`/workspaces/${wid}/catalog`,cid=randomUUID(),suffix=cid.slice(0,8).toUpperCase(),ids=[];
const draft=(kind,name)=>({id:randomUUID(),catalogId:cid,version:0,kind,name,code:`QA_${name.toUpperCase().replace(/\W/g,'_')}_${suffix}`,description:'Temporary import verification',market:'CUSTOM',aliases:[],attributes:[],sizes:[],sources:[],links:[],configuration:{},specificationStatus:'needs_specification',dimension:'none'});
await req(p+'/collections','POST',{id:cid,name:`Import safeguards ${suffix}`,starter:false},201);
try{
 const group=draft('record_group','Group');group.configuration={defaultKind:'material',icon:'materials'};
 const unit=draft('unit','Area');unit.dimension='area';unit.baseFactor=1;
 const material=draft('material','Material');material.links=[{relation:'unit',targetId:unit.id},{relation:'record_group',targetId:group.id}];
 const batch={catalogId:cid,records:[material,group,unit],references:[]};
 const preview=await req(p+'/import','POST',{...batch,dryRun:true},201);assert.equal(preview.created,3);assert.deepEqual(preview.items,[]);
 assert.equal((await req(p)).items.filter(r=>r.catalogId===cid).length,0);
 const committed=await req(p+'/import','POST',batch,201);assert.equal(committed.created,3);ids.push(material.id,unit.id,group.id);
 const retry=await req(p+'/import','POST',batch,201);assert.equal(retry.created,0);assert.equal(retry.reused,3);
 const stale=draft('material','Stale');stale.links=[{relation:'unit',targetId:unit.id}];await req(p+'/import','POST',{catalogId:cid,records:[stale],references:[{id:unit.id,version:99}]},409);
 const one=draft('room','Cycle One'),two=draft('room','Cycle Two');one.links=[{relation:'parent',targetId:two.id}];two.links=[{relation:'parent',targetId:one.id}];await req(p+'/import','POST',{catalogId:cid,records:[one,two],references:[]},400);
 const current=(await req(p)).items;assert.equal(current.filter(r=>r.catalogId===cid).length,3);
 const foreign=current.find(r=>r.kind==='unit'&&r.catalogId!==cid&&!r.archived);const bad=draft('material','Foreign'),good=draft('room','Rollback');bad.links=[{relation:'unit',targetId:foreign.id}];await req(p+'/import','POST',{catalogId:cid,records:[good,bad],references:[{id:foreign.id,version:foreign.version}]},400);
 assert.equal((await req(p)).items.filter(r=>r.catalogId===cid).length,3);
 const bulk=Array.from({length:500},(_,i)=>draft('room',`Capacity ${i}`));const large=await req(p+'/import','POST',{catalogId:cid,records:bulk,references:[],dryRun:true},201);assert.equal(large.created,500);
 await req(p+'/import','POST',{catalogId:cid,records:[...bulk,draft('room','Over limit')],references:[],dryRun:true},400);
 console.log(JSON.stringify({passed:['dry-run rollback','forward references','atomic commit','identical retry','stale reference rejection','parent cycle rejection and rollback','cross-catalog rejection and rollback','500-record body capacity','501-record rejection']}));
}finally{const current=(await req(p)).items;for(const id of [...ids,cid]){const record=current.find(r=>r.id===id);if(record&&!record.archived)await req(p+'/records/'+id,'PATCH',{version:record.version,archived:true});}}
