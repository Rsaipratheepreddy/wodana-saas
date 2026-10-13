import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CrmOpportunitiesService } from "./crm-opportunities.service";
import { loadFlowFacts } from "./flow-facts";
import { OpportunityFlowService } from "./opportunity-flow.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Ids = { workspaceId: string; opportunityId: string; actor: string; stage: Record<string, string>; opportunities: CrmOpportunitiesService; flow: OpportunityFlowService };

integration("the step-by-step pipeline (PLM-121/122)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withOpportunity(enquiryType: string, flow: string | null, work: (client: PoolClient, ids: Ids) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), actor = randomUUID(), partyId = randomUUID(), enquiryId = randomUUID(), leadId = randomUUID(), opportunityId = randomUUID(),
      pipelineId = randomUUID(), taxonomyId = randomUUID();
    const stage: Record<string, string> = Object.fromEntries(["qualified", "qualification", "proposal", "negotiation", "won", "lost"].map((code) => [code, randomUUID()]));
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'AM')", [actor, `am-${actor.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Flow',$2,'AED',$3)", [workspaceId, `flow-${workspaceId.slice(0, 8)}`, actor]);
      await client.query("INSERT INTO crm_taxonomies(id,workspace_id,code,name) VALUES($1,$2,'enquiry_type','Enquiry types')", [taxonomyId, workspaceId]);
      await client.query("INSERT INTO crm_taxonomy_options(workspace_id,taxonomy_id,code,label,flow) VALUES($1,$2,$3,'Type',$4),($1,$2,'not_sure','Not sure',NULL)", [workspaceId, taxonomyId, enquiryType === "not_sure" ? "other" : enquiryType, flow]);
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [pipelineId, workspaceId]);
      for (const [index, code] of Object.keys(stage).entries())
        await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position,probability) VALUES($1,$2,$3,$4,$4,$5,10)", [stage[code], workspaceId, pipelineId, code, index + 1]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya','maya')", [partyId, workspaceId]);
      await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
        VALUES($1,$2,$3,$4,'Sofa','referral','external',now(),'E-1',$5,'{"customerType":"end_user"}')`, [enquiryId, workspaceId, randomUUID(), partyId, enquiryType]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id) VALUES($1,$2,$3,$4)", [leadId, workspaceId, enquiryId, partyId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,title,reference,next_action_at,
          conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Sofa','O-1',now() + interval '1 day','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, partyId, leadId, pipelineId, stage.qualified]);
      await client.query("SET LOCAL session_replication_role = origin");
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: actor });
      const access = { withPermission: run, withPermissions: run, hasPermission: async () => true } as never;
      const events = { record: async () => undefined } as never;
      const opportunities = new CrmOpportunitiesService(access, events);
      const storage = { put: async () => undefined } as never;
      const flowService = new OpportunityFlowService(access, events, opportunities, storage, { missing: async () => [] } as never);
      await work(client, { workspaceId, opportunityId, actor, stage, opportunities, flow: flowService });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  const version = async (client: PoolClient, id: string) => Number((await client.query("SELECT version FROM crm_opportunities WHERE id = $1", [id])).rows[0].version);
  const png = { buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), originalname: "receipt.png", mimetype: "image/png", size: 68 };

  it("reads the flow from the enquiry type and refuses New Opportunity → Won without the work", async () => {
    await withOpportunity("furniture_only", "furniture", async (client, { workspaceId, opportunityId, stage, opportunities }) => {
      expect((await loadFlowFacts(client, workspaceId, opportunityId)).flow).toBe("furniture");
      const attempt = opportunities.transition(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), stageId: stage.won, status: "won", reason: "Paid" });
      await expect(attempt).rejects.toMatchObject({ response: { message: "Stage requirements are not met", missing: [
        { key: "furniturePath", label: "Furniture sub-path chosen" }, { key: "quotation", label: "Quotation prepared" }, { key: "paymentProof", label: "Payment proof attached" },
      ] } });
    });
  });

  it("qualifies a furniture deal once its sub-path is chosen, and a bespoke one only after feasibility", async () => {
    await withOpportunity("furniture_only", "furniture", async (client, { workspaceId, opportunityId, stage, opportunities, flow }) => {
      await flow.update(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), furniturePath: "bespoke" });
      await expect(opportunities.transition(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), stageId: stage.qualification }))
        .rejects.toMatchObject({ response: { missing: [{ key: "feasibility", label: "Feasibility confirmed by Factory/Technical" }] } });
      const confirmed = await flow.update(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), feasibilityConfirmed: true });
      expect(confirmed.feasibilityConfirmedAt).toBeTruthy();
      const moved = await opportunities.transition(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), stageId: stage.qualification });
      expect(moved.stage_id).toBe(stage.qualification);
      // Moving back is always allowed.
      const back = await opportunities.transition(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), stageId: stage.qualified });
      expect(back.stage_id).toBe(stage.qualified);
      await expect(flow.update(actor, workspaceId, opportunityId, { version: 1, furniturePath: "take_home_now" })).rejects.toThrow(/changed/);
    });
  });

  it("wins only through a payment proof, which is kept with the opportunity", async () => {
    await withOpportunity("architecture", "basic", async (client, { workspaceId, opportunityId, stage, opportunities, flow }) => {
      await expect(opportunities.transition(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), stageId: stage.won, status: "won", reason: "Paid" }))
        .rejects.toMatchObject({ response: { missing: [{ key: "paymentProof", label: "Payment proof attached" }] } });
      const result = await flow.attachProof(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), kind: "receipt", note: "Card slip 1234" }, png);
      expect(result.opportunity).toMatchObject({ status: "won", stage_id: stage.won, outcome_reason: "Payment proof attached" });
      expect(result.proof).toMatchObject({ kind: "receipt", fileName: "receipt.png", note: "Card slip 1234" });
      expect((await loadFlowFacts(client, workspaceId, opportunityId)).paymentProof).toBe(true);
    });
  });

  const proposalsOf = async (client: PoolClient, id: string) => (await client.query<{ kind: string; won: boolean }>(
    `SELECT kind, won_at IS NOT NULL AS won FROM crm_opportunity_proposals WHERE opportunity_id = $1 ORDER BY kind`, [id])).rows;
  const proofsOf = async (client: PoolClient, id: string) => (await client.query<{ proposal: string | null }>(
    `SELECT proposal_kind AS proposal FROM crm_opportunity_payment_proofs WHERE opportunity_id = $1 ORDER BY recorded_at, proposal_kind`, [id])).rows.map((row) => row.proposal);

  it("QA-005: Proposal 1's proof wins only Proposal 1; Proposal 2's proof is a second Won with its own proof and date", async () => {
    await withOpportunity("interior_design_furniture", "basic", async (client, { workspaceId, opportunityId, stage, flow }) => {
      const first = await flow.attachProof(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), kind: "receipt", proposal: "design" }, png);
      expect(first.opportunity).toMatchObject({ status: "won", stage_id: stage.won });
      expect(await proposalsOf(client, opportunityId)).toEqual([{ kind: "design", won: true }]);
      await client.query("UPDATE crm_opportunity_proposals SET won_at = won_at - interval '20 days' WHERE opportunity_id = $1", [opportunityId]);
      // The client accepts the main quotation and pays the advance: its proof attaches and wins Proposal 2, without reopening.
      const second = await flow.attachProof(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), kind: "bank_transfer", note: "Advance", proposal: "main" }, png);
      expect(second.opportunity).toMatchObject({ status: "won", stage_id: stage.won });
      expect(second.proof).toMatchObject({ proposal: "main", note: "Advance" });
      const rounds = (await client.query<{ kind: string; wonAt: Date }>(`SELECT kind, won_at AS "wonAt" FROM crm_opportunity_proposals WHERE opportunity_id = $1 ORDER BY kind`, [opportunityId])).rows;
      expect(rounds.map((row) => row.kind)).toEqual(["design", "main"]);
      expect(rounds[1].wonAt.getTime() - rounds[0].wonAt.getTime()).toBeGreaterThan(19 * 86_400_000);
      expect(await proofsOf(client, opportunityId)).toEqual(["design", "main"]);
      // Once both are Won there is nothing left to win.
      await expect(flow.attachProof(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), kind: "receipt", proposal: "main" }, png))
        .rejects.toThrow(/Only an open opportunity can be won/);
    });
  });

  it("QA-005: a proof that doesn't name its round wins the design round first where the job has one, so Proposal 2 can follow", async () => {
    await withOpportunity("interior_design_furniture", "basic", async (client, { workspaceId, opportunityId, flow }) => {
      const caseId = randomUUID();
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,(SELECT created_by FROM workspaces WHERE id = $2))", [caseId, workspaceId, opportunityId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','design','accepted','Design fee','AED')", [workspaceId, caseId, randomUUID()]);
      await client.query("SET LOCAL session_replication_role = origin");
      await flow.attachProof(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), kind: "receipt" }, png);
      expect(await proposalsOf(client, opportunityId)).toEqual([{ kind: "design", won: true }]);
      // On the won opportunity, a proof is Proposal 2's.
      await flow.attachProof(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), kind: "receipt" }, png);
      expect(await proposalsOf(client, opportunityId)).toEqual([{ kind: "design", won: true }, { kind: "main", won: true }]);
      expect(await proofsOf(client, opportunityId)).toEqual(["design", "main"]);
    });
  });

  it("QA-005: a job without a design round wins its one proposal, and takes no second proof", async () => {
    await withOpportunity("architecture", "basic", async (client, { workspaceId, opportunityId, flow }) => {
      await flow.attachProof(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), kind: "receipt" }, png);
      expect(await proposalsOf(client, opportunityId)).toEqual([{ kind: "main", won: true }]);
      await expect(flow.attachProof(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), kind: "receipt", proposal: "main" }, png))
        .rejects.toThrow(/Only an open opportunity can be won/);
    });
  });

  it("keeps a 'not sure yet' enquiry in the first column", async () => {
    await withOpportunity("not_sure", null, async (client, { workspaceId, opportunityId, stage, opportunities }) => {
      await expect(opportunities.transition(actor, workspaceId, opportunityId, { version: await version(client, opportunityId), stageId: stage.proposal }))
        .rejects.toMatchObject({ response: { missing: [{ key: "enquiryType", label: "Enquiry type chosen" }] } });
    });
  });
});
