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
