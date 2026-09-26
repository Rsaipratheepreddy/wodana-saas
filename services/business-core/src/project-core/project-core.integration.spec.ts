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

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

type World = {
  client: PoolClient; workspaceId: string; caseId: string; quoteId: string; manager: string; designer: string; managerMembership: string; designerMembership: string;
  as: (userId: string, permissions?: string[]) => ProjectCoreService; builder: QuotationBuilderService;
};

integration("projects core (plan §6.10)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(work: (world: World) => Promise<void>) {
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
      const as = (userId: string, permissions = ["projects.manage", "projects.view", "pre_projects.view", "workspace.settings.manage"]) => new ProjectCoreService({
        asMember: member(userId), withPermission: run(userId), withAnyPermission: run(userId),
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code),
      } as never);
      const builder = new QuotationBuilderService({ withPermission: run(manager), withPermissions: run(manager), withAnyPermission: run(manager), hasPermission: async () => true } as never, {} as never);
      // The quote: two lines, one option the client chose and one they didn't.
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "a", title: "Kitchen cabinets", unit: "m", quantity: "4.5", rate: "1200", areaId: kitchen } },
        { op: "upsert", line: { id: "b", title: "Worktop", unit: "m²", quantity: "2.25", rate: "800", areaId: kitchen } },
        { op: "upsert", line: { id: "c", title: "Under-cabinet lights", unit: "nos", quantity: "1", rate: "650", optional: true } },
        { op: "upsert", line: { id: "d", title: "Wine fridge", unit: "nos", quantity: "1", rate: "3000", optional: true } },
      ] });
      await work({ client, workspaceId, caseId, quoteId, manager, designer, managerMembership, designerMembership, as, builder });
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

      // The material sign-off belongs to the designer: name them, and they can confirm and finish it.
      detail = await manager.command(actor, w.workspaceId, projectId, { action: "set_member", role: "designer", membershipId: w.designerMembership, version: detail.project.version });
      const designer = w.as(w.designer, ["projects.view"]);
      const materials = detail.stages[1];
      detail = await designer.command(actor, w.workspaceId, projectId, { action: "confirm_check", stageId: materials.id, checkKey: "signed", version: detail.project.version });
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
