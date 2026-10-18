import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { OrdersService } from "../purchasing/orders.service";
import { priceHolds } from "../purchasing/price-hold";
import { SuppliersService } from "../purchasing/suppliers.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { boqChanged, readBoqState } from "./project-boq-state";
import { ProjectCoreService } from "./project-core.service";
import { autoStartProject } from "./project-start";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

type Access = (userId: string, permissions: string[]) => unknown;
type World = {
  client: PoolClient; workspaceId: string; caseId: string; quoteId: string; manager: string; designer: string; qs: string;
  managerMembership: string; designerMembership: string; qsMembership: string; access: Access;
  as: (userId: string, permissions?: string[]) => ProjectCoreService;
};
const EVERYTHING = ["projects.manage", "projects.view", "pre_projects.view", "workspace.settings.manage"];
const BUYING = ["vendors.view", "vendors.manage", "vendors.approve", "purchasing.view", "purchasing.manage", "purchasing.approve", "stock.view", "stock.manage", "workspace.settings.manage"];

integration("project BOQ lifecycle and the ordering gate (PLM-159 / 161 / 163 / 167 / 168 / 169)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(work: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), manager = randomUUID(), designer = randomUUID(), qs = randomUUID();
    const managerMembership = randomUUID(), designerMembership = randomUUID(), qsMembership = randomUUID(), party = randomUUID(), opportunity = randomUUID(), kitchen = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Omar Manager'),($3,$4,'Tariq Technical'),($5,$6,'Quinn QS')",
        [manager, `${manager.slice(0, 8)}@example.com`, designer, `${designer.slice(0, 8)}@example.com`, qs, `${qs.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `bq-${workspaceId.slice(0, 8)}`, manager]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active'),($6,$2,$7,'active')",
        [managerMembership, workspaceId, manager, designerMembership, designer, qsMembership, qs]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), designerMembership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, manager]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      // The QS holds commercial.estimate for real (the notices find the QS by permission); the manager manages projects.
      const qsRole = randomUUID(), pmRole = randomUUID();
      await client.query("INSERT INTO roles (id, workspace_id, code, name) VALUES ($1, $2, 'quantity_surveyor', 'QS'), ($3, $2, 'pm', 'PM')", [qsRole, workspaceId, pmRole]);
      await client.query("INSERT INTO role_permissions (workspace_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE code = 'commercial.estimate'", [workspaceId, qsRole]);
      await client.query("INSERT INTO role_permissions (workspace_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE code = 'projects.manage'", [workspaceId, pmRole]);
      await client.query("INSERT INTO member_roles (workspace_id, membership_id, role_id) VALUES ($1, $2, $3), ($1, $4, $5)", [workspaceId, qsMembership, qsRole, managerMembership, pmRole]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      // Each call runs in its own savepoint, as in the app: a command that fails part-way leaves nothing behind.
      const access: Access = (userId, permissions) => {
        const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
          if (!(Array.isArray(code) ? code : [code]).some((item) => permissions.includes(item))) throw new Error("Not allowed");
          await client.query("SAVEPOINT command");
          try { const result = await fn(client, { userId }); await client.query("RELEASE SAVEPOINT command"); return result; }
          catch (error) { await client.query("ROLLBACK TO SAVEPOINT command"); throw error; }
        };
        const member = async (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => run(_a, _w, permissions, fn);
        return { withPermission: run, withAnyPermission: run, withPermissions: run, asMember: member, hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) };
      };
      const as = (userId: string, permissions = EVERYTHING) => new ProjectCoreService(access(userId, permissions) as never);
      const builder = new QuotationBuilderService({ withPermission: (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: manager }),
        withPermissions: (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: manager }),
        withAnyPermission: (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: manager }), hasPermission: async () => true } as never, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "a", title: "Kitchen cabinets", unit: "m", quantity: "4.5", rate: "1200", areaId: kitchen } },
        { op: "upsert", line: { id: "b", title: "Worktop", unit: "m²", quantity: "2.25", rate: "800", areaId: kitchen } },
        { op: "upsert", line: { id: "c", title: "Under-cabinet lights", unit: "nos", quantity: "1", rate: "650" } },
      ] });
      await work({ client, workspaceId, caseId, quoteId, manager, designer, qs, managerMembership, designerMembership, qsMembership, access, as });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** The client accepts, the agreement is signed and the advance is verified (or not). */
  async function accept(w: World, options: { paid?: boolean } = {}) {
    const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
    const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
    const quote = data.quotes.find((item) => item.id === w.quoteId)!;
    quote.status = "accepted";
    quote.hash = freezeHash(quote);
    const total = 4.5 * 1200 + 2.25 * 800 + 650;
    quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: total, optionsTotal: 0, acceptedTotal: total,
      decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
    data.agreement = { quoteId: w.quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
    data.payments = [{ id: "p1", sourceQuoteId: w.quoteId, title: "Advance", amount: total / 2, dueDate: "", requiredForRelease: true, requiredForProduction: false,
      status: options.paid === false ? "pending" : "verified", proof: "bank transfer", reference: "TT-1", evidenceKind: "operational" }];
    data.revision = loaded.revision + 1;
    await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
    return total;
  }

  /** A started project with the BOQ lifecycle on, the technical designer named, a buying company and an approved supplier. */
  async function started(w: World) {
    await accept(w);
    const core = w.as(w.manager);
    const settings = await core.settings(actor, w.workspaceId);
    await core.saveSettings(actor, w.workspaceId, { version: settings.settings.version, boqReview: true });
    const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
    let detail = await core.get(actor, w.workspaceId, projectId);
    detail = await core.command(actor, w.workspaceId, projectId, { action: "set_member", role: "technical_designer", membershipId: w.designerMembership, version: detail.project.version });
    const company = randomUUID(), vendor = randomUUID();
    await w.client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,'FAC','Studio Furniture','Studio Furniture LLC','AE','AED','en-AE','Asia/Dubai')`, [company, w.workspaceId]);
    const profile = randomUUID();
    await w.client.query(`INSERT INTO tax_profiles(id,workspace_id,legal_entity_id,name,jurisdiction_code,scheme,prices_include_tax,effective_from,version) VALUES($1,$2,$3,'VAT','AE','vat',false,now(),1)`, [profile, w.workspaceId, company]);
    await w.client.query(`INSERT INTO tax_rates(workspace_id,tax_profile_id,code,label,rate,is_default) VALUES($1,$2,'standard','Standard','5',true)`, [w.workspaceId, profile]);
    await w.client.query(`INSERT INTO workspace_purchasing_settings (workspace_id, approval_threshold, require_material_signoff, require_approved_supplier) VALUES ($1, NULL, false, true)`, [w.workspaceId]);
    const buyer = new OrdersService(w.access(w.manager, BUYING) as never);
    const suppliers = new SuppliersService(w.access(w.manager, BUYING) as never);
    const saved = await suppliers.save(actor, w.workspaceId, { id: vendor, version: 0, name: "Nile Marble", entityIds: [company], email: "orders@nile.example" });
    await suppliers.approve(actor, w.workspaceId, vendor, { version: saved.suppliers[0].version, approval: "approved" });
    return { core, projectId, version: detail.project.version, vendor, buyer, technical: w.as(w.designer, ["projects.view"]), qs: w.as(w.qs, ["commercial.estimate"]) };
  }

  const told = async (w: World, code: string) => (await w.client.query<{ id: string }>("SELECT recipient_id AS id FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND channel = 'in_app' ORDER BY created_at",
    [w.workspaceId, code])).rows.map((row) => row.id);

  it("PLM-167 / PLM-168: starts as a draft, is verified by the technical team, approved by the QS as BOQ R1, locked by the manager, and returned with a reason; each step tells its next owner", async () => {
    await world(async (w) => {
      const { core, projectId, technical, qs } = await started(w);
      let state = await readBoqState(w.client, w.workspaceId, projectId);
      expect(state).toMatchObject({ status: "draft", revision: 0, label: null, current: false });
      expect(state.history.map((entry) => entry.kind)).toEqual(["drafted"]);
      let scope = await technical.scope(actor, w.workspaceId, projectId);
      expect(scope.boq).toMatchObject({ enabled: true, status: "draft", actions: ["verify"] });
      // The QS can't approve a draft, and nobody but the QS approves.
      let detail = await core.get(actor, w.workspaceId, projectId);
      await expect(qs.command(actor, w.workspaceId, projectId, { action: "qs_approve_boq", version: detail.project.version })).rejects.toThrow(/technical team verifies the BOQ before/);
      await expect(technical.command(actor, w.workspaceId, projectId, { action: "lock_boq", version: detail.project.version })).rejects.toThrow(/Only the project manager locks/);

      // The technical designer verifies: the QS hears.
      detail = await technical.command(actor, w.workspaceId, projectId, { action: "verify_boq", version: detail.project.version });
      state = await readBoqState(w.client, w.workspaceId, projectId);
      expect(state).toMatchObject({ status: "technical_verified", verifiedByName: "Tariq Technical" });
      expect(await told(w, "project.boq_verified")).toEqual([w.qs]);
      await expect(core.command(actor, w.workspaceId, projectId, { action: "qs_approve_boq", version: detail.project.version })).rejects.toThrow(/Only the QS approves/);

      // The QS approves: BOQ R1 is kept with the lines, quantities, rates and amounts; the manager hears.
      detail = await qs.command(actor, w.workspaceId, projectId, { action: "qs_approve_boq", version: detail.project.version });
      state = await readBoqState(w.client, w.workspaceId, projectId);
      expect(state).toMatchObject({ status: "qs_approved", revision: 1, label: "R1", current: true, approvedByName: "Quinn QS" });
      expect(state.revisions).toHaveLength(1);
      expect(state.revisions[0]).toMatchObject({ label: "R1", lines: 3, currency: "AED", approvedByName: "Quinn QS", cost: null });
      expect(Number(state.revisions[0].total)).toBe(4.5 * 1200 + 2.25 * 800 + 650);
      const snapshot = (await w.client.query<{ snapshot: { lines: Array<{ title: string; quantity: string; rate: string }> } }>("SELECT snapshot FROM project_boq_revisions WHERE project_id = $1", [projectId])).rows[0].snapshot;
      expect(snapshot.lines.map((line) => [line.title, Number(line.quantity), Number(line.rate)])).toEqual([["Kitchen cabinets", 4.5, 1200], ["Worktop", 2.25, 800], ["Under-cabinet lights", 1, 650]]);
      expect(await told(w, "project.boq_approved")).toEqual([w.manager]);
      scope = await qs.scope(actor, w.workspaceId, projectId);
      expect(scope.boq?.actions).toEqual(["return"]);
      // The history can't be rewritten.
      await w.client.query("SAVEPOINT tamper");
      await expect(w.client.query("UPDATE project_boq_revisions SET total = 1 WHERE project_id = $1", [projectId])).rejects.toThrow(/BOQ history cannot be changed/);
      await w.client.query("ROLLBACK TO SAVEPOINT tamper");

      // The manager locks; a stale version is refused; a return needs its reason and goes back to draft.
      await expect(core.command(actor, w.workspaceId, projectId, { action: "lock_boq", version: detail.project.version - 1 })).rejects.toThrow(/Someone else changed/);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "lock_boq", version: detail.project.version });
      expect((await readBoqState(w.client, w.workspaceId, projectId)).status).toBe("locked");
      await expect(core.command(actor, w.workspaceId, projectId, { action: "return_boq", version: detail.project.version })).rejects.toThrow(/Say why the BOQ goes back to draft/);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "return_boq", reason: "Worktop quantity is wrong", version: detail.project.version });
      state = await readBoqState(w.client, w.workspaceId, projectId);
      expect(state).toMatchObject({ status: "draft", revision: 1, label: "R1", returnReason: "Worktop quantity is wrong", verifiedAt: null, lockedAt: null });
      expect(state.history.map((entry) => entry.kind)).toEqual(["returned", "locked", "qs_approved", "verified", "drafted"]);
      expect(await told(w, "project.boq_returned")).toEqual([w.designer]);
      // Verified and approved again: BOQ R2.
      detail = await technical.command(actor, w.workspaceId, projectId, { action: "verify_boq", version: detail.project.version });
      detail = await qs.command(actor, w.workspaceId, projectId, { action: "qs_approve_boq", version: detail.project.version });
      expect((await readBoqState(w.client, w.workspaceId, projectId)).label).toBe("R2");
      // A variation that changes the live BOQ returns it to draft by itself.
      expect(await boqChanged(w.client, w.workspaceId, projectId, "VO-1", w.manager)).toBe(true);
      state = await readBoqState(w.client, w.workspaceId, projectId);
      expect(state).toMatchObject({ status: "draft", revision: 2 });
      expect(state.history[0]).toMatchObject({ kind: "changed", detail: { by: "VO-1" } });
      expect(await boqChanged(w.client, w.workspaceId, projectId, "VO-1", w.manager)).toBe(false);
    });
  });

  it("PLM-159 / PLM-163: with the gates on, To order holds a project's lines until the QS approves its BOQ; an order waits for each check unless an approver marks it not applicable; the QS signs off the order and confirms the material list", async () => {
    await world(async (w) => {
      const { core, projectId, vendor, buyer, technical, qs } = await started(w);
      const settings = await buyer.settings(actor, w.workspaceId);
      await buyer.saveSettings(actor, w.workspaceId, { version: settings.settings.version, requireBoqApproved: true, requireQsSignoff: true, requireMaterialListConfirmed: true });
      // Everything the project needs waits for the BOQ.
      let { needs } = await buyer.needs(actor, w.workspaceId);
      expect(needs.length).toBeGreaterThan(0);
      expect(new Set(needs.map((need) => need.blocked))).toEqual(new Set(["boq_approval"]));
      const scope = await core.scope(actor, w.workspaceId, projectId);
      const lights = scope.lines.find((line) => line.title === "Under-cabinet lights")!;
      // The package must be bought for the line to be a need; put it in a bought package.
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", id: scope.packages.find((item) => scope.lines.some((line) => line.packageId === item.id && line.id === lights.id))?.id ?? scope.packages[0].id,
        name: "Lighting", supply: "ready_made", version: detail.project.version });

      const orderId = randomUUID();
      let order = await buyer.create(actor, w.workspaceId, { id: orderId, vendorId: vendor, lines: [{ source: "line", boqLineId: lights.id, quantity: "1", unitPrice: "500" }] });
      expect(order.gate.map((check) => [check.key, check.required, check.passed])).toEqual([["boq_approved", true, false], ["qs_signoff", true, false], ["material_list_confirmed", true, false]]);
      await expect(buyer.command(actor, w.workspaceId, orderId, { action: "submit", version: order.order.version })).rejects.toThrow(/BOQ of PRJ-0001 isn't approved by the QS yet/);
      // Someone who approves orders marks the BOQ check not applicable here, with a reason; the next check still holds.
      await expect(buyer.command(actor, w.workspaceId, orderId, { action: "waive_check", checkKey: "boq_approved", version: order.order.version })).rejects.toThrow(/Say why this check doesn't apply/);
      order = await buyer.command(actor, w.workspaceId, orderId, { action: "waive_check", checkKey: "boq_approved", reason: "Lights were agreed separately", version: order.order.version });
      expect(order.gate.find((check) => check.key === "boq_approved")?.waiver).toMatchObject({ reason: "Lights were agreed separately", byName: "Omar Manager" });
      await expect(buyer.command(actor, w.workspaceId, orderId, { action: "submit", version: order.order.version })).rejects.toThrow(/QS hasn't signed off this order yet/);
      // The QS signs off the order (and only the QS); changing its lines clears the sign-off.
      const qsOrders = new OrdersService(w.access(w.qs, ["commercial.estimate"]) as never);
      await expect(buyer.command(actor, w.workspaceId, orderId, { action: "qs_signoff", version: order.order.version })).rejects.toThrow(/Only the QS signs off/);
      await expect(qsOrders.command(actor, w.workspaceId, orderId, { action: "waive_check", checkKey: "qs_signoff", reason: "x", version: order.order.version })).rejects.toThrow(/can't change purchase orders/);
      order = await qsOrders.command(actor, w.workspaceId, orderId, { action: "qs_signoff", version: order.order.version });
      expect(order.order).toMatchObject({ qsSignedOffByName: "Quinn QS" });
      expect(order.gate.find((check) => check.key === "qs_signoff")?.passed).toBe(true);
      expect(await told(w, "purchasing.qs_signed_off")).toEqual([w.manager]);
      order = await buyer.command(actor, w.workspaceId, orderId, { action: "save", lines: [{ id: order.lines[0].id, source: "line", boqLineId: lights.id, projectId, description: "Under-cabinet lights", quantity: "1", unit: "nos", unitPrice: "520", discountPercent: "0", taxRate: "5" }], version: order.order.version });
      expect(order.order.qsSignedOffAt).toBeNull();
      order = await qsOrders.command(actor, w.workspaceId, orderId, { action: "qs_signoff", version: order.order.version });
      await expect(buyer.command(actor, w.workspaceId, orderId, { action: "submit", version: order.order.version })).rejects.toThrow(/QS hasn't confirmed the material list of PRJ-0001/);
      // The QS confirms the material list once it has materials; a changed list needs confirming again.
      await expect(qs.command(actor, w.workspaceId, projectId, { action: "confirm_material_list", version: detail.project.version })).rejects.toThrow(/Add the materials before confirming/);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", clientChoice: false, version: detail.project.version });
      await expect(technical.command(actor, w.workspaceId, projectId, { action: "confirm_material_list", version: detail.project.version })).rejects.toThrow(/Only the QS confirms/);
      detail = await qs.command(actor, w.workspaceId, projectId, { action: "confirm_material_list", version: detail.project.version });
      expect((await qs.materials(actor, w.workspaceId, projectId)).qsConfirmation).toMatchObject({ confirmedByName: "Quinn QS", current: true });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Brass handles", clientChoice: false, version: detail.project.version });
      expect((await qs.materials(actor, w.workspaceId, projectId)).qsConfirmation?.current).toBe(false);
      detail = await qs.command(actor, w.workspaceId, projectId, { action: "confirm_material_list", version: detail.project.version });
      // Every check holds or is marked not applicable: the order is placed.
      order = await buyer.command(actor, w.workspaceId, orderId, { action: "submit", version: order.order.version });
      expect(order.order.status).toBe("approved");
      expect((await w.client.query("SELECT kind FROM purchase_order_events WHERE order_id = $1 ORDER BY at", [orderId])).rows.map((row) => row.kind))
        .toEqual(expect.arrayContaining(["check_waived", "qs_signed_off", "qs_signoff_cleared", "approved"]));

      // Once the QS approves the BOQ, To order offers the project's lines again.
      detail = await technical.command(actor, w.workspaceId, projectId, { action: "verify_boq", version: detail.project.version });
      await qs.command(actor, w.workspaceId, projectId, { action: "qs_approve_boq", version: detail.project.version });
      ({ needs } = await buyer.needs(actor, w.workspaceId));
      expect(needs.every((need) => need.blocked === null)).toBe(true);
    });
  });

  it("PLM-169: a line whose ordered cost is above the agreed amount, or whose change is pending, is held on the order, the work order and the project until the client's approved price correction; QS approval never clears it", async () => {
    await world(async (w) => {
      const { core, projectId, vendor, buyer, technical, qs } = await started(w);
      const settings = await buyer.settings(actor, w.workspaceId);
      await buyer.saveSettings(actor, w.workspaceId, { version: settings.settings.version, requirePriceApproval: true });
      const scope = await core.scope(actor, w.workspaceId, projectId);
      const worktop = scope.lines.find((line) => line.title === "Worktop")!;
      const cabinets = scope.lines.find((line) => line.title === "Kitchen cabinets")!;
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", id: scope.packages[0].id, name: "Kitchen", supply: "buy", version: detail.project.version });
      // The worktop was agreed at 2.25 × 800 = 1,800; a draft order at 1,000/m² costs 2,250.
      const orderId = randomUUID();
      let order = await buyer.create(actor, w.workspaceId, { id: orderId, vendorId: vendor, lines: [{ source: "line", boqLineId: worktop.id, quantity: "2.25", unitPrice: "1000" }] });
      const check = order.gate.find((item) => item.key === "price_approved");
      expect(check).toMatchObject({ required: true, passed: false });
      expect(check?.missing).toMatch(/Worktop: AED 2250\.00 ordered against AED 1800\.00 agreed/);
      await expect(buyer.command(actor, w.workspaceId, orderId, { action: "submit", version: order.order.version })).rejects.toThrow(/the client approves the price correction first/);
      expect([...(await priceHolds(w.client, w.workspaceId, { projectId })).keys()]).toEqual([worktop.id]);
      expect((await core.scope(actor, w.workspaceId, projectId)).boq?.priceHolds.map((hold) => hold.lineId)).toEqual([worktop.id]);
      // The QS approving the BOQ changes nothing about the hold.
      detail = await technical.command(actor, w.workspaceId, projectId, { action: "verify_boq", version: detail.project.version });
      detail = await qs.command(actor, w.workspaceId, projectId, { action: "qs_approve_boq", version: detail.project.version });
      expect((await priceHolds(w.client, w.workspaceId, { orderId })).size).toBe(1);
      // A price correction the client approved clears it; a change still with the client holds the line it names.
      const insertChange = async (id: string, number: number, kind: string, status: string, lineId: string) => {
        await w.client.query("SET LOCAL session_replication_role = replica");
        const approved = status === "approved";
        await w.client.query(`INSERT INTO change_requests (id, workspace_id, case_id, number, kind, title, status, currency, price_impact, raised_by, project_id, reason, decided_at, decided_by_name, decision_method)
          VALUES ($1, $2, $3, $4, $5, 'Worktop price', $6, 'AED', 450, $7, $8, 'site_condition', $9::timestamptz, $10, $11)`,
          [id, w.workspaceId, w.caseId, number, kind, status, w.manager, projectId, approved ? new Date().toISOString() : null, approved ? "Maya Client" : null, approved ? "portal" : null]);
        await w.client.query(`INSERT INTO change_request_lines (id, workspace_id, change_request_id, position, source, action, boq_line_id, title, amount) VALUES ($1, $2, $3, 0, 'boq_line', 'replace', $4, 'Worktop', 450)`,
          [randomUUID(), w.workspaceId, id, lineId]);
        await w.client.query("SET LOCAL session_replication_role = origin");
      };
      await insertChange(randomUUID(), 1, "price_correction", "approved", worktop.id);
      expect((await priceHolds(w.client, w.workspaceId, { projectId })).size).toBe(0);
      order = await buyer.command(actor, w.workspaceId, orderId, { action: "submit", version: order.order.version });
      expect(order.order.status).toBe("approved");
      await insertChange(randomUUID(), 2, "addition", "with_client", cabinets.id);
      const holds = await priceHolds(w.client, w.workspaceId, { lineIds: [cabinets.id, worktop.id] });
      expect([...holds.entries()]).toEqual([[cabinets.id, "Kitchen cabinets: change CR-002 waits for the client's decision"]]);
    });
  });

  it("PLM-161: with the setting on, the project (and its draft BOQ) starts by itself once the upfront payment is verified and the start rules pass, with the planning record's project manager; idempotent", async () => {
    await world(async (w) => {
      const core = w.as(w.manager);
      const settings = await core.settings(actor, w.workspaceId);
      const access = w.access(w.manager, EVERYTHING) as never;
      // Off: nothing happens, whatever is paid.
      await accept(w);
      expect(await autoStartProject(w.client, access, w.workspaceId, w.caseId, w.manager)).toEqual({ started: false, projectId: null, reason: "off" });
      await core.saveSettings(actor, w.workspaceId, { version: settings.settings.version, autoStartOnPayment: true, boqReview: true });
      // On, but the advance isn't verified: not yet.
      await accept(w, { paid: false });
      expect((await autoStartProject(w.client, access, w.workspaceId, w.caseId, w.manager)).reason).toBe("not_ready");
      // Verified, but nobody is the project manager on the planning record: the people who manage projects are told to start it.
      await accept(w);
      expect((await autoStartProject(w.client, access, w.workspaceId, w.caseId, w.manager)).reason).toBe("no_manager");
      expect(await told(w, "project.ready_to_start")).toEqual([w.manager]);
      // The planning record names its project manager: the project starts with its draft BOQ, and the technical designer is told to verify it.
      await w.client.query("INSERT INTO project_assignments (workspace_id, case_id, membership_id, is_manager, active, role_keys) VALUES ($1, $2, $3, false, true, ARRAY['project_manager']::varchar[]), ($1, $2, $4, false, true, ARRAY['technical_designer']::varchar[])",
        [w.workspaceId, w.caseId, w.managerMembership, w.designerMembership]);
      const result = await autoStartProject(w.client, access, w.workspaceId, w.caseId, w.manager);
      expect(result).toMatchObject({ started: true, reason: null });
      const projectId = result.projectId!;
      const detail = await core.get(actor, w.workspaceId, projectId);
      expect(detail.project).toMatchObject({ reference: "PRJ-0001", status: "active" });
      expect(detail.team.find((role) => role.role === "project_manager")?.member?.name).toBe("Omar Manager");
      expect((await readBoqState(w.client, w.workspaceId, projectId)).status).toBe("draft");
      expect((await core.scope(actor, w.workspaceId, projectId)).lines).toHaveLength(3);
      expect(await told(w, "project.boq_draft_ready")).toEqual([w.designer]);
      // Again: the started project is left alone.
      expect(await autoStartProject(w.client, access, w.workspaceId, w.caseId, w.manager)).toEqual({ started: false, projectId, reason: "started" });
      expect((await w.client.query("SELECT count(*)::int AS count FROM delivery_projects WHERE workspace_id = $1", [w.workspaceId])).rows[0].count).toBe(1);
    });
  });
});
