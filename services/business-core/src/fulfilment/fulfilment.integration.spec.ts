import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureStarterFlows } from "../crm/flows/flow-store";
import { move } from "../inventory/stock";
import { readReorderPoints } from "../inventory/stock-levels";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { cancelDealOnFullRefund } from "./deal-cancel";
import { boqRequiredForCase } from "./fulfilment-rules";
import { casePlan, casePlans, FULL_PLAN } from "../pre-projects/case-plan";
import { FulfilmentService } from "./fulfilment.service";
import { releaseForDeal, reserveForAcceptedQuote, reserveForProduction, takeForDeal, useForProduction } from "./stock-reservations";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "Rana Owner" } as never;

type World = {
  client: PoolClient; workspaceId: string; owner: string; opportunityId: string; caseId: string; warehouse: string; showroom: string; sofa: string; fabric: string;
  service: FulfilmentService; furnitureFlow: string;
};

integration("Furniture Only fulfilment and stock by path (PLM-083, PLM-125, PLM-126)", { timeout: 30_000 }, () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(path: string, run: (w: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), owner = randomUUID(), membership = randomUUID(), partyId = randomUUID(), enquiryId = randomUUID(), leadId = randomUUID(),
      opportunityId = randomUUID(), pipelineId = randomUUID(), taxonomyId = randomUUID(), caseId = randomUUID(), catalogId = randomUUID(), sofaCatalog = randomUUID(),
      sofa = randomUUID(), fabric = randomUUID(), warehouse = randomUUID(), showroom = randomUUID(), stage = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Rana Owner')", [owner, `${owner.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `ff-${workspaceId.slice(0, 8)}`, owner]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, owner]);
      await client.query("INSERT INTO crm_taxonomies(id,workspace_id,code,name) VALUES($1,$2,'enquiry_type','Enquiry types')", [taxonomyId, workspaceId]);
      await client.query("INSERT INTO crm_taxonomy_options(workspace_id,taxonomy_id,code,label,flow) VALUES($1,$2,'furniture_only','Furniture Only','furniture')", [workspaceId, taxonomyId]);
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [pipelineId, workspaceId]);
      await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position,probability) VALUES($1,$2,$3,'proposal','Proposal',1,50)", [stage, workspaceId, pipelineId]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya','maya')", [partyId, workspaceId]);
      await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
        VALUES($1,$2,$3,$4,'Sofa','referral','external',now(),'E-1','furniture_only','{}')`, [enquiryId, workspaceId, randomUUID(), partyId]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id) VALUES($1,$2,$3,$4)", [leadId, workspaceId, enquiryId, partyId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,owner_membership_id,title,reference,next_action_at,amount,currency_code,furniture_path,
          conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'Sofa','O-1',now() + interval '1 day',4500,'AED',$8,'lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`,
        [opportunityId, workspaceId, partyId, leadId, pipelineId, stage, membership, path]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, owner]);
      await client.query("INSERT INTO catalogs(id,workspace_id,code,name) VALUES($1,$2,'core','Core Collection')", [catalogId, workspaceId]);
      await client.query("INSERT INTO catalog_items(id,workspace_id,catalog_id,code,name,item_type,unit_code,production_days) VALUES($1,$2,$3,'SOFA-1','Linen sofa','product','pcs',12)",
        [sofaCatalog, workspaceId, catalogId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,'q1',0,1,'quotation','main','accepted','Sofa','AED')",
        [workspaceId, caseId]);
      await client.query(`INSERT INTO commercial_quote_lines(workspace_id,case_id,quote_id,id,sort_order,title,quantity,unit,rate,kind,catalog_item_id)
        VALUES($1,$2,'q1','l1',0,'Linen sofa',2,'pcs',2250,'item',$3),($1,$2,'q1','l2',1,'Delivery',1,'',150,'service',NULL)`, [workspaceId, caseId, sofaCatalog]);
      await client.query("SET LOCAL session_replication_role = origin");
      await ensureStarterFlows(client, workspaceId);
      await client.query("INSERT INTO stock_locations(id,workspace_id,kind,name,is_default) VALUES($1,$2,'warehouse','Main warehouse',true),($3,$2,'other','Showroom',false)",
        [warehouse, workspaceId, showroom]);
      await client.query("INSERT INTO stock_items(id,workspace_id,catalog_item_id,name,unit,code,normal_key) VALUES($1,$2,$3,'Linen sofa','pcs','SOFA-1','linen sofa|pcs'),($4,$2,NULL,'Linen fabric','m','FAB-1','linen fabric|m')",
        [sofa, workspaceId, sofaCatalog, fabric]);
      const put = (itemId: string, locationId: string, quantity: string) => move(client, workspaceId, { batchId: randomUUID(), itemId, locationId, projectId: null, kind: "adjust", quantity,
        reason: "Opening count", movedOn: "2026-10-01", actorId: owner, unitCost: "1000.0000", currency: "AED" });
      await put(sofa, warehouse, "3");
      await put(sofa, showroom, "1");
      await put(fabric, warehouse, "20");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const runWith = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string; displayName: string }) => unknown) => fn(client, { userId: owner, displayName: "Rana Owner" });
      const service = new FulfilmentService({ withPermission: runWith, withAnyPermission: runWith, withPermissions: runWith, hasPermission: async () => true } as never);
      const furnitureFlow = (await client.query<{ id: string }>(`SELECT id FROM crm_flows WHERE workspace_id = $1 AND code = 'furniture'`, [workspaceId])).rows[0].id;
      await run({ client, workspaceId, owner, opportunityId, caseId, warehouse, showroom, sofa, fabric, service, furnitureFlow });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const onHand = async (w: World, itemId: string, locationId: string, projectId: string | null = null) => (await w.client.query<{ onHand: string }>(
    `SELECT on_hand::text AS "onHand" FROM stock_balances WHERE workspace_id = $1 AND item_id = $2 AND location_id = $3 AND project_id IS NOT DISTINCT FROM $4::uuid`,
    [w.workspaceId, itemId, locationId, projectId])).rows[0]?.onHand ?? "0";
  const held = async (w: World) => (await w.client.query<{ source: string; status: string; quantity: string; deducted: string; locationId: string | null }>(
    `SELECT source, status, quantity::text AS quantity, deducted::text AS deducted, location_id AS "locationId" FROM stock_reservations WHERE workspace_id = $1 ORDER BY reserved_at`,
    [w.workspaceId])).rows;
  const win = (w: World) => w.client.query(`UPDATE crm_opportunities SET status = 'won', closed_at = now(), version = version + 1 WHERE id = $1`, [w.opportunityId]);
  const takeFromShowroom = async (w: World, path: string) => {
    const rules = await w.service.rules(actor, w.workspaceId);
    const flow = rules.flows.find((item: { id: string }) => item.id === w.furnitureFlow)!;
    expect(flow.furniture).toBe(true);
    const next = flow.rules.map(({ version: _version, ...rule }: { version: number; furniturePath: string | null; takeFromLocationId: string | null }) =>
      rule.furniturePath === path ? { ...rule, takeFromLocationId: w.showroom } : rule);
    await w.service.saveRules(actor, w.workspaceId, w.furnitureFlow, { rules: next, versions: flow.rules.map((rule: { furniturePath: string | null; version: number }) => `${rule.furniturePath ?? ""}:${rule.version}`) });
  };

  it("L12: the planning case follows its path — stock goes straight to the quotation and fulfilment, bespoke keeps the full journey", async () => {
    await world("in_stock_delivery", async (w) => {
      // No rules saved yet: the furniture flow's product defaults apply (read only, nothing is written).
      expect(await casePlan(w.client, w.workspaceId, w.caseId)).toEqual({ source: "path", phases: ["price", "agree", "release"], siteVisit: false, design: false, release: "fulfilment" });
      expect((await w.client.query(`SELECT 1 FROM crm_flow_fulfilment_rules WHERE workspace_id = $1`, [w.workspaceId])).rowCount).toBe(0);
      // A job pinned to its flow version reads the same plan; a started site visit still shows.
      const version = (await w.client.query<{ id: string }>(`SELECT id FROM crm_flow_versions WHERE workspace_id = $1 AND flow_id = $2 ORDER BY version DESC LIMIT 1`, [w.workspaceId, w.furnitureFlow])).rows[0].id;
      await w.client.query(`UPDATE crm_opportunities SET flow_version_id = $2 WHERE id = $1`, [w.opportunityId, version]);
      await w.client.query(`INSERT INTO design_journeys (workspace_id, case_id, site_visit_questions, started_by) VALUES ($1, $2, '[]', $3)`, [w.workspaceId, w.caseId, w.owner]);
      expect(await casePlan(w.client, w.workspaceId, w.caseId)).toMatchObject({ phases: ["design", "price", "agree", "release"], siteVisit: true, design: false });
      await w.client.query(`UPDATE crm_opportunities SET furniture_path = 'bespoke' WHERE id = $1`, [w.opportunityId]);
      await w.client.query(`DELETE FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [w.workspaceId, w.caseId]);
      expect(await casePlan(w.client, w.workspaceId, w.caseId)).toEqual(FULL_PLAN);
      // A case that doesn't exist reads the full journey.
      const other = randomUUID();
      expect((await casePlans(w.client, w.workspaceId, [w.caseId, other])).get(other)).toEqual(FULL_PLAN);
    });
  });

  it("A: the accepted quotation holds the sofa at the showroom, Won takes it out, a cancellation puts it back — each once", async () => {
    await world("take_home_now", async (w) => {
      await takeFromShowroom(w, "take_home_now");
      await w.client.query(`INSERT INTO stock_reorder_points(id,workspace_id,item_id,location_id,reorder_at,updated_by) VALUES($1,$2,$3,$4,0,$5)`, [randomUUID(), w.workspaceId, w.sofa, w.showroom, w.owner]);
      expect(await reserveForAcceptedQuote(w.client, w.workspaceId, { caseId: w.caseId, actorUserId: w.owner })).toBe(1);
      expect(await reserveForAcceptedQuote(w.client, w.workspaceId, { caseId: w.caseId, actorUserId: w.owner })).toBe(0);
      expect(await held(w)).toEqual([{ source: "quote_line", status: "reserved", quantity: "2.0000", deducted: "0.0000", locationId: w.showroom }]);
      // Held stock isn't free: the showroom is now below its reorder point.
      expect((await readReorderPoints(w.client, w.workspaceId, [w.sofa]))[0]).toMatchObject({ free: "-1.0000", low: true });
      // Not won yet: nothing leaves.
      expect(await takeForDeal(w.client, w.workspaceId, { opportunityId: w.opportunityId, event: "won", actorUserId: w.owner })).toBe(0);
      await win(w);
      expect(await takeForDeal(w.client, w.workspaceId, { opportunityId: w.opportunityId, event: "won", actorUserId: w.owner })).toBe(1);
      expect(await takeForDeal(w.client, w.workspaceId, { opportunityId: w.opportunityId, event: "won", actorUserId: w.owner })).toBe(0);
      // The showroom's one first, then the default place.
      expect([await onHand(w, w.sofa, w.showroom), await onHand(w, w.sofa, w.warehouse)]).toEqual(["0.0000", "2.0000"]);
      expect((await held(w))[0]).toMatchObject({ status: "deducted", deducted: "2.0000" });
      const sales = (await w.client.query<{ kind: string; quantity: string; unitCost: string }>(
        `SELECT kind, quantity::text AS quantity, unit_cost::text AS "unitCost" FROM stock_movements WHERE workspace_id = $1 AND reservation_id IS NOT NULL ORDER BY seq`, [w.workspaceId])).rows;
      expect(sales).toEqual([{ kind: "sale", quantity: "-1.0000", unitCost: "1000.0000" }, { kind: "sale", quantity: "-1.0000", unitCost: "1000.0000" }]);
      // The channel hook (PLM-086) hears about each change of free stock.
      expect(Number((await w.client.query(`SELECT count(*) FROM outbox_events WHERE workspace_id = $1 AND event_type = 'inventory.stock_changed.v1'`, [w.workspaceId])).rows[0].count)).toBe(2);

      const view = await w.service.view(actor, w.workspaceId, w.opportunityId);
      expect(view.plan!.steps.map((step: { key: string; state: string }) => [step.key, step.state])).toEqual([["paid", "done"], ["collected", "current"]]);
      expect(view.boq).toEqual({ chosen: null, byDefault: false, required: false });
      // A refund for part of the deal changes nothing; cancelling the order returns what it took, where it took it from.
      expect(await cancelDealOnFullRefund(w.client, w.workspaceId, { opportunityId: w.opportunityId, total: "500", currency: "AED", reference: "FR-0001", actorUserId: w.owner })).toBe(false);
      await w.service.command(actor, w.workspaceId, w.opportunityId, { commandId: randomUUID(), action: "cancel", version: view.version, reason: "Client changed their mind" });
      expect([await onHand(w, w.sofa, w.showroom), await onHand(w, w.sofa, w.warehouse)]).toEqual(["1.0000", "3.0000"]);
      expect((await held(w))[0]).toMatchObject({ status: "released" });
      expect(await releaseForDeal(w.client, w.workspaceId, { opportunityId: w.opportunityId, reason: "again", actorUserId: w.owner })).toBe(0);
      await expect(w.service.command(actor, w.workspaceId, w.opportunityId, { commandId: randomUUID(), action: "book_delivery", version: view.version + 1, date: "2026-10-10" }))
        .rejects.toThrow(/cancelled/);
    });
  });

  it("A: too little in stock never stops the sale; a full refund cancels the order and returns what was taken", async () => {
    await world("take_home_now", async (w) => {
      await move(w.client, w.workspaceId, { batchId: randomUUID(), itemId: w.sofa, locationId: w.warehouse, projectId: null, kind: "adjust", quantity: "-3", reason: "Sold elsewhere",
        movedOn: "2026-10-01", actorId: w.owner });
      await win(w);
      // Won without the quotation having held anything: it holds it then takes what's there.
      expect(await takeForDeal(w.client, w.workspaceId, { opportunityId: w.opportunityId, event: "won", actorUserId: w.owner })).toBe(1);
      expect((await held(w))[0]).toMatchObject({ status: "deducted", quantity: "2.0000", deducted: "1.0000" });
      expect(await onHand(w, w.sofa, w.showroom)).toBe("0.0000");
      expect(await cancelDealOnFullRefund(w.client, w.workspaceId, { opportunityId: w.opportunityId, total: "4500", currency: "AED", reference: "FR-0002", actorUserId: w.owner })).toBe(true);
      expect(await onHand(w, w.sofa, w.showroom)).toBe("1.0000");
      expect((await w.client.query(`SELECT cancel_reason FROM crm_deal_fulfilment WHERE opportunity_id = $1`, [w.opportunityId])).rows[0].cancel_reason).toBe("Refunded in full (FR-0002)");
    });
  });

  it("B: transfer asked of the factory, the delivery booked, version-checked and replay-safe", async () => {
    await world("in_stock_delivery", async (w) => {
      await win(w);
      const first = await w.service.view(actor, w.workspaceId, w.opportunityId);
      expect(first.plan!.expected).toBeTruthy();
      const commandId = randomUUID();
      const asked = await w.service.command(actor, w.workspaceId, w.opportunityId, { commandId, action: "request_transfer", version: first.version, note: "From the factory" });
      expect(await w.service.command(actor, w.workspaceId, w.opportunityId, { commandId, action: "request_transfer", version: first.version })).toMatchObject({ version: asked.version });
      await expect(w.service.command(actor, w.workspaceId, w.opportunityId, { commandId: randomUUID(), action: "book_delivery", version: first.version, date: "2026-10-12" }))
        .rejects.toThrow(/Someone else changed/);
      await w.service.command(actor, w.workspaceId, w.opportunityId, { commandId: randomUUID(), action: "transfer_arrived", version: asked.version });
      const booked = await w.service.command(actor, w.workspaceId, w.opportunityId, { commandId: randomUUID(), action: "book_delivery", version: asked.version + 1, date: "2026-10-12" });
      expect(booked.plan!.steps.map((step: { key: string; state: string }) => [step.key, step.state])).toEqual([["transfer", "done"], ["delivery_booked", "done"], ["delivered", "current"]]);
      expect(booked.delivery).toMatchObject({ on: "2026-10-12" });
      const audit = (await w.client.query<{ action: string }>(`SELECT action FROM audit_events WHERE workspace_id = $1 AND entity_id = $2 ORDER BY occurred_at`, [w.workspaceId, w.opportunityId])).rows.map((row) => row.action);
      expect(audit).toEqual(expect.arrayContaining(["crm.deal.fulfilment.request_transfer", "crm.deal.fulfilment.transfer_arrived", "crm.deal.fulfilment.book_delivery"]));
    });
  });

  it("PLM-083: BOQ required follows the order's choice, then its path, then the firm's setting", async () => {
    await world("bespoke", async (w) => {
      expect(await boqRequiredForCase(w.client, w.workspaceId, w.caseId, false)).toBe(true);
      const view = await w.service.view(actor, w.workspaceId, w.opportunityId);
      await w.service.command(actor, w.workspaceId, w.opportunityId, { commandId: randomUUID(), action: "set_boq", version: view.version, value: false });
      expect(await boqRequiredForCase(w.client, w.workspaceId, w.caseId, true)).toBe(false);
      await w.client.query(`UPDATE crm_opportunities SET furniture_path = 'take_home_now' WHERE id = $1`, [w.opportunityId]);
      await w.service.command(actor, w.workspaceId, w.opportunityId, { commandId: randomUUID(), action: "set_boq", version: view.version + 1, value: null });
      expect(await boqRequiredForCase(w.client, w.workspaceId, w.caseId, true)).toBe(false);
      // A case without a deal follows the setting.
      expect(await boqRequiredForCase(w.client, w.workspaceId, randomUUID(), true)).toBe(true);
    });
  });

  it("D: booking production holds the materials for the project, starting it uses them; a cancellation gives back what wasn't used", async () => {
    await world("core_collection_factory", async (w) => {
      const projectId = randomUUID(), workOrder = randomUUID(), second = randomUUID();
      await w.client.query("SET LOCAL session_replication_role = replica");
      await w.client.query(`INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by,status,reference,quote_id,started_at) VALUES($1,$2,$3,'Sofa',$4,'active','P-1','q1',now())`, [projectId, w.workspaceId, w.caseId, w.owner]);
      await w.client.query(`INSERT INTO work_orders(id,workspace_id,number,project_id,boq_line_id,title,quantity,created_by,status,released_at) VALUES($1,$2,1,$3,$4,'Sofa',1,$5,'released',now()),($6,$2,2,$3,$4,'Sofa 2',1,$5,'released',now())`,
        [workOrder, w.workspaceId, projectId, randomUUID(), w.owner, second]);
      await w.client.query(`INSERT INTO work_order_materials(id,workspace_id,work_order_id,item_id,quantity,requested_by,status) VALUES($1,$2,$3,$4,8,$5,'active'),($6,$2,$7,$4,5,$5,'active')`,
        [randomUUID(), w.workspaceId, workOrder, w.fabric, w.owner, randomUUID(), second]);
      await w.client.query("SET LOCAL session_replication_role = origin");
      expect(await reserveForProduction(w.client, w.workspaceId, { projectId, actorUserId: w.owner })).toBe(2);
      expect(await reserveForProduction(w.client, w.workspaceId, { projectId, actorUserId: w.owner })).toBe(0);
      expect([await onHand(w, w.fabric, w.warehouse), await onHand(w, w.fabric, w.warehouse, projectId)]).toEqual(["7.0000", "13.0000"]);
      expect(await useForProduction(w.client, w.workspaceId, { workOrderId: workOrder, actorUserId: w.owner })).toBe(1);
      expect(await onHand(w, w.fabric, w.warehouse, projectId)).toBe("5.0000");
      const issued = (await w.client.query<{ quantity: string }>(`SELECT quantity::text AS quantity FROM stock_movements WHERE workspace_id = $1 AND work_order_id = $2 AND kind = 'issue'`,
        [w.workspaceId, workOrder])).rows;
      expect(issued).toEqual([{ quantity: "-8.0000" }]);
      expect((await held(w)).map((row) => row.status).sort()).toEqual(["deducted", "reserved"]);
      await releaseForDeal(w.client, w.workspaceId, { opportunityId: w.opportunityId, reason: "Cancelled", actorUserId: w.owner });
      expect([await onHand(w, w.fabric, w.warehouse), await onHand(w, w.fabric, w.warehouse, projectId)]).toEqual(["12.0000", "0.0000"]);
      expect((await held(w)).map((row) => row.status).sort()).toEqual(["deducted", "released"]);
    });
  });
});
