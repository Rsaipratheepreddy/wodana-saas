import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { ProjectCoreService } from "../project-core/project-core.service";
import { OrdersService } from "../purchasing/orders.service";
import { SuppliersService } from "../purchasing/suppliers.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { signatureDueSource } from "../reminders/sources/finishes";
import { workspaceClock } from "../team-calendars/workspace-clock";
import { addEntry, decideVersion, lockLedger } from "./design-ledger.store";
import { processProcurementGates, procurementGate, recordSignature, saveFinishSettings, signatureGate } from "./finishes.store";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const BUYER = ["vendors.view", "vendors.manage", "vendors.approve", "purchasing.view", "purchasing.manage", "purchasing.approve", "projects.view", "projects.manage", "workspace.settings.manage"];

type World = {
  client: PoolClient; workspaceId: string; caseId: string; quoteId: string; manager: string; buyer: string; lead: string; managerMembership: string; buyerMembership: string; leadMembership: string;
};

/**
 * PLM-148: the procurement gate keeps the client's payment and the confirmed material list, and adds the client's signed
 * samples and data sheets (in the categories the firm marks), recorded by the designer. Procurement can't order before
 * all three; the designer hears when procurement tried; procurement hears when the gate clears; older procurement isn't
 * blocked after the fact.
 */
integration("the procurement gate with the client's signed samples (PLM-148)", { timeout: 120_000 }, () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), manager = randomUUID(), buyer = randomUUID(), lead = randomUUID();
    const managerMembership = randomUUID(), buyerMembership = randomUUID(), leadMembership = randomUUID(), party = randomUUID(), opportunity = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Omar Manager'),($3,$4,'Dana Buyer'),($5,$6,'Lina Lead')",
        [manager, `${manager.slice(0, 8)}@example.com`, buyer, `${buyer.slice(0, 8)}@example.com`, lead, `${lead.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'GBP','Europe/London',$3)", [workspaceId, `pg-${workspaceId.slice(0, 8)}`, manager]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active'),($6,$2,$7,'active')",
        [managerMembership, workspaceId, manager, buyerMembership, buyer, leadMembership, lead]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), managerMembership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, manager]);
      await client.query("INSERT INTO project_assignments(workspace_id,case_id,membership_id,role_keys) VALUES($1,$2,$3,ARRAY['designer']::varchar[])", [workspaceId, caseId, leadMembership]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','GBP')", [workspaceId, caseId, quoteId]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const all = async (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: manager });
      const builder = new QuotationBuilderService({ withPermission: all, withPermissions: all, withAnyPermission: all, hasPermission: async () => true } as never, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [{ op: "upsert", line: { id: "a", title: "Bathroom fit-out", unit: "item", quantity: "1", rate: "9000" } }] });
      await run({ client, workspaceId, caseId, quoteId, manager, buyer, lead, managerMembership, buyerMembership, leadMembership });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** The client accepted and paid; the project started with a buying company and an approved supplier. */
  async function started(w: World) {
    const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
    const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
    const quote = data.quotes.find((item) => item.id === w.quoteId)!;
    quote.status = "accepted";
    quote.hash = freezeHash(quote);
    quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: 9000, optionsTotal: 0, acceptedTotal: 9000,
      decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
    data.agreement = { quoteId: w.quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
    data.payments = [{ id: "p1", sourceQuoteId: w.quoteId, title: "Advance", amount: 9000, dueDate: "", requiredForRelease: true, requiredForProduction: true, status: "verified", proof: "bank transfer",
      reference: "TT-1", evidenceKind: "operational" }];
    data.revision = loaded.revision + 1;
    await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
    const run_ = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(w.client, { userId: w.manager });
    const core = new ProjectCoreService({ asMember: (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(w.client, { userId: w.manager }), withPermission: run_, withAnyPermission: run_,
      hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => ["projects.manage", "projects.view", "pre_projects.view", "workspace.settings.manage"].includes(code) } as never);
    const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
    const company = randomUUID(), vendor = randomUUID(), profile = randomUUID();
    await w.client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,'STU','Studio','Studio Ltd','GB','GBP','en-GB','Europe/London')`, [company, w.workspaceId]);
    await w.client.query(`INSERT INTO tax_profiles(id,workspace_id,legal_entity_id,name,jurisdiction_code,scheme,prices_include_tax,effective_from,version) VALUES($1,$2,$3,'VAT','GB','vat',false,now(),1)`, [profile, w.workspaceId, company]);
    await w.client.query(`INSERT INTO tax_rates(workspace_id,tax_profile_id,code,label,rate,is_default) VALUES($1,$2,'standard','Standard','20',true)`, [w.workspaceId, profile]);
    const access = (userId: string, permissions: string[]) => {
      const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
        if (!(Array.isArray(code) ? code : [code]).some((item) => permissions.includes(item))) throw new Error("Not allowed");
        await w.client.query("SAVEPOINT command");
        try { const result = await fn(w.client, { userId }); await w.client.query("RELEASE SAVEPOINT command"); return result; }
        catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT command"); throw error; }
      };
      return { withPermission: run, withAnyPermission: run, hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never;
    };
    await w.client.query(`INSERT INTO workspace_purchasing_settings (workspace_id, require_material_signoff, require_client_payment, require_approved_supplier) VALUES ($1, true, true, true)`, [w.workspaceId]);
    const orders = new OrdersService(access(w.buyer, BUYER)), suppliers = new SuppliersService(access(w.buyer, BUYER));
    const saved = await suppliers.save(actor, w.workspaceId, { id: vendor, version: 0, name: "Bath Supplies Ltd", entityIds: [company], email: "orders@bath.example" });
    await new SuppliersService(access(w.manager, BUYER)).approve(actor, w.workspaceId, vendor, { version: saved.suppliers[0].version, approval: "approved" });
    // The buyer holds purchasing.manage: procurement hears the gate clear by that permission.
    const role = randomUUID();
    await w.client.query("INSERT INTO roles (id, workspace_id, code, name) VALUES ($1, $2, 'buyer', 'Buyer')", [role, w.workspaceId]);
    await w.client.query("INSERT INTO role_permissions (workspace_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE code = 'purchasing.manage'", [w.workspaceId, role]);
    await w.client.query("INSERT INTO member_roles (workspace_id, membership_id, role_id) VALUES ($1, $2, $3)", [w.workspaceId, w.buyerMembership, role]);
    return { projectId, vendor, orders, core };
  }

  const told = async (w: World, event: string) => (await w.client.query<{ recipient: string; body: string }>(
    "SELECT recipient_id AS recipient, body FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND channel = 'in_app' ORDER BY created_at", [w.workspaceId, event])).rows;
  const photo = async (w: World) => {
    const id = randomUUID();
    await w.client.query("INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,sha256,created_by) VALUES($1,$2,$3,'signed-wc.jpg','image/jpeg',1,$4,repeat('a',64),$5)",
      [id, w.workspaceId, w.caseId, `k-${id}`, w.lead]);
    return id;
  };
  /** A finish confirmed by the client. */
  async function finish(w: World, title: string, categoryKey: string) {
    const id = randomUUID(), versionId = randomUUID();
    await addEntry(w.client, w.workspaceId, w.caseId, { id, versionId, kind: "material", title, categoryKey, source: "showroom", saidAt: new Date(Date.now() - 60_000).toISOString() }, { userId: w.lead });
    await decideVersion(w.client, w.workspaceId, w.caseId, id, versionId, { decision: "confirmed", method: "in_person", decidedBy: "Maya Client", recordedBy: w.lead });
    return { id, versionId };
  }

  it("holds ordering until the client signs the samples and data sheets, tells the designer when procurement tried and procurement when the gate clears", async () => {
    await world(async (w) => {
      const { projectId, vendor, orders, core } = await started(w);
      await saveFinishSettings(w.client, w.workspaceId, { version: 0, categories: [{ key: "sanitary_ware", label: "Sanitary ware", clientSignature: true }, { key: "lighting", label: "Lighting" }] }, w.manager);
      const wc = await finish(w, "Wall-hung WC", "sanitary_ware");
      await finish(w, "Pendant light", "lighting");
      await lockLedger(w.client, w.workspaceId, w.caseId, w.lead, "design_sign_off", null);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "WC frame", quantity: "1", unit: "pcs", clientChoice: false, version: detail.project.version });

      // The three parts: payment in and the material list confirmed, the signed WC missing.
      expect(await procurementGate(w.client, w.workspaceId, projectId)).toMatchObject({ payment: true, materials: true, signatures: { missing: ["Wall-hung WC"], exempt: false }, cleared: false });
      const need = (await orders.needs(actor, w.workspaceId)).needs.find((item) => item.title === "WC frame")!;
      expect(need.blocked).toBe("client_signature");
      const id = randomUUID();
      const order = await orders.create(actor, w.workspaceId, { id, vendorId: vendor, lines: [{ source: "material", materialItemId: need.sourceId, quantity: "1", unitPrice: "450" }] });
      await expect(orders.command(actor, w.workspaceId, id, { action: "submit", version: order.order.version })).rejects.toThrow(/hasn't signed the samples or data sheets of PRJ-0001 yet: Wall-hung WC/);
      // The designer hears it (once a day), though the order was refused.
      expect((await told(w, "procurement.signature_missing")).map((row) => [row.recipient, row.body])).toEqual([[w.lead, "buyer tried to order. The client still signs: Wall-hung WC.".replace("buyer", "Dana Buyer")]]);
      await expect(orders.command(actor, w.workspaceId, id, { action: "submit", version: order.order.version })).rejects.toThrow(/Wall-hung WC/);
      expect(await told(w, "procurement.signature_missing")).toHaveLength(1);
      // The reminder engine chases the lead designer for the signatures.
      const due = await signatureDueSource.open(w.client, w.workspaceId, { clock: await workspaceClock(w.client, w.workspaceId), now: new Date(), limit: 20 });
      expect(due).toEqual([expect.objectContaining({ key: `signatures:${projectId}`, ownerMembershipId: w.leadMembership, title: "Client signatures · PRJ-0001 · Villa 12" })]);
      expect(await processProcurementGates(w.client, w.workspaceId)).toEqual({ cleared: 0 });

      // The designer records the signed WC (photo and day): the gate clears, procurement hears it once, and the order goes.
      await expect(recordSignature(w.client, w.workspaceId, w.caseId, wc.id, { id: randomUUID(), versionId: wc.versionId, signedOn: "2999-01-01", signer: "Maya Client", assetId: await photo(w) }, w.lead))
        .rejects.toThrow(/future/);
      const signature = { id: randomUUID(), versionId: wc.versionId, signedOn: new Date().toISOString().slice(0, 10), signer: "Maya Client", assetId: await photo(w) };
      await recordSignature(w.client, w.workspaceId, w.caseId, wc.id, signature, w.lead);
      expect(await recordSignature(w.client, w.workspaceId, w.caseId, wc.id, signature, w.lead)).toEqual({ replayed: true });
      expect(await signatureDueSource.stillOpen(w.client, w.workspaceId, [`signatures:${projectId}`])).toEqual(new Set());
      expect(await processProcurementGates(w.client, w.workspaceId)).toEqual({ cleared: 1 });
      expect(await processProcurementGates(w.client, w.workspaceId)).toEqual({ cleared: 0 });
      expect((await told(w, "procurement.gate_cleared")).map((row) => row.recipient)).toEqual([w.buyer]);
      const placed = await orders.command(actor, w.workspaceId, id, { action: "submit", version: order.order.version });
      // Submitted (it goes to the firm's order approval above its threshold).
      expect(placed.order.status).toBe("pending_approval");

      // A finish added after the firm started asking holds new orders again; procurement placed before isn't blocked after the fact.
      await w.client.query("UPDATE purchase_orders SET status = 'approved', approved_at = now() WHERE workspace_id = $1 AND id = $2", [w.workspaceId, id]);
      await finish(w, "Basin mixer", "sanitary_ware");
      expect((await signatureGate(w.client, w.workspaceId, projectId)).missing).toEqual(["Basin mixer"]);
      await w.client.query("UPDATE workspace_finish_settings SET signature_required_since = now() + interval '1 minute' WHERE workspace_id = $1", [w.workspaceId]);
      expect(await signatureGate(w.client, w.workspaceId, projectId)).toMatchObject({ missing: [], exempt: true });
    });
  });

  it("asks nothing when no category needs the client's signature (the gate is configuration)", async () => {
    await world(async (w) => {
      const { projectId } = await started(w);
      await finish(w, "Wall-hung WC", "sanitary_ware");
      expect(await signatureGate(w.client, w.workspaceId, projectId)).toMatchObject({ missing: [], required: 0 });
    });
  });
});
