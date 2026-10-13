import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import { ensureStarterFlows } from "../crm/flows/flow-store";
import { readMeeting } from "../meetings/meeting-minutes";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { casePlan } from "../pre-projects/case-plan";
import { QsReviewService } from "../proposals/qs-review.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { valueEngineeringIdleSource } from "../reminders/sources/value-engineering";
import { ValueEngineeringService } from "./value-engineering.service";
import { budgetChanged } from "./value-engineering.store";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each world is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const VIEW = ["pre_projects.view", "pre_projects.edit", "workspace.settings.manage", "crm.opportunities.view"];
const QS = [...VIEW, "commercial.estimate", "commercial.costs.manage"];
const MANAGER = [...VIEW, "commercial.approve"];

type Person = "am" | "qs" | "designer" | "manager" | "admin";
type World = {
  client: PoolClient; workspaceId: string; caseId: string; quoteId: string; opportunityId: string; users: Record<Person, string>; members: Record<Person, string>;
  savepoint: <T>(work: () => Promise<T>) => Promise<T>;
  ve: (who: Person) => ValueEngineeringService; qsReview: (who: Person) => QsReviewService; builder: (who: Person) => QuotationBuilderService;
};

/**
 * PLM-147 on the real schema: the QS's price above the client's budget opens value engineering led by the lead
 * designer (the Account Manager only without one, and only on a design job), with the QS and the Account Manager
 * told; the savings, the meeting (a CRM meeting with minutes) and the client's decision close it; free rounds, the
 * budget changing mid-way, permissions and the idle reminder.
 */
integration("value engineering led by the lead designer with the QS (PLM-147)", { timeout: 60_000 }, () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 4 });
  });
  afterAll(() => pool.end());

  async function world(work: (w: World) => Promise<void>, options: { designer?: boolean; budget?: string | null; furniture?: boolean; total?: string } = {}) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), party = randomUUID(), opportunityId = randomUUID(), qsRole = randomUUID(), managerRole = randomUUID();
    const people: Person[] = ["am", "qs", "designer", "manager", "admin"];
    const users = Object.fromEntries(people.map((person) => [person, randomUUID()])) as Record<Person, string>;
    const members = Object.fromEntries(people.map((person) => [person, randomUUID()])) as Record<Person, string>;
    const names: Record<Person, string> = { am: "Sara Sales", qs: "Quinn QS", designer: "Dina Designer", manager: "Mo Manager", admin: "Sam Admin" };
    try {
      await client.query("BEGIN");
      for (const person of people) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [users[person], `${users[person].slice(0, 8)}@example.com`, names[person]]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,default_locale,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai','en',$3)",
        [workspaceId, `ve-${workspaceId.slice(0, 8)}`, users.am]);
      for (const person of people) await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [members[person], workspaceId, users[person]]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name) VALUES($1,$2,'qs','QS'),($3,$2,'manager','Manager')", [qsRole, workspaceId, managerRole]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $2, $1, id FROM permissions WHERE code = 'commercial.estimate'", [qsRole, workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $2, $1, id FROM permissions WHERE code = 'commercial.approve'", [managerRole, workspaceId]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3),($1,$4,$5)", [workspaceId, members.qs, qsRole, members.manager, managerRole]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      const pipeline = randomUUID(), stage = randomUUID();
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [pipeline, workspaceId]);
      await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position,probability) VALUES($1,$2,$3,'proposal','Proposal',1,50)", [stage, workspaceId, pipeline]);
      let leadId: string | null = null;
      if (options.furniture) {
        // A furniture-only order (made to order, no BOQ): no design work on its path.
        const taxonomy = randomUUID(), enquiry = randomUUID();
        leadId = randomUUID();
        await client.query("INSERT INTO crm_taxonomies(id,workspace_id,code,name) VALUES($1,$2,'enquiry_type','Enquiry types')", [taxonomy, workspaceId]);
        await client.query("INSERT INTO crm_taxonomy_options(workspace_id,taxonomy_id,code,label,flow) VALUES($1,$2,'furniture_only','Furniture Only','furniture')", [workspaceId, taxonomy]);
        await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
          VALUES($1,$2,$3,$4,'Dining table','referral','external',now(),'E-1','furniture_only','{}')`, [enquiry, workspaceId, randomUUID(), party]);
        await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id) VALUES($1,$2,$3,$4)", [leadId, workspaceId, enquiry, party]);
      }
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,
          qualification_evidence,qualification_evidence_hash,converted_at,furniture_path)
        VALUES($1,$2,$3,$4,$5,$6,$7,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now(),$8)`,
        [opportunityId, workspaceId, party, leadId, pipeline, stage, members.am, options.furniture ? "core_collection_factory" : null]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by,status) VALUES($1,$2,$3,$4,'active')", [caseId, workspaceId, opportunityId, users.am]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Villa 12 estimate','AED')",
        [workspaceId, caseId, quoteId]);
      if (options.designer !== false) await client.query("INSERT INTO project_assignments(workspace_id,case_id,membership_id,role_keys) VALUES($1,$2,$3,ARRAY['designer']::varchar[])", [workspaceId, caseId, members.designer]);
      if (options.budget !== null) await client.query("INSERT INTO pre_project_briefs(case_id,workspace_id,content,updated_by) VALUES($1,$2,$3,$4)",
        [caseId, workspaceId, JSON.stringify({ budget: "", budgetAmount: options.budget ?? "300000", currencyCode: "AED" }), users.am]);
      await client.query("SET LOCAL session_replication_role = origin");
      if (options.furniture) await ensureStarterFlows(client, workspaceId);
      await client.query("INSERT INTO workspace_quotation_settings (workspace_id, qs_review) VALUES ($1, true)", [workspaceId]);
      await seedDefaultNotificationTemplates(client, workspaceId);
      const savepoint = async <T>(fn: () => Promise<T>) => {
        const name = `ve_${randomUUID().replaceAll("-", "")}`;
        await client.query(`SAVEPOINT ${name}`);
        try { const result = await fn(); await client.query(`RELEASE SAVEPOINT ${name}`); return result; }
        catch (error) { await client.query(`ROLLBACK TO SAVEPOINT ${name}`); throw error; }
      };
      const grants: Record<Person, string[]> = { am: VIEW, qs: QS, designer: VIEW, manager: MANAGER, admin: VIEW };
      const access = (who: Person) => {
        const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string; displayName: string }) => unknown) =>
          savepoint(async () => fn(client, { userId: users[who], displayName: names[who] }));
        return { withPermission: run, withPermissions: run, withAnyPermission: run,
          hasPermission: async (_c: unknown, _w: string, userId: string, code: string) => (grants[people.find((person) => users[person] === userId) ?? "admin"] ?? []).includes(code) } as never;
      };
      const w: World = {
        client, workspaceId, caseId, quoteId, opportunityId, users, members, savepoint,
        ve: (who) => new ValueEngineeringService(access(who)), qsReview: (who) => new QsReviewService(access(who)), builder: (who) => new QuotationBuilderService(access(who), {} as never),
      };
      await w.builder("qs").apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "marble", title: "Marble flooring", unit: "m²", quantity: "100", rate: options.total ? String(Number(options.total) / 100) : "3400", unitCost: "2500" } },
      ] });
      await work(w);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const notices = async (w: World, code: string, who: Person, channel = "in_app") => (await w.client.query<{ subject: string; body: string }>(
    "SELECT subject, body FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND recipient_id = $3 AND channel = $4 ORDER BY created_at", [w.workspaceId, code, w.users[who], channel])).rows;
  /** The QS prices the estimate: Sales sends it to the QS, who confirms. */
  const qsConfirms = async (w: World) => {
    await w.qsReview("am").send(actor, w.workspaceId, w.caseId, w.quoteId, { assigneeUserId: w.users.qs });
    return w.qsReview("qs").decide(actor, w.workspaceId, w.caseId, w.quoteId, { decision: "confirm", commandId: randomUUID() });
  };
  /** A version of the estimate sent to the client (what the commercial "issue" step records). */
  const sendVersion = async (w: World, quoteId: string, total?: string) => {
    const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
    const data = { ...(loaded.content as CommercialData), revision: loaded.revision + 1 };
    let quote = data.quotes.find((item) => item.id === quoteId);
    if (!quote) {
      const first = data.quotes.find((item) => item.id === w.quoteId)!;
      quote = { ...first, id: quoteId, number: Math.max(...data.quotes.map((item) => item.number)) + 1, familyId: w.quoteId, status: "draft", total: Number(total ?? first.total) } as never;
      first.status = "superseded";
      data.quotes.push(quote!);
    }
    quote!.status = "issued";
    if (total !== undefined) quote!.total = Number(total);
    await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
    await w.client.query(`INSERT INTO quote_issue_snapshots (workspace_id, case_id, quote_id, markup_disclosure, issued_by, issued_at) VALUES ($1, $2, $3, 'all_inclusive', $4, clock_timestamp())
      ON CONFLICT (workspace_id, case_id, quote_id) DO UPDATE SET issued_at = clock_timestamp()`, [w.workspaceId, w.caseId, quoteId, w.users.am]);
  };

  it("the QS's price above the client's budget opens value engineering, led by the lead designer; the QS is the second party and the Account Manager is copied", async () => {
    await world(async (w) => {
      await qsConfirms(w);
      const view = await w.ve("designer").view(actor, w.workspaceId, w.caseId, w.quoteId);
      expect(view.open).toMatchObject({ round: 1, origin: "automatic", status: "open", step: "agree_options", chargeable: false, quotedTotal: "340000.0000", budgetAmount: "300000.0000",
        overBy: "40000", qsUserId: w.users.qs, qsName: "Quinn QS", lead: { membershipId: w.members.designer, name: "Dina Designer", fallback: false } });
      expect(view.can).toMatchObject({ start: false, lead: true, decide: true, withdraw: false });
      // The lead designer hears it's over budget and theirs to lead (in the app and by email); not Sales as the lead.
      const [lead] = await notices(w, "quotation.value_engineering_lead", "designer");
      expect(lead.subject).toBe("Over budget · Maya Client");
      expect(lead.body).toContain("is priced at AED 340,000.00, AED 40,000.00 over the client's budget of AED 300,000.00. You lead value engineering with Quinn QS");
      expect(await notices(w, "quotation.value_engineering_lead", "designer", "email")).toHaveLength(1);
      expect(await notices(w, "quotation.value_engineering_lead", "am")).toHaveLength(0);
      const [copy] = await notices(w, "quotation.value_engineering_copy", "am");
      expect(copy.body).toContain("Dina Designer leads it with Quinn QS. You can attend the meeting; the design choices are theirs.");
      // The history reads as a business event.
      const audit = (await w.client.query("SELECT action FROM audit_events WHERE workspace_id = $1 AND entity_id = $2 AND action LIKE 'quotation.value_engineering%'", [w.workspaceId, w.caseId])).rows;
      expect(audit).toEqual([{ action: "quotation.value_engineering_started.v1" }]);
      // Confirming again (a retry) never opens a second round.
      expect((await w.client.query("SELECT count(*)::int AS n FROM quote_value_engineering WHERE workspace_id = $1", [w.workspaceId])).rows[0].n).toBe(1);
    });
  });

  it("a price within the budget opens nothing; without a recorded budget only the QS's manual start applies", async () => {
    await world(async (w) => {
      await qsConfirms(w);
      expect((await w.ve("qs").view(actor, w.workspaceId, w.caseId, w.quoteId)).open).toBeNull();
    }, { total: "280000" });
    await world(async (w) => {
      await qsConfirms(w);
      const view = await w.ve("qs").view(actor, w.workspaceId, w.caseId, w.quoteId);
      expect(view).toMatchObject({ open: null, budget: null, quote: { overBy: null, problem: null }, can: { start: true } });
      // Only the QS or a manager starts it; the designer and Sales don't.
      await expect(w.ve("am").start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId })).rejects.toThrow(/QS or a manager/);
      await expect(w.ve("designer").start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId })).rejects.toThrow(/QS or a manager/);
      const started = await w.ve("qs").start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, note: "Client said 250k on the call" });
      expect(started.open).toMatchObject({ origin: "manual", budgetAmount: null, note: "Client said 250k on the call", qsUserId: w.users.qs });
      // Starting again returns the same round (idempotent); a second open round is impossible.
      expect((await w.ve("manager").start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId })).open?.id).toBe(started.open?.id);
      await expect(w.savepoint(() => w.client.query(`INSERT INTO quote_value_engineering (id, workspace_id, case_id, quote_id, family_id, quote_number, round, origin, currency, quoted_total)
        VALUES ($1, $2, $3, $4, $4, 1, 2, 'manual', 'AED', 1)`, [randomUUID(), w.workspaceId, w.caseId, w.quoteId]))).rejects.toThrow(/quote_value_engineering_one_open/);
      const [lead] = await notices(w, "quotation.value_engineering_lead", "designer");
      expect(lead.body).toContain("Quinn QS flagged");
    }, { budget: null });
  });

  it("the designer and the QS agree the savings, the designer presents them at the meeting (minutes work on it), and a new version sent ends the round; versions are kept", async () => {
    await world(async (w) => {
      await qsConfirms(w);
      const round = (await w.ve("designer").view(actor, w.workspaceId, w.caseId)).open!;
      // The Account Manager attends but gives no design input; the QS is the second party, not the lead.
      await expect(w.ve("am").agree(actor, w.workspaceId, w.caseId, round.id, { version: round.version, note: "Porcelain" })).rejects.toThrow(/lead designer leads/);
      await expect(w.ve("qs").agree(actor, w.workspaceId, w.caseId, round.id, { version: round.version, note: "Porcelain" })).rejects.toThrow(/lead designer leads/);
      await expect(w.ve("designer").agree(actor, w.workspaceId, w.caseId, round.id, { version: round.version + 3, note: "Porcelain" })).rejects.toThrow(/changed while you were looking/);
      const agreed = await w.ve("designer").agree(actor, w.workspaceId, w.caseId, round.id, { version: round.version, note: "Marble to porcelain in the guest bath and the hall: saves AED 42,000" });
      expect(agreed.open).toMatchObject({ step: "present_options", optionsNote: "Marble to porcelain in the guest bath and the hall: saves AED 42,000", optionsAgreedByName: "Dina Designer" });
      expect(await notices(w, "quotation.value_engineering_agreed", "qs")).toHaveLength(1);
      expect(await notices(w, "quotation.value_engineering_agreed", "qs", "email")).toHaveLength(1);
      expect(await notices(w, "quotation.value_engineering_agreed", "am")).toHaveLength(1);
      // The value engineering meeting is a CRM meeting with the client: the lead runs it, the QS and the Account Manager are invited.
      const startsAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const endsAt = new Date(Date.parse(startsAt) + 3_600_000).toISOString();
      const booked = await w.ve("designer").meeting(actor, w.workspaceId, w.caseId, round.id, { version: agreed.open!.version, startsAt, endsAt, timezone: "Asia/Dubai", address: "Showroom" });
      const meeting = await readMeeting(w.client, w.workspaceId, booked.open!.meeting!.activityId);
      expect(meeting).toMatchObject({ type: "meeting", title: "Value engineering meeting", ownerMembershipId: w.members.designer, caseId: w.caseId, clientName: "Maya Client" });
      expect([...meeting!.attendeeMembershipIds].sort()).toEqual([w.members.designer, w.members.qs, w.members.am].sort());
      const [told] = await notices(w, "quotation.value_engineering_meeting", "qs");
      expect(told.subject).toBe("Value engineering meeting · Maya Client");
      expect(await notices(w, "quotation.value_engineering_meeting", "am", "email")).toHaveLength(1);
      // The client chose the options: a new version of the estimate (v2) goes to the client through the quote path; the round ends.
      await sendVersion(w, "v2", "298000");
      const after = await w.ve("designer").view(actor, w.workspaceId, w.caseId);
      expect(after.open).toBeNull();
      expect(after.rounds[0]).toMatchObject({ status: "closed", outcome: "new_version", outcomeQuoteId: "v2", step: "closed" });
      const versions = (await w.client.query("SELECT id, status, total::text AS total FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 ORDER BY number", [w.workspaceId, w.caseId])).rows;
      expect(versions).toEqual([{ id: w.quoteId, status: "superseded", total: "340000" }, { id: "v2", status: "issued", total: "298000" }]);
      expect((await w.client.query("SELECT action FROM audit_events WHERE workspace_id = $1 AND action LIKE 'quotation.value_engineering%' ORDER BY occurred_at", [w.workspaceId])).rows.map((row) => row.action))
        .toEqual(["quotation.value_engineering_started.v1", "quotation.value_engineering_options_confirmed.v1", "quotation.value_engineering_meeting_booked.v1", "quotation.value_engineering_closed.v1"]);
    });
  });

  it("the client keeps the price: recorded by the Account Manager (or accepted at its price); the lead and the QS hear it", async () => {
    await world(async (w) => {
      await qsConfirms(w);
      const round = (await w.ve("am").view(actor, w.workspaceId, w.caseId)).open!;
      await expect(w.ve("qs").keepPrice(actor, w.workspaceId, w.caseId, round.id, { version: round.version })).rejects.toThrow(/lead designer or the Account Manager/);
      const kept = await w.ve("am").keepPrice(actor, w.workspaceId, w.caseId, round.id, { version: round.version, note: "Happy with marble" });
      expect(kept.rounds[0]).toMatchObject({ status: "closed", outcome: "kept_price", outcomeQuoteId: w.quoteId, outcomeNote: "Happy with marble" });
      // A retry is fine; anything else on a closed round is refused.
      expect((await w.ve("am").keepPrice(actor, w.workspaceId, w.caseId, round.id, { version: round.version })).rounds[0].outcome).toBe("kept_price");
      await expect(w.ve("designer").agree(actor, w.workspaceId, w.caseId, round.id, { version: kept.rounds[0].version, note: "x" })).rejects.toThrow(/closed/);
      const [closed] = await notices(w, "quotation.value_engineering_closed", "designer");
      expect(closed.body).toContain("Sara Sales recorded that the client keeps the price");
      expect(await notices(w, "quotation.value_engineering_closed", "qs")).toHaveLength(1);
    });
    await world(async (w) => {
      await qsConfirms(w);
      await sendVersion(w, w.quoteId);
      expect((await w.ve("am").view(actor, w.workspaceId, w.caseId)).open).toMatchObject({ step: "agree_options" });
      // The client accepts the version at its price.
      await w.client.query("UPDATE commercial_quotes SET status = 'accepted' WHERE workspace_id = $1 AND id = $2", [w.workspaceId, w.quoteId]);
      expect((await w.ve("am").view(actor, w.workspaceId, w.caseId)).rounds[0]).toMatchObject({ outcome: "kept_price", status: "closed" });
    });
  });

  it("without a lead designer on a design job the Account Manager leads and is told so; a designer allocated later takes it over", async () => {
    await world(async (w) => {
      await qsConfirms(w);
      const view = await w.ve("am").view(actor, w.workspaceId, w.caseId);
      expect(view.open?.lead).toEqual({ membershipId: w.members.am, name: "Sara Sales", fallback: true });
      const [told] = await notices(w, "quotation.value_engineering_no_designer", "am");
      expect(told.body).toContain("Nobody is the lead designer on this job, so you lead value engineering with Quinn QS.");
      expect(await notices(w, "quotation.value_engineering_copy", "am")).toHaveLength(0);
      await w.client.query("INSERT INTO project_assignments(workspace_id,case_id,membership_id,role_keys) VALUES($1,$2,$3,ARRAY['designer']::varchar[])", [w.workspaceId, w.caseId, w.members.designer]);
      const moved = await w.ve("designer").view(actor, w.workspaceId, w.caseId);
      expect(moved.open?.lead).toEqual({ membershipId: w.members.designer, name: "Dina Designer", fallback: false });
      expect(moved.can.lead).toBe(true);
      expect(await notices(w, "quotation.value_engineering_lead", "designer")).toHaveLength(1);
    }, { designer: false });
  });

  it("a furniture-only job without a designer keeps the existing flow: nothing opens, and the QS can't start it", async () => {
    await world(async (w) => {
      expect((await casePlan(w.client, w.workspaceId, w.caseId)).design).toBe(false);
      await qsConfirms(w);
      const view = await w.ve("qs").view(actor, w.workspaceId, w.caseId, w.quoteId);
      expect(view).toMatchObject({ open: null, designWork: false, quote: { problem: "This job has no designer. Revise the quotation with Sales." }, can: { start: false } });
      await expect(w.ve("qs").start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId })).rejects.toThrow(/no designer/);
    }, { designer: false, furniture: true });
  });

  it("no round limit by default; past the firm's free rounds a round is chargeable and Sales hears it", async () => {
    await world(async (w) => {
      await qsConfirms(w);
      const first = (await w.ve("am").view(actor, w.workspaceId, w.caseId)).open!;
      expect(first.chargeable).toBe(false);
      await w.client.query("UPDATE workspace_quotation_settings SET value_engineering_free_rounds = 1 WHERE workspace_id = $1", [w.workspaceId]);
      await w.ve("am").keepPrice(actor, w.workspaceId, w.caseId, first.id, { version: first.version });
      // The client keeps changing: the second round is past the one free round.
      const second = await w.ve("qs").start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId });
      expect(second.open).toMatchObject({ round: 2, chargeable: true });
      const [chargeable] = await notices(w, "quotation.value_engineering_chargeable", "am");
      expect(chargeable.body).toBe("Round 2 is past the free rounds. Agree the fee with the client before the work starts.");
      await expect(w.ve("designer").withdraw(actor, w.workspaceId, w.caseId, second.open!.id, { version: second.open!.version, note: "Started twice" })).rejects.toThrow(/QS or a manager/);
      await w.ve("qs").withdraw(actor, w.workspaceId, w.caseId, second.open!.id, { version: second.open!.version, note: "Started twice" });
      // A withdrawn round doesn't count.
      expect((await w.ve("qs").start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId })).open).toMatchObject({ round: 2, chargeable: true });
    });
  });

  it("the client's budget changing mid-way is told to the lead and the QS; the round keeps the budget it started from", async () => {
    await world(async (w) => {
      await qsConfirms(w);
      await budgetChanged(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, actorUserId: w.users.am, before: { amount: "300000", currency: "AED" }, after: { amount: "350000", currency: "AED" } });
      const [lead] = await notices(w, "quotation.value_engineering_budget_changed", "designer");
      expect(lead.body).toBe("Sara Sales changed the client's budget to AED 350,000.00 during value engineering. AED 340,000.00 now fits the budget.");
      expect(await notices(w, "quotation.value_engineering_budget_changed", "qs")).toHaveLength(1);
      const view = await w.ve("am").view(actor, w.workspaceId, w.caseId);
      expect(view).toMatchObject({ budget: { amount: "300000", currency: "AED" }, open: { budgetAmount: "300000.0000", status: "open" } });
    });
  });

  it("an idle round reminds its lead through the engine until the client decides", async () => {
    await world(async (w) => {
      await qsConfirms(w);
      const round = (await w.ve("am").view(actor, w.workspaceId, w.caseId)).open!;
      const [item] = await valueEngineeringIdleSource.open(w.client, w.workspaceId, { clock: {} as never, now: new Date(), limit: 50 });
      expect(item).toMatchObject({ key: `ve:${round.id}`, ownerMembershipId: w.members.designer, caseId: w.caseId, title: "Value engineering · round 1", context: "Maya Client",
        href: `/workspace/pre-projects/cases/${w.caseId}/quotations?quote=${w.quoteId}` });
      expect(await valueEngineeringIdleSource.stillOpen(w.client, w.workspaceId, [item.key])).toEqual(new Set([item.key]));
      await sendVersion(w, "v2", "290000");
      expect(await valueEngineeringIdleSource.stillOpen(w.client, w.workspaceId, [item.key])).toEqual(new Set());
    });
  });
});
