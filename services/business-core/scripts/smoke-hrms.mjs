import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';

// This test only writes isolated, synthetic local data. Never point it at a shared database.
const api=process.env.HRMS_TEST_API??'http://127.0.0.1:8134/api/v1';
assert.equal(new URL(api).hostname,'127.0.0.1');
const db=new pg.Client({host:'127.0.0.1',user:process.env.USER,database:'codex_hrms_test_20260907'});await db.connect();
const run=randomUUID().slice(0,8);
const identity=name=>({'x-wodana-user-subject':`hrms-${name}-${run}`,'x-wodana-user-email':`hrms-${name}-${run}@example.com`,'x-wodana-user-name':name});
const owner=identity('Owner'),staff=identity('Designer'),manager=identity('Manager'),other=identity('Other'),viewer=identity('Viewer'),outsider=identity('Outsider');
async function request(path,{body,method=body?'POST':'GET',headers=owner,expected=method==='POST'?201:200,raw=false}={}){
 const res=await fetch(`${api}${path}`,{method,headers:{...headers,...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined});const payload=raw?await res.text():await res.json().catch(()=>null);
 assert.equal(res.status,expected,`${method} ${path}: ${JSON.stringify(payload)}`);return payload;
}
const workspaceBody=name=>({name,slug:`hrms-${name.toLowerCase()}-${run}`,defaultCurrency:'INR',defaultLocale:'en-IN',defaultTimezone:'Asia/Kolkata',unitSystem:'metric',weekStartsOn:1,firstLegalEntity:{code:'STUDIO',displayName:name,registeredName:name,countryCode:'IN',baseCurrency:'INR',locale:'en-IN',timezone:'Asia/Kolkata'}});
try{
 const created=await request('/workspaces',{body:workspaceBody('Test')});const w=created.workspace.id;const root=`/workspaces/${w}/hrms`;const projects=`/workspaces/${w}/projects`;
 const own=(await request(`/workspaces/${w}/members`)).find(m=>m.roles.includes('owner'));
 async function member(headers,role='member'){
  await request('/me',{headers});const user=(await db.query('SELECT id FROM users WHERE primary_email=$1',[headers['x-wodana-user-email']])).rows[0];
  const id=randomUUID();await db.query(`INSERT INTO workspace_memberships(id,workspace_id,user_id,status,joined_at) VALUES($1,$2,$3,'active',now())`,[id,w,user.id]);
  const roleId=(await db.query('SELECT id FROM roles WHERE workspace_id=$1 AND code=$2',[w,role])).rows[0].id;
  await db.query('INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)',[w,id,roleId]);return id;
 }
 const staffId=await member(staff),managerId=await member(manager),otherId=await member(other);await member(viewer,'viewer');
 const managerRole=randomUUID();await db.query(`INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,'hr-reviewer','HR reviewer',false)`,[managerRole,w]);await db.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code IN ('hrms.team','hrms.evidence')`,[w,managerRole]);await db.query(`INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)`,[w,managerId,managerRole]);
 await request(`${root}/bootstrap`,{headers:viewer,expected:403});
 const calendar=await request(`${root}/calendars`,{body:{name:'Six-day studio',timezone:'Asia/Kolkata',workingDays:[1,2,3,4,5,6],holidays:['2027-01-05'],dayStart:'09:00',halfDay:'13:00',dayEnd:'18:00'}});
 await request(`${root}/settings`,{method:'PUT',body:{version:0,defaultCalendarId:calendar.id,fallbackApproverId:own.id}});
 for(const [id,reporting] of [[own.id,null],[managerId,own.id],[staffId,managerId],[otherId,own.id]])await request(`${root}/people/${id}`,{method:'PUT',body:{version:0,calendarId:calendar.id,managerId:reporting,activeFrom:'2020-01-01',enabled:true,remoteAllowed:false,employeeCode:id.slice(0,8),designation:'Staff',department:'Design'}});
 const boot=await request(`${root}/bootstrap`,{headers:staff});assert.equal(boot.employee.membershipId,staffId);assert.equal(boot.permissions.self,true);assert.equal(boot.permissions.manage,false);
 assert.deepEqual((await request(`${root}/people`,{headers:manager})).map(p=>p.membershipId),[staffId]);await request(`${root}/people`,{headers:staff,expected:403});
 const office=await request(`${projects}/locations`,{method:'PUT',body:{version:0,name:'Studio',kind:'office',latitude:12.9716,longitude:77.5946,radiusM:150}});
 const image=await sharp({create:{width:24,height:24,channels:3,background:'#aabbcc'}}).jpeg().toBuffer();
 async function capture(headers=staff){const id=randomUUID();await request(`${root}/captures`,{headers,body:{id}});const form=new FormData();form.append('photo',new Blob([image],{type:'image/jpeg'}),'camera.jpg');await request(`${root}/captures/${id}/photo`,{method:'PUT',headers,body:form});return id;}
 async function payload(kind,current=null,extra={}){return {actionId:randomUUID(),captureId:await capture(),kind,mode:'office',locationId:office.id,deviceAt:new Date().toISOString(),position:{latitude:12.9716,longitude:77.5946,accuracyM:5,capturedAt:new Date().toISOString(),mock:false},...(current?{expectedSessionId:current.id,expectedVersion:current.version}:{}),...extra};}
 const firstInput=await payload('check_in');
 const [in1,replay]=await Promise.all([request(`${root}/attendance/actions`,{headers:staff,body:firstInput}),request(`${root}/attendance/actions`,{headers:staff,body:firstInput})]);assert.equal(in1.event.id,replay.event.id);
 await request(`${root}/attendance/actions`,{headers:staff,body:{...firstInput,note:'Changed retry'},expected:409});
 await request(`${root}/attendance/actions`,{headers:staff,body:await payload('check_in'),expected:409});
 await request(`${root}/captures/${firstInput.captureId}/photo`,{headers:other,expected:403});
 const out1=await request(`${root}/attendance/actions`,{headers:staff,body:await payload('check_out',in1.current)});
 const date=new Date(Date.now()-2*86400000).toISOString().slice(0,10);const at=hour=>`${date}T${hour}:00:00+05:30`;
 async function correct(sessionId,eventId,requestedAt,expected=201){const review=await request(`${root}/reviews`,{headers:staff,body:{actionId:randomUUID(),kind:'correction',sessionId,eventId,requestedAt,reason:'Correct recorded time for test'}});await request(`${root}/reviews/${review.id}/decision`,{headers:staff,body:{decision:'approve',reason:'Own request'},expected:403});return request(`${root}/reviews/${review.id}/decision`,{headers:manager,body:{decision:'approve',reason:'Verified attendance correction'},expected});}
 await correct(in1.current.id,in1.event.id,at('09'));await correct(in1.current.id,out1.event.id,at('12'));
 const in2=await request(`${root}/attendance/actions`,{headers:staff,body:await payload('check_in')});const out2=await request(`${root}/attendance/actions`,{headers:staff,body:await payload('check_out',in2.current)});
 await correct(in2.current.id,in2.event.id,at('13'));await correct(in2.current.id,out2.event.id,at('17'));
 let history=await request(`${root}/attendance/history?from=${date}&to=${date}`,{headers:staff});assert.equal(history.days[0].workedMinutes,420);assert.equal(history.sessions.length,2);
 const csv=await request(`${root}/attendance/export?from=${date}&to=${date}`,{headers:staff,raw:true});assert.match(csv,/"420"/);
 await correct(in1.current.id,in1.event.id,at('10'));history=await request(`${root}/attendance/history?from=${date}&to=${date}`,{headers:staff});assert.equal(history.days[0].workedMinutes,360);assert.notEqual(history.events.find(e=>e.id===in1.event.id).effectiveAt,history.events.find(e=>e.id===in1.event.id).originalAt);
 await correct(in1.current.id,out1.event.id,at('14'),409);
 await request(`${root}/attendance/history?from=${date}&to=${date}&scope=team&membershipId=${otherId}`,{headers:manager,expected:403});
 console.log('PASS: self-service, scoped access, photos, idempotency, multiple sessions, corrections and matching CSV');
 // Verify pre-project/project ownership using real source records in this isolated fixture.
 const pipeline=await request(`/workspaces/${w}/crm/pipelines`,{body:{code:`hrms-${run}`,name:'HRMS test pipeline',isDefault:true,stages:[{code:'ready',name:'Ready',position:1,probability:100,forecastCategory:'pipeline',entryRequirements:{}}]}});
 const party=await request(`/workspaces/${w}/crm/parties`,{body:{type:'person',displayName:'HRMS client',givenName:'HRMS',familyName:'Client'}});
 const opportunity=randomUUID(),caseId=randomUUID();await db.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,status,owner_membership_id) VALUES($1,$2,$3,$4,$5,'Villa project','won',$6)`,[opportunity,w,party.id,pipeline.id,pipeline.stages[0].id,managerId]);await db.query(`INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)`,[caseId,w,opportunity,created.membership?.userId??(await db.query('SELECT user_id FROM workspace_memberships WHERE id=$1',[own.id])).rows[0].user_id]);
 await request(`${projects}/assignments`,{method:'PUT',body:{caseId,membershipId:staffId,isManager:false,active:true}});
 const site=await request(`${projects}/locations`,{method:'PUT',body:{version:0,name:'Villa site',kind:'site',caseId,latitude:12.9716,longitude:77.5946,radiusM:150}});
 // A project identity for attendance; projects themselves start from an accepted quotation (project-core).
 const project=(await db.query(`INSERT INTO delivery_projects(workspace_id,case_id,name,created_by) SELECT $1,$2,'Villa project',user_id FROM workspace_memberships WHERE id=$3 RETURNING id`,[w,caseId,managerId])).rows[0];
 await db.query(`INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager,active) SELECT workspace_id,$3,membership_id,is_manager,active FROM project_assignments WHERE workspace_id=$1 AND case_id=$2`,[w,caseId,project.id]);
 await db.query(`UPDATE work_locations SET project_id=$3,case_id=NULL,version=version+1 WHERE workspace_id=$1 AND case_id=$2`,[w,caseId,project.id]);
 assert.equal((await request(`${projects}/locations`,{headers:staff})).find(l=>l.id===site.id).projectId,project.id);
 const projectIn=await request(`${root}/attendance/actions`,{headers:staff,body:await payload('check_in',null,{mode:'site',locationId:site.id,projectId:project.id})});
 const switched=await request(`${root}/attendance/actions`,{headers:staff,body:await payload('switch',projectIn.current,{mode:'field',locationId:null,projectId:null})});assert.equal(switched.current.segments.length,2);
 const back=await request(`${root}/attendance/actions`,{headers:staff,body:await payload('switch',switched.current,{mode:'site',locationId:site.id,projectId:project.id})});
 const outside=await payload('check_out',back.current,{position:{latitude:14,longitude:78,accuracyM:5,capturedAt:new Date().toISOString(),mock:false}});await request(`${root}/attendance/actions`,{headers:staff,body:outside,expected:400});
 const checkedOut=await request(`${root}/attendance/actions`,{headers:staff,body:{...outside,exceptionReason:'Left the site before checkout'}});assert.equal(checkedOut.current,null);assert.equal(checkedOut.event.evidence.verification,'pending_review');
 const exceptions=await request(`${root}/reviews?scope=team`,{headers:manager});const pending=exceptions.find(r=>r.eventId===checkedOut.event.id);await request(`${root}/reviews/${pending.id}/decision`,{headers:manager,body:{decision:'approve',reason:'Departure confirmed by supervisor'}});
 const siteDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
 await request(`${projects}/attendance?projectId=${project.id}&from=${siteDate}&to=${siteDate}`,{headers:other,expected:403});
 await request(`${projects}/assignments`,{method:'PUT',body:{projectId:project.id,membershipId:staffId,isManager:true,active:true}});
 assert.equal((await request(projects,{headers:staff})).find(p=>p.id===project.id).canViewAttendance,true);
 const facts=await request(`${projects}/attendance?projectId=${project.id}&from=${siteDate}&to=${siteDate}`,{headers:staff});assert.equal(facts.length,2);assert.ok(facts.every(r=>!('evidence' in r)&&!('captureId' in r)&&!('leaveDays' in r)));
 const delayed=await payload('check_in',null,{deviceAt:new Date(Date.now()-10*60*1000).toISOString()});
 await request(`${root}/attendance/actions`,{headers:staff,body:delayed,expected:400});
 const recovered=await request(`${root}/attendance/actions`,{headers:staff,body:{...delayed,exceptionReason:'Connection lost before submission; please review delayed capture'}});assert.equal(recovered.event.evidence.verification,'pending_review');
 await request(`${root}/attendance/actions`,{headers:staff,body:await payload('check_out',recovered.current)});
 console.log('PASS: real project release, assignment transfer, site/field transitions and outside-site checkout review');
 const type=await request(`${root}/leave/types`,{method:'PUT',body:{version:0,name:'Casual leave',annualDays:12,allowHalfDay:true,active:true}});
 const makeLeave=(part,actionId=randomUUID())=>({actionId,leaveTypeId:type.id,startDate:'2027-01-04',endDate:'2027-01-04',dayPart:part,reason:'Personal appointment'});
 const leaveInput=makeLeave('first_half');const leave=await request(`${root}/leave/requests`,{headers:staff,body:leaveInput});assert.equal((await request(`${root}/leave/requests`,{headers:staff,body:leaveInput})).id,leave.id);
 await request(`${root}/leave/requests`,{headers:staff,body:makeLeave('first_half'),expected:409});const secondHalf=await request(`${root}/leave/requests`,{headers:staff,body:makeLeave('second_half')});
 let balance=(await request(`${root}/leave/balances?year=2027`,{headers:staff}))[0];assert.equal(balance.pending,1);
 await request(`${root}/leave/requests/${leave.id}/decision`,{headers:other,body:{decision:'approve',reason:'Not my employee'},expected:403});await request(`${root}/leave/requests/${leave.id}/decision`,{headers:manager,body:{decision:'approve',reason:'Leave approved'}});
 await request(`${root}/leave/requests/${secondHalf.id}/cancel`,{headers:staff,body:{reason:'Appointment changed'}});
 await request(`${root}/leave/requests/${leave.id}/cancel`,{headers:staff,body:{reason:'Appointment cancelled'}});await request(`${root}/leave/requests/${leave.id}/decision`,{headers:manager,body:{decision:'approve',reason:'Cancellation approved'}});
 balance=(await request(`${root}/leave/balances?year=2027`,{headers:staff}))[0];assert.equal(balance.used,0);assert.equal(balance.pending,0);assert.equal(balance.available,12);
 await request(`${root}/leave/requests`,{headers:staff,body:{...makeLeave('full'),startDate:'2027-01-05',endDate:'2027-01-05'},expected:400});
 const crossing=await request(`${root}/leave/requests`,{headers:staff,body:{...makeLeave('full'),startDate:'2026-12-31',endDate:'2027-01-02'}});assert.ok(crossing.id);assert.equal((await request(`${root}/leave/balances?year=2026`,{headers:staff}))[0].pending,1);assert.equal((await request(`${root}/leave/balances?year=2027`,{headers:staff}))[0].pending,2);
 console.log('PASS: half days, overlaps, holidays, year-split balances, cancellation and independent approval');
 const foreign=await request('/workspaces',{headers:outsider,body:workspaceBody('Foreign')});await request(`${root}/bootstrap`,{headers:outsider,expected:404});await request(`/workspaces/${foreign.workspace.id}/hrms/captures/${firstInput.captureId}/photo`,{headers:outsider,expected:404});
 await db.query('BEGIN');await db.query('SET LOCAL ROLE wodana_app');await db.query("SELECT set_config('app.current_workspace_id',$1,true)",[foreign.workspace.id]);assert.equal((await db.query('SELECT id FROM hrms_sessions WHERE workspace_id=$1',[w])).rowCount,0);await db.query('ROLLBACK');
 await assert.rejects(db.query('UPDATE hrms_attendance_events SET note=$2 WHERE id=$1',[in1.event.id,'tampered']),/immutable/);
 console.log('PASS: cross-workspace RLS and immutable evidence');
 console.log('HRMS HTTP/database acceptance checks passed.');
}finally{await db.end();}
