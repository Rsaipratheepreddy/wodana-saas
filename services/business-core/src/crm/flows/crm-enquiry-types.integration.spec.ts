import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadFlowFacts } from "../opportunities/flow-facts";
import { CrmSettingsService } from "../settings/crm-settings.service";
import { CrmEnquiryTypesService } from "./crm-enquiry-types.service";
import { CrmFlowsService } from "./crm-flows.service";
import type { FlowDefinition } from "./flow-definition";
import { FLOW_TEMPLATES } from "./flow-templates";
import { STARTER_FLOWS } from "./starter-flows";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type World = {
  workspaceId: string; taxonomyId: string; option: Record<string, string>;
  newOpportunity: (serviceType: string) => Promise<string>;
  types: CrmEnquiryTypesService; flows: CrmFlowsService; settings: CrmSettingsService;
};
type Listed = { id: string; code: string; label: string; color: number | null; version: number; flowId: string; runningJobs: number; latest: { version: number; source: string; steps: string[] } };

integration("enquiry types, each with its own steps (plan §5a)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  /** Enquiry types: Architecture and Kitchen share Basic, Joinery names none (so runs Basic), Studio uses Design. */
  async function withWorkspace(work: (client: PoolClient, world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), actor = randomUUID(), partyId = randomUUID(), pipelineId = randomUUID(), taxonomyId = randomUUID();
    const option: Record<string, string> = Object.fromEntries(["architecture", "kitchen", "joinery", "studio", "not_sure"].map((code) => [code, randomUUID()]));
    const stage: Record<string, string> = Object.fromEntries(["qualified", "qualification", "proposal", "negotiation", "won", "lost"].map((code) => [code, randomUUID()]));
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'AM')", [actor, `am-${actor.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Types',$2,'AED',$3)", [workspaceId, `types-${workspaceId.slice(0, 8)}`, actor]);
      await client.query("INSERT INTO crm_taxonomies(id,workspace_id,code,name) VALUES($1,$2,'enquiry_type','Enquiry types')", [taxonomyId, workspaceId]);
      for (const [position, [code, label, flow]] of ([["architecture", "Architecture", "basic"], ["kitchen", "Kitchen", "basic"], ["joinery", "Joinery", null], ["studio", "Studio", "design"], ["not_sure", "Not sure yet", "basic"]] as const).entries())
        await client.query("INSERT INTO crm_taxonomy_options(id,workspace_id,taxonomy_id,code,label,flow,position) VALUES($1,$2,$3,$4,$5,$6,$7)", [option[code], workspaceId, taxonomyId, code, label, flow, position]);
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [pipelineId, workspaceId]);
      for (const [index, code] of Object.keys(stage).entries())
        await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position,probability) VALUES($1,$2,$3,$4,$4,$5,10)", [stage[code], workspaceId, pipelineId, code, index + 1]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya','maya')", [partyId, workspaceId]);
      await client.query("SET LOCAL session_replication_role = origin");
      let count = 0;
      const newOpportunity = async (serviceType: string) => {
        const enquiryId = randomUUID(), leadId = randomUUID(), opportunityId = randomUUID();
        count += 1;
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
          VALUES($1,$2,$3,$4,'Villa','referral','external',now(),$5,$6,'{"customerType":"end_user"}')`, [enquiryId, workspaceId, randomUUID(), partyId, `E-${count}`, serviceType]);
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
      await work(client, { workspaceId, taxonomyId, option, newOpportunity, types: new CrmEnquiryTypesService(access), flows: new CrmFlowsService(access), settings: new CrmSettingsService(access, events) });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  const audits = async (client: PoolClient, workspaceId: string, action: string) =>
    Number((await client.query("SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action = $2", [workspaceId, action])).rows[0].count);
  const pinnedOf = async (client: PoolClient, id: string) =>
    (await client.query<{ flowVersionId: string | null }>(`SELECT flow_version_id AS "flowVersionId" FROM crm_opportunities WHERE id = $1`, [id])).rows[0].flowVersionId;
  const listed = async (types: CrmEnquiryTypesService, workspaceId: string) => (await types.list(actor, workspaceId)).data as Listed[];
  const flowOf = async (client: PoolClient, optionId: string) =>
    (await client.query<{ id: string; code: string; splitFrom: string | null; optionFlow: string }>(
      `SELECT flow.id, flow.code, flow.split_from_flow_id AS "splitFrom", choice.flow AS "optionFlow" FROM crm_flows flow
         JOIN crm_taxonomy_options choice ON choice.id = flow.enquiry_type_option_id WHERE choice.id = $1`, [optionId])).rows[0];
  const stricterBasic = (): FlowDefinition => {
    const definition = structuredClone(STARTER_FLOWS.basic.definition);
    definition.steps.splice(1, 0, { key: "quotation", name: "Prepare the quotation", role: "sales", check: "quote_exists", column: "proposal" });
    return definition;
  };

  it("splits a flow several types share: each type gets its own copy of the latest steps; pinned jobs keep their version", async () => {
    await withWorkspace(async (client, { workspaceId, option, newOpportunity, types, flows }) => {
      // A Kitchen job pins Basic v1 while Kitchen still shares Basic; then Basic gets a stricter v2.
      const running = await newOpportunity("kitchen");
      const pinned = (await loadFlowFacts(client, workspaceId, running)).flowDefinition;
      expect(pinned).toMatchObject({ code: "basic", version: 1 });
      const basic = (await client.query("SELECT id FROM crm_flows WHERE workspace_id = $1 AND code = 'basic'", [workspaceId])).rows[0];
      await flows.publish(actor, workspaceId, basic.id, { expectedVersion: 1, definition: stricterBasic() });

      const first = await listed(types, workspaceId);
      expect(first.map((type) => type.code)).toEqual(["architecture", "kitchen", "joinery", "studio"]);
      // Architecture comes first, so it keeps Basic; Studio takes Design (nobody else uses it).
      expect(await flowOf(client, option.architecture)).toMatchObject({ code: "basic", optionFlow: "basic", splitFrom: null });
      expect(await flowOf(client, option.studio)).toMatchObject({ code: "design", optionFlow: "design", splitFrom: null });
      const kitchen = await flowOf(client, option.kitchen), joinery = await flowOf(client, option.joinery);
      expect(kitchen).toMatchObject({ code: "kitchen", optionFlow: "kitchen", splitFrom: basic.id });
      expect(joinery).toMatchObject({ code: "joinery", optionFlow: "joinery", splitFrom: basic.id });
      expect(new Set(first.map((type) => type.flowId)).size).toBe(4);
      expect(first.find((type) => type.code === "kitchen")).toMatchObject({ runningJobs: 1, latest: { version: 1, steps: stricterBasic().steps.map((step) => step.name) } });
      expect((await types.get(actor, workspaceId, option.kitchen)).selected.definition).toEqual(stricterBasic());
      expect(await audits(client, workspaceId, "crm.flow.split.v1")).toBe(2);

      // Not sure yet never gets a flow; reading again changes nothing.
      expect((await client.query("SELECT count(*)::int AS n FROM crm_flows WHERE enquiry_type_option_id = $1", [option.not_sure])).rows[0].n).toBe(0);
      const before = await audits(client, workspaceId, "crm.enquiry_type.flow_changed.v1");
      await listed(types, workspaceId);
      expect(await audits(client, workspaceId, "crm.flow.split.v1")).toBe(2);
      expect(await audits(client, workspaceId, "crm.enquiry_type.flow_changed.v1")).toBe(before);

      // The running Kitchen job keeps Basic v1; a new Kitchen job runs Kitchen's own steps.
      expect((await loadFlowFacts(client, workspaceId, running)).flowDefinition.versionId).toBe(pinned.versionId);
      expect(await pinnedOf(client, running)).toBe(pinned.versionId);
      const fresh = await newOpportunity("kitchen");
      expect((await loadFlowFacts(client, workspaceId, fresh)).flowDefinition).toMatchObject({ code: "kitchen", version: 1, flowId: kitchen.id });

      // A job whose type changes still follows its new type.
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(`UPDATE crm_enquiries SET service_type = 'studio' WHERE id = (SELECT enquiry_id FROM crm_leads WHERE id = (SELECT lead_id FROM crm_opportunities WHERE id = $1))`, [running]);
      await client.query("SET LOCAL session_replication_role = origin");
      expect((await loadFlowFacts(client, workspaceId, running)).flowDefinition.code).toBe("design");
    });
  });

  it("creates an enquiry type with its steps: from a template, a copy or blank; idempotent; refused on a taken name", async () => {
    await withWorkspace(async (client, { workspaceId, taxonomyId, option, newOpportunity, types }) => {
      const taxonomyVersion = async () => Number((await client.query("SELECT version FROM crm_taxonomies WHERE id = $1", [taxonomyId])).rows[0].version);
      const startVersion = await taxonomyVersion();
      const template = FLOW_TEMPLATES.find((item) => item.key === "fit_out_joinery")!;
      const created = await types.create(actor, workspaceId, { label: "Wardrobes", color: 3, templateKey: template.key });
      expect(created).toMatchObject({ code: "wardrobes", label: "Wardrobes", color: 3, status: "active", created: true });
      expect(await taxonomyVersion()).toBe(startVersion + 1);
      expect(await types.create(actor, workspaceId, { label: "Wardrobes", color: 3, templateKey: template.key })).toMatchObject({ id: created.id, created: false });
      await expect(types.create(actor, workspaceId, { label: "Wardrobes", blank: true })).rejects.toMatchObject({ status: 409 });
      await expect(types.create(actor, workspaceId, { label: "kitchen", blank: true })).rejects.toMatchObject({ status: 409 });
      await expect(types.create(actor, workspaceId, { label: "Two", blank: true, templateKey: template.key })).rejects.toMatchObject({ status: 422 });
      await expect(types.create(actor, workspaceId, { label: "None" })).rejects.toMatchObject({ status: 422 });
      await expect(types.create(actor, workspaceId, { label: "Copy", copyFromTypeId: option.not_sure })).rejects.toMatchObject({ status: 404 });

      const detail = await types.get(actor, workspaceId, created.id);
      expect(detail).toMatchObject({ enquiryType: { id: created.id, label: "Wardrobes", color: 3 }, selected: { version: 1, definition: template.definition } });
      const copy = await types.create(actor, workspaceId, { label: "Walk-in closets", copyFromTypeId: created.id });
      expect((await types.get(actor, workspaceId, copy.id)).selected.definition).toEqual(template.definition);
      const blank = await types.create(actor, workspaceId, { label: "Furniture", blank: true });
      // The starter "furniture" flow keeps its code: the new type's flow gets the next free one.
      expect(blank.code).toBe("furniture");
      expect((await flowOf(client, blank.id)).code).toBe("furniture_2");
      expect((await types.get(actor, workspaceId, blank.id)).selected.definition).toEqual(STARTER_FLOWS.basic.definition);
      expect((await listed(types, workspaceId)).map((type) => type.label)).toEqual(["Architecture", "Kitchen", "Joinery", "Studio", "Wardrobes", "Walk-in closets", "Furniture"]);
      expect(await audits(client, workspaceId, "crm.enquiry_type.created.v1")).toBe(3);

      // A job of the new type runs its steps; leads see it as a choice.
      const job = await newOpportunity("wardrobes");
      expect((await loadFlowFacts(client, workspaceId, job)).flowDefinition).toMatchObject({ code: "wardrobes", flowId: created.flowId });
    });
  });

  it("renames, recolours and archives a type (version-checked, audited, idempotent); Not sure yet stays", async () => {
    await withWorkspace(async (client, { workspaceId, option, types }) => {
      const kitchen = (await listed(types, workspaceId)).find((type) => type.code === "kitchen")!;
      await expect(types.update(actor, workspaceId, option.kitchen, { version: kitchen.version + 5, label: "Kitchens" })).rejects.toMatchObject({ status: 409 });
      await expect(types.update(actor, workspaceId, option.kitchen, { version: kitchen.version, label: "Studio" })).rejects.toMatchObject({ status: 409 });
      await expect(types.update(actor, workspaceId, option.not_sure, { version: 1, status: "archived" })).rejects.toMatchObject({ status: 422 });
      const renamed = await types.update(actor, workspaceId, option.kitchen, { version: kitchen.version, label: "Kitchens", color: 5 });
      expect(renamed).toMatchObject({ code: "kitchen", label: "Kitchens", color: 5, version: kitchen.version + 1, flowId: kitchen.flowId });
      expect(await types.update(actor, workspaceId, option.kitchen, { version: kitchen.version, label: "Kitchens", color: 5 })).toMatchObject({ version: kitchen.version + 1 });
      const archived = await types.update(actor, workspaceId, option.kitchen, { version: renamed.version, status: "archived" });
      expect(archived.status).toBe("archived");
      expect((await listed(types, workspaceId)).map((type) => type.code)).not.toContain("kitchen");
      // Archiving keeps the type's steps.
      expect((await types.get(actor, workspaceId, option.kitchen)).id).toBe(kitchen.flowId);
      expect(await audits(client, workspaceId, "crm.enquiry_type.updated.v1")).toBe(1);
      expect(await audits(client, workspaceId, "crm.enquiry_type.archived.v1")).toBe(1);
    });
  });

  it("gives a type added in Settings › Enquiry options its own steps from Basic", async () => {
    await withWorkspace(async (client, { workspaceId, taxonomyId, option, types, flows, settings }) => {
      await listed(types, workspaceId);
      // Architecture owns Basic and publishes stricter steps; a new type still starts from the Basic starter.
      const architecture = await flowOf(client, option.architecture);
      await flows.publish(actor, workspaceId, architecture.id, { expectedVersion: 1, definition: stricterBasic() });
      const version = Number((await client.query("SELECT version FROM crm_taxonomies WHERE id = $1", [taxonomyId])).rows[0].version);
      const current = (await client.query<{ code: string; label: string }>("SELECT code, label FROM crm_taxonomy_options WHERE taxonomy_id = $1 AND status = 'active' ORDER BY position", [taxonomyId])).rows;
      await settings.updateTaxonomy(actor, workspaceId, taxonomyId, { version, options: [...current, { code: "option_abc123", label: "Landscaping" }] } as never);
      const added = (await client.query<{ id: string }>("SELECT id FROM crm_taxonomy_options WHERE taxonomy_id = $1 AND code = 'option_abc123'", [taxonomyId])).rows[0];
      expect(await flowOf(client, added.id)).toMatchObject({ code: "landscaping", optionFlow: "landscaping", splitFrom: null });
      expect((await types.get(actor, workspaceId, added.id)).selected).toMatchObject({ version: 1, source: "starter", definition: STARTER_FLOWS.basic.definition });
      // The other types keep their own flows.
      expect((await flowOf(client, option.architecture)).code).toBe("basic");
      expect((await flowOf(client, option.kitchen)).code).toBe("kitchen");
    });
  });
});
