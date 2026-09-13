/** First-release import into an EMPTY isolated database; never modifies the legacy database.
 * Usage: LEGACY_IDENTITY_FILE=... RELEASE_DATABASE_CONFIG=... node scripts/migrate-iglo-release.mjs
 * Configuration files contain credentials and must be private. No passwords are logged.
 */
import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';

const legacy = JSON.parse(fs.readFileSync(process.env.LEGACY_IDENTITY_FILE, 'utf8'));
const config = JSON.parse(fs.readFileSync(process.env.RELEASE_DATABASE_CONFIG, 'utf8'));
if (config.database !== 'wodana_release') throw Error('Only the isolated release database is supported.');
const org = legacy.organizations.find(o => o.slug === 'iglo');
if (!org || legacy.organizations.length !== 1) throw Error('Expected exactly the reviewed Iglo tenant.');
const owner = legacy.users.find(u => u.email === 'owner@iglo.design' && u.is_active);
if (!owner) throw Error('Existing active Iglo owner is required.');
const db = new pg.Client({host:'127.0.0.1',port:Number(process.env.RELEASE_DATABASE_PORT ?? 15439),database:config.database,user:config.owner,password:config.ownerPassword});
const source = new pg.Client({host:'127.0.0.1',user:process.env.USER,database:'wodana'});
await db.connect(); await source.connect();
const w = org.id;
const now = new Date().toISOString();
const expected = createHash('sha256').update(JSON.stringify(legacy.users.map(u=>[u.id,u.email,u.hashed_password,u.is_active]).sort())).digest('hex');
try {
 await db.query('BEGIN');
 if (Number((await db.query('SELECT count(*) FROM users')).rows[0].count)) throw Error('Release database is not empty; refusing to replace identities.');
 for (const u of legacy.users) {
  if (!/^\$2[aby]\$(0[4-9]|1[0-6])\$[./A-Za-z0-9]{53}$/.test(u.hashed_password)) throw Error(`Unsupported password encoding for user ${u.id}`);
  await db.query(`INSERT INTO users(id,primary_email,display_name,preferred_locale,preferred_timezone,status,created_at,updated_at) VALUES($1,$2,$3,'en-AE','Asia/Dubai',$4,$5,$6)`,[u.id,u.email,u.full_name,u.is_active?'active':'suspended',u.created_at,u.updated_at]);
  await db.query(`INSERT INTO local_auth_credentials(user_id,password_hash,password_salt) VALUES($1,$2,'legacy-bcrypt')`,[u.id,u.hashed_password]);
  await db.query(`INSERT INTO user_identities(user_id,provider,provider_subject,email_at_provider,metadata) VALUES($1,'local',$2,$3,$4)`,[u.id,`local:${u.id}`,u.email,JSON.stringify({migration:'legacy-iglo-20260907',legacyRole:u.role,phone:u.phone,avatarUrl:u.avatar_url})]);
  if(u.is_platform_admin) await db.query(`INSERT INTO platform_administrators(user_id,status) VALUES($1,$2)`,[u.id,u.is_active?'active':'suspended']);
 }
 await db.query(`INSERT INTO workspaces(id,name,slug,status,default_currency,default_locale,default_timezone,unit_system,created_by) VALUES($1,'Iglo Architects','iglo',$2,'AED','en-AE','Asia/Dubai','metric',$3)`,[w,org.is_active?'active':'suspended',owner.id]);
 await db.query(`INSERT INTO tenant_login_branding(workspace_id,login_slug,display_name) VALUES($1,'iglo','Iglo Architects')`,[w]);
 await db.query(`INSERT INTO workspace_subscriptions(workspace_id,plan_code,status,billing_cycle,amount,currency,seat_limit,project_limit,note,updated_by) VALUES($1,'enterprise','active','custom',0,'AED',$2,$3,'Sales demonstration workspace; no external billing subscription created.',$4)`,[w,Math.max(org.max_users??50,legacy.users.length),Math.max(org.max_projects??100,100),owner.id]);
 await db.query(`INSERT INTO workspace_onboarding(workspace_id,status,completed_steps,completed_at) VALUES($1,'completed',$2,now())`,[w,JSON.stringify(['company','regional','team'])]);
 const legal=randomUUID();
 await db.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone,address) VALUES($1,$2,'IGLO','Iglo Architects','Iglo Architects','AE','AED','en-AE','Asia/Dubai',$3)`,[legal,w,JSON.stringify({city:'Dubai',country:'United Arab Emirates'})]);
 for(const [code,name,type] of [['INTERIORS','Interior design & fit-out','division'],['FACTORY','Joinery workshop','department'],['SITE','Site delivery','department']]) await db.query(`INSERT INTO business_units(workspace_id,legal_entity_id,code,name,type,timezone) VALUES($1,$2,$3,$4,$5,'Asia/Dubai')`,[w,legal,code,name,type]);
 for(const [type,prefix] of [['quotation','IGL-QT'],['invoice','IGL-INV'],['purchase_order','IGL-PO'],['project','IGL-PRJ']]) await db.query(`INSERT INTO document_sequences(workspace_id,legal_entity_id,document_type,prefix) VALUES($1,$2,$3,$4)`,[w,legal,type,prefix]);
 await db.query(`INSERT INTO tax_profiles(workspace_id,legal_entity_id,name,jurisdiction_code,scheme,prices_include_tax,effective_from) VALUES($1,$2,'UAE VAT','AE','VAT',false,'2026-09-07')`,[w,legal]);
 const permissions=(await db.query('SELECT id,code FROM permissions')).rows;
 const read=c=>c.endsWith('.view')||c.endsWith('.read')||c==='hrms.self';
 const rules={
  owner:()=>true,administrator:()=>true,
  operations_head:c=>!c.startsWith('workspace.roles')&&!c.startsWith('crm.privacy'),
  project_manager:c=>read(c)||/^(projects\.(manage|report|review)|pre_projects\.(edit|review_designs|verify_measurements)|crm.activities.manage)$/.test(c),
  site_manager:c=>['projects.view','projects.report','pre_projects.view','pre_projects.verify_measurements','catalog.view','hrms.self','hrms.team'].includes(c),
  designer:c=>['catalog.view','catalog.manage','pre_projects.view','pre_projects.edit','pre_projects.review_designs','pre_projects.verify_measurements','projects.view','hrms.self'].includes(c),
  procurement:c=>['projects.view','projects.buy','catalog.view','catalog.manage','pre_projects.view','integrations.view','hrms.self'].includes(c),
  accountant:c=>['projects.view','commercial.approve','finance.settings.manage','integrations.view','pre_projects.view','crm.opportunities.view','crm.opportunities.sensitive_values','hrms.self'].includes(c),
  sales_executive:c=>read(c)||/^crm\.(leads\.(manage|assign)|parties.manage|opportunities\.(manage|transition)|activities.manage|consent.manage|communications.send)$/.test(c)||['pre_projects.create','pre_projects.edit','portal.manage'].includes(c),
  client:()=>false,
 };
 const roleIds={};
 for(const [code,rule] of Object.entries(rules)) {
  const id=randomUUID();roleIds[code]=id;
  await db.query('INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,$3,$4,true)',[id,w,code,code.split('_').map(x=>x[0].toUpperCase()+x.slice(1)).join(' ')]);
  for(const p of permissions.filter(p=>rule(p.code))) await db.query('INSERT INTO role_permissions(workspace_id,role_id,permission_id) VALUES($1,$2,$3)',[w,id,p.id]);
 }
 for(const m of legacy.org_memberships) {
  if(m.org_id!==w)throw Error('Unexpected tenant membership');
  const code=m.user_id===owner.id?'owner':m.role==='SUPER_ADMIN'?'administrator':m.role.toLowerCase();
  if(!roleIds[code])throw Error(`Unmapped legacy role ${m.role}`);
  await db.query(`INSERT INTO workspace_memberships(id,workspace_id,user_id,status,joined_at,created_at) VALUES($1,$2,$3,$4,$5,$5)`,[m.id,w,m.user_id,m.is_active?'active':'suspended',m.created_at]);
  await db.query('INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)',[w,m.id,roleIds[code]]);
 }
 // Preserve the current authored catalogs, excluding QA catalogs and foreign regional pricing.
 const sourceWorkspace='f81e8362-8d08-440a-89dd-06ec7a8b46e7';
 const groups=new Map([['5a83688b-fab6-45ae-b1f3-1c6fa6d6a160','Dubai materials & execution'],['1090fe8b-d861-51ca-aa53-9d387d0dc7f9','Rooms & joinery']]);
 let records=(await source.query('SELECT * FROM workspace_catalog_records WHERE workspace_id=$1 AND NOT archived AND (id=ANY($2::uuid[]) OR catalog_id=ANY($2::uuid[]))',[sourceWorkspace,[...groups.keys()]])).rows;
 records=records.filter(r=>!(/\b(QA|safeguards|xyz|dummy)\b/i.test(r.name)) && (r.kind!=='rate_zone'||/dubai/i.test(r.name)) && (r.kind!=='tax'||JSON.stringify(r.content).includes('AE')) && r.kind!=='rate_card');
 const ids=new Set(records.map(r=>r.id));
 records.sort((a,b)=>Number(b.kind==='catalog_group')-Number(a.kind==='catalog_group'));
 for(const r of records) {
  r.workspace_id=w;r.created_by=owner.id;r.updated_by=owner.id;
  if(groups.has(r.id)){r.name=groups.get(r.id);r.content.description='Technical catalog for Iglo interior design and fit-out. Project-specific AED prices are confirmed in the quotation.';r.content.market='AE';}
  if(Array.isArray(r.content.links))r.content.links=r.content.links.filter(l=>ids.has(l.targetId??l.id??l.recordId));
 }
 for(let offset=0;offset<records.length;offset+=250)await db.query('INSERT INTO workspace_catalog_records SELECT * FROM json_populate_recordset(NULL::workspace_catalog_records,$1::json)',[JSON.stringify(records.slice(offset,offset+250))]);
 const links=(await source.query('SELECT * FROM workspace_catalog_links WHERE workspace_id=$1',[sourceWorkspace])).rows.filter(l=>ids.has(l.record_id)&&ids.has(l.target_id)).map(l=>({...l,workspace_id:w}));
 for(let offset=0;offset<links.length;offset+=500)await db.query('INSERT INTO workspace_catalog_links SELECT * FROM json_populate_recordset(NULL::workspace_catalog_links,$1::json)',[JSON.stringify(links.slice(offset,offset+500))]);
 await db.query(`INSERT INTO client_portal_settings(workspace_id,slug,enabled,brand) VALUES($1,'iglo-architects',true,$2)`,[w,JSON.stringify({name:'Iglo Architects',logo:'',primaryColor:'#d9b4ed',accentColor:'#f69b60',layout:'soft',welcomeTitle:'Your space, coming together.',welcomeText:'Your designs, quotations and project updates, together in one place.',supportPhone:''})]);
 await db.query(`INSERT INTO audit_events(workspace_id,actor_user_id,source,action,entity_type,entity_id,after,correlation_id) VALUES($1,$2,'migration','release.identity_imported','workspace',$1,$3,$4)`,[w,owner.id,JSON.stringify({sourceTenantId:w,preservedUsers:legacy.users.length,identityFingerprint:expected,catalogRecords:records.length,region:'AE',release:'20260907'}),randomUUID()]);
 const imported=(await db.query('SELECT u.id,u.primary_email AS email,c.password_hash AS hashed_password,(u.status=\'active\') AS is_active FROM users u JOIN local_auth_credentials c ON c.user_id=u.id')).rows;
 const actual=createHash('sha256').update(JSON.stringify(imported.map(u=>[u.id,u.email,u.hashed_password,u.is_active]).sort())).digest('hex');
 if(actual!==expected)throw Error('Preserved identity fingerprint mismatch');
 await db.query('COMMIT');
 console.log(JSON.stringify({workspaceId:w,users:legacy.users.length,memberships:legacy.org_memberships.length,passwords:'preserved',catalogRecords:records.length,catalogLinks:links.length,region:'Dubai / AED / Asia-Dubai'}));
} catch(e){await db.query('ROLLBACK');throw e;} finally{await db.end();await source.end();}
