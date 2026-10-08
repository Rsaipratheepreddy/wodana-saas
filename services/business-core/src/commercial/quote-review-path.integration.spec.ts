import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureStarterFlows } from "../crm/flows/flow-store";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { casePlan } from "../pre-projects/case-plan";
import { PreProjectReadinessService } from "../pre-projects/pre-project-readiness.service";
import { CommercialService } from "./commercial.service";
import { commercialRepository } from "./commercial-repository";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "Sara Sales" } as never;

type World = { client: PoolClient; workspaceId: string; caseId: string; commercial: CommercialService };

/**
 * A quotation's way to the client follows the case's path and the firm's rules:
 *  - submitting for review asks for a site plan only where the path has a site visit, the same plan that shows the
 *    case's Site area (Furniture made to order has no site visit, no Site area and no site plan to add);
 *  - a deal quotation needs the QS estimate only where the firm's QS rules say so; otherwise it is approved as priced
 *    and sent without one.
 */
integration("quotation review by the case's path", { timeout: 30_000 }, () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(path: string, run: (w: World) => Promise<void>, options: { dealFirst?: boolean } = {}) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), owner = randomUUID(), membership = randomUUID(), partyId = randomUUID(), enquiryId = randomUUID(), leadId = randomUUID(),
      opportunityId = randomUUID(), pipelineId = randomUUID(), taxonomyId = randomUUID(), caseId = randomUUID(), stage = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sara Sales')", [owner, `${owner.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `sp-${workspaceId.slice(0, 8)}`, owner]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, owner]);
      await client.query("INSERT INTO crm_taxonomies(id,workspace_id,code,name) VALUES($1,$2,'enquiry_type','Enquiry types')", [taxonomyId, workspaceId]);
      await client.query("INSERT INTO crm_taxonomy_options(workspace_id,taxonomy_id,code,label,flow) VALUES($1,$2,'furniture_only','Furniture Only','furniture')", [workspaceId, taxonomyId]);
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [pipelineId, workspaceId]);
      await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position,probability) VALUES($1,$2,$3,'proposal','Proposal',1,50)", [stage, workspaceId, pipelineId]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya','maya')", [partyId, workspaceId]);
      await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
        VALUES($1,$2,$3,$4,'Dining table','referral','external',now(),'E-1','furniture_only','{}')`, [enquiryId, workspaceId, randomUUID(), partyId]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id) VALUES($1,$2,$3,$4)", [leadId, workspaceId, enquiryId, partyId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,owner_membership_id,title,reference,next_action_at,amount,currency_code,furniture_path,
          conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'Dining table','O-1',now() + interval '1 day',4500,'AED',$8,'lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`,
        [opportunityId, workspaceId, partyId, leadId, pipelineId, stage, membership, path]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, owner]);
      // Deal-first: the furniture order's scope chosen in Sales (made to order, no design or site works).
      const content = options.dealFirst ? { servicePath: { selectedAt: new Date().toISOString(), selectedBy: owner,
        scope: { design: false, mainQuotation: true, materialSelection: false, procurement: true, manufacturing: true, siteWorks: false, installation: false } } } : {};
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,$3::jsonb)", [workspaceId, caseId, JSON.stringify(content)]);
      const terms = [{ id: "advance", title: "Advance", percent: 100, trigger: "On acceptance", requiredForRelease: true, requiredForProduction: false }];
      await client.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency,valid_until,total,detail)
        VALUES($1,$2,'q1',0,1,'quotation','main','draft','Dining table','AED',current_date + 30,4500,$3::jsonb)`,
        [workspaceId, caseId, JSON.stringify({ paymentTerms: terms, requestIds: [], terms: "", exclusions: "", createdAt: new Date().toISOString() })]);
      await client.query(`INSERT INTO commercial_quote_lines(workspace_id,case_id,quote_id,id,sort_order,title,quantity,unit,rate,kind)
        VALUES($1,$2,'q1','l1',0,'Dining table',1,'pcs',4500,'item')`, [workspaceId, caseId]);
      await client.query("SET LOCAL session_replication_role = origin");
      await ensureStarterFlows(client, workspaceId);
      await seedDefaultNotificationTemplates(client, workspaceId);
      const runWith = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string; displayName: string }) => unknown) => fn(client, { userId: owner, displayName: "Sara Sales" });
      const access = { withPermission: runWith, withAnyPermission: runWith, withPermissions: runWith, hasPermission: async () => true } as never;
      const commercial = new CommercialService(access, { get: () => undefined } as never, {} as never, new PreProjectReadinessService(access, {} as never));
      await run({ client, workspaceId, caseId, commercial });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const step = async (w: World, action: string, extra: Record<string, unknown> = {}) => {
    const revision = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!.revision;
    return w.commercial.command(actor, w.workspaceId, w.caseId, { action, revision, quoteId: "q1", ...extra });
  };
  const submit = (w: World) => step(w, "submit");
  /** The firm prices with a QS by its rules (or not at all), and the client's portal and decision-maker are set up. */
  const qsRules = async (w: World, qsReview: boolean) => {
    await w.client.query(`INSERT INTO workspace_quotation_settings(workspace_id,qs_review,qs_review_scope) VALUES($1,$2,'rules')
      ON CONFLICT (workspace_id) DO UPDATE SET qs_review = excluded.qs_review, qs_review_scope = excluded.qs_review_scope`, [w.workspaceId, qsReview]);
    await w.client.query("INSERT INTO client_portal_settings(workspace_id,slug,enabled) VALUES($1,$2,true) ON CONFLICT (workspace_id) DO UPDATE SET enabled = true",
      [w.workspaceId, `portal-${w.workspaceId.slice(0, 8)}`]);
    await w.client.query("INSERT INTO client_portal_grants(workspace_id,case_id,name,phone,role) VALUES($1,$2,'Maya','+971500000001','approver')", [w.workspaceId, w.caseId]);
  };
  const status = async (w: World) => (await w.client.query<{ status: string }>(
    "SELECT status FROM commercial_quotes WHERE workspace_id=$1 AND case_id=$2 AND id='q1'", [w.workspaceId, w.caseId])).rows[0].status;

  it("Furniture made to order (no site visit, no Site area) goes to review without a site plan", async () => {
    await world("core_collection_factory", async (w) => {
      expect(await casePlan(w.client, w.workspaceId, w.caseId)).toMatchObject({ siteVisit: false });
      await submit(w);
      expect(await status(w)).toBe("internal_review");
    });
  });

  it("a path with a site visit (the Site area shows) still needs the current site plan", async () => {
    await world("bespoke", async (w) => {
      expect(await casePlan(w.client, w.workspaceId, w.caseId)).toMatchObject({ siteVisit: true });
      await expect(submit(w)).rejects.toThrow("Add the current site plan before submitting the quotation for review.");
      expect(await status(w)).toBe("draft");
    });
  });

  it("a deal quotation of standard items is approved as priced and sent without a QS estimate", async () => {
    await world("core_collection_factory", async (w) => {
      await qsRules(w, true);
      await submit(w);
      expect((await w.commercial.state(actor, w.workspaceId, w.caseId)).qsEstimateQuoteIds).toEqual([]);
      await step(w, "approve");
      expect(await status(w)).toBe("internal_approved");
      await step(w, "issue");
      expect(await status(w)).toBe("issued");
    }, { dealFirst: true });
  });

  it("a deal quotation the QS must price waits for the QS estimate", async () => {
    await world("core_collection_factory", async (w) => {
      await qsRules(w, false); // without the firm's QS rules every deal quotation keeps the QS estimate
      await submit(w);
      expect((await w.commercial.state(actor, w.workspaceId, w.caseId)).qsEstimateQuoteIds).toEqual(["q1"]);
      await expect(step(w, "approve")).rejects.toThrow("A Quantity Surveyor must review this quotation before it is issued.");
      await expect(step(w, "qs_approve")).rejects.toThrow("Enter the QS cost estimate for the quotation items before approving pricing.");
      expect(await status(w)).toBe("internal_review");
    }, { dealFirst: true });
  });
});
