import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PreProjectReadinessService } from "../pre-projects/pre-project-readiness.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { prefillDesignFeeQuote } from "../quotation/design-fee-line";
import { CommercialService } from "./commercial.service";
import { commercialRepository } from "./commercial-repository";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "Sara Sales" } as never;

type World = { client: PoolClient; workspaceId: string; caseId: string; opportunityId: string; owner: string; commercial: CommercialService; builder: QuotationBuilderService };
type Setup = { design?: boolean; permissions?: (code: string) => boolean };

/**
 * A design job's first quote is the design fee. When Sales has already priced that fee on the opportunity (its design
 * package in discovery, or the Proposal 1 value), the new design-fee quote starts with one line carrying it, taxed by
 * the firm's default tax; it stays editable, and nothing priced means it starts empty as before.
 */
integration("a new design-fee quote starts from the fee priced on the opportunity", { timeout: 30_000 }, () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(setup: Setup, run: (w: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), owner = randomUUID(), membership = randomUUID(), partyId = randomUUID(), opportunityId = randomUUID(), caseId = randomUUID();
    const entity = randomUUID(), profile = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sara Sales')", [owner, `${owner.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `df-${workspaceId.slice(0, 8)}`, owner]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, owner]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya','maya')", [partyId, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,
          conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`,
        [opportunityId, workspaceId, partyId, randomUUID(), randomUUID(), membership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, owner]);
      // The tax comes from the firm's own tax profile (written from its region pack), never a constant.
      await client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES($1,$2,'STU','Studio','Studio LLC','AE','AED','en-AE','Asia/Dubai')`, [entity, workspaceId]);
      await client.query(`INSERT INTO tax_profiles(id,workspace_id,legal_entity_id,name,jurisdiction_code,scheme,prices_include_tax,effective_from,version)
        VALUES($1,$2,$3,'VAT','AE','vat',false,now(),1)`, [profile, workspaceId, entity]);
      await client.query("INSERT INTO tax_rates(workspace_id,tax_profile_id,code,label,rate,is_default) VALUES($1,$2,'standard','Standard','5',true)", [workspaceId, profile]);
      const content = { servicePath: { selectedAt: new Date().toISOString(), selectedBy: owner,
        scope: { design: setup.design ?? true, mainQuotation: true, materialSelection: false, procurement: true, manufacturing: false, siteWorks: true, installation: true } } };
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,$3::jsonb)", [workspaceId, caseId, JSON.stringify(content)]);
      await client.query("SET LOCAL session_replication_role = origin");
      const allowed = setup.permissions ?? (() => true);
      const runWith = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string; displayName: string }) => unknown) => fn(client, { userId: owner, displayName: "Sara Sales" });
      const access = { withPermission: runWith, withAnyPermission: runWith, withPermissions: runWith, hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => allowed(code) } as never;
      const commercial = new CommercialService(access, { get: () => undefined } as never, {} as never, new PreProjectReadinessService(access, {} as never));
      const builder = new QuotationBuilderService(access, {} as never);
      await run({ client, workspaceId, caseId, opportunityId, owner, commercial, builder });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** Sales priced the fee in discovery: the opportunity's design package and the fee it worked out. */
  const pricedByPackage = async (w: World, fee: { amount: string; currency: string }) => {
    const packageId = randomUUID();
    await w.client.query(`INSERT INTO design_packages(id,workspace_id,code,name,pricing_method,rate,currency,inclusions)
      VALUES($1,$2,'signature','Signature design','fixed',$3,$4,'Concepts, layouts and 3D renders')`, [packageId, w.workspaceId, fee.amount, fee.currency]);
    await w.client.query(`INSERT INTO crm_opportunity_discovery(workspace_id,opportunity_id,design_package_id,design_fee,design_fee_currency)
      VALUES($1,$2,$3,$4::numeric,$5)`, [w.workspaceId, w.opportunityId, packageId, fee.amount, fee.currency]);
  };
  /** Sales entered Proposal 1's value (the design fee) on the opportunity. */
  const proposalValue = (w: World, amount: string) => w.client.query(
    `INSERT INTO crm_opportunity_proposals(workspace_id,opportunity_id,kind,amount,currency_code,value_status,entered_by,entered_at)
     VALUES($1,$2,'design',$3::numeric,'AED','entered',$4,now())`, [w.workspaceId, w.opportunityId, amount, w.owner]);
  const create = async (w: World) => {
    const revision = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!.revision;
    return w.commercial.command(actor, w.workspaceId, w.caseId, { action: "create", revision });
  };
  const lines = async (w: World, quoteId: string) => (await w.client.query(
    `SELECT id, title, description, kind, quantity::text AS quantity, unit, unit_cost::text AS "unitCost", rate::text AS rate, tax_code AS "taxCode", tax_rate::text AS "taxRate"
       FROM commercial_quote_lines WHERE workspace_id=$1 AND case_id=$2 AND quote_id=$3 ORDER BY sort_order`, [w.workspaceId, w.caseId, quoteId])).rows;
  const header = async (w: World, quoteId: string) => (await w.client.query(
    `SELECT round, status, currency, total::text AS total FROM commercial_quotes WHERE workspace_id=$1 AND case_id=$2 AND id=$3`, [w.workspaceId, w.caseId, quoteId])).rows[0];

  it("fills the new design-fee quote with the package's fee as one line, taxed by the firm's default tax, and it stays editable", async () => {
    await world({}, async (w) => {
      await pricedByPackage(w, { amount: "12500.50", currency: "AED" });
      const result = await create(w);
      const quote = result.data.quotes.at(-1)!;
      expect(quote).toMatchObject({ kind: "quotation", round: "design", status: "draft", currency: "AED" });
      // The answer already shows the filled quote.
      expect(quote.lines).toHaveLength(1);
      expect(quote.lines[0]).toMatchObject({ title: "Signature design", description: "Concepts, layouts and 3D renders", kind: "service" });
      const [line] = await lines(w, quote.id);
      expect(line).toMatchObject({ title: "Signature design", description: "Concepts, layouts and 3D renders", kind: "service", quantity: "1", unit: "",
        unitCost: null, taxCode: "standard", taxRate: "5.0000" });
      expect(Number.isNaN(Number(line.rate))).toBe(false);
      expect((await w.client.query("SELECT $1::numeric = 12500.50 AS same", [line.rate])).rows[0].same).toBe(true);
      // 12,500.50 + 5 % (625.03, rounded per line) = 13,125.53, in exact decimals.
      expect(await header(w, quote.id)).toMatchObject({ round: "design", status: "draft", total: "13125.53" });
      // One revision for the whole command: the answer's revision is the case's, so the next command isn't refused.
      expect((await commercialRepository.load(w.client, w.workspaceId, w.caseId))!.revision).toBe(result.data.revision);
      const audit = (await w.client.query(`SELECT after FROM audit_events WHERE workspace_id=$1 AND action='commercial.quote_design_fee_prefilled.v1'`, [w.workspaceId])).rows;
      expect(audit).toEqual([{ after: expect.objectContaining({ quoteId: quote.id, lineId: line.id, amount: "12500.5", currency: "AED", source: "discovery" }) }]);

      // The builder opens with it, and the user can still change it.
      const opened = await w.builder.builder(actor, w.workspaceId, w.caseId, quote.id);
      expect(opened.lines).toEqual([expect.objectContaining({ id: line.id, title: "Signature design", rate: "12500.5", quantity: "1" })]);
      const edited = await w.builder.apply(actor, w.workspaceId, w.caseId, quote.id, { ops: [{ op: "upsert", line: { id: line.id, version: opened.lines[0].version, rate: "11000" } }] });
      expect(edited.lines[0]).toMatchObject({ id: line.id, rate: "11000" });
      expect((await header(w, quote.id)).total).toBe("11550.00");
    });
  });

  it("takes the Proposal 1 value Sales entered, named Design fee when no package names it", async () => {
    await world({}, async (w) => {
      await proposalValue(w, "9000");
      const quote = (await create(w)).data.quotes.at(-1)!;
      expect(await lines(w, quote.id)).toEqual([expect.objectContaining({ title: "Design fee", description: "", kind: "service", quantity: "1", taxCode: "standard" })]);
      expect((await header(w, quote.id)).total).toBe("9450.00");
    });
  });

  it("uses the package's fee instead of the Proposal 1 value for someone who may not see the opportunity's values", async () => {
    await world({ permissions: (code) => code !== "crm.opportunities.sensitive_values" }, async (w) => {
      await pricedByPackage(w, { amount: "12500.50", currency: "AED" });
      await proposalValue(w, "9000");
      const quote = (await create(w)).data.quotes.at(-1)!;
      expect(await lines(w, quote.id)).toEqual([expect.objectContaining({ title: "Signature design" })]);
      expect((await header(w, quote.id)).total).toBe("13125.53");
    });
  });

  it("starts empty, as before, when no fee was priced on the opportunity or it is in another currency", async () => {
    await world({}, async (w) => {
      const quote = (await create(w)).data.quotes.at(-1)!;
      expect(quote).toMatchObject({ round: "design", lines: [] });
      expect(await lines(w, quote.id)).toEqual([]);
      expect((await header(w, quote.id)).total).toBe("0");
    });
    await world({}, async (w) => {
      await pricedByPackage(w, { amount: "3400", currency: "USD" });
      const quote = (await create(w)).data.quotes.at(-1)!;
      expect(await lines(w, quote.id)).toEqual([]);
    });
  });

  it("never fills a fit-out quote, and never touches a draft that already has lines", async () => {
    await world({ design: false }, async (w) => {
      await pricedByPackage(w, { amount: "12500.50", currency: "AED" });
      const quote = (await create(w)).data.quotes.at(-1)!;
      expect(quote.round).toBe("main");
      expect(await lines(w, quote.id)).toEqual([]);
    });
    await world({}, async (w) => {
      const quote = (await create(w)).data.quotes.at(-1)!;
      await w.builder.apply(actor, w.workspaceId, w.caseId, quote.id, { ops: [{ op: "upsert", line: { id: "typed", title: "Concept design", quantity: "1", rate: "7000" } }] });
      await pricedByPackage(w, { amount: "12500.50", currency: "AED" });
      expect(await prefillDesignFeeQuote(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, quoteId: quote.id, actorUserId: w.owner, includeProposalValue: true })).toBeNull();
      expect(await lines(w, quote.id)).toEqual([expect.objectContaining({ id: "typed", title: "Concept design" })]);
    });
  });
});
