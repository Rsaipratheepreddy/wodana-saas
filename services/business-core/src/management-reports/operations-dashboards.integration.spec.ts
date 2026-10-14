import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DASHBOARD_ACCESS, REPORT_PERMISSIONS, readDashboard, readRecords } from "./management-reports";
import type { Kpi } from "./report-kit";
import { saveTargets } from "./report-targets";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

// Sunday 20 Sep 2026, 12:00 in New York (16:00 UTC); weeks start on Monday, so this week is 14–20 Sep and next 21–27.
const NOW = new Date("2026-09-20T16:00:00.000Z");
const PERIOD = { from: "2026-09-01", to: "2026-09-20" };

type Ids = Record<string, string>;

integration("production, finance and stock dashboards with PostgreSQL", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  /**
   * A fit-out firm configured generically: two Account Managers (Ali, Sara), three running projects (P1 Ali, P2 Sara,
   * P3 Ali), a deal delivered without a project (O3, Sara), a factory, money in and out, stock and enquiries.
   */
  async function scenario(work: (client: PoolClient, ids: Ids) => Promise<void>) {
    const client = await pool.connect();
    const id = () => randomUUID();
    const keys = ["ws", "other", "owner", "ali", "sara", "mOwner", "mAli", "mSara", "party", "pipeline", "sOpen", "sWon", "taxType", "taxSource", "entity", "vendor",
      "L1", "L2", "L3", "L4", "O1", "O2", "O3", "O4", "C1", "C2", "C3", "C4", "P1", "P2", "P3", "stP1", "stP2", "stP3", "W1", "W2",
      "WO1", "WO2", "WO3", "WO4", "WO5", "WO6", "WO7", "WO8", "warehouse", "site2", "S1", "S2", "S3", "B1", "B2", "B3", "B4", "SP1", "SP2", "SP3",
      "L5", "O5", "O6", "C5", "FL", "FV", "F1", "WO9", "showroom", "snagA", "snagB", "snagC", "snagD"];
    const ids: Ids = Object.fromEntries(keys.map((key) => [key, id()]));
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ids.ws]);
      for (const [user, name] of [[ids.owner, "Olivia Owner"], [ids.ali, "Ali Manager"], [ids.sara, "Sara Manager"]])
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [user, `${user.slice(0, 8)}@example.com`, name]);
      await client.query(`INSERT INTO workspaces(id,name,slug,default_currency,created_by,default_timezone,week_starts_on,default_locale) VALUES($1,'Ops',$2,'USD',$3,'America/New_York',1,'en-ZZ')`,
        [ids.ws, `ops-${ids.ws.slice(0, 8)}`, ids.owner]);
      for (const [membership, user] of [[ids.mOwner, ids.owner], [ids.mAli, ids.ali], [ids.mSara, ids.sara]])
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, ids.ws, user]);
      await client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone,address,status)
        VALUES($1,$2,'E1','Studio','Studio LLC','US','USD','en-US','America/New_York','{}','active')`, [ids.entity, ids.ws]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Amira Client','amira client')", [ids.party, ids.ws]);
      await client.query("INSERT INTO crm_taxonomies(id,workspace_id,code,name) VALUES($1,$2,'enquiry_type','Enquiry type'),($3,$2,'lead_source','Source')", [ids.taxType, ids.ws, ids.taxSource]);
      await client.query(`INSERT INTO crm_taxonomy_options(workspace_id,taxonomy_id,code,label) VALUES($1,$2,'full_id','Full ID'),($1,$2,'furniture_only','Furniture Only')`, [ids.ws, ids.taxType]);
      await client.query(`INSERT INTO crm_taxonomy_options(workspace_id,taxonomy_id,code,label) VALUES($1,$2,'website','Website'),($1,$2,'instagram','Instagram')`, [ids.ws, ids.taxSource]);
      for (const [stage, code, name, position] of [[ids.sOpen, "qualified", "New Opportunity", 1], [ids.sWon, "won", "Won", 5]] as const)
        await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position,probability) VALUES($1,$2,$3,$4,$5,$6,50)", [stage, ids.ws, ids.pipeline, code, name, position]);

      // Enquiries: three in September (website/form ×2, instagram/dm), one in August, and a spam enquiry in September.
      // L1 came through the website form's QR code on the showroom door, L3 through its plain link (PLM-036).
      await client.query(`INSERT INTO crm_lead_forms(id,workspace_id,token,draft,published,status) VALUES($1,$2,'tok','{}','{"title":"Website enquiry"}','published')`, [ids.F1, ids.ws]);
      const lead = async (key: string, created: string, values: { owner: string; type: string; source: string; channel: string; payload?: Record<string, unknown>; spam?: boolean }) => {
        const intake = randomUUID(), enquiry = randomUUID();
        await client.query(`INSERT INTO crm_intake_events(id,workspace_id,source,channel,intake_method,idempotency_key,payload_hash,original_payload,correlation_id,received_at)
          VALUES($1,$2,$3,$4,'form',$6,'h',$7::jsonb,$1,$5)`, [intake, ids.ws, values.source, values.channel, created, `key-${intake}`, JSON.stringify(values.payload ?? {})]);
        await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{}')`, [enquiry, ids.ws, intake, ids.party, `Enquiry ${key}`, values.source, values.channel, created, `E-${key}`, values.type]);
        await client.query(`INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,owner_membership_id,status,created_at,spam_at) VALUES($1,$2,$3,$4,$5,'connected',$6,$7)`,
          [ids[key], ids.ws, enquiry, ids.party, values.owner, created, values.spam ? created : null]);
      };
      await lead("L1", "2026-09-02T14:00:00Z", { owner: ids.mAli, type: "full_id", source: "website", channel: "form",
        payload: { formId: ids.F1, formTitle: "Website enquiry", link: { placement: "showroom-door" } } });
      await lead("L2", "2026-09-03T14:00:00Z", { owner: ids.mSara, type: "furniture_only", source: "instagram", channel: "dm" });
      await lead("L3", "2026-09-05T14:00:00Z", { owner: ids.mAli, type: "full_id", source: "website", channel: "form", payload: { formId: ids.F1, formTitle: "Website enquiry" } });
      await lead("L4", "2026-08-10T14:00:00Z", { owner: ids.mAli, type: "full_id", source: "website", channel: "whatsapp" });
      await lead("L5", "2026-09-06T14:00:00Z", { owner: ids.mSara, type: "full_id", source: "instagram", channel: "dm", spam: true });

      const opportunity = (key: string, values: { lead?: string; owner: string; status: string; stage: string; amount: string; closedAt?: string }) => client.query(
        `INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,
           qualification_evidence_hash,converted_at,owner_membership_id,status,amount,currency_code,closed_at,legal_entity_id,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'lead_qualification',repeat('a',64),'{}',repeat('b',64),now(),$9,$10,$11,'USD',$12,$13,'2026-09-02T15:00:00Z')`,
        [ids[key], ids.ws, ids.party, values.lead ?? null, ids.pipeline, values.stage, `Job ${key}`, `O-${key}`, values.owner, values.status, values.amount, values.closedAt ?? null, ids.entity]);
      await opportunity("O1", { lead: ids.L1, owner: ids.mAli, status: "won", stage: ids.sWon, amount: "31500", closedAt: "2026-09-05T14:00:00Z" });
      await opportunity("O2", { lead: ids.L2, owner: ids.mSara, status: "open", stage: ids.sOpen, amount: "8000" });
      await opportunity("O3", { owner: ids.mSara, status: "won", stage: ids.sWon, amount: "4000", closedAt: "2026-09-08T14:00:00Z" });
      await opportunity("O4", { owner: ids.mAli, status: "won", stage: ids.sWon, amount: "9000", closedAt: "2026-07-08T14:00:00Z" });
      // Furniture Only orders (PLM-131/133) on the firm's furniture flow, with its product rules (none written: a report never seeds them).
      // O5 (path B, in-stock delivery, 3–4 working days): won Tue 8 Sep, delivered Mon 14 Sep — 4 working days, on time.
      // O6 (path A, take home now, same day): won Tue 15 Sep, collected Wed 16 Sep — 1 day late.
      await opportunity("O5", { owner: ids.mAli, status: "won", stage: ids.sWon, amount: "2100", closedAt: "2026-09-08T14:00:00Z" });
      await opportunity("O6", { owner: ids.mAli, status: "won", stage: ids.sWon, amount: "300", closedAt: "2026-09-15T14:00:00Z" });
      await client.query("INSERT INTO crm_flows(id,workspace_id,code,name) VALUES($1,$2,'furniture','Furniture')", [ids.FL, ids.ws]);
      await client.query("INSERT INTO crm_flow_versions(id,workspace_id,flow_id,version,definition,checksum) VALUES($1,$2,$3,1,'{}',repeat('a',64))", [ids.FV, ids.ws, ids.FL]);
      for (const [key, path] of [["O5", "in_stock_delivery"], ["O6", "take_home_now"]])
        await client.query("UPDATE crm_opportunities SET furniture_path = $2, flow_version_id = $3 WHERE id = $1", [ids[key], path, ids.FV]);
      for (const [key, event, at] of [["O5", "delivered", "2026-09-14T14:00:00Z"], ["O6", "collected", "2026-09-16T14:00:00Z"]])
        await client.query("INSERT INTO crm_deal_fulfilment_events(workspace_id,opportunity_id,event,recorded_by,recorded_at) VALUES($1,$2,$3,$4,$5)", [ids.ws, ids[key], event, ids.owner, at]);
      for (const [caseId, opp] of [[ids.C1, ids.O1], [ids.C2, ids.O2], [ids.C3, ids.O3], [ids.C4, ids.O4], [ids.C5, ids.O5]])
        await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,status,created_by) VALUES($1,$2,$3,'active',$4)", [caseId, ids.ws, opp, ids.owner]);

      // Quotations (5 % tax) and O1's two proposals, won in September.
      const quote = (caseId: string, quoteId: string, round: string, total: string) => client.query(
        `INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency,tax_rate,total,detail,hash)
         VALUES($1,$2,$3,1,$4,'quotation',$5,'accepted','Quote','USD',5,$6,'{}','hash')`, [ids.ws, caseId, quoteId, Number(quoteId.replace(/\D/g, "")), round, total]);
      await quote(ids.C1, "q1", "design", "10500");
      await quote(ids.C1, "q2", "main", "21000");
      for (const [kind, amount, wonAt] of [["design", "10500", "2026-09-05T14:00:00Z"], ["main", "21000", "2026-09-14T14:00:00Z"]])
        await client.query(`INSERT INTO crm_opportunity_proposals(workspace_id,opportunity_id,kind,amount,currency_code,value_status,won_at) VALUES($1,$2,$3,$4,'USD','approved',$5)`,
          [ids.ws, ids.O1, kind, amount, wonAt]);
      // O5's accepted quotation: 2 sofas at 850 and a lamp at 400 less 100 (2,000 before tax); an optional cushion and a service line don't count.
      await quote(ids.C5, "q5", "main", "2100");
      const quoteLine = (id: string, values: { title: string; quantity: string; rate: string; item: string | null; kind?: string; optional?: boolean; discount?: string }) => client.query(
        `INSERT INTO commercial_quote_lines(workspace_id,case_id,quote_id,id,sort_order,title,quantity,rate,catalog_item_id,kind,optional,discount_kind,discount_value)
         VALUES($1,$2,'q5',$3,0,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [ids.ws, ids.C5, id, values.title, values.quantity, values.rate, values.item, values.kind ?? "item", values.optional ?? false, values.discount ? "amount" : null, values.discount ?? null]);
      const [sofa, lamp, cushion] = [randomUUID(), randomUUID(), randomUUID()];
      await quoteLine("l1", { title: "Sofa", quantity: "2", rate: "850", item: sofa });
      await quoteLine("l2", { title: "Lamp", quantity: "1", rate: "400", item: lamp, discount: "100" });
      await quoteLine("l3", { title: "Cushion", quantity: "4", rate: "50", item: cushion, optional: true });
      await quoteLine("l4", { title: "Assembly", quantity: "1", rate: "100", item: null, kind: "service" });

      // ----- Projects. P1 (Ali): at Production with a late task, delivery on the 16th, installation on the 18th (late), handover 5 Oct.
      // P2 (Sara): at Installation, delivery 23rd, installation 24th, past its promised handover (15th). P3 (Ali): at Production, on track.
      const project = (key: string, caseId: string, values: { reference: string; promise: string; delivery?: string; installation?: string }) => client.query(
        `INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by,status,reference,quote_id,started_at,promise_date,delivery_on,installation_on,currency)
         VALUES($1,$2,$3,$4,$5,'active',$6,'q2','2026-08-01T14:00:00Z',$7,$8,$9,'USD')`,
        [ids[key], ids.ws, caseId, `Villa ${key}`, ids.owner, values.reference, values.promise, values.delivery ?? null, values.installation ?? null]);
      await project("P1", ids.C1, { reference: "PRJ-1", promise: "2026-10-05", delivery: "2026-09-16", installation: "2026-09-18" });
      await project("P2", ids.C2, { reference: "PRJ-2", promise: "2026-09-15", delivery: "2026-09-23", installation: "2026-09-24" });
      await project("P3", ids.C4, { reference: "PRJ-3", promise: "2026-12-01" });
      for (const [stage, projectId, key, name, position] of [[ids.stP1, ids.P1, "production", "Production", 5], [ids.stP2, ids.P2, "installation", "Installation", 7],
        [ids.stP3, ids.P3, "production", "Production", 5]] as const)
        await client.query(`INSERT INTO project_stages(id,workspace_id,project_id,position,key,name,status,started_at) VALUES($1,$2,$3,$4,$5,$6,'current','2026-09-01T14:00:00Z')`,
          [stage, ids.ws, projectId, position, key, name]);
      await client.query(`INSERT INTO work_items(id,workspace_id,project_id,number,type,title,status,due_date,stage_id,created_by) VALUES($1,$2,$3,1,'task','Cut panels','todo','2026-09-10',$4,$5)`,
        [randomUUID(), ids.ws, ids.P1, ids.stP1, ids.owner]);
      await client.query(`INSERT INTO crm_deal_fulfilment(workspace_id,opportunity_id,delivery_on,delivery_booked_at) VALUES($1,$2,'2026-09-18','2026-09-10T14:00:00Z')`, [ids.ws, ids.O3]);
      await client.query(`INSERT INTO crm_deal_fulfilment(workspace_id,opportunity_id,delivery_on,delivery_booked_at) VALUES($1,$2,'2026-09-14','2026-09-09T14:00:00Z')`, [ids.ws, ids.O5]);
      // Snags: two open on P1 (3 and 19 days), one done on P1, one open on P2 for 41 days.
      const snag = (key: string, projectId: string, number: number, created: string, status = "todo") => client.query(
        `INSERT INTO work_items(id,workspace_id,project_id,number,type,title,status,severity,source,created_by,created_at,completed_at,completed_by)
         VALUES($1,$2,$3,$4,'snag',$5,$6,'minor','inspection',$7,$8,$9,$10)`,
        [ids[key], ids.ws, projectId, number, `Snag ${key}`, status, ids.owner, created, status === "done" ? created : null, status === "done" ? ids.owner : null]);
      await snag("snagA", ids.P1, 2, "2026-09-17T14:00:00Z");
      await snag("snagB", ids.P1, 3, "2026-09-01T14:00:00Z");
      await snag("snagC", ids.P1, 4, "2026-09-02T14:00:00Z", "done");
      await snag("snagD", ids.P2, 1, "2026-08-10T14:00:00Z");

      // Permits: P1's expires on the 25th; P2's expired on the 10th (an older one of the same type is superseded); P1's other lasts the year.
      const permit = (projectId: string, type: string, validTo: string) => client.query(
        `INSERT INTO building_permits(id,workspace_id,project_id,status,permit_type,permit_number,valid_from,valid_to,collected_on,file_key,recorded_at,note,cancel_reason,created_by)
         VALUES($1,$2,$3,'collected',$4,'N-1','2026-01-01',$5,'2026-01-02','k',now(),'','',$6)`, [randomUUID(), ids.ws, projectId, type, validTo, ids.owner]);
      await permit(ids.P1, "access", "2026-09-25");
      await permit(ids.P1, "noise", "2026-12-31");
      await permit(ids.P2, "access", "2026-09-10");
      await permit(ids.P2, "access", "2026-09-01");

      // ----- Factory: W1 has 8 hours a day; W2 has no capacity set.
      await client.query("INSERT INTO workcenters(id,workspace_id,name,hours_per_day,active,position) VALUES($1,$3,'Joinery',8,true,1),($2,$3,'Paint',null,true,2)", [ids.W1, ids.W2, ids.ws]);
      const order = (key: string, number: number, projectId: string, values: { status: string; start?: string; end?: string; hours?: string; center?: string; readyOn?: string;
        quantity?: string; heldFrom?: string }) => client.query(
        `INSERT INTO work_orders(id,workspace_id,number,project_id,boq_line_id,title,quantity,unit,status,workcenter_id,planned_start,planned_end,planned_hours,released_at,ready_on,ready_at,
           closed_at,close_reason,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,'nos',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [ids[key], ids.ws, number, projectId, randomUUID(), `Item ${key}`, values.quantity ?? "1", values.status, values.center ?? null, values.start ?? null, values.end ?? null,
          values.hours ?? null, ["released", "in_production", "ready"].includes(values.status) ? "2026-08-20T14:00:00Z" : null, values.readyOn ?? null,
          values.readyOn ? `${values.readyOn}T14:00:00Z` : null, values.status === "cancelled" ? "2026-09-01T14:00:00Z" : null, values.status === "cancelled" ? "Dropped" : null, ids.owner]);
      await order("WO1", 1, ids.P1, { status: "planned", start: "2026-09-21", end: "2026-09-25", hours: "50", center: ids.W1 });
      await order("WO2", 2, ids.P1, { status: "in_production", start: "2026-09-14", end: "2026-09-15", hours: "16", center: ids.W1 });
      await order("WO3", 3, ids.P1, { status: "ready", end: "2026-09-12", readyOn: "2026-09-10" });
      await order("WO4", 4, ids.P2, { status: "ready", end: "2026-09-12", readyOn: "2026-09-16" });
      await order("WO5", 5, ids.P2, { status: "ready", end: "2026-08-25", readyOn: "2026-08-20" });
      await order("WO6", 6, ids.P2, { status: "ready", readyOn: "2026-09-05" });
      await order("WO7", 7, ids.P1, { status: "cancelled", end: "2026-09-01" });
      await order("WO8", 8, ids.P2, { status: "in_production", quantity: "2", end: "2026-09-30" });
      // WO9 on P3 (promised for December): past its own planned end only — late against the internal date.
      await order("WO9", 9, ids.P3, { status: "in_production", end: "2026-09-18" });
      // WO1 is what makes C1's Balance due (the joinery balance before installation, PLM-067).
      await client.query("UPDATE work_orders SET ready_payment_id = 'Balance' WHERE id = $1", [ids.WO1]);
      // WO8 is all made and waits for its check; WO6 was dispatched and arrived on P2's site on the 17th.
      await client.query(`INSERT INTO work_order_reports(id,workspace_id,work_order_id,good,scrap,scrap_reason,note,status,reported_by,reported_at,decided_by,decided_at,decision_note)
        VALUES($1,$2,$3,2,0,'','','approved',$4,'2026-09-18T14:00:00Z',$5,'2026-09-18T15:00:00Z','')`, [randomUUID(), ids.ws, ids.WO8, ids.ali, ids.owner]);
      await client.query(`INSERT INTO stock_locations(id,workspace_id,kind,name,project_id,address,is_default,active) VALUES($1,$3,'warehouse','Main',null,'',true,true),($2,$3,'site','Site P2',$4,'',false,true)`,
        [ids.warehouse, ids.site2, ids.ws, ids.P2]);
      await client.query(`INSERT INTO stock_transfers(id,workspace_id,number,from_location_id,to_location_id,status,note,sent_on,sent_by,received_on,received_by,work_order_id)
        VALUES($1,$2,1,$3,$4,'received','','2026-09-16',$5,'2026-09-17',$5,$6)`, [randomUUID(), ids.ws, ids.warehouse, ids.site2, ids.owner, ids.WO6]);

      // ----- Stock: S1 hardware (10 free + 5 owned by P1, 1,500), S2 fabric (20 free, 2,000) at the main store; S3 uncategorised (4 free, 400) in the showroom.
      await client.query(`INSERT INTO stock_locations(id,workspace_id,kind,name,project_id,address,is_default,active) VALUES($1,$2,'other','Showroom',null,'',false,true)`, [ids.showroom, ids.ws]);
      for (const [item, name, category] of [[ids.S1, "Hinge", "Hardware"], [ids.S2, "Linen", "Fabric"], [ids.S3, "Lamp", ""]])
        await client.query("INSERT INTO stock_items(id,workspace_id,name,unit,code,normal_key,category) VALUES($1,$2,$3,'nos',$4,$5,$6)", [item, ids.ws, name, `SKU-${name}`, name.toLowerCase(), category]);
      for (const [item, project, onHand, value, place] of [[ids.S1, null, "10", "1000", ids.warehouse], [ids.S1, ids.P1, "5", "500", ids.warehouse], [ids.S2, null, "20", "2000", ids.warehouse],
        [ids.S3, null, "4", "400", ids.showroom]])
        await client.query("INSERT INTO stock_balances(workspace_id,item_id,location_id,project_id,on_hand,value) VALUES($1,$2,$3,$4,$5,$6)", [ids.ws, item, place, project, onHand, value]);
      // WO1 needs 10 of S1, and P1 owns only 5 of it: short.
      await client.query(`INSERT INTO work_order_materials(id,workspace_id,work_order_id,position,item_id,quantity,status,reason,requested_by,requested_at,decision_note)
        VALUES($1,$2,$3,0,$4,10,'active','',$5,now(),'')`, [randomUUID(), ids.ws, ids.WO1, ids.S1, ids.owner]);
      // O3 holds 2 of S1; S1's reorder point is 12 with nothing on order (short); S2's is 5.
      await client.query(`INSERT INTO stock_reservations(id,workspace_id,source,source_key,opportunity_id,item_id,quantity,status,deducted,returned,reason,reserved_at)
        VALUES($1,$2,'quote_line','x',$3,$4,2,'reserved',0,0,'','2026-09-10T14:00:00Z')`, [randomUUID(), ids.ws, ids.O3, ids.S1]);
      await client.query(`INSERT INTO stock_reorder_points(id,workspace_id,item_id,reorder_at,updated_by) VALUES($1,$2,$3,12,$5),($4,$2,$6,5,$5)`, [randomUUID(), ids.ws, ids.S1, randomUUID(), ids.owner, ids.S2]);
      // Movements, all at 100 each (the balances above are what they leave): S1 came in on 1 Aug, 5 went out to P1 on 1 Sep and 5 were
      // allocated to P1 on 2 Sep; S2 came in on 10 Jan and never went out; S3 last sold on 1 Aug 2025.
      const movement = (item: string, kind: string, quantity: string, on: string, owner: string | null = null) => client.query(
        `INSERT INTO stock_movements(id,workspace_id,batch_id,item_id,location_id,project_id,kind,quantity,reason,moved_on,actor_id,receipt_line_id,for_project_id,reservation_id,unit_cost,currency)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'',$9,$10,$11,$12,$13,100,'USD')`,
        [randomUUID(), ids.ws, randomUUID(), item, ids.warehouse, owner, kind, quantity, on, ids.owner, kind === "receive" ? randomUUID() : null, kind === "issue" ? ids.P1 : null,
          kind === "sale" ? randomUUID() : null]);
      await movement(ids.S1, "receive", "20", "2026-08-01");
      await movement(ids.S1, "issue", "-5", "2026-09-01");
      await movement(ids.S1, "allocate", "-5", "2026-09-02");
      await movement(ids.S1, "allocate", "5", "2026-09-02", ids.P1);
      await movement(ids.S2, "receive", "20", "2026-01-10");
      await movement(ids.S3, "receive", "6", "2025-06-01");
      await movement(ids.S3, "sale", "-2", "2025-08-01");

      // Purchases: PO1 for P1 (1,000 net) and PO2 for stock (2,000 net) in September; PO3 in August; PO4 cancelled; PO5 a draft.
      await client.query(`INSERT INTO workspace_vendors(workspace_id,id,code,display_name,capabilities,notes,status,created_by,updated_by,categories,approval,preferred_for,approval_note,payment_terms,
          terms_note,deal,deal_note,retention_percent) VALUES($1,$2,'V1','Timber Co','{materials}','','active',$3,$3,'{}','pending','{}','','on_delivery','','none','',0)`, [ids.ws, ids.vendor, ids.owner]);
      const purchase = async (number: string, status: string, approvedAt: string | null, total: string, tax: string, projectId: string | null) => {
        const orderId = randomUUID();
        await client.query(`INSERT INTO purchase_orders(id,workspace_id,number,legal_entity_id,vendor_id,currency,status,payment_terms,terms_note,deliver_to,delivery_address,supplier_reference,notes,
            subtotal,discount_total,tax_total,total,revision,created_by,approved_at,cancelled_at,cancel_reason,retention_percent,sent_at)
          VALUES($1,$2,$3,$4,$5,'USD',$6,'on_delivery','','warehouse','','','',$7,0,$8,$9,1,$10,$11,$12,$13,0,$14)`,
          [orderId, ids.ws, number, ids.entity, ids.vendor, status, String(Number(total) - Number(tax)), tax, total, ids.owner, approvedAt,
            status === "cancelled" ? "2026-09-07T14:00:00Z" : null, status === "cancelled" ? "No longer needed" : null, ["sent", "received"].includes(status) ? approvedAt : null]);
        await client.query(`INSERT INTO purchase_order_lines(id,workspace_id,order_id,position,project_id,source,description,specification,quantity,unit,unit_price,discount_percent,tax_rate,net,tax,total,
            cancelled_quantity,alternate_specification,alternate_note) VALUES($1,$2,$3,0,$4,'free','Line','',1,'nos',$5,0,5,$5,$6,$7,0,'','')`,
          [randomUUID(), ids.ws, orderId, projectId, String(Number(total) - Number(tax)), tax, total]);
      };
      await purchase("PO-1", "approved", "2026-09-05T14:00:00Z", "1050", "50", ids.P1);
      await purchase("PO-2", "sent", "2026-09-10T14:00:00Z", "2100", "100", null);
      await purchase("PO-3", "received", "2026-08-10T14:00:00Z", "525", "25", null);
      await purchase("PO-4", "cancelled", "2026-09-06T14:00:00Z", "999", "0", null);
      await purchase("PO-5", "draft", null, "700", "0", null);

      // ----- Money on C1: Design fee 10,500 and Deposit 21,000 (due 15 Sep) and Balance 5,000 (due 15 Oct).
      await client.query(`INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{"financeContext":{"currency":"USD"}}')`, [ids.ws, ids.C1]);
      for (const [payId, amount, due, source] of [["Design fee", "10500", "2026-09-05", "q1"], ["Deposit", "21000", "2026-09-15", "q2"], ["Balance", "5000", "2026-10-15", "q2"]])
        await client.query(`INSERT INTO commercial_payments(workspace_id,case_id,id,sort_order,title,amount,due_date,status,source_quote_id,currency,legal_entity_id) VALUES($1,$2,$3,0,$3,$4,$5,'pending',$6,'USD',$7)`,
          [ids.ws, ids.C1, payId, amount, due, source, ids.entity]);
      const receipt = (receiptId: string, payId: string, amount: string, status: string, detail: Record<string, string>, currency = "USD") => client.query(
        `INSERT INTO commercial_receipts(workspace_id,case_id,id,sort_order,payment_id,legal_entity_id,currency,amount,source,status,detail) VALUES($1,$2,$3,0,$4,$5,$6,$7,'manual',$8,$9::jsonb)`,
        [ids.ws, ids.C1, receiptId, payId, ids.entity, currency, amount, status, JSON.stringify(detail)]);
      await receipt("r1", "Design fee", "10500", "finance_verified", { verifiedAt: "2026-09-06T14:00:00Z" });
      await receipt("r2", "Deposit", "21000", "finance_verified", { verifiedAt: "2026-09-12T14:00:00Z" });
      // Verified in August, rejected on 5 September: in in August, out again in September.
      await receipt("r3", "Deposit", "1050", "rejected", { verifiedAt: "2026-08-10T14:00:00Z", rejectedAt: "2026-09-05T14:00:00Z" });
      await receipt("r4", "Deposit", "700", "finance_verified", { verifiedAt: "2026-09-12T14:00:00Z" }, "EUR");
      for (const [allocationId, receiptId, payId, amount] of [["a1", "r1", "Design fee", "10500"], ["a2", "r2", "Deposit", "10000"]])
        await client.query(`INSERT INTO commercial_allocations(workspace_id,case_id,id,sort_order,receipt_id,payment_id,legal_entity_id,currency,amount) VALUES($1,$2,$3,0,$4,$5,$6,'USD',$7)`,
          [ids.ws, ids.C1, allocationId, receiptId, payId, ids.entity, amount]);
      const invoice = (number: string, payId: string, quoteId: string, issued: string, due: string, net: string, tax: string, total: string) => client.query(
        `INSERT INTO client_invoices(id,workspace_id,legal_entity_id,project_id,case_id,payment_id,quote_id,number,issue_date,due_date,currency,net,tax,total,prices_include_tax,milestone_title,
           customer_name,company_name,issued_by,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'USD',$11,$12,$13,false,$6,'Amira','Studio',$14,'issued')`,
        [randomUUID(), ids.ws, ids.entity, ids.P1, ids.C1, payId, quoteId, number, issued, due, net, tax, total, ids.owner]);
      await invoice("INV-1", "Design fee", "q1", "2026-09-06", "2026-09-06", "10000", "500", "10500");
      await invoice("INV-2", "Deposit", "q2", "2026-09-12", "2026-09-15", "20000", "1000", "21000");

      // Deal Files and their commission lines (PLM-132): C1 (Ali) approved 15 Sep — sales 420 and a designer's 300; C3 (Sara) approved 10 Sep —
      // a referral of 100; C4 (Ali) approved in August.
      const dealFile = (caseId: string, reference: string, quoteId: string, approvedAt: string, lines: Array<{ recipientName: string; type: string; amount: number }>) => client.query(
        `INSERT INTO commercial_deal_files(workspace_id,case_id,id,reference,revision,quote_id,quote_hash,value,cost,margin,commission,status,detail)
         VALUES($1,$2,$3,$4,1,$5,'hash',0,0,0,$6,'active',$7::jsonb)`,
        [ids.ws, caseId, randomUUID(), reference, quoteId, lines.reduce((total, line) => total + line.amount, 0),
          JSON.stringify({ approvedAt, commissionLines: lines.map((line) => ({ ...line, basis: "amount", value: line.amount })) })]);
      await dealFile(ids.C1, "DF-1", "q2", "2026-09-15T14:00:00.000Z", [{ recipientName: "Ali Manager", type: "sales", amount: 420 }, { recipientName: "Lina Designer", type: "designer", amount: 300 }]);
      await dealFile(ids.C3, "DF-3", "none", "2026-09-10T14:00:00.000Z", [{ recipientName: "Omar Referrer", type: "referral", amount: 100 }]);
      await dealFile(ids.C4, "DF-4", "none", "2026-08-10T14:00:00.000Z", [{ recipientName: "Ali Manager", type: "sales", amount: 180 }]);

      // Supplier payments: 5,000 on the 8th (1,000 of it on B1), one reversed, 1,000 in August.
      const payment = (key: string, amount: string, paidOn: string, status = "recorded") => client.query(
        `INSERT INTO supplier_payments(id,workspace_id,vendor_id,legal_entity_id,paid_on,currency,amount,method,reference,status,reverse_reason,created_by) VALUES($1,$2,$3,$4,$5,'USD',$6,'cash',$7,$8,$9,$10)`,
        [ids[key], ids.ws, ids.vendor, ids.entity, paidOn, amount, key, status, status === "reversed" ? "Wrong supplier" : null, ids.owner]);
      await payment("SP1", "5000", "2026-09-08");
      await payment("SP2", "2000", "2026-09-09", "reversed");
      await payment("SP3", "1000", "2026-08-15");
      // Bills: B1 3,000 due on the 18th (1,000 paid: 2,000 overdue), B2 4,000 due on the 25th, B3 due in November, B4 a draft.
      for (const [key, number, due, total, status] of [["B1", "BILL-1", "2026-09-18", "3000", "approved"], ["B2", "BILL-2", "2026-09-25", "4000", "approved"],
        ["B3", "BILL-3", "2026-11-30", "900", "approved"], ["B4", "BILL-4", "2026-09-19", "800", "draft"]])
        await client.query(`INSERT INTO supplier_invoices(id,workspace_id,vendor_id,legal_entity_id,number,invoice_date,due_date,currency,net,tax,total,status,hold_reasons,approval_note,created_by,approved_at)
          VALUES($1,$2,$3,$4,$5,'2026-09-01',$6,'USD',$7,0,$7,$8,'','',$9,$10)`, [ids[key], ids.ws, ids.vendor, ids.entity, number, due, total, status, ids.owner, status === "approved" ? "2026-09-02T14:00:00Z" : null]);
      await client.query("INSERT INTO supplier_payment_allocations(id,workspace_id,payment_id,invoice_id,amount,created_by) VALUES($1,$2,$3,$4,1000,$5)", [randomUUID(), ids.ws, ids.SP1, ids.B1, ids.owner]);

      // Petty cash on P1: 300 transport reimbursed on the 9th, 200 food waiting, 150 tools approved (to pay).
      const claim = (number: number, amount: string, category: string, status: string, spentOn: string) => client.query(
        `INSERT INTO petty_cash_claims(id,workspace_id,number,project_id,spent_on,amount,currency,description,category,no_receipt_reason,status,claimed_by,submitted_at,decided_by,decided_at,
           decision_note,reimbursed_by,reimbursed_at,reimbursement_reference) VALUES($1,$2,$3,$4,$5,$6,'USD',$7,$8,'lost',$9,$10,'2026-09-12T14:00:00Z',$11,$12,'',$13,$14,'')`,
        [randomUUID(), ids.ws, number, ids.P1, spentOn, amount, `Claim ${number}`, category, status, ids.ali, ["approved", "reimbursed"].includes(status) ? ids.owner : null,
          ["approved", "reimbursed"].includes(status) ? "2026-09-12T15:00:00Z" : null, status === "reimbursed" ? ids.owner : null, status === "reimbursed" ? "2026-09-09T14:00:00Z" : null]);
      await claim(1, "300", "transport", "reimbursed", "2026-09-08");
      await claim(2, "200", "food", "submitted", "2026-09-10");
      await claim(3, "150", "tools", "approved", "2026-09-11");

      // Finance requests: an invoice request a day old on O1, a supplier payment request 15 days old, a refund already done.
      const request = (number: number, kind: string, status: string, opportunity: string | null, created: string, total: string, reason = "", closedAt: string | null = null) => client.query(
        `INSERT INTO finance_requests(id,workspace_id,number,kind,status,source,requested_by,party_id,opportunity_id,currency,client_email,client_tax_number,payment_stage_title,payment_terms,
           contract_reference,order_number,payment_method,tax_code,tax_label,total_amount,invoice_number,reason,bank_details,supplier_reference,supplier_tax_number,paid_on_statement,
           remarks,finance_reference,internal_note,closed_by,closed_at,close_note,created_at,updated_at,legal_entity_id,invoice_kind,tax_rate,net_amount,tax_amount,vendor_id,pay_now_amount,
           material_location)
         VALUES($1,$2,$3,$4,$5,'manual',$6,$7,$8,'USD',$14,'','','','','','','','',$9,'',$10,'','','',false,'','','',$11,$12,'',$13,$13,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [randomUUID(), ids.ws, number, kind, status, ids.owner, ids.party, opportunity, total, reason, closedAt ? ids.owner : null, closedAt, created,
          kind === "invoice" ? "client@example.com" : "", kind === "invoice" ? ids.entity : null, kind === "invoice" ? "standard" : null, kind === "invoice" ? "5" : null,
          kind === "invoice" ? String(Number(total) / 1.05) : null, kind === "invoice" ? String(Number(total) - Number(total) / 1.05) : null, kind === "payable" ? ids.vendor : null,
          kind === "payable" ? total : null, kind === "payable" ? "office" : null]);
      await request(1, "invoice", "new", ids.O1, "2026-09-19T14:00:00Z", "5250");
      await request(2, "payable", "in_progress", null, "2026-09-05T14:00:00Z", "800");
      await request(3, "refund", "done", ids.O1, "2026-09-15T14:00:00Z", "1050", "Item not delivered", "2026-09-19T14:00:00Z");
      await request(4, "refund", "done", null, "2026-09-10T14:00:00Z", "300", "Damaged", "2026-09-12T14:00:00Z");
      await request(5, "refund", "done", null, "2026-08-01T14:00:00Z", "500", "Damaged", "2026-08-12T14:00:00Z");

      // First-response clocks: L1 answered in 30 working minutes, L2 in 90.
      for (const [leadId, owner, minutes] of [[ids.L1, ids.mAli, 30], [ids.L2, ids.mSara, 90]] as const)
        await client.query(`INSERT INTO crm_sla_instances(workspace_id,policy_id,lead_id,target_type,target_id,event_type,cycle,calculation_mode,policy_snapshot,status,started_at,warning_at,due_at,
            owner_membership_id,responded_at,response_elapsed_minutes,stopped_at,response_source_type,response_source_id)
          VALUES($1,$2,$3,'lead',$3,'first_response',1,'business','{"breachAfterMinutes":60}','stopped','2026-09-04T14:00:00Z','2026-09-04T14:00:00Z','2026-09-04T15:00:00Z',$4,
            '2026-09-04T16:00:00Z',$5,'2026-09-04T16:00:00Z','activity',gen_random_uuid())`, [ids.ws, randomUUID(), leadId, owner, minutes]);

      // Another tenant's records on the same days are never counted.
      await client.query(`INSERT INTO work_orders(id,workspace_id,number,project_id,boq_line_id,title,quantity,unit,status,planned_end,ready_on,released_at,created_by)
        VALUES($1,$2,1,$3,$4,'Not ours',1,'nos','ready','2026-09-12','2026-09-11','2026-09-01T00:00:00Z',$5)`, [randomUUID(), ids.other, ids.P1, randomUUID(), ids.owner]);
      await client.query(`INSERT INTO stock_balances(workspace_id,item_id,location_id,on_hand,value) VALUES($1,$2,$3,99,9900)`, [ids.other, ids.S1, ids.warehouse]);
      await client.query(`INSERT INTO supplier_payments(id,workspace_id,vendor_id,legal_entity_id,paid_on,currency,amount,method,reference,status,created_by)
        VALUES($1,$2,$3,$4,'2026-09-08','USD',777,'cash','x','recorded',$5)`, [randomUUID(), ids.other, ids.vendor, ids.entity, ids.owner]);

      await work(client, ids);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const kpi = (kpis: Kpi[], code: string) => {
    const found = kpis.find((item) => item.code === code);
    if (!found) throw new Error(`No KPI ${code}`);
    return found;
  };
  const bars = (item: Kpi) => Object.fromEntries((item.chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((bar) => [bar.key, bar.count]));

  it("reads Production and delivery from the factory, the projects and logistics", async () => {
    await scenario(async (client, ids) => {
      await saveTargets(client, ids.ws, ids.owner, { commandId: randomUUID(), changes: [{ kpi: "on_time_rate", month: "2026-09", membershipId: null, target: "80", version: null },
        { kpi: "fo_lead_time_rate", month: "2026-09", membershipId: null, target: "80", version: null }] });
      // PLM-131: every KPI on Palm's tab — four figures, five charts and the list that needs attention.
      const page = await readDashboard(client, ids.ws, "production-delivery", PERIOD, NOW);
      expect(page.layout).toEqual({ tiles: ["late_work_orders", "ready_upcoming", "open_snags", "fo_lead_time"],
        charts: ["work_orders_status", "ready_upcoming", "bookings", "open_snags", "fo_lead_time"], attention: "production_attention" });
      expect(page.kpis.map((item) => item.code).sort()).toEqual(["bookings", "fo_lead_time", "late_work_orders", "open_snags", "production_attention", "ready_upcoming", "work_orders_status"]);
      // Late jobs: WO2 and WO1 on P1 (its delivery day, the 16th, has passed), WO8 on P2 (past its promised date, the 15th), WO9 on P3 past its own planned end.
      expect(kpi(page.kpis, "late_work_orders")).toMatchObject({ value: "4", extra: { clientDate: 3 } });
      const late = await readRecords(client, ids.ws, "production-delivery", { ...PERIOD, kpi: "late_work_orders" }, NOW);
      expect(late.records.map((record) => [record.reference, record.measure, record.detail])).toEqual([["WO-0002", "5", "client_date"], ["WO-0008", "5", "client_date"],
        ["WO-0001", "4", "client_date"], ["WO-0009", "2", "internal_date"]]);
      expect(late.records[0].href).toBe(`/workspace/factory/orders?order=${ids.WO2}`);
      // Ready this week (14–20 Sep): WO2 planned for the 15th, WO4 made ready on the 16th, WO9 planned for the 18th; next week: WO1 on the 25th.
      const ready = kpi(page.kpis, "ready_upcoming");
      expect(ready).toMatchObject({ value: "4", extra: { thisWeek: 3, nextWeek: 1 } });
      const timeline = ready.chart as Extract<Kpi["chart"], { type: "columns" }>;
      expect([timeline.categories[0].key, timeline.categories.at(-1)!.key, timeline.series.map((item) => item.id)]).toEqual(["2026-09-14", "2026-09-27", ["ready", "planned"]]);
      expect(timeline.values).toEqual([["0", "0", "1", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"], ["0", "1", "0", "0", "1", "0", "0", "0", "0", "0", "0", "1", "0", "0"]]);
      // Open snags by project and age: P1 3 and 19 days (its done one left out), P2 41 days.
      const snags = kpi(page.kpis, "open_snags");
      expect(snags).toMatchObject({ value: "3", extra: { over30: 1 } });
      const byAge = snags.chart as Extract<Kpi["chart"], { type: "columns" }>;
      expect(byAge.categories).toEqual([{ key: ids.P1, label: "PRJ-1" }, { key: ids.P2, label: "PRJ-2" }]);
      expect(byAge.values).toEqual([["1", "0"], ["1", "0"], ["0", "1"]]);
      const fresh = await readRecords(client, ids.ws, "production-delivery", { ...PERIOD, kpi: "open_snags", bucket: `period=1;projectGroup=${ids.P1};age=days_0_7` }, NOW);
      expect(fresh.records.map((record) => [record.title, record.measure, record.href])).toEqual([["Snag snagA", "3", `/workspace/projects/${ids.P1}/plan?filter=snags&item=${ids.snagA}`]]);
      // Furniture Only lead times: O5 (B) 4 working days against 4, on time; O6 (A) 1 day against same day, late. 50 % against an 80 % target.
      const lead = kpi(page.kpis, "fo_lead_time");
      expect(lead).toMatchObject({ value: "50.0", count: 2, extra: { onTime: 1, late: 1, noTarget: 0 }, previous: expect.objectContaining({ value: null, change: null }) });
      expect(lead.target).toMatchObject({ target: "80.0000", percent: "62.5", tone: "danger" });
      expect((lead.chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((item) => [item.key, item.value, item.count, item.extra])).toEqual([
        ["take_home_now", "1.0", 1, { target: "0.0", onTime: "0.0" }], ["in_stock_delivery", "4.0", 1, { target: "4.0", onTime: "100.0" }],
        ["supplier_order", "0", 0, { target: null, onTime: null }], ["core_collection_factory", "0", 0, { target: null, onTime: null }], ["bespoke", "0", 0, { target: null, onTime: null }]]);
      const takeHome = await readRecords(client, ids.ws, "production-delivery", { ...PERIOD, kpi: "fo_lead_time", bucket: "period=1;path=take_home_now" }, NOW);
      expect(takeHome.records.map((record) => [record.reference, record.measure, record.href])).toEqual([["O-O6", "1", `/workspace/crm/opportunities?record=${ids.O6}`]]);
      // A report never writes: the furniture flow's rules were read as their defaults, not seeded.
      expect((await client.query("SELECT count(*)::int AS n FROM crm_flow_fulfilment_rules WHERE workspace_id = $1", [ids.ws])).rows[0].n).toBe(0);
      // Deliveries and installations booked, as the logistics calendar holds them: in the period O5 (14th), P1 (16th, installation 18th), O3 (18th);
      // P2's on the 23rd and 24th are on the calendar too.
      const booked = kpi(page.kpis, "bookings");
      expect(booked).toMatchObject({ value: "4", extra: { deliveries: 3, installations: 1 } });
      expect(booked.chart).toEqual({ type: "calendar", dimension: "day", seriesDimension: "kind", month: "2026-09", weekStart: 1, entries: [
        { day: "2026-09-14", series: "delivery", count: 1 }, { day: "2026-09-16", series: "delivery", count: 1 }, { day: "2026-09-18", series: "delivery", count: 1 },
        { day: "2026-09-18", series: "installation", count: 1 }, { day: "2026-09-23", series: "delivery", count: 1 }, { day: "2026-09-24", series: "installation", count: 1 }] });
      const onTheEighteenth = await readRecords(client, ids.ws, "production-delivery", { ...PERIOD, kpi: "bookings", bucket: "day=2026-09-18" }, NOW);
      expect(onTheEighteenth.records.map((record) => [record.reference, record.detail, record.href])).toEqual([
        ["O-O3", "delivery", `/workspace/crm/opportunities?record=${ids.O3}`], ["PRJ-1", "installation", `/workspace/projects/${ids.P1}/overview`]]);
      // Production schedule: the open work orders by step, on track against late.
      const status = kpi(page.kpis, "work_orders_status");
      expect(status).toMatchObject({ value: "7", extra: { delivered: 1, late: 4 } });
      const schedule = status.chart as Extract<Kpi["chart"], { type: "columns" }>;
      expect([schedule.categories.map((item) => item.key), schedule.series.map((item) => item.id)]).toEqual([["scheduled", "in_production", "quality_check", "ready"], ["on_track", "late"]]);
      expect(schedule.values).toEqual([["0", "0", "0", "3"], ["1", "2", "1", "0"]]);
      // Needs attention, most days late first: P2's permit (10 days), WO2 and WO8 (5), P2's handover (5), WO1 (4); nine in all.
      expect(page.attention?.total).toBe(9);
      expect(page.attention?.records.map((record) => [record.detail, record.measure])).toEqual([
        ["permit_expired", "10"], ["late_work_order", "5"], ["late_work_order", "5"], ["late_handover", "5"], ["late_work_order", "4"]]);
      expect(page.attention?.records[1].href).toBe(`/workspace/factory/orders?order=${ids.WO2}`);

      // Everything the dashboard knows is still read the same way (and opens its records).
      const { kpis } = await readDashboard(client, ids.ws, "production-delivery", PERIOD, NOW, undefined, "all");
      // Made ready in the period: WO3 on time, WO4 4 days late, WO6 without a planned end. August (1–20): WO5 on time.
      expect(kpi(kpis, "work_orders_made")).toMatchObject({ value: "3", previous: { from: "2026-08-01", to: "2026-08-20", value: "1", change: "200.0", better: "higher" } });
      const onTime = kpi(kpis, "on_time_rate");
      expect(onTime).toMatchObject({ value: "50.0", count: 3, extra: { onTime: 1, late: 1, noDate: 1 } });
      expect(onTime.previous).toEqual({ from: "2026-08-01", to: "2026-08-20", value: "100.0", change: "-50.0", better: "higher" });
      expect(onTime.target).toMatchObject({ target: "80.0000", percent: "62.5", tone: "danger" });
      expect(kpi(kpis, "work_orders_delivered")).toMatchObject({ value: "1", previous: expect.objectContaining({ value: "0", change: null }) });
      expect(kpi(kpis, "installations_done")).toMatchObject({ value: "0" });
      // WO2's 16 hours this week, WO1's 50 next week; Joinery's 8 h × 5 days × 8 weeks = 320 h; next week (50 h > 40 h) is over.
      const load = kpi(kpis, "factory_load");
      expect(load).toMatchObject({ value: "66.0", count: 2, extra: { capacity: "320.0", percent: "20.6", overloaded: 1 } });
      expect((load.chart as Extract<Kpi["chart"], { type: "columns" }>).values).toEqual([["16.0", "50.0", "0.0", "0.0", "0.0", "0.0", "0.0", "0.0"]]);
      expect(kpi(kpis, "material_shortages")).toMatchObject({ value: "1" });
      expect(kpi(kpis, "deliveries_upcoming")).toMatchObject({ value: "3", extra: { thisWeek: 2, nextWeek: 1 } });
      expect(bars(kpi(kpis, "installations_scheduled"))).toEqual({ late: 1, this_week: 0, next_week: 1, later: 0 });
      expect(bars(kpi(kpis, "permits_expiring"))).toEqual({ expired: 1, within_7: 1, within_30: 0 });
      const stages = kpi(kpis, "projects_by_stage");
      expect(stages).toMatchObject({ value: "3", extra: { late: 2 } });
      expect((stages.chart as Extract<Kpi["chart"], { type: "columns" }>).categories.map((item) => [item.key, item.label])).toEqual([["production", "Production"], ["installation", "Installation"]]);
      expect((stages.chart as Extract<Kpi["chart"], { type: "columns" }>).values).toEqual([["1", "0"], ["1", "1"]]);
      expect(bars(kpi(kpis, "handovers_due"))).toEqual({ overdue: 1, within_7: 0, within_30: 1 });

      const short = await readRecords(client, ids.ws, "production-delivery", { ...PERIOD, kpi: "material_shortages" }, NOW);
      expect(short.records.map((record) => [record.reference, record.detail])).toEqual([["WO-0001", "Hinge 5 nos"]]);
      const overdue = await readRecords(client, ids.ws, "production-delivery", { ...PERIOD, kpi: "handovers_due", bucket: "period=1;due=overdue" }, NOW);
      expect(overdue.records.map((record) => record.href)).toEqual([`/workspace/projects/${ids.P2}/handover`]);
      const nextWeek = await readRecords(client, ids.ws, "production-delivery", { ...PERIOD, kpi: "factory_load", bucket: `week=2026-09-21;centre=${ids.W1}` }, NOW);
      expect(nextWeek.records.map((record) => [record.reference, record.measure, record.href])).toEqual([["WO-0001", "50.0", `/workspace/factory/orders?order=${ids.WO1}`]]);
      const everything = await readRecords(client, ids.ws, "production-delivery", { ...PERIOD, kpi: "production_attention" }, NOW);
      expect(everything.total).toBe(9);

      // Sara's records only: P2's work orders and the deal she delivers; none of the Furniture Only orders (Ali's).
      const sara = await readDashboard(client, ids.ws, "production-delivery", { ...PERIOD, accountManager: ids.mSara }, NOW, undefined, "all");
      expect((kpi(sara.kpis, "work_orders_status").chart as Extract<Kpi["chart"], { type: "columns" }>).values).toEqual([["0", "0", "0", "2"], ["0", "0", "1", "0"]]);
      expect(kpi(sara.kpis, "work_orders_delivered").value).toBe("1");
      expect(kpi(sara.kpis, "deliveries_upcoming")).toMatchObject({ value: "2", extra: { thisWeek: 1, nextWeek: 1 } });
      expect(kpi(sara.kpis, "late_work_orders").value).toBe("1");
      expect(kpi(sara.kpis, "open_snags").value).toBe("1");
      expect(kpi(sara.kpis, "fo_lead_time")).toMatchObject({ value: null, count: 0 });
      expect(kpi(sara.kpis, "bookings")).toMatchObject({ value: "1", extra: { deliveries: 1, installations: 0 } });
    });
  });

  it("reads Finance from the money records, with the project P&L for margins", async () => {
    await scenario(async (client, ids) => {
      await saveTargets(client, ids.ws, ids.owner, { commandId: randomUUID(), changes: [{ kpi: "cash_in", month: "2026-09", membershipId: null, target: "45000", version: null }] });
      // PLM-132: every KPI on Palm's tab — four figures, five charts and two lists.
      const page = await readDashboard(client, ids.ws, "finance", PERIOD, NOW);
      expect(page.layout).toEqual({ tiles: ["cash_collected", "refunds", "joinery_balances_due", "payables_due"],
        charts: ["collected_invoiced", "receivables_ageing", "finance_requests_open", "refunds", "commissions"], attention: null, lists: ["joinery_balances_due", "payables_due"] });
      // Cash collected before tax: design fee 10,000 + production 20,000 − the 1,000 rejected (EUR left out); August 1–20: 1,000.
      // Target 45,000 × 20/30 = 30,000: 96.7 %, amber. Invoiced (issued invoices' net): 30,000.
      const collected = kpi(page.kpis, "cash_collected");
      expect(collected).toMatchObject({ value: "29000.00", count: 4, extra: { invoiced: "30000.00" }, notes: { otherCurrency: 1 },
        previous: expect.objectContaining({ value: "1000.00", change: "2800.0", better: "higher" }) });
      expect(collected.target).toMatchObject({ target: "30000.0000", percent: "96.7", tone: "warning" });
      // By month and company, with invoiced as the line.
      const byMonth = kpi(page.kpis, "collected_invoiced").chart as Extract<Kpi["chart"], { type: "columns" }>;
      expect(byMonth.series).toEqual([{ id: ids.entity, label: "Studio" }]);
      expect(byMonth.values.map((row) => row.slice(-2))).toEqual([["1000.00", "29000.00"]]);
      expect(byMonth.line?.values.slice(-2)).toEqual(["0.00", "30000.00"]);
      const invoiced = await readRecords(client, ids.ws, "finance", { ...PERIOD, kpi: "collected_invoiced", bucket: "month=2026-09;series=invoiced" }, NOW);
      expect(invoiced.records.map((record) => [record.reference, record.amount])).toEqual([["INV-2", "20000.000000"], ["INV-1", "10000.000000"]]);
      const studio = await readRecords(client, ids.ws, "finance", { ...PERIOD, kpi: "collected_invoiced", bucket: `month=2026-09;entity=${ids.entity}` }, NOW);
      expect(studio.records.every((record) => record.kind === "receipt")).toBe(true);
      // Refunds done in the period: 1,050 on O1 (1,000 before tax) and 300 without a deal; one in August. By reason.
      const refunds = kpi(page.kpis, "refunds");
      expect(refunds).toMatchObject({ value: "2", amount: "1300.00", previous: expect.objectContaining({ value: "1", change: "100.0", better: "lower" }) });
      expect((refunds.chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((item) => [item.key, item.count, item.amount])).toEqual([
        ["item not delivered", 1, "1000.00"], ["damaged", 1, "300.00"]]);
      // Owed: Deposit 11,000 1–30 days overdue, Balance 5,000 not due, all Studio's.
      const owed = kpi(page.kpis, "receivables_ageing");
      expect(owed).toMatchObject({ value: "16000.00", extra: { overdue: "11000.00", overdueCount: 1 }, notes: { amountsIncludeTax: true } });
      expect((owed.chart as Extract<Kpi["chart"], { type: "columns" }>).values).toEqual([["5000.00", "11000.00", "0.00", "0.00", "0.00"]]);
      // The joinery balance WO1 makes due: C1's Balance, due on P1's installation day (18th, before its own 15 Oct) — 2 days overdue.
      expect(kpi(page.kpis, "joinery_balances_due")).toMatchObject({ value: "5000.00", count: 1, extra: { overdue: 1, overdueValue: "5000.00" } });
      expect(page.lists?.[0]).toMatchObject({ kpi: "joinery_balances_due", total: 1,
        records: [expect.objectContaining({ reference: "PRJ-1", title: "Balance", amount: "5000.000000", measure: "2", detail: "overdue", href: `/workspace/projects/${ids.P1}/money` })] });
      // Payables by due date: the supplier payment request (800, asked for on the 5th), B1's 2,000 overdue, B2's 4,000 within a week.
      const payables = kpi(page.kpis, "payables_due");
      expect(payables).toMatchObject({ value: "6800.00", count: 3, extra: { overdue: "2000.00", overdueCount: 1, requested: 1 } });
      expect(bars(payables)).toEqual({ requested: 1, overdue: 1, within_7: 1, within_30: 0 });
      expect(page.lists?.[1]).toMatchObject({ kpi: "payables_due", total: 3 });
      expect(page.lists?.[1].records.map((record) => [record.reference, record.title, record.amount])).toEqual([["FR-0002", "Timber Co", "800.000000"],
        ["BILL-1", "Timber Co", "2000.000000"], ["BILL-2", "Timber Co", "4000.000000"]]);
      // Open Finance Requests by type and age.
      expect(kpi(page.kpis, "finance_requests_open")).toMatchObject({ value: "2", amount: "6050.00" });
      expect((kpi(page.kpis, "finance_requests_open").chart as Extract<Kpi["chart"], { type: "columns" }>).values).toEqual([["1", "0", "0"], ["0", "0", "0"], ["0", "0", "1"]]);
      // Commissions due from the Deal Files approved in September: Ali 420 + 300, Sara's deal a 100 referral; August's 180 left out. Paid isn't recorded.
      const commissions = kpi(page.kpis, "commissions");
      expect(commissions).toMatchObject({ value: "820.00", count: 3, notes: { notRecorded: "commission_payments" } });
      expect((commissions.chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((item) => [item.key, item.label, item.value, item.count])).toEqual([
        [ids.mAli, "Ali Manager", "720.00", 2], [ids.mSara, "Sara Manager", "100.00", 1]]);
      const alis = await readRecords(client, ids.ws, "finance", { ...PERIOD, kpi: "commissions", bucket: `period=1;am=${ids.mAli}` }, NOW);
      expect(alis.records.map((record) => [record.title, record.detail, record.amount, record.href])).toEqual([
        ["Ali Manager", "sales", "420.000000", `/workspace/pre-projects/cases/${ids.C1}/execution-release`],
        ["Lina Designer", "designer", "300.000000", `/workspace/pre-projects/cases/${ids.C1}/execution-release`]]);

      const { kpis } = await readDashboard(client, ids.ws, "finance", PERIOD, NOW, undefined, "all");
      // The cash statement: in 10,500 + 21,000 − 1,050 rejected (tax included); August 1–20: 1,050 verified.
      const cashIn = kpi(kpis, "cash_in");
      expect(cashIn).toMatchObject({ value: "30450.00", notes: { otherCurrency: 1 }, previous: expect.objectContaining({ value: "1050.00", change: "2800.0" }) });
      expect(cashIn.notes?.basis).toBeUndefined();
      // Out: 5,000 paid (not the reversed one) + 300 petty cash reimbursed; August: 1,000.
      expect(kpi(kpis, "cash_out")).toMatchObject({ value: "5300.00", previous: expect.objectContaining({ value: "1000.00", change: "430.0", better: "lower" }) });
      // Revenue before tax: design fee 10,000; production 20,000 less the 1,000 rejected. August: the 1,000 later rejected.
      expect(kpi(kpis, "revenue_mix")).toMatchObject({ value: "29000.00", extra: { design_fees: "10000.00", production: "19000.00", variations: "0.00" },
        previous: expect.objectContaining({ value: "1000.00" }) });
      const cash = kpi(kpis, "cash_in_out");
      expect((cash.chart as Extract<Kpi["chart"], { type: "lines" }>).values.map((row) => row.slice(-2))).toEqual([["1050.00", "30450.00"], ["1000.00", "5300.00"], ["50.00", "25150.00"]]);
      // Needs attention (in the records), biggest first: the overdue Deposit, B1's 2,000 overdue, the supplier payment request waiting 15 days.
      const attention = await readRecords(client, ids.ws, "finance", { ...PERIOD, kpi: "finance_attention" }, NOW);
      expect(attention.records.map((record) => [record.detail, record.amount, record.href])).toEqual([
        ["client_overdue", "11000.000000", `/workspace/pre-projects/cases/${ids.C1}`], ["bill_overdue", "2000.000000", `/workspace/finance/bills?bill=${ids.B1}`],
        ["request_waiting", "800.000000", expect.stringMatching(/^\/workspace\/finance\/requests\?request=/)]]);
      // Issued 31,500; collected 10,500 + 10,000; INV-2 is overdue since the 15th.
      expect(kpi(kpis, "invoices_collected")).toMatchObject({ value: "31500.00", count: 2, extra: { collected: "20500.00", rate: "65.1", overdue: 1 } });
      const margins = kpi(kpis, "project_margins");
      expect(margins.notes?.basis).toBe("records");
      expect(bars(margins)).toMatchObject({ no_revenue: 2 });
      expect(kpi(kpis, "petty_cash")).toMatchObject({ value: "450.00", count: 2, extra: { waiting: 1, waitingValue: "200.00", toPay: 1, toPayValue: "150.00" } });

      // Drill-down opens each record where it lives.
      const out = await readRecords(client, ids.ws, "finance", { ...PERIOD, kpi: "cash_out" }, NOW);
      expect(out.records.map((record) => [record.kind, record.amount, record.href]).sort()).toEqual([
        ["petty_cash", "-300.000000", expect.stringMatching(/^\/workspace\/finance\/petty-cash\?claim=/)], ["supplier_payment", "-5000.000000", `/workspace/finance/payments?payment=${ids.SP1}`]]);
      const overdueBills = await readRecords(client, ids.ws, "finance", { ...PERIOD, kpi: "payables_due", bucket: "period=1;due=overdue" }, NOW);
      expect(overdueBills.records.map((record) => [record.reference, record.amount, record.measure, record.href])).toEqual([["BILL-1", "2000.000000", "2", `/workspace/finance/bills?bill=${ids.B1}`]]);

      // Company records (supplier payments, bills, requests without a deal) drop out under a sales filter.
      const ali = await readDashboard(client, ids.ws, "finance", { ...PERIOD, accountManager: ids.mAli }, NOW, undefined, "all");
      expect(kpi(ali.kpis, "cash_in").value).toBe("30450.00");
      expect(kpi(ali.kpis, "cash_out").value).toBe("300.00");
      expect(kpi(ali.kpis, "cash_collected").value).toBe("29000.00");
      expect(kpi(ali.kpis, "payables_due")).toMatchObject({ value: "0.00", count: 0 });
      expect(kpi(ali.kpis, "joinery_balances_due").value).toBe("5000.00");
      expect(kpi(ali.kpis, "commissions").value).toBe("720.00");
      const aliAttention = await readRecords(client, ids.ws, "finance", { ...PERIOD, accountManager: ids.mAli, kpi: "finance_attention" }, NOW);
      expect(aliAttention.records.map((record) => record.detail)).toEqual(["client_overdue"]);
      // Who doesn't see margins doesn't get the margins figure, nor its records.
      const noMargins = await readDashboard(client, ids.ws, "finance", PERIOD, NOW, (code) => code !== "commercial.costs.view", "all");
      expect(noMargins.kpis.map((item) => item.code)).not.toContain("project_margins");
      await expect(readRecords(client, ids.ws, "finance", { ...PERIOD, kpi: "project_margins" }, NOW, (code) => code !== "commercial.costs.view")).rejects.toThrow("Unknown KPI");
    });
  });

  it("reads Stock and marketing, and the marketing figures on Sales and marketing", async () => {
    await scenario(async (client, ids) => {
      await saveTargets(client, ids.ws, ids.owner, { commandId: randomUUID(), changes: [{ kpi: "lead_source_won_value", month: "2026-09", membershipId: null, target: "40000", version: null }] });
      // PLM-133: every KPI on Palm's tab — four figures, five charts and the low stock list.
      const page = await readDashboard(client, ids.ws, "stock", PERIOD, NOW);
      expect(page.layout).toEqual({ tiles: ["low_stock", "reserved_available", "best_sellers", "lead_source_won"],
        charts: ["reserved_available", "best_sellers", "lead_sources", "form_links", "spam_by_source"], attention: null, lists: ["low_stock"] });
      // S1: 10 free less 2 held for O3 = 8, at or below 12 with nothing on order: short.
      expect(kpi(page.kpis, "low_stock")).toMatchObject({ value: "1", extra: { short: 1 } });
      expect(page.lists).toEqual([expect.objectContaining({ kpi: "low_stock", total: 1,
        records: [expect.objectContaining({ title: "Hinge", measure: "8.0000", href: `/workspace/inventory/history?item=${ids.S1}` })] })]);
      // Reserved vs available by place, at S1's average cost (1,500 ÷ 15 = 100): at the main store reserved 5 owned by P1 + 2 held for O3 (a hold
      // without a place counts where most of the item is free) = 700, available 8 + S2's 20 = 2,800; in the showroom S3's 4 = 400.
      const stock = kpi(page.kpis, "reserved_available");
      expect(stock).toMatchObject({ value: "700.00", extra: { available: "3200.00" } });
      const byPlace = stock.chart as Extract<Kpi["chart"], { type: "columns" }>;
      expect(byPlace.categories).toEqual([{ key: ids.warehouse, label: "Main" }, { key: ids.showroom, label: "Showroom" }]);
      expect(byPlace.values).toEqual([["700.00", "0.00"], ["2800.00", "400.00"]]);
      const showroom = await readRecords(client, ids.ws, "stock", { ...PERIOD, kpi: "reserved_available", bucket: `place=${ids.showroom};series=available` }, NOW);
      expect(showroom.records.map((record) => [record.title, record.measure, record.amount])).toEqual([["Lamp", "4.0000", "400.000000"]]);
      // Best-selling Furniture Only items: O5's 2 sofas (1,700) and the lamp (400 less 100); the optional cushion and the service line don't count.
      const best = kpi(page.kpis, "best_sellers");
      expect(best).toMatchObject({ value: "2000.00", count: 2, previous: expect.objectContaining({ value: "0.00", change: null }) });
      expect((best.chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((item) => [item.label, item.value, item.extra])).toEqual([
        ["Sofa", "1700.00", { quantity: "2" }], ["Lamp", "300.00", { quantity: "1" }]]);
      // Won value from enquiries: O1's two proposals from the website form (10,000 + 20,000 before tax); deals without an enquiry left out.
      // Target 40,000 × 20/30 = 26,666.67: 112.5 %, green.
      const fromLeads = kpi(page.kpis, "lead_source_won");
      expect(fromLeads).toMatchObject({ value: "30000.00", count: 2, previous: expect.objectContaining({ value: "0.00", change: null }) });
      expect(fromLeads.target).toMatchObject({ target: "26666.6667", percent: "112.5", tone: "success" });
      // Lead source performance: enquiries against Won value, per source and channel.
      const sources = kpi(page.kpis, "lead_sources");
      expect((sources.chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((item) => [item.key, item.value, item.count, item.extra])).toEqual([
        ["website/form", "30000.00", 2, { leads: 2, won: 2 }], ["instagram/dm", "0.00", 1, { leads: 1, won: 0 }]]);
      const website = await readRecords(client, ids.ws, "stock", { ...PERIOD, kpi: "lead_sources", bucket: "period=1;pairGroup=website/form" }, NOW);
      expect(website.records.map((record) => record.kind).sort()).toEqual(["lead", "lead", "opportunity", "opportunity"]);
      // Form / QR performance: L1 through the QR on the showroom door, L3 through the plain link; L2 didn't come through a form.
      const forms = kpi(page.kpis, "form_links");
      expect(forms).toMatchObject({ value: "2" });
      expect((forms.chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((item) => [item.key, item.label, item.count])).toEqual([
        [`${ids.F1}|`, "Website enquiry", 1], [`${ids.F1}|showroom-door`, "Website enquiry · showroom-door", 1]]);
      // PLM-138: spam by source and channel.
      expect(bars(kpi(page.kpis, "spam_by_source"))).toEqual({ "instagram/dm": 1 });

      const { kpis: all } = await readDashboard(client, ids.ws, "stock", PERIOD, NOW, undefined, "all");
      // At 20 September: S1 10 free + 5 P1's, S2 20, S3 4, at 100 each; at 20 August S1 still had 20.
      expect(kpi(all, "stock_value")).toMatchObject({ value: "3900.00", count: 3, previous: expect.objectContaining({ value: "4400.00", change: "-11.4", better: "neutral" }) });
      expect(kpi(all, "purchases")).toMatchObject({ value: "3000.00", count: 2, previous: expect.objectContaining({ value: "500.00", change: "500.0", better: "neutral" }) });
      // 5 of S1 issued to P1 on 1 September; nothing used in August.
      expect(kpi(all, "stock_used")).toMatchObject({ value: "500.00", previous: expect.objectContaining({ value: "0.00", change: null }) });
      // S2 never went out since 10 Jan (253 days); S3 last sold 1 Aug 2025 (415 days). S1 went out on 1 Sep.
      const slow = kpi(all, "slow_moving");
      expect(slow).toMatchObject({ value: "2", amount: "2400.00" });
      expect(bars(slow)).toEqual({ days_90_180: 0, days_181_365: 1, over_365: 1 });

      const linen = await readRecords(client, ids.ws, "stock", { ...PERIOD, kpi: "slow_moving", bucket: "period=1;idle=days_181_365" }, NOW);
      expect(linen.records.map((record) => [record.title, record.measure, record.href])).toEqual([["Linen", "253", `/workspace/inventory/history?item=${ids.S2}`]]);
      const orders = await readRecords(client, ids.ws, "stock", { ...PERIOD, kpi: "purchases" }, NOW);
      expect(orders.records.map((record) => record.reference)).toEqual(["PO-2", "PO-1"]);
      // The old address opens the dashboard it moved into.
      expect((await readDashboard(client, ids.ws, "stock-marketing", PERIOD, NOW)).dashboard).toBe("stock");

      // A sales filter keeps what its deals and projects own: P1's 500 of S1 and its order; free stock and stock orders drop out.
      const ali = await readDashboard(client, ids.ws, "stock", { ...PERIOD, accountManager: ids.mAli }, NOW, undefined, "all");
      expect(kpi(ali.kpis, "stock_value").value).toBe("500.00");
      expect(kpi(ali.kpis, "stock_used").value).toBe("500.00");
      expect(kpi(ali.kpis, "purchases").value).toBe("1000.00");
      expect(kpi(ali.kpis, "reserved_available")).toMatchObject({ value: "500.00", extra: { available: "0.00" } });
      expect(kpi(ali.kpis, "low_stock").value).toBe("0");
      // A member who reads enquiries but not stock sees the marketing half only.
      const marketer = await readDashboard(client, ids.ws, "stock", PERIOD, NOW, (code) => code === "crm.leads.view");
      expect(marketer.layout).toEqual({ tiles: ["lead_source_won"], charts: ["lead_sources", "form_links", "spam_by_source"], attention: null, lists: [] });

      const sales = await readDashboard(client, ids.ws, "sales-pipeline", PERIOD, NOW);
      // PLM-138: the spam figures by source and channel are a chart of their own.
      expect(sales.layout).toEqual({ tiles: ["new_leads", "conversion_funnel", "response_rate", "lost"], charts: ["new_leads", "won_by_source", "spam_by_source"], attention: "sales_attention" });
      const { kpis } = await readDashboard(client, ids.ws, "sales-pipeline", PERIOD, NOW, undefined, "all");
      const bySource = kpi(kpis, "enquiries_by_source");
      expect(bySource).toMatchObject({ value: "3", previous: expect.objectContaining({ value: "1", change: "200.0" }) });
      expect((bySource.chart as Extract<Kpi["chart"], { type: "columns" }>).series.map((item) => item.id)).toEqual(["website/form", "instagram/dm", "website/whatsapp"]);
      const byType = kpi(kpis, "enquiries_by_type");
      expect((byType.chart as Extract<Kpi["chart"], { type: "columns" }>).series.map((item) => [item.id, item.label])).toEqual([["full_id", "Full ID"], ["furniture_only", "Furniture Only"]]);
      const conversion = kpi(kpis, "conversion_by_source");
      expect(conversion).toMatchObject({ value: "33.3", count: 3 });
      expect((conversion.chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((item) => [item.key, item.count, item.value])).toEqual([["website", 2, "50.0"], ["instagram", 1, "0.0"]]);
      // O1's two proposals, won from a website enquiry (10,000 + 20,000 before tax), and O3, O5 and O6, won without an enquiry before proposals existed
      // (4,000 and 300 as entered, O5's 2,100 before its quotation's tax: 2,000).
      const won = kpi(kpis, "won_by_source");
      expect(won).toMatchObject({ value: "36300.00", count: 5 });
      expect((won.chart as Extract<Kpi["chart"], { type: "bars" }>).items).toEqual([expect.objectContaining({ key: "website", label: "Website", value: "30000.00", extra: { leads: 2 } }),
        expect.objectContaining({ key: "none", value: "6300.00", extra: { leads: 0 } })]);
      const response = kpi(kpis, "response_by_source");
      expect(response).toMatchObject({ value: "1.00", extra: { rate: "50.0" } });
      expect((response.chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((item) => [item.key, item.value])).toEqual([["website", "0.50"], ["instagram", "1.50"]]);
    });
  });

  it("asks only for permissions that exist, and says 'not enough data' rather than a zero", async () => {
    await scenario(async (client, ids) => {
      const known = (await client.query<{ code: string }>("SELECT code FROM permissions WHERE code = ANY($1)", [REPORT_PERMISSIONS])).rows.map((row) => row.code);
      expect(known.sort()).toEqual([...REPORT_PERMISSIONS].sort());
      expect(Object.keys(DASHBOARD_ACCESS).sort()).toEqual(["finance", "production-delivery", "stock"]);
      const july = { from: "2026-07-01", to: "2026-07-31" };
      const production = await readDashboard(client, ids.ws, "production-delivery", july, NOW);
      expect(kpi(production.kpis, "fo_lead_time")).toMatchObject({ value: null, previous: expect.objectContaining({ value: null, change: null }) });
      const all = await readDashboard(client, ids.ws, "production-delivery", july, NOW, undefined, "all");
      expect(kpi(all.kpis, "on_time_rate")).toMatchObject({ value: null, previous: expect.objectContaining({ value: null, change: null }) });
      const sales = await readDashboard(client, ids.ws, "sales-pipeline", july, NOW, undefined, "all");
      expect(kpi(sales.kpis, "conversion_by_source").value).toBeNull();
      expect(kpi(sales.kpis, "response_by_source").value).toBeNull();
    });
  });
});
