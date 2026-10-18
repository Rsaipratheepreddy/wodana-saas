/* Explicit Palm demo maintenance. Run inside the core container; dry-run by default. */
const {createRequire} = require('node:module');
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const runtime = createRequire('/workspace/services/business-core/package.json');
const {Client} = runtime('pg');
const {applyExecution} = runtime('./dist/projects/execution.domain.js');
const {enrichPalmDemo} = require('/tmp/palm-demo-enrichment.cjs');
const workspace = 'af041cf6-6bd5-4db1-932a-b145bda49d0c';
const project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
const owner = 'f084de8a-dcb2-441c-a14d-8c8d84954280';
const commit = process.argv.includes('--commit');
const db = new Client({connectionString: process.env.DATABASE_URL});
const counts = data => Object.fromEntries(Object.entries(data).filter(([,v]) => Array.isArray(v)).map(([k,v]) => [k,v.length]));
async function main() {
  await db.connect();
  await db.query('BEGIN');
  await db.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspace]);
  const row = (await db.query(`SELECT e.content,e.revision,p.name,w.slug FROM project_execution e
    JOIN delivery_projects p ON p.id=e.project_id AND p.workspace_id=e.workspace_id
    JOIN workspaces w ON w.id=e.workspace_id WHERE e.workspace_id=$1 AND e.project_id=$2 FOR UPDATE OF e`,[workspace,project])).rows[0];
  if (!row || row.slug !== 'plm' || !row.name.startsWith('DEMO FLOW')) throw Error('Named Palm demo guard failed');
  const members = (await db.query(`SELECT m.id,m.user_id,u.display_name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.status='active'`,[workspace])).rows;
  const manager = members.find(m=>m.id===owner);
  if (!manager) throw Error('Expected active demo owner missing');
  const resources = (await db.query('SELECT id,kind FROM project_resources WHERE workspace_id=$1 AND active',[workspace])).rows;
  const actor = {id:owner,userId:manager.user_id,name:'DEMO data preparation',manage:true,review:true,report:true,buy:true,
    memberIds:members.map(m=>m.id),resourceIds:resources.map(r=>r.id),resourceKinds:Object.fromEntries(resources.map(r=>[r.id,r.kind])),
    now:new Date().toISOString(),today:'2026-09-23',released:true};
  const result = enrichPalmDemo(row.content,actor,applyExecution);
  if(result.changed) {
    const vendor = '7ba40000-0000-4000-8000-000000000010';
    await db.query(`INSERT INTO workspace_vendors(workspace_id,id,code,display_name,capabilities,default_currency,notes,status,created_by,updated_by)
      VALUES($1,$2,'PALM_DEMO_PACKAGING','DEMO supplier · Timber and packaging',ARRAY['materials']::varchar[],'AED',
      'Sample supplier for the Palm demonstration project only. No real contact, registration or banking details supplied.','draft',$3,$3)
      ON CONFLICT(workspace_id,id) DO NOTHING`,[workspace,vendor,manager.user_id]);
    const data=result.data;
    for(const handover of data.handovers.filter(h=>h.status==='draft')) {
      if(handover.taskIds.some(id=>!data.tasks.some(t=>t.id===id)) || handover.documentIds.some(id=>!data.documents.some(d=>d.id===id))) throw Error('Stale draft handover references remain');
    }
    for(const task of data.tasks) if(task.ownerId && !actor.memberIds.includes(task.ownerId)) throw Error('Invalid task owner remains');
    const changedDecisions = row.content.documents.some(old=>data.documents.find(d=>d.id===old.id)?.status!==old.status)
      || row.content.orders.some(old=>data.orders.find(o=>o.id===old.id)?.status!==old.status);
    if(changedDecisions) throw Error('Existing approval or purchasing state changed');
    data.revision=row.revision+1;
    if(commit) {
      const backupPath=`/tmp/palm-demo-before-${Date.now()}.json`;
      const bytes=JSON.stringify({workspace,project,revision:row.revision,content:row.content});
      const fd=fs.openSync(backupPath,'wx',0o600);
      fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);
      console.log(JSON.stringify({backupPath,sha256:createHash('sha256').update(bytes).digest('hex')}));
    }
    await db.query('UPDATE project_execution SET content=$3,revision=$4,updated_at=now() WHERE workspace_id=$1 AND project_id=$2',[workspace,project,JSON.stringify(data),data.revision]);
  }
  console.log(JSON.stringify({mode:commit?'commit':'dry-run',changed:result.changed,before:counts(row.content),after:counts(result.data),revision:result.data.revision}));
  await db.query(commit?'COMMIT':'ROLLBACK');
}
main().catch(async error=>{await db.query('ROLLBACK').catch(()=>{});console.error(error.message);process.exitCode=1;}).finally(()=>db.end());
