// Run only against the disposable local database created for smoke-lead-flow.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
const require = createRequire(import.meta.url);
const dbUrl = new URL(process.env.LEAD_FLOW_TEST_DB || 'postgresql://localhost/invalid');
const api = process.env.LEAD_FLOW_TEST_API || 'http://127.0.0.1:8150/api/v1';
if (!['localhost', '127.0.0.1'].includes(dbUrl.hostname) || !/lead_flow/.test(dbUrl.pathname) || !['localhost', '127.0.0.1'].includes(new URL(api).hostname)) throw new Error('Use the isolated local lead_flow database and API.');
const fixture = JSON.parse(fs.readFileSync(process.env.LEAD_FLOW_TEST_RESULTS));
const { workspaceId: wid, owner, ownerId, first, form } = fixture;
const base = `/workspaces/${wid}/crm`, pool = new Pool({ connectionString: dbUrl.toString() });
async function req(path, { headers = owner, body, method = body ? 'POST' : 'GET', expected = method === 'POST' ? 201 : 200 } = {}) {
  const response = await fetch(api + path, { method, headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json(); assert.equal(response.status, expected, `${response.status}: ${JSON.stringify(data)}`); return data;
}
try {
  await assert.rejects(pool.query('UPDATE crm_enquiries SET reference=$1 WHERE workspace_id=$2 AND id=$3', ['E-changed', wid, first.enquiryId]), /cannot be changed/);
  console.log('PASS Permanent enquiry references cannot be changed');
  const counter = await pool.query('UPDATE crm_enquiry_counters SET last_value=greatest(last_value,9999) WHERE workspace_id=$1 RETURNING last_value', [wid]);
  const next = await req(base + '/intake-events', { body: { source: 'company', channel: 'call', intakeMethod: 'manual', serviceType: 'not_sure', party: { displayName: randomUUID() }, originalPayload: {}, assignment: { mode: 'unassigned' } } });
  assert.equal(next.reference, 'E-'+(Number(counter.rows[0].last_value)+1)); console.log('PASS Numbering grows beyond four digits without truncation');
  const outsider = Object.fromEntries(Object.entries(owner).map(([k, v]) => [k, v.replace('flow-owner', 'flow-outsider')]));
  const user = await pool.query('SELECT id FROM users WHERE primary_email=$1', [outsider['x-wodana-user-email']]);
  const membership = await pool.query("INSERT INTO workspace_memberships(workspace_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(workspace_id,user_id) DO UPDATE SET status='active' RETURNING id", [wid, user.rows[0].id]);
  await pool.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) SELECT $1,$2,id FROM roles WHERE workspace_id=$1 AND code='viewer' ON CONFLICT DO NOTHING", [wid, membership.rows[0].id]);
  const role = await pool.query("INSERT INTO roles(workspace_id,code,name) VALUES($1,'crm_qa_reader','CRM QA Reader') ON CONFLICT(workspace_id,code) DO UPDATE SET name=excluded.name RETURNING id",[wid]);
  await pool.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code='crm.leads.view' ON CONFLICT DO NOTHING",[wid,role.rows[0].id]);
  await pool.query('INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[wid,membership.rows[0].id,role.rows[0].id]);
  await req(base+'/leads',{headers:outsider});
  await req(base+'/lead-forms',{headers:outsider,body:{},expected:403});
  await req(base+`/leads/${first.leadId}/details`,{headers:outsider,method:'PATCH',body:{version:1,serviceType:'not_sure',party:{displayName:'Blocked'},details:{}},expected:403});
  console.log('PASS Viewer can read leads but cannot edit them or create forms');
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await client.query('SET LOCAL ROLE wodana_app');
    assert.equal((await client.query('SELECT id FROM crm_lead_forms')).rowCount, 0);
    await client.query("SELECT set_config('app.current_lead_form_token',$1,true)",[form.token]);
    const publicRows = await client.query('SELECT id FROM crm_lead_forms'); assert.equal(publicRows.rowCount, 1); assert.equal(publicRows.rows[0].id, form.id);
    await client.query("SELECT set_config('app.current_lead_form_token','',true),set_config('app.current_workspace_id',$1,true)",[wid]);
    assert.equal((await client.query('SELECT id FROM crm_enquiries WHERE workspace_id<>$1',[wid])).rowCount,0);
    assert.equal((await client.query('SELECT id FROM crm_lead_forms WHERE workspace_id<>$1',[wid])).rowCount,0);
    await client.query('ROLLBACK'); console.log('PASS Tenant row policies and anonymous single-form read isolation');
    await client.query('BEGIN'); await client.query("SELECT set_config('app.current_workspace_id',$1,true)",[wid]);
    const { CrmLeadsService } = require('../dist/crm/leads/crm-leads.service.js');
    const service = new CrmLeadsService();
    const before = await client.query('SELECT count(*)::int AS count FROM crm_assignment_history WHERE workspace_id=$1 AND lead_id=$2',[wid,first.leadId]);
    const unchanged = await service.autoAssignForAutomation(client,wid,first.leadId); assert.equal(unchanged.ownerMembershipId,null);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM crm_assignment_history WHERE workspace_id=$1 AND lead_id=$2',[wid,first.leadId])).rows[0].count,before.rows[0].count);
    await client.query('ROLLBACK'); console.log('PASS Delayed initial automation respects explicit unassigned selection');
  } finally { await client.query('ROLLBACK'); client.release(); }
} finally { await pool.end(); }
