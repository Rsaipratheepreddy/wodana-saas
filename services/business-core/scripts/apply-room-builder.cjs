/* Privileged, operator-run data migration. Reuses tenant permissions, DTO validation,
 * optimistic versions, catalog graph validation and audit events in ONE transaction.
 * Without --commit every write, including audits, is rolled back. No sessions/users created. */
require('reflect-metadata');
const fs=require('node:fs'),path=require('node:path'),{Pool}=require('pg'),{validateSync}=require('class-validator'),{plainToInstance}=require('class-transformer');
const {CatalogService}=require('../dist/catalog/catalog.service'),{ImportCatalogDto}=require('../dist/catalog/catalog.dto');
const {WorkspaceAccessService}=require('../dist/workspaces/workspace-access.service'),{CrmEventsService}=require('../dist/crm/shared/crm-events.service');
const [planPath,...args]=process.argv.slice(2);const plan=JSON.parse(fs.readFileSync(planPath));const commit=args.includes('--commit');
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
function batches(records){
 const byId=new Map(records.map(r=>[r.id,r]));const index=new Map(),low=new Map(),stack=[],onStack=new Set(),groups=[];let i=0;
 function visit(id){index.set(id,i);low.set(id,i++);stack.push(id);onStack.add(id);for(const link of byId.get(id).links){if(!byId.has(link.targetId))throw Error('Missing dependency');const to=link.targetId;if(!index.has(to)){visit(to);low.set(id,Math.min(low.get(id),low.get(to)));}else if(onStack.has(to))low.set(id,Math.min(low.get(id),index.get(to)));}if(low.get(id)===index.get(id)){const group=[];let to;do{to=stack.pop();onStack.delete(to);group.push(byId.get(to));}while(to!==id);groups.push(group);}}
 for(const r of records)if(!index.has(r.id))visit(r.id);
 const out=[];let batch=[];for(const group of groups){if(group.length>400)throw Error('Dependency group too large');if(batch.length+group.length>400){out.push(batch);batch=[];}batch.push(...group);}if(batch.length)out.push(batch);return out;
}
(async()=>{const client=await pool.connect();const started=Date.now();try{
 await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='120s'");await client.query("SELECT set_config('app.current_workspace_id',$1,true)",[plan.workspaceId]);
 const actor=(await client.query(`SELECT u.id AS "userId",u.primary_email AS email,u.display_name AS "displayName" FROM users u JOIN workspace_memberships m ON m.user_id=u.id JOIN member_roles mr ON mr.membership_id=m.id JOIN roles r ON r.id=mr.role_id WHERE m.workspace_id=$1 AND m.status='active' AND u.status='active' AND r.code='owner' ORDER BY m.created_at,u.id LIMIT 1`,[plan.workspaceId])).rows[0];
 if(!actor)throw Error('An existing active workspace owner is required');
 await client.query("SELECT set_config('app.current_actor_id',$1,true)",[actor.userId]);
 const db={tenantTransaction:async(w,u,work)=>{if(w!==plan.workspaceId||u!==actor.userId)throw Error('Migration scope mismatch');return work(client);}};
 const access=new WorkspaceAccessService(db,{resolveActor:async()=>actor});const service=new CatalogService(access,new CrmEventsService());
 await access.withPermissions(actor,plan.workspaceId,['catalog.view','catalog.manage'],async()=>{});
 const fingerprint=async()=>(await client.query(`SELECT md5(coalesce(string_agg(row_to_json(r)::text,'' ORDER BY id),'')) AS hash FROM workspace_catalog_records r WHERE workspace_id=$1 AND id<>$2 AND catalog_id IS DISTINCT FROM $2::uuid`,[plan.workspaceId,plan.catalogId])).rows[0].hash;
 const before=await fingerprint();
 const exists=(await client.query('SELECT id FROM workspace_catalog_records WHERE workspace_id=$1 AND id=$2',[plan.workspaceId,plan.catalogId])).rowCount;
 if(!exists)await service.createCatalog(actor,plan.workspaceId,{id:plan.catalogId,name:plan.name,description:'Rooms, items, variants and materials from room_builder_catalog (1).xlsx.',starter:false});
 let created=0,reused=0;const versions=new Map((await client.query('SELECT id,version FROM workspace_catalog_records WHERE workspace_id=$1 AND catalog_id=$2',[plan.workspaceId,plan.catalogId])).rows.map(r=>[r.id,r.version]));
 for(const [i,records]of batches(plan.records).entries()){
  const own=new Set(records.map(r=>r.id));const references=[...new Set(records.flatMap(r=>r.links.map(l=>l.targetId)).filter(id=>!own.has(id)))].map(id=>({id,version:versions.get(id)}));
  const dto=plainToInstance(ImportCatalogDto,{catalogId:plan.catalogId,records,references,dryRun:false});const errors=validateSync(dto,{whitelist:true,forbidNonWhitelisted:true});if(errors.length)throw Error(JSON.stringify(errors).slice(0,6000));
  const result=await service.importRecords(actor,plan.workspaceId,dto);created+=result.created;reused+=result.reused;for(const r of result.items)versions.set(r.id,r.version);
  console.log(JSON.stringify({batch:i+1,created,reused}));
 }
 console.log(JSON.stringify({validation:'reading imported records'}));
 const actual=(await service.list(actor,plan.workspaceId,{catalogId:plan.catalogId})).items;
 const catalog=actual.find(r=>r.id===plan.catalogId),catalogRows=actual.filter(r=>r.catalogId===plan.catalogId);
 if(catalogRows.length!==plan.records.length)throw Error('Imported record count differs');
 if(catalogRows.filter(r=>r.attributes.some(a=>a.name==='Source worksheet')).length!==7392)throw Error('Source row count differs');
 const byId=new Map(catalogRows.map(r=>[r.id,r]));
 const broken=catalogRows.flatMap(r=>r.links).filter(l=>!byId.has(l.targetId)||byId.get(l.targetId).archived).length;
 if(broken)throw Error('Broken catalog links');
 const attributes=[{name:'Default catalog',value:'true'},{name:'Source file',value:'room_builder_catalog (1).xlsx'},{name:'Source SHA256',value:plan.report.sourceSha256},{name:'Source rows',value:'7392'}];
 if(JSON.stringify(catalog.attributes)!==JSON.stringify(attributes)){
  const {archived,starterVersion,updatedAt,...input}=catalog;await service.save(actor,plan.workspaceId,{...input,attributes});
 }
 console.log(JSON.stringify({validation:'checking existing catalogs'}));
 if(before!==await fingerprint())throw Error('Existing catalogs changed');
 const report={...plan.report,workspaceId:plan.workspaceId,catalogId:plan.catalogId,created,reused,brokenLinks:broken,existingCatalogsUnchanged:true,committed:commit,elapsedMs:Date.now()-started};
 await client.query(commit?'COMMIT':'ROLLBACK');fs.writeFileSync(planPath+(commit?'.committed.json':'.dry-run.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){await client.query('ROLLBACK');console.error(e.message);process.exitCode=1;}finally{client.release();await pool.end();}})();
