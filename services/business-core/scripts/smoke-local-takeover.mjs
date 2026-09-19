import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import dotenv from "dotenv";
import pg from "pg";
import { CrmLeadsService } from "../src/crm/leads/crm-leads.service.ts";
import { CrmEventsService } from "../src/crm/shared/crm-events.service.ts";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });
const base = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("Local database only");
base.pathname = "/wodana_preexecution_uat";
// The disposable QA database has not been granted to wodana_app; the local
// migration owner is used only inside this rollback-only fixture.
base.username = os.userInfo().username;
base.password = "";
const pool = new pg.Pool({ connectionString: base.toString() });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  const workspace = await client.query("SELECT id FROM workspaces WHERE slug='palm-local-qa' AND status='active'");
  assert.equal(workspace.rowCount, 1, "Expected the disposable Palm QA workspace");
  const workspaceId = workspace.rows[0].id;
  await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
  await client.query("SELECT set_config('app.current_actor_id',$1,true)", ["00000000-0000-0000-0000-000000000000"]);
  const source = await client.query(`SELECT id,owner_membership_id,queue_id FROM crm_leads
    WHERE workspace_id=$1 AND status IN ('new','attempting_contact')
      AND owner_membership_id IS NOT NULL AND queue_id IS NOT NULL
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [workspaceId]);
  assert.equal(source.rowCount, 1, "Expected one disposable assigned enquiry");
  const { id: leadId, owner_membership_id: originalOwner, queue_id: queueId } = source.rows[0];
  const suffix = randomUUID();
  const user = await client.query("INSERT INTO users(primary_email,display_name) VALUES($1,'Local QA alternate') RETURNING id", [`takeover-${suffix}@local.invalid`]);
  const alternateUserId = user.rows[0].id;
  const membership = await client.query("INSERT INTO workspace_memberships(workspace_id,user_id,status,joined_at) VALUES($1,$2,'active',now()) RETURNING id", [workspaceId, alternateUserId]);
  const alternateOwner = membership.rows[0].id;
  await client.query(`INSERT INTO crm_queue_members(workspace_id,queue_id,membership_id,capacity,weight,is_available,skills,languages,territories)
    VALUES($1,$2,$3,25,1,true,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)`, [workspaceId, queueId, alternateOwner]);
  await client.query("UPDATE crm_queues SET takeover_after_minutes=60 WHERE workspace_id=$1 AND id=$2", [workspaceId, queueId]);
  await client.query(`UPDATE crm_leads SET status='connected',ownership_due_at=now()-interval '1 minute',version=version+1
    WHERE workspace_id=$1 AND id=$2`, [workspaceId, leadId]);
  await client.query(`INSERT INTO crm_assignment_history(workspace_id,lead_id,previous_owner_membership_id,owner_membership_id,queue_id,assignment_method,explanation,reason,assigned_at)
    VALUES($1,$2,$3,$3,$4,'manual','{}'::jsonb,'Local rollback-only QA',now()-interval '61 minutes')`, [workspaceId, leadId, originalOwner, queueId]);

  const events = new CrmEventsService();
  const slas = { transferFirstResponseResponsibility: async () => null };
  const database = { tenantTransaction: async (id, _actor, work) => {
    assert.equal(id, workspaceId);
    return work(client);
  } };
  const service = new CrmLeadsService(database, {}, events, slas);
  const first = await service.processDueTakeoversInternal(workspaceId, 10);
  assert.deepEqual(first.reassigned, [{ leadId, ownerMembershipId: alternateOwner, queueId }]);
  const afterTransfer = await client.query("SELECT owner_membership_id,ownership_due_at FROM crm_leads WHERE workspace_id=$1 AND id=$2", [workspaceId, leadId]);
  assert.equal(afterTransfer.rows[0].owner_membership_id, alternateOwner);
  assert.ok(afterTransfer.rows[0].ownership_due_at > new Date());
  const alert = await client.query("SELECT 1 FROM notifications WHERE workspace_id=$1 AND recipient_id=$2 AND event_type='crm.lead.assigned' AND deep_link=$3 LIMIT 1", [workspaceId, alternateUserId, `/workspace/crm/leads?lead=${leadId}`]);
  assert.equal(alert.rowCount, 1, "Alternate owner must receive an in-app alert");

  await events.record(client, { workspaceId, actorUserId: alternateUserId, source: "user", action: "crm.lead.requirement_note_saved.v1",
    entityType: "crm_lead", entityId: leadId, after: { note: { archived: false, note: "Test follow-up logged" } } });
  await client.query("UPDATE crm_leads SET ownership_due_at=now()-interval '1 minute' WHERE workspace_id=$1 AND id=$2", [workspaceId, leadId]);
  const second = await service.processDueTakeoversInternal(workspaceId, 10);
  assert.deepEqual(second, { reassigned: [], engaged: [leadId] });
  const afterNote = await client.query("SELECT owner_membership_id,ownership_due_at FROM crm_leads WHERE workspace_id=$1 AND id=$2", [workspaceId, leadId]);
  assert.equal(afterNote.rows[0].owner_membership_id, alternateOwner);
  assert.equal(afterNote.rows[0].ownership_due_at, null);

  await client.query("DELETE FROM crm_queue_members WHERE workspace_id=$1 AND queue_id=$2 AND membership_id=$3", [workspaceId, queueId, alternateOwner]);
  await client.query(`UPDATE crm_leads SET owner_membership_id=$3,ownership_due_at=now()-interval '1 minute',version=version+1
    WHERE workspace_id=$1 AND id=$2`, [workspaceId, leadId, originalOwner]);
  await client.query(`INSERT INTO crm_assignment_history(workspace_id,lead_id,previous_owner_membership_id,owner_membership_id,queue_id,assignment_method,explanation,reason,assigned_at)
    VALUES($1,$2,$3,$3,$4,'manual','{}'::jsonb,'Local no-alternate QA',now()-interval '61 minutes')`, [workspaceId, leadId, originalOwner, queueId]);
  const third = await service.processDueTakeoversInternal(workspaceId, 10);
  assert.deepEqual(third.reassigned, [{ leadId, ownerMembershipId: null, queueId }]);
  const waiting = await client.query("SELECT owner_membership_id,queue_id,ownership_due_at FROM crm_leads WHERE workspace_id=$1 AND id=$2", [workspaceId, leadId]);
  assert.equal(waiting.rows[0].owner_membership_id, null);
  assert.equal(waiting.rows[0].queue_id, queueId);
  assert.equal(waiting.rows[0].ownership_due_at, null);
  process.stdout.write("Local takeover smoke passed: alternate owner, alert, note cancellation, and queue fallback; transaction rolled back.\n");
} finally {
  await client.query("ROLLBACK");
  client.release();
  await pool.end();
}
