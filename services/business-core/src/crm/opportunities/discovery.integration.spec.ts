import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpportunityDiscoveryService } from "./discovery.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("opportunity discovery (PLM-040)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withOpportunity(work: (client: PoolClient, ids: { workspaceId: string; opportunityId: string; floorPlanId: string; packageId: string; service: OpportunityDiscoveryService }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), actor = randomUUID(), partyId = randomUUID(), enquiryId = randomUUID(), leadId = randomUUID(), opportunityId = randomUUID(), floorPlanId = randomUUID(), packageId = randomUUID(), formId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'AM')", [actor, `am-${actor.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers and parent rows
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Discovery',$2,'AED',$3)", [workspaceId, `disc-${workspaceId.slice(0, 8)}`, actor]);
      await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
        VALUES($1,$2,$3,$4,'Villa','referral','external',now(),'E-1','fit_out','{"customerType":"homeowner"}')`, [enquiryId, workspaceId, randomUUID(), partyId]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id) VALUES($1,$2,$3,$4)", [leadId, workspaceId, enquiryId, partyId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, partyId, leadId, randomUUID(), randomUUID()]);
      await client.query("INSERT INTO crm_lead_qualification_values(workspace_id,lead_id,question_key,value) VALUES($1,$2,$3,$4)", [workspaceId, leadId, `requirement_asset_${floorPlanId}`, JSON.stringify({ id: floorPlanId, name: "floor-plan.pdf", mimeType: "application/pdf" })]);
      await client.query("INSERT INTO design_packages(id,workspace_id,code,name,pricing_method,rate,currency,area_unit) VALUES($1,$2,'bespoke','Bespoke','per_area',40,'AED','sqft')", [packageId, workspaceId]);
      await client.query("INSERT INTO crm_qualification_forms(id,workspace_id,code,name,status,purpose) VALUES($1,$2,'intro','Intro','active','discovery')", [formId, workspaceId]);
      await client.query("INSERT INTO crm_qualification_questions(workspace_id,form_id,key,label,data_type,required,position) VALUES($1,$2,'style','Design style','text',true,1),($1,$2,'pets','Pets','text',false,2)", [workspaceId, formId]);
      await client.query("SET LOCAL session_replication_role = origin");
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: actor });
      await work(client, { workspaceId, opportunityId, floorPlanId, packageId, service: new OpportunityDiscoveryService({ withPermission: run } as never) });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  it("lists what is missing, prices the package from the area and becomes ready", async () => {
    await withOpportunity(async (client, { workspaceId, opportunityId, floorPlanId, packageId, service }) => {
      const empty = await service.get(actor, workspaceId, opportunityId);
      expect(empty.missing.map((item) => item.key)).toEqual(["floorPlan", "area", "clientEmail", "propertyLocation", "question:style"]);
      expect(empty.files).toEqual([{ id: floorPlanId, name: "floor-plan.pdf", mimeType: "application/pdf" }]);
      await expect(service.save(actor, workspaceId, opportunityId, { floorPlanAssetId: randomUUID() })).rejects.toThrow(/this enquiry's files/);
      const saved = await service.save(actor, workspaceId, opportunityId, { version: 0, area: "100", areaUnit: "sqm", propertyLocation: "Jumeirah", clientEmail: "Maya@Example.com", floorPlanAssetId: floorPlanId, designPackageId: packageId, answers: { style: "Warm minimal" } });
      // 100 m² = 1076.39 ft² at AED 40 / ft²
      expect(saved.designFee).toEqual({ amount: "43055.60", currency: "AED" });
      expect(saved.facts.clientEmail).toBe("maya@example.com");
      expect(saved.missing).toEqual([]);
      expect(await service.missing(client, workspaceId, opportunityId)).toEqual([]);
      await expect(service.save(actor, workspaceId, opportunityId, { version: 0, area: "120" })).rejects.toThrow(/another window/);
      await expect(service.save(actor, workspaceId, opportunityId, { answers: { unknown: "x" } })).rejects.toThrow(/Unknown discovery question/);
    });
  });
});
