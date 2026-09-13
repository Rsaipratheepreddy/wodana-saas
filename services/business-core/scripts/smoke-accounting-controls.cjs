// Real local transactions, isolated commercial fixture, mock accounting HTTP only.
const assert = require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createServer}=require('node:http');
require('ts-node').register({transpileOnly:true,project:require('node:path').resolve(__dirname,'../tsconfig.json')});
const {CommercialService}=require('../src/commercial/commercial.service.ts');
const {ProjectRemindersService}=require('../src/projects/project-reminders.service.ts');
const {AccountingReconciliationService}=require('../src/commercial/accounting-reconciliation.service.ts');
exports.verifyAccounting=async({db,workspaceId:w,caseId,projectId})=>{
 const connection=(await db.query("SELECT id,provider FROM integration_connections WHERE workspace_id=$1 AND provider='quickbooks' AND status='connected' AND legal_entity_id IS NOT NULL LIMIT 1",[w])).rows[0];assert(connection,'A mapped demo QuickBooks connection is required; credentials are not used.');
 const transaction=async(callback)=>{await db.query('BEGIN');try{const result=await callback(db,{displayName:'Accounting verification'});await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}};
 const access={withPermissions:(_a,_w,_p,callback)=>transaction(callback)};let snapshot;
 const server=createServer((req,res)=>{assert(req.url.includes('/invoices/TESTINVOICE'));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(snapshot));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const service=new CommercialService(access,{get:key=>key==='INTELLIGENCE_API_URL'?`http://127.0.0.1:${server.address().port}/api/v1`:undefined});
 const reconciliation=new AccountingReconciliationService({query:(...args)=>db.query(...args),tenantTransaction:(_w,_a,callback)=>transaction(callback)},service);
 const load=()=>service.load(db,w,caseId),data=await load(),payment=data.payments[0],quote=data.quotes.find(q=>q.id===payment.sourceQuoteId);assert(quote);
 snapshot={id:'TESTINVOICE',accountId:'TEST-COMPANY-'+caseId,number:'QA-INVOICE',customerName:'Verification only',total:payment.amount,balance:payment.amount,currency:quote.currency,status:'unpaid',paymentUrl:'https://example.invalid/test-payment'};
 const sync=async(paymentId=payment.id)=>service.syncInvoice({},w,caseId,{paymentId,connectionId:connection.id,invoiceId:snapshot.id,revision:(await load()).revision,clientConfirmed:true},'Fixture only');
 const finish=async(invoice,error)=>{const id=(await db.query('SELECT id FROM commercial_reconciliation_jobs WHERE workspace_id=$1 AND case_id=$2 AND payment_id=$3',[w,caseId,payment.id])).rows[0].id,leaseToken=randomUUID();await db.query("UPDATE commercial_reconciliation_jobs SET lease_token=$2,lease_until=now()+interval '5 minutes' WHERE id=$1",[id,leaseToken]);const result=await reconciliation.finish({id,leaseToken,...(invoice?{invoice}:{}),...(error?{error}:{})});await assert.rejects(()=>reconciliation.finish({id,leaseToken,invoice:snapshot}),/expired|completed/);return result;};
 try{
  await sync();assert.equal((await load()).payments[0].status,'pending');assert.equal((await db.query('SELECT content FROM project_execution WHERE workspace_id=$1 AND project_id=$2',[w,projectId])).rows[0].content.financeClosed,false,'Manual refresh must reopen the final account after a balance reversal');
  await assert.rejects(()=>sync(data.payments[1].id),/already linked/);
  snapshot={...snapshot,balance:Number((payment.amount/2).toFixed(2)),status:'partially_paid'};await sync();assert.equal((await load()).payments[0].status,'pending');
  snapshot={...snapshot,balance:0,status:'paid'};assert.equal((await finish(snapshot)).reconciled,true,'Successful workers omit the error property');assert.equal((await load()).payments[0].status,'verified');
  assert.equal((await finish({...snapshot,accountId:'WRONG-COMPANY'})).reconciled,false);assert((await load()).payments[0].invoice.lastError);assert.equal((await finish(snapshot)).reconciled,true);
  await db.query("UPDATE project_execution SET content=jsonb_set(content,'{financeClosed}','true'::jsonb) WHERE workspace_id=$1 AND project_id=$2",[w,projectId]);
  snapshot={...snapshot,balance:payment.amount,status:'unpaid'};assert.equal((await finish(snapshot)).reconciled,true);assert.equal((await load()).payments[0].status,'pending');assert.equal((await db.query('SELECT content FROM project_execution WHERE workspace_id=$1 AND project_id=$2',[w,projectId])).rows[0].content.financeClosed,false);
  assert.equal((await finish(undefined,'Provider unavailable')).reconciled,false);assert.equal((await load()).payments[0].invoice.lastError,'Provider unavailable');
  snapshot={...snapshot,balance:0,status:'paid'};await sync();assert.equal((await load()).payments[0].status,'verified');
  const before=(await db.query('SELECT content FROM project_execution WHERE workspace_id=$1 AND project_id=$2',[w,projectId])).rows[0].content,reminder=structuredClone(before);reminder.phase='active';reminder.tasks.find(t=>!reminder.tasks.some(c=>c.parentId===t.id)).status='blocked';await db.query('UPDATE project_execution SET content=$3 WHERE workspace_id=$1 AND project_id=$2',[w,projectId,JSON.stringify(reminder)]);
  try{const reminders=new ProjectRemindersService({query:(...args)=>db.query(...args)});assert((await reminders.send(projectId)).created>0);assert.equal((await reminders.send(projectId)).created,0,'Daily reminders must not duplicate on worker retry');}finally{await db.query('UPDATE project_execution SET content=$3 WHERE workspace_id=$1 AND project_id=$2',[w,projectId,JSON.stringify(before)]);}
  console.log('PASS: accounting invoice matching, duplicate milestone prevention, partial/paid balances, manual and automatic reversals, company mismatch, provider failure/recovery, expired job replay. No live accounting writes.');
 }finally{await new Promise(resolve=>server.close(resolve));await db.query('DELETE FROM commercial_reconciliation_jobs WHERE workspace_id=$1 AND case_id=$2',[w,caseId]);}
};
