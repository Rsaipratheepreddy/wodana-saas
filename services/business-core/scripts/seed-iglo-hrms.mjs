/** Local, repeatable HRMS examples. No invitations, login credentials or fabricated photo/GPS evidence. */
import { createHash } from 'node:crypto';
import pg from 'pg';
import { addDays, fingerprint, leaveUnits, localDate, zonedInstant } from '../dist/hrms/hrms-domain.js';

const api = 'http://127.0.0.1:8131/api/v1';
if (process.env.NODE_ENV === 'production') throw new Error('This sample seed only supports the local wodana database.');
const login = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@igloarchitects.com', password: process.env.DEMO_PASSWORD ?? 'IgloDemo#2026', tenantSlug: 'iglo-architects' }) });
if (!login.ok) throw new Error(`Local demo sign-in failed (${login.status}).`);
const { accessToken } = await login.json();
async function read(path) {
  const response = await fetch(`${api}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
const profile = await read('/me');
const workspace = profile.memberships.find(m => m.workspaceSlug === 'iglo-architects');
if (!workspace) throw new Error('Local Iglo workspace is required.');
const w = workspace.workspaceId;
const db = new pg.Client({ host: '127.0.0.1', database: 'wodana', user: process.env.USER });
await db.connect();
const id = key => { const h = createHash('sha256').update(`iglo-hrms-demo-v1:${w}:${key}`).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
try {
  await db.query('BEGIN');
  await db.query("SELECT set_config('app.current_workspace_id',$1,true)", [w]);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`hrms-demo:${w}`]);
  const ws = (await db.query("SELECT id,default_timezone FROM workspaces WHERE id=$1 AND slug='iglo-architects'", [w])).rows[0];
  if (!ws) throw new Error('API and local database workspace do not match.');
  const owner = (await db.query(`SELECT m.id AS "membershipId",u.id AS "userId" FROM workspace_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.workspace_id=$1 AND u.primary_email='admin@igloarchitects.com' AND m.status='active'`, [w])).rows[0];
  if (!owner) throw new Error('Expected local administrator is missing.');
  const timezone = ws.default_timezone;
  const today = localDate(new Date(), timezone), year = Number(today.slice(0,4));
  const calendars = [
    { id: id('studio-calendar'), name: 'Demo · Studio calendar', timezone, workingDays: [1,2,3,4,5], holidays: [`${year}-12-24`], dayStart: '09:00', halfDay: '13:00', dayEnd: '18:00' },
    { id: id('site-calendar'), name: 'Demo · Site team calendar', timezone, workingDays: [1,2,3,4,5,6], holidays: [`${year}-12-24`], dayStart: '08:30', halfDay: '12:30', dayEnd: '17:30' },
  ];
  for (const c of calendars) await db.query(`INSERT INTO hrms_calendars(id,workspace_id,name,timezone,working_days,holidays,day_start,half_day,day_end)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`, [c.id,w,c.name,c.timezone,c.workingDays,c.holidays,c.dayStart,c.halfDay,c.dayEnd]);
  await db.query(`INSERT INTO hrms_settings(workspace_id,default_calendar_id,fallback_approver_id) VALUES($1,$2,$3) ON CONFLICT(workspace_id) DO NOTHING`, [w,calendars[0].id,owner.membershipId]);
  const people = [
    { key: 'aarav', name: 'Aarav Mehta · Demo', designation: 'Interior designer', department: 'Design studio', calendar: calendars[0] },
    { key: 'maya', name: 'Maya Rao · Demo', designation: 'Project designer', department: 'Design studio', calendar: calendars[0] },
    { key: 'neha', name: 'Neha Shah · Demo', designation: 'Site coordinator', department: 'Site operations', calendar: calendars[1] },
  ];
  for (const p of people) {
    p.userId = id(`${p.key}-user`); p.membershipId = id(`${p.key}-member`);
    await db.query(`INSERT INTO users(id,primary_email,display_name,preferred_timezone) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
      [p.userId,`hrms-demo-${p.key}@example.invalid`,p.name,timezone]);
    await db.query(`INSERT INTO workspace_memberships(id,workspace_id,user_id,status,joined_at) VALUES($1,$2,$3,'active',now()) ON CONFLICT(id) DO NOTHING`, [p.membershipId,w,p.userId]);
    await db.query(`INSERT INTO member_roles(workspace_id,membership_id,role_id) SELECT $1,$2,id FROM roles WHERE workspace_id=$1 AND code='member' ON CONFLICT DO NOTHING`, [w,p.membershipId]);
  }
  const members = [{ ...owner, key: 'administrator', designation: 'Workspace administrator', department: 'Studio management', calendar: calendars[0] }, ...people];
  for (const p of members) await db.query(`INSERT INTO hrms_employees(workspace_id,membership_id,employee_code,designation,department,manager_id,calendar_id,remote_allowed,active_from)
    VALUES($1,$2,$3,$4,$5,$6,$7,true,$8) ON CONFLICT(workspace_id,membership_id) DO NOTHING`,
    [w,p.membershipId,`DEMO-${p.key.toUpperCase()}`,p.designation,p.department,p.key==='administrator'?null:owner.membershipId,p.calendar.id,`${year}-01-01`]);
  // Read actual saved calendars when an existing employee profile is present; never overwrite it.
  for (const p of members) {
    const saved = (await db.query(`SELECT c.id,c.name,c.timezone,c.working_days AS "workingDays",c.holidays,c.day_start::text AS "dayStart",c.half_day::text AS "halfDay",c.day_end::text AS "dayEnd"
      FROM hrms_employees e JOIN hrms_calendars c ON c.workspace_id=e.workspace_id AND c.id=e.calendar_id WHERE e.workspace_id=$1 AND e.membership_id=$2`, [w,p.membershipId])).rows[0];
    p.calendar = { ...saved, holidays: saved.holidays.map(day => typeof day==='string'?day:localDate(day,'UTC')) };
  }
  const locations = [{ id: id('office'), name: 'Demo · Design studio', kind: 'office', latitude: 25.2062, longitude: 55.2711, radiusM: 150,
    address: 'Sample studio location, Business Bay, Dubai — verify before live use', projectId: null, caseId: null }];
  const cases = (await db.query(`SELECT c.id,o.title FROM pre_project_cases c JOIN crm_opportunities o ON o.id=c.opportunity_id
    WHERE c.workspace_id=$1 ORDER BY c.created_at LIMIT 2`, [w])).rows;
  for (const [i,c] of cases.entries()) locations.push({ id:id(`site-${c.id}`), name:`Demo · ${c.title}`.slice(0,160), kind:'site',
    latitude:i===0?25.1124:25.2117,longitude:i===0?55.1390:55.2790,radiusM:200,address:'Sample site boundary — verify coordinates before live use',projectId:null,caseId:c.id,contextName:c.title });
  for (const l of locations) {
    await db.query(`INSERT INTO work_locations(id,workspace_id,name,kind,case_id,address,latitude,longitude,radius_m) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,
      [l.id,w,l.name,l.kind,l.caseId,l.address,l.latitude,l.longitude,l.radiusM]);
    if(l.caseId) for(const p of members) await db.query(`INSERT INTO project_assignments(id,workspace_id,case_id,membership_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [id(`assignment-${l.caseId}-${p.key}`),w,l.caseId,p.membershipId]);
  }
  const types = [{ key:'casual',name:'Casual / sick leave',days:12 },{ key:'earned',name:'Earned leave',days:18 },{ key:'personal',name:'Personal leave',days:5 }];
  for(const t of types) {
    const existing=(await db.query('SELECT id FROM hrms_leave_types WHERE workspace_id=$1 AND lower(name)=lower($2)',[w,t.name])).rows[0];
    t.id=existing?.id??id(`leave-type-${t.key}`);
    if(!existing) await db.query(`INSERT INTO hrms_leave_types(id,workspace_id,name,annual_days) VALUES($1,$2,$3,$4)`,[t.id,w,t.name,t.days]);
    for(const p of members) await db.query(`INSERT INTO hrms_leave_allowances(workspace_id,membership_id,leave_type_id,year,days) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[w,p.membershipId,t.id,year,t.days]);
  }
  const workingDate = (offset, calendar) => { let date=addDays(today,offset); while(!calendar.workingDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())||calendar.holidays.includes(date)) date=addDays(date,offset<0?-1:1); return date; };
  for(const [index,p] of members.entries()) {
    const examples = [
      {key:'past-casual',type:types[0],date:workingDate(-24-index*2,p.calendar),status:'approved',part:'full',reason:'Personal appointment'},
      {key:'past-earned',type:types[1],date:workingDate(-16-index*2,p.calendar),status:'approved',part:'full',reason:'Planned time off'},
      {key:'upcoming',type:types[index%3],date:workingDate(3+index*3,p.calendar),status:'pending',part:index%2?'full':'first_half',reason:index%2?'Family commitment':'Personal appointment'},
    ];
    for(const e of examples) {
      const units=leaveUnits(e.date,e.date,e.part,p.calendar), requestId=id(`leave-${p.key}-${e.key}`);
      const overlap=await db.query(`SELECT 1 FROM hrms_leave_requests WHERE workspace_id=$1 AND membership_id=$2 AND start_date<=$3 AND end_date>=$3 AND status IN ('pending','approved','cancellation_pending')`,[w,p.membershipId,e.date]);
      if(overlap.rowCount) continue;
      await db.query(`INSERT INTO hrms_leave_requests(id,workspace_id,membership_id,leave_type_id,action_id,request_hash,start_date,end_date,day_part,units,calendar_snapshot,reason,status,decided_by,decision_reason,decided_at)
        VALUES($1,$2,$3,$4,$1,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO NOTHING`,
        [requestId,w,p.membershipId,e.type.id,fingerprint(e),e.date,e.part,JSON.stringify(units),p.calendar,`[Demo] ${e.reason}`,e.status,
          e.status==='approved'?(p.key==='administrator'?people[0].userId:owner.userId):null,e.status==='approved'?'[Demo] Example approved request':null,e.status==='approved'?new Date():null]);
    }
    // Historical examples only. No open session is fabricated, and live attendance remains untouched.
    for(let day=0;day<3;day++) {
      const date=workingDate(-1-day*2,p.calendar), start=zonedInstant(date,day===1?'09:15':'09:00',p.calendar.timezone), end=zonedInstant(date,day===2?'17:00':'18:00',p.calendar.timezone);
      const sessionId=id(`session-${p.key}-${day}`), existing=await db.query('SELECT 1 FROM hrms_sessions WHERE id=$1',[sessionId]);
      if(existing.rowCount) continue;
      const overlap=await db.query(`SELECT 1 FROM hrms_sessions WHERE workspace_id=$1 AND membership_id=$2 AND tstzrange(started_at,ended_at,'[)') && tstzrange($3,$4,'[)')`,[w,p.membershipId,start,end]);
      if(overlap.rowCount) continue;
      const location=locations[(index+day)%locations.length], inId=id(`in-${sessionId}`),outId=id(`out-${sessionId}`);
      await db.query(`INSERT INTO hrms_sessions(id,workspace_id,membership_id,started_at,ended_at,calendar_snapshot,version) VALUES($1,$2,$3,$4,$5,$6,2)`,[sessionId,w,p.membershipId,start,end,p.calendar]);
      const evidence={position:null,location,arrival:{status:'missing',distanceM:null,accuracyM:null},departure:null,photoCaptured:false,issues:['Demo record: no camera or GPS evidence'],verification:'pending_review',exceptionReason:'[Demo] Historical sample; no real capture was taken.'};
      for(const [eventId,kind,at] of [[inId,'check_in',start],[outId,'check_out',end]]) await db.query(`INSERT INTO hrms_attendance_events(id,workspace_id,membership_id,session_id,action_id,request_hash,kind,occurred_at,device_at,evidence,note,recorded_by)
        VALUES($1,$2,$3,$4,$1,$5,$6,$7,$7,$8,$9,$10)`,[eventId,w,p.membershipId,sessionId,fingerprint({sample:true,eventId}),kind,at,evidence,'[Demo] Sample attendance for interface preview — no photo or GPS captured.',owner.userId]);
      await db.query(`INSERT INTO hrms_segments(id,workspace_id,session_id,mode,location_id,case_id,context_snapshot,started_at,ended_at,start_event_id,end_event_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[id(`segment-${sessionId}`),w,sessionId,location.kind==='site'?'site':'office',location.id,location.caseId,{name:`[Demo] ${location.contextName??'Studio design work'}`,location},start,end,inId,outId]);
      if(day===0) await db.query(`INSERT INTO hrms_reviews(id,workspace_id,membership_id,session_id,action_id,kind,event_id,reason) VALUES($1,$2,$3,$4,$1,'exception',$5,$6) ON CONFLICT(id) DO NOTHING`,
        [id(`review-${p.key}`),w,p.membershipId,sessionId,inId,'[Demo] Example site attendance review. This sample has no camera or GPS evidence.']);
    }
  }
  await db.query(`INSERT INTO audit_events(id,workspace_id,actor_user_id,source,action,entity_type,entity_id,"after",correlation_id)
    VALUES($1,$2,$3,'local_demo','hrms.demo_seed','workspace',$2,$4,$1) ON CONFLICT(id) DO NOTHING`,
    [id('audit'),w,owner.userId,{sample:true,version:1,script:'seed-iglo-hrms.mjs',note:'User-requested local UI sample. No invitations, credentials, photos or GPS captures.'}]);
  await db.query('COMMIT');
  const root=`/workspaces/${w}/hrms`, boot=await read(`${root}/bootstrap`), balances=await read(`${root}/leave/balances?scope=team&year=${year}`),requests=await read(`${root}/leave/requests?scope=team&year=${year}`),history=await read(`${root}/attendance/history?scope=team&from=${addDays(today,-30)}&to=${today}`);
  console.log(JSON.stringify({workspace:'Iglo Architects (local)',calendars:boot.calendars.length,people:(await read(`${root}/people`)).filter(p=>p.enabled).length,workplaces:(await read(`/workspaces/${w}/projects/locations`)).length,balances:balances.length,leaveRequests:requests.length,attendanceSessions:history.sessions.length,pendingReviews:(await read(`${root}/reviews?scope=team`)).filter(r=>r.status==='pending').length},null,2));
} catch(error) { await db.query('ROLLBACK'); throw error; } finally { await db.end(); }
