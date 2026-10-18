import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CrmOpportunitiesService } from "../opportunities/crm-opportunities.service";
import { loadFlowFacts } from "../opportunities/flow-facts";
import { CrmFlowsService } from "./crm-flows.service";
import type { FlowDefinition } from "./flow-definition";
import { ensureStarterFlows } from "./flow-store";
import { FLOW_TEMPLATES } from "./flow-templates";
import { STARTER_FLOWS } from "./starter-flows";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type World = {
  workspaceId: string; actor: string; optionId: string; stage: Record<string, string>;
  newOpportunity: () => Promise<string>; opportunities: CrmOpportunitiesService; flows: CrmFlowsService;
};

integration("flows as configuration (plan §5a, F2)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withWorkspace(work: (client: PoolClient, world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), actor = randomUUID(), partyId = randomUUID(), pipelineId = randomUUID(), taxonomyId = randomUUID(), optionId = randomUUID();
    const stage: Record<string, string> = Object.fromEntries(["qualified", "qualification", "proposal", "negotiation", "won", "lost"].map((code) => [code, randomUUID()]));
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'AM')", [actor, `am-${actor.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Flows',$2,'AED',$3)", [workspaceId, `flows-${workspaceId.slice(0, 8)}`, actor]);
      await client.query("INSERT INTO crm_taxonomies(id,workspace_id,code,name) VALUES($1,$2,'enquiry_type','Enquiry types')", [taxonomyId, workspaceId]);
      await client.query("INSERT INTO crm_taxonomy_options(id,workspace_id,taxonomy_id,code,label,flow) VALUES($1,$2,$3,'architecture','Architecture','basic')", [optionId, workspaceId, taxonomyId]);
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [pipelineId, workspaceId]);
      for (const [index, code] of Object.keys(stage).entries())
        await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position,probability) VALUES($1,$2,$3,$4,$4,$5,10)", [stage[code], workspaceId, pipelineId, code, index + 1]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya','maya')", [partyId, workspaceId]);
      await client.query("SET LOCAL session_replication_role = origin");
      let count = 0;
      const newOpportunity = async () => {
        const enquiryId = randomUUID(), leadId = randomUUID(), opportunityId = randomUUID();
        count += 1;
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
          VALUES($1,$2,$3,$4,'Villa','referral','external',now(),$5,'architecture','{"customerType":"end_user"}')`, [enquiryId, workspaceId, randomUUID(), partyId, `E-${count}`]);
        await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id) VALUES($1,$2,$3,$4)", [leadId, workspaceId, enquiryId, partyId]);
        await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,title,reference,next_action_at,
            conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
          VALUES($1,$2,$3,$4,$5,$6,'Villa',$7,now() + interval '1 day','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`,
          [opportunityId, workspaceId, partyId, leadId, pipelineId, stage.qualified, `O-${count}`]);
        await client.query("SET LOCAL session_replication_role = origin");
        return opportunityId;
      };
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: actor });
      const access = { withPermission: run, withPermissions: run, hasPermission: async () => true } as never;
      const events = { record: async () => undefined } as never;
      await work(client, { workspaceId, actor, optionId, stage, newOpportunity, opportunities: new CrmOpportunitiesService(access, events), flows: new CrmFlowsService(access) });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  const opportunity = async (client: PoolClient, id: string) =>
    (await client.query<{ version: number; flowVersionId: string | null }>(`SELECT version, flow_version_id AS "flowVersionId" FROM crm_opportunities WHERE id = $1`, [id])).rows[0];
  const audits = async (client: PoolClient, workspaceId: string, action: string) =>
    Number((await client.query("SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action = $2", [workspaceId, action])).rows[0].count);
  /** Basic, plus a quotation before Proposal. */
  const stricterBasic = (): FlowDefinition => {
    const definition = structuredClone(STARTER_FLOWS.basic.definition);
    definition.steps.splice(1, 0, { key: "quotation", name: "Prepare the quotation", role: "sales", check: "quote_exists", column: "proposal" });
    return definition;
  };

  it("seeds the starter flows once per workspace, on first read", async () => {
    await withWorkspace(async (client, { workspaceId, flows }) => {
      await ensureStarterFlows(client, workspaceId);
      await ensureStarterFlows(client, workspaceId);
      const listed = (await flows.list(actor, workspaceId)).data as Array<{ code: string; latest: { version: number; source: string; steps: string[] }; usedBy: Array<{ code: string; assigned: boolean }> }>;
      expect(listed.map((flow) => flow.code).sort()).toEqual(["basic", "design", "fit_out", "furniture"]);
      expect(listed.every((flow) => flow.latest.version === 1 && flow.latest.source === "starter")).toBe(true);
      expect(listed.find((flow) => flow.code === "basic")?.usedBy.map((option) => option.code)).toEqual(["architecture"]);
      expect(listed.find((flow) => flow.code === "basic")?.usedBy[0].assigned).toBe(true);
      expect(listed.every((flow) => flow.latest.steps.length > 0 && flow.latest.steps.every((name) => typeof name === "string"))).toBe(true);
      expect(await audits(client, workspaceId, "crm.flow.seeded.v1")).toBe(4);
    });
  });

  it("pins the job's flow version the first time it needs it, without bumping the job's version", async () => {
    await withWorkspace(async (client, { workspaceId, newOpportunity }) => {
      const id = await newOpportunity();
      const before = await opportunity(client, id);
      expect(before.flowVersionId).toBeNull();
      const facts = await loadFlowFacts(client, workspaceId, id);
      const after = await opportunity(client, id);
      expect(after.flowVersionId).toBe(facts.flowDefinition.versionId);
      expect(after.version).toBe(before.version);
      await loadFlowFacts(client, workspaceId, id);
      expect(await audits(client, workspaceId, "crm.opportunity.flow_pinned.v1")).toBe(1);
    });
  });

  it("publishes a new version: new jobs follow it, running jobs keep theirs; stale and replayed publishes are handled", async () => {
    await withWorkspace(async (client, { workspaceId, stage, newOpportunity, opportunities, flows }) => {
      const running = await newOpportunity();
      await loadFlowFacts(client, workspaceId, running); // pins basic v1
      const basic = ((await flows.list(actor, workspaceId)).data as Array<{ id: string; code: string }>).find((flow) => flow.code === "basic")!;
      await expect(flows.publish(actor, workspaceId, basic.id, { expectedVersion: 1, definition: { ...stricterBasic(), steps: [] } })).rejects.toMatchObject({ status: 422 });
      const published = await flows.publish(actor, workspaceId, basic.id, { expectedVersion: 1, definition: stricterBasic() });
      expect(published).toMatchObject({ version: 2, created: true });
      // The same publish again returns what the first created; an editor on an old version is refused.
      expect(await flows.publish(actor, workspaceId, basic.id, { expectedVersion: 1, definition: stricterBasic() })).toMatchObject({ id: published.id, created: false });
      await expect(flows.publish(actor, workspaceId, basic.id, { expectedVersion: 1, definition: STARTER_FLOWS.basic.definition })).rejects.toMatchObject({ status: 409 });
      expect(await audits(client, workspaceId, "crm.flow.published.v1")).toBe(1);
      expect((await flows.get(actor, workspaceId, basic.id, 1)).selected).toMatchObject({ version: 1, source: "starter" });

      const fresh = await newOpportunity();
      await expect(opportunities.transition(actor, workspaceId, fresh, { version: (await opportunity(client, fresh)).version, stageId: stage.proposal }))
        .rejects.toMatchObject({ response: { message: "Stage requirements are not met", missing: [{ key: "quotation", label: "Quotation prepared" }] } });
      expect((await opportunity(client, fresh)).flowVersionId).toBe(published.id);
      const moved = await opportunities.transition(actor, workspaceId, running, { version: (await opportunity(client, running)).version, stageId: stage.proposal });
      expect(moved.stage_id).toBe(stage.proposal);
    });
  });

  it("creates a flow from a starter or a copy: validated, audited, idempotent on replay, refused on a taken name", async () => {
    await withWorkspace(async (client, { workspaceId, flows }) => {
      const created = await flows.create(actor, workspaceId, { name: "Villa design", starter: "design" });
      expect(created).toMatchObject({ code: "villa_design", name: "Villa design", created: true });
      expect(await flows.create(actor, workspaceId, { name: "Villa design", starter: "design" })).toMatchObject({ id: created.id, created: false });
      await expect(flows.create(actor, workspaceId, { name: "Villa design", starter: "basic" })).rejects.toMatchObject({ status: 409 });
      await expect(flows.create(actor, workspaceId, { name: "Furniture", starter: "basic" })).rejects.toMatchObject({ status: 409 });
      await expect(flows.create(actor, workspaceId, { name: "Both", starter: "basic", sourceFlowId: created.id })).rejects.toMatchObject({ status: 422 });
      const first = await flows.get(actor, workspaceId, created.id);
      expect(first.selected).toMatchObject({ version: 1, source: "published", definition: STARTER_FLOWS.design.definition });

      // A copy of a chosen version of one of the workspace's flows.
      const published = await flows.publish(actor, workspaceId, created.id, { expectedVersion: 1, definition: stricterBasic(), name: "Villa design v2" });
      expect(published).toMatchObject({ version: 2, created: true });
      const copy = await flows.create(actor, workspaceId, { name: "فيلا", sourceFlowId: created.id, sourceVersion: 1 });
      expect(copy.code).toMatch(/^flow_[0-9a-f]{8}$/);
      expect((await flows.get(actor, workspaceId, copy.id)).selected.definition).toEqual(STARTER_FLOWS.design.definition);
      await expect(flows.create(actor, workspaceId, { name: "Missing version", sourceFlowId: created.id, sourceVersion: 9 })).rejects.toMatchObject({ status: 404 });

      const listed = (await flows.list(actor, workspaceId)).data as Array<{ id: string; name: string; runningJobs: number }>;
      expect(listed.find((flow) => flow.id === created.id)).toMatchObject({ name: "Villa design v2", runningJobs: 0 });
      expect(await audits(client, workspaceId, "crm.flow.created.v1")).toBe(2);
    });
  });

  it("creates a flow from a library template: validated, audited with its source, idempotent on replay", async () => {
    await withWorkspace(async (client, { workspaceId, flows }) => {
      const template = FLOW_TEMPLATES.find((item) => item.key === "fit_out_joinery")!;
      const created = await flows.create(actor, workspaceId, { name: "Joinery", templateKey: template.key });
      expect(created).toMatchObject({ code: "joinery", name: "Joinery", version: 1, created: true });
      expect(await flows.create(actor, workspaceId, { name: "Joinery", templateKey: template.key })).toMatchObject({ id: created.id, created: false });
      await expect(flows.create(actor, workspaceId, { name: "Joinery", templateKey: "renovation" })).rejects.toMatchObject({ status: 409 });
      await expect(flows.create(actor, workspaceId, { name: "Unknown", templateKey: "missing" })).rejects.toMatchObject({ status: 422 });
      expect((await flows.get(actor, workspaceId, created.id)).selected.definition).toEqual(template.definition);
      const audit = (await client.query(`SELECT after FROM audit_events WHERE workspace_id = $1 AND action = 'crm.flow.created.v1'`, [workspaceId])).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0].after).toMatchObject({ code: "joinery", version: 1, from: { template: "fit_out_joinery" } });
    });
  });

  it("renames a flow when only its name changes; the same rename again changes nothing", async () => {
    await withWorkspace(async (client, { workspaceId, flows }) => {
      const basic = ((await flows.list(actor, workspaceId)).data as Array<{ id: string; code: string }>).find((flow) => flow.code === "basic")!;
      const renamed = await flows.publish(actor, workspaceId, basic.id, { expectedVersion: 1, definition: STARTER_FLOWS.basic.definition, name: "Quick sale" });
      expect(renamed).toMatchObject({ version: 1, created: false });
      expect(await flows.publish(actor, workspaceId, basic.id, { expectedVersion: 1, definition: STARTER_FLOWS.basic.definition, name: "Quick sale" })).toMatchObject({ version: 1, created: false });
      await expect(flows.publish(actor, workspaceId, basic.id, { expectedVersion: 1, definition: STARTER_FLOWS.basic.definition })).rejects.toMatchObject({ status: 422 });
      expect((await flows.get(actor, workspaceId, basic.id)).name).toBe("Quick sale");
      expect(await audits(client, workspaceId, "crm.flow.renamed.v1")).toBe(1);
    });
  });

  it("keeps versions immutable and tenants apart (forced RLS for the app role)", async () => {
    await withWorkspace(async (client, { workspaceId }) => {
      await ensureStarterFlows(client, workspaceId);
      await client.query("SAVEPOINT immutable");
      await expect(client.query("UPDATE crm_flow_versions SET published_at = now() WHERE workspace_id = $1", [workspaceId])).rejects.toThrow(/cannot be changed/);
      await client.query("ROLLBACK TO SAVEPOINT immutable");
      await client.query("SET LOCAL ROLE wodana_app");
      expect(Number((await client.query("SELECT count(*) FROM crm_flows WHERE workspace_id = $1", [workspaceId])).rows[0].count)).toBe(4);
      await client.query("SAVEPOINT grants");
      await expect(client.query("UPDATE crm_flow_versions SET checksum = checksum WHERE workspace_id = $1", [workspaceId])).rejects.toThrow(/permission denied/);
      await client.query("ROLLBACK TO SAVEPOINT grants");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [randomUUID()]);
      expect(Number((await client.query("SELECT count(*) FROM crm_flows WHERE workspace_id = $1", [workspaceId])).rows[0].count)).toBe(0);
      expect(Number((await client.query("SELECT count(*) FROM crm_flow_versions WHERE workspace_id = $1", [workspaceId])).rows[0].count)).toBe(0);
      await client.query("RESET ROLE");
    });
  });
});
