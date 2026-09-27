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
import { processPurchasingDeadlines } from "../purchasing/purchasing-reminders";
import { ConfigService } from "@nestjs/config";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { SupplierControlsService, processSupplierDocuments } from "../purchasing/supplier-controls.service";
import { InventoryService } from "../inventory/inventory.service";
import { SuppliersService } from "../purchasing/suppliers.service";
import { FactoryService } from "../factory/factory.service";
import { processFactoryDeadlines } from "../factory/factory-reminders";
import { tellScopeChanges } from "../factory/factory-changes";
import { SiteService } from "../site/site.service";
import { HandoverService } from "../site/handover.service";
import { WarrantyService } from "../site/warranty.service";
import { processWarrantyExpiry } from "../site/site-reminders";
import { processSiteReports } from "../site/site-reminders";

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

  /** The client accepted a whole-project handover pack (issued and decided). */
  async function acceptHandover(w: World, projectId: string) {
    await w.client.query(
      `INSERT INTO handover_packs (id, workspace_id, project_id, revision, title, status, snapshot, content_hash, issued_by, issued_at, decided_on, decided_by_name, decision_method, recorded_by, created_by)
       VALUES ($1, $2, $3, 1, 'Handover', 'accepted', '{}'::jsonb, repeat('a', 64), $4, now(), '2026-09-26', 'Maya Client', 'signed_document', $4, $4)`, [randomUUID(), w.workspaceId, projectId, w.manager]);
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
      // Nothing is made in the factory on this project, so that check passes by itself.
      expect(production.checks.find((check) => check.kind === "everything_made")?.passed).toBe(true);
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
      // No snag is open, so "All snags closed" passes by itself.
      expect(snagging.checks.find((check) => check.kind === "snags_closed")?.passed).toBe(true);
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: snagging.id, version: detail.project.version });
      const handover = detail.stages.find((stage) => stage.key === "handover")!;
      expect(handover.status).toBe("current");
      await acceptHandover(w, projectId);
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

  it("follows an order through: per-line confirmation, late orders chased and reminded weekly, the rest of a line cancelled and reordered elsewhere, and pack sizes", async () => {
    await world(async (w) => {
      const { core, projectId, company, vendor, buyer, manager } = await buying(w);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Calacatta slab", quantity: "10", unit: "m²", clientChoice: false, version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Brass handles", quantity: "10", unit: "nos", clientChoice: false, version: detail.project.version });
      const needs = (await buyer.orders.needs(actor, w.workspaceId)).needs;
      const slabNeed = needs.find((need) => need.title === "Calacatta slab")!, handleNeed = needs.find((need) => need.title === "Brass handles")!;
      // Nile sells handles in packs of 4, at least 8.
      const catalog = randomUUID(), handleItem = randomUUID();
      await w.client.query("INSERT INTO catalogs(id,workspace_id,code,name) VALUES($1,$2,'core','Core')", [catalog, w.workspaceId]);
      await w.client.query("INSERT INTO catalog_units(workspace_id,code,label,kind,to_base) VALUES($1,'nos','nos','count',1) ON CONFLICT DO NOTHING", [w.workspaceId]);
      await w.client.query("INSERT INTO catalog_items(id,workspace_id,catalog_id,code,name,item_type,unit_code) VALUES($1,$2,$3,'BH','Brass handles','material','nos')", [handleItem, w.workspaceId, catalog]);
      await w.client.query("INSERT INTO catalog_supplier_links(id,workspace_id,item_id,vendor_id,cost,currency,preferred,pack_size,minimum_order) VALUES($1,$2,$3,$4,12,'AED',true,4,8)", [randomUUID(), w.workspaceId, handleItem, vendor]);
      await w.client.query("UPDATE project_material_items SET catalog_item_id = $2 WHERE id = $1", [handleNeed.sourceId, handleItem]);

      const orderId = randomUUID();
      let state = await buyer.orders.create(actor, w.workspaceId, { id: orderId, vendorId: vendor, expectedDate: "2026-09-15", lines: [
        { source: "material", materialItemId: slabNeed.sourceId, quantity: "10", unitPrice: "350" }, { source: "material", materialItemId: handleNeed.sourceId, quantity: "10" }] });
      const [slab, handles] = state.lines;
      expect(state.packs).toEqual([{ lineId: handles.id, packSize: "4", minimum: "8", suggested: "12" }]);
      state = await buyer.orders.command(actor, w.workspaceId, orderId, { action: "submit", version: state.order.version });
      state = await buyer.orders.command(actor, w.workspaceId, orderId, { action: "send", version: state.order.version });

      // The supplier confirms 8 m² of slab for the 20th and the handles for the end of October.
      state = await buyer.orders.command(actor, w.workspaceId, orderId, { action: "confirm", supplierReference: "SO-77", version: state.order.version, lines: [
        { lineId: slab.id, promisedDate: "2026-09-20", confirmedQuantity: "8" }, { lineId: handles.id, promisedDate: "2026-10-30" }] });
      expect(state.order).toMatchObject({ status: "confirmed", promisedDate: "2026-09-20", supplierReference: "SO-77" });
      expect(state.lines.map((line) => [line.promisedDate, line.confirmedQuantity, line.due])).toEqual([["2026-09-20", "8.0000", "2026-09-20"], ["2026-10-30", null, "2026-10-30"]]);
      await expect(buyer.orders.command(actor, w.workspaceId, orderId, { action: "confirm", version: state.order.version, lines: [{ lineId: slab.id, confirmedQuantity: "11" }] }))
        .rejects.toThrow(/can't confirm more/);
      expect((await buyer.receiving.deliveries(actor, w.workspaceId)).expected.map((order) => [order.number, order.due])).toEqual([[state.order.number, "2026-09-20"]]);

      // The slab is late: the buyer hears once a week, in the app and by email.
      expect((await processPurchasingDeadlines(w.client, w.workspaceId)).sent).toBe(1);
      expect((await processPurchasingDeadlines(w.client, w.workspaceId)).sent).toBe(0);
      const late = (await w.client.query<{ channel: string }>(`SELECT channel FROM notifications WHERE workspace_id = $1 AND event_type = 'purchasing.late' AND recipient_id = $2 ORDER BY channel`,
        [w.workspaceId, w.designer])).rows.map((row) => row.channel);
      expect(late).toEqual(["email", "in_app"]);
      // Chased: the late slab moves to its new date; the handles keep theirs; nothing is late any more.
      await expect(buyer.orders.command(actor, w.workspaceId, orderId, { action: "chase", version: state.order.version })).rejects.toThrow(/what the supplier said/);
      state = await buyer.orders.command(actor, w.workspaceId, orderId, { action: "chase", note: "Container held at port", promisedDate: "2026-10-05", version: state.order.version });
      expect(state.lines.map((line) => line.due)).toEqual(["2026-10-05", "2026-10-30"]);
      expect(state.events.at(-1)).toMatchObject({ kind: "chased", detail: { note: "Container held at port", promisedDate: "2026-10-05" } });
      expect((await processPurchasingDeadlines(w.client, w.workspaceId)).sent).toBe(0);

      // The two m² the supplier can't make are cancelled and ordered from another supplier, linked to this line.
      const other = randomUUID();
      const saved = await buyer.suppliers.save(actor, w.workspaceId, { id: other, version: 0, name: "Siom Marble", entityIds: [company] });
      await manager.suppliers.approve(actor, w.workspaceId, other, { version: saved.suppliers.find((item) => item.id === other)!.version, approval: "approved" });
      await expect(buyer.orders.command(actor, w.workspaceId, orderId, { action: "cancel_line", lineId: slab.id, quantity: "11", reason: "x", version: state.order.version })).rejects.toThrow(/At most 10 m²/);
      await expect(buyer.orders.command(actor, w.workspaceId, orderId, { action: "cancel_line", lineId: slab.id, quantity: "2", version: state.order.version })).rejects.toThrow(/Say why/);
      const cancelled = await buyer.orders.command(actor, w.workspaceId, orderId, { action: "cancel_line", lineId: slab.id, quantity: "2", reason: "Only 8 m² in this block",
        reorderVendorId: other, version: state.order.version });
      expect(cancelled.lines[0]).toMatchObject({ cancelled: "2.0000", cancelReason: "Only 8 m² in this block" });
      const replacement = await buyer.orders.get(actor, w.workspaceId, cancelled.reordered!);
      expect(replacement.order).toMatchObject({ status: "draft", supplierName: "Siom Marble" });
      expect(replacement.lines.map((line) => [line.description, line.quantity, line.replacesLineId, line.replacesOrderNumber])).toEqual([["Calacatta slab", "2.0000", slab.id, state.order.number]]);
      const slabNow = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((need) => need.title === "Calacatta slab")!;
      expect([slabNow.placed, slabNow.drafted, slabNow.remaining]).toEqual(["8.0000", "2.0000", "0.0000"]);

      // What's left arrives: 8 m² and the handles. The order is complete.
      const receipt = await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId, place: "warehouse", receivedOn: "2026-09-27",
        lines: [{ orderLineId: slab.id, received: "8" }, { orderLineId: handles.id, received: "10" }] });
      expect(receipt.receipt.accepted).toBe("18.0000");
      const done = await buyer.orders.get(actor, w.workspaceId, orderId);
      expect(done.order.status).toBe("received");
      // Nothing left to cancel; closing isn't short (8 accepted + 2 cancelled make the slab line).
      await expect(buyer.orders.command(actor, w.workspaceId, orderId, { action: "cancel_line", lineId: handles.id, reason: "x", version: done.order.version })).rejects.toThrow(/can only be closed now/);
      const closed = await buyer.orders.command(actor, w.workspaceId, orderId, { action: "close", version: done.order.version });
      expect(closed.order).toMatchObject({ status: "closed", closeReason: null });
    });
  });

  it("proves site deliveries with photos and who handed them over, and holds goods that came without an order until they're matched or sent back", async () => {
    await world(async (w) => {
      const { core, projectId, vendor, buyer, access, all } = await buying(w);
      const storage = new BrandAssetStorageService(new ConfigService({ BRAND_ASSET_STORAGE_DIR: await mkdtemp(join(tmpdir(), "wodana-photos-")) }));
      const keeper = new ReceivingService(access(w.designer, ["purchasing.view", "stock.receive"]), storage);
      const office = new ReceivingService(access(w.manager, all), storage);
      const photo = { buffer: await sharp({ create: { width: 8, height: 8, channels: 3, background: "#8a8a8a" } }).png().toBuffer(), originalname: "delivery.png", mimetype: "image/png", size: 0 };
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Calacatta slab", quantity: "12", unit: "m²", clientChoice: false, version: detail.project.version });
      const slabNeed = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((need) => need.title === "Calacatta slab")!;
      const order = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: slabNeed.sourceId, quantity: "12", unitPrice: "350" }]);

      // At site, a delivery without a photo shows it; the photo proves it.
      let receipt = await keeper.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: `site:${projectId}`, receivedOn: "2026-09-27", handedOverBy: "Ravi, Nile's driver",
        lines: [{ orderLineId: order.lines[0].id, received: "10" }] });
      expect(receipt).toMatchObject({ needsPhoto: true, receipt: { handedOverBy: "Ravi, Nile's driver", photos: 0 } });
      const photoId = randomUUID();
      receipt = await keeper.uploadPhoto(actor, w.workspaceId, { kind: "receipt", id: receipt.receipt.id }, photoId, photo) as typeof receipt;
      receipt = await keeper.uploadPhoto(actor, w.workspaceId, { kind: "receipt", id: receipt.receipt.id }, photoId, photo) as typeof receipt;
      expect(receipt).toMatchObject({ needsPhoto: false, receipt: { photos: 1 } });
      expect(receipt.photos.map((item) => [item.name, item.byName])).toEqual([["delivery.png", "Dana Designer"]]);
      expect((await office.photo(actor, w.workspaceId, photoId, true)).contentType).toBe("image/webp");
      await expect(keeper.uploadPhoto(actor, w.workspaceId, { kind: "receipt", id: receipt.receipt.id }, randomUUID(), { ...photo, buffer: Buffer.from("%PDF-1.4 not a photo") }))
        .rejects.toThrow();

      // Two m² arrive with no order in sight: held apart, not in stock, until the buyer matches them.
      const stray = randomUUID();
      await expect(keeper.recordUnmatched(actor, w.workspaceId, { id: randomUUID(), place: "warehouse", receivedOn: "2026-09-27", lines: [{ description: "Slab", quantity: "2" }] }))
        .rejects.toThrow(/who delivered/);
      let held = await keeper.recordUnmatched(actor, w.workspaceId, { id: stray, vendorId: vendor, place: "warehouse", receivedOn: "2026-09-27", deliveryNote: "DN-4410",
        lines: [{ description: "Calacatta 20mm slab", quantity: "2", unit: "m²" }] });
      held = await keeper.uploadPhoto(actor, w.workspaceId, { kind: "unmatched", id: stray }, randomUUID(), photo) as typeof held;
      expect(held.delivery).toMatchObject({ number: 1, status: "open", supplierName: "Nile Marble", photos: 1 });
      expect(held.candidates).toEqual([]);
      expect((await keeper.deliveries(actor, w.workspaceId)).unmatched.map((item) => item.number)).toEqual([1]);
      const stockBefore = (await buyer.stock.stock(actor, w.workspaceId)).rows.map((row) => row.onHand);
      await expect(keeper.resolveUnmatched(actor, w.workspaceId, stray, { action: "match", orderId: order.order.id, lines: [] })).rejects.toThrow(/A buyer matches/);
      held = await office.unmatched(actor, w.workspaceId, stray);
      expect(held.candidates.map((candidate) => [candidate.number, candidate.lines.map((line) => [line.description, line.outstanding])])).toEqual([[order.order.number, [["Calacatta slab", "2"]]]]);
      held = await office.resolveUnmatched(actor, w.workspaceId, stray, { action: "match", orderId: order.order.id, note: "Second truck for the Villa 12 order",
        lines: [{ unmatchedLineId: held.lines[0].id, orderLineId: order.lines[0].id }] });
      expect(held.delivery).toMatchObject({ status: "matched", receiptNumber: 2, resolvedByName: "Omar Manager", photos: 0 });
      const matched = await office.receipt(actor, w.workspaceId, held.delivery.receiptId!);
      expect(matched.receipt).toMatchObject({ receivedByName: "Dana Designer", locationKind: "warehouse", deliveryNote: "DN-4410", accepted: "2.0000", photos: 1 });
      expect((await buyer.orders.get(actor, w.workspaceId, order.order.id)).order.status).toBe("received");
      expect((await buyer.stock.stock(actor, w.workspaceId)).rows.map((row) => row.onHand).sort()).toEqual([...stockBefore, "2.0000"].sort());

      // Goods nobody ordered go back.
      const unknown = randomUUID();
      await keeper.recordUnmatched(actor, w.workspaceId, { id: unknown, supplierName: "A van from Sharjah", place: "warehouse", receivedOn: "2026-09-27", lines: [{ description: "Tiles", quantity: "40", unit: "boxes" }] });
      await expect(keeper.resolveUnmatched(actor, w.workspaceId, unknown, { action: "return" })).rejects.toThrow(/why the goods went back/);
      const back = await keeper.resolveUnmatched(actor, w.workspaceId, unknown, { action: "return", note: "Not ours; the driver took them back" });
      expect(back.delivery).toMatchObject({ status: "returned", resolutionNote: "Not ours; the driver took them back" });
    });
  });

  it("handles a supplier's alternative: decided by someone else, never dearer, through the client for what they choose; nothing received until decided", async () => {
    await world(async (w) => {
      const { core, projectId, vendor, buyer, manager } = await buying(w);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "3", unit: "sheets", clientChoice: false, version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Calacatta slab", specification: "Polished", quantity: "4", unit: "m²", version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "send_materials", version: detail.project.version });
      const materials = await core.materials(actor, w.workspaceId, projectId);
      const slabItem = materials.items.find((item) => item.name === "Calacatta slab")!;
      detail = await core.command(actor, w.workspaceId, projectId, { action: "record_materials_decision", decidedBy: "Maya", method: "email",
        decisions: [{ itemId: slabItem.id, decision: "approved" }], version: detail.project.version });
      const needs = (await buyer.orders.needs(actor, w.workspaceId)).needs;
      const oak = needs.find((need) => need.title === "Oak veneer")!, slab = needs.find((need) => need.title === "Calacatta slab")!;
      const order = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: oak.sourceId, quantity: "3", unitPrice: "100" },
        { source: "material", materialItemId: slab.sourceId, quantity: "4", unitPrice: "350" }]);
      const [oakLine, slabLine] = order.lines;
      let state = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "offer_alternate", lineId: oakLine.id, description: "Walnut veneer",
        specification: "Crown cut", unitPrice: "90", note: "Oak is out until December", version: order.order.version });
      expect(state.lines[0]).toMatchObject({ alternateStatus: "offered", alternateDescription: "Walnut veneer", alternateUnitPrice: "90.0000" });
      await expect(manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: "warehouse", receivedOn: "2026-09-27",
        lines: [{ orderLineId: oakLine.id, received: "3" }] })).rejects.toThrow(/Decide on the supplier's alternative for Oak veneer/);
      await expect(buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "decide_alternate", lineId: oakLine.id, decision: "accept", version: state.order.version }))
        .rejects.toThrow(/Someone else decides/);
      state = await manager.orders.command(actor, w.workspaceId, order.order.id, { action: "decide_alternate", lineId: oakLine.id, decision: "accept", version: state.order.version });
      expect(state.lines[0]).toMatchObject({ description: "Walnut veneer", specification: "Crown cut", originalDescription: "Oak veneer", unitPrice: "90.0000", net: "270.0000", alternateStatus: "accepted" });
      // (270 + 1,400) net and 5% tax.
      expect(state.order.total).toBe("1753.5000");

      // The slab is the client's choice: a honed finish needs their sign-off first, and a dearer one a changed order.
      state = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "offer_alternate", lineId: slabLine.id, description: "Calacatta slab", specification: "Honed",
        unitPrice: "380", note: "Polished finish discontinued", version: state.order.version });
      await expect(manager.orders.command(actor, w.workspaceId, order.order.id, { action: "decide_alternate", lineId: slabLine.id, decision: "accept", version: state.order.version }))
        .rejects.toThrow(/The client chooses Calacatta slab/);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", id: slabItem.id, name: "Calacatta slab", specification: "Honed", quantity: "4", unit: "m²",
        version: (await core.get(actor, w.workspaceId, projectId)).project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "send_materials", version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "record_materials_decision", decidedBy: "Maya", method: "email",
        decisions: [{ itemId: slabItem.id, decision: "approved" }], version: detail.project.version });
      await expect(manager.orders.command(actor, w.workspaceId, order.order.id, { action: "decide_alternate", lineId: slabLine.id, decision: "accept", version: state.order.version }))
        .rejects.toThrow(/costs more/);
      await expect(manager.orders.command(actor, w.workspaceId, order.order.id, { action: "decide_alternate", lineId: slabLine.id, decision: "reject", version: state.order.version }))
        .rejects.toThrow(/Say why/);
      state = await manager.orders.command(actor, w.workspaceId, order.order.id, { action: "decide_alternate", lineId: slabLine.id, decision: "reject", note: "Keep polished; find stock",
        version: state.order.version });
      expect(state.lines[1]).toMatchObject({ alternateStatus: "rejected", specification: "Polished", unitPrice: "350.0000" });
      const receipt = await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: "warehouse", receivedOn: "2026-09-27",
        lines: [{ orderLineId: oakLine.id, received: "3" }] });
      expect(receipt.lines[0]).toMatchObject({ description: "Walnut veneer", accepted: "3.0000" });
    });
  });

  it("keeps stock in the catalog's unit when bought in another: boxes in, pieces kept, and returns come out the same way", async () => {
    await world(async (w) => {
      const { core, projectId, vendor, buyer, manager } = await buying(w);
      const catalog = randomUUID(), hinge = randomUUID();
      await w.client.query("INSERT INTO catalogs(id,workspace_id,code,name) VALUES($1,$2,'core','Core')", [catalog, w.workspaceId]);
      await w.client.query("INSERT INTO catalog_units(workspace_id,code,label,kind,to_base) VALUES($1,'box','box','count',1) ON CONFLICT DO NOTHING", [w.workspaceId]);
      await w.client.query("INSERT INTO catalog_items(id,workspace_id,catalog_id,code,name,item_type,unit_code) VALUES($1,$2,$3,'HG','Soft-close hinge','material','pcs')", [hinge, w.workspaceId, catalog]);
      await w.client.query("INSERT INTO catalog_item_conversions(workspace_id,item_id,from_unit,to_unit,factor) VALUES($1,$2,'box','pcs',10)", [w.workspaceId, hinge]);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Soft-close hinge", quantity: "3", unit: "box", clientChoice: false, version: detail.project.version });
      const need = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((item) => item.title === "Soft-close hinge")!;
      await w.client.query("UPDATE project_material_items SET catalog_item_id = $2 WHERE id = $1", [need.sourceId, hinge]);
      const order = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: need.sourceId, quantity: "3", unitPrice: "50", taxRate: "0" }]);
      const receipt = await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: "warehouse", receivedOn: "2026-09-27",
        lines: [{ orderLineId: order.lines[0].id, received: "3" }] });
      let stock = await buyer.stock.stock(actor, w.workspaceId);
      expect(stock.rows.map((row) => [row.itemName, row.unit, row.catalogItemId, row.onHand])).toEqual([["Soft-close hinge", "pcs", hinge, "30.0000"]]);
      expect((await w.client.query(`SELECT unit_cost::text AS cost FROM stock_movements WHERE workspace_id = $1 AND kind = 'receive'`, [w.workspaceId])).rows).toEqual([{ cost: "5.0000" }]);
      const back = await buyer.returns.create(actor, w.workspaceId, { id: randomUUID(), receiptId: receipt.receipt.id, outcome: "credit",
        lines: [{ receiptLineId: receipt.lines[0].id, source: "accepted", quantity: "1", reasonKind: "defective", reason: "Box of broken springs" }] });
      await buyer.returns.command(actor, w.workspaceId, back.return.id, { action: "sent", version: back.return.version });
      stock = await buyer.stock.stock(actor, w.workspaceId);
      expect(stock.rows.map((row) => row.onHand)).toEqual(["20.0000"]);
    });
  });

  it("splits an award across suppliers, one draft order each, and keeps one project's stock off another project's site", async () => {
    await world(async (w) => {
      const { core, projectId, company, vendor, buyer, manager, access, all } = await buying(w);
      const other = randomUUID();
      const saved = await buyer.suppliers.save(actor, w.workspaceId, { id: other, version: 0, name: "Siom Marble", entityIds: [company] });
      await manager.suppliers.approve(actor, w.workspaceId, other, { version: saved.suppliers.find((item) => item.id === other)!.version, approval: "approved" });
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Calacatta slab", quantity: "4", unit: "m²", clientChoice: false, version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Travertine", quantity: "6", unit: "m²", clientChoice: false, version: detail.project.version });
      const needs = (await buyer.orders.needs(actor, w.workspaceId)).needs;
      const requests = new PriceRequestsService(access(w.designer, all), buyer.orders);
      const requestId = randomUUID();
      let request = await requests.create(actor, w.workspaceId, { id: requestId, vendorIds: [vendor, other],
        lines: needs.filter((need) => need.source === "material").map((need) => ({ source: "material", materialItemId: need.sourceId, quantity: need.required })) });
      const [slabLine, travertineLine] = request.lines;
      request = await requests.command(actor, w.workspaceId, requestId, { action: "record_reply", version: request.request.version, vendorId: vendor,
        prices: [{ lineId: slabLine.id, unitPrice: "300" }, { lineId: travertineLine.id, unitPrice: "120" }] });
      request = await requests.command(actor, w.workspaceId, requestId, { action: "record_reply", version: request.request.version, vendorId: other,
        prices: [{ lineId: slabLine.id, unitPrice: "320" }, { lineId: travertineLine.id, unitPrice: "95" }] });
      expect([request.cheapest[slabLine.id], request.cheapest[travertineLine.id]]).toEqual([vendor, other]);
      request = await requests.command(actor, w.workspaceId, requestId, { action: "award", version: request.request.version,
        awards: [{ lineId: slabLine.id, vendorId: vendor }, { lineId: travertineLine.id, vendorId: other }] });
      expect(request.orders.map((order) => order.vendorId).sort()).toEqual([vendor, other].sort());
      const drafts = [];
      for (const created of request.orders) drafts.push(await buyer.orders.get(actor, w.workspaceId, created.id));
      expect(drafts.map((draft) => [draft.order.supplierName, draft.lines.map((line) => [line.description, line.unitPrice])]).sort()).toEqual([
        ["Nile Marble", [["Calacatta slab", "300.0000"]]], ["Siom Marble", [["Travertine", "95.0000"]]]]);

      // A second project's site: the first project's stock can't be moved there.
      const second = randomUUID();
      await w.client.query("SAVEPOINT second");
      await w.client.query("SET LOCAL session_replication_role = replica");
      await w.client.query(`INSERT INTO delivery_projects (id, workspace_id, case_id, name, status, created_by, reference, currency, started_at, started_by, quote_id)
        SELECT $2, workspace_id, $3, 'Marina flat', 'active', created_by, 'PRJ-9999', currency, started_at, started_by, quote_id FROM delivery_projects WHERE id = $1`, [projectId, second, randomUUID()]);
      await w.client.query("SET LOCAL session_replication_role = origin");
      const siteB = randomUUID();
      await w.client.query("INSERT INTO stock_locations (id, workspace_id, kind, name, project_id) VALUES ($1, $2, 'site', 'Marina flat site', $3)", [siteB, w.workspaceId, second]);
      const store = randomUUID();
      await buyer.stock.saveLocation(actor, w.workspaceId, { id: store, kind: "warehouse", name: "Main store" });
      const stock = await buyer.stock.command(actor, w.workspaceId, { id: randomUUID(), action: "add", name: "Grout", unit: "bags", locationId: store, projectId, quantity: "5", reason: "Opening stock" });
      const grout = stock.rows[0];
      await expect(buyer.stock.send(actor, w.workspaceId, { id: randomUUID(), fromLocationId: store, toLocationId: siteB, lines: [{ itemId: grout.itemId, projectId, quantity: "2" }] }))
        .rejects.toThrow(/can't go to another project's site/);
      await w.client.query("ROLLBACK TO SAVEPOINT second");
    });
  });

  it("controls suppliers: an expired required document holds them and their open orders wait for a decision; bank details need a call-back and a second person; duplicates are refused; a scorecard from the records", async () => {
    await world(async (w) => {
      const { core, projectId, company, vendor, buyer, manager, access, all } = await buying(w);
      const storage = new BrandAssetStorageService(new ConfigService({ BRAND_ASSET_STORAGE_DIR: await mkdtemp(join(tmpdir(), "wodana-docs-")) }));
      const clerk = new SupplierControlsService(access(w.designer, all), storage);
      const approver = new SupplierControlsService(access(w.manager, all), storage);
      const viewer = new SupplierControlsService(access(w.manager, ["vendors.view"]), storage);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Calacatta slab", quantity: "4", unit: "m²", clientChoice: false, version: detail.project.version });
      const need = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((item) => item.title === "Calacatta slab")!;
      let order = await buyer.orders.create(actor, w.workspaceId, { id: randomUUID(), vendorId: vendor, lines: [{ source: "material", materialItemId: need.sourceId, quantity: "4", unitPrice: "350" }] });
      order = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "submit", version: order.order.version });

      // The trade licence ran out at the start of the month; the tax certificate runs out soon.
      const licence = randomUUID();
      await expect(clerk.addDocument(actor, w.workspaceId, vendor, { id: randomUUID(), kind: "trade_licence", required: true })).rejects.toThrow(/needs its expiry date/);
      await clerk.addDocument(actor, w.workspaceId, vendor, { id: licence, kind: "trade_licence", number: "DED-4411", expiresOn: "2026-09-01", required: true });
      let supplier = await clerk.addDocument(actor, w.workspaceId, vendor, { id: randomUUID(), kind: "tax_certificate", number: "TRN-9", expiresOn: "2026-10-10" });
      supplier = await clerk.uploadDocumentFile(actor, w.workspaceId, vendor, licence, { buffer: Buffer.from("%PDF-1.4\n%fake licence\n"), originalname: "licence.pdf", mimetype: "application/pdf", size: 0 });
      expect(supplier.documents.map((document) => [document.kind, document.expiresOn, document.required, document.hasFile])).toEqual([
        ["tax_certificate", "2026-10-10", false, false], ["trade_licence", "2026-09-01", true, true]]);
      expect((await processSupplierDocuments(w.client, w.workspaceId)).held).toBe(1);
      supplier = await clerk.detail(actor, w.workspaceId, vendor);
      expect(supplier.supplier).toMatchObject({ approval: "on_hold", approvalNote: "Its trade licence expired on 2026-09-01." });
      expect(supplier.openOrders.map((item) => item.number)).toEqual([order.order.number]);

      // The approved order waits: it can't go to the supplier until someone who approves orders says it continues.
      expect((await buyer.orders.get(actor, w.workspaceId, order.order.id)).supplierHold).toMatchObject({ approval: "on_hold" });
      await expect(buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "send", version: order.order.version })).rejects.toThrow(/Nile Marble is on hold/);
      await expect(manager.orders.command(actor, w.workspaceId, order.order.id, { action: "continue_on_hold", version: order.order.version })).rejects.toThrow(/Say why/);
      order = await manager.orders.command(actor, w.workspaceId, order.order.id, { action: "continue_on_hold", note: "Renewal is filed; material is already cut", version: order.order.version });
      expect(order.order).toMatchObject({ continuedNote: "Renewal is filed; material is already cut", continuedByName: "Omar Manager" });
      order = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "send", version: order.order.version });
      const receipt = await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: "warehouse", receivedOn: "2026-09-27",
        lines: [{ orderLineId: order.lines[0].id, received: "4", rejected: "1", rejectKind: "damaged", rejectReason: "Chipped" }] });
      expect(receipt.receipt.accepted).toBe("3.0000");
      // The renewed licence replaces the old one; the old stays as history.
      supplier = await clerk.addDocument(actor, w.workspaceId, vendor, { id: randomUUID(), kind: "trade_licence", number: "DED-4411", expiresOn: "2027-09-01", required: true });
      expect(supplier.documents.filter((document) => !document.replacedAt).map((document) => [document.kind, document.expiresOn])).toEqual([["tax_certificate", "2026-10-10"], ["trade_licence", "2027-09-01"]]);

      // New bank details by email: a call-back by someone else, then someone else approves; the whole number only for them.
      const account = randomUUID();
      supplier = await clerk.requestBankAccount(actor, w.workspaceId, vendor, { id: account, accountName: "Nile Marble LLC", bankName: "Emirates NBD", accountNumber: "AE07 0331 2345 6789 0123 456", source: "email" });
      await expect(clerk.requestBankAccount(actor, w.workspaceId, vendor, { id: randomUUID(), accountName: "Nile", bankName: "ADCB", accountNumber: "1234", source: "email" })).rejects.toThrow(/still waiting/);
      await expect(clerk.bankAccountCommand(actor, w.workspaceId, vendor, account, { action: "callback", note: "Called Mohamed" })).rejects.toThrow(/Someone else checks/);
      await expect(approver.bankAccountCommand(actor, w.workspaceId, vendor, account, { action: "approve" })).rejects.toThrow(/Call the supplier/);
      await approver.bankAccountCommand(actor, w.workspaceId, vendor, account, { action: "callback", note: "Called Mohamed on +971 50 317 5797 from the 2024 contract" });
      supplier = await approver.bankAccountCommand(actor, w.workspaceId, vendor, account, { action: "approve" });
      expect(supplier.bankAccounts[0]).toMatchObject({ status: "approved", accountNumber: "AE07 0331 2345 6789 0123 456", decidedByName: "Omar Manager" });
      expect((await viewer.detail(actor, w.workspaceId, vendor)).bankAccounts[0].accountNumber).toBe("•••• 3456");

      // One phone number, one supplier.
      await buyer.suppliers.save(actor, w.workspaceId, { id: vendor, version: (await buyer.suppliers.list(actor, w.workspaceId)).suppliers.find((item) => item.id === vendor)!.version,
        name: "Nile Marble", entityIds: [company], phone: "+971 50 317 5797" });
      await expect(buyer.suppliers.save(actor, w.workspaceId, { id: randomUUID(), version: 0, name: "Nile Marble Trading", phone: "+971-50-317-5797" })).rejects.toThrow(/Another supplier has this phone number/);

      // The scorecard reads what happened.
      const card = (await clerk.detail(actor, w.workspaceId, vendor)).scorecard;
      expect(card).toMatchObject({ orders: [{ currency: "AED", orders: 1 }], received: "4.0000", rejected: "1.0000", rejectPercent: "25", returns: 0 });
    });
  });

  it("prices orders from a valid rate contract: its price by default, its pack terms, flagged when a line costs more, and not once it's cancelled or expired", async () => {
    await world(async (w) => {
      const { core, projectId, vendor, buyer, access, all } = await buying(w);
      const controls = new SupplierControlsService(access(w.designer, all));
      const catalog = randomUUID(), glue = randomUUID();
      await w.client.query("INSERT INTO catalogs(id,workspace_id,code,name) VALUES($1,$2,'core','Core')", [catalog, w.workspaceId]);
      await w.client.query("INSERT INTO catalog_items(id,workspace_id,catalog_id,code,name,item_type,unit_code) VALUES($1,$2,$3,'GL','Wood glue','material','pcs')", [glue, w.workspaceId, catalog]);
      await w.client.query("INSERT INTO catalog_supplier_links(id,workspace_id,item_id,vendor_id,cost,currency,preferred) VALUES($1,$2,$3,$4,30,'AED',true)", [randomUUID(), w.workspaceId, glue, vendor]);
      const contractId = randomUUID();
      await expect(controls.saveContract(actor, w.workspaceId, vendor, { id: randomUUID(), reference: "RC-1", currency: "AED", validFrom: "2026-10-01", validTo: "2026-01-01",
        lines: [{ catalogItemId: glue, unitPrice: "25" }] })).rejects.toThrow(/ends after it starts/);
      let supplier = await controls.saveContract(actor, w.workspaceId, vendor, { id: contractId, reference: "RC-2026", currency: "AED", validFrom: "2026-01-01", validTo: "2026-12-31",
        lines: [{ catalogItemId: glue, unitPrice: "25", packSize: "6" }] });
      expect(supplier.contracts.map((contract) => [contract.reference, contract.state, contract.lines.map((line) => [line.itemName, line.unitPrice])])).toEqual([["RC-2026", "valid", [["Wood glue", "25.0000"]]]]);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Wood glue", quantity: "10", unit: "pcs", clientChoice: false, version: detail.project.version });
      const need = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((item) => item.title === "Wood glue")!;
      await w.client.query("UPDATE project_material_items SET catalog_item_id = $2 WHERE id = $1", [need.sourceId, glue]);
      let order = await buyer.orders.create(actor, w.workspaceId, { id: randomUUID(), vendorId: vendor, lines: [{ source: "material", materialItemId: need.sourceId, quantity: "10" }] });
      expect(order.lines[0].unitPrice).toBe("25.0000");
      expect(order.contracts).toEqual([{ lineId: order.lines[0].id, reference: "RC-2026", unitPrice: "25.0000", above: false }]);
      expect(order.packs).toEqual([{ lineId: order.lines[0].id, packSize: "6", minimum: null, suggested: "12" }]);
      order = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "save", version: order.order.version,
        lines: order.lines.map((line) => ({ id: line.id, source: line.source, materialItemId: line.materialItemId, quantity: "12", unitPrice: "28" })) });
      expect(order.contracts[0]).toMatchObject({ above: true });
      // Cancelled, the contract no longer prices anything: the catalog price does.
      await expect(controls.cancelContract(actor, w.workspaceId, vendor, contractId, {})).rejects.toThrow(/Say why/);
      supplier = await controls.cancelContract(actor, w.workspaceId, vendor, contractId, { reason: "Renegotiated for 2027" });
      expect(supplier.contracts[0]).toMatchObject({ state: "cancelled", cancelReason: "Renegotiated for 2027" });
      const next = await buyer.orders.create(actor, w.workspaceId, { id: randomUUID(), vendorId: vendor, lines: [{ source: "material", materialItemId: need.sourceId, quantity: "1" }] });
      expect([next.lines[0].unitPrice, next.contracts]).toEqual(["30.0000", []]);
    });
  });

  it("values stock at moving average cost in the workspace's currency: deliveries converted at the day's rate, moves carrying their cost, and big corrections approved by someone else", async () => {
    await world(async (w) => {
      const { core, projectId, company, vendor, buyer, manager, access, all } = await buying(w);
      const counter = new InventoryService(access(w.designer, all));
      const checker = new InventoryService(access(w.manager, all));
      await w.client.query(`INSERT INTO exchange_rates (id, workspace_id, base_currency, quote_currency, rate, effective_at, source, is_manual, created_by) VALUES ($1, $2, 'EUR', 'AED', 4, '2026-09-01', 'manual', true, $3)`,
        [randomUUID(), w.workspaceId, w.manager]);
      await w.client.query("UPDATE workspace_purchasing_settings SET stock_adjust_approval_value = 100 WHERE workspace_id = $1", [w.workspaceId]);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "20", unit: "sheets", clientChoice: false, version: detail.project.version });
      const need = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((item) => item.title === "Oak veneer")!;
      // An Italian supplier invoices in euros: 10 sheets at 25 EUR = 100 AED each at a rate of 4.
      const euro = randomUUID();
      const saved = await buyer.suppliers.save(actor, w.workspaceId, { id: euro, version: 0, name: "Legno Srl", entityIds: [company], currency: "EUR" });
      await manager.suppliers.approve(actor, w.workspaceId, euro, { version: saved.suppliers.find((item) => item.id === euro)!.version, approval: "approved" });
      const first = await placeOrder(buyer.orders, w.workspaceId, euro, [{ source: "material", materialItemId: need.sourceId, quantity: "10", unitPrice: "25", taxRate: "0" }]);
      await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: first.order.id, place: "warehouse", receivedOn: "2026-09-26", lines: [{ orderLineId: first.lines[0].id, received: "10" }] });
      // Ten more locally at 130 AED: the average is 115.
      const second = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: need.sourceId, quantity: "10", unitPrice: "130", taxRate: "0" }]);
      await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: second.order.id, place: "warehouse", receivedOn: "2026-09-27", lines: [{ orderLineId: second.lines[0].id, received: "10" }] });
      let stock = await counter.stock(actor, w.workspaceId);
      const oak = stock.rows[0];
      expect([oak.onHand, oak.value, oak.averageCost, oak.currency]).toEqual(["20.0000", "2300.0000", "115.0000", "AED"]);

      // Moved to another store: the cost goes with it.
      const store = randomUUID();
      await counter.saveLocation(actor, w.workspaceId, { id: store, kind: "warehouse", name: "Al Quoz store" });
      const move = randomUUID();
      const moveState = await counter.send(actor, w.workspaceId, { id: move, fromLocationId: oak.locationId, toLocationId: store, lines: [{ itemId: oak.itemId, projectId, quantity: "4" }] });
      await counter.transferCommand(actor, w.workspaceId, move, { action: "receive", lines: [{ id: moveState.lines[0].id, received: "4" }] });
      stock = await counter.stock(actor, w.workspaceId);
      expect(stock.rows.map((row) => [row.locationName, row.onHand, row.value])).toEqual([["Al Quoz store", "4.0000", "460.0000"], ["Warehouse", "16.0000", "1840.0000"]]);

      // A count 2 short is worth 230, over the 100 limit: it waits for someone else.
      stock = await counter.command(actor, w.workspaceId, { id: randomUUID(), action: "count", itemId: oak.itemId, locationId: oak.locationId, projectId, counted: "14", reason: "Two sheets water-damaged" });
      expect(stock.rows.find((row) => row.locationName === "Warehouse")!.onHand).toBe("16.0000");
      expect(stock.pendingAdjustments.map((request) => [request.difference, request.value])).toEqual([["-2.0000", "230.0000"]]);
      const requestId = stock.pendingAdjustments[0].id;
      await expect(counter.decideAdjustment(actor, w.workspaceId, requestId, { action: "approve" })).rejects.toThrow(/Someone else approves/);
      await expect(checker.decideAdjustment(actor, w.workspaceId, requestId, { action: "reject" })).rejects.toThrow(/Say why/);
      stock = await checker.decideAdjustment(actor, w.workspaceId, requestId, { action: "approve" });
      expect(stock.rows.find((row) => row.locationName === "Warehouse")).toMatchObject({ onHand: "14.0000", value: "1610.0000" });
      expect(stock.pendingAdjustments).toEqual([]);
      // A small count difference applies straight away.
      stock = await counter.command(actor, w.workspaceId, { id: randomUUID(), action: "count", itemId: oak.itemId, locationId: store, projectId, counted: "3.5", reason: "Half a sheet offcut" });
      expect(stock.rows.find((row) => row.locationName === "Al Quoz store")).toMatchObject({ onHand: "3.5000", value: "402.5000" });
    });
  });

  it("measures progress from finished tasks, packages weighed by their value, and finds the critical path on the workspace's calendar", async () => {
    await world(async (w) => {
      await accept(w);
      const manager = w.as(w.manager);
      const { projectId } = await manager.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const scope = await manager.scope(actor, w.workspaceId, projectId);
      const [kitchen, general] = scope.packages; // 5,400 + 1,800 in the kitchen; 650 for the lights
      const lead = w.work(w.manager);
      const [a, b, c, d, e, sub1, sub2] = Array.from({ length: 7 }, () => randomUUID());
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: a, title: "Measure", packageId: kitchen.id });
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: b, title: "Shop drawings", packageId: kitchen.id, startDate: "2026-10-05", dueDate: "2026-10-07" });
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: c, title: "Produce", packageId: kitchen.id, startDate: "2026-10-08", dueDate: "2026-10-09" });
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: d, title: "Old idea", packageId: kitchen.id });
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: e, title: "Order lights", packageId: general.id, startDate: "2026-10-05", dueDate: "2026-10-05" });
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: sub1, parentId: b, title: "Elevations" });
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: sub2, parentId: b, title: "Sections" });
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: randomUUID(), type: "blocker", title: "Marble thickness", packageId: kitchen.id });
      await lead.command(actor, w.workspaceId, projectId, { action: "link", itemId: c, predecessorId: b, kind: "fs", lagDays: 0 });
      let board = await lead.board(actor, w.workspaceId, projectId);
      const version = (id: string) => board.items.find((item) => item.id === id)!.version;
      board = await lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: a, version: version(a), status: "done" });
      board = await lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: sub1, version: version(sub1), status: "done" });
      board = await lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: d, version: version(d), status: "cancelled" });

      // Kitchen: measure done (1), drawings half through their subtasks (½), production not started (0) → 50 %.
      // The lights have no tasks done: 0 %. The project weighs the kitchen's 7,200 of 7,850 → 45 %.
      expect(board.progress).toEqual({ project: 45, packages: { [kitchen.id]: 50, [general.id]: 0 } });
      expect((await manager.get(actor, w.workspaceId, projectId)).progress).toBe(45);
      // Drawings then production run to the plan's finish on Friday the 9th; ordering the lights can slip four working days.
      expect(board.critical).toEqual({ finish: "2026-10-09", float: { [b]: 0, [c]: 0, [e]: 4 } });
    });
  });

  it("dates what projects need from the plan: needed when the work that uses it starts, ordered its lead time before, and chased when that's passed", async () => {
    await world(async (w) => {
      const { core, projectId, vendor, buyer } = await buying(w);
      const scope = await core.scope(actor, w.workspaceId, projectId);
      const [kitchen] = scope.packages;
      const cabinets = scope.lines.find((line) => line.title === "Kitchen cabinets")!;
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "20", unit: "sheets", clientChoice: false, boqLineIds: [cabinets.id], version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Wood glue", quantity: "4", unit: "nos", clientChoice: false, version: detail.project.version });
      // Fitting the kitchen needs its materials from 5 Oct; a later fit from the 26th; drawings don't need them.
      const lead = w.work(w.manager);
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: randomUUID(), title: "Shop drawings", packageId: kitchen.id, startDate: "2026-09-29", dueDate: "2026-10-02" });
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: randomUUID(), title: "Fit on site", packageId: kitchen.id, startDate: "2026-10-05", dueDate: "2026-10-09", needsMaterials: true });
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: randomUUID(), title: "Second fix", packageId: kitchen.id, startDate: "2026-10-26", dueDate: "2026-10-27", needsMaterials: true });

      let needs = (await buyer.orders.needs(actor, w.workspaceId)).needs;
      const dates = (title: string) => { const need = needs.find((item) => item.title === title)!; return [need.neededBy, need.leadDays, need.orderBy]; };
      // No supplier lead time known: the workspace's 14 days.
      expect(dates("Oak veneer")).toEqual(["2026-10-05", 14, "2026-09-21"]);
      expect(dates("Kitchen cabinets")).toEqual(["2026-10-05", 14, "2026-09-21"]);
      // Glue isn't tied to any scope line: the project's earliest need.
      expect(dates("Wood glue")).toEqual(["2026-10-05", 14, "2026-09-21"]);
      await w.client.query("UPDATE workspace_purchasing_settings SET order_ahead_days = 3 WHERE workspace_id = $1", [w.workspaceId]);
      needs = (await buyer.orders.needs(actor, w.workspaceId)).needs;
      expect(dates("Oak veneer")).toEqual(["2026-10-05", 3, "2026-10-02"]);

      // Past its order-by date and not ordered: the people who buy are told, once per project and then weekly.
      await w.client.query("UPDATE workspace_purchasing_settings SET order_ahead_days = 30 WHERE workspace_id = $1", [w.workspaceId]);
      const role = randomUUID();
      await w.client.query("INSERT INTO roles (id, workspace_id, code, name) VALUES ($1, $2, 'buyer', 'Buyer')", [role, w.workspaceId]);
      await w.client.query("INSERT INTO role_permissions (workspace_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE code = 'purchasing.manage'", [w.workspaceId, role]);
      await w.client.query("INSERT INTO member_roles (workspace_id, membership_id, role_id) VALUES ($1, $2, $3)", [w.workspaceId, w.designerMembership, role]);
      expect((await processPurchasingDeadlines(w.client, w.workspaceId)).sent).toBe(1);
      expect((await processPurchasingDeadlines(w.client, w.workspaceId)).sent).toBe(0);
      const told = (await w.client.query<{ recipient: string; subject: string; body: string }>(
        "SELECT recipient_id AS recipient, subject, body FROM notifications WHERE workspace_id = $1 AND event_type = 'purchasing.order_late' AND channel = 'in_app'", [w.workspaceId])).rows;
      expect(told).toEqual([{ recipient: w.designer, subject: "Order now for PRJ-0001 · Villa 12", body: expect.stringMatching(/^Oak veneer 20 sheets \(needed .*\), .*Wood glue 4 nos/) }]);

      // Ordered: the order line knows when it's needed, and nothing is chased any more for it.
      const oak = needs.find((item) => item.title === "Oak veneer")!;
      const order = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: oak.sourceId, quantity: "20", unitPrice: "100", taxRate: "0" }]);
      expect(Object.values(order.neededBy)).toEqual(["2026-10-05"]);
      // Once the fitting is done, the next piece of work that needs them sets the date.
      const board = await lead.board(actor, w.workspaceId, projectId);
      const fit = board.items.find((item) => item.title === "Fit on site")!;
      await lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: fit.id, version: fit.version, status: "done" });
      expect((await buyer.orders.needs(actor, w.workspaceId)).needs.find((item) => item.title === "Wood glue")!.neededBy).toBe("2026-10-26");
    });
  });

  it("counts free stock given to a project before orders, and tells the work that needs the materials what isn't in yet", async () => {
    await world(async (w) => {
      const { core, projectId, vendor, buyer, manager } = await buying(w);
      const scope = await core.scope(actor, w.workspaceId, projectId);
      const [kitchen] = scope.packages;
      const cabinets = scope.lines.find((line) => line.title === "Kitchen cabinets")!;
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "20", unit: "sheets", clientChoice: false, boqLineIds: [cabinets.id], version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Wood glue", quantity: "4", unit: "nos", clientChoice: false, boqLineIds: [cabinets.id], version: detail.project.version });
      const lead = w.work(w.manager);
      const fit = randomUUID();
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: fit, title: "Fit on site", packageId: kitchen.id, startDate: "2026-10-05", dueDate: "2026-10-09", needsMaterials: true });
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: randomUUID(), title: "Measure", packageId: kitchen.id });

      // Twelve sheets and all the glue are in free stock: eight sheets reserved, the glue issued straight to the project, one tube brought back.
      const store = buyer.stock;
      let stock = await store.stock(actor, w.workspaceId);
      await store.saveLocation(actor, w.workspaceId, { id: randomUUID(), kind: "warehouse", name: "Warehouse" });
      stock = await store.stock(actor, w.workspaceId);
      const warehouse = stock.locations[0].id;
      stock = await store.command(actor, w.workspaceId, { id: randomUUID(), action: "add", name: "Oak veneer", unit: "sheets", locationId: warehouse, quantity: "12", reason: "Opening stock" });
      stock = await store.command(actor, w.workspaceId, { id: randomUUID(), action: "add", name: "Wood glue", unit: "nos", locationId: warehouse, quantity: "10", reason: "Opening stock" });
      const oakItem = stock.rows.find((row) => row.itemName === "Oak veneer")!.itemId;
      const glueItem = stock.rows.find((row) => row.itemName === "Wood glue")!.itemId;
      await store.command(actor, w.workspaceId, { id: randomUUID(), action: "allocate", itemId: oakItem, locationId: warehouse, forProjectId: projectId, quantity: "8", reason: "Kitchen" });
      await store.command(actor, w.workspaceId, { id: randomUUID(), action: "issue", itemId: glueItem, locationId: warehouse, forProjectId: projectId, quantity: "5", reason: "Kitchen" });
      await store.command(actor, w.workspaceId, { id: randomUUID(), action: "return", itemId: glueItem, locationId: warehouse, forProjectId: projectId, quantity: "1", reason: "One too many" });

      let needs = (await buyer.orders.needs(actor, w.workspaceId)).needs;
      const left = (title: string) => { const need = needs.find((item) => item.title === title)!; return [need.fromStock, need.remaining]; };
      expect(left("Oak veneer")).toEqual(["8", "12.0000"]);
      expect(left("Wood glue")).toEqual(["4", "0.0000"]);
      let board = await lead.board(actor, w.workspaceId, projectId);
      // The glue is all there; the oak, and the kitchen's bought cabinets and worktop, aren't.
      expect(board.materials).toEqual({ [fit]: ["Oak veneer", "Kitchen cabinets", "Worktop"] });

      // The rest of the oak arrives on an order with the cabinets and worktop: the fitting has what it needs.
      const oak = needs.find((item) => item.title === "Oak veneer")!;
      const worktop = scope.lines.find((line) => line.title === "Worktop")!;
      const order = await placeOrder(buyer.orders, w.workspaceId, vendor, [
        { source: "material", materialItemId: oak.sourceId, quantity: "12", unitPrice: "100", taxRate: "0" },
        { source: "line", boqLineId: cabinets.id, quantity: "4.5", unitPrice: "900", taxRate: "0" },
        { source: "line", boqLineId: worktop.id, quantity: "2.25", unitPrice: "600", taxRate: "0" }]);
      await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: "warehouse", receivedOn: "2026-09-27",
        lines: order.lines.map((line) => ({ orderLineId: line.id, received: line.quantity })) });
      needs = (await buyer.orders.needs(actor, w.workspaceId)).needs;
      expect(left("Oak veneer")).toEqual(["8", "0.0000"]);
      board = await lead.board(actor, w.workspaceId, projectId);
      expect(board.materials).toEqual({});
    });
  });

  it("makes scope lines in the factory: split work orders, release checks, output approved by someone else, quality checks into stock, and closing short", async () => {
    await world(async (w) => {
      const { core, projectId, access, all } = await buying(w);
      const factoryRights = [...all, "factory.view", "factory.manage", "factory.report", "factory.approve"];
      const maker = factoryAs(access, w.designer, factoryRights);
      const checker = factoryAs(access, w.manager, ["factory.view", "factory.approve"]);
      const scope = await core.scope(actor, w.workspaceId, projectId);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", id: scope.packages[0].id, name: "Kitchen joinery", supply: "make", version: detail.project.version });
      const joinery = randomUUID();
      await maker.saveWorkcenter(actor, w.workspaceId, { id: joinery, name: "Joinery", hoursPerDay: "8" });
      await expect(maker.saveWorkcenter(actor, w.workspaceId, { id: randomUUID(), name: "joinery" })).rejects.toThrow(/already a workcenter called/);

      let state = await maker.state(actor, w.workspaceId);
      const cabinets = state.toMake.find((line) => line.title === "Kitchen cabinets")!;
      expect([cabinets.quantity, cabinets.planned, cabinets.left, cabinets.unit]).toEqual(["4.5000", "0", "4.5000", "m"]);
      // 3 now and 1.5 later; nothing past the line.
      const first = randomUUID(), second = randomUUID();
      let order = await maker.plan(actor, w.workspaceId, { id: first, lineId: cabinets.lineId, quantity: "3" });
      expect(await maker.plan(actor, w.workspaceId, { id: first, lineId: cabinets.lineId, quantity: "3" })).toMatchObject({ order: { id: first } });
      await expect(maker.plan(actor, w.workspaceId, { id: second, lineId: cabinets.lineId, quantity: "2" })).rejects.toThrow("Only 1.5 m of Kitchen cabinets is left to plan.");
      await maker.plan(actor, w.workspaceId, { id: second, lineId: cabinets.lineId, quantity: "1.5" });
      expect((await maker.state(actor, w.workspaceId)).toMake.find((line) => line.title === "Kitchen cabinets")!.left).toBe("0.0000");

      // Released only when its checks pass.
      expect(order.releaseChecks.filter((check) => !check.passed).map((check) => check.key)).toEqual(["drawing", "payment", "schedule"]);
      await expect(maker.command(actor, w.workspaceId, first, { action: "release", version: order.order.version }))
        .rejects.toThrow("Before it's released: the drawing isn't approved; the payment before production isn't verified; it has no workcenter or dates.");
      order = await maker.command(actor, w.workspaceId, first, { action: "approve_drawing", reference: "K-01 rev B", version: order.order.version });
      order = await maker.command(actor, w.workspaceId, first, { action: "update", workcenterId: joinery, plannedStart: "2026-10-05", plannedEnd: "2026-10-16", version: order.order.version });
      const settings = await maker.settings(actor, w.workspaceId);
      await maker.saveSettings(actor, w.workspaceId, { version: settings.settings.version, requirePayment: false });
      order = await maker.command(actor, w.workspaceId, first, { action: "release", version: order.order.version });
      await expect(maker.command(actor, w.workspaceId, first, { action: "report", id: randomUUID(), good: "1" })).rejects.toThrow(/Start the work order first/);
      order = await maker.command(actor, w.workspaceId, first, { action: "start", version: order.order.version });

      // Output: reported by one person, approved by another; never past what's left to make.
      const report = randomUUID();
      await expect(maker.command(actor, w.workspaceId, first, { action: "report", id: report, good: "2", scrap: "0.5" })).rejects.toThrow("Say why it was scrapped.");
      order = await maker.command(actor, w.workspaceId, first, { action: "report", id: report, good: "2", scrap: "0.5", scrapReason: "Chipped edge" });
      order = await maker.command(actor, w.workspaceId, first, { action: "report", id: report, good: "2", scrap: "0.5", scrapReason: "Chipped edge" });
      expect(order.reports).toHaveLength(1);
      await expect(maker.command(actor, w.workspaceId, first, { action: "report", id: randomUUID(), good: "2" })).rejects.toThrow("Only 1 m is still to make.");
      await expect(maker.command(actor, w.workspaceId, first, { action: "decide_report", reportId: report, decision: "approve", version: order.order.version })).rejects.toThrow("Someone else approves your report.");
      await expect(checker.command(actor, w.workspaceId, first, { action: "decide_report", reportId: report, decision: "refuse", version: order.order.version })).rejects.toThrow("Say why the report is refused.");
      order = await checker.command(actor, w.workspaceId, first, { action: "decide_report", reportId: report, decision: "approve", version: order.order.version });
      expect([order.order.made, order.order.toCheck, order.order.scrapped, order.order.left]).toEqual(["2.0000", "2.0000", "0.5000", "1.0000"]);

      // Quality: what passes goes into stock at the factory; what fails is made again.
      const check = randomUUID();
      await expect(checker.command(actor, w.workspaceId, first, { action: "check", id: randomUUID(), passed: "2", failed: "0.5", failReason: "x" })).rejects.toThrow("Only 2 m is waiting to be checked.");
      order = await checker.command(actor, w.workspaceId, first, { action: "check", id: check, passed: "1.5", failed: "0.5", failReason: "Veneer lifting" });
      order = await checker.command(actor, w.workspaceId, first, { action: "check", id: check, passed: "1.5", failed: "0.5", failReason: "Veneer lifting" });
      expect([order.order.passed, order.order.toCheck, order.order.left, order.order.status]).toEqual(["1.5000", "0.0000", "1.5000", "in_production"]);
      const more = randomUUID();
      order = await maker.command(actor, w.workspaceId, first, { action: "report", id: more, good: "1.5" });
      order = await checker.command(actor, w.workspaceId, first, { action: "decide_report", reportId: more, decision: "approve", version: order.order.version });
      order = await checker.command(actor, w.workspaceId, first, { action: "check", id: randomUUID(), passed: "1.5" });
      expect([order.order.passed, order.order.left, order.order.status]).toEqual(["3.0000", "0.0000", "ready"]);
      const stock = await buyingStock(w, access, all);
      expect(stock.rows.map((row) => [row.itemName, row.locationName, row.projectId, row.onHand])).toEqual([["Kitchen cabinets", "Factory", projectId, "3.0000"]]);

      // The second can be cancelled while nothing is made on it; what it held goes back to be planned.
      const planned = (await maker.order(actor, w.workspaceId, second)).order;
      await expect(maker.command(actor, w.workspaceId, second, { action: "cancel", version: planned.version })).rejects.toThrow("Say why it's cancelled.");
      await maker.command(actor, w.workspaceId, second, { action: "cancel", reason: "Made in one run instead", version: planned.version });
      state = await maker.state(actor, w.workspaceId);
      expect(state.toMake.find((line) => line.title === "Kitchen cabinets")!.left).toBe("1.5000");

      // A third, closed short after one passes: the half not made comes back.
      const third = randomUUID();
      order = await maker.plan(actor, w.workspaceId, { id: third, lineId: cabinets.lineId, quantity: "1.5", workcenterId: joinery, plannedStart: "2026-10-19", plannedEnd: "2026-10-20" });
      order = await maker.command(actor, w.workspaceId, third, { action: "approve_drawing", reference: "K-01 rev B", version: order.order.version });
      order = await maker.command(actor, w.workspaceId, third, { action: "release", version: order.order.version });
      order = await maker.command(actor, w.workspaceId, third, { action: "start", version: order.order.version });
      await expect(maker.command(actor, w.workspaceId, third, { action: "short_close", reason: "x", version: order.order.version })).rejects.toThrow("Nothing was made on it yet: cancel it instead.");
      const one = randomUUID();
      order = await maker.command(actor, w.workspaceId, third, { action: "report", id: one, good: "1" });
      await expect(maker.command(actor, w.workspaceId, third, { action: "cancel", reason: "x", version: order.order.version })).rejects.toThrow(/close it short instead/);
      order = await checker.command(actor, w.workspaceId, third, { action: "decide_report", reportId: one, decision: "approve", version: order.order.version });
      await expect(maker.command(actor, w.workspaceId, third, { action: "short_close", reason: "x", version: order.order.version })).rejects.toThrow(/check what was made first/);
      order = await checker.command(actor, w.workspaceId, third, { action: "check", id: randomUUID(), passed: "1" });
      order = await maker.command(actor, w.workspaceId, third, { action: "short_close", reason: "Client took one unit out", version: order.order.version });
      expect(order.order.status).toBe("short_closed");
      expect((await maker.state(actor, w.workspaceId)).toMake.find((line) => line.title === "Kitchen cabinets")!.left).toBe("0.5000");
      const history = await new InventoryService(access(w.designer, all)).movements(actor, w.workspaceId, { projectId });
      expect(history.movements.map((row) => [row.kind, row.quantity, row.workOrderNumber])).toEqual([["produce", "1.0000", 3], ["produce", "1.5000", 1], ["produce", "1.5000", 1]]);
    });
  });

  it("issues materials to work orders: suggested from the material list, covered before release, over-issued only with why, returned, swapped with someone else's approval, and chased when short", async () => {
    await world(async (w) => {
      const { core, projectId, access, all } = await buying(w);
      const maker = factoryAs(access, w.designer, [...all, "factory.view", "factory.manage", "factory.report", "factory.approve"]);
      const checker = factoryAs(access, w.manager, ["factory.view", "factory.approve"]);
      const store = new InventoryService(access(w.designer, all));
      const scope = await core.scope(actor, w.workspaceId, projectId);
      const cabinets = scope.lines.find((line) => line.title === "Kitchen cabinets")!;
      const worktop = scope.lines.find((line) => line.title === "Worktop")!;
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", id: scope.packages[0].id, name: "Kitchen joinery", supply: "make", version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "20", unit: "sheets", clientChoice: false, boqLineIds: [cabinets.id], version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Wood glue", quantity: "4", unit: "nos", clientChoice: false, boqLineIds: [cabinets.id, worktop.id], version: detail.project.version });
      const settings = await maker.settings(actor, w.workspaceId);
      await maker.saveSettings(actor, w.workspaceId, { version: settings.settings.version, requireDrawing: false, requirePayment: false });
      const joinery = randomUUID();
      await maker.saveWorkcenter(actor, w.workspaceId, { id: joinery, name: "Joinery" });
      const wo = randomUUID();
      let order = await maker.plan(actor, w.workspaceId, { id: wo, lineId: cabinets.lineId ?? cabinets.id, quantity: "3", workcenterId: joinery, plannedStart: "2026-10-05", plannedEnd: "2026-10-16" });

      // Oak is used only on the cabinets: 3 of 4.5 m takes two thirds of 20 sheets, rounded up. Glue is shared, so it isn't suggested.
      expect(order.canSuggest).toBe(true);
      order = await maker.command(actor, w.workspaceId, wo, { action: "suggest_materials", version: order.order.version });
      expect(order.materials.map((row) => [row.itemName, row.quantity, row.status])).toEqual([["Oak veneer", "13.3334", "active"]]);
      await expect(maker.command(actor, w.workspaceId, wo, { action: "suggest_materials", version: order.order.version })).rejects.toThrow(/No materials from the project's list/);
      await expect(maker.command(actor, w.workspaceId, wo, { action: "release", version: order.order.version })).rejects.toThrow("Before it's released: materials aren't in: Oak veneer 13.3334 sheets.");

      // Twenty sheets in free stock at 50 each; five reserved for the project.
      let stock = await store.stock(actor, w.workspaceId);
      await store.saveLocation(actor, w.workspaceId, { id: randomUUID(), kind: "warehouse", name: "Warehouse" });
      stock = await store.stock(actor, w.workspaceId);
      const warehouse = stock.locations[0].id;
      stock = await store.command(actor, w.workspaceId, { id: randomUUID(), action: "add", name: "Oak veneer", unit: "sheets", locationId: warehouse, quantity: "20", unitCost: "50", reason: "Opening stock" });
      await store.command(actor, w.workspaceId, { id: randomUUID(), action: "allocate", itemId: stock.rows[0].itemId, locationId: warehouse, forProjectId: projectId, quantity: "5", reason: "Kitchen" });
      const oak = order.materials[0].id;
      order = await maker.command(actor, w.workspaceId, wo, { action: "issue_material", id: randomUUID(), materialId: oak, locationId: warehouse, quantity: "5", from: "project" });
      await expect(maker.command(actor, w.workspaceId, wo, { action: "issue_material", id: randomUUID(), materialId: oak, locationId: warehouse, quantity: "6", from: "project" })).rejects.toThrow(/isn't that much in stock/);
      order = await maker.command(actor, w.workspaceId, wo, { action: "issue_material", id: randomUUID(), materialId: oak, locationId: warehouse, quantity: "6", from: "free" });
      expect([order.materials[0].issued, order.releaseChecks.find((check) => check.key === "materials")!.detail]).toEqual(["11.0000", ["Oak veneer 2.3334 sheets"]]);
      await expect(maker.command(actor, w.workspaceId, wo, { action: "issue_material", id: randomUUID(), materialId: oak, locationId: warehouse, quantity: "3", from: "free" }))
        .rejects.toThrow("It needs 2.3334 sheets more: say why you're issuing more.");
      const over = randomUUID();
      order = await maker.command(actor, w.workspaceId, wo, { action: "issue_material", id: over, materialId: oak, locationId: warehouse, quantity: "3", from: "free", reason: "Offcuts too short" });
      order = await maker.command(actor, w.workspaceId, wo, { action: "issue_material", id: over, materialId: oak, locationId: warehouse, quantity: "3", from: "free", reason: "Offcuts too short" });
      expect(order.materials[0].issued).toBe("14.0000");
      order = await maker.command(actor, w.workspaceId, wo, { action: "release", version: order.order.version });
      await expect(maker.command(actor, w.workspaceId, wo, { action: "set_material", materialId: oak, quantity: "10", version: order.order.version })).rejects.toThrow(/14 sheets of Oak veneer is already issued/);
      await expect(maker.command(actor, w.workspaceId, wo, { action: "return_material", id: randomUUID(), materialId: oak, locationId: warehouse, quantity: "0.5" })).rejects.toThrow("Say why it's coming back.");
      order = await maker.command(actor, w.workspaceId, wo, { action: "return_material", id: randomUUID(), materialId: oak, locationId: warehouse, quantity: "0.5", reason: "Not needed" });
      // Issued at 50 a sheet: 14 less half a sheet back.
      expect([order.materials[0].issued, order.materialCost]).toEqual(["13.5000", "675.0000"]);

      // Walnut instead of oak: someone else decides.
      const walnut = randomUUID();
      await expect(maker.command(actor, w.workspaceId, wo, { action: "substitute", materialId: walnut, replacesId: oak, name: "Walnut veneer", unit: "sheets", quantity: "13", version: order.order.version }))
        .rejects.toThrow("Say why it's swapped.");
      order = await maker.command(actor, w.workspaceId, wo, { action: "substitute", materialId: walnut, replacesId: oak, name: "Walnut veneer", unit: "sheets", quantity: "13", reason: "Client changed the finish", version: order.order.version });
      await expect(maker.command(actor, w.workspaceId, wo, { action: "decide_substitution", materialId: walnut, decision: "approve", version: order.order.version })).rejects.toThrow("Someone else decides your swap.");
      order = await checker.command(actor, w.workspaceId, wo, { action: "decide_substitution", materialId: walnut, decision: "approve", version: order.order.version });
      expect(order.materials.map((row) => [row.itemName, row.status, row.issued])).toEqual([["Oak veneer", "replaced", "13.5000"], ["Walnut veneer", "active", "0.0000"]]);
      // What was issued of the oak goes back to the project's stock (with the half sheet returned before).
      order = await maker.command(actor, w.workspaceId, wo, { action: "return_material", id: randomUUID(), materialId: oak, locationId: warehouse, quantity: "13.5", reason: "Finish changed" });
      stock = await store.stock(actor, w.workspaceId);
      expect(stock.rows.map((row) => [row.itemName, row.projectId, row.onHand])).toEqual([["Oak veneer", null, "6.0000"], ["Oak veneer", projectId, "14.0000"]]);

      // A work order starting within the week that waits for materials tells the buyers.
      const role = randomUUID();
      await w.client.query("INSERT INTO roles (id, workspace_id, code, name) VALUES ($1, $2, 'buyer', 'Buyer')", [role, w.workspaceId]);
      await w.client.query("INSERT INTO role_permissions (workspace_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE code = 'purchasing.manage'", [w.workspaceId, role]);
      await w.client.query("INSERT INTO member_roles (workspace_id, membership_id, role_id) VALUES ($1, $2, $3)", [w.workspaceId, w.managerMembership, role]);
      const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      const next = randomUUID();
      let second = await maker.plan(actor, w.workspaceId, { id: next, lineId: cabinets.id, quantity: "1.5", workcenterId: joinery, plannedStart: soon, plannedEnd: soon });
      second = await maker.command(actor, w.workspaceId, next, { action: "add_material", materialId: randomUUID(), name: "Brass hinges", unit: "nos", quantity: "12", version: second.order.version });
      expect((await processFactoryDeadlines(w.client, w.workspaceId)).sent).toBe(1);
      expect((await processFactoryDeadlines(w.client, w.workspaceId)).sent).toBe(0);
      const told = (await w.client.query("SELECT recipient_id AS recipient, body FROM notifications WHERE workspace_id = $1 AND event_type = 'factory.material_short'", [w.workspaceId])).rows;
      expect(told).toEqual([{ recipient: w.manager, body: "PRJ-0001 · Villa 12: Brass hinges 12 nos." }]);
    });
  });

  it("stops work orders a variation reduced or removed until they fit the line, and holds running work when the drawing changes until someone else lets it go on", async () => {
    await world(async (w) => {
      const { core, projectId, access, all } = await buying(w);
      const maker = factoryAs(access, w.designer, [...all, "factory.view", "factory.manage", "factory.report", "factory.approve"]);
      const checker = factoryAs(access, w.manager, ["factory.view", "factory.approve"]);
      const scope = await core.scope(actor, w.workspaceId, projectId);
      const cabinets = scope.lines.find((line) => line.title === "Kitchen cabinets")!;
      const worktop = scope.lines.find((line) => line.title === "Worktop")!;
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", id: scope.packages[0].id, name: "Kitchen joinery", supply: "make", version: detail.project.version });
      const settings = await maker.settings(actor, w.workspaceId);
      await maker.saveSettings(actor, w.workspaceId, { version: settings.settings.version, requireDrawing: false, requirePayment: false, requireMaterials: false });
      const joinery = randomUUID();
      await maker.saveWorkcenter(actor, w.workspaceId, { id: joinery, name: "Joinery" });
      const plan = (id: string, lineId: string, quantity: string) => maker.plan(actor, w.workspaceId, { id, lineId, quantity, workcenterId: joinery, plannedStart: "2026-10-05", plannedEnd: "2026-10-09" });
      const first = randomUUID(), second = randomUUID(), third = randomUUID();
      let one = await plan(first, cabinets.id, "3");
      let two = await plan(second, cabinets.id, "1.5");
      let three = await plan(third, worktop.id, "2.25");

      // A variation takes a metre off the cabinets and the worktop out altogether.
      await w.client.query("UPDATE project_boq_lines SET quantity = 3.5 WHERE id = $1", [cabinets.id]);
      await w.client.query("UPDATE project_boq_lines SET status = 'omitted' WHERE id = $1", [worktop.id]);
      const role = randomUUID();
      await w.client.query("INSERT INTO roles (id, workspace_id, code, name) VALUES ($1, $2, 'factory', 'Factory')", [role, w.workspaceId]);
      await w.client.query("INSERT INTO role_permissions (workspace_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE code = 'factory.manage'", [w.workspaceId, role]);
      await w.client.query("INSERT INTO member_roles (workspace_id, membership_id, role_id) VALUES ($1, $2, $3)", [w.workspaceId, w.designerMembership, role]);
      expect(await tellScopeChanges(w.client, w.workspaceId, projectId, w.manager, "vo-1")).toBe(2);
      expect(await tellScopeChanges(w.client, w.workspaceId, projectId, w.manager, "vo-1")).toBe(0);
      const told = (await w.client.query("SELECT body FROM notifications WHERE workspace_id = $1 AND event_type = 'factory.scope_changed' ORDER BY body", [w.workspaceId])).rows.map((row) => row.body);
      expect(told).toEqual(["PRJ-0001 · Villa 12: 1 m more on WO-0001, WO-0002 than the line now needs.", "PRJ-0001 · Villa 12: removed from the scope; WO-0003 can't go on."]);

      two = await maker.order(actor, w.workspaceId, second);
      expect(two.releaseChecks.find((check) => check.key === "scope")).toMatchObject({ passed: false, missing: "a variation reduced its scope line by 1 m" });
      await expect(maker.command(actor, w.workspaceId, second, { action: "release", version: two.order.version }))
        .rejects.toThrow("A variation reduced its scope line: 1 m more are on work orders than it needs. Reduce or cancel a work order first.");
      await expect(maker.command(actor, w.workspaceId, second, { action: "set_quantity", quantity: "1", version: two.order.version })).rejects.toThrow("At most 0.5 m: the rest of the line is on other work orders.");
      two = await maker.command(actor, w.workspaceId, second, { action: "set_quantity", quantity: "0.5", version: two.order.version });
      two = await maker.command(actor, w.workspaceId, second, { action: "release", version: two.order.version });
      expect(two.order.status).toBe("released");
      await expect(maker.command(actor, w.workspaceId, third, { action: "release", version: three.order.version })).rejects.toThrow("A variation removed its scope line: cancel it, or close it short.");
      three = await maker.command(actor, w.workspaceId, third, { action: "cancel", reason: "Worktop taken out by VO-1", version: three.order.version });

      // Running work stops when the drawing changes; someone else lets it go on.
      one = await maker.command(actor, w.workspaceId, first, { action: "release", version: one.order.version });
      one = await maker.command(actor, w.workspaceId, first, { action: "start", version: one.order.version });
      await expect(maker.command(actor, w.workspaceId, first, { action: "revise_drawing", reference: "K-01 rev C", version: one.order.version })).rejects.toThrow("Say what changed.");
      one = await maker.command(actor, w.workspaceId, first, { action: "revise_drawing", reference: "K-01 rev C", note: "Handles moved to the top rail", version: one.order.version });
      expect([one.order.status, one.order.holdKind, one.order.holdReason]).toEqual(["on_hold", "drawing", "Drawing changed to K-01 rev C: Handles moved to the top rail"]);
      await expect(maker.command(actor, w.workspaceId, first, { action: "report", id: randomUUID(), good: "1" })).rejects.toThrow(/on hold/);
      await expect(maker.command(actor, w.workspaceId, first, { action: "resume", version: one.order.version })).rejects.toThrow("Someone else decides whether it goes on with the drawing you changed.");
      one = await checker.command(actor, w.workspaceId, first, { action: "resume", version: one.order.version });
      expect([one.order.status, one.order.holdKind, one.order.drawingRef]).toEqual(["in_production", null, "K-01 rev C"]);
    });
  });

  it("books hours on workcenters day by day and flags days over capacity; batches start their released work orders together", async () => {
    await world(async (w) => {
      const { core, projectId, access, all } = await buying(w);
      const maker = factoryAs(access, w.designer, [...all, "factory.view", "factory.manage", "factory.report", "factory.approve"]);
      const scope = await core.scope(actor, w.workspaceId, projectId);
      const cabinets = scope.lines.find((line) => line.title === "Kitchen cabinets")!;
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", id: scope.packages[0].id, name: "Kitchen joinery", supply: "make", version: detail.project.version });
      const settings = await maker.settings(actor, w.workspaceId);
      await maker.saveSettings(actor, w.workspaceId, { version: settings.settings.version, requireDrawing: false, requirePayment: false, requireMaterials: false });
      const joinery = randomUUID();
      await maker.saveWorkcenter(actor, w.workspaceId, { id: joinery, name: "Joinery", hoursPerDay: "8" });
      const first = randomUUID(), second = randomUUID();
      // 24 hours over Monday to Wednesday is 8 a day; another 8 hours on Tuesday doubles it.
      let one = await maker.plan(actor, w.workspaceId, { id: first, lineId: cabinets.id, quantity: "3", workcenterId: joinery, plannedStart: "2026-10-05", plannedEnd: "2026-10-07", plannedHours: "24" });
      let two = await maker.plan(actor, w.workspaceId, { id: second, lineId: cabinets.id, quantity: "1.5", workcenterId: joinery, plannedStart: "2026-10-06", plannedEnd: "2026-10-06", plannedHours: "8" });
      const week = await maker.schedule(actor, w.workspaceId, { from: "2026-10-05", days: "7" });
      expect(week.days).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
      expect(week.load[joinery]).toEqual({ "2026-10-05": 8, "2026-10-06": 16, "2026-10-07": 8 });
      expect(week.conflicts).toEqual([{ workcenterId: joinery, workcenterName: "Joinery", date: "2026-10-06", hours: 16, capacity: 8, orders: [first, second] }]);
      // Moving the second a day later clears it.
      two = await maker.command(actor, w.workspaceId, second, { action: "update", plannedStart: "2026-10-08", plannedEnd: "2026-10-08", version: two.order.version });
      expect((await maker.schedule(actor, w.workspaceId, { from: "2026-10-05", days: "7" })).conflicts).toEqual([]);

      // One run for both: it starts only what's released.
      one = await maker.command(actor, w.workspaceId, first, { action: "release", version: one.order.version });
      const run = randomUUID();
      let batches = await maker.saveBatch(actor, w.workspaceId, { id: run, name: "Oak cutting run", workcenterId: joinery, plannedOn: "2026-10-05", orderIds: [first, second] });
      expect(batches.batches.map((batch) => [batch.number, batch.name, batch.orders, batch.projects, batch.status])).toEqual([[1, "Oak cutting run", 2, ["PRJ-0001"], "open"]]);
      await expect(maker.saveBatch(actor, w.workspaceId, { id: randomUUID(), name: "Other", orderIds: [first] })).rejects.toThrow("WO-0001 is already in Oak cutting run.");
      await expect(maker.saveBatch(actor, w.workspaceId, { id: run, action: "start", version: 1 })).rejects.toThrow("Release WO-0002 first, or take it out of the batch.");
      batches = await maker.saveBatch(actor, w.workspaceId, { id: run, action: "remove", orderIds: [second], version: 1 });
      batches = await maker.saveBatch(actor, w.workspaceId, { id: run, action: "start", version: 2 });
      expect(batches.batches[0]).toMatchObject({ status: "started", orders: 1 });
      expect(batches.orders.find((order) => order.id === first)).toMatchObject({ status: "in_production", batchName: "Oak cutting run" });
      await expect(maker.saveBatch(actor, w.workspaceId, { id: run, action: "add", orderIds: [second], version: 3 })).rejects.toThrow("Only an open batch takes more work orders.");
    });
  });

  it("follows snags: how serious and where from, fixed by one person and closed by another with a photo after, reopened with why, and a critical one holding handover", async () => {
    await world(async (w) => {
      await accept(w);
      const core = w.as(w.manager);
      const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "set_member", role: "designer", membershipId: w.designerMembership, version: detail.project.version });
      const storage = new BrandAssetStorageService(new ConfigService({ BRAND_ASSET_STORAGE_DIR: await mkdtemp(join(tmpdir(), "wodana-snags-")) }));
      const run = (userId: string) => ({ asMember: (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(w.client, { userId }),
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => ["projects.manage", "projects.view"].includes(code) } as never);
      const lead = new ProjectWorkService(run(w.manager), storage);
      const fixer = new ProjectWorkService(run(w.designer), storage);
      const kitchen = (await w.client.query("SELECT id FROM pre_project_rooms WHERE case_id = $1", [w.caseId])).rows[0].id;
      const snag = randomUUID();
      let board = await lead.command(actor, w.workspaceId, projectId, { action: "create", id: snag, type: "snag", title: "Scratch on the wardrobe door", severity: "critical", source: "client",
        areaId: kitchen, assigneeId: w.designerMembership });
      let item = board.items.find((row) => row.id === snag)!;
      expect([item.type, item.severity, item.source, item.areaId]).toEqual(["snag", "critical", "client", kitchen]);
      expect(board.areas).toEqual([{ id: kitchen, name: "Kitchen" }]);

      // A critical snag holds handover.
      await w.client.query("UPDATE project_stages SET status = 'done', completed_at = now(), completed_by = $2 WHERE project_id = $1 AND key <> 'handover'", [projectId, w.manager]);
      await w.client.query("UPDATE project_stages SET status = 'current', started_at = now() WHERE project_id = $1 AND key = 'handover'", [projectId]);
      detail = await core.get(actor, w.workspaceId, projectId);
      expect(detail.stages.find((stage) => stage.key === "handover")!.checks.find((check) => check.kind === "no_critical_snags")!.passed).toBe(false);

      // The designer fixes it; they can't close it themselves, and closing needs a photo after.
      board = await fixer.command(actor, w.workspaceId, projectId, { action: "update", itemId: snag, version: item.version, status: "in_review" });
      item = board.items.find((row) => row.id === snag)!;
      expect(item.fixedBy).toBe(w.designer);
      const ready = (await w.client.query("SELECT recipient_id AS id FROM notifications WHERE workspace_id = $1 AND event_type = 'work.snag_ready'", [w.workspaceId])).rows;
      expect(ready).toEqual([{ id: w.manager }]);
      await expect(fixer.command(actor, w.workspaceId, projectId, { action: "update", itemId: snag, version: item.version, status: "done" })).rejects.toThrow("Someone other than who fixed it closes a snag.");
      await expect(lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: snag, version: item.version, status: "done" })).rejects.toThrow("Add a photo of it fixed before closing it.");
      const png = { buffer: await sharp({ create: { width: 8, height: 8, channels: 3, background: "#8a8a8a" } }).png().toBuffer(), originalname: "fixed.png", mimetype: "image/png", size: 0 };
      await expect(fixer.uploadPhoto(actor, w.workspaceId, projectId, snag, randomUUID(), "during", png)).rejects.toThrow();
      const after = randomUUID();
      board = await fixer.uploadPhoto(actor, w.workspaceId, projectId, snag, after, "after", png);
      board = await fixer.uploadPhoto(actor, w.workspaceId, projectId, snag, after, "after", png);
      expect(board.item!.photos.map((photo) => [photo.kind, photo.name])).toEqual([["after", "fixed.png"]]);
      expect((await lead.photo(actor, w.workspaceId, projectId, after, false)).contentType).toBe("image/png");
      item = board.items.find((row) => row.id === snag)!;
      board = await lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: snag, version: item.version, status: "done" });
      detail = await core.get(actor, w.workspaceId, projectId);
      expect(detail.stages.find((stage) => stage.key === "handover")!.checks.find((check) => check.kind === "no_critical_snags")!.passed).toBe(true);

      // Reopened with why; its history keeps both.
      item = board.items.find((row) => row.id === snag)!;
      await expect(lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: snag, version: item.version, status: "todo" })).rejects.toThrow("Say why the snag is open again.");
      board = await lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: snag, version: item.version, status: "todo", reason: "Scratch still visible in daylight" });
      expect(board.items.find((row) => row.id === snag)).toMatchObject({ status: "todo", fixedBy: null });
      const history = (await lead.item(actor, w.workspaceId, projectId, snag)).activity.map((entry) => entry.kind);
      expect(history).toEqual(expect.arrayContaining(["created", "status", "photo", "reopened"]));
      const reopened = (await w.client.query("SELECT recipient_id AS id, body FROM notifications WHERE workspace_id = $1 AND event_type = 'work.snag_reopened'", [w.workspaceId])).rows;
      expect(reopened).toEqual([{ id: w.designer, body: "Omar Manager: Scratch still visible in daylight" }]);
    });
  });

  it("runs the site's day: reports with photos or a reason, installation approved by someone else and taken from site stock, corrections, incidents and missing reports", async () => {
    await world(async (w) => {
      const { core, projectId, vendor, buyer, manager: office } = await buying(w);
      const scope = await core.scope(actor, w.workspaceId, projectId);
      const [, general] = scope.packages;
      const cabinets = scope.lines.find((line) => line.title === "Kitchen cabinets")!;
      const lights = scope.lines.find((line) => line.title === "Under-cabinet lights")!;
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "set_member", role: "site_supervisor", membershipId: w.designerMembership, version: detail.project.version });
      // The lights are fitted by our own people: site work, nothing in stock.
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", id: general.id, name: "Electrical", supply: "site_work", version: detail.project.version });
      const storage = new BrandAssetStorageService(new ConfigService({ BRAND_ASSET_STORAGE_DIR: await mkdtemp(join(tmpdir(), "wodana-site-")) }));
      const as = (userId: string, permissions = ["projects.view"]) => new SiteService({
        asMember: async (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => {
          await w.client.query("SAVEPOINT site"); try { const result = await fn(w.client, { userId }); await w.client.query("RELEASE SAVEPOINT site"); return result; }
          catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT site"); throw error; } },
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never, storage);
      const supervisor = as(w.designer);
      const pm = as(w.manager);
      await expect(supervisor.command(actor, w.workspaceId, projectId, { action: "start_site", on: "2026-09-21" })).rejects.toThrow("Only the project manager starts or finishes site work.");
      let site = await pm.command(actor, w.workspaceId, projectId, { action: "start_site", on: "2026-09-21" });
      expect(site.site).toEqual({ startedOn: "2026-09-21", finishedOn: null });

      // Three metres of cabinets arrive at the site.
      const order = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "line", boqLineId: cabinets.id, quantity: "4.5", unitPrice: "900", taxRate: "0" }]);
      await office.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: `site:${projectId}`, receivedOn: "2026-09-24", lines: [{ orderLineId: order.lines[0].id, received: "3" }] });

      const report = randomUUID();
      site = await supervisor.command(actor, w.workspaceId, projectId, { id: report, action: "save_report", reportDate: "2026-09-25", weather: "Hot", workforce: [{ trade: "Carpenters", people: 4 }],
        lines: [{ boqLineId: cabinets.id, installed: "3.5" }, { boqLineId: lights.id, installed: "1" }] });
      let mine = site.reports.find((row) => row.id === report)!;
      await expect(supervisor.command(actor, w.workspaceId, projectId, { action: "submit", reportId: report, version: mine.version })).rejects.toThrow("Add a photo, or say why no work was done.");
      const png = { buffer: await sharp({ create: { width: 8, height: 8, channels: 3, background: "#8a8a8a" } }).png().toBuffer(), originalname: "kitchen.png", mimetype: "image/png", size: 0 };
      site = await supervisor.uploadPhoto(actor, w.workspaceId, projectId, report, randomUUID(), png);
      mine = site.reports.find((row) => row.id === report)!;
      site = await supervisor.command(actor, w.workspaceId, projectId, { action: "submit", reportId: report, version: mine.version });
      expect((await w.client.query("SELECT recipient_id AS id FROM notifications WHERE workspace_id = $1 AND event_type = 'site.report_waiting'", [w.workspaceId])).rows).toEqual([{ id: w.manager }]);

      // More cabinets than arrived can't be installed: it goes back to the supervisor.
      mine = site.reports.find((row) => row.id === report)!;
      await expect(pm.command(actor, w.workspaceId, projectId, { action: "approve", reportId: report, version: mine.version })).rejects.toThrow("Kitchen cabinets: only 3 m is at the site.");
      site = await pm.command(actor, w.workspaceId, projectId, { action: "return", reportId: report, note: "Only 3 m arrived", version: mine.version });
      mine = site.reports.find((row) => row.id === report)!;
      site = await supervisor.command(actor, w.workspaceId, projectId, { id: report, action: "save_report", reportDate: "2026-09-25", weather: "Hot", workforce: [{ trade: "Carpenters", people: 4 }],
        lines: [{ boqLineId: cabinets.id, installed: "3" }, { boqLineId: lights.id, installed: "1" }], version: mine.version });
      mine = site.reports.find((row) => row.id === report)!;
      site = await supervisor.command(actor, w.workspaceId, projectId, { action: "submit", reportId: report, version: mine.version });
      mine = site.reports.find((row) => row.id === report)!;
      site = await pm.command(actor, w.workspaceId, projectId, { action: "approve", reportId: report, version: mine.version });
      expect(site.lines.filter((line) => [cabinets.id, lights.id].includes(line.id)).map((line) => [line.title, line.installed])).toEqual([["Kitchen cabinets", "3.0000"], ["Under-cabinet lights", "1.0000"]]);
      expect((await buyer.stock.stock(actor, w.workspaceId)).rows.filter((row) => row.itemName === "Kitchen cabinets").map((row) => row.onHand)).toEqual([]);

      // A correction a day later puts half a metre back; the lights can't pass their scope.
      const fix = randomUUID();
      site = await supervisor.command(actor, w.workspaceId, projectId, { id: fix, action: "save_report", reportDate: "2026-09-26", noWorkReason: "Snagging only",
        lines: [{ boqLineId: cabinets.id, installed: "-0.5", note: "One door refitted" }, { boqLineId: lights.id, installed: "1" }] });
      mine = site.reports.find((row) => row.id === fix)!;
      site = await supervisor.command(actor, w.workspaceId, projectId, { action: "submit", reportId: fix, version: mine.version });
      mine = site.reports.find((row) => row.id === fix)!;
      await expect(pm.command(actor, w.workspaceId, projectId, { action: "approve", reportId: fix, version: mine.version })).rejects.toThrow("Under-cabinet lights: the scope has 1 nos; 1 is installed already.");

      // The manager's own report is approved by someone else; an incident reaches the manager at once, blocked work needs who recovers it.
      await expect(pm.command(actor, w.workspaceId, projectId, { id: randomUUID(), action: "save_report", reportDate: "2026-09-26", forecast: "blocked", impact: "Tiles late" }))
        .rejects.toThrow("Name who recovers it and by when.");
      const own = randomUUID();
      site = await pm.command(actor, w.workspaceId, projectId, { id: own, action: "save_report", reportDate: "2026-09-26", noWorkReason: "Inspection only" });
      mine = site.reports.find((row) => row.id === own)!;
      site = await pm.command(actor, w.workspaceId, projectId, { action: "submit", reportId: own, version: mine.version });
      mine = site.reports.find((row) => row.id === own)!;
      await expect(pm.command(actor, w.workspaceId, projectId, { action: "approve", reportId: own, version: mine.version })).rejects.toThrow("Someone other than its author approves a report.");
      const incident = randomUUID();
      site = await supervisor.command(actor, w.workspaceId, projectId, { id: incident, action: "save_report", reportDate: "2026-09-24", safety: "incident", safetyNote: "Ladder slipped, no injury",
        noWorkReason: "Stopped after the incident" });
      mine = site.reports.find((row) => row.id === incident)!;
      await supervisor.command(actor, w.workspaceId, projectId, { action: "submit", reportId: incident, version: mine.version });
      expect((await w.client.query("SELECT channel FROM notifications WHERE workspace_id = $1 AND event_type = 'site.incident' ORDER BY channel", [w.workspaceId])).rows).toEqual([{ channel: "email" }, { channel: "in_app" }]);

      // Every day is worked here: yesterday has no report, so the manager hears.
      await w.client.query("INSERT INTO hrms_calendars (workspace_id, name, timezone, working_days) VALUES ($1, 'Site', 'Asia/Dubai', ARRAY[0, 1, 2, 3, 4, 5, 6])", [w.workspaceId]);
      await w.client.query("DELETE FROM site_reports WHERE project_id = $1 AND report_date = (now() AT TIME ZONE 'Asia/Dubai')::date - 1", [projectId]);
      expect((await processSiteReports(w.client, w.workspaceId)).sent).toBeGreaterThanOrEqual(1);
      expect((await w.client.query("SELECT recipient_id AS id FROM notifications WHERE workspace_id = $1 AND event_type = 'site.report_overdue'", [w.workspaceId])).rows).toEqual([{ id: w.manager }]);
    });
  });

  it("hands over with a frozen pack: refused with why makes a snag and a new revision, accepted only with no critical snag, outstanding items become snags", async () => {
    await world(async (w) => {
      await accept(w);
      const core = w.as(w.manager);
      const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "set_member", role: "designer", membershipId: w.designerMembership, version: detail.project.version });
      const storage = new BrandAssetStorageService(new ConfigService({ BRAND_ASSET_STORAGE_DIR: await mkdtemp(join(tmpdir(), "wodana-handover-")) }));
      const as = (userId: string) => new HandoverService({
        asMember: async (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => {
          await w.client.query("SAVEPOINT handover"); try { const result = await fn(w.client, { userId }); await w.client.query("RELEASE SAVEPOINT handover"); return result; }
          catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT handover"); throw error; } },
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => code === "projects.view" } as never, storage);
      const pm = as(w.manager);
      const kitchen = (await w.client.query("SELECT id FROM pre_project_rooms WHERE case_id = $1", [w.caseId])).rows[0].id;
      const first = randomUUID();
      await expect(as(w.designer).command(actor, w.workspaceId, projectId, { action: "create_pack", id: first, title: "Kitchen handover", areaIds: [kitchen] }))
        .rejects.toThrow("Only the project manager prepares and records the handover.");
      let state = await pm.command(actor, w.workspaceId, projectId, { action: "create_pack", id: first, title: "Kitchen handover", areaIds: [kitchen] });
      let pack = state.packs[0];
      await expect(pm.command(actor, w.workspaceId, projectId, { action: "issue", packId: first, version: pack.version })).rejects.toThrow("Add the documents the client receives first.");
      const pdf = { buffer: Buffer.from("%PDF-1.4\n%warranty\n"), originalname: "warranty.pdf", mimetype: "application/pdf", size: 0 };
      state = await pm.uploadDocument(actor, w.workspaceId, projectId, first, randomUUID(), { kind: "warranty", title: "Hinge warranty" }, pdf);
      pack = state.packs[0];
      state = await pm.command(actor, w.workspaceId, projectId, { action: "issue", packId: first, version: pack.version });
      pack = state.packs[0];
      expect([pack.status, pack.revision, pack.contentHash?.length, pack.documents.map((document) => [document.kind, document.title])]).toEqual(["issued", 1, 64, [["warranty", "Hinge warranty"]]]);
      await expect(pm.command(actor, w.workspaceId, projectId, { action: "update_pack", packId: first, title: "Changed", areaIds: [], version: pack.version })).rejects.toThrow(/An issued pack doesn't change/);
      await w.client.query("SAVEPOINT frozen");
      await expect(w.client.query("UPDATE handover_packs SET title = 'x' WHERE id = $1", [first])).rejects.toThrow(/cannot be changed/);
      await w.client.query("ROLLBACK TO SAVEPOINT frozen");

      // Refused: the reason is a snag to fix, and a new revision (same documents) to issue.
      state = await pm.command(actor, w.workspaceId, projectId, { action: "refuse", packId: first, version: pack.version, decidedOn: "2026-09-26", decidedByName: "Maya Client", method: "in_person",
        reason: "Cabinet doors misaligned" });
      expect(state.packs.map((row) => [row.revision, row.status, row.documents.length])).toEqual([[2, "draft", 1], [1, "refused", 1]]);
      const refused = (await w.client.query("SELECT title, severity, source FROM work_items WHERE project_id = $1 AND type = 'snag'", [projectId])).rows;
      expect(refused).toEqual([{ title: "Handover refused: Cabinet doors misaligned", severity: "major", source: "client" }]);

      // Accepted only when no critical snag is open in the kitchen.
      const second = state.packs[0];
      state = await pm.command(actor, w.workspaceId, projectId, { action: "issue", packId: second.id, version: second.version });
      await w.client.query(`INSERT INTO work_items (id, workspace_id, project_id, number, type, title, severity, source, area_id, created_by)
        VALUES (gen_random_uuid(), $1, $2, 99, 'snag', 'Glass splashback cracked', 'critical', 'inspection', $3, $4)`, [w.workspaceId, projectId, kitchen, w.manager]);
      const issued = state.packs[0];
      const acceptance = { action: "accept", packId: issued.id, decidedOn: "2026-09-27", decidedByName: "Maya Client", method: "signed_document", outstanding: ["Touch-up paint on the skirting"] };
      await expect(pm.command(actor, w.workspaceId, projectId, { ...acceptance, version: issued.version })).rejects.toThrow("Close the critical snag first: #99.");
      await w.client.query("UPDATE work_items SET status = 'done', completed_at = now(), completed_by = $2 WHERE project_id = $1 AND number = 99", [projectId, w.manager]);
      state = await pm.command(actor, w.workspaceId, projectId, { ...acceptance, version: issued.version });
      expect([state.packs[0].status, state.covered]).toEqual(["accepted", true]);
      const minor = (await w.client.query("SELECT title, severity, source FROM work_items WHERE project_id = $1 AND type = 'snag' AND severity = 'minor'", [projectId])).rows;
      expect(minor).toEqual([{ title: "Touch-up paint on the skirting", severity: "minor", source: "client" }]);
      expect((await w.client.query("SELECT recipient_id AS id FROM notifications WHERE workspace_id = $1 AND event_type = 'handover.accepted'", [w.workspaceId])).rows).toEqual([{ id: w.designer }]);
      // The handover stage reads it.
      await w.client.query("UPDATE project_stages SET status = 'done', completed_at = now(), completed_by = $2 WHERE project_id = $1 AND key <> 'handover'", [projectId, w.manager]);
      await w.client.query("UPDATE project_stages SET status = 'current', started_at = now() WHERE project_id = $1 AND key = 'handover'", [projectId]);
      detail = await core.get(actor, w.workspaceId, projectId);
      expect(detail.stages.find((stage) => stage.key === "handover")!.checks.find((check) => check.kind === "handover_accepted")!.passed).toBe(true);
    });
  });

  it("starts each item's warranty at handover, triages claims into warranty snags that are still worked after completion, and warns before warranties end", async () => {
    await world(async (w) => {
      await accept(w);
      const core = w.as(w.manager);
      const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "set_member", role: "account_manager", membershipId: w.designerMembership, version: detail.project.version });
      const storage = new BrandAssetStorageService(new ConfigService({ BRAND_ASSET_STORAGE_DIR: await mkdtemp(join(tmpdir(), "wodana-warranty-")) }));
      const access = (userId: string, permissions: string[]) => ({
        asMember: async (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => {
          await w.client.query("SAVEPOINT aftercare"); try { const result = await fn(w.client, { userId }); await w.client.query("RELEASE SAVEPOINT aftercare"); return result; }
          catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT aftercare"); throw error; } },
        withPermission: async (_a: unknown, _w: string, _code: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(w.client, { userId }),
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never);
      const pm = new WarrantyService(access(w.manager, ["projects.view", "workspace.settings.manage"]));
      const account = new WarrantyService(access(w.designer, ["projects.view"]));
      await pm.saveSettings(actor, w.workspaceId, { months: { buy: 18 } });
      expect((await pm.settings(actor, w.workspaceId)).months).toMatchObject({ buy: 18, make: 12, client: 0 });

      // The client accepts a whole-project handover on 26 September: warranties start that day.
      const handover = new HandoverService(access(w.manager, ["projects.view"]), storage);
      const pack = randomUUID();
      let packs = await handover.command(actor, w.workspaceId, projectId, { action: "create_pack", id: pack, title: "Handover", areaIds: [] });
      packs = await handover.uploadDocument(actor, w.workspaceId, projectId, pack, randomUUID(), { kind: "manual", title: "Care guide" },
        { buffer: Buffer.from("%PDF-1.4\n%care\n"), originalname: "care.pdf", mimetype: "application/pdf", size: 0 });
      packs = await handover.command(actor, w.workspaceId, projectId, { action: "issue", packId: pack, version: packs.packs[0].version });
      await handover.command(actor, w.workspaceId, projectId, { action: "accept", packId: pack, version: packs.packs[0].version, decidedOn: "2026-09-26", decidedByName: "Maya Client", method: "signed_document" });
      let state = await pm.state(actor, w.workspaceId, projectId);
      expect(state.items.map((item) => [item.title, item.months, item.startsOn, item.endsOn])).toEqual([
        ["Kitchen cabinets", 18, "2026-09-26", "2028-03-25"], ["Worktop", 18, "2026-09-26", "2028-03-25"], ["Under-cabinet lights", 18, "2026-09-26", "2028-03-25"]]);
      const lights = state.lines.find((line) => line.title === "Under-cabinet lights")!.id;
      const cabinets = state.lines.find((line) => line.title === "Kitchen cabinets")!.id;
      await expect(pm.command(actor, w.workspaceId, projectId, { action: "set_months", lineId: lights, months: 6 })).rejects.toThrow("Say why the warranty changes.");
      state = await pm.command(actor, w.workspaceId, projectId, { action: "set_months", lineId: lights, months: 6, reason: "Supplier covers 6 months" });
      expect(state.items.find((item) => item.lineId === lights)).toMatchObject({ months: 6, endsOn: "2027-03-25" });

      // A claim on the cabinets, inside their warranty: covered, a warranty snag.
      const claim = randomUUID();
      state = await account.command(actor, w.workspaceId, projectId, { action: "record_claim", id: claim, raisedOn: "2026-12-01", raisedByName: "Maya Client", channel: "phone",
        description: "Drawer runner broken", boqLineId: cabinets });
      expect((await w.client.query("SELECT recipient_id AS id, channel FROM notifications WHERE workspace_id = $1 AND event_type = 'warranty.claim' ORDER BY channel", [w.workspaceId])).rows)
        .toEqual([{ id: w.manager, channel: "email" }, { id: w.manager, channel: "in_app" }]);
      await expect(account.command(actor, w.workspaceId, projectId, { action: "decide_claim", claimId: claim, decision: "covered", version: 1 })).rejects.toThrow("Only the project manager decides claims.");
      state = await pm.command(actor, w.workspaceId, projectId, { action: "decide_claim", claimId: claim, decision: "covered", version: 1 });
      const covered = state.claims.find((row) => row.id === claim)!;
      expect([covered.status, covered.snagNumber, covered.snagStatus]).toMatchObject(["covered", expect.any(Number), "todo"]);
      // The lights' 6 months had ended by June: covered only as goodwill, with why.
      const late = randomUUID();
      state = await account.command(actor, w.workspaceId, projectId, { action: "record_claim", id: late, raisedOn: "2027-06-01", raisedByName: "Maya Client", channel: "email",
        description: "Light flickers", boqLineId: lights });
      await expect(pm.command(actor, w.workspaceId, projectId, { action: "decide_claim", claimId: late, decision: "covered", version: 1 })).rejects.toThrow(/warranty didn't cover that day/);
      await expect(pm.command(actor, w.workspaceId, projectId, { action: "decide_claim", claimId: late, decision: "not_covered", version: 1 })).rejects.toThrow("Say why it isn't covered.");
      state = await pm.command(actor, w.workspaceId, projectId, { action: "decide_claim", claimId: late, decision: "chargeable", note: "Replace the driver at cost", version: 1 });
      expect(state.claims.find((row) => row.id === late)).toMatchObject({ status: "chargeable", snagId: null });

      // Once the project is complete, only its warranty snags are still worked on.
      await w.client.query("UPDATE delivery_projects SET status = 'completed', completed_at = now(), completed_by = $2 WHERE id = $1", [projectId, w.manager]);
      const lead = w.work(w.manager);
      let board = await lead.board(actor, w.workspaceId, projectId);
      expect(board.aftercare).toBe(true);
      const snag = board.items.find((item) => item.id === covered.snagId)!;
      board = await lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: snag.id, version: snag.version, assigneeId: w.designerMembership });
      expect(board.items.find((item) => item.id === snag.id)!.assigneeId).toBe(w.designerMembership);
      await expect(lead.command(actor, w.workspaceId, projectId, { action: "create", id: randomUUID(), title: "New task" })).rejects.toThrow("The project is closed.");

      // A warranty ending within 30 days is flagged to the account manager and project manager.
      await w.client.query("UPDATE warranty_items SET ends_on = (now() AT TIME ZONE 'Asia/Dubai')::date + 10 WHERE boq_line_id = $1", [cabinets]);
      expect((await processWarrantyExpiry(w.client, w.workspaceId)).sent).toBe(2);
      expect((await processWarrantyExpiry(w.client, w.workspaceId)).sent).toBe(0);
    });
  });

  /** The factory service as one person, with the purchasing and inventory services it uses. */
  function factoryAs(access: (userId: string, permissions: string[]) => never, userId: string, permissions: string[]) {
    return new FactoryService(access(userId, permissions), new OrdersService(access(userId, permissions)), new InventoryService(access(userId, permissions)));
  }

  it("sends a step out to a supplier on a service order, checks once the goods are back, and dispatches made goods to the site as a move", async () => {
    await world(async (w) => {
      const { core, projectId, vendor, buyer, manager, access, all } = await buying(w);
      const maker = factoryAs(access, w.designer, [...all, "factory.view", "factory.manage", "factory.report", "factory.approve"]);
      const checker = factoryAs(access, w.manager, ["factory.view", "factory.approve"]);
      const scope = await core.scope(actor, w.workspaceId, projectId);
      const cabinets = scope.lines.find((line) => line.title === "Kitchen cabinets")!;
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", id: scope.packages[0].id, name: "Kitchen joinery", supply: "make", version: detail.project.version });
      const settings = await maker.settings(actor, w.workspaceId);
      await maker.saveSettings(actor, w.workspaceId, { version: settings.settings.version, requireDrawing: false, requirePayment: false, requireMaterials: false });
      const joinery = randomUUID(), wo = randomUUID();
      await maker.saveWorkcenter(actor, w.workspaceId, { id: joinery, name: "Joinery" });
      let order = await maker.plan(actor, w.workspaceId, { id: wo, lineId: cabinets.id, quantity: "3", workcenterId: joinery, plannedStart: "2026-10-05", plannedEnd: "2026-10-09" });
      order = await maker.command(actor, w.workspaceId, wo, { action: "release", version: order.order.version });
      order = await maker.command(actor, w.workspaceId, wo, { action: "start", version: order.order.version });
      const made = randomUUID();
      order = await maker.command(actor, w.workspaceId, wo, { action: "report", id: made, good: "3" });
      order = await checker.command(actor, w.workspaceId, wo, { action: "decide_report", reportId: made, decision: "approve", version: order.order.version });

      // Polishing is done by a supplier: a draft service order for the buyer, and the check waits for the goods to come back.
      await expect(maker.command(actor, w.workspaceId, wo, { action: "send_out", operationId: randomUUID(), vendorId: vendor, quantity: "3", unitPrice: "100", version: order.order.version }))
        .rejects.toThrow(/Say what the supplier does/);
      order = await maker.command(actor, w.workspaceId, wo, { action: "send_out", operationId: randomUUID(), name: "Polishing", vendorId: vendor, quantity: "3", unitPrice: "100", version: order.order.version });
      const step = order.operations[0];
      expect([step.name, step.supplierName, step.orderStatus, step.back, step.out]).toEqual(["Polishing", "Nile Marble", "draft", "0.0000", true]);
      await expect(checker.command(actor, w.workspaceId, wo, { action: "check", id: randomUUID(), passed: "3" })).rejects.toThrow(`Polishing isn't back from Nile Marble yet (${step.orderNumber}).`);
      let purchase = await buyer.orders.get(actor, w.workspaceId, step.orderId);
      expect(purchase.lines.map((line) => [line.description, line.quantity, line.projectId])).toEqual([["Polishing — WO-0001 Kitchen cabinets", "3.0000", projectId]]);
      purchase = await buyer.orders.command(actor, w.workspaceId, step.orderId, { action: "submit", version: purchase.order.version });
      purchase = await buyer.orders.command(actor, w.workspaceId, step.orderId, { action: "send", version: purchase.order.version });
      await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: step.orderId, place: "factory", receivedOn: "2026-09-26", lines: [{ orderLineId: purchase.lines[0].id, received: "3" }] });
      order = await maker.order(actor, w.workspaceId, wo);
      expect([order.operations[0].back, order.operations[0].out]).toEqual(["3.0000", false]);
      order = await checker.command(actor, w.workspaceId, wo, { action: "check", id: randomUUID(), passed: "3" });
      expect([order.order.status, order.atFactory]).toEqual(["ready", "3.0000"]);
      // The polishing brought back our own goods: nothing new in stock.
      const stock = await buyer.stock.stock(actor, w.workspaceId);
      expect(stock.rows.map((row) => [row.itemName, row.locationName, row.onHand])).toEqual([["Kitchen cabinets", "Factory", "3.0000"]]);

      // Two go to site now; there's only one left to send.
      const trip = randomUUID();
      order = await maker.command(actor, w.workspaceId, wo, { action: "dispatch", id: trip, quantity: "2", note: "First trip" });
      order = await maker.command(actor, w.workspaceId, wo, { action: "dispatch", id: trip, quantity: "2", note: "First trip" });
      expect([order.dispatches.map((row) => [row.status, row.quantity, row.received]), order.atFactory]).toEqual([[["in_transit", "2.0000", null]], "1.0000"]);
      await expect(maker.command(actor, w.workspaceId, wo, { action: "dispatch", id: randomUUID(), quantity: "2" })).rejects.toThrow(/Only 1 of one item at Factory/);
      const move = await buyer.stock.transfer(actor, w.workspaceId, trip);
      await buyer.stock.transferCommand(actor, w.workspaceId, trip, { action: "receive", lines: [{ id: move.lines[0].id, received: "2" }] });
      order = await maker.order(actor, w.workspaceId, wo);
      expect(order.dispatches.map((row) => [row.status, row.received, row.short])).toEqual([["received", "2.0000", false]]);
      // The last one arrives damaged: half is short, and the project gets a snag for it.
      const last = randomUUID();
      await maker.command(actor, w.workspaceId, wo, { action: "dispatch", id: last, quantity: "1" });
      const second = await buyer.stock.transfer(actor, w.workspaceId, last);
      await buyer.stock.transferCommand(actor, w.workspaceId, last, { action: "receive", lines: [{ id: second.lines[0].id, received: "0.5", lossReason: "Corner chipped in the truck" }] });
      const snags = (await w.client.query<{ title: string; description: string; severity: string; source: string; lineId: string }>(
        `SELECT title, description, severity, source, boq_line_id AS "lineId" FROM work_items WHERE project_id = $1 AND type = 'snag'`, [projectId])).rows;
      expect(snags).toEqual([{ title: `Move ${second.transfer.number} arrived short`, description: "Kitchen cabinets 0.5: Corner chipped in the truck", severity: "major", source: "delivery", lineId: cabinets.id }]);
    });
  });

  it("finishes the production stage from the factory's records: everything made and checked", async () => {
    await world(async (w) => {
      const { core, projectId, access, all } = await buying(w);
      const maker = factoryAs(access, w.designer, [...all, "factory.view", "factory.manage", "factory.report", "factory.approve"]);
      const checker = factoryAs(access, w.manager, ["factory.view", "factory.approve"]);
      const scope = await core.scope(actor, w.workspaceId, projectId);
      const [kitchen, general] = scope.packages;
      const cabinets = scope.lines.find((line) => line.title === "Kitchen cabinets")!;
      const worktop = scope.lines.find((line) => line.title === "Worktop")!;
      let detail = await core.get(actor, w.workspaceId, projectId);
      // Only the cabinets are made here; the worktop is bought.
      detail = await core.command(actor, w.workspaceId, projectId, { action: "assign_lines", lineIds: [worktop.id], packageId: general.id, version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", id: kitchen.id, name: "Kitchen joinery", supply: "make", version: detail.project.version });
      const settings = await maker.settings(actor, w.workspaceId);
      await maker.saveSettings(actor, w.workspaceId, { version: settings.settings.version, requireDrawing: false, requirePayment: false, requireMaterials: false, requireCheck: false });
      await w.client.query("UPDATE project_stages SET status = 'done', completed_at = now(), completed_by = $2 WHERE project_id = $1 AND position < 4", [projectId, w.manager]);
      await w.client.query("UPDATE project_stages SET status = 'current', started_at = now() WHERE project_id = $1 AND key = 'production'", [projectId]);
      const made = async () => (await core.get(actor, w.workspaceId, projectId)).stages.find((stage) => stage.key === "production")!.checks.find((check) => check.kind === "everything_made")!.passed;
      expect(await made()).toBe(false);
      const joinery = randomUUID(), wo = randomUUID(), report = randomUUID();
      await maker.saveWorkcenter(actor, w.workspaceId, { id: joinery, name: "Joinery" });
      let order = await maker.plan(actor, w.workspaceId, { id: wo, lineId: cabinets.id, quantity: "4.5", workcenterId: joinery, plannedStart: "2026-10-05", plannedEnd: "2026-10-09" });
      order = await maker.command(actor, w.workspaceId, wo, { action: "release", version: order.order.version });
      order = await maker.command(actor, w.workspaceId, wo, { action: "start", version: order.order.version });
      order = await maker.command(actor, w.workspaceId, wo, { action: "report", id: report, good: "4.5" });
      // With no separate check, approving the output passes it.
      order = await checker.command(actor, w.workspaceId, wo, { action: "decide_report", reportId: report, decision: "approve", version: order.order.version });
      expect(order.order.status).toBe("ready");
      expect(await made()).toBe(true);
    });
  });

  async function buyingStock(w: World, access: (userId: string, permissions: string[]) => never, all: string[]) {
    return new InventoryService(access(w.designer, all)).stock(actor, w.workspaceId);
  }

  /** The project service where each call is its own transaction, as in the app. */
  function projectsAt(w: World, userId: string, permissions = ["projects.manage", "projects.view"]) {
    const asMember = async (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => {
      await w.client.query("SAVEPOINT project_command");
      try {
        const result = await fn(w.client, { userId });
        await w.client.query("RELEASE SAVEPOINT project_command");
        return result;
      } catch (error) {
        await w.client.query("ROLLBACK TO SAVEPOINT project_command");
        throw error;
      }
    };
    return new ProjectCoreService({ asMember, hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never);
  }

  it("cancels a project only once nothing is left half-way: unsent orders, open work and the running sprint close with it, and its stock becomes free stock", async () => {
    await world(async (w) => {
      const { projectId, vendor, buyer, manager, access, all } = await buying(w);
      const core = projectsAt(w, w.manager);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "set_member", role: "designer", membershipId: w.designerMembership, version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "20", unit: "sheets", clientChoice: false, version: detail.project.version });
      const need = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((item) => item.title === "Oak veneer")!;
      // 10 sheets ordered and sent, 6 arrived at the warehouse and 2 of those taken to site; 5 more on an order never sent.
      const sent = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: need.sourceId, quantity: "10", unitPrice: "100", taxRate: "0" }]);
      await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: sent.order.id, place: "warehouse", receivedOn: "2026-09-26", lines: [{ orderLineId: sent.lines[0].id, received: "6" }] });
      const draft = randomUUID();
      await buyer.orders.create(actor, w.workspaceId, { id: draft, vendorId: vendor, lines: [{ source: "material", materialItemId: need.sourceId, quantity: "5", unitPrice: "100", taxRate: "0" }] });
      const store = new InventoryService(access(w.designer, all));
      let stock = await store.stock(actor, w.workspaceId);
      const oak = stock.rows[0];
      const toSite = randomUUID();
      await w.client.query(`INSERT INTO stock_locations (id, workspace_id, kind, name, project_id) VALUES ($1, $2, 'site', 'Villa site', $3)`, [toSite, w.workspaceId, projectId]);
      const out = await store.send(actor, w.workspaceId, { id: randomUUID(), fromLocationId: oak.locationId, toLocationId: toSite, lines: [{ itemId: oak.itemId, projectId, quantity: "2" }] });
      await store.transferCommand(actor, w.workspaceId, out.transfer.id, { action: "receive", lines: [{ id: out.lines[0].id, received: "2" }] });
      // Open work in a running sprint.
      const lead = w.work(w.manager);
      const task = randomUUID(), sprintId = randomUUID();
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: task, title: "Kitchen shop drawings" });
      let plan = await lead.command(actor, w.workspaceId, projectId, { action: "create_sprint", id: sprintId, startDate: "2026-09-28", endDate: "2026-10-09" });
      plan = await lead.command(actor, w.workspaceId, projectId, { action: "set_sprint", itemIds: [task], sprintId });
      await lead.command(actor, w.workspaceId, projectId, { action: "start_sprint", sprintId, version: plan.sprints[0].version });

      detail = await core.get(actor, w.workspaceId, projectId);
      await expect(projectsAt(w, w.manager, ["projects.view"]).command(actor, w.workspaceId, projectId, { action: "cancel", reason: "Client withdrew", version: detail.project.version }))
        .rejects.toThrow(/Only people who manage projects/);
      await expect(core.command(actor, w.workspaceId, projectId, { action: "cancel", reason: " ", version: detail.project.version })).rejects.toThrow(/Say why/);
      let closeOut = await core.closeOut(actor, w.workspaceId, projectId);
      expect(closeOut.owedOrders).toEqual([{ id: sent.order.id, number: sent.order.number, supplierName: "Nile Marble", lines: 1 }]);
      expect(closeOut.siteStock).toEqual([{ itemName: "Oak veneer", unit: "sheets", quantity: "2.0000", locationName: "Villa site" }]);
      expect([closeOut.drafts.map((item) => item.id), closeOut.openWork, closeOut.heldStock.map((item) => item.quantity)]).toEqual([[draft], 1, ["4.0000"]]);
      await expect(core.command(actor, w.workspaceId, projectId, { action: "cancel", reason: "Client withdrew", version: detail.project.version }))
        .rejects.toThrow(new RegExp(`Before the project can be cancelled: ${sent.order.number} is still owed goods; 1 item is still at the site`));

      // The rest of the order is cancelled with the supplier, and the site's sheets come back.
      await buyer.orders.command(actor, w.workspaceId, sent.order.id, { action: "cancel_line", lineId: sent.lines[0].id, reason: "Project cancelled", version: (await buyer.orders.get(actor, w.workspaceId, sent.order.id)).order.version });
      const back = await store.send(actor, w.workspaceId, { id: randomUUID(), fromLocationId: toSite, toLocationId: oak.locationId, lines: [{ itemId: oak.itemId, projectId, quantity: "2" }] });
      closeOut = await core.closeOut(actor, w.workspaceId, projectId);
      expect(closeOut.blockers).toEqual([`move ${back.transfer.number} is on its way`]);
      await store.transferCommand(actor, w.workspaceId, back.transfer.id, { action: "receive", lines: [{ id: back.lines[0].id, received: "2" }] });
      expect((await core.closeOut(actor, w.workspaceId, projectId)).blockers).toEqual([]);

      detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "cancel", reason: "Client withdrew", version: detail.project.version });
      expect(detail.project).toMatchObject({ status: "cancelled", cancelReason: "Client withdrew", closedByName: "Omar Manager" });
      expect(detail.project.closedAt).toBeTruthy();
      expect((await buyer.orders.get(actor, w.workspaceId, draft)).order.status).toBe("cancelled");
      const board = await lead.board(actor, w.workspaceId, projectId);
      expect(board.items.map((item) => item.status)).toEqual(["cancelled"]);
      expect(board.sprints[0].status).toBe("closed");
      expect((await w.client.query("SELECT outcome FROM work_sprint_commitments WHERE sprint_id = $1", [sprintId])).rows).toEqual([{ outcome: "removed" }]);
      // The sheets are free stock now, at the value they had; the site is no longer a place.
      stock = await store.stock(actor, w.workspaceId);
      expect(stock.rows.map((row) => [row.projectId, row.onHand, row.value])).toEqual([[null, "6.0000", "600.0000"]]);
      expect(stock.locations.some((location) => location.id === toSite)).toBe(false);
      expect(stock.projects.some((project) => project.id === projectId)).toBe(false);
      const told = (await w.client.query("SELECT recipient_id AS id, channel FROM notifications WHERE workspace_id = $1 AND event_type = 'project.cancelled' ORDER BY channel", [w.workspaceId])).rows;
      expect(told).toEqual([{ id: w.designer, channel: "email" }, { id: w.designer, channel: "in_app" }]);
      // A cancelled project is a record: nothing changes, and it doesn't reopen.
      await expect(core.command(actor, w.workspaceId, projectId, { action: "post_update", health: "on_track", note: "", version: detail.project.version })).rejects.toThrow(/closed/);
      await expect(core.command(actor, w.workspaceId, projectId, { action: "reopen", reason: "Mistake", version: detail.project.version })).rejects.toThrow(/Only a completed project/);
      expect((await buyer.orders.needs(actor, w.workspaceId)).needs.some((item) => item.title === "Oak veneer")).toBe(false);
    });
  });

  it("completes a project at its last stage only once its work is finished, frees its leftover stock, and reopens with why", async () => {
    await world(async (w) => {
      const { projectId, access, all } = await buying(w);
      const core = projectsAt(w, w.manager);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "set_member", role: "designer", membershipId: w.designerMembership, version: detail.project.version });
      // Twenty spare hinges reserved for the project in the warehouse.
      const store = new InventoryService(access(w.designer, all));
      await store.saveLocation(actor, w.workspaceId, { id: randomUUID(), kind: "warehouse", name: "Warehouse" });
      let stock = await store.stock(actor, w.workspaceId);
      stock = await store.command(actor, w.workspaceId, { id: randomUUID(), action: "add", name: "Hinges", unit: "nos", locationId: stock.locations[0].id, quantity: "20", unitCost: "3", reason: "Opening stock" });
      stock = await store.command(actor, w.workspaceId, { id: randomUUID(), action: "allocate", itemId: stock.rows[0].itemId, locationId: stock.rows[0].locationId, forProjectId: projectId, quantity: "20", reason: "Kitchen" });
      const lead = w.work(w.manager);
      const task = randomUUID();
      await lead.command(actor, w.workspaceId, projectId, { action: "create", id: task, title: "Final clean" });
      await w.client.query("UPDATE project_stages SET status = 'done', completed_at = now(), completed_by = $2 WHERE project_id = $1 AND key <> 'handover'", [projectId, w.manager]);
      await w.client.query("UPDATE project_stages SET status = 'current', started_at = now() WHERE project_id = $1 AND key = 'handover'", [projectId]);
      detail = await core.get(actor, w.workspaceId, projectId);
      const handover = detail.stages.find((stage) => stage.key === "handover")!;
      await acceptHandover(w, projectId);
      await expect(core.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: handover.id, version: detail.project.version }))
        .rejects.toThrow("Before the project closes: 1 piece of work is open.");
      detail = await core.get(actor, w.workspaceId, projectId);
      expect([detail.project.status, detail.stages.find((stage) => stage.key === "handover")!.status]).toEqual(["active", "current"]);

      const item = (await lead.board(actor, w.workspaceId, projectId)).items[0];
      await lead.command(actor, w.workspaceId, projectId, { action: "update", itemId: task, version: item.version, status: "done" });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: handover.id, version: detail.project.version });
      expect(detail.project).toMatchObject({ status: "completed", closedByName: "Omar Manager", cancelReason: null });
      stock = await store.stock(actor, w.workspaceId);
      expect(stock.rows.map((row) => [row.projectId, row.onHand, row.value])).toEqual([[null, "20.0000", "60.0000"]]);
      const told = (await w.client.query("SELECT recipient_id AS id FROM notifications WHERE workspace_id = $1 AND event_type = 'project.completed'", [w.workspaceId])).rows;
      expect(told).toEqual([{ id: w.designer }]);

      await expect(projectsAt(w, w.manager, ["projects.view"]).command(actor, w.workspaceId, projectId, { action: "reopen", reason: "Handover signed too early", version: detail.project.version }))
        .rejects.toThrow(/Only people who manage projects/);
      await expect(core.command(actor, w.workspaceId, projectId, { action: "reopen", reason: "", version: detail.project.version })).rejects.toThrow(/Say why/);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "reopen", reason: "Handover signed too early", version: detail.project.version });
      expect([detail.project.status, detail.project.closedAt, detail.stages.find((stage) => stage.key === "handover")!.status]).toEqual(["active", null, "current"]);
      expect((await w.client.query("SELECT recipient_id AS id FROM notifications WHERE workspace_id = $1 AND event_type = 'project.reopened'", [w.workspaceId])).rows).toEqual([{ id: w.designer }]);
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
