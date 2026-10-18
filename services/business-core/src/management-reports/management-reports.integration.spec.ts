import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readDashboard, readFilterOptions, readRecords } from "./management-reports";
import type { Kpi } from "./report-kit";
import { readTargets, saveTargets } from "./report-targets";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

// Sunday 20 Sep 2026, 12:00 in New York (16:00 UTC). The period is 1–20 September, local days.
const NOW = new Date("2026-09-20T16:00:00.000Z");
const PERIOD = { from: "2026-09-01", to: "2026-09-20" };

type Ids = Record<string, string>;

integration("management dashboards with PostgreSQL", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  /** A Palm-like firm, configured generically: two Account Managers, a designer, a visualiser, two enquiry types. */
  async function scenario(work: (client: PoolClient, ids: Ids) => Promise<void>) {
    const client = await pool.connect();
    const id = () => randomUUID();
    const ids: Ids = {
      ws: id(), other: id(), owner: id(), ali: id(), sara: id(), dana: id(), vic: id(),
      mOwner: id(), mAli: id(), mSara: id(), mDana: id(), mVic: id(), party: id(), pipeline: id(),
      sNew: id(), sQualified: id(), sProposal: id(), sWon: id(), sLost: id(), taxType: id(), taxSource: id(), pkConcept: id(), pkBespoke: id(), policy: id(),
      L1: id(), L2: id(), L3: id(), L4: id(), L5: id(), L6: id(), L7: id(), L8: id(), L9: id(),
      O1: id(), O2: id(), O3: id(), O4: id(), O5: id(), C1: id(), C3: id(), C4: id(), P1: id(),
      O6: id(), O7: id(), C7: id(), L10: id(), L11: id(), L12: id(), R1: id(), R2: id(), R3: id(),
    };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ids.ws]);
      for (const [user, name] of [[ids.owner, "Olivia Owner"], [ids.ali, "Ali Manager"], [ids.sara, "Sara Manager"], [ids.dana, "Dana Designer"], [ids.vic, "Vic Visualiser"]])
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [user, `${user.slice(0, 8)}@example.com`, name]);
      await client.query(`INSERT INTO workspaces(id,name,slug,default_currency,created_by,default_timezone,week_starts_on) VALUES($1,'Reports',$2,'USD',$3,'America/New_York',1)`,
        [ids.ws, `reports-${ids.ws.slice(0, 8)}`, ids.owner]);
      for (const [membership, user] of [[ids.mOwner, ids.owner], [ids.mAli, ids.ali], [ids.mSara, ids.sara], [ids.mDana, ids.dana], [ids.mVic, ids.vic]])
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, ids.ws, user]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Amira Client','amira client')", [ids.party, ids.ws]);
      // Configuration: enquiry types (with their flows), sources, packages, the sales pipeline.
      await client.query("INSERT INTO crm_taxonomies(id,workspace_id,code,name) VALUES($1,$2,'enquiry_type','Enquiry type'),($3,$2,'lead_source','Source')", [ids.taxType, ids.ws, ids.taxSource]);
      await client.query(`INSERT INTO crm_taxonomy_options(workspace_id,taxonomy_id,code,label,flow) VALUES($1,$2,'full_id','Full ID','design'),($1,$2,'furniture_only','Furniture Only','furniture')`, [ids.ws, ids.taxType]);
      await client.query(`INSERT INTO crm_taxonomy_options(workspace_id,taxonomy_id,code,label) VALUES($1,$2,'website','Website'),($1,$2,'instagram','Instagram')`, [ids.ws, ids.taxSource]);
      await client.query(`INSERT INTO design_packages(id,workspace_id,code,name,pricing_method,rate,currency) VALUES($1,$3,'concept','Concept Package','per_space',10000,'USD'),($2,$3,'bespoke','Bespoke Interior Design','fixed',8000,'USD')`,
        [ids.pkConcept, ids.pkBespoke, ids.ws]);
      for (const [stage, code, name, position] of [[ids.sNew, "qualified", "New Opportunity", 1], [ids.sQualified, "qualification", "Qualified", 2], [ids.sProposal, "proposal", "Proposal", 3], [ids.sWon, "won", "Won", 5], [ids.sLost, "lost", "Lost", 6]] as const)
        await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position,probability) VALUES($1,$2,$3,$4,$5,$6,50)", [stage, ids.ws, ids.pipeline, code, name, position]);

      // Enquiries. L9 came in at 1 September 03:00 UTC, which is still 31 August in New York: August, not the period.
      const lead = async (key: string, created: string, values: { owner?: string | null; type: string; source: string; channel?: string; status?: string; spam?: boolean;
        duplicateOf?: string; originalSource?: string; nextActionAt?: string; customerType?: string; region?: string }) => {
        const intake = randomUUID(), enquiry = randomUUID();
        await client.query(`INSERT INTO crm_intake_events(id,workspace_id,source,channel,intake_method,idempotency_key,payload_hash,original_payload,correlation_id,received_at)
          VALUES($1,$2,$3,$4,'form',$6,'h','{}',$1,$5)`, [intake, ids.ws, values.source, values.channel ?? "form", created, `key-${intake}`]);
        await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details,original_source)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [enquiry, ids.ws, intake, ids.party, `Enquiry ${key}`, values.source, values.channel ?? "form", created, `E-${key}`, values.type,
          JSON.stringify({ customerType: values.customerType ?? "homeowner", emirate: values.region ?? "dubai" }), values.originalSource ?? null]);
        const qualified = values.status === "qualified";
        await client.query(`INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,owner_membership_id,status,created_at,spam_at,duplicate_of_lead_id,next_action_at,
            qualified_at,qualification_evidence,qualification_evidence_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [ids[key], ids.ws, enquiry, ids.party, values.owner ?? null, values.status ?? "new", created, values.spam ? created : null,
          values.duplicateOf ?? null, values.nextActionAt ?? null, qualified ? created : null, qualified ? "{}" : null, qualified ? "a".repeat(64) : null]);
      };
      await lead("L1", "2026-09-02T14:00:00Z", { owner: ids.mAli, type: "full_id", source: "website", status: "qualified" });
      await lead("L2", "2026-09-03T14:00:00Z", { owner: ids.mSara, type: "furniture_only", source: "instagram", status: "qualified", customerType: "company", region: "abu_dhabi" });
      await lead("L3", "2026-09-04T14:00:00Z", { owner: null, type: "full_id", source: "website" });
      await lead("L4", "2026-09-06T14:00:00Z", { owner: ids.mSara, type: "full_id", source: "website", status: "duplicate", duplicateOf: ids.L3 });
      await lead("L5", "2026-09-07T14:00:00Z", { owner: ids.mAli, type: "full_id", source: "returning_customer", channel: "old_leads", originalSource: "website", status: "connected" });
      await lead("L6", "2026-08-15T14:00:00Z", { owner: ids.mAli, type: "full_id", source: "website", status: "connected" });
      await lead("L7", "2026-09-08T14:00:00Z", { owner: ids.mAli, type: "full_id", source: "website", spam: true });
      await lead("L8", "2026-09-09T14:00:00Z", { owner: ids.mSara, type: "furniture_only", source: "instagram", status: "paused", nextActionAt: "2026-09-25T14:00:00Z" });
      await lead("L9", "2026-09-01T03:00:00Z", { owner: ids.mAli, type: "full_id", source: "website", status: "connected" });
      // Another tenant's enquiry in the same days is never counted.
      await client.query("INSERT INTO crm_leads(workspace_id,enquiry_id,party_id,created_at) VALUES($1,$2,$3,'2026-09-05T14:00:00Z')", [ids.other, randomUUID(), randomUUID()]);
      // L8 needs time to think: come back on the 25th.
      await client.query(`INSERT INTO crm_activities(workspace_id,lead_id,type,status,title,completed_at,completion_outcome,description) VALUES($1,$2,'call','completed','Call','2026-09-09T15:00:00Z','come_back_later','Wants to think')`, [ids.ws, ids.L8]);

      // Opportunities. O1 (L1, Ali, Full ID) won both proposals; O2 (L2, Sara) lost; O3 direct, won before proposals existed;
      // O4 (Sara) won its design fee; O5 (Ali) open at Proposal.
      const opportunity = async (key: string, values: { lead?: string | null; owner: string; stage: string; status: string; amount?: string; closedAt?: string; reason?: string; created?: string }) =>
        client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,
            qualification_evidence_hash,converted_at,owner_membership_id,status,amount,currency_code,closed_at,outcome_reason,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'lead_qualification',repeat('a',64),'{}',repeat('b',64),now(),$9,$10,$11,'USD',$12,$13,$14)`,
          [ids[key], ids.ws, ids.party, values.lead ?? null, ids.pipeline, values.stage, `Job ${key}`, `O-${key}`, values.owner, values.status, values.amount ?? null, values.closedAt ?? null,
            values.reason ?? null, values.created ?? "2026-09-02T15:00:00Z"]);
      await opportunity("O1", { lead: ids.L1, owner: ids.mAli, stage: ids.sWon, status: "won", amount: "31500", closedAt: "2026-09-05T14:00:00Z" });
      await opportunity("O2", { lead: ids.L2, owner: ids.mSara, stage: ids.sLost, status: "lost", amount: "2100", closedAt: "2026-09-10T14:00:00Z", reason: "Price" });
      await opportunity("O3", { lead: null, owner: ids.mSara, stage: ids.sWon, status: "won", amount: "5000", closedAt: "2026-08-20T14:00:00Z" });
      await opportunity("O4", { lead: null, owner: ids.mSara, stage: ids.sWon, status: "won", amount: "8400", closedAt: "2026-09-14T14:00:00Z" });
      await opportunity("O5", { lead: null, owner: ids.mAli, stage: ids.sProposal, status: "open", amount: "12000" });
      await client.query(`INSERT INTO crm_stage_history(workspace_id,opportunity_id,to_stage_id,to_status,changed_at) VALUES($1,$2,$3,'open','2026-09-03T14:00:00Z'),($1,$2,$4,'open','2026-09-04T14:00:00Z')`,
        [ids.ws, ids.O1, ids.sQualified, ids.sProposal]);
      // O5's next follow-up was due yesterday.
      await client.query(`INSERT INTO crm_activities(workspace_id,opportunity_id,type,status,title,due_at,is_next_action,owner_membership_id) VALUES($1,$2,'call','pending','Call back','2026-09-19T14:00:00Z',true,$3)`, [ids.ws, ids.O5, ids.mAli]);

      // Cases, quotations (5% tax) and proposals.
      for (const [caseId, opp] of [[ids.C1, ids.O1], [ids.C3, ids.O3], [ids.C4, ids.O4]])
        await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,status,created_by) VALUES($1,$2,$3,'active',$4)", [caseId, ids.ws, opp, ids.owner]);
      const quote = (caseId: string, quoteId: string, values: { round: string; status: string; total: string; issuedAt?: string; validUntil?: string; qsCost?: number }) =>
        client.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency,tax_rate,total,valid_until,detail,hash)
          VALUES($1,$2,$3,1,$4,'quotation',$5,$6,'Quote','USD',5,$7,$8,$9::jsonb,'hash')`,
          [ids.ws, caseId, quoteId, Number(quoteId.replace(/\D/g, "")) || 1, values.round, values.status, values.total, values.validUntil ?? null,
            JSON.stringify({ ...(values.issuedAt ? { issuedAt: values.issuedAt } : {}), ...(values.qsCost !== undefined ? { qsEstimate: { cost: values.qsCost, quoteHash: "x" } } : {}) })]);
      await quote(ids.C1, "q1", { round: "design", status: "accepted", total: "10500", issuedAt: "2026-09-03T14:00:00Z" });
      await quote(ids.C1, "q2", { round: "main", status: "accepted", total: "21000", issuedAt: "2026-09-11T14:00:00Z", qsCost: 15000 });
      await quote(ids.C4, "q3", { round: "main", status: "issued", total: "1050", issuedAt: "2026-09-15T14:00:00Z", validUntil: "2026-09-22" });
      await quote(ids.C4, "q4", { round: "main", status: "issued", total: "999", issuedAt: "2026-09-15T14:00:00Z", validUntil: "2026-09-30" });
      await quote(ids.C4, "q5", { round: "design", status: "accepted", total: "8400", issuedAt: "2026-09-12T14:00:00Z" });
      const proposal = (opp: string, kind: string, amount: string, wonAt: string) => client.query(
        `INSERT INTO crm_opportunity_proposals(workspace_id,opportunity_id,kind,amount,currency_code,value_status,won_at) VALUES($1,$2,$3,$4,'USD','approved',$5)`, [ids.ws, opp, kind, amount, wonAt]);
      await proposal(ids.O1, "design", "10500", "2026-09-05T14:00:00Z");
      await proposal(ids.O1, "main", "21000", "2026-09-18T14:00:00Z");
      await proposal(ids.O4, "design", "8400", "2026-09-14T14:00:00Z");

      // Money on C1: the design fee paid and verified; Proposal 2's 21,000 due on the 10th; 5,000 due in October.
      await client.query(`INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{"financeContext":{"currency":"USD"}}')`, [ids.ws, ids.C1]);
      const payment = (payId: string, amount: string, due: string | null, source: string) => client.query(
        `INSERT INTO commercial_payments(workspace_id,case_id,id,sort_order,title,amount,due_date,status,source_quote_id,currency) VALUES($1,$2,$3,0,$3,$4,$5,'pending',$6,'USD')`,
        [ids.ws, ids.C1, payId, amount, due, source]);
      await payment("Design fee", "10500", "2026-09-05", "q1");
      await payment("Deposit", "21000", "2026-09-10", "q2");
      await payment("Balance", "5000", "2026-10-15", "q2");
      const receipt = (receiptId: string, amount: string, status: string, detail: Record<string, string>, currency = "USD") => client.query(
        `INSERT INTO commercial_receipts(workspace_id,case_id,id,sort_order,payment_id,legal_entity_id,currency,amount,source,status,detail) VALUES($1,$2,$3,0,'Design fee','e1',$4,$5,'manual',$6,$7::jsonb)`,
        [ids.ws, ids.C1, receiptId, currency, amount, status, JSON.stringify(detail)]);
      await receipt("r1", "10500", "finance_verified", { reportedAt: "2026-09-05T14:00:00Z", verifiedAt: "2026-09-06T14:00:00Z" });
      await receipt("r2", "5000", "reported", { reportedAt: "2026-09-12T14:00:00Z" });
      await receipt("r3", "700", "finance_verified", { verifiedAt: "2026-09-12T14:00:00Z" }, "EUR");
      await client.query(`INSERT INTO commercial_allocations(workspace_id,case_id,id,sort_order,receipt_id,payment_id,legal_entity_id,currency,amount) VALUES($1,$2,'a1',0,'r1','Design fee','e1','USD','10500')`, [ids.ws, ids.C1]);
      await client.query(`INSERT INTO client_invoices(id,workspace_id,legal_entity_id,project_id,case_id,payment_id,quote_id,number,issue_date,due_date,currency,net,tax,total,prices_include_tax,milestone_title,customer_name,company_name,issued_by,status)
        VALUES($1,$2,$3,$4,$5,'Design fee','q1','INV-1','2026-09-06','2026-09-06','USD','10000','500','10500',false,'Design fee','Amira','Studio',$6,'issued')`, [randomUUID(), ids.ws, randomUUID(), ids.P1, ids.C1, ids.owner]);
      // The Proposal 2 Deal File waits for approval.
      await client.query(`INSERT INTO approval_requests(workspace_id,subject_kind,subject_id,title,href,amount,currency_code,policy_version_id,requested_by,status,requested_at)
        VALUES($1,'deal_file',$2,'Deal File · Job O1',$3,'21000','USD',$4,$5,'pending','2026-09-18T15:00:00Z')`, [ids.ws, randomUUID(), `/workspace/pre-projects/cases/${ids.C1}/execution-release`, randomUUID(), ids.owner]);

      // Design: C1 (Concept) approved on the 8th; C4 (Bespoke) at its site visit, two days late, with a 4th presentation round.
      await client.query(`INSERT INTO design_journeys(workspace_id,case_id,package_id,package_name,included_revisions,includes_renders,started_at,approved_on,estimate_linked_at)
        VALUES($1,$2,$3,'Concept Package',2,false,'2026-09-06T14:00:00Z','2026-09-08','2026-09-11T14:00:00Z'),($1,$4,$5,'Bespoke Interior Design',2,true,'2026-09-15T14:00:00Z',null,null)`,
        [ids.ws, ids.C1, ids.pkConcept, ids.C4, ids.pkBespoke]);
      await client.query(`INSERT INTO design_journey_stages(workspace_id,case_id,stage,position,status,started_at,completed_at,due_at,owner_membership_id) VALUES
        ($1,$2,'approval',5,'done','2026-09-07T14:00:00Z','2026-09-08T14:00:00Z',null,$4),
        ($1,$3,'inspiration',1,'done','2026-09-15T14:00:00Z','2026-09-15T15:00:00Z',null,$4),
        ($1,$3,'site_visit',2,'active','2026-09-15T15:00:00Z',null,'2026-09-18T15:00:00Z',$4),
        ($1,$3,'renders',5,'locked',null,null,null,$5),
        ($1,$3,'approval',6,'locked',null,null,null,$4)`, [ids.ws, ids.C1, ids.C4, ids.mDana, ids.mVic]);
      await client.query("INSERT INTO crm_opportunity_designer(workspace_id,opportunity_id,membership_id) VALUES($1,$2,$3)", [ids.ws, ids.O4, ids.mDana]);
      await client.query("INSERT INTO crm_opportunity_discovery(workspace_id,opportunity_id,design_fee,design_fee_currency) VALUES($1,$2,8000,'USD')", [ids.ws, ids.O4]);
      await client.query(`INSERT INTO design_presentations(id,workspace_id,case_id,stage,round,status,chargeable,presented_at,created_by) VALUES($1,$2,$3,'concepts',4,'presented',true,'2026-09-17T14:00:00Z',$4)`,
        [randomUUID(), ids.ws, ids.C4, ids.owner]);

      // C1's project: started on the 12th, at Installation, past its promise date, with one late task; sealed at 20,000 net against a 15,000 QS cost.
      await client.query(`INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by,status,reference,quote_id,started_at,promise_date) VALUES($1,$2,$3,'Villa O1',$4,'active','PRJ-1','q2','2026-09-12T14:00:00Z','2026-09-15')`,
        [ids.P1, ids.ws, ids.C1, ids.owner]);
      await client.query(`INSERT INTO project_stages(id,workspace_id,project_id,position,key,name,status,started_at) VALUES($1,$2,$3,7,'installation','Installation','current','2026-09-14T14:00:00Z')`, [randomUUID(), ids.ws, ids.P1]);
      await client.query(`INSERT INTO work_items(id,workspace_id,project_id,number,type,title,status,due_date,created_by) VALUES($1,$2,$3,1,'task','Fix doors','todo','2026-09-19',$4)`, [randomUUID(), ids.ws, ids.P1, ids.owner]);
      await client.query(`INSERT INTO project_scope_seals(id,workspace_id,project_id,quote_id,quote_number,revision_label,quote_hash,snapshot,content_hash,currency,total,accepted_at,accepted_by_name,sealed_by)
        VALUES($1,$2,$3,'q2',2,'A','hash','{"pricing":{"net":"20000","total":"21000"}}',repeat('c',64),'USD',21000,'2026-09-11T14:00:00Z','Amira',$4)`, [randomUUID(), ids.ws, ids.P1, ids.owner]);

      // First-response clocks (60 working minutes): L1 answered in 30, L2 in 90, L3 never (past due), L5 closed before its target.
      const clock = (leadId: string, owner: string | null, values: { status: string; started: string; due: string; responded?: string; elapsed?: number; stopped?: string }) => client.query(
        `INSERT INTO crm_sla_instances(workspace_id,policy_id,lead_id,target_type,target_id,event_type,cycle,calculation_mode,policy_snapshot,status,started_at,warning_at,due_at,
           owner_membership_id,responded_at,response_elapsed_minutes,stopped_at,response_source_type,response_source_id)
         VALUES($1,$2,$3,'lead',$3,'first_response',1,'business','{"breachAfterMinutes":60,"calculationMode":"business"}',$4,$5,$5,$6,$7,$8::timestamptz,$9,$10,
           CASE WHEN $8::timestamptz IS NULL THEN NULL ELSE 'activity' END, CASE WHEN $8::timestamptz IS NULL THEN NULL ELSE gen_random_uuid() END)`,
        [ids.ws, ids.policy, leadId, values.status, values.started, values.due, owner, values.responded ?? null, values.elapsed ?? null, values.stopped ?? null]);
      await clock(ids.L1, ids.mAli, { status: "stopped", started: "2026-09-02T14:00:00Z", due: "2026-09-02T15:00:00Z", responded: "2026-09-02T14:30:00Z", elapsed: 30, stopped: "2026-09-02T14:30:00Z" });
      await clock(ids.L2, ids.mSara, { status: "stopped", started: "2026-09-03T14:00:00Z", due: "2026-09-03T15:00:00Z", responded: "2026-09-03T15:30:00Z", elapsed: 90, stopped: "2026-09-03T15:30:00Z" });
      await clock(ids.L3, null, { status: "breached", started: "2026-09-04T14:00:00Z", due: "2026-09-04T15:00:00Z" });
      await clock(ids.L5, ids.mAli, { status: "stopped", started: "2026-09-07T14:00:00Z", due: "2026-09-07T15:00:00Z", stopped: "2026-09-07T14:10:00Z" });
      // L2 was taken from Ali for want of a call; a takeover that found nobody else isn't a move.
      await client.query(`INSERT INTO crm_assignment_history(workspace_id,lead_id,previous_owner_membership_id,owner_membership_id,assignment_method,explanation,assigned_at)
        VALUES($1,$2,$3,$4,'automatic','{"reason":"unanswered_takeover"}','2026-09-03T15:05:00Z'),($1,$5,$3,$3,'automatic','{"reason":"no_eligible_alternate","kept":"true"}','2026-09-06T15:05:00Z')`,
        [ids.ws, ids.L2, ids.mAli, ids.mSara, ids.L5]);

      // Cancelled deals stay recorded (never Won): O6 (Sara) won its design fee on the 3rd, its order cancelled on the 16th;
      // O7 (Ali) won on the 4th, its job cancelled on the 17th.
      await opportunity("O6", { lead: null, owner: ids.mSara, stage: ids.sWon, status: "won", amount: "4200", closedAt: "2026-09-03T14:00:00Z" });
      await opportunity("O7", { lead: null, owner: ids.mAli, stage: ids.sWon, status: "won", amount: "3000", closedAt: "2026-09-04T14:00:00Z" });
      await proposal(ids.O6, "design", "4200", "2026-09-03T14:00:00Z");
      await client.query("INSERT INTO crm_deal_fulfilment(workspace_id,opportunity_id,cancelled_at,cancelled_by,cancel_reason) VALUES($1,$2,'2026-09-16T14:00:00Z',$3,'Client relocated')",
        [ids.ws, ids.O6, ids.owner]);
      await client.query(`INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,status,created_by,cancelled_at,cancelled_by,cancellation_reason)
        VALUES($1,$2,$3,'cancelled',$4,'2026-09-17T14:00:00Z',$4,'Budget withdrawn')`, [ids.C7, ids.ws, ids.O7, ids.owner]);
      // Refunds Finance completed: 1,050 on O1 (1,000 before tax) in the period; 300 without a deal in the period; 500 without a deal in August.
      const refund = (key: string, number: number, opp: string | null, amount: string, closedAt: string) => client.query(
        `INSERT INTO finance_requests(id,workspace_id,number,kind,status,requested_by,party_id,opportunity_id,currency,total_amount,reason,invoice_number,closed_by,closed_at,close_note)
         VALUES($1,$2,$3,'refund','done',$4,$5,$6,'USD',$7,'Item not delivered','INV-1',$4,$8,'')`, [ids[key], ids.ws, number, ids.owner, ids.party, opp, amount, closedAt]);
      await refund("R1", 1, ids.O1, "1050", "2026-09-19T14:00:00Z");
      await refund("R2", 2, null, "300", "2026-09-12T14:00:00Z");
      await refund("R3", 3, null, "500", "2026-08-12T14:00:00Z");
      // Enquiries closed as not interested this month (they came in during August, so New leads doesn't move).
      await lead("L10", "2026-08-20T14:00:00Z", { owner: ids.mAli, type: "full_id", source: "website", status: "disqualified" });
      await lead("L11", "2026-08-21T14:00:00Z", { owner: ids.mSara, type: "furniture_only", source: "instagram", status: "disqualified" });
      await lead("L12", "2026-08-22T14:00:00Z", { owner: ids.mSara, type: "full_id", source: "website", status: "disqualified" });
      for (const [key, reason, closedAt] of [["L10", "Not interested", "2026-09-11T14:00:00Z"], ["L11", "Budget too low", "2026-09-12T14:00:00Z"], ["L12", "Not interested", "2026-08-30T14:00:00Z"]])
        await client.query("UPDATE crm_leads SET disqualification_reason = $2, closed_at = $3 WHERE id = $1", [ids[key], reason, closedAt]);

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

  it("reads the Owner overview from the records", async () => {
    await scenario(async (client, ids) => {
      await saveTargets(client, ids.ws, ids.owner, { commandId: randomUUID(), changes: [
        { kpi: "sales_won_value", month: "2026-09", membershipId: null, target: "60000", version: null },
        { kpi: "sales_won_count", month: "2026-09", membershipId: null, target: "3", version: null },
      ] });
      const { kpis, currency } = await readDashboard(client, ids.ws, "owner-overview", PERIOD, NOW, undefined, "all");
      expect(currency).toBe("USD");

      // Won: O1's Design Fee (10,500 → 10,000 net) and Proposal 2 (21,000 → 20,000 net), and O4's Design Fee (8,400 → 8,000).
      const won = kpi(kpis, "sales_won");
      expect(won).toMatchObject({ value: "38000.00", count: 3, extra: expect.objectContaining({ designCount: 2, mainCount: 1, designValue: "18000.00", mainValue: "20000.00" }) });
      // 60,000 for September over 20 of its 30 days = 40,000; 38,000 is 95 %: amber, 2,000 short.
      expect(won.target).toEqual({ target: "40000.0000", percent: "95.0", gap: "2000.0000", tone: "warning" });
      expect(won.extra).toMatchObject({ countTarget: "2.0000", countPercent: "150.0", countTone: "success" });
      // O3 won in August before proposals existed: Proposal 2 at its value as entered (no quotation to separate tax).
      const chart = won.chart as Extract<Kpi["chart"], { type: "columns" }>;
      expect(chart.categories.map((item) => item.key).slice(-2)).toEqual(["2026-08", "2026-09"]);
      expect(chart.values.map((row) => row.slice(-2))).toEqual([["0.00", "18000.00"], ["5000.00", "20000.00"]]);

      // Two verified payments; the EUR one counts but its money is left out (another currency).
      expect(kpi(kpis, "revenue_collected")).toMatchObject({ value: "10000.00", count: 2, extra: { invoiced: "10000.00" }, notes: { otherCurrency: 1 } });
      // Owed: 21,000 overdue by 10 days and 5,000 not due yet (tax included); the design fee is paid.
      const owed = kpi(kpis, "outstanding");
      expect(owed).toMatchObject({ value: "26000.00", count: 2, notes: { amountsIncludeTax: true } });
      expect((owed.chart as Extract<Kpi["chart"], { type: "bars" }>).items.filter((item) => item.count)).toEqual([
        expect.objectContaining({ key: "not_due", value: "5000.00" }), expect.objectContaining({ key: "overdue_1_30", value: "21000.00" })]);
      expect(kpi(kpis, "deals_awaiting_approval")).toMatchObject({ value: "1", amount: "20000.00" });
      const projects = kpi(kpis, "active_projects");
      expect(projects.value).toBe("3");
      expect(Object.fromEntries((projects.chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((item) => [item.key, item.count])))
        .toEqual({ design: 1, estimate: 1, production: 0, delivery: 1, snagging: 0 });
      // The site visit two days late, the project past its promise date, and its late task.
      expect(kpi(kpis, "delayed_items").value).toBe("3");
      // O1 (Full ID → design handover) closed when the design was approved on the 8th.
      expect(kpi(kpis, "deals_closed")).toMatchObject({ value: "1", amount: "30000.00" });
      expect(kpi(kpis, "profit_margin")).toMatchObject({ value: "25.00", count: 1 });

      // Won left out O6 and O7 (cancelled); they are reported here, with the refunds Finance paid in the period.
      const cancelled = kpi(kpis, "cancellations_refunds");
      expect(cancelled).toMatchObject({ value: "2", count: 2, amount: "7200.00", extra: { refundCount: 2, refundValue: "1300.00" } });
      const cancelledChart = cancelled.chart as Extract<Kpi["chart"], { type: "columns" }>;
      expect(cancelledChart.values.map((row) => row.slice(-2))).toEqual([["0.00", "7200.00"], ["500.00", "1300.00"]]);
      // Net revenue: 10,000 collected less 1,300 refunded (1,000 before tax on O1, 300 as entered without a deal).
      const net = kpi(kpis, "net_revenue");
      expect(net).toMatchObject({ value: "8700.00", extra: { collected: "10000.00", refunded: "1300.00" }, notes: { otherCurrency: 1 } });
      expect((net.chart as Extract<Kpi["chart"], { type: "lines" }>).values.map((row) => row.slice(-2))).toEqual([["-500.00", "8700.00"], ["0.00", "10000.00"], ["500.00", "1300.00"]]);
    });
  });

  it("reads Sales and pipeline", async () => {
    await scenario(async (client, ids) => {
      const { kpis } = await readDashboard(client, ids.ws, "sales-pipeline", PERIOD, NOW, undefined, "all");
      // L1, L2, L3, L5, L8 — not the duplicate, the spam, August's L6, nor L9 (31 August locally).
      expect(kpi(kpis, "new_leads")).toMatchObject({ value: "5", count: 5 });
      // PLM-138: the spam (L7) is counted on its own, by the source and channel it came from.
      const spam = kpi(kpis, "spam_by_source");
      expect(spam).toMatchObject({ value: "1", count: 1 });
      expect((spam.chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((item) => [item.key, item.value])).toEqual([["website/form", "1"]]);
      const funnel = kpi(kpis, "conversion_funnel");
      expect(funnel.value).toBe("20.0");
      expect((funnel.chart as Extract<Kpi["chart"], { type: "funnel" }>).items.map((item) => [item.key, item.value, item.rate])).toEqual([
        ["lead", "5", null], ["opportunity", "2", "40.0"], ["qualified", "1", "50.0"], ["proposal", "1", "100.0"], ["won", "1", "100.0"]]);
      const pipeline = kpi(kpis, "pipeline_value");
      expect(pipeline).toMatchObject({ value: "12000.00", count: 1, notes: { taxIncluded: 1 } });
      const byManager = kpi(kpis, "won_by_account_manager");
      expect((byManager.chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((item) => [item.label, item.count, item.value, item.amount])).toEqual([
        ["Ali Manager", 2, "30000.00", "15000.00"], ["Sara Manager", 1, "8000.00", "8000.00"]]);
      expect(kpi(kpis, "lost")).toMatchObject({ value: "1", amount: "2100.00" });
      expect((kpi(kpis, "lost").chart as Extract<Kpi["chart"], { type: "bars" }>).items[0]).toMatchObject({ key: "price", label: "Price", count: 1 });
      // Not interested: L10 and L11 closed this month (L12 closed in August), by reason; never counted as Lost.
      const notInterested = kpi(kpis, "not_interested");
      expect(notInterested).toMatchObject({ value: "2", count: 2 });
      expect((notInterested.chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((item) => [item.key, item.label, item.count]))
        .toEqual([["budget too low", "Budget too low", 1], ["not interested", "Not interested", 1]]);
      expect(kpi(kpis, "duplicates").value).toBe("1");
      expect(kpi(kpis, "returning_customers").value).toBe("1");
      expect(kpi(kpis, "follow_ups")).toMatchObject({ value: "2", extra: { overdue: 1, due: 1 } });
      expect(kpi(kpis, "quotes_expiring")).toMatchObject({ value: "1", amount: "1000.00" });

      // Needs attention: O5 has kept its stage since it was opened on the 2nd (18 days, past the 14-day rule), and its
      // follow-up was due yesterday. L8's come-back date is still ahead.
      const page = await readDashboard(client, ids.ws, "sales-pipeline", PERIOD, NOW);
      expect(page.attention?.records.map((record) => [record.reference, record.detail, record.measure, record.href])).toEqual([
        ["O-O5", "stuck_deal", "18", `/workspace/crm/opportunities?record=${ids.O5}`], ["O-O5", "follow_up_overdue", "1", `/workspace/crm/opportunities?record=${ids.O5}`]]);
      // The firm's own rule: with 30 days, O5 isn't stuck yet.
      await client.query("INSERT INTO workspace_sales_settings(workspace_id,stuck_deal_days) VALUES($1,30)", [ids.ws]);
      expect((await readDashboard(client, ids.ws, "sales-pipeline", PERIOD, NOW)).attention?.records.map((record) => record.detail)).toEqual(["follow_up_overdue"]);
    });
  });

  it("reads Lead response on the policy's working clock", async () => {
    await scenario(async (client, ids) => {
      await saveTargets(client, ids.ws, ids.owner, { commandId: randomUUID(), changes: [
        { kpi: "first_response_hours", month: "2026-09", membershipId: null, target: "1", version: null }] });
      const { kpis } = await readDashboard(client, ids.ws, "lead-response", PERIOD, NOW, undefined, "all");
      // Met: L1. Missed: L2 (late) and L3 (no response past due). L5 closed before needing one.
      expect(kpi(kpis, "response_rate")).toMatchObject({ value: "33.3", count: 3, extra: { met: 1, missed: 2, mode: "business" }, notes: { target: "60" } });
      const hours = kpi(kpis, "first_response_hours");
      expect(hours).toMatchObject({ value: "1.00", count: 2 });
      // Lower is better: 1 hour target against 1 hour actual is on target.
      expect(hours.target).toMatchObject({ percent: "100.0", tone: "success" });
      expect((hours.chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((item) => [item.label, item.value])).toEqual([["Ali Manager", "0.50"], ["Sara Manager", "1.50"]]);
      expect((kpi(kpis, "reassignments").chart as Extract<Kpi["chart"], { type: "bars" }>).items).toEqual([expect.objectContaining({ label: "Ali Manager", count: 1 })]);
      expect(kpi(kpis, "unassigned_leads").value).toBe("1");
      // The Account Manager filter follows who held the clock.
      const ali = await readDashboard(client, ids.ws, "lead-response", { ...PERIOD, accountManager: ids.mAli }, NOW, undefined, "all");
      expect(kpi(ali.kpis, "response_rate")).toMatchObject({ value: "100.0", count: 1 });
      expect(kpi(ali.kpis, "reassignments").value).toBe("1");
    });
  });

  it("reads Design projects", async () => {
    await scenario(async (client, ids) => {
      const { kpis } = await readDashboard(client, ids.ws, "design-projects", PERIOD, NOW, undefined, "all");
      expect(Object.fromEntries((kpi(kpis, "design_stage").chart as Extract<Kpi["chart"], { type: "bars" }>).items.map((item) => [item.key, item.count])))
        .toEqual({ inspiration: 0, kickoff: 0, site_visit: 1, concept: 0, renders: 0, samples: 0, approval: 0 });
      const mix = kpi(kpis, "package_mix");
      expect(mix).toMatchObject({ value: "2", amount: "18000.00" });
      expect((mix.chart as Extract<Kpi["chart"], { type: "donut" }>).items.map((item) => [item.label, item.count, item.amount]).sort()).toEqual([
        ["Bespoke Interior Design", 1, "8000.00"], ["Concept Package", 1, "10000.00"]]);
      expect(kpi(kpis, "design_overdue")).toMatchObject({ value: "1", extra: expect.objectContaining({ site_visit: 1 }) });
      expect(kpi(kpis, "chargeable_revisions").value).toBe("1");
      expect((kpi(kpis, "designer_workload").chart as Extract<Kpi["chart"], { type: "bars" }>).items).toEqual([expect.objectContaining({ label: "Dana Designer", count: 1 })]);
      expect((kpi(kpis, "visualiser_workload").chart as Extract<Kpi["chart"], { type: "bars" }>).items).toEqual([expect.objectContaining({ label: "Vic Visualiser", count: 1 })]);
      // Approved on the 8th, Proposal 2 sent on the 11th: 3 days; its Proposal 2 is Won.
      expect(kpi(kpis, "design_to_proposal2_days")).toMatchObject({ value: "3.0", count: 1 });
      expect(kpi(kpis, "design_to_proposal2_rate")).toMatchObject({ value: "100.0", count: 1 });
    });
  });

  it("applies the filter bar server-side and opens the records behind a bar", async () => {
    await scenario(async (client, ids) => {
      const furniture = await readDashboard(client, ids.ws, "sales-pipeline", { ...PERIOD, enquiryType: "furniture_only" }, NOW, undefined, "all");
      expect(kpi(furniture.kpis, "new_leads").value).toBe("2");
      expect(kpi(furniture.kpis, "lost").value).toBe("1");
      const company = await readDashboard(client, ids.ws, "sales-pipeline", { ...PERIOD, clientType: "company", region: "abu_dhabi" }, NOW, undefined, "all");
      expect(kpi(company.kpis, "new_leads").value).toBe("1");
      const sara = await readDashboard(client, ids.ws, "owner-overview", { ...PERIOD, accountManager: ids.mSara }, NOW, undefined, "all");
      expect(kpi(sara.kpis, "sales_won")).toMatchObject({ value: "8000.00", count: 1 });
      // Sara's cancelled deal (O6); the refund without a deal drops out once a sales filter is on.
      expect(kpi(sara.kpis, "cancellations_refunds")).toMatchObject({ value: "1", amount: "4200.00", extra: { refundCount: 0 } });
      expect(kpi(sara.kpis, "net_revenue").value).toBe("0.00");
      expect(kpi((await readDashboard(client, ids.ws, "sales-pipeline", { ...PERIOD, accountManager: ids.mAli }, NOW, undefined, "all")).kpis, "not_interested").value).toBe("1");
      const concept = await readDashboard(client, ids.ws, "design-projects", { ...PERIOD, package: ids.pkConcept }, NOW, undefined, "all");
      expect(kpi(concept.kpis, "package_mix").value).toBe("1");
      // Targets aren't compared while a filter other than the period and Account Manager is on.
      await saveTargets(client, ids.ws, ids.owner, { commandId: randomUUID(), changes: [{ kpi: "new_leads", month: "2026-09", membershipId: null, target: "10", version: null }] });
      expect(kpi((await readDashboard(client, ids.ws, "sales-pipeline", PERIOD, NOW, undefined, "all")).kpis, "new_leads").target).toMatchObject({ target: "6.6667", tone: "danger" });
      expect(kpi((await readDashboard(client, ids.ws, "sales-pipeline", { ...PERIOD, source: "website" }, NOW, undefined, "all")).kpis, "new_leads")).toMatchObject({ target: null, targetHidden: true });

      const design = await readRecords(client, ids.ws, "owner-overview", { ...PERIOD, kpi: "sales_won", bucket: "month=2026-09;series=design" }, NOW);
      expect(design.records.map((record) => [record.reference, record.amount, record.href])).toEqual([
        ["O-O4", "8000.000000", `/workspace/crm/opportunities?record=${ids.O4}`], ["O-O1", "10000.000000", `/workspace/crm/opportunities?record=${ids.O1}`]]);
      const refunds = await readRecords(client, ids.ws, "owner-overview", { ...PERIOD, kpi: "cancellations_refunds", bucket: "period=1;series=refund" }, NOW);
      expect(refunds.records.map((record) => [record.reference, record.amount, record.href])).toEqual([
        ["FR-0001", "1000.000000", `/workspace/finance/requests?request=${ids.R1}`], ["FR-0002", "300.000000", `/workspace/finance/requests?request=${ids.R2}`]]);
      const cancelledDeals = await readRecords(client, ids.ws, "owner-overview", { ...PERIOD, kpi: "cancellations_refunds", bucket: "period=1;series=cancelled" }, NOW);
      expect(cancelledDeals.records.map((record) => [record.reference, record.detail]).sort()).toEqual([["O-O6", "Client relocated"], ["O-O7", "Budget withdrawn"]]);
      const netRecords = await readRecords(client, ids.ws, "owner-overview", { ...PERIOD, kpi: "net_revenue" }, NOW);
      expect(netRecords.records.map((record) => [record.kind, record.amount])).toEqual(expect.arrayContaining([["receipt", "10000.000000"], ["refund", "-1000.000000"], ["refund", "-300.000000"]]));
      const reasons = await readRecords(client, ids.ws, "sales-pipeline", { ...PERIOD, kpi: "not_interested", bucket: "period=1;reason=not interested" }, NOW);
      expect(reasons.records.map((record) => record.reference)).toEqual(["E-L10"]);
      const missed = await readRecords(client, ids.ws, "lead-response", { ...PERIOD, kpi: "response_rate", bucket: "period=1;outcome=missed" }, NOW);
      expect(missed.records.map((record) => record.reference).sort()).toEqual(["E-L2", "E-L3"]);
      await expect(readRecords(client, ids.ws, "owner-overview", { ...PERIOD, kpi: "nope" }, NOW)).rejects.toThrow("Unknown KPI");
      await expect(readDashboard(client, ids.ws, "owner-overview", { from: "2026-09-10", to: "2026-09-01" }, NOW, undefined, "all")).rejects.toThrow("The period starts after it ends");
      await expect(readDashboard(client, ids.ws, "owner-overview", { ...PERIOD, accountManager: "x' OR 1=1" }, NOW, undefined, "all")).rejects.toThrow("Invalid accountManager filter");

      const options = await readFilterOptions(client, ids.ws);
      expect(options.enquiryTypes.map((item) => item.id)).toEqual(expect.arrayContaining(["full_id", "furniture_only"]));
      expect(options.packages.map((item) => item.label)).toEqual(expect.arrayContaining(["Concept Package", "Bespoke Interior Design"]));
    });
  });

  it("shows 'not enough data' rather than a zero where nothing is recorded", async () => {
    await scenario(async (client, ids) => {
      const { kpis } = await readDashboard(client, ids.ws, "owner-overview", { from: "2026-07-01", to: "2026-07-31" }, NOW, undefined, "all");
      expect(kpi(kpis, "profit_margin").value).toBeNull();
      const lead = await readDashboard(client, ids.ws, "lead-response", { from: "2026-07-01", to: "2026-07-31" }, NOW, undefined, "all");
      expect(kpi(lead.kpis, "response_rate").value).toBeNull();
      expect(kpi(lead.kpis, "first_response_hours").value).toBeNull();
      const design = await readDashboard(client, ids.ws, "design-projects", { from: "2026-07-01", to: "2026-07-31" }, NOW, undefined, "all");
      expect(kpi(design.kpis, "design_to_proposal2_days").value).toBeNull();
      expect(kpi(design.kpis, "design_to_proposal2_rate").value).toBeNull();
    });
  });

  it("saves targets once per command, version-checked, per member where the KPI allows it", async () => {
    await scenario(async (client, ids) => {
      const commandId = randomUUID();
      const body = { commandId, changes: [{ kpi: "sales_won_value", month: "2026-09", membershipId: ids.mAli, target: "25000", version: null }] };
      expect(await saveTargets(client, ids.ws, ids.owner, body)).toEqual({ applied: true, changed: 1 });
      expect(await saveTargets(client, ids.ws, ids.owner, body)).toEqual({ applied: false, changed: 0 });
      const saved = (await readTargets(client, ids.ws, 2026)).targets;
      expect(saved).toEqual([expect.objectContaining({ kpi: "sales_won_value", month: "2026-09", membershipId: ids.mAli, target: "25000", version: 1 })]);
      await expect(saveTargets(client, ids.ws, ids.owner, { commandId: randomUUID(), changes: [{ kpi: "sales_won_value", month: "2026-09", membershipId: ids.mAli, target: "30000", version: null }] }))
        .rejects.toThrow("Someone changed these targets");
      await expect(saveTargets(client, ids.ws, ids.owner, { commandId: randomUUID(), changes: [{ kpi: "revenue_collected", month: "2026-09", membershipId: ids.mAli, target: "1", version: null }] }))
        .rejects.toThrow("one target for the whole company");
      await expect(saveTargets(client, ids.ws, ids.owner, { commandId: randomUUID(), changes: [{ kpi: "response_rate", month: "2026-09", membershipId: null, target: "120", version: null }] }))
        .rejects.toThrow("at most 100");
      expect(await saveTargets(client, ids.ws, ids.owner, { commandId: randomUUID(), changes: [{ kpi: "sales_won_value", month: "2026-09", membershipId: ids.mAli, target: "30000", version: 1 }] }))
        .toEqual({ applied: true, changed: 1 });
      // Ali's own target drives his row and his figure when filtered: 30,000 × 20/30 = 20,000 against 30,000 won.
      const ali = await readDashboard(client, ids.ws, "owner-overview", { ...PERIOD, accountManager: ids.mAli }, NOW, undefined, "all");
      expect(kpi(ali.kpis, "sales_won").target).toMatchObject({ target: "20000.0000", percent: "150.0", tone: "success" });
      const audits = await client.query("SELECT action FROM audit_events WHERE workspace_id=$1 AND entity_type='management_report_target' ORDER BY occurred_at", [ids.ws]);
      expect(audits.rows.map((row) => row.action)).toEqual(["reports.target.set", "reports.target.changed"]);
      expect(await saveTargets(client, ids.ws, ids.owner, { commandId: randomUUID(), changes: [{ kpi: "sales_won_value", month: "2026-09", membershipId: ids.mAli, target: null, version: 2 }] }))
        .toEqual({ applied: true, changed: 1 });
      expect((await readTargets(client, ids.ws, 2026)).targets).toEqual([]);
    });
  });
});
