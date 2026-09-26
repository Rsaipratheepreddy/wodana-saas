import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash, totals } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { canonicalHash } from "../crm/shared/crm-types";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { ProjectCoreService } from "./project-core.service";
import { ProjectWorkService } from "./project-work.service";
import { processWorkDeadlines } from "./work-reminders";
import { OrdersService } from "../purchasing/orders.service";
import { PriceRequestsService } from "../purchasing/price-requests.service";
import { ReceivingService } from "../purchasing/receiving.service";
import { SupplierReturnsService } from "../purchasing/returns.service";
import { InventoryService } from "../inventory/inventory.service";
import { SuppliersService } from "../purchasing/suppliers.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

type World = {
  client: PoolClient; workspaceId: string; caseId: string; quoteId: string; manager: string; designer: string; managerMembership: string; designerMembership: string;
  as: (userId: string, permissions?: string[]) => ProjectCoreService; work: (userId: string, permissions?: string[]) => ProjectWorkService; builder: QuotationBuilderService;
};

integration("projects core (plan §6.10)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(work_: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), manager = randomUUID(), designer = randomUUID();
    const managerMembership = randomUUID(), designerMembership = randomUUID(), party = randomUUID(), opportunity = randomUUID(), kitchen = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Omar Manager'),($3,$4,'Dana Designer')", [manager, `${manager.slice(0, 8)}@example.com`, designer, `${designer.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `pc-${workspaceId.slice(0, 8)}`, manager]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')", [managerMembership, workspaceId, manager, designerMembership, designer]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), designerMembership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, manager]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const run = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const member = (userId: string) => (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const access = (userId: string, permissions: string[]) => ({
        asMember: member(userId), withPermission: run(userId), withAnyPermission: run(userId),
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code),
      } as never);
      const everything = ["projects.manage", "projects.view", "pre_projects.view", "workspace.settings.manage"];
      const as = (userId: string, permissions = everything) => new ProjectCoreService(access(userId, permissions));
      const work = (userId: string, permissions = everything) => new ProjectWorkService(access(userId, permissions));
      const builder = new QuotationBuilderService({ withPermission: run(manager), withPermissions: run(manager), withAnyPermission: run(manager), hasPermission: async () => true } as never, {} as never);
      // The quote: two lines, one option the client chose and one they didn't.
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "a", title: "Kitchen cabinets", unit: "m", quantity: "4.5", rate: "1200", areaId: kitchen } },
        { op: "upsert", line: { id: "b", title: "Worktop", unit: "m²", quantity: "2.25", rate: "800", areaId: kitchen } },
        { op: "upsert", line: { id: "c", title: "Under-cabinet lights", unit: "nos", quantity: "1", rate: "650", optional: true } },
        { op: "upsert", line: { id: "d", title: "Wine fridge", unit: "nos", quantity: "1", rate: "3000", optional: true } },
      ] });
      await work_({ client, workspaceId, caseId, quoteId, manager, designer, managerMembership, designerMembership, as, work, builder });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** The client accepts (choosing the lights), the agreement is signed and the advance is verified. */
  async function accept(w: World, options: { agreement?: boolean; paid?: boolean; acceptedTotal?: number } = {}) {
    const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
    const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
    const quote = data.quotes.find((item) => item.id === w.quoteId)!;
    quote.status = "accepted";
    quote.hash = freezeHash(quote);
    const total = 4.5 * 1200 + 2.25 * 800 + 650;
    quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: ["c"], baseTotal: total - 650, optionsTotal: 650,
      acceptedTotal: options.acceptedTotal ?? total, decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
    if (options.agreement !== false)
      data.agreement = { quoteId: w.quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
    data.payments = [{ id: "p1", sourceQuoteId: w.quoteId, title: "Advance", amount: total / 2, dueDate: "", requiredForRelease: true, requiredForProduction: false,
      status: options.paid === false ? "pending" : "verified", proof: "bank transfer", reference: "TT-1", evidenceKind: "operational" },
      { id: "p2", sourceQuoteId: w.quoteId, title: "Before production", amount: total / 2, dueDate: "", requiredForRelease: false, requiredForProduction: true, status: "pending", proof: "", reference: "" }];
    data.revision = loaded.revision + 1;
    await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
    return total;
  }

  /** A started project with a buying company and an approved supplier, and purchasing services for the designer (buyer) and the manager (receiver, inspector, approver). */
  async function buying(w: World, settings: { threshold?: string | null; signoff?: boolean; inspection?: boolean } = {}) {
    await accept(w);
    const core = w.as(w.manager);
    const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
    const company = randomUUID(), vendor = randomUUID();
    await w.client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,'FAC','Studio Furniture','Studio Furniture LLC','AE','AED','en-AE','Asia/Dubai')`, [company, w.workspaceId]);
    const profile = randomUUID();
    await w.client.query(`INSERT INTO tax_profiles(id,workspace_id,legal_entity_id,name,jurisdiction_code,scheme,prices_include_tax,effective_from,version) VALUES($1,$2,$3,'VAT','AE','vat',false,now(),1)`, [profile, w.workspaceId, company]);
    await w.client.query(`INSERT INTO tax_rates(workspace_id,tax_profile_id,code,label,rate,is_default) VALUES($1,$2,'standard','Standard','5',true)`, [w.workspaceId, profile]);
    // Each call is its own transaction, as in the app: a command that fails part-way leaves nothing behind.
    const access = (userId: string, permissions: string[]) => {
      const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
        if (!(Array.isArray(code) ? code : [code]).some((item) => permissions.includes(item))) throw new Error("Not allowed");
        await w.client.query("SAVEPOINT command");
        try {
          const result = await fn(w.client, { userId });
          await w.client.query("RELEASE SAVEPOINT command");
          return result;
        } catch (error) {
          await w.client.query("ROLLBACK TO SAVEPOINT command");
          throw error;
        }
      };
      return { withPermission: run, withAnyPermission: run, hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never;
    };
    const all = ["vendors.view", "vendors.manage", "vendors.approve", "purchasing.view", "purchasing.manage", "purchasing.approve", "stock.view", "stock.manage", "stock.adjust", "stock.receive", "stock.inspect", "workspace.settings.manage"];
    const buyer = { orders: new OrdersService(access(w.designer, all)), receiving: new ReceivingService(access(w.designer, all)), returns: new SupplierReturnsService(access(w.designer, all)),
      stock: new InventoryService(access(w.designer, all)), suppliers: new SuppliersService(access(w.designer, all)) };
    buyer.returns = new SupplierReturnsService(access(w.designer, all));
    const manager = { orders: new OrdersService(access(w.manager, all)), receiving: new ReceivingService(access(w.manager, all)), suppliers: new SuppliersService(access(w.manager, all)) };
    await w.client.query(`INSERT INTO workspace_purchasing_settings (workspace_id, approval_threshold, require_material_signoff, require_approved_supplier, require_inspection) VALUES ($1, $2, $3, true, $4)`,
      [w.workspaceId, settings.threshold === undefined ? null : settings.threshold, settings.signoff ?? true, settings.inspection ?? false]);
    const saved = await buyer.suppliers.save(actor, w.workspaceId, { id: vendor, version: 0, name: "Nile Marble", entityIds: [company], email: "orders@nile.example" });
    await manager.suppliers.approve(actor, w.workspaceId, vendor, { version: saved.suppliers[0].version, approval: "approved" });
    return { core, projectId, company, vendor, buyer, manager, access, all };
  }

  /** Draft → placed → sent, as the buyer. */
  async function placeOrder(orders: OrdersService, workspaceId: string, vendor: string, lines: unknown[], extra: Record<string, unknown> = {}) {
    const id = randomUUID();
    let state = await orders.create(actor, workspaceId, { id, vendorId: vendor, lines });
    state = await orders.command(actor, workspaceId, id, { action: "submit", version: state.order.version, ...extra });
    state = await orders.command(actor, workspaceId, id, { action: "send", version: state.order.version });
    return state;
  }

  it("starts from the accepted quotation: seals the scope, names the team and copies the stages; starting again returns the same project", async () => {
    await world(async (w) => {
      const total = await accept(w);
      // Someone already working on the planning record, and its site location.
      const site = randomUUID();
      await w.client.query("INSERT INTO project_assignments(workspace_id,case_id,membership_id) VALUES($1,$2,$3)", [w.workspaceId, w.caseId, w.designerMembership]);
      await w.client.query("INSERT INTO work_locations(id,workspace_id,name,kind,case_id,address,latitude,longitude,radius_m,active,version) VALUES($1,$2,'Villa site','site',$3,'',25.1,55.2,150,true,1)", [site, w.workspaceId, w.caseId]);
      const service = w.as(w.manager);
      const state = await service.startState(actor, w.workspaceId, w.caseId);
      expect(state.canStart).toBe(true);
      expect(state.checks.every((check) => check.ok)).toBe(true);
      const started = await service.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership, promiseDate: "2026-12-12", startDate: "2026-10-01" });
      expect(started.existing).toBe(false);
      expect(await service.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership })).toEqual({ projectId: started.projectId, existing: true });

      const detail = await service.get(actor, w.workspaceId, started.projectId);
      expect(detail.project).toMatchObject({ reference: "PRJ-0001", name: "Villa 12", clientName: "Maya Client", status: "active", promiseDate: "2026-12-12" });
      expect(Number(detail.project.total)).toBe(total);
      expect(detail.team.find((role) => role.role === "project_manager")?.member?.name).toBe("Omar Manager");
      expect(detail.team.find((role) => role.role === "account_manager")?.member?.name).toBe("Dana Designer");
      expect(detail.stages).toHaveLength(8);
      expect(detail.stages[0]).toMatchObject({ key: "kickoff", status: "current" });
      expect(detail.next).toMatchObject({ text: "Kickoff meeting held with the client", owner: "Omar Manager" });

      const live = await service.scope(actor, w.workspaceId, started.projectId);
      const scope = await service.seal(actor, w.workspaceId, started.projectId, live.seals[0].id);
      expect(scope.intact).toBe(true);
      const snapshot = scope.snapshot as { lines: Array<{ id: string }>; declinedOptions: Array<{ title: string }>; pricing: { total: string }; revisionLabel: string; acceptance: { decidedBy: string } };
      expect(snapshot.lines.map((line) => line.id)).toEqual(["a", "b", "c"]);
      expect(snapshot.declinedOptions.map((line) => line.title)).toEqual(["Wine fridge"]);
      expect(Number(snapshot.pricing.total)).toBe(total);
      expect(snapshot).toMatchObject({ revisionLabel: "R1", acceptance: { decidedBy: "Maya Client" } });
      expect(canonicalHash(scope.snapshot)).toBe(scope.contentHash);
      // The seal can't be edited, and the planning record is now read-only.
      await w.client.query("SAVEPOINT tamper");
      await expect(w.client.query("UPDATE project_scope_seals SET total = 1 WHERE project_id = $1", [started.projectId])).rejects.toThrow(/sealed scope cannot be changed/);
      await w.client.query("ROLLBACK TO SAVEPOINT tamper");
      expect((await w.client.query("SELECT status FROM pre_project_cases WHERE id = $1", [w.caseId])).rows[0].status).toBe("released");
      expect((await w.client.query("SELECT project_id FROM work_locations WHERE id = $1", [site])).rows[0].project_id).toBe(started.projectId);
      expect((await w.client.query("SELECT active FROM project_assignments WHERE project_id = $1 AND membership_id = $2", [started.projectId, w.designerMembership])).rows[0].active).toBe(true);
      // The account manager heard about it; the person who started it didn't.
      const told = (await w.client.query("SELECT recipient_id AS id FROM notifications WHERE workspace_id = $1 AND event_type = 'project.started' AND channel = 'in_app'", [w.workspaceId])).rows.map((row) => row.id);
      expect(told).toEqual([w.designer]);
    });
  });

  it("won't start until the firm's start rules pass or when the lines no longer add up to what was accepted", async () => {
    await world(async (w) => {
      await accept(w, { agreement: false, paid: false });
      const service = w.as(w.manager);
      const state = await service.startState(actor, w.workspaceId, w.caseId);
      expect(state.canStart).toBe(false);
      expect(state.checks.filter((check) => !check.ok).map((check) => check.key)).toEqual(["agreement", "payment"]);
      await expect(service.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership })).rejects.toThrow(/agreement is signed, the payment/);
      // The firm can switch a rule off.
      const settings = await service.settings(actor, w.workspaceId);
      await service.saveSettings(actor, w.workspaceId, { version: settings.settings.version, requireAgreement: false, requirePayment: false });
      expect((await service.startState(actor, w.workspaceId, w.caseId)).canStart).toBe(true);
    });
    await world(async (w) => {
      await accept(w, { acceptedTotal: 99 });
      await expect(w.as(w.manager).start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership })).rejects.toThrow(/no longer add up/);
    });
  });

  it("finishes a stage only when its checks pass, lets its owner work it, and blocks work while on hold", async () => {
    await world(async (w) => {
      await accept(w);
      const manager = w.as(w.manager);
      const { projectId } = await manager.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      let detail = await manager.get(actor, w.workspaceId, projectId);
      const kickoff = detail.stages[0];
      await expect(manager.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: kickoff.id, version: detail.project.version })).rejects.toThrow(/Still needed: Kickoff meeting held/);
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "confirm_check", stageId: kickoff.id, checkKey: "meeting", note: "Met on site", version: detail.project.version });
      await expect(manager.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: kickoff.id, version: detail.project.version - 1 })).rejects.toThrow(/Someone else changed/);
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: kickoff.id, version: detail.project.version });
      expect(detail.stages.map((stage) => stage.status).slice(0, 2)).toEqual(["done", "current"]);

      // The material sign-off belongs to the designer: name them; they prepare the list and record the client's sign-off.
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "set_member", role: "designer", membershipId: w.designerMembership, version: detail.project.version });
      const designer = w.as(w.designer, ["projects.view"]);
      const materials = detail.stages[1];
      await expect(designer.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: materials.id, version: detail.project.version })).rejects.toThrow(/Client signed off the material list/);
      detail = await designer.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", version: detail.project.version });
      detail = await designer.command(actor, w.workspaceId, projectId, { action: "send_materials", version: detail.project.version });
      const oak = (await designer.materials(actor, w.workspaceId, projectId)).items[0];
      detail = await designer.command(actor, w.workspaceId, projectId, { action: "record_materials_decision", decidedBy: "Maya", method: "in_person", decisions: [{ itemId: oak.id, decision: "approved" }], version: detail.project.version });
      await expect(designer.command(actor, w.workspaceId, projectId, { action: "hold", reason: "Client travelling", version: detail.project.version })).rejects.toThrow(/Only the project manager/);

      // On hold: nothing moves until it's resumed.
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "hold", reason: "Client travelling", reviewOn: "2026-10-15", version: detail.project.version });
      await expect(designer.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: materials.id, version: detail.project.version })).rejects.toThrow(/on hold/);
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "resume", version: detail.project.version });
      detail = await designer.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: materials.id, version: detail.project.version });
      expect(detail.stages[2].status).toBe("current");

      // A stage that checks a payment can't be skipped; a manual one can, with a reason.
      const production = detail.stages.find((stage) => stage.key === "production")!;
      await expect(manager.command(actor, w.workspaceId, projectId, { action: "skip_stage", stageId: production.id, reason: "n/a", version: detail.project.version })).rejects.toThrow(/can't be skipped/);
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "skip_stage", stageId: detail.stages[2].id, reason: "Client supplies the materials", version: detail.project.version });
      expect(detail.stages[2]).toMatchObject({ status: "skipped", skipReason: "Client supplies the materials" });
      expect(detail.stages[3].status).toBe("current");

      // Off track needs a reason and tells the team.
      await expect(manager.command(actor, w.workspaceId, projectId, { action: "post_update", health: "off_track", note: "", version: detail.project.version })).rejects.toThrow(/what's wrong/);
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "post_update", health: "off_track", note: "Drawings late", version: detail.project.version });
      expect(detail.project.health).toBe("off_track");
      expect(detail.updates[0]).toMatchObject({ health: "off_track", note: "Drawings late", byName: "Omar Manager" });
    });
  });

  it("checks the production payment before production can finish", async () => {
    await world(async (w) => {
      await accept(w);
      const manager = w.as(w.manager);
      const { projectId } = await manager.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      await w.client.query("UPDATE project_stages SET status = 'done', completed_at = now(), completed_by = $2 WHERE project_id = $1 AND position < 4", [projectId, w.manager]);
      await w.client.query("UPDATE project_stages SET status = 'current', started_at = now() WHERE project_id = $1 AND key = 'production'", [projectId]);
      let detail = await manager.get(actor, w.workspaceId, projectId);
      const production = detail.stages.find((stage) => stage.key === "production")!;
      expect(production.checks.find((check) => check.kind === "payment_verified")?.passed).toBe(false);
      expect(detail.next).toMatchObject({ text: "Production payment verified", owner: null });
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "confirm_check", stageId: production.id, checkKey: "done", version: detail.project.version });
      await expect(manager.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: production.id, version: detail.project.version })).rejects.toThrow(/Production payment verified/);
    });
  });

  it("starts the live BOQ from the sealed scope, suggests packages and keeps each line's history", async () => {
    await world(async (w) => {
      await accept(w);
      const manager = w.as(w.manager);
      const { projectId } = await manager.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      let scope = await manager.scope(actor, w.workspaceId, projectId);
      expect(scope.lines.map((line) => [line.title, line.quantity, line.origin])).toEqual([
        ["Kitchen cabinets", "4.5000", "R1"], ["Worktop", "2.2500", "R1"], ["Under-cabinet lights", "1.0000", "R1"]]);
      // The kitchen lines are bought materials by default; the lights have no area.
      expect(scope.packages.map((item) => [item.name, item.supply])).toEqual([["Kitchen", "buy"], ["General", "buy"]]);
      expect(scope.lines.every((line) => line.packageId)).toBe(true);

      let detail = await manager.get(actor, w.workspaceId, projectId);
      const kitchen = scope.packages[0];
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "save_package", id: kitchen.id, name: "Kitchen joinery", supply: "make", ownerMembershipId: w.designerMembership, dueDate: "2026-11-30", version: detail.project.version });
      const lights = scope.lines.find((line) => line.title === "Under-cabinet lights")!;
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "assign_lines", lineIds: [lights.id], packageId: kitchen.id, version: detail.project.version });
      await expect(manager.command(actor, w.workspaceId, projectId, { action: "delete_package", packageId: kitchen.id, version: detail.project.version })).rejects.toThrow(/Move this package's items/);
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "delete_package", packageId: scope.packages[1].id, version: detail.project.version });
      scope = await manager.scope(actor, w.workspaceId, projectId);
      expect(scope.packages).toEqual([expect.objectContaining({ name: "Kitchen joinery", supply: "make", ownerName: "Dana Designer", dueDate: "2026-11-30" })]);
      const history = await manager.line(actor, w.workspaceId, projectId, lights.id);
      expect(history.history.map((entry) => [entry.kind, entry.detail])).toEqual([
        ["agreed", { revision: "R1", quantity: "1" }], ["packaged", { package: "General" }], ["packaged", { package: "Kitchen joinery" }]]);
      // History is never edited.
      await w.client.query("SAVEPOINT history");
      await expect(w.client.query("UPDATE project_boq_events SET kind = 'x' WHERE line_id = $1", [lights.id])).rejects.toThrow(/history cannot be changed/);
      await w.client.query("ROLLBACK TO SAVEPOINT history");
      // Only the project manager arranges packages.
      await expect(w.as(w.designer, ["projects.view"]).command(actor, w.workspaceId, projectId, { action: "propose_packages", version: detail.project.version }))
        .rejects.toThrow(/Only the project manager/);
    });
  });

  it("applies an accepted variation: removals credit exactly, moves re-home a line, additions join the BOQ", async () => {
    await world(async (w) => {
      const total = await accept(w);
      const manager = w.as(w.manager);
      const { projectId } = await manager.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const before = await manager.scope(actor, w.workspaceId, projectId);
      const worktop = before.lines.find((line) => line.title === "Worktop")!;
      const cabinets = before.lines.find((line) => line.title === "Kitchen cabinets")!;
      const pantry = randomUUID(), variationId = randomUUID();
      await w.client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Pantry')", [pantry, w.workspaceId, w.caseId]);
      await w.client.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency,baseline_id)
        VALUES($1,$2,$3,1,2,'variation','main','draft','Changes','AED',$4)`, [w.workspaceId, w.caseId, variationId, w.quoteId]);
      // Only a variation changes agreed scope, and a removal can't take more than is left.
      await expect(w.builder.apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "change", change: "omit", id: "x", boqLineId: worktop.id }] })).rejects.toThrow();
      await expect(w.builder.apply(actor, w.workspaceId, w.caseId, variationId, { ops: [{ op: "change", change: "omit", id: "o1", boqLineId: worktop.id, quantity: "3" }] }))
        .rejects.toThrow(/Only 2.25 of Worktop is left/);
      let state = await w.builder.apply(actor, w.workspaceId, w.caseId, variationId, { ops: [
        { op: "change", change: "omit", id: "o1", boqLineId: worktop.id, quantity: "1" },
        { op: "change", change: "move", id: "m1", boqLineId: cabinets.id, areaId: pantry },
        { op: "upsert", line: { id: "n1", title: "Wine rack", unit: "nos", quantity: "1", rate: "900" } },
      ] });
      expect(state.lines.map((line) => [line.id, line.changeOp])).toEqual([["o1", "omit"], ["m1", "move"], ["n1", "add"]]);
      // The removal credits 1 m² at the worktop's rate; the move is free until labour is priced.
      expect(state.pricing.lines.find((line) => line.id === "o1")!.total).toBe("-800.00");
      state = await w.builder.apply(actor, w.workspaceId, w.caseId, variationId, { ops: [{ op: "upsert", line: { id: "m1", version: state.lines.find((line) => line.id === "m1")!.version, rate: "250" } }] });
      expect(state.pricing.total).toBe("350.00");
      expect(state.project).toMatchObject({ id: projectId, appliedAs: null });

      // Accepted by the client through the existing decision (its total uses the same credit rule).
      const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
      const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
      const variation = data.quotes.find((quote) => quote.id === variationId)!;
      expect(totals(variation).total).toBe(350);
      variation.status = "accepted"; variation.hash = freezeHash(variation);
      variation.clientDecision = { decision: "accept", quoteHash: variation.hash, selectedOptionLineIds: [], baseTotal: 350, optionsTotal: 0, acceptedTotal: 350,
        decidedAt: "2026-10-05T10:00:00.000Z", decidedBy: "Maya Client", method: "email", recordedBy: "Omar Manager" };
      data.revision = loaded.revision + 1;
      await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);

      let detail = await manager.get(actor, w.workspaceId, projectId);
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "apply_variation", quoteId: variationId, version: detail.project.version });
      expect(Number(detail.project.total)).toBe(total + 350);
      await expect(manager.command(actor, w.workspaceId, projectId, { action: "apply_variation", quoteId: variationId, version: detail.project.version })).rejects.toThrow(/already applied as VO-1/);
      const after = await manager.scope(actor, w.workspaceId, projectId);
      const worktopAfter = after.lines.find((line) => line.id === worktop.id)!;
      expect([worktopAfter.quantity, worktopAfter.net, worktopAfter.status]).toEqual(["1.2500", "1000.0000", "active"]);
      expect(after.lines.find((line) => line.id === cabinets.id)!.areaName).toBe("Pantry");
      expect(after.lines.filter((line) => line.origin === "VO-1").map((line) => [line.title, line.net])).toEqual([["Move Kitchen cabinets", "250.0000"], ["Wine rack", "900.0000"]]);
      expect(after.seals.map((seal) => [seal.revisionLabel, seal.total])).toEqual([["R1", `${total}.0000`], ["VO-1", "350.0000"]]);
      expect(after.variations).toEqual([expect.objectContaining({ id: variationId, appliedAs: "VO-1" })]);
      expect((await manager.line(actor, w.workspaceId, projectId, worktop.id)).history.at(-1)).toMatchObject({ kind: "reduced", detail: { variation: "VO-1", quantity: "1", left: "1.25" } });
      expect((await manager.line(actor, w.workspaceId, projectId, cabinets.id)).history.at(-1)).toMatchObject({ kind: "moved", detail: { variation: "VO-1", from: "Kitchen", to: "Pantry" } });
      expect((await w.builder.apply(actor, w.workspaceId, w.caseId, variationId, { ops: [] }).catch(() => null))).toBeNull();
    });
  });

  it("signs off the material list per material; a change after sign-off needs a new revision", async () => {
    await world(async (w) => {
      await accept(w);
      const manager = w.as(w.manager);
      const { projectId } = await manager.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const scope = await manager.scope(actor, w.workspaceId, projectId);
      const worktop = scope.lines.find((line) => line.title === "Worktop")!;
      // Suggested from the scope: the worktop's catalog material.
      const catalog = randomUUID(), quartz = randomUUID();
      await w.client.query("INSERT INTO catalogs(id,workspace_id,code,name) VALUES($1,$2,'core','Core')", [catalog, w.workspaceId]);
      await w.client.query("INSERT INTO catalog_units(workspace_id,code,label,kind,to_base) VALUES($1,'sqm','m²','area',1) ON CONFLICT DO NOTHING", [w.workspaceId]);
      await w.client.query("INSERT INTO catalog_items(id,workspace_id,catalog_id,code,name,item_type,unit_code,description) VALUES($1,$2,$3,'QZ-20','Quartz, Calacatta 20 mm','material','sqm','Honed')", [quartz, w.workspaceId, catalog]);
      await w.client.query("UPDATE project_boq_lines SET catalog_item_id = $2 WHERE id = $1", [worktop.id, quartz]);
      let detail = await manager.get(actor, w.workspaceId, projectId);
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "suggest_materials", version: detail.project.version });
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "suggest_materials", version: detail.project.version });
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer, natural", specification: "Crown cut, matt lacquer", boqLineIds: [scope.lines[0].id], version: detail.project.version });
      let list = await manager.materials(actor, w.workspaceId, projectId);
      expect(list.state).toBe("draft");
      expect(list.items.map((item) => [item.name, item.code, item.usedIn.map((line) => line!.title)])).toEqual([
        ["Quartz, Calacatta 20 mm", "QZ-20", ["Worktop"]], ["Oak veneer, natural", "", ["Kitchen cabinets"]]]);

      // Kickoff done, so the material sign-off is the current stage and reads the list.
      const kickoff = detail.stages[0];
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "confirm_check", stageId: kickoff.id, checkKey: "meeting", version: detail.project.version });
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: kickoff.id, version: detail.project.version });
      expect(detail.next).toMatchObject({ text: "Client signed off the material list" });

      detail = await manager.command(actor, w.workspaceId, projectId, { action: "send_materials", version: detail.project.version });
      await expect(manager.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Brass handles", version: detail.project.version })).rejects.toThrow(/R1 is with the client/);
      const [quartzItem, oakItem] = list.items;
      await expect(manager.command(actor, w.workspaceId, projectId, { action: "record_materials_decision", decidedBy: "Maya", method: "email", version: detail.project.version,
        decisions: [{ itemId: quartzItem.id, decision: "approved" }, { itemId: oakItem.id, decision: "rejected" }] })).rejects.toThrow(/what the client wants instead/);
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "record_materials_decision", decidedBy: "Maya", method: "email", version: detail.project.version,
        decisions: [{ itemId: quartzItem.id, decision: "approved" }, { itemId: oakItem.id, decision: "rejected", note: "Wants smoked oak" }] });
      list = await manager.materials(actor, w.workspaceId, projectId);
      expect(list.state).toBe("changes_requested");
      expect(list.items.find((item) => item.id === oakItem.id)!.decision).toMatchObject({ decision: "rejected", note: "Wants smoked oak" });
      expect(detail.stages[1].ready).toBe(false);

      detail = await manager.command(actor, w.workspaceId, projectId, { action: "save_material", id: oakItem.id, name: "Oak veneer, smoked", specification: "Crown cut, matt lacquer", boqLineIds: [scope.lines[0].id], version: detail.project.version });
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "send_materials", version: detail.project.version });
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "record_materials_decision", decidedBy: "Maya", method: "signed_document", version: detail.project.version,
        decisions: [{ itemId: quartzItem.id, decision: "approved" }, { itemId: oakItem.id, decision: "approved" }] });
      expect((await manager.materials(actor, w.workspaceId, projectId)).state).toBe("signed_off");
      expect(detail.stages[1].ready).toBe(true);
      expect((await manager.line(actor, w.workspaceId, projectId, worktop.id)).history.at(-1)).toMatchObject({ kind: "signed_off", detail: { revision: "R2", by: "Maya" } });
      // A sent revision can't be altered.
      await w.client.query("SAVEPOINT frozen");
      await expect(w.client.query("UPDATE project_material_revisions SET snapshot = '[]' WHERE project_id = $1", [projectId])).rejects.toThrow(/cannot be changed/);
      await w.client.query("ROLLBACK TO SAVEPOINT frozen");

      // Changing the list after sign-off reopens the check until a new revision is signed off.
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Brass handles", version: detail.project.version });
      expect((await manager.materials(actor, w.workspaceId, projectId)).state).toBe("changed");
      expect((await manager.get(actor, w.workspaceId, projectId)).stages[1].ready).toBe(false);
    });
  });

  it("traces every requirement: undecided ones block sending, included ones point at lines, and the decisions are sealed", async () => {
    await world(async (w) => {
      const [drawers, fridge, sauna] = [randomUUID(), randomUUID(), randomUUID()];
      await w.client.query(`INSERT INTO pre_project_brief_entries(workspace_id,case_id,id,kind,title,note,category,priority,scope_status,review_status,unit,reference_url,avoid,source,created_by,updated_by)
        VALUES ($1,$2,$3,'requirement','Soft-close drawers','','Joinery','must_have','included','reviewed','nos','','','client',$6,$6),
               ($1,$2,$4,'requirement','Built-in wine fridge','','Appliances','preferred','undecided','reviewed','nos','','','client',$6,$6),
               ($1,$2,$5,'requirement','Steam room','','Wellness','optional','not_possible','reviewed','nos','','','client',$6,$6)`,
        [w.workspaceId, w.caseId, drawers, fridge, sauna, w.manager]);
      await w.client.query("UPDATE pre_project_brief_entries SET scope_note = 'No drainage on this floor' WHERE id = $1", [sauna]);
      let state = await w.builder.builder(actor, w.workspaceId, w.caseId, w.quoteId);
      expect(state.checks.map((check) => [check.code, check.values])).toEqual(expect.arrayContaining([
        ["Decide {count} requirements before sending", { count: "1" }], ["{name} is included but no line covers it", { name: "Soft-close drawers" }]]));
      const cabinets = state.lines.find((line) => line.id === "a")!;
      await expect(w.builder.apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: cabinets.version, scopeId: fridge } }] })).rejects.toThrow(/included in the scope/);
      state = await w.builder.apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: cabinets.version, scopeId: drawers } }] });
      await w.client.query("UPDATE pre_project_brief_entries SET scope_status = 'later', scope_note = 'Client will buy it next year' WHERE id = $1", [fridge]);
      state = await w.builder.builder(actor, w.workspaceId, w.caseId, w.quoteId);
      expect(state.checks.filter((check) => /requirement|covers it/.test(check.code))).toEqual([]);

      await accept(w);
      const manager = w.as(w.manager);
      const { projectId } = await manager.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const scope = await manager.scope(actor, w.workspaceId, projectId);
      const sealed = await manager.seal(actor, w.workspaceId, projectId, scope.seals[0].id);
      const requirements = (sealed.snapshot as { requirements: Array<{ title: string; status: string; note: string; lineIds: string[] }> }).requirements;
      expect(requirements.map((item) => [item.title, item.status, item.note, item.lineIds])).toEqual(expect.arrayContaining([
        ["Soft-close drawers", "included", "", ["a"]], ["Built-in wine fridge", "later", "Client will buy it next year", []], ["Steam room", "not_possible", "No drainage on this floor", []]]));
    });
  });

  it("runs the project's work: subtasks, blockers, links without loops, access for the assignee, history and notices", async () => {
    await world(async (w) => {
      await accept(w);
      const { projectId } = await w.as(w.manager).start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const lead = w.work(w.manager);
      const board = await lead.board(actor, w.workspaceId, projectId);
      expect(board.items).toEqual([]);
      expect(board.canEdit).toBe(true);
      const drawings = randomUUID(), sheet = randomUUID(), marble = randomUUID(), fixing = randomUUID();
      const stage = board.stages.find((item) => item.name === "Technical drawings")!;
      let state = await lead.command(actor, w.workspaceId, projectId, { action: "create", id: drawings, title: "Kitchen shop drawings", assigneeId: w.designerMembership, dueDate: "2026-10-10", stageId: stage.id, priority: "high" });
      // Creating again with the same id changes nothing.
      state = await lead.command(actor, w.workspaceId, projectId, { action: "create", id: drawings, title: "Kitchen shop drawings" });
      expect(state.items).toHaveLength(1);
      expect(state.item).toMatchObject({ number: 1, type: "task", assigneeName: "Dana Designer", dueDate: "2026-10-10", stageId: stage.id, priority: "high", createdByName: "Omar Manager" });
      state = await lead.command(actor, w.workspaceId, projectId, { action: "create", id: sheet, parentId: drawings, title: "Elevation sheet", type: "snag" });
      expect(state.item).toMatchObject({ number: 2, type: "task", parentId: drawings, stageId: stage.id });
      await expect(lead.command(actor, w.workspaceId, projectId, { action: "create", id: randomUUID(), parentId: sheet, title: "Too deep" })).rejects.toThrow(/can't have its own subtasks/);
      state = await lead.command(actor, w.workspaceId, projectId, { action: "create", id: marble, type: "blocker", blocks: drawings, title: "Marble thickness not confirmed" });
      const blocked = state.items.find((item) => item.id === drawings)!;
      expect(blocked.blockedBy.map((item) => item.number)).toEqual([3]);
      expect(blocked).toMatchObject({ subtasks: 1, subtasksDone: 0 });

      // The designer works on it with view access only: the subtask must finish first.
      const designer = w.work(w.designer, ["projects.view"]);
      const mine = await designer.open(actor, w.workspaceId, "mine");
      expect(mine.items.map((item) => item.title)).toEqual(["Kitchen shop drawings"]);
      await expect(designer.command(actor, w.workspaceId, projectId, { action: "update", itemId: drawings, version: blocked.version, status: "done" })).rejects.toThrow(/open subtask/);
      const sub = state.items.find((item) => item.id === sheet)!;
      await designer.command(actor, w.workspaceId, projectId, { action: "update", itemId: sheet, version: sub.version, status: "done" });
      await expect(designer.command(actor, w.workspaceId, projectId, { action: "update", itemId: drawings, version: blocked.version - 1, status: "done" })).rejects.toThrow(/Someone else changed/);
      state = await designer.command(actor, w.workspaceId, projectId, { action: "update", itemId: marble, version: state.items.find((item) => item.id === marble)!.version, status: "done" });
      expect(state.items.find((item) => item.id === drawings)!.blockedBy).toEqual([]);
      state = await designer.command(actor, w.workspaceId, projectId, { action: "update", itemId: drawings, version: blocked.version, status: "done" });
      expect(state.item).toMatchObject({ status: "done" });
      expect(state.item!.completedAt).toBeTruthy();
      await designer.command(actor, w.workspaceId, projectId, { action: "comment", itemId: drawings, id: randomUUID(), body: "Sent to the factory." });

      // Links: fixing waits on drawings; the other way round would loop.
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: fixing, title: "Fix cabinets on site" });
      state = await lead.command(actor, w.workspaceId, projectId, { action: "link", itemId: fixing, predecessorId: drawings, kind: "fs", lagDays: 2 });
      expect(state.item!.before).toEqual([expect.objectContaining({ number: 1, kind: "fs", lagDays: 2 })]);
      await expect(lead.command(actor, w.workspaceId, projectId, { action: "link", itemId: drawings, predecessorId: fixing })).rejects.toThrow(/circle/);

      // Giving work to someone outside the team lets them open the project.
      const fitter = randomUUID(), fitterMembership = randomUUID();
      await w.client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Fahad Fitter')", [fitter, `${fitter.slice(0, 8)}@example.com`]);
      await w.client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [fitterMembership, w.workspaceId, fitter]);
      await expect(w.work(fitter, ["projects.view"]).board(actor, w.workspaceId, projectId)).rejects.toThrow(/not found/);
      const fix = state.items.find((item) => item.id === fixing)!;
      await lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: fixing, version: fix.version, assigneeId: fitterMembership });
      expect((await w.work(fitter, ["projects.view"]).board(actor, w.workspaceId, projectId)).items).toHaveLength(4);
      expect((await w.as(w.manager).get(actor, w.workspaceId, projectId)).team.some((role) => role.member?.name === "Fahad Fitter")).toBe(false);

      // Cancelling a task cancels its open subtasks.
      const tile = randomUUID(), grout = randomUUID();
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: tile, title: "Tile the backsplash" });
      state = await lead.command(actor, w.workspaceId, projectId, { action: "create", id: grout, parentId: tile, title: "Grout" });
      state = await lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: tile, version: state.items.find((item) => item.id === tile)!.version, status: "cancelled" });
      expect(state.items.find((item) => item.id === grout)!.status).toBe("cancelled");

      const detail = await lead.item(actor, w.workspaceId, projectId, drawings);
      expect(detail.activity.map((entry) => entry.kind)).toEqual(["created", "blocked", "status", "comment"]);
      expect(detail.after.map((item) => item.number)).toEqual([4]);
      const notices = (await w.client.query<{ event: string; channel: string; recipient: string; subject: string }>(
        `SELECT event_type AS event, channel, recipient_id AS recipient, subject FROM notifications WHERE workspace_id = $1 AND event_type LIKE 'work.%' ORDER BY created_at, channel`, [w.workspaceId])).rows;
      expect(notices).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: "work.assigned", channel: "in_app", recipient: w.designer, subject: "#1 Kitchen shop drawings is yours" }),
        expect.objectContaining({ event: "work.assigned", channel: "email", recipient: w.designer }),
        expect.objectContaining({ event: "work.blocked", recipient: w.designer }),
        expect.objectContaining({ event: "work.done", recipient: w.manager, subject: "#1 Kitchen shop drawings is done" }),
        expect.objectContaining({ event: "work.commented", recipient: w.manager }),
        expect.objectContaining({ event: "work.assigned", recipient: fitter }),
      ]));
      expect(notices.some((notice) => notice.recipient === w.manager && notice.event === "work.blocked")).toBe(false);
    });
  });

  it("schedules on the workspace's working week: moving an item can push what waits on it, and the baseline keeps the committed dates", async () => {
    await world(async (w) => {
      await accept(w);
      const { projectId } = await w.as(w.manager).start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership, promiseDate: "2026-10-20" });
      // Sunday to Thursday, with a holiday on Tuesday 6 October.
      await w.client.query("INSERT INTO hrms_calendars(workspace_id,name,timezone,working_days,holidays) VALUES($1,'Office','Asia/Dubai','{0,1,2,3,4}','{2026-10-06}')", [w.workspaceId]);
      const lead = w.work(w.manager);
      const drawings = randomUUID(), production = randomUUID(), install = randomUUID();
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: drawings, title: "Shop drawings", startDate: "2026-10-01", dueDate: "2026-10-04" });
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: production, title: "Production", startDate: "2026-10-05", dueDate: "2026-10-08", assigneeId: w.designerMembership });
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: install, title: "Install", dueDate: "2026-10-11" });
      await lead.command(actor, w.workspaceId, projectId, { action: "link", itemId: production, predecessorId: drawings });
      let state = await lead.command(actor, w.workspaceId, projectId, { action: "link", itemId: install, predecessorId: production, lagDays: 1 });
      expect(state.calendar).toEqual({ workingDays: [0, 1, 2, 3, 4], holidays: ["2026-10-06"] });
      expect(state.promiseDate).toBe("2026-10-20");
      state = await lead.command(actor, w.workspaceId, projectId, { action: "set_baseline" });
      expect(state.baseline).toMatchObject({ byName: "Omar Manager" });
      await expect(w.work(w.designer, ["projects.view"]).command(actor, w.workspaceId, projectId, { action: "set_baseline" })).rejects.toThrow(/project manager/);

      // Drawings slip to Monday 5th: production keeps its 3 working days from Wednesday (Tuesday is a holiday,
      // Sunday is worked) and install follows a working day after it.
      const preview = await lead.preview(actor, w.workspaceId, projectId, drawings, { dueDate: "2026-10-05" });
      expect(preview.moves.map(({ number, startDate, dueDate, because }) => [number, startDate, dueDate, because])).toEqual([[2, "2026-10-07", "2026-10-11", 1], [3, null, "2026-10-13", 2]]);
      const version = state.items.find((item) => item.id === drawings)!.version;
      state = await lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: drawings, version, dueDate: "2026-10-05", ripple: true });
      const byId = new Map(state.items.map((item) => [item.id, item]));
      expect([byId.get(production)!.startDate, byId.get(production)!.dueDate, byId.get(install)!.dueDate]).toEqual(["2026-10-07", "2026-10-11", "2026-10-13"]);
      expect([byId.get(production)!.baselineStart, byId.get(production)!.baselineDue]).toEqual(["2026-10-05", "2026-10-08"]);
      const history = await lead.item(actor, w.workspaceId, projectId, production);
      expect(history.activity.at(-1)).toMatchObject({ kind: "dates", detail: { because: 1, fromDue: "2026-10-08", dueDate: "2026-10-11" } });
      const moved = (await w.client.query<{ subject: string }>(`SELECT subject FROM notifications WHERE workspace_id = $1 AND event_type = 'work.moved' AND recipient_id = $2`, [w.workspaceId, w.designer])).rows;
      expect(moved.map((row) => row.subject)).toEqual(["#2 Production moved to Oct 11, 2026"]);
      // Without "move them too", only the item itself changes.
      state = await lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: drawings, version: version + 1, dueDate: "2026-10-07" });
      expect(state.items.find((item) => item.id === production)!.startDate).toBe("2026-10-07");
    });
  });

  it("plans a package from its standard work: tasks in order on working days, owned by the team's roles, in their stages, once", async () => {
    await world(async (w) => {
      await accept(w);
      const core = w.as(w.manager);
      const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership, startDate: "2026-10-01" });
      let project = await core.get(actor, w.workspaceId, projectId);
      project = await core.command(actor, w.workspaceId, projectId, { action: "set_member", version: project.project.version, role: "technical_designer", membershipId: w.designerMembership });
      await core.command(actor, w.workspaceId, projectId, { action: "save_package", version: project.project.version, name: "Kitchen joinery", supply: "make" });
      const pkg = (await core.scope(actor, w.workspaceId, projectId)).packages.find((item) => item.name === "Kitchen joinery")!;

      // The firm shortens its factory template: drawings, then production with delivery alongside.
      const settings = await core.settings(actor, w.workspaceId);
      const make = settings.workTemplates.find((item) => item.supply === "make")!;
      expect(make.tasks.map((item) => item.title)).toContain("Shop drawings");
      await expect(core.saveWorkTemplate(actor, w.workspaceId, "make", { version: make.version, tasks: [{ title: "Shop drawings", days: 0 }] })).rejects.toThrow(/whole number/);
      await expect(core.saveWorkTemplate(actor, w.workspaceId, "make", { version: make.version, tasks: [{ title: "Shop drawings", days: 2, role: "astronaut" }] })).rejects.toThrow(/team roles/);
      await core.saveWorkTemplate(actor, w.workspaceId, "make", { version: make.version, tasks: [
        { title: "Shop drawings", days: 3, role: "technical_designer", stage: "drawings" },
        { title: "Production", days: 5, role: "quantity_surveyor", stage: "production" },
        { title: "Book the delivery", days: 1, role: "project_manager", stage: "installation", withPrevious: true },
      ] });
      await expect(core.saveSettings(actor, w.workspaceId, { version: settings.settings.version, roles: settings.settings.roles.filter((role) => role.key !== "quantity_surveyor") })).rejects.toThrow(/task template still uses/);

      const lead = w.work(w.manager);
      const preview = await lead.packagePlan(actor, w.workspaceId, projectId, pkg.id);
      expect(preview.startDate).toBe("2026-10-01");
      expect(preview.tasks.map(({ title, startDate, dueDate, assigneeName, stageName }) => [title, startDate, dueDate, assigneeName, stageName])).toEqual([
        ["Shop drawings", "2026-10-01", "2026-10-05", "Dana Designer", "Technical drawings"], // Thu, Fri, Mon
        ["Production", "2026-10-06", "2026-10-12", null, "Production"],
        ["Book the delivery", "2026-10-06", "2026-10-06", "Omar Manager", "Delivery and installation"],
      ]);
      const state = await lead.command(actor, w.workspaceId, projectId, { action: "plan_package", packageId: pkg.id, startDate: "2026-10-01" });
      const tasks = state.items.filter((item) => item.packageId === pkg.id);
      expect(tasks.map((item) => [item.number, item.title, item.startDate, item.dueDate])).toEqual([
        [1, "Shop drawings", "2026-10-01", "2026-10-05"], [2, "Production", "2026-10-06", "2026-10-12"], [3, "Book the delivery", "2026-10-06", "2026-10-06"]]);
      expect(tasks[1].blockedBy.map((item) => item.number)).toEqual([1]);
      const detail = await lead.item(actor, w.workspaceId, projectId, tasks[2].id);
      expect(detail.before).toEqual([expect.objectContaining({ number: 2, kind: "ss" })]);
      await expect(lead.command(actor, w.workspaceId, projectId, { action: "plan_package", packageId: pkg.id })).rejects.toThrow(/already planned/);
      const planned = (await w.client.query<{ subject: string; body: string }>(`SELECT subject, body FROM notifications WHERE workspace_id = $1 AND event_type = 'work.planned' AND recipient_id = $2`, [w.workspaceId, w.designer])).rows;
      expect(planned).toEqual([{ subject: "Kitchen joinery is planned", body: "Omar Manager gave you 1 task on PRJ-0001 · Villa 12. First due Oct 5, 2026." }]);
    });
  });

  it("runs sprints: commit at start, work added or taken out, every miss explained at close, unfinished work carried on", async () => {
    await world(async (w) => {
      await accept(w);
      const { projectId } = await w.as(w.manager).start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const lead = w.work(w.manager);
      const [a, b, c, d, sub] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      for (const [id, title] of [[a, "Shop drawings"], [b, "Order hinges"], [c, "Site measure"], [d, "Paint samples"]] as const)
        await lead.command(actor, w.workspaceId, projectId, { action: "create", id, title });
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: sub, parentId: a, title: "Elevations" });
      const one = randomUUID(), two = randomUUID();
      let state = await lead.command(actor, w.workspaceId, projectId, { action: "create_sprint", id: one, startDate: "2026-10-05", endDate: "2026-10-16", goal: "Drawings out" });
      state = await lead.command(actor, w.workspaceId, projectId, { action: "create_sprint", id: two, startDate: "2026-10-19", endDate: "2026-10-30" });
      expect(state.sprints.map((sprint) => [sprint.name, sprint.status])).toEqual([["Sprint 1", "planned"], ["Sprint 2", "planned"]]);
      await expect(w.work(w.designer, ["projects.view"]).command(actor, w.workspaceId, projectId, { action: "create_sprint", id: randomUUID(), startDate: "2026-11-02", endDate: "2026-11-06" }))
        .rejects.toThrow(/project manager/);
      await expect(lead.command(actor, w.workspaceId, projectId, { action: "set_sprint", itemIds: [sub], sprintId: one })).rejects.toThrow(/goes with its task/);
      let sprint = state.sprints[0];
      await expect(lead.command(actor, w.workspaceId, projectId, { action: "start_sprint", sprintId: one, version: sprint.version })).rejects.toThrow(/Add work/);
      state = await lead.command(actor, w.workspaceId, projectId, { action: "set_sprint", itemIds: [a, b, c], sprintId: one });
      sprint = state.sprints[0];
      state = await lead.command(actor, w.workspaceId, projectId, { action: "start_sprint", sprintId: one, version: sprint.version });
      expect(state.sprints[0]).toMatchObject({ status: "active", committed: 3, committedDone: 0, items: 3 });
      await expect(lead.command(actor, w.workspaceId, projectId, { action: "start_sprint", sprintId: two, version: state.sprints[1].version })).rejects.toThrow(/Close the running sprint/);

      // Mid-sprint: one is done, one is taken out, one is added.
      const byId = (id: string) => state.items.find((item) => item.id === id)!;
      state = await lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: b, version: byId(b).version, status: "done" });
      state = await lead.command(actor, w.workspaceId, projectId, { action: "set_sprint", itemIds: [c], sprintId: null });
      state = await lead.command(actor, w.workspaceId, projectId, { action: "set_sprint", itemIds: [d], sprintId: one });
      expect(state.sprints[0]).toMatchObject({ committed: 2, committedDone: 1, items: 3, itemsDone: 1 });
      const running = await lead.sprint(actor, w.workspaceId, projectId, one);
      expect([running.added, running.removed]).toEqual([1, 1]);
      expect(running.unfinished.map((item) => item.number)).toEqual([1]);

      sprint = state.sprints[0];
      await expect(lead.command(actor, w.workspaceId, projectId, { action: "close_sprint", sprintId: one, version: sprint.version, moveTo: two })).rejects.toThrow(/Say why #1/);
      state = await lead.command(actor, w.workspaceId, projectId, { action: "close_sprint", sprintId: one, version: sprint.version, moveTo: two,
        reasons: { [a]: { reason: "waiting_on_client", note: "Client away until the 20th" } } });
      expect(state.sprints.map((item) => [item.name, item.status])).toEqual([["Sprint 1", "closed"], ["Sprint 2", "planned"]]);
      expect([byId(a), byId(d)].map((item) => state.items.find((entry) => entry.id === item.id)!.sprintId)).toEqual([two, two]);
      const closed = await lead.sprint(actor, w.workspaceId, projectId, one);
      expect(closed.missed).toEqual([expect.objectContaining({ number: 1, reason: "waiting_on_client", note: "Client away until the 20th" })]);
      expect(closed.sprint).toMatchObject({ committed: 2, committedDone: 1 });
      const told = (await w.client.query<{ subject: string; body: string }>(`SELECT subject, body FROM notifications WHERE workspace_id = $1 AND event_type = 'work.sprint_closed' AND recipient_id = $2`,
        [w.workspaceId, w.designer])).rows;
      expect(told).toEqual([{ subject: "Sprint 1 closed on PRJ-0001 · Villa 12", body: "1 of 2 committed items done." }]);
    });
  });

  it("measures the team's work: late, due this week, blocked, on time and cycle time, per person and in total", async () => {
    await world(async (w) => {
      await accept(w);
      const { projectId } = await w.as(w.manager).start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const lead = w.work(w.manager);
      const ids = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((key) => [key, randomUUID()]));
      for (const [key, assignee] of [["a", w.designerMembership], ["b", w.designerMembership], ["c", w.managerMembership], ["d", w.designerMembership], ["e", w.designerMembership], ["f", null]] as const)
        await lead.command(actor, w.workspaceId, projectId, { action: "create", id: ids[key], title: key.toUpperCase(), assigneeId: assignee });
      await lead.command(actor, w.workspaceId, projectId, { action: "link", itemId: ids.b, predecessorId: ids.c });
      // Dates relative to the workspace's today (Asia/Dubai), set directly so the numbers are exact.
      const today = "(now() AT TIME ZONE 'Asia/Dubai')::date";
      await w.client.query(`UPDATE work_items SET due_date = ${today} - 1 WHERE id = $1`, [ids.a]);
      await w.client.query(`UPDATE work_items SET due_date = ${today} + 2 WHERE id = $1`, [ids.b]);
      await w.client.query(`UPDATE work_items SET status = 'done', due_date = ${today}, started_at = now() - interval '3 days', completed_at = now() - interval '1 day' WHERE id = $1`, [ids.d]);
      await w.client.query(`UPDATE work_items SET status = 'done', due_date = ${today} - 3, started_at = now() - interval '5 days', completed_at = now() - interval '2 days' WHERE id = $1`, [ids.e]);
      await w.client.query(`UPDATE work_items SET status = 'done', completed_at = now() - interval '40 days' WHERE id = $1`, [ids.f]);

      const month = await lead.insights(actor, w.workspaceId, "30");
      const dana = month.people.find((row) => row.name === "Dana Designer")!;
      expect(dana).toMatchObject({ open: 2, late: 1, dueThisWeek: 1, blocked: 1, done: 2, doneWithDue: 2, onTime: 1, cycleDays: 2.5 });
      expect(month.people.find((row) => row.name === "Omar Manager")).toMatchObject({ open: 1, late: 0, blocked: 0, done: 0, cycleDays: null });
      expect(month.total).toMatchObject({ open: 3, late: 1, blocked: 1, done: 2, onTime: 1, doneWithDue: 2, cycleDays: 2.5 });
      const quarter = await lead.insights(actor, w.workspaceId, "90");
      expect(quarter.total).toMatchObject({ done: 3, doneWithDue: 2, cycleDays: 2.5 });
      expect(quarter.people.find((row) => row.membershipId === null)).toMatchObject({ done: 1, open: 0 });
      await expect(w.work(w.designer, ["projects.view"]).insights(actor, w.workspaceId, "30")).rejects.toThrow(/oversee all projects/);
    });
  });

  it("reminds the assignee the day before work is due, and the assignee and project manager once when it's late", async () => {
    await world(async (w) => {
      await accept(w);
      const { projectId } = await w.as(w.manager).start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const lead = w.work(w.manager);
      const [soon, late, old, done] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      for (const [id, title] of [[soon, "Order hinges"], [late, "Shop drawings"], [old, "Site measure"], [done, "Samples"]] as const)
        await lead.command(actor, w.workspaceId, projectId, { action: "create", id, title, assigneeId: w.designerMembership });
      const today = "(now() AT TIME ZONE 'Asia/Dubai')::date";
      await w.client.query(`UPDATE work_items SET due_date = ${today} + 1 WHERE id = $1`, [soon]);
      await w.client.query(`UPDATE work_items SET due_date = ${today} - 2 WHERE id = $1`, [late]);
      await w.client.query(`UPDATE work_items SET due_date = ${today} - 10 WHERE id = $1`, [old]);
      await w.client.query(`UPDATE work_items SET due_date = ${today} - 1, status = 'done', completed_at = now() WHERE id = $1`, [done]);
      await processWorkDeadlines(w.client, w.workspaceId);
      await processWorkDeadlines(w.client, w.workspaceId);
      const sent = (await w.client.query<{ event: string; channel: string; recipient: string; subject: string }>(
        `SELECT event_type AS event, channel, recipient_id AS recipient, subject FROM notifications WHERE workspace_id = $1 AND event_type IN ('work.due_soon', 'work.overdue') ORDER BY event_type, channel, recipient_id`,
        [w.workspaceId])).rows;
      expect(sent.map(({ event, channel, recipient, subject }) => [event, channel, recipient === w.designer ? "designer" : "manager", subject]).sort()).toEqual([
        ["work.due_soon", "in_app", "designer", "#1 Order hinges is due tomorrow"],
        ["work.overdue", "email", "designer", "#2 Shop drawings is late · PRJ-0001 · Villa 12"],
        ["work.overdue", "in_app", "designer", "#2 Shop drawings is late"],
        ["work.overdue", "in_app", "manager", "#2 Shop drawings is late"],
      ].sort());
    });
  });

  it("buys what the project needs: signed-off materials and bought lines, priced exactly, approved by someone else, sent, confirmed and changed", async () => {
    await world(async (w) => {
      await accept(w);
      const core = w.as(w.manager);
      const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const company = randomUUID(), profile = randomUUID();
      await w.client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,'FAC','Studio Furniture','Studio Furniture LLC','AE','AED','en-AE','Asia/Dubai')`, [company, w.workspaceId]);
      await w.client.query(`INSERT INTO tax_profiles(id,workspace_id,legal_entity_id,name,jurisdiction_code,scheme,prices_include_tax,effective_from,version) VALUES($1,$2,$3,'VAT','AE','vat',false,now(),1)`, [profile, w.workspaceId, company]);
      await w.client.query(`INSERT INTO tax_rates(workspace_id,tax_profile_id,code,label,rate,is_default) VALUES($1,$2,'standard','Standard','5',true)`, [w.workspaceId, profile]);
      const everything = ["vendors.view", "vendors.manage", "vendors.approve", "purchasing.view", "purchasing.manage", "purchasing.approve", "workspace.settings.manage", "projects.manage", "projects.view"];
      const access = (userId: string, permissions: string[]) => {
        const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
          const codes = Array.isArray(code) ? code : [code];
          if (!codes.some((item) => permissions.includes(item))) throw new Error("Not allowed");
          await w.client.query("SAVEPOINT command");
          try { const result = await fn(w.client, { userId }); await w.client.query("RELEASE SAVEPOINT command"); return result; }
          catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT command"); throw error; }
        };
        return { withPermission: run, withAnyPermission: run, asMember: (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(w.client, { userId }),
          hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never;
      };
      const buyer = { orders: new OrdersService(access(w.designer, everything)), suppliers: new SuppliersService(access(w.designer, everything)) };
      const approver = { orders: new OrdersService(access(w.manager, everything)), suppliers: new SuppliersService(access(w.manager, everything)) };

      // The material list, and the lights bought ready-made.
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Calacatta slab", code: "CAL-20", quantity: "12", unit: "m²", version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", name: "Lights", supply: "ready_made", version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", name: "Joinery", supply: "make", version: detail.project.version });
      const scope = await core.scope(actor, w.workspaceId, projectId);
      const lights = scope.packages.find((item) => item.name === "Lights")!;
      // Cabinets and the worktop are made in the factory: their materials are on the list, the lines aren't bought.
      detail = await core.command(actor, w.workspaceId, projectId, { action: "assign_lines", lineIds: scope.lines.filter((line) => line.title !== "Under-cabinet lights").map((line) => line.id),
        packageId: scope.packages.find((item) => item.name === "Joinery")!.id, version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "assign_lines", lineIds: [(await core.scope(actor, w.workspaceId, projectId)).lines.find((line) => line.title === "Under-cabinet lights")!.id], packageId: lights.id, version: detail.project.version });
      let needs = (await buyer.orders.needs(actor, w.workspaceId)).needs;
      expect(needs.map((need) => [need.title, need.required, need.remaining, need.blocked])).toEqual([["Calacatta slab", "12.0000", "12.0000", "material_signoff"], ["Under-cabinet lights", "1.0000", "1.0000", null]]);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "send_materials", version: detail.project.version });
      const slab = (await core.materials(actor, w.workspaceId, projectId)).items[0];
      detail = await core.command(actor, w.workspaceId, projectId, { action: "record_materials_decision", decidedBy: "Maya", method: "email", decisions: [{ itemId: slab.id, decision: "approved" }], version: detail.project.version });
      needs = (await buyer.orders.needs(actor, w.workspaceId)).needs;
      expect(needs.every((need) => need.blocked === null)).toBe(true);

      // A supplier with a 10% discount, approved by someone who approves suppliers.
      const vendor = randomUUID();
      let register = await buyer.suppliers.save(actor, w.workspaceId, { id: vendor, version: 0, name: "Nile Marble", categories: ["Marble"], deal: "discount", dealPercent: "10", entityIds: [company], email: "orders@nile.example" });
      const order = randomUUID();
      const lines = needs.map((need, index) => ({ source: need.source, ...(need.source === "material" ? { materialItemId: need.sourceId } : { boqLineId: need.sourceId }), quantity: index ? "1" : "10", unitPrice: index ? "500" : "350" }));
      let state = await buyer.orders.create(actor, w.workspaceId, { id: order, vendorId: vendor, lines, expectedDate: "2026-10-20" });
      expect(state.order).toMatchObject({ number: `FAC-PO-${new Date().getFullYear()}-00001`, status: "draft", currency: "AED", subtotal: "4000.0000", discountTotal: "400.0000", taxTotal: "180.0000", total: "3780.0000" });
      expect(state.lines.map((line) => [line.description, line.specification, line.quantity, line.unit, line.discountPercent, line.taxRate, line.net, line.tax, line.total])).toEqual([
        ["Calacatta slab", "CAL-20", "10.0000", "m²", "10.00", "5.0000", "3150.0000", "157.5000", "3307.5000"],
        ["Under-cabinet lights", "", "1.0000", "nos", "10.00", "5.0000", "450.0000", "22.5000", "472.5000"]]);
      expect((await buyer.orders.create(actor, w.workspaceId, { id: order, vendorId: vendor, lines })).order.number).toBe(state.order.number);
      needs = (await buyer.orders.needs(actor, w.workspaceId)).needs;
      expect(needs.map((need) => [need.placed, need.drafted, need.remaining])).toEqual([["0", "10.0000", "2.0000"], ["0", "1.0000", "0.0000"]]);

      await expect(buyer.orders.command(actor, w.workspaceId, order, { action: "submit", version: state.order.version })).rejects.toThrow(/isn't approved as a supplier/);
      register = await approver.suppliers.approve(actor, w.workspaceId, vendor, { version: register.suppliers[0].version, approval: "approved" });
      state = await buyer.orders.command(actor, w.workspaceId, order, { action: "submit", version: state.order.version });
      expect(state.order.status).toBe("pending_approval");
      await expect(buyer.orders.command(actor, w.workspaceId, order, { action: "approve", version: state.order.version })).rejects.toThrow(/Someone else approves/);
      await expect(approver.orders.command(actor, w.workspaceId, order, { action: "return", version: state.order.version })).rejects.toThrow(/Say what needs to change/);
      state = await approver.orders.command(actor, w.workspaceId, order, { action: "approve", version: state.order.version });
      expect(state.order).toMatchObject({ status: "approved", approvedByName: "Omar Manager" });
      state = await buyer.orders.command(actor, w.workspaceId, order, { action: "send", to: "orders@nile.example", version: state.order.version });
      expect(state).toMatchObject({ order: { status: "sent", sentTo: "orders@nile.example" }, delivery: "not_configured" });
      const history = await core.line(actor, w.workspaceId, projectId, needs[1].sourceId);
      expect(history.history.at(-1)).toMatchObject({ kind: "ordered", detail: { order: state.order.number, quantity: "1.0000" } });
      state = await buyer.orders.command(actor, w.workspaceId, order, { action: "confirm", promisedDate: "2026-10-18", supplierReference: "SO-551", version: state.order.version });
      expect(state.order).toMatchObject({ status: "confirmed", promisedDate: "2026-10-18", supplierReference: "SO-551" });

      // Two m² short, so procurement isn't done; the order is changed to 12 and approved again.
      const { everythingOrdered } = await import("../purchasing/orders");
      expect(await everythingOrdered(w.client, w.workspaceId, projectId)).toBe(false);
      await expect(buyer.orders.command(actor, w.workspaceId, order, { action: "change", version: state.order.version })).rejects.toThrow(/Say what's changing/);
      state = await buyer.orders.command(actor, w.workspaceId, order, { action: "change", reason: "Two more slabs for the splashback", version: state.order.version });
      expect(state.order).toMatchObject({ status: "draft", revision: 1 });
      expect(state.revisions).toEqual([expect.objectContaining({ revision: 0, reason: "Two more slabs for the splashback" })]);
      state = await buyer.orders.command(actor, w.workspaceId, order, { action: "save", version: state.order.version,
        lines: state.lines.map((line, index) => ({ id: line.id, source: line.source, materialItemId: line.materialItemId, boqLineId: line.boqLineId, quantity: index ? line.quantity : "12",
          unitPrice: line.unitPrice, discountPercent: line.discountPercent, taxRate: line.taxRate, specification: line.specification })) });
      expect(state.order.total).toBe("4441.5000");
      state = await buyer.orders.command(actor, w.workspaceId, order, { action: "submit", version: state.order.version });
      state = await approver.orders.command(actor, w.workspaceId, order, { action: "approve", version: state.order.version });
      expect(await everythingOrdered(w.client, w.workspaceId, projectId)).toBe(true);
      await expect(buyer.orders.command(actor, w.workspaceId, order, { action: "cancel", version: state.order.version })).rejects.toThrow(/Say why/);
      const notices = (await w.client.query<{ event: string; recipient: string }>(`SELECT event_type AS event, recipient_id AS recipient FROM notifications WHERE workspace_id = $1 AND event_type LIKE 'purchasing.%' AND channel = 'in_app'`, [w.workspaceId])).rows;
      expect(notices).toEqual(expect.arrayContaining([{ event: "purchasing.approved", recipient: w.designer }]));
    });
  });

  it("asks several suppliers for prices, marks the cheapest after discounts, and awards with a reason into draft orders", async () => {
    await world(async (w) => {
      await accept(w);
      const core = w.as(w.manager);
      const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const company = randomUUID();
      await w.client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,'FAC','Studio Furniture','Studio Furniture LLC','AE','AED','en-AE','Asia/Dubai')`, [company, w.workspaceId]);
      const everything = ["vendors.view", "vendors.manage", "vendors.approve", "purchasing.view", "purchasing.manage", "purchasing.approve"];
      const access = {
        withPermission: async (_a: unknown, _w: string, _code: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(w.client, { userId: w.designer }),
        withAnyPermission: async (_a: unknown, _w: string, _codes: string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(w.client, { userId: w.designer }),
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => everything.includes(code),
      } as never;
      const orders = new OrdersService(access);
      const requests = new PriceRequestsService(access, orders);
      const suppliers = new SuppliersService(access);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Calacatta slab", quantity: "12", unit: "m²", version: detail.project.version });
      const slab = (await core.materials(actor, w.workspaceId, projectId)).items[0];
      const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
      for (const [id, name] of [[a, "Siom Marble"], [b, "Nile Marble"], [c, "Lilacs Marble"]] as const) {
        const saved = await suppliers.save(actor, w.workspaceId, { id, version: 0, name, categories: ["Marble"], entityIds: [company] });
        if (id !== c) await suppliers.approve(actor, w.workspaceId, id, { version: saved.suppliers.find((item) => item.id === id)!.version, approval: "approved" });
      }
      const id = randomUUID();
      let state = await requests.create(actor, w.workspaceId, { id, vendorIds: [a, b, c], neededBy: "2026-10-15", lines: [{ source: "material", materialItemId: slab.id, quantity: "12" }] });
      expect(state.request).toMatchObject({ number: 1, status: "open", currency: "AED" });
      expect(state.lines.map((line) => [line.description, line.quantity, line.unit])).toEqual([["Calacatta slab", "12.0000", "m²"]]);
      const line = state.lines[0].id;
      state = await requests.command(actor, w.workspaceId, id, { action: "record_reply", version: state.request.version, vendorId: a, prices: [{ lineId: line, unitPrice: "360" }], leadTimeDays: 7 });
      state = await requests.command(actor, w.workspaceId, id, { action: "record_reply", version: state.request.version, vendorId: b, prices: [{ lineId: line, unitPrice: "380", discountPercent: "10" }], validUntil: "2026-10-30" });
      state = await requests.command(actor, w.workspaceId, id, { action: "decline", version: state.request.version, vendorId: c, note: "Out of stock" });
      // 12 × 380 less 10% = 4,104 beats 12 × 360 = 4,320.
      expect(state.cheapest[line]).toBe(b);
      expect(state.totals).toMatchObject({ [a]: { net: "4320.00", priced: 1 }, [b]: { net: "4104.00", priced: 1 }, [c]: { net: "0.00", priced: 0 } });
      await expect(requests.command(actor, w.workspaceId, id, { action: "award", version: state.request.version, awards: [{ lineId: line, vendorId: c }] })).rejects.toThrow(/hasn't priced it/);
      await expect(requests.command(actor, w.workspaceId, id, { action: "award", version: state.request.version, awards: [{ lineId: line, vendorId: a }] })).rejects.toThrow(/say why it isn't going to the cheapest/);
      state = await requests.command(actor, w.workspaceId, id, { action: "award", version: state.request.version, awards: [{ lineId: line, vendorId: a, reason: "Nile can't deliver before the 20th" }] });
      expect(state.request.status).toBe("awarded");
      expect(state.lines[0]).toMatchObject({ awardedVendorId: a, awardReason: "Nile can't deliver before the 20th" });
      expect(state.orders).toEqual([expect.objectContaining({ vendorId: a })]);
      const order = await orders.get(actor, w.workspaceId, state.orders[0].id);
      expect(order.order).toMatchObject({ status: "draft", currency: "AED", expectedDate: "2026-10-15", total: "4320.0000" });
      expect(order.lines[0]).toMatchObject({ source: "material", materialItemId: slab.id, unitPrice: "360.0000", quantity: "12.0000" });
      await expect(requests.command(actor, w.workspaceId, id, { action: "cancel", reason: "x", version: state.request.version })).rejects.toThrow(/already awarded/);
    });
  });

  it("receives deliveries: where they arrived, inspected by someone else, rejects owed again, over-delivery within the tolerance, and closed", async () => {
    await world(async (w) => {
      await accept(w);
      const core = w.as(w.manager);
      const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const company = randomUUID(), vendor = randomUUID();
      await w.client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,'FAC','Studio Furniture','Studio Furniture LLC','AE','AED','en-AE','Asia/Dubai')`, [company, w.workspaceId]);
      const access = (userId: string, permissions: string[]) => {
        const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
          if (!(Array.isArray(code) ? code : [code]).some((item) => permissions.includes(item))) throw new Error("Not allowed");
          await w.client.query("SAVEPOINT command");
          try { const result = await fn(w.client, { userId }); await w.client.query("RELEASE SAVEPOINT command"); return result; }
          catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT command"); throw error; }
        };
        return { withPermission: run, withAnyPermission: run, hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never;
      };
      const buying = ["vendors.view", "vendors.manage", "purchasing.view", "purchasing.manage", "stock.receive", "workspace.settings.manage"];
      const orders = new OrdersService(access(w.designer, buying));
      const storekeeper = new ReceivingService(access(w.designer, buying));
      const inspector = new ReceivingService(access(w.manager, ["purchasing.view", "stock.inspect"]));
      await w.client.query(`INSERT INTO workspace_purchasing_settings (workspace_id, approval_threshold, require_material_signoff, require_approved_supplier) VALUES ($1, NULL, false, false)`, [w.workspaceId]);

      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Calacatta slab", quantity: "10", unit: "m²", version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", name: "Lights", supply: "ready_made", version: detail.project.version });
      const scope = await core.scope(actor, w.workspaceId, projectId);
      const lightsLine = scope.lines.find((line) => line.title === "Under-cabinet lights")!;
      detail = await core.command(actor, w.workspaceId, projectId, { action: "assign_lines", lineIds: [lightsLine.id], packageId: scope.packages.find((item) => item.name === "Lights")!.id, version: detail.project.version });
      await new SuppliersService(access(w.designer, buying)).save(actor, w.workspaceId, { id: vendor, version: 0, name: "Nile Marble", entityIds: [company] });
      const needs = (await orders.needs(actor, w.workspaceId)).needs.filter((need) => ["Calacatta slab", "Under-cabinet lights"].includes(need.title));
      const order = randomUUID();
      let state = await orders.create(actor, w.workspaceId, { id: order, vendorId: vendor, lines: needs.map((need) => ({ source: need.source,
        ...(need.source === "material" ? { materialItemId: need.sourceId } : { boqLineId: need.sourceId }), quantity: need.required, unitPrice: "100" })) });
      state = await orders.command(actor, w.workspaceId, order, { action: "submit", version: state.order.version });
      const early = await storekeeper.receiving(actor, w.workspaceId, order);
      await expect(storekeeper.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order, place: early.defaultPlace, receivedOn: "2026-09-26", lines: [{ orderLineId: state.lines[0].id, received: "1" }] }))
        .rejects.toThrow(/Send the order/);
      state = await orders.command(actor, w.workspaceId, order, { action: "send", version: state.order.version });
      const [slabLine, lightLine] = state.lines;

      // The form: the project's site first (made on first use), then the warehouse and factory; inspection is on.
      const form = await storekeeper.receiving(actor, w.workspaceId, order);
      expect(form.places.map((place) => [place.key, place.kind])).toEqual([[`site:${projectId}`, "site"], ["warehouse", "warehouse"], ["factory", "factory"]]);
      expect(form).toMatchObject({ defaultPlace: `site:${projectId}`, requireInspection: true });
      expect(form.lines.map((line) => [line.outstanding, line.receivable])).toEqual([["10", "10"], ["1", "1"]]);

      const first = randomUUID();
      const receiptInput = { id: first, orderId: order, place: form.defaultPlace, receivedOn: "2026-09-26", deliveryNote: "DN-88", lines: [{ orderLineId: slabLine.id, received: "6" }] };
      let receipt = await storekeeper.receive(actor, w.workspaceId, receiptInput);
      expect(receipt.receipt).toMatchObject({ number: 1, locationKind: "site", locationName: expect.stringContaining("Villa 12"), received: "6.0000", pending: "6.0000", accepted: "0.0000" });
      expect((await storekeeper.receive(actor, w.workspaceId, receiptInput)).receipt.number).toBe(1);
      expect((await orders.get(actor, w.workspaceId, order)).order.status).toBe("partly_received");
      await expect(storekeeper.receive(actor, w.workspaceId, { ...receiptInput, id: randomUUID(), lines: [{ orderLineId: slabLine.id, received: "5" }] })).rejects.toThrow(/at most 4 m²/);
      await expect(orders.command(actor, w.workspaceId, order, { action: "close", version: (await orders.get(actor, w.workspaceId, order)).order.version })).rejects.toThrow(/waiting for inspection/);

      // Whoever received it doesn't inspect it; a rejection needs its reason and is owed again.
      await expect(new ReceivingService(access(w.designer, [...buying, "stock.inspect"])).inspect(actor, w.workspaceId, first, { lines: [] })).rejects.toThrow(/Someone else inspects/);
      expect(receipt.canInspectThis).toBe(false);
      const waiting = receipt.lines[0];
      await expect(inspector.inspect(actor, w.workspaceId, first, { lines: [{ id: waiting.id, accepted: "5", rejected: "1", rejectKind: "damaged" }] })).rejects.toThrow(/Say why/);
      await expect(inspector.inspect(actor, w.workspaceId, first, { lines: [{ id: waiting.id, accepted: "4", rejected: "1", rejectKind: "damaged", rejectReason: "Chipped" }] })).rejects.toThrow(/add up to 6/);
      receipt = await inspector.inspect(actor, w.workspaceId, first, { lines: [{ id: waiting.id, accepted: "5", rejected: "1", rejectKind: "damaged", rejectReason: "Chipped edge" }] });
      expect(receipt.receipt).toMatchObject({ accepted: "5.0000", rejected: "1.0000", pending: "0.0000", inspectedByName: "Omar Manager" });
      let current = await orders.get(actor, w.workspaceId, order);
      expect(current.lines.map((line) => [line.accepted, line.rejected, line.pending])).toEqual([["5.0000", "1.0000", "0.0000"], ["0.0000", "0.0000", "0.0000"]]);
      expect(current.receipts).toHaveLength(1);
      await expect(orders.command(actor, w.workspaceId, order, { action: "close", version: current.order.version })).rejects.toThrow(/Say why the rest/);

      // Without inspection, what's accepted is entered at receipt; 10% over is allowed on the whole line.
      await w.client.query(`UPDATE workspace_purchasing_settings SET require_inspection = false, receive_tolerance_percent = 10 WHERE workspace_id = $1`, [w.workspaceId]);
      expect((await storekeeper.receiving(actor, w.workspaceId, order)).lines.map((line) => line.receivable)).toEqual(["6", "1.1"]);
      receipt = await storekeeper.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order, place: "warehouse", receivedOn: "2026-09-27",
        lines: [{ orderLineId: slabLine.id, received: "6" }, { orderLineId: lightLine.id, received: "1" }] });
      expect(receipt.receipt).toMatchObject({ number: 2, locationKind: "warehouse", locationName: "Warehouse", accepted: "7.0000", pending: "0.0000" });
      current = await orders.get(actor, w.workspaceId, order);
      expect(current.order.status).toBe("received");
      expect((await core.line(actor, w.workspaceId, projectId, lightsLine.id)).history.at(-1)).toMatchObject({ kind: "received", detail: { order: current.order.number, quantity: "1" } });
      expect((await orders.needs(actor, w.workspaceId)).needs.filter((need) => Number(need.received)).map((need) => [need.title, need.received])).toEqual([["Calacatta slab", "11.0000"], ["Under-cabinet lights", "1.0000"]]);
      current = await orders.command(actor, w.workspaceId, order, { action: "close", version: current.order.version });
      expect(current.order.status).toBe("closed");
      await expect(storekeeper.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order, place: "warehouse", receivedOn: "2026-09-27", lines: [{ orderLineId: lightLine.id, received: "0.1" }] }))
        .rejects.toThrow(/isn't open for deliveries/);
      const deliveries = await storekeeper.deliveries(actor, w.workspaceId);
      expect([deliveries.expected.length, deliveries.inspection.length, deliveries.received.map((item) => item.number)]).toEqual([0, 0, [2, 1]]);

      const notices = (await w.client.query<{ event: string; recipient: string }>(`SELECT event_type AS event, recipient_id AS recipient FROM notifications WHERE workspace_id = $1 AND event_type IN ('purchasing.received', 'purchasing.rejected', 'purchasing.inspection_needed') AND channel = 'in_app' ORDER BY created_at`, [w.workspaceId])).rows;
      expect(notices).toEqual(expect.arrayContaining([{ event: "purchasing.rejected", recipient: w.designer }, { event: "purchasing.received", recipient: w.designer }]));
    });
  });

  it("keeps stock by place and owner: receipts in, reserve and release, issue, moves that arrive short, counts, and a ledger that never changes", async () => {
    await world(async (w) => {
      await accept(w);
      const core = w.as(w.manager);
      const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const company = randomUUID(), vendor = randomUUID();
      await w.client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,'FAC','Studio Furniture','Studio Furniture LLC','AE','AED','en-AE','Asia/Dubai')`, [company, w.workspaceId]);
      const access = (userId: string, permissions: string[]) => {
        const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
          if (!(Array.isArray(code) ? code : [code]).some((item) => permissions.includes(item))) throw new Error("Not allowed");
          await w.client.query("SAVEPOINT command");
          try { const result = await fn(w.client, { userId }); await w.client.query("RELEASE SAVEPOINT command"); return result; }
          catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT command"); throw error; }
        };
        return { withPermission: run, withAnyPermission: run, hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never;
      };
      const all = ["vendors.view", "vendors.manage", "purchasing.view", "purchasing.manage", "stock.view", "stock.manage", "stock.adjust", "stock.receive"];
      const orders = new OrdersService(access(w.designer, all));
      const store = new InventoryService(access(w.manager, all));
      const keeper = new InventoryService(access(w.designer, ["stock.view", "stock.receive"]));
      await w.client.query(`INSERT INTO workspace_purchasing_settings (workspace_id, approval_threshold, require_material_signoff, require_approved_supplier, require_inspection) VALUES ($1, NULL, false, false, false)`, [w.workspaceId]);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Calacatta slab", quantity: "10", unit: "m²", version: detail.project.version });
      await new SuppliersService(access(w.designer, all)).save(actor, w.workspaceId, { id: vendor, version: 0, name: "Nile Marble", entityIds: [company] });
      const slabNeed = (await orders.needs(actor, w.workspaceId)).needs.find((need) => need.title === "Calacatta slab")!;
      const order = randomUUID();
      let state = await orders.create(actor, w.workspaceId, { id: order, vendorId: vendor, lines: [{ source: "material", materialItemId: slabNeed.sourceId, quantity: "10", unitPrice: "350", discountPercent: "0", taxRate: "0" }] });
      state = await orders.command(actor, w.workspaceId, order, { action: "submit", version: state.order.version });
      state = await orders.command(actor, w.workspaceId, order, { action: "send", version: state.order.version });
      await new ReceivingService(access(w.designer, all)).receive(actor, w.workspaceId, { id: randomUUID(), orderId: order, place: "warehouse", receivedOn: "2026-09-26",
        lines: [{ orderLineId: state.lines[0].id, received: "10" }] });

      // The slab is the project's stock at the warehouse, at its price; the glue is added as free stock.
      let stock = await store.stock(actor, w.workspaceId);
      const warehouse = stock.locations.find((location) => location.kind === "warehouse")!;
      expect(stock.rows.map((row) => [row.itemName, row.unit, row.locationName, row.projectReference, row.onHand])).toEqual([["Calacatta slab", "m²", "Warehouse", detail.project.reference, "10.0000"]]);
      const add = { id: randomUUID(), action: "add", name: "Wood glue", unit: "nos", locationId: warehouse.id, quantity: "20", reason: "Opening stock" };
      await expect(keeper.command(actor, w.workspaceId, add)).rejects.toThrow("Not allowed");
      await expect(store.command(actor, w.workspaceId, { ...add, reason: "" })).rejects.toThrow(/where this stock comes from/);
      stock = await store.command(actor, w.workspaceId, add);
      const glue = stock.rows.find((row) => row.itemName === "Wood glue")!;
      const slab = stock.rows.find((row) => row.itemName === "Calacatta slab")!;
      const change = (action: string, input: Record<string, unknown>) => store.command(actor, w.workspaceId, { id: randomUUID(), action, itemId: glue.itemId, locationId: warehouse.id, ...input });

      // Reserve 5 for the project (replaying it changes nothing), use 3 there, release 2.
      const reserve = { id: randomUUID(), action: "allocate", itemId: glue.itemId, locationId: warehouse.id, quantity: "5", forProjectId: projectId };
      await store.command(actor, w.workspaceId, reserve);
      stock = await store.command(actor, w.workspaceId, reserve);
      const glueRows = () => stock.rows.filter((row) => row.itemName === "Wood glue").map((row) => [row.projectReference, row.onHand]);
      expect(glueRows()).toEqual([[null, "15.0000"], [detail.project.reference, "5.0000"]]);
      await expect(change("issue", { quantity: "30", forProjectId: projectId })).rejects.toThrow(/Only 15/);
      stock = await change("issue", { projectId, quantity: "3" });
      await expect(change("release", { projectId, quantity: "3" })).rejects.toThrow(/Only 2/);
      stock = await change("release", { projectId, quantity: "2" });
      expect(glueRows()).toEqual([[null, "17.0000"]]);

      // The slab goes to another store; one m² breaks on the way.
      const yard = randomUUID();
      await store.saveLocation(actor, w.workspaceId, { id: yard, kind: "warehouse", name: "Al Quoz yard" });
      const move = randomUUID();
      let transfer = await store.send(actor, w.workspaceId, { id: move, fromLocationId: warehouse.id, toLocationId: yard, lines: [{ itemId: slab.itemId, projectId, quantity: "10" }] });
      expect(transfer.transfer).toMatchObject({ number: 1, status: "in_transit", fromName: "Warehouse", toName: "Al Quoz yard" });
      expect((await store.stock(actor, w.workspaceId)).rows.filter((row) => row.itemName === "Calacatta slab")).toEqual([]);
      await expect(store.saveLocation(actor, w.workspaceId, { id: warehouse.id, name: "Warehouse", active: false })).rejects.toThrow(/Move the stock out/);
      await expect(keeper.transferCommand(actor, w.workspaceId, move, { action: "receive", lines: [{ id: transfer.lines[0].id, received: "9" }] })).rejects.toThrow(/what happened to the rest/);
      transfer = await keeper.transferCommand(actor, w.workspaceId, move, { action: "receive", lines: [{ id: transfer.lines[0].id, received: "9", lossReason: "Cracked in the truck" }] });
      expect(transfer.transfer).toMatchObject({ status: "received", short: true });
      expect((await keeper.transferCommand(actor, w.workspaceId, move, { action: "receive", lines: [] })).transfer.status).toBe("received");
      stock = await store.stock(actor, w.workspaceId);
      expect(stock.rows.filter((row) => row.itemName === "Calacatta slab").map((row) => [row.locationName, row.onHand])).toEqual([["Al Quoz yard", "9.0000"]]);

      // A cancelled move puts everything back.
      const back = randomUUID();
      await store.send(actor, w.workspaceId, { id: back, fromLocationId: warehouse.id, toLocationId: yard, lines: [{ itemId: glue.itemId, quantity: "4" }] });
      await expect(store.transferCommand(actor, w.workspaceId, back, { action: "cancel" })).rejects.toThrow(/Say why/);
      await store.transferCommand(actor, w.workspaceId, back, { action: "cancel", reason: "Van broke down" });
      stock = await store.stock(actor, w.workspaceId);
      expect(glueRows()).toEqual([[null, "17.0000"]]);

      // A count corrects stock with the reason; the ledger keeps every step and can't be changed.
      await expect(change("count", { counted: "16" })).rejects.toThrow(/why the count is different/);
      stock = await change("count", { counted: "16", reason: "One tube dried out" });
      expect(glueRows()).toEqual([[null, "16.0000"]]);
      const ledger = (await store.movements(actor, w.workspaceId, { itemId: glue.itemId })).movements;
      expect(ledger.map((row) => [row.kind, row.quantity]).reverse()).toEqual([["adjust", "20.0000"], ["allocate", "-5.0000"], ["allocate", "5.0000"], ["issue", "-3.0000"],
        ["release", "-2.0000"], ["release", "2.0000"], ["transfer_out", "-4.0000"], ["transfer_in", "4.0000"], ["adjust", "-1.0000"]]);
      expect(ledger[0]).toMatchObject({ reason: "Count: One tube dried out", byName: "Omar Manager" });
      const slabIn = (await store.movements(actor, w.workspaceId, { itemId: slab.itemId })).movements.at(-1)!;
      expect(slabIn).toMatchObject({ kind: "receive", orderNumber: state.order.number, receiptNumber: 1 });
      expect((await w.client.query(`SELECT unit_cost::text AS cost, currency FROM stock_movements WHERE workspace_id = $1 AND kind = 'receive'`, [w.workspaceId])).rows).toEqual([{ cost: "350.0000", currency: "AED" }]);
      await w.client.query("SAVEPOINT immutable");
      await expect(w.client.query(`UPDATE stock_movements SET quantity = 1 WHERE workspace_id = $1`, [w.workspaceId])).rejects.toThrow(/cannot be changed/);
      await w.client.query("ROLLBACK TO SAVEPOINT immutable");
    });
  });

  it("handles delivery problems: missing against the note, wrong spec and defects, line-by-line inspection, returns replaced or credited, and a wrong receipt reversed", async () => {
    await world(async (w) => {
      await accept(w);
      const core = w.as(w.manager);
      const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const company = randomUUID(), vendor = randomUUID();
      await w.client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,'FAC','Studio Furniture','Studio Furniture LLC','AE','AED','en-AE','Asia/Dubai')`, [company, w.workspaceId]);
      const access = (userId: string, permissions: string[]) => {
        const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
          if (!(Array.isArray(code) ? code : [code]).some((item) => permissions.includes(item))) throw new Error("Not allowed");
          await w.client.query("SAVEPOINT command");
          try { const result = await fn(w.client, { userId }); await w.client.query("RELEASE SAVEPOINT command"); return result; }
          catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT command"); throw error; }
        };
        return { withPermission: run, withAnyPermission: run, hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never;
      };
      const buyerRights = ["vendors.view", "vendors.manage", "purchasing.view", "purchasing.manage", "purchasing.approve", "stock.receive", "stock.inspect", "stock.view", "stock.manage"];
      const orders = new OrdersService(access(w.manager, buyerRights));
      const buyer = { receiving: new ReceivingService(access(w.manager, buyerRights)), returns: new SupplierReturnsService(access(w.manager, buyerRights)) };
      const keeper = new ReceivingService(access(w.designer, ["purchasing.view", "stock.receive"]));
      await w.client.query(`INSERT INTO workspace_purchasing_settings (workspace_id, approval_threshold, require_material_signoff, require_approved_supplier) VALUES ($1, NULL, false, false)`, [w.workspaceId]);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Calacatta slab", quantity: "10", unit: "m²", version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", name: "Lights", supply: "ready_made", version: detail.project.version });
      const scope = await core.scope(actor, w.workspaceId, projectId);
      const lightsLine = scope.lines.find((line) => line.title === "Under-cabinet lights")!;
      detail = await core.command(actor, w.workspaceId, projectId, { action: "assign_lines", lineIds: [lightsLine.id], packageId: scope.packages.find((item) => item.name === "Lights")!.id, version: detail.project.version });
      await new SuppliersService(access(w.manager, buyerRights)).save(actor, w.workspaceId, { id: vendor, version: 0, name: "Nile Marble", entityIds: [company] });
      const needs = (await orders.needs(actor, w.workspaceId)).needs.filter((need) => ["Calacatta slab", "Under-cabinet lights"].includes(need.title));
      const order = randomUUID();
      let state = await orders.create(actor, w.workspaceId, { id: order, vendorId: vendor, lines: needs.map((need) => ({ source: need.source,
        ...(need.source === "material" ? { materialItemId: need.sourceId } : { boqLineId: need.sourceId }), quantity: need.required, unitPrice: need.source === "material" ? "350" : "500", discountPercent: "0", taxRate: "0" })) });
      state = await orders.command(actor, w.workspaceId, order, { action: "submit", version: state.order.version });
      state = await orders.command(actor, w.workspaceId, order, { action: "send", version: state.order.version });
      const [slab, lights] = state.lines;
      const lineStatus = async () => (await orders.get(actor, w.workspaceId, order)).lines.map((line) => [line.accepted, line.rejected, line.pending, line.credited]);

      // A receipt at the wrong place is reversed by its receiver before anyone inspects it; the order goes back to sent.
      const wrong = await keeper.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order, place: "factory", receivedOn: "2026-09-26", lines: [{ orderLineId: slab.id, received: "10" }] });
      expect(wrong.canReverseThis).toBe(true);
      await expect(keeper.reverse(actor, w.workspaceId, wrong.receipt.id, {})).rejects.toThrow(/what was wrong/);
      const reversed = await keeper.reverse(actor, w.workspaceId, wrong.receipt.id, { reason: "Booked to the factory by mistake" });
      expect(reversed.receipt).toMatchObject({ reverseReason: "Booked to the factory by mistake", reversedByName: "Dana Designer" });
      expect((await orders.get(actor, w.workspaceId, order)).order.status).toBe("sent");
      expect((await buyer.receiving.deliveries(actor, w.workspaceId)).inspection).toEqual([]);

      // The note says 12 m², 10 arrived: 2 are missing and the buyer is told.
      let receipt = await keeper.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order, place: "warehouse", receivedOn: "2026-09-27",
        lines: [{ orderLineId: slab.id, received: "10", noted: "12" }, { orderLineId: lights.id, received: "1" }] });
      expect(receipt.receipt).toMatchObject({ number: 2, missing: "2.0000", pending: "11.0000" });
      const first = receipt.receipt.id;

      // Inspected line by line: the slab now (2 m² not to spec), the lights later.
      const slabLine = receipt.lines.find((line) => line.orderLineId === slab.id)!;
      await expect(buyer.receiving.inspect(actor, w.workspaceId, first, { lines: [{ id: slabLine.id, rejected: "2", rejectReason: "Veins don't match the sample" }] })).rejects.toThrow(/what was wrong/);
      receipt = await buyer.receiving.inspect(actor, w.workspaceId, first, { lines: [{ id: slabLine.id, rejected: "2", rejectKind: "wrong_spec", rejectReason: "Veins don't match the sample" }] });
      expect(receipt.receipt).toMatchObject({ accepted: "8.0000", rejected: "2.0000", pending: "1.0000", inspectedAt: null });
      expect(receipt.lines.find((line) => line.id === slabLine.id)).toMatchObject({ rejectKind: "wrong_spec", inspectedByName: "Omar Manager" });
      expect((await buyer.receiving.deliveries(actor, w.workspaceId)).inspection.map((item) => item.number)).toEqual([2]);
      receipt = await buyer.receiving.inspect(actor, w.workspaceId, first, { lines: [{ id: receipt.lines.find((line) => line.orderLineId === lights.id)!.id }] });
      expect(receipt.receipt.inspectedAt).not.toBeNull();
      expect(await lineStatus()).toEqual([["8.0000", "2.0000", "0.0000", "0.0000"], ["1.0000", "0.0000", "0.0000", "0.0000"]]);
      expect((await orders.get(actor, w.workspaceId, order)).order.status).toBe("partly_received");

      // The two rejected m² go back to be replaced; they stay owed and never touched stock.
      const replace = randomUUID();
      let back = await buyer.returns.create(actor, w.workspaceId, { id: replace, receiptId: first, outcome: "replace", lines: [{ receiptLineId: slabLine.id, source: "rejected", quantity: "3" }] })
        .catch((error: Error) => error);
      expect((back as Error).message).toMatch(/At most 2 m²/);
      back = await buyer.returns.create(actor, w.workspaceId, { id: replace, receiptId: first, outcome: "replace", lines: [{ receiptLineId: slabLine.id, source: "rejected", quantity: "2" }] }) as never;
      expect((back as { return: { number: number; status: string } }).return).toMatchObject({ number: 1, status: "open" });
      expect((back as { lines: Array<{ reasonKind: string; reason: string }> }).lines[0]).toMatchObject({ reasonKind: "wrong_spec", reason: "Veins don't match the sample" });
      await expect(keeper.reverse(actor, w.workspaceId, first, { reason: "x" })).rejects.toThrow(/going back to the supplier/);
      await expect(orders.command(actor, w.workspaceId, order, { action: "close", reason: "x", version: (await orders.get(actor, w.workspaceId, order)).order.version }))
        .rejects.toThrow(/waiting to go back/);
      back = await buyer.returns.command(actor, w.workspaceId, replace, { action: "sent", version: 1 }) as never;
      expect((back as { return: { status: string } }).return.status).toBe("sent");

      // One accepted m² turns out cracked: it goes back for a credit, leaving stock when collected.
      const credit = randomUUID();
      back = await buyer.returns.create(actor, w.workspaceId, { id: credit, receiptId: first, outcome: "credit", note: "Found at cutting",
        lines: [{ receiptLineId: slabLine.id, source: "accepted", quantity: "1", reasonKind: "defective", reason: "Hairline crack" }] }) as never;
      expect((back as { return: { credit: string } }).return.credit).toBe("350.0000");
      expect(await lineStatus()).toEqual([["8.0000", "2.0000", "0.0000", "0.0000"], ["1.0000", "0.0000", "0.0000", "0.0000"]]);
      await buyer.returns.command(actor, w.workspaceId, credit, { action: "sent", version: 1 });
      expect(await lineStatus()).toEqual([["7.0000", "2.0000", "0.0000", "1.0000"], ["1.0000", "0.0000", "0.0000", "0.0000"]]);
      const stockOf = async () => (await w.client.query<{ onHand: string }>(`SELECT sum(on_hand)::text AS "onHand" FROM stock_balances balance JOIN stock_items item ON item.id = balance.item_id
        WHERE balance.workspace_id = $1 AND item.name = 'Calacatta slab'`, [w.workspaceId])).rows[0].onHand;
      expect(await stockOf()).toBe("7.0000");
      const form = await keeper.receiving(actor, w.workspaceId, order);
      expect(form.lines.map((line) => line.outstanding)).toEqual(["2", "0"]);

      // The replacement arrives; entered twice by mistake, the buyer reverses the second.
      const replacement = await keeper.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order, place: "warehouse", receivedOn: "2026-09-27", lines: [{ orderLineId: slab.id, received: "2" }] });
      await buyer.receiving.inspect(actor, w.workspaceId, replacement.receipt.id, { lines: [{ id: replacement.lines[0].id }] });
      expect((await orders.get(actor, w.workspaceId, order)).order.status).toBe("received");
      expect(await stockOf()).toBe("9.0000");
      const reversal = await buyer.receiving.reverse(actor, w.workspaceId, replacement.receipt.id, { reason: "Counted the replacement twice" });
      expect(reversal.receipt.reversedAt).not.toBeNull();
      expect(await stockOf()).toBe("7.0000");
      expect((await orders.get(actor, w.workspaceId, order)).order.status).toBe("partly_received");
      const again = await keeper.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order, place: "warehouse", receivedOn: "2026-09-27", lines: [{ orderLineId: slab.id, received: "2" }] });
      await buyer.receiving.inspect(actor, w.workspaceId, again.receipt.id, { lines: [{ id: again.lines[0].id }] });
      let current = await orders.get(actor, w.workspaceId, order);
      expect(current.order.status).toBe("received");
      expect(current.lines.map((line) => [line.accepted, line.credited, line.returned])).toEqual([["9.0000", "1.0000", "3.0000"], ["1.0000", "0.0000", "0.0000"]]);
      expect(current.returns.map((item) => [item.number, item.outcome, item.status])).toEqual([[2, "credit", "sent"], [1, "replace", "sent"]]);
      // Nine accepted plus one credited is the whole line: closing isn't short.
      current = await orders.command(actor, w.workspaceId, order, { action: "close", version: current.order.version });
      expect(current.order).toMatchObject({ status: "closed", closeReason: null });

      const notices = (await w.client.query<{ event: string; recipient: string }>(`SELECT event_type AS event, recipient_id AS recipient FROM notifications WHERE workspace_id = $1
        AND event_type IN ('purchasing.missing', 'purchasing.receipt_reversed') AND channel = 'in_app'`, [w.workspaceId])).rows;
      expect(notices).toEqual(expect.arrayContaining([{ event: "purchasing.missing", recipient: w.manager }, { event: "purchasing.receipt_reversed", recipient: w.manager },
        { event: "purchasing.receipt_reversed", recipient: w.designer }]));
    });
  });

  it("gates only what the client chooses: no material list or bought scope lines order freely; over-ordering says why; units and ordered materials stay put", async () => {
    await world(async (w) => {
      const { core, projectId, vendor, buyer } = await buying(w);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", name: "Lights", supply: "ready_made", version: detail.project.version });
      const scope = await core.scope(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "assign_lines", lineIds: [scope.lines.find((line) => line.title === "Under-cabinet lights")!.id],
        packageId: scope.packages.find((item) => item.name === "Lights")!.id, version: detail.project.version });
      // No material list at all: the bought line orders straight away.
      let needs = (await buyer.orders.needs(actor, w.workspaceId)).needs.filter((need) => need.title === "Under-cabinet lights");
      expect(needs.map((need) => need.blocked)).toEqual([null]);
      const lights = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "line", boqLineId: needs[0].sourceId, quantity: "1", unitPrice: "500" }]);
      expect(lights.order.status).toBe("sent");

      // Cement isn't the client's choice; the slab is and waits for their sign-off.
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Cement", quantity: "5", unit: "bags", clientChoice: false, version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Calacatta slab", quantity: "10", unit: "m²", version: detail.project.version });
      needs = (await buyer.orders.needs(actor, w.workspaceId)).needs;
      expect(needs.filter((need) => need.source === "material").map((need) => [need.title, need.clientChoice, need.blocked])).toEqual([["Cement", false, null], ["Calacatta slab", true, "material_signoff"]]);
      const cement = needs.find((need) => need.title === "Cement")!, slab = needs.find((need) => need.title === "Calacatta slab")!;
      await expect(buyer.orders.create(actor, w.workspaceId, { id: randomUUID(), vendorId: vendor, lines: [{ source: "material", materialItemId: cement.sourceId, quantity: "5", unit: "kg", unitPrice: "20" }] }))
        .rejects.toThrow(/order Cement in bags/);
      const first = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: cement.sourceId, quantity: "3", unitPrice: "20" }]);
      expect(first.lines[0].unit).toBe("bags");
      const slabOrder = await buyer.orders.create(actor, w.workspaceId, { id: randomUUID(), vendorId: vendor, lines: [{ source: "material", materialItemId: slab.sourceId, quantity: "10", unitPrice: "350" }] });
      await expect(buyer.orders.command(actor, w.workspaceId, slabOrder.order.id, { action: "submit", version: slabOrder.order.version })).rejects.toThrow(/hasn't signed off/);

      // Four more bags when only two are left to order: it goes with a reason.
      const extra = await buyer.orders.create(actor, w.workspaceId, { id: randomUUID(), vendorId: vendor, lines: [{ source: "material", materialItemId: cement.sourceId, quantity: "4", unitPrice: "20" }] });
      expect(extra.overOrdered).toEqual([expect.objectContaining({ description: "Cement", over: "2" })]);
      await expect(buyer.orders.command(actor, w.workspaceId, extra.order.id, { action: "submit", version: extra.order.version })).rejects.toThrow(/2 bags more than needed/);
      const placed = await buyer.orders.command(actor, w.workspaceId, extra.order.id, { action: "submit", version: extra.order.version, overReason: "Wastage on site" });
      expect(placed.order).toMatchObject({ status: "approved", overReason: "Wastage on site" });
      expect((await buyer.orders.needs(actor, w.workspaceId)).needs.find((need) => need.title === "Cement")!.remaining).toBe("-2.0000");
      // An ordered material stays on the list and keeps its unit.
      await expect(core.command(actor, w.workspaceId, projectId, { action: "delete_material", itemId: cement.sourceId, version: (await core.get(actor, w.workspaceId, projectId)).project.version }))
        .rejects.toThrow(/is on FAC-PO/);
      await expect(core.command(actor, w.workspaceId, projectId, { action: "save_material", id: cement.sourceId, name: "Cement", quantity: "5", unit: "kg", version: (await core.get(actor, w.workspaceId, projectId)).project.version }))
        .rejects.toThrow(/keep that unit/);
    });
  });

  it("keeps purchasing exact after problems: edits after a reversal, every inspection pass notified, credits with tax adding up, and orders that can't cancel or close wrongly", async () => {
    await world(async (w) => {
      const { core, projectId, vendor, buyer, manager } = await buying(w);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "3", unit: "sheets", clientChoice: false, version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Brass handles", quantity: "10", unit: "nos", clientChoice: false, version: detail.project.version });
      const needs = (await buyer.orders.needs(actor, w.workspaceId)).needs;
      const oak = needs.find((need) => need.title === "Oak veneer")!, handles = needs.find((need) => need.title === "Brass handles")!;

      // 3 sheets for 100.00 net (33.3333 each) and 5% tax: three separate credits add up to the line exactly.
      let order = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: oak.sourceId, quantity: "3", unitPrice: "33.3333" }]);
      expect(order.lines[0]).toMatchObject({ net: "100.0000", tax: "5.0000" });
      const oakReceipt = await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: "warehouse", receivedOn: "2026-09-26", lines: [{ orderLineId: order.lines[0].id, received: "3" }] });
      await expect(manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: "warehouse", receivedOn: "2099-01-01", lines: [] })).rejects.toThrow();
      const credits: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const back = await buyer.returns.create(actor, w.workspaceId, { id: randomUUID(), receiptId: oakReceipt.receipt.id, outcome: "credit",
          lines: [{ receiptLineId: oakReceipt.lines[0].id, source: "accepted", quantity: "1", reasonKind: "defective", reason: "Delaminating" }] });
        credits.push(...back.lines.map((line) => `${line.creditAmount}+${line.creditTax}`));
      }
      expect(credits).toEqual(["33.3300+1.6700", "33.3400+1.6600", "33.3300+1.6700"]);
      await expect(buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "cancel", reason: "x", version: (await buyer.orders.get(actor, w.workspaceId, order.order.id)).order.version }))
        .rejects.toThrow(/only be closed/);

      // Handles: a delivery reversed, then the order is changed without trouble.
      order = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: handles.sourceId, quantity: "10", unitPrice: "12" }]);
      const wrong = await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: "warehouse", receivedOn: "2026-09-26", lines: [{ orderLineId: order.lines[0].id, received: "10" }] });
      await manager.receiving.reverse(actor, w.workspaceId, wrong.receipt.id, { reason: "Belongs to another order" });
      let changing = await buyer.orders.get(actor, w.workspaceId, order.order.id);
      expect(changing.order.status).toBe("sent");
      changing = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "change", reason: "Price agreed lower", version: changing.order.version });
      changing = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "save", version: changing.order.version,
        lines: changing.lines.map((line) => ({ id: line.id, source: line.source, materialItemId: line.materialItemId, quantity: line.quantity, unitPrice: "11", discountPercent: "0", taxRate: line.taxRate })) });
      expect(changing.lines.map((line) => [line.id, line.unitPrice])).toEqual([[order.lines[0].id, "11.0000"]]);
      // A line with a delivery against it stays on the order.
      await expect(buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "save", version: changing.order.version,
        lines: [{ source: "free", description: "Something else", quantity: "1", unitPrice: "5" }] })).rejects.toThrow(/stays on the order/);
      // A retried command returns the order as it is instead of failing on its version.
      const commandId = randomUUID();
      const submitted = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "submit", version: changing.order.version, commandId });
      expect((await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "submit", version: changing.order.version, commandId })).order.version).toBe(submitted.order.version);

      // With inspection on, each pass that rejects something tells the buyer.
      await w.client.query(`UPDATE workspace_purchasing_settings SET require_inspection = true WHERE workspace_id = $1`, [w.workspaceId]);
      await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "send", version: submitted.order.version });
      const both = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "free", projectId, description: "Hinges", quantity: "4", unit: "pairs", unitPrice: "8" },
        { source: "free", projectId, description: "Drawer runners", quantity: "4", unit: "pairs", unitPrice: "15" }]);
      const receipt = await buyer.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: both.order.id, place: "warehouse", receivedOn: "2026-09-27",
        lines: both.lines.map((line) => ({ orderLineId: line.id, received: "4" })) });
      for (const line of receipt.lines)
        await manager.receiving.inspect(actor, w.workspaceId, receipt.receipt.id, { lines: [{ id: line.id, rejected: "1", rejectKind: "damaged", rejectReason: `${line.description} bent` }] });
      const rejected = (await w.client.query(`SELECT count(*)::int AS count FROM notifications WHERE workspace_id = $1 AND event_type = 'purchasing.rejected' AND recipient_id = $2 AND channel = 'in_app'`,
        [w.workspaceId, w.designer])).rows[0].count;
      expect(rejected).toBe(2);

      // Closing short sends what never came back to To order.
      const partly = await buyer.orders.get(actor, w.workspaceId, both.order.id);
      const closed = await buyer.orders.command(actor, w.workspaceId, both.order.id, { action: "close", reason: "Supplier stopped the range", version: partly.order.version });
      expect(closed.order.status).toBe("closed");
      expect(closed.lines.map((line) => [line.accepted, line.quantity])).toEqual([["3.0000", "4.0000"], ["3.0000", "4.0000"]]);
    });
  });

  it("guards stock and plans: take-backs only of what was issued, a count replayed changes nothing, expired prices can't be awarded, and subtasks follow their parent", async () => {
    await world(async (w) => {
      const { projectId, vendor, buyer, access, all } = await buying(w);
      let stock = await buyer.stock.command(actor, w.workspaceId, { id: randomUUID(), action: "add", name: "Wood glue", unit: "nos", locationId: await (async () => {
        const yard = randomUUID(); await buyer.stock.saveLocation(actor, w.workspaceId, { id: yard, kind: "warehouse", name: "Main store" }); return yard; })(), quantity: "10", reason: "Opening stock" });
      const glue = stock.rows[0];
      const change = (input: Record<string, unknown>) => buyer.stock.command(actor, w.workspaceId, { id: randomUUID(), itemId: glue.itemId, locationId: glue.locationId, ...input });
      await change({ action: "issue", forProjectId: projectId, quantity: "3" });
      await expect(change({ action: "return", forProjectId: projectId, quantity: "4", reason: "Unused" })).rejects.toThrow(/Only 3 was issued/);
      await expect(change({ action: "return", forProjectId: projectId, quantity: "2" })).rejects.toThrow(/coming back/);
      stock = await change({ action: "return", forProjectId: projectId, quantity: "2", reason: "Unused" });
      expect(stock.rows.map((row) => row.onHand)).toEqual(["9.0000"]);
      const count = { id: randomUUID(), action: "count", itemId: glue.itemId, locationId: glue.locationId, counted: "9" };
      await buyer.stock.command(actor, w.workspaceId, count);
      await change({ action: "issue", forProjectId: projectId, quantity: "1" });
      stock = await buyer.stock.command(actor, w.workspaceId, count);
      expect(stock.rows.map((row) => row.onHand)).toEqual(["8.0000"]);

      // Prices past their validity can't be awarded.
      let detail = await (w.as(w.manager)).get(actor, w.workspaceId, projectId);
      detail = await w.as(w.manager).command(actor, w.workspaceId, projectId, { action: "save_material", name: "Brass", quantity: "2", unit: "kg", clientChoice: false, version: detail.project.version });
      const brass = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((need) => need.title === "Brass")!;
      const requests = new PriceRequestsService(access(w.designer, all), buyer.orders);
      const requestId = randomUUID();
      let request = await requests.create(actor, w.workspaceId, { id: requestId, vendorIds: [vendor], lines: [{ source: "material", materialItemId: brass.sourceId, quantity: "2" }] });
      request = await requests.command(actor, w.workspaceId, requestId, { action: "record_reply", version: request.request.version, vendorId: vendor, validUntil: "2020-01-31",
        prices: [{ lineId: request.lines[0].id, unitPrice: "40" }] });
      await expect(requests.command(actor, w.workspaceId, requestId, { action: "award", version: request.request.version, awards: [{ lineId: request.lines[0].id, vendorId: vendor }] }))
        .rejects.toThrow(/valid until 2020-01-31/);

      // A finished task takes no new subtasks, and a subtask reopens only under an open parent.
      const lead = w.work(w.manager);
      const task = randomUUID(), sub = randomUUID();
      let state = await lead.command(actor, w.workspaceId, projectId, { action: "create", id: task, title: "Site survey" });
      state = await lead.command(actor, w.workspaceId, projectId, { action: "create", id: sub, parentId: task, title: "Measure kitchen" });
      state = await lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: task, version: state.items.find((item) => item.id === task)!.version, status: "cancelled" });
      await expect(lead.command(actor, w.workspaceId, projectId, { action: "create", id: randomUUID(), parentId: task, title: "Late addition" })).rejects.toThrow(/reopen it to add subtasks/);
      await expect(lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: sub, version: state.items.find((item) => item.id === sub)!.version, status: "todo" }))
        .rejects.toThrow(/reopen it first/);
    });
  });

  it("applies a replacing variation only when its total still adds up and its payment is verified, and notices a tampered seal", async () => {
    await world(async (w) => {
      await accept(w);
      const manager = w.as(w.manager);
      const { projectId } = await manager.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const worktop = (await manager.scope(actor, w.workspaceId, projectId)).lines.find((line) => line.title === "Worktop")!;
      const variationId = randomUUID();
      await w.client.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency,baseline_id)
        VALUES($1,$2,$3,1,2,'variation','main','draft','Worktop change','AED',$4)`, [w.workspaceId, w.caseId, variationId, w.quoteId]);
      // Replace the whole worktop: 2.25 m² credited at 800, the replacement priced at 1,000.
      let state = await w.builder.apply(actor, w.workspaceId, w.caseId, variationId, { ops: [{ op: "change", change: "replace", id: "r1", boqLineId: worktop.id, replacementId: "r2" }] });
      const replacement = state.lines.find((line) => line.id === "r2")!;
      state = await w.builder.apply(actor, w.workspaceId, w.caseId, variationId, { ops: [{ op: "upsert", line: { id: "r2", version: replacement.version, rate: "1000" } }] });
      expect(state.pricing.total).toBe("450.00");
      const decide = async (acceptedTotal: number, paid: boolean) => {
        const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
        const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
        const variation = data.quotes.find((quote) => quote.id === variationId)!;
        variation.status = "accepted"; variation.hash = freezeHash(variation);
        variation.clientDecision = { decision: "accept", quoteHash: variation.hash, selectedOptionLineIds: [], baseTotal: acceptedTotal, optionsTotal: 0, acceptedTotal,
          decidedAt: "2026-10-05T10:00:00.000Z", decidedBy: "Maya Client", method: "email", recordedBy: "Omar Manager" };
        data.payments = [...data.payments.filter((payment) => payment.id !== "vp"), { id: "vp", sourceQuoteId: variationId, title: "Variation advance", amount: acceptedTotal, dueDate: "",
          requiredForRelease: true, requiredForProduction: false, status: paid ? "verified" : "pending", proof: paid ? "transfer" : "", reference: paid ? "TT-9" : "", evidenceKind: "operational" }];
        data.revision = loaded.revision + 1;
        await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
      };
      const settings = (await manager.settings(actor, w.workspaceId)).settings;
      await manager.saveSettings(actor, w.workspaceId, { version: settings.version, requireVariationPayment: true });
      const apply = async () => manager.command(actor, w.workspaceId, projectId, { action: "apply_variation", quoteId: variationId, version: (await manager.get(actor, w.workspaceId, projectId)).project.version });
      await decide(450, false);
      await expect(apply()).rejects.toThrow(/payment before the work starts isn't verified/);
      await decide(500, true);
      await expect(apply()).rejects.toThrow(/no longer add up/);
      await decide(450, true);
      await apply();
      const after = await manager.scope(actor, w.workspaceId, projectId);
      expect(after.lines.find((line) => line.id === worktop.id)).toMatchObject({ status: "omitted", quantity: "0.0000" });
      expect(after.lines.filter((line) => line.origin === "VO-1").map((line) => [line.title, line.quantity, line.net])).toEqual([["Worktop (replacement)", "2.2500", "2250.0000"]]);
      expect((await manager.line(actor, w.workspaceId, projectId, worktop.id)).history.at(-1)).toMatchObject({ kind: "omitted", detail: { variation: "VO-1" } });

      // A sealed document changed behind the system's back says so.
      const seal = after.seals.find((item) => item.revisionLabel === "VO-1")!;
      expect((await manager.seal(actor, w.workspaceId, projectId, seal.id)).intact).toBe(true);
      await w.client.query("SAVEPOINT tamper");
      await w.client.query("SET LOCAL session_replication_role = replica");
      await w.client.query(`UPDATE project_scope_seals SET snapshot = jsonb_set(snapshot, '{revisionLabel}', '"VO-9"') WHERE id = $1`, [seal.id]);
      await w.client.query("SET LOCAL session_replication_role = origin");
      expect((await manager.seal(actor, w.workspaceId, projectId, seal.id)).intact).toBe(false);
      await w.client.query("ROLLBACK TO SAVEPOINT tamper");
    });
  });

  it("keeps the project manager named, goes back a stage with a reason, and completes the project when the last stage finishes; a planning record on hold can't start", async () => {
    await world(async (w) => {
      await accept(w);
      const manager = w.as(w.manager);
      await w.client.query("UPDATE pre_project_cases SET status = 'on_hold', held_at = now(), held_by = $2, hold_reason = 'Client travelling' WHERE id = $1", [w.caseId, w.manager]);
      await expect(manager.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership })).rejects.toThrow(/on hold or closed/);
      await w.client.query("UPDATE pre_project_cases SET status = 'active', held_at = NULL, held_by = NULL, hold_reason = NULL WHERE id = $1", [w.caseId]);
      const { projectId } = await manager.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      let detail = await manager.get(actor, w.workspaceId, projectId);
      await expect(manager.command(actor, w.workspaceId, projectId, { action: "set_member", role: "project_manager", membershipId: null, version: detail.project.version }))
        .rejects.toThrow(/always has a project manager/);
      // Everything before handover is done; handover is current.
      await w.client.query("UPDATE project_stages SET status = 'done', completed_at = now(), completed_by = $2 WHERE project_id = $1 AND key <> 'handover'", [projectId, w.manager]);
      await w.client.query("UPDATE project_stages SET status = 'current', started_at = now() WHERE project_id = $1 AND key = 'handover'", [projectId]);
      detail = await manager.get(actor, w.workspaceId, projectId);
      await expect(manager.command(actor, w.workspaceId, projectId, { action: "reopen_stage", version: detail.project.version })).rejects.toThrow(/Say why/);
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "reopen_stage", reason: "Two snags reopened by the client", version: detail.project.version });
      expect(detail.stages.filter((stage) => stage.status === "current").map((stage) => stage.key)).toEqual(["snagging"]);
      const snagging = detail.stages.find((stage) => stage.key === "snagging")!;
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "confirm_check", stageId: snagging.id, checkKey: "closed", version: detail.project.version });
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: snagging.id, version: detail.project.version });
      const handover = detail.stages.find((stage) => stage.key === "handover")!;
      expect(handover.status).toBe("current");
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "confirm_check", stageId: handover.id, checkKey: "accepted", version: detail.project.version });
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: handover.id, version: detail.project.version });
      expect(detail.project.status).toBe("completed");
      await expect(manager.command(actor, w.workspaceId, projectId, { action: "post_update", health: "on_track", note: "x", version: detail.project.version })).rejects.toThrow(/The project is closed/);
    });
  });

  it("covers the remaining purchasing rules: catalog prices by default, approved suppliers only, unique tax numbers, rejections at receipt, cancelled returns, and bought services never stocked", async () => {
    await world(async (w) => {
      const { core, projectId, company, vendor, buyer, access, all } = await buying(w);
      // A second supplier, not approved, with a tax number; a third can't reuse it.
      const pending = randomUUID();
      await buyer.suppliers.save(actor, w.workspaceId, { id: pending, version: 0, name: "Lilac Stone", entityIds: [company], taxRegistrationNumber: "TRN-100" });
      await expect(buyer.suppliers.save(actor, w.workspaceId, { id: randomUUID(), version: 0, name: "Lilac Stone Trading", entityIds: [company], taxRegistrationNumber: " trn-100 " }))
        .rejects.toThrow(/Another supplier has this tax number/);

      // The slab comes from the catalog, where Nile's price is 340: an order line without a price takes it.
      const catalog = randomUUID(), slabItem = randomUUID();
      await w.client.query("INSERT INTO catalogs(id,workspace_id,code,name) VALUES($1,$2,'core','Core')", [catalog, w.workspaceId]);
      await w.client.query("INSERT INTO catalog_units(workspace_id,code,label,kind,to_base) VALUES($1,'sqm','m²','area',1) ON CONFLICT DO NOTHING", [w.workspaceId]);
      await w.client.query("INSERT INTO catalog_items(id,workspace_id,catalog_id,code,name,item_type,unit_code) VALUES($1,$2,$3,'CAL','Calacatta slab','material','sqm')", [slabItem, w.workspaceId, catalog]);
      await w.client.query("INSERT INTO catalog_supplier_links(id,workspace_id,item_id,vendor_id,cost,currency,preferred) VALUES($1,$2,$3,$4,340,'AED',true)", [randomUUID(), w.workspaceId, slabItem, vendor]);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Calacatta slab", quantity: "6", unit: "m²", clientChoice: false, version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", name: "Electrical", supply: "subcontract", version: detail.project.version });
      const scope = await core.scope(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "assign_lines", lineIds: [scope.lines.find((line) => line.title === "Under-cabinet lights")!.id],
        packageId: scope.packages.find((item) => item.name === "Electrical")!.id, version: detail.project.version });
      const slab = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((need) => need.title === "Calacatta slab")!;
      await w.client.query("UPDATE project_material_items SET catalog_item_id = $2 WHERE id = $1", [slab.sourceId, slabItem]);
      const electrical = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((need) => need.title === "Under-cabinet lights")!;
      expect(electrical.supply).toBe("subcontract");
      let order = await buyer.orders.create(actor, w.workspaceId, { id: randomUUID(), vendorId: vendor, lines: [{ source: "material", materialItemId: slab.sourceId, quantity: "6" },
        { source: "line", boqLineId: electrical.sourceId, quantity: "1", unitPrice: "650" }] });
      expect(order.lines.map((line) => [line.description, line.unitPrice])).toEqual([["Calacatta slab", "340.0000"], ["Under-cabinet lights", "650.0000"]]);
      order = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "submit", version: order.order.version });
      order = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "send", version: order.order.version });

      // Inspection is off: rejections are entered at receipt, and say what was wrong.
      const receiveInput = { orderId: order.order.id, place: "warehouse", receivedOn: "2026-09-27", lines: [{ orderLineId: order.lines[0].id, received: "6", rejected: "1", rejectReason: "Chipped" },
        { orderLineId: order.lines[1].id, received: "1" }] };
      await expect(buyer.receiving.receive(actor, w.workspaceId, { id: randomUUID(), ...receiveInput })).rejects.toThrow(/what was wrong/);
      const receipt = await buyer.receiving.receive(actor, w.workspaceId, { id: randomUUID(), ...receiveInput,
        lines: [{ ...receiveInput.lines[0], rejectKind: "damaged" }, receiveInput.lines[1]] });
      expect(receipt.receipt).toMatchObject({ accepted: "6.0000", rejected: "1.0000", pending: "0.0000" });
      // Subcontracted work arrives but isn't stock; the slab is.
      const stock = await buyer.stock.stock(actor, w.workspaceId);
      expect(stock.rows.map((row) => [row.itemName, row.unit, row.catalogItemId, row.onHand])).toEqual([["Calacatta slab", "m²", slabItem, "5.0000"]]);

      // A return raised by mistake is cancelled with a reason, and the chipped m² is owed again.
      const email = new SupplierReturnsService(access(w.designer, all));
      const back = await email.create(actor, w.workspaceId, { id: randomUUID(), receiptId: receipt.receipt.id, outcome: "credit", send: true, to: "orders@nile.example",
        lines: [{ receiptLineId: receipt.lines[0].id, source: "rejected", quantity: "1" }] });
      expect(back).toMatchObject({ delivery: "not_configured", return: { status: "open" } });
      expect((await buyer.orders.get(actor, w.workspaceId, order.order.id)).lines[0].credited).toBe("1.0000");
      await expect(email.command(actor, w.workspaceId, back.return.id, { action: "cancel", version: back.return.version })).rejects.toThrow(/Say why/);
      const cancelled = await email.command(actor, w.workspaceId, back.return.id, { action: "cancel", reason: "They'll replace it after all", version: back.return.version });
      expect(cancelled.return).toMatchObject({ status: "cancelled", cancelReason: "They'll replace it after all" });
      expect((await buyer.orders.get(actor, w.workspaceId, order.order.id)).lines[0].credited).toBe("0.0000");
      expect((await buyer.receiving.receiving(actor, w.workspaceId, order.order.id)).lines.map((line) => line.outstanding)).toEqual(["1", "0"]);

      // Only approved suppliers win a price request.
      const requests = new PriceRequestsService(access(w.designer, all), buyer.orders);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Travertine", quantity: "4", unit: "m²", clientChoice: false, version: (await core.get(actor, w.workspaceId, projectId)).project.version });
      const travertine = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((need) => need.title === "Travertine")!;
      let request = await requests.create(actor, w.workspaceId, { id: randomUUID(), vendorIds: [pending], lines: [{ source: "material", materialItemId: travertine.sourceId, quantity: "4" }] });
      request = await requests.command(actor, w.workspaceId, request.request.id, { action: "record_reply", version: request.request.version, vendorId: pending, prices: [{ lineId: request.lines[0].id, unitPrice: "90" }] });
      await expect(requests.command(actor, w.workspaceId, request.request.id, { action: "award", version: request.request.version, awards: [{ lineId: request.lines[0].id, vendorId: pending }] }))
        .rejects.toThrow(/isn't approved as a supplier yet/);
    });
  });

  it("validates roles and routes in settings", async () => {
    await world(async (w) => {
      const service = w.as(w.manager);
      const { settings, templates } = await service.settings(actor, w.workspaceId);
      expect(templates).toHaveLength(1);
      await expect(service.saveSettings(actor, w.workspaceId, { version: settings.version, roles: [{ key: "designer", label: "Designer" }] })).rejects.toThrow(/Keep the project manager/);
      await expect(service.saveTemplate(actor, w.workspaceId, { name: "Furniture only", stages: [{ name: "Order", ownerRole: "buyer", checks: [] }, { name: "Deliver", checks: [] }] })).rejects.toThrow(/choose an owner/);
      const saved = await service.saveTemplate(actor, w.workspaceId, { name: "Furniture only", stages: [{ name: "Order", ownerRole: "procurement", checks: [{ kind: "confirm", label: "Ordered" }] }, { name: "Deliver", checks: [] }] });
      expect(saved.templates.map((template) => template.name)).toEqual(["Standard", "Furniture only"]);
      await expect(service.saveSettings(actor, w.workspaceId, { version: settings.version, roles: settings.roles.filter((role) => role.key !== "procurement") })).rejects.toThrow(/still uses a role/);
    });
  });
});
