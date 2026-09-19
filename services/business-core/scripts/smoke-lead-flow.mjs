import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
const api=process.env.LEAD_FLOW_TEST_API || 'http://127.0.0.1:8150/api/v1', run=randomUUID();
if (!['127.0.0.1','localhost','[::1]'].includes(new URL(api).hostname)) throw new Error('This test creates fixtures and may only run against a local test API.');
const actor=name=>({'x-wodana-user-subject':`${name}-${run}`,'x-wodana-user-email':`${name}-${run}@example.com`,'x-wodana-user-name':name});
const owner=actor('flow-owner'),outside=actor('flow-outsider'),results=[];
async function req(path,{body,method=body?'POST':'GET',headers=owner,expected=method==='POST'?201:200,key}={}){
 const r=await fetch(api+path,{method,headers:{...headers,...(body?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json().catch(()=>null);
 assert.equal(r.status,expected,`${method} ${path}: ${r.status} ${JSON.stringify(data)}`); return data;
}
async function check(name,work){try{await work();results.push({name,status:'passed'});console.log('PASS',name)}catch(e){results.push({name,status:'failed',error:e.message});console.log('FAIL',name,e.message)}}
const ws=await req('/workspaces',{body:{name:'Leads flow QA',slug:'flow-'+run,defaultCurrency:'AED',defaultLocale:'en-AE',defaultTimezone:'Asia/Dubai',unitSystem:'metric',weekStartsOn:1,firstLegalEntity:{code:'QA',displayName:'Flow QA',registeredName:'Flow QA',countryCode:'AE',baseCurrency:'AED',locale:'en-AE',timezone:'Asia/Dubai'}}});
const wid=ws.workspace.id,base=`/workspaces/${wid}/crm`;
const members=await req(`/workspaces/${wid}/members`),ownerId=members.find(m=>m.roles.includes('owner')).id;
const queue=await req(base+'/queues',{body:{name:'Sales team',code:'sales',isFallback:true}});
await req(base+`/queues/${queue.id}/members`,{method:'PUT',body:{membershipId:ownerId,capacity:1000,weight:1,isAvailable:true}});
const payload=()=>({source:'company',channel:'call',intakeMethod:'manual',party:{displayName:randomUUID().replaceAll('-',''),email:randomUUID()+'@example.com'},serviceType:'not_sure',details:{location:'Dubai Marina',budgetRange:'not_sure'},assignment:{mode:'unassigned'},originalPayload:{qa:run}});
const add=(body=payload(),key=randomUUID())=>req(base+'/intake-events',{body,key});
let first;
await check('Optional title uses E-0001; structured fields and intake method saved',async()=>{first=await add();assert.equal(first.reference,'E-0001');const detail=await req(base+`/leads/${first.leadId}`);assert.equal(detail.enquiry.reference,first.reference);assert.equal(detail.enquiry.title,first.reference);assert.equal(detail.enquiry.details.location,'Dubai Marina');assert.equal(detail.enquiry.intakeMethod,'manual');assert.equal(detail.assignments[0].explanation.mode,'unassigned');});
await check('Unique consecutive references under concurrency',async()=>{const all=await Promise.all(Array.from({length:20},()=>add()));assert.equal(new Set(all.map(r=>r.reference)).size,20);assert.deepEqual(all.map(r=>Number(r.reference.slice(2))).sort((a,b)=>a-b),Array.from({length:20},(_,i)=>i+2));});
await check('Concurrent retries return one enquiry and one reference',async()=>{const body=payload(),key=randomUUID();const all=await Promise.all(Array.from({length:8},()=>add(body,key)));assert.equal(new Set(all.map(r=>r.leadId)).size,1);assert.equal(new Set(all.map(r=>r.reference)).size,1);await req(base+'/intake-events',{body:{...body,title:'Changed'},key,expected:409});});
await check('Source-specific channels and enquiry types validated',async()=>{await req(base+'/intake-events',{body:{...payload(),source:'referral',channel:'whatsapp'},key:randomUUID(),expected:422});await req(base+'/intake-events',{body:{...payload(),serviceType:'random_service'},key:randomUUID(),expected:422});});
await check('All configured source/channel and enquiry type options accepted',async()=>{const choices=await req(base+'/lead-options');assert.ok(choices.enquiryTypes.length>=1);for(const source of choices.sources)for(const channel of choices.channels[source.id])await add({...payload(),source:source.id,channel:channel.id});for(const type of choices.enquiryTypes)await add({...payload(),serviceType:type.id});});
await check('Manual assignment is saved with the lead',async()=>{const result=await add({...payload(),assignment:{mode:'manual',ownerMembershipId:ownerId,queueId:queue.id}});const lead=await req(base+`/leads/${result.leadId}`);assert.equal(lead.ownerMembershipId,ownerId);assert.equal(lead.assignments.length,1);assert.equal(lead.assignments[0].assignmentMethod,'manual');});
await check('Automatic routing is saved with the lead',async()=>{const result=await add({...payload(),assignment:{mode:'automatic'}});const lead=await req(base+`/leads/${result.leadId}`);assert.equal(lead.ownerMembershipId,ownerId);assert.equal(lead.assignments[0].assignmentMethod,'automatic');});
await check('Unverified mobile duplicates require review across formatting',async()=>{const original={...payload(),party:{displayName:randomUUID(),mobile:'+971501234567'}};const a=await add(original);const b=await add({...payload(),party:{displayName:randomUUID(),phone:'+971 50 123 4567'}});assert.equal(b.status,'duplicate_candidate');const intake=await req(base+`/intake-events/${b.intakeEventId}`);const candidate=intake.candidates.find(c=>c.partyId===a.partyId);assert.ok(candidate);assert.equal(candidate.strength,'fuzzy');assert.ok(candidate.reasons.includes('unverified_phone'));const decision={decision:'attach',partyId:a.partyId,version:candidate.version,reason:'Confirmed same customer'};const resolved=await req(base+`/duplicate-candidates/${candidate.id}/review`,{body:decision});assert.equal(resolved.partyId,a.partyId);assert.ok(resolved.reference);assert.equal((await req(base+`/duplicate-candidates/${candidate.id}/review`,{body:decision})).reviewReplay,true);const final=await req(base+`/intake-events/${b.intakeEventId}`);assert.equal(final.resolutionType,'review_attach');assert.equal(final.resolvedPartyId,a.partyId);});
await check('Two simultaneous new enquiries with same mobile create one customer',async()=>{const mobile='+971509876543';const all=await Promise.all(Array.from({length:2},()=>add({...payload(),party:{displayName:randomUUID(),mobile}})));assert.equal(all.filter(r=>r.status==='ready').length,1);assert.equal(all.filter(r=>r.status==='duplicate_candidate').length,1);});
await check('Lead details edit preserves reference and version conflicts fail',async()=>{const detail=await req(base+`/leads/${first.leadId}`);const body={version:detail.version,title:'Villa project',summary:'New description',serviceType:'not_sure',party:{displayName:'Updated QA customer',email:'updated-'+run+'@example.com',mobile:'+971507778888',phone:'+97143211234',company:'QA company',jobPosition:'Manager'},details:{location:'Abu Dhabi',budgetRange:'not_sure'}};await req(base+`/leads/${first.leadId}/details`,{method:'PATCH',body});await req(base+`/leads/${first.leadId}/details`,{method:'PATCH',body,expected:409});const updated=await req(base+`/leads/${first.leadId}`);assert.equal(updated.enquiry.reference,'E-0001');assert.equal(updated.enquiry.primaryMobile,'+971507778888');assert.equal(updated.enquiry.primaryPhone,'+97143211234');assert.equal(updated.enquiry.details.contact.company,'QA company');assert.equal(updated.enquiry.title,'Villa project');});
await check('References are searchable',async()=>{const found=await req(base+'/leads?search=E-0001');assert.ok(found.data.some(l=>l.id===first.leadId));});
let form;
await check('Forms start as private drafts',async()=>{form=await req(base+'/lead-forms',{body:{}});assert.equal(form.status,'draft');await req('/public/crm/lead-forms/'+form.token,{headers:{},expected:404});});
await check('Publish preserves internal field privacy',async()=>{form=await req(base+'/lead-forms/'+form.id,{method:'PATCH',body:{version:form.version,action:'publish',draft:form.draft}});const pub=await req('/public/crm/lead-forms/'+form.token,{headers:{}});assert.equal(pub.source,undefined);assert.equal(pub.workspaceId,undefined);assert.ok(pub.questions.every(q=>q.field===undefined));});
let answered;
await check('Customer response creates and auto-routes lead; retries are safe',async()=>{const pub=await req('/public/crm/lead-forms/'+form.token,{headers:{}});const map={displayName:'Public '+randomUUID(),email:randomUUID()+'@example.com',mobile:'+971502224455',location:'Business Bay',serviceType:'not_sure',budgetRange:'not_sure',summary:'Please redesign my office'};const answers=Object.fromEntries(form.draft.questions.map(q=>[q.id,map[q.field]]));answered={requestId:randomUUID(),revision:pub.revision,answers,serviceConsent:true};await req('/public/crm/lead-forms/'+form.token,{headers:{},body:answered});await req('/public/crm/lead-forms/'+form.token,{headers:{},body:answered});const page=await req(base+'/lead-forms/'+form.id+'/responses');assert.equal(page.data.length,1);assert.ok(page.data[0].reference);const found=await req(base+'/leads?search='+page.data[0].reference);assert.equal(found.data[0].intakeMethod,'form');assert.equal(found.data[0].ownerMembershipId,ownerId);assert.equal(found.data[0].details.location,'Business Bay');});
await check('Draft edits do not affect the published form',async()=>{const pub=await req('/public/crm/lead-forms/'+form.token,{headers:{}});form=await req(base+'/lead-forms/'+form.id,{method:'PATCH',body:{version:form.version,draft:{...form.draft,title:'Changed draft'}}});const current=await req('/public/crm/lead-forms/'+form.token,{headers:{}});assert.equal(current.title,pub.title);assert.equal(current.revision,pub.revision);});
await check('Published forms require a name and a configurable contact method',async()=>{
 await req(base+'/lead-forms/'+form.id,{method:'PATCH',body:{version:form.version,action:'publish',draft:{...form.draft,questions:form.draft.questions.filter(q=>q.field!=='displayName')}},expected:400});
 await req(base+'/lead-forms/'+form.id,{method:'PATCH',body:{version:form.version,action:'publish',draft:{...form.draft,questions:form.draft.questions.map(q=>['email','mobile'].includes(q.field)?{...q,required:false}:q)}},expected:400});
});
await check('Email-only tenant forms publish and accept enquiries',async()=>{
 let emailForm=await req(base+'/lead-forms',{body:{}});
 const questions=emailForm.draft.questions.filter(q=>q.field!=='mobile').map(q=>q.field==='email'?{...q,required:true}:q);
 emailForm=await req(base+'/lead-forms/'+emailForm.id,{method:'PATCH',body:{version:emailForm.version,action:'publish',draft:{...emailForm.draft,questions}}});
 const pub=await req('/public/crm/lead-forms/'+emailForm.token,{headers:{}});
 const map={displayName:'Email customer',email:'email-only-'+run+'@example.com',location:'Dubai',serviceType:'not_sure',budgetRange:'not_sure',summary:''};
 const values=Object.fromEntries(emailForm.draft.questions.map(q=>[q.id,map[q.field]]));
 await req('/public/crm/lead-forms/'+emailForm.token,{headers:{},body:{requestId:randomUUID(),revision:pub.revision,answers:values,serviceConsent:true}});
});
await check('Paused forms reject submissions',async()=>{form=await req(base+'/lead-forms/'+form.id,{method:'PATCH',body:{version:form.version,action:'pause'}});await req('/public/crm/lead-forms/'+form.token,{headers:{},body:answered,expected:404});});
await check('Unauthenticated CRM access denied',async()=>{await req(base+'/leads',{headers:{},expected:401});await req(base+'/lead-forms',{headers:{},expected:401});});

await check('Cross-workspace leads, forms, options and reports denied',async()=>{
 await req('/me',{headers:outside});
 for(const path of ['/leads','/lead-options','/lead-forms','/reports/lead-flow']) await req(base+path,{headers:outside,expected:404});
 await req(base+'/lead-forms/'+form.id,{headers:outside,method:'PATCH',body:{version:form.version,action:'publish'},expected:404});
});
await check('Missing nested data and malformed contacts are rejected',async()=>{
 const missing=payload();delete missing.party;await req(base+'/intake-events',{body:missing,key:randomUUID(),expected:400});
 await req(base+'/intake-events',{body:{...payload(),party:{displayName:'Invalid',email:'broken'}},key:randomUUID(),expected:422});
});
await check('Editing cannot silently take a different customer contact',async()=>{
 const a=await add({...payload(),party:{displayName:randomUUID(),email:'reserved-'+run+'@example.com'}});
 const b=await req(base+`/leads/${first.leadId}`);
 await req(base+`/leads/${first.leadId}/details`,{method:'PATCH',body:{version:b.version,serviceType:b.enquiry.serviceType,party:{displayName:'QA customer',email:'reserved-'+run+'@example.com'},details:{}},expected:409});
 assert.equal((await req(base+`/leads/${a.leadId}`)).enquiry.primaryEmail,'reserved-'+run+'@example.com');
});
await check('Adding and editing notes updates lead freshness',async()=>{
 const before=await req(base+`/leads/${first.leadId}`);
 const note=await req(base+'/activities',{body:{leadId:first.leadId,partyId:first.partyId,type:'note',title:'Requirements call',description:'Client wants a full fit-out'}});
 const after=await req(base+`/leads/${first.leadId}`);assert.ok(Date.parse(after.updatedAt)>Date.parse(before.updatedAt));
 await req(base+`/activities/${note.id}`,{method:'PATCH',body:{version:note.version,description:'Confirmed furniture too'}});
 assert.ok((await req(base+`/leads/${first.leadId}`)).version>after.version);
});
await check('Reports reconcile groups, unassigned leads and processing counts',async()=>{
 let expected;
 for(const groupBy of ['source','mainSource','channel','owner','team','enquiryType','customerType','budget','intake','day','week','month']) {
  const report=await req(base+'/reports/lead-flow?groupBy='+groupBy);
  const total=report.rows.reduce((n,row)=>n+row.leads,0);expected??=total;assert.equal(total,expected);assert.ok(new Set(report.rows.map(row=>row.id)).size===report.rows.length);
  assert.ok(report.processing.some(row=>row.status==='ready'&&row.count>0));
 }
 await req(base+'/reports/lead-flow?groupBy=bad',{expected:400});
 await req(base+'/reports/lead-flow?from=2026-10-01&to=2026-09-01',{expected:400});
});
await check('Custom questions preserve readable answers and response pagination',async()=>{
 const questions=[...form.draft.questions,{id:'custom_materials',title:'Preferred materials',type:'checkboxes',field:'custom',description:'',required:true,options:[{id:'oak',label:'Oak'},{id:'stone',label:'Stone'}]}];
 form=await req(base+'/lead-forms/'+form.id,{method:'PATCH',body:{version:form.version,action:'publish',draft:{...form.draft,source:'company',channel:'walk_in',questions}}});
 const pub=await req('/public/crm/lead-forms/'+form.token,{headers:{}});
 const values=()=>Object.fromEntries(form.draft.questions.map(q=>[q.id,({displayName:randomUUID(),mobile:'+971'+String(Math.floor(500000000+Math.random()*90000000)),email:randomUUID()+'@example.com',location:'Dubai',serviceType:'not_sure',budgetRange:'not_sure',custom:['oak','stone']})[q.field]]));
 for(let i=0;i<5;i++)await req('/public/crm/lead-forms/'+form.token,{headers:{},body:{requestId:randomUUID(),revision:pub.revision,answers:values(),serviceConsent:true}});
 const firstPage=await req(base+'/lead-forms/'+form.id+'/responses?limit=2');assert.equal(firstPage.data.length,2);assert.ok(firstPage.nextCursor);assert.deepEqual(firstPage.data[0].answers.at(-1).value,['Oak','Stone']);
 const second=await req(base+'/lead-forms/'+form.id+'/responses?limit=2&cursor='+firstPage.nextCursor);assert.equal(second.data.length,2);assert.ok(second.data.every(row=>!firstPage.data.some(old=>old.id===row.id)));
 await req(base+'/lead-forms/'+form.id+'/responses?cursor=bad',{expected:400});
 const bad=values();bad.custom_materials=['unknown'];await req('/public/crm/lead-forms/'+form.token,{headers:{},body:{requestId:randomUUID(),revision:pub.revision,answers:bad,serviceConsent:true},expected:400});
 const good=values();await req('/public/crm/lead-forms/'+form.token,{headers:{},body:{requestId:randomUUID(),revision:'old-revision',answers:good,serviceConsent:true},expected:409});
 const report=await req(base+'/reports/lead-flow');assert.ok(report.walkIns.some(row=>row.intakeMethod==='form'&&row.leads>=5));assert.ok(report.walkIns.some(row=>row.intakeMethod==='manual'));
});
await check('Form limits normalize mobile formatting and retries conflict on changed answers',async()=>{
 const pub=await req('/public/crm/lead-forms/'+form.token,{headers:{}}),phone='+971509991111';
 const make=(mobile)=>Object.fromEntries(form.draft.questions.map(q=>[q.id,({displayName:randomUUID(),mobile,email:randomUUID()+'@example.com',location:'Dubai',serviceType:'not_sure',budgetRange:'not_sure',custom:['oak']})[q.field]]));
 for(let i=0;i<5;i++)await req('/public/crm/lead-forms/'+form.token,{headers:{},body:{requestId:randomUUID(),revision:pub.revision,answers:make(i%2?'+971 50 999 1111':phone),serviceConsent:true}});
 await req('/public/crm/lead-forms/'+form.token,{headers:{},body:{requestId:randomUUID(),revision:pub.revision,answers:make('971-50-999-1111'),serviceConsent:true},expected:429});
 const submitted={requestId:randomUUID(),revision:pub.revision,answers:make('+971508884444'),serviceConsent:true};await req('/public/crm/lead-forms/'+form.token,{headers:{},body:submitted});
 const nameId=form.draft.questions.find(q=>q.field==='displayName').id;
 await req('/public/crm/lead-forms/'+form.token,{headers:{},body:{...submitted,answers:{...submitted.answers,[nameId]:'Changed'}},expected:409});
});
await check('Automated enquiries validate classification and keep provider event identity',async()=>{
 const token=process.env.LEAD_FLOW_TEST_INTERNAL_TOKEN;if(!token)throw new Error('Set LEAD_FLOW_TEST_INTERNAL_TOKEN for the isolated API.');
 const path=`/internal/crm/workspaces/${wid}/intake-events`,headers={'x-wodana-internal-token':token};
 const choices=await req(base+'/lead-options'),channel=choices.channels.third_party[0].id;
 const body={...payload(),source:'third_party',channel,intakeMethod:'automated',externalEventId:randomUUID(),assignment:{mode:'automatic'}};
 const a=await req(path,{headers,body,key:randomUUID()}),b=await req(path,{headers,body,key:randomUUID()});assert.equal(a.leadId,b.leadId);
 const lead=await req(base+`/leads/${a.leadId}`);assert.equal(lead.enquiry.intakeMethod,'automated');assert.equal(lead.ownerMembershipId,ownerId);
 await req(path,{headers,body:{...body,externalEventId:randomUUID(),channel:'unlisted'},key:randomUUID(),expected:422});
});

await check('Governed options support new channels and customer types',async()=>{
 const choices=await req(base+'/lead-options');
 await req(base+'/taxonomies',{body:{code:'customer_type',name:'Customer types',options:[{code:'qa_customer',label:'QA customer',position:0}]}});
 await req(base+'/taxonomies',{body:{code:'lead_channel_company',name:'Company channels',options:[...choices.channels.company.map((option,position)=>({code:option.id,label:option.label,position})),{code:'new_channel',label:'New QA channel',position:choices.channels.company.length}]}});
 const created=await add({...payload(),channel:'new_channel',details:{location:'Dubai',customerType:'qa_customer'}});
 assert.equal((await req(base+`/leads/${created.leadId}`)).enquiry.details.customerType,'qa_customer');
});
await check('Archived options remain editable on existing enquiries, while new enquiries use active choices',async()=>{
 let taxonomy=await req(base+'/taxonomies',{body:{code:'enquiry_type',name:'Enquiry types',options:[{code:'not_sure',label:'Not Sure Yet',position:0},{code:'legacy_service',label:'Legacy service',position:1}]}});
 const legacy=await add({...payload(),serviceType:'legacy_service'});
 const prior=await req(base+`/leads/${legacy.leadId}`);
 taxonomy=await req(base+'/taxonomies/'+taxonomy.id,{method:'PATCH',body:{version:taxonomy.version,options:[{code:'not_sure',label:'Not Sure Yet',position:0}]}});
 await req(base+`/leads/${legacy.leadId}/details`,{method:'PATCH',body:{version:prior.version,serviceType:prior.enquiry.serviceType,party:{...prior.enquiry.details.contact,displayName:'Updated QA customer'},details:{location:'Dubai',internalField:'not_allowed'}} , expected:400});
 const editable={location:'Dubai',budgetRange:prior.enquiry.details.budgetRange};
 await req(base+`/leads/${legacy.leadId}/details`,{method:'PATCH',body:{version:prior.version,serviceType:prior.enquiry.serviceType,party:prior.enquiry.details.contact,details:editable}});
 await req(base+'/intake-events',{body:{...payload(),serviceType:'legacy_service'},key:randomUUID(),expected:422});
 await req(base+'/taxonomies/'+taxonomy.id,{method:'PATCH',body:{version:taxonomy.version,options:[]},expected:422});
});
if(process.env.LEAD_FLOW_TEST_RESULTS) fs.writeFileSync(process.env.LEAD_FLOW_TEST_RESULTS,JSON.stringify({workspaceId:wid,owner,ownerId,queueId:queue.id,first,form,results},null,2),{mode:0o600});
console.log(`${results.filter(r=>r.status==='passed').length}/${results.length} passed`);process.exitCode=results.some(r=>r.status==='failed')?1:0;
