/** Synthetic-only P01.1 database smoke. Caller creates/drops a disposable local DB. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { ensureJobForSource } from "../src/jobs/job-identity.store";
import { JobsService } from "../src/jobs/jobs.service";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const endpoint = new URL(connectionString);
const seedOnly = process.argv[2] === "--seed-only";
if (process.argv.length > (seedOnly ? 3 : 2)) throw new Error("Usage: smoke-job-identity [--seed-only]");
if (!(["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
  && endpoint.pathname.startsWith("/wodana_job_smoke_")))
  throw new Error("Job smoke requires a disposable local wodana_job_smoke_* database.");

async function main() {
  const client = new pg.Client({ connectionString, application_name: "wodana-job-identity-smoke" });
  const workspaceA = randomUUID();
  const workspaceB = randomUUID();
  const actorId = randomUUID();
  const partyA = randomUUID();
  const partyB = randomUUID();
  const membershipA = randomUUID();
  const membershipB = randomUUID();
  const enquiryA = randomUUID();
  const enquiryRepeat = randomUUID();
  const enquiryB = randomUUID();
  const leadA = randomUUID();
  const pipeline = randomUUID();
  const stage = randomUUID();
  const derivedOpportunity = randomUUID();
  const directOpportunity = randomUUID();
  const caseId = randomUUID();
  const projectId = randomUUID();
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Job Smoke Actor')`,
      [actorId, `job-smoke-${actorId}@example.test`],
    );
    await client.query(
      `INSERT INTO workspaces(id,name,slug,default_currency,created_by)
       VALUES($1,'Job Smoke A',$3,'AED',$2),($4,'Job Smoke B',$5,'AED',$2)`,
      [workspaceA, actorId, `job-smoke-a-${workspaceA}`, workspaceB, `job-smoke-b-${workspaceB}`],
    );
    await client.query(
      `INSERT INTO workspace_memberships(id,workspace_id,user_id,status)
       VALUES($1,$2,$3,'active'),($4,$5,$3,'active')`,
      [membershipA, workspaceA, actorId, membershipB, workspaceB],
    );
    await client.query(
      `INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name)
       VALUES($1,$2,'person','Synthetic Customer','synthetic customer'),
             ($3,$4,'person','Other Tenant','other tenant')`,
      [partyA, workspaceA, partyB, workspaceB],
    );
    const intakeIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, workspaceId] of [workspaceA, workspaceA, workspaceB].entries()) {
      await client.query(
        `INSERT INTO crm_intake_events(id,workspace_id,source,channel,intake_method,idempotency_key,payload_hash,original_payload,correlation_id,received_at)
         VALUES($1,$2,'synthetic','form','staff',$3,$4,'{}'::jsonb,$5,now())`,
        [intakeIds[index], workspaceId, `job-smoke-${index}-${actorId}`, "0".repeat(64), randomUUID()],
      );
    }
    for (const [index, id] of [enquiryA, enquiryRepeat, enquiryB].entries()) {
      const workspaceId = index === 2 ? workspaceB : workspaceA;
      await client.query(
        `INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at)
         VALUES($1,$2,$3,$4,$5,'synthetic','form',now())`,
        [id, workspaceId, intakeIds[index], index === 2 ? partyB : partyA, `Synthetic enquiry ${index + 1}`],
      );
    }
    await client.query(
      `INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id) VALUES($1,$2,$3,$4)`,
      [leadA, workspaceA, enquiryA, partyA],
    );
    await client.query(`INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'smoke','Smoke')`, [pipeline, workspaceA]);
    await client.query(`INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position) VALUES($1,$2,$3,'new','New',0)`, [stage, workspaceA, pipeline]);
    await client.query(
      `INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,title,
         conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
       VALUES($1,$2,$3,$4,$5,$6,'Derived opportunity','legacy',$7,'{}'::jsonb,$7,now())`,
      [derivedOpportunity, workspaceA, partyA, leadA, pipeline, stage, "0".repeat(64)],
    );
    await client.query(
      `INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,title)
       VALUES($1,$2,$3,NULL,$4,$5,'Direct opportunity')`,
      [directOpportunity, workspaceA, partyA, pipeline, stage],
    );
    await client.query(
      `INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)`,
      [caseId, workspaceA, derivedOpportunity, actorId],
    );
    await client.query(
      `INSERT INTO commercial_cases(workspace_id,case_id,content) VALUES($1,$2,$3::jsonb)`,
      [workspaceA, caseId, JSON.stringify({ quotes: [{ id: "quote-1" }] })],
    );
    await client.query(
      `INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by) VALUES($1,$2,$3,'Synthetic project',$4)`,
      [projectId, workspaceA, caseId, actorId],
    );

    if (seedOnly) {
      await client.query("COMMIT");
      process.stdout.write(`${workspaceA}\n`);
      return;
    }

    await client.query("SET LOCAL ROLE wodana_app");
    await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceA]);
    const first = await ensureJobForSource(client, workspaceA, { type: "project", id: projectId }, actorId);
    assert.match(first.reference, /^J-\d{6,}$/);
    assert.deepEqual(
      await ensureJobForSource(client, workspaceA, { type: "quote", id: "quote-1", caseId }, actorId),
      first,
    );
    assert.deepEqual(
      await ensureJobForSource(client, workspaceA, { type: "project", id: projectId }, actorId),
      first,
    );
    const repeat = await ensureJobForSource(client, workspaceA, { type: "enquiry", id: enquiryRepeat }, actorId);
    const direct = await ensureJobForSource(client, workspaceA, { type: "opportunity", id: directOpportunity }, actorId);
    assert.notEqual(first.id, repeat.id);
    assert.notEqual(first.id, direct.id);
    assert.notEqual(repeat.id, direct.id);
    const linked = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM job_identity_links WHERE workspace_id=$1 AND job_id=$2`,
      [workspaceA, first.id],
    );
    assert.equal(Number(linked.rows[0].count), 6);
    const events = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM job_identity_link_events WHERE workspace_id=$1 AND job_id=$2`,
      [workspaceA, first.id],
    );
    assert.equal(Number(events.rows[0].count), 6, "replay must not append duplicate link events");

    const permissions = new Set(["crm.leads.view", "crm.opportunities.view", "pre_projects.view", "projects.view", "projects.manage"]);
    const access = {
      withAnyPermission: async (_actor: unknown, _workspaceId: string, required: string[], work: Function) => {
        if (!required.some((permission) => permissions.has(permission))) throw new Error("Permission denied");
        return work(client, { userId: actorId });
      },
      withPermission: async (_actor: unknown, _workspaceId: string, required: string, work: Function) => {
        if (!permissions.has(required)) throw new Error("Permission denied");
        return work(client, { userId: actorId });
      },
      hasPermission: async (_client: unknown, _workspaceId: string, _userId: string, permission: string) => permissions.has(permission),
    };
    const jobs = new JobsService(access as never);
    const all = await jobs.list({} as never, workspaceA);
    assert.equal(all.total, 3);
    const full = await jobs.get({} as never, workspaceA, first.id);
    assert.equal(full.links.length, 6);
    assert.equal(full.title, "Synthetic project");
    assert.equal(full.customer?.name, "Synthetic Customer");
    assert.equal(full.missingSourceCount, 0);

    await client.query("RESET ROLE");
    await client.query(
      `UPDATE commercial_cases SET content=$3::jsonb WHERE workspace_id=$1 AND case_id=$2`,
      [workspaceA, caseId, JSON.stringify({ quotes: [{ id: "quote-1" }, { id: "quote-2" }] })],
    );
    await client.query("SET LOCAL ROLE wodana_app");
    permissions.add("jobs.repair");
    const repairRequestId = randomUUID();
    const repairInput = {
      recordType: "quote" as const, recordId: "quote-2", caseId,
      expectedVersion: 0, requestId: repairRequestId, reason: "Recover missing quote link",
    };
    permissions.clear();
    permissions.add("jobs.repair");
    await assert.rejects(jobs.repair({} as never, workspaceA, first.id, repairInput), /Source access is required/i);
    permissions.add("pre_projects.view");
    const repaired = await jobs.repair({} as never, workspaceA, first.id, repairInput);
    assert.equal(repaired.version, 1);
    assert.equal(repaired.repaired, true);
    const replay = await jobs.repair({} as never, workspaceA, first.id, repairInput);
    assert.equal(replay.repaired, false);
    await assert.rejects(
      jobs.repair({} as never, workspaceA, direct.id, { ...repairInput, requestId: randomUUID() }),
      /another Job/i,
    );
    const quoteLink = await client.query<{ id: string }>(
      `SELECT id FROM job_identity_links WHERE workspace_id=$1 AND source_key=$2`,
      [workspaceA, `quote:${caseId}:quote-2`],
    );
    await client.query("RESET ROLE");
    await client.query(
      `UPDATE job_identity_links SET status='detached',detached_at=now(),version=2
       WHERE workspace_id=$1 AND id=$2`, [workspaceA, quoteLink.rows[0].id],
    );
    await client.query(
      `INSERT INTO job_identity_link_events(workspace_id,link_id,job_id,event_type,link_version,actor_user_id,reason)
       VALUES($1,$2,$3,'detached',2,$4,'Synthetic reviewed detach')`,
      [workspaceA, quoteLink.rows[0].id, first.id, actorId],
    );
    await client.query(
      `UPDATE commercial_cases SET content=$3::jsonb WHERE workspace_id=$1 AND case_id=$2`,
      [workspaceA, caseId, JSON.stringify({ quotes: [{ id: "quote-1" }] })],
    );
    await client.query("SET LOCAL ROLE wodana_app");
    const repairView = await jobs.get({} as never, workspaceA, first.id);
    assert.equal(repairView.repairableLinkCount, 1);
    assert(repairView.links.some((link) => link.id === "quote-2" && link.sourceState === "detached" && link.version === 2));
    await assert.rejects(
      jobs.repair({} as never, workspaceA, first.id,
        { ...repairInput, expectedVersion: 2, requestId: randomUUID() }),
      /missing or ambiguous/i,
    );
    await client.query("RESET ROLE");
    await client.query(
      `UPDATE commercial_cases SET content=$3::jsonb WHERE workspace_id=$1 AND case_id=$2`,
      [workspaceA, caseId, JSON.stringify({ quotes: [{ id: "quote-1" }, { id: "quote-2" }] })],
    );
    await client.query("SET LOCAL ROLE wodana_app");
    await assert.rejects(
      jobs.repair({} as never, workspaceA, first.id,
        { ...repairInput, expectedVersion: 1, requestId: randomUUID() }),
      /changed/i,
    );
    const restored = await jobs.repair({} as never, workspaceA, first.id,
      { ...repairInput, expectedVersion: 2, requestId: randomUUID() });
    assert.equal(restored.version, 3);
    assert.equal(restored.repaired, true);

    permissions.clear();
    permissions.add("projects.view");
    assert.equal((await jobs.list({} as never, workspaceA)).total, 0,
      "project viewer without assignment must not discover the Job");
    await client.query("RESET ROLE");
    await client.query(
      `INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager)
       VALUES($1,$2,$3,false)`, [workspaceA, projectId, membershipA],
    );
    await client.query("SET LOCAL ROLE wodana_app");
    const projectOnly = await jobs.get({} as never, workspaceA, first.id);
    assert.deepEqual(projectOnly.links.map((link) => link.type), ["project"]);
    assert.equal(projectOnly.title, "Synthetic project");

    await assert.rejects(
      ensureJobForSource(client, workspaceA, { type: "enquiry", id: enquiryB }, actorId),
      /not found in this workspace/i,
    );
    const aCount = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM job_identities`);
    assert.equal(Number(aCount.rows[0].count), 3);
    await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceB]);
    const bCount = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM job_identities`);
    assert.equal(Number(bCount.rows[0].count), 0, "RLS must hide the other tenant's Jobs");
    await assert.rejects(jobs.get({} as never, workspaceB, first.id), /Job not found/i);
    await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceA]);
    await client.query("RESET ROLE");
    await client.query(
      `UPDATE commercial_cases SET content=$3::jsonb WHERE workspace_id=$1 AND case_id=$2`,
      [workspaceA, caseId, JSON.stringify({ quotes: [{ id: "quote-1" }] })],
    );
    await client.query("SET LOCAL ROLE wodana_app");
    permissions.clear();
    permissions.add("pre_projects.view");
    const missingQuote = await jobs.get({} as never, workspaceA, first.id);
    assert.equal(missingQuote.missingSourceCount, 1, "deleted quote source must be visibly missing");
    permissions.clear();
    permissions.add("crm.opportunities.view");
    await client.query("RESET ROLE");
    await client.query(`UPDATE crm_opportunities SET status='lost' WHERE workspace_id=$1 AND id=$2`, [workspaceA, directOpportunity]);
    await client.query("SET LOCAL ROLE wodana_app");
    assert.equal((await jobs.get({} as never, workspaceA, direct.id)).jobId, direct.id,
      "lost work must keep its Job identity");
    await client.query("RESET ROLE");
    await client.query(`UPDATE crm_opportunities SET status='open' WHERE workspace_id=$1 AND id=$2`, [workspaceA, directOpportunity]);
    await client.query("SET LOCAL ROLE wodana_app");
    assert.equal((await jobs.get({} as never, workspaceA, direct.id)).jobId, direct.id,
      "reopened work must keep its Job identity");
    await client.query("RESET ROLE");
    await client.query(`DELETE FROM crm_opportunities WHERE workspace_id=$1 AND id=$2`, [workspaceA, directOpportunity]);
    await client.query("SET LOCAL ROLE wodana_app");
    const deletedSource = await jobs.get({} as never, workspaceA, direct.id);
    assert.equal(deletedSource.title, null);
    assert.equal(deletedSource.missingSourceCount, 1, "source deletion must leave a repair-visible Job");
    permissions.clear();
    await assert.rejects(jobs.list({} as never, workspaceA), /Permission denied/);
    await client.query("ROLLBACK");
    process.stdout.write("Job identity smoke passed: replay, repeat work, direct sale, projection, reviewed repair, assignment, lost/reopen, missing sources and RLS.\n");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
