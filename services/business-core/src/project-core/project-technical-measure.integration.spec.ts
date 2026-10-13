import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { DEFAULT_ROLES } from "./project-checks";
import { ProjectCoreService } from "./project-core.service";
import { drawingsGate, measureGate } from "./project-drawings";
import { ProjectDrawingsService } from "./project-drawings.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const MANAGE = ["projects.manage", "projects.view", "pre_projects.view", "pre_projects.edit", "workspace.settings.manage"];
const TEAM = ["projects.view", "pre_projects.view"];
const FACTORY = ["factory.view", "factory.manage"];
const PDF = (text: string) => ({ buffer: Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`), originalname: `${text}.pdf`, mimetype: "application/pdf", size: 40 });

type Person = { user: string; membership: string };
type World = {
  client: PoolClient; workspaceId: string; caseId: string; quoteId: string; today: string;
  pm: Person; tech: Person; designer: Person; factory: Person;
  core: (userId: string, permissions: string[]) => ProjectCoreService;
  drawings: (userId: string, permissions: string[]) => ProjectDrawingsService;
  notices: (code: string, channel?: string) => Promise<Array<{ recipient: string; subject: string; body: string }>>;
};

integration("PLM-149: the technical site measure before shop drawings, and the lead designer between the drawings and the client", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), party = randomUUID(), opportunity = randomUUID(), kitchen = randomUUID();
    const person = (): Person => ({ user: randomUUID(), membership: randomUUID() });
    const pm = person(), tech = person(), designer = person(), factory = person();
    try {
      await client.query("BEGIN");
      const names: Array<[Person, string]> = [[pm, "Omar Manager"], [tech, "Tara Technical"], [designer, "Lina Lead"], [factory, "Faris Factory"]];
      for (const [who, name] of names) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [who.user, `${who.user.slice(0, 8)}@example.com`, name]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','UTC',$3)", [workspaceId, `tm-${workspaceId.slice(0, 8)}`, pm.user]);
      for (const [who] of names) await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [who.membership, workspaceId, who.user]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), pm.membership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, pm.user]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      const role = randomUUID();
      await client.query("INSERT INTO roles (id, workspace_id, code, name) VALUES ($1, $2, 'factory', 'factory')", [role, workspaceId]);
      await client.query("INSERT INTO role_permissions (workspace_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE code = ANY($3::text[])", [workspaceId, role, FACTORY]);
      await client.query("INSERT INTO member_roles (workspace_id, membership_id, role_id) VALUES ($1, $2, $3)", [workspaceId, factory.membership, role]);
      const today = (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE 'UTC')::date::text AS today`)).rows[0].today;
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const run = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const member = (userId: string) => (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const access = (userId: string, permissions: string[]) => ({
        asMember: member(userId), withPermission: run(userId), withAnyPermission: run(userId),
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code),
      } as never);
      const builder = new QuotationBuilderService({ withPermission: run(pm.user), withPermissions: run(pm.user), withAnyPermission: run(pm.user), hasPermission: async () => true } as never, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [{ op: "upsert", line: { id: "a", title: "Kitchen cabinets", unit: "m", quantity: "4", rate: "1000", areaId: kitchen } }] });
      const loaded = (await commercialRepository.load(client, workspaceId, caseId))!;
      const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
      const quote = data.quotes.find((item) => item.id === quoteId)!;
      quote.status = "accepted";
      quote.hash = freezeHash(quote);
      quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: 4000, optionsTotal: 0, acceptedTotal: 4000,
        decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
      data.agreement = { quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
      data.payments = [{ id: "p1", sourceQuoteId: quoteId, title: "Advance", amount: 4000, dueDate: "", requiredForRelease: true, requiredForProduction: false, status: "verified", proof: "bank transfer",
        reference: "TT-1", evidenceKind: "operational" }];
      data.revision = loaded.revision + 1;
      await commercialRepository.save(client, workspaceId, caseId, data);
      const storage = new Map<string, Buffer>();
      const files = { put: async (key: string, body: Buffer) => { storage.set(key, body); }, read: async (key: string) => ({ body: storage.get(key)! }) } as never;
      await run_({
        client, workspaceId, caseId, quoteId, today, pm, tech, designer, factory,
        core: (userId, permissions) => new ProjectCoreService(access(userId, permissions)),
        drawings: (userId, permissions) => new ProjectDrawingsService(access(userId, permissions), files),
        notices: async (code, channel = "in_app") => (await client.query<{ recipient: string; subject: string; body: string }>(
          `SELECT recipient_id AS recipient, subject, body FROM notifications WHERE workspace_id=$1 AND event_type=$2 AND channel=$3 ORDER BY created_at`, [workspaceId, code, channel])).rows,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    async function run_(value: World) { await run(value); }
  }

  /** The route Palm configures (PLM-149): the measure, the drawings, the lead designer's design check, the client's approval. */
  async function startProject(w: World, checks = ["technical_measure_done", "drawings_uploaded", "drawings_design_checked", "drawings_client_approved"]) {
    const pm = w.core(w.pm.user, MANAGE);
    const current = await pm.settings(actor, w.workspaceId);
    await pm.saveSettings(actor, w.workspaceId, { version: current.settings.version, roles: [...DEFAULT_ROLES, { key: "lead_designer", label: "Lead interior designer" }],
      drawingsClientRole: "lead_designer", technicalMeasureDays: 3 });
    const settings = await pm.saveTemplate(actor, w.workspaceId, { name: "Joinery", isDefault: true, stages: [
      { name: "Technical drawings", ownerRole: "technical_designer", checks: checks.map((kind) => ({ kind })) },
      { name: "Production", ownerRole: "factory_lead", checks: [{ kind: "everything_made" }] },
    ] });
    const templateId = settings.templates.find((template) => template.name === "Joinery")!.id;
    const { projectId } = await pm.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.pm.membership, templateId });
    let detail = await pm.get(actor, w.workspaceId, projectId);
    for (const [role, who] of [["technical_designer", w.tech], ["lead_designer", w.designer]] as const)
      detail = await pm.command(actor, w.workspaceId, projectId, { action: "set_member", role, membershipId: who.membership, version: detail.project.version });
    return { projectId, detail };
  }

  const tasks = async (w: World, projectId: string) => (await w.client.query<{ title: string; status: string; assignee: string | null; due: string | null }>(
    `SELECT title, status, assignee_membership_id AS assignee, due_date::text AS due FROM work_items WHERE workspace_id = $1 AND project_id = $2 AND stage_check IS NOT NULL ORDER BY number`,
    [w.workspaceId, projectId])).rows;
  const measureBody = (measureId: string, today: string) => ({ action: "record_technical_measure", measureId, measuredOn: today, note: "Sink wall out of plumb by 5 mm",
    lines: [{ area: "Kitchen", label: "Sink wall width", value: 3195, unit: "mm" }, { area: "Kitchen", label: "Ceiling height", value: 2.8, unit: "m" }] });

  it("opens the measure first with its due date, blocks shop drawings until it is recorded by the project manager or the factory, then moves to the drawings", async () => {
    await world(async (w) => {
      const { projectId } = await startProject(w);
      const open = (await tasks(w, projectId)).filter((task) => task.status === "todo");
      expect(open).toEqual([expect.objectContaining({ title: "Technical site measure", assignee: w.pm.membership })]);
      expect(open[0].due).not.toBeNull();
      expect(open[0].due! > w.today).toBe(true);
      expect(await measureGate(w.client, w.workspaceId, projectId)).toEqual({ required: true, done: false });

      // Shop drawings can't start before the measure.
      const tech = w.drawings(w.tech.user, TEAM);
      let state = await tech.read(actor, w.workspaceId, projectId);
      expect(state.canUpload).toBe(false);
      expect(state.measure).toMatchObject({ required: true, done: false, measures: [], unit: "mm", canRecord: false });
      await expect(tech.upload(actor, w.workspaceId, projectId, randomUUID(), randomUUID(), "drawing", PDF("too early"))).rejects.toThrow("Record the technical site measure first.");
      // The technical team doesn't take the measure.
      const detail = await w.core(w.tech.user, TEAM).get(actor, w.workspaceId, projectId);
      await expect(w.core(w.tech.user, TEAM).command(actor, w.workspaceId, projectId, { ...measureBody(randomUUID(), w.today), version: detail.project.version }))
        .rejects.toThrow("Only the project manager or the factory team records the technical measure.");

      // The factory (not on the project) takes it, with its photo; replayed, nothing changes.
      const factory = w.core(w.factory.user, FACTORY);
      const measureId = randomUUID();
      await expect(factory.command(actor, w.workspaceId, projectId, { ...measureBody(measureId, "2999-01-01"), version: detail.project.version })).rejects.toThrow("future");
      let after = await factory.command(actor, w.workspaceId, projectId, { ...measureBody(measureId, w.today), version: detail.project.version });
      after = await factory.command(actor, w.workspaceId, projectId, { ...measureBody(measureId, w.today), version: after.project.version });
      await expect(factory.command(actor, w.workspaceId, projectId, { ...measureBody(measureId, w.today), note: "Other", version: after.project.version }))
        .rejects.toThrow("already recorded with other values");
      state = await w.drawings(w.factory.user, FACTORY).uploadMeasureFile(actor, w.workspaceId, projectId, measureId, randomUUID(), PDF("site sketch"));
      await expect(tech.uploadMeasureFile(actor, w.workspaceId, projectId, measureId, randomUUID(), PDF("not mine"))).rejects.toThrow(/project manager or the factory/);
      expect(state.measure!.measures).toEqual([expect.objectContaining({ id: measureId, measuredOn: w.today, byName: "Faris Factory", note: "Sink wall out of plumb by 5 mm",
        lines: [{ area: "Kitchen", label: "Sink wall width", value: "3195", unit: "mm" }, { area: "Kitchen", label: "Ceiling height", value: "2.8", unit: "m" }],
        files: [expect.objectContaining({ name: "site sketch.pdf" })] })]);
      expect(state.measure!.done).toBe(true);
      const metres = (await w.client.query<{ metres: string }>(`SELECT value_metres::text AS metres FROM project_technical_measure_lines WHERE workspace_id = $1 AND measure_id = $2 ORDER BY position`,
        [w.workspaceId, measureId])).rows.map((row) => Number(row.metres));
      expect(metres).toEqual([3.195, 2.8]);

      // The measure task is done by its record; the technical drawer has the drawings task and can upload.
      expect((await tasks(w, projectId)).map((task) => `${task.title}:${task.status}`)).toEqual(["Technical site measure:done", "Technical drawings:todo"]);
      expect((await tech.read(actor, w.workspaceId, projectId)).canUpload).toBe(true);
      // The technical drawer hears the drawings task once the measure is in (the project manager opened the measure task himself).
      expect((await w.notices("work.assigned")).some((row) => row.recipient === w.tech.user && /Technical drawings/.test(`${row.subject} ${row.body}`))).toBe(true);
    });
  });

  it("lets only the lead designer (or the project manager) check the drawings match the design, send them and record the client's approval", async () => {
    await world(async (w) => {
      const { projectId } = await startProject(w);
      const pm = w.core(w.pm.user, MANAGE);
      let detail = await pm.command(actor, w.workspaceId, projectId, { ...measureBody(randomUUID(), w.today), version: (await pm.get(actor, w.workspaceId, projectId)).project.version });
      const r1 = randomUUID();
      const tech = w.drawings(w.tech.user, TEAM);
      let state = await tech.upload(actor, w.workspaceId, projectId, r1, randomUUID(), "drawing", PDF("kitchen r1"));
      expect(state).toMatchObject({ check: "design", canCheck: false, canSend: false });
      expect((await tasks(w, projectId)).filter((task) => task.status === "todo")).toEqual([expect.objectContaining({ title: "Check the drawings match the design", assignee: w.designer.membership })]);
      // The technical team can't check against the design nor talk to the client.
      await expect(w.core(w.tech.user, TEAM).command(actor, w.workspaceId, projectId, { action: "check_drawings", revisionId: r1, result: "ok", version: state.version }))
        .rejects.toThrow("Only the lead interior designer or the project manager checks the drawings match the design.");
      await expect(w.core(w.tech.user, TEAM).command(actor, w.workspaceId, projectId, { action: "send_drawings", revisionId: r1, version: state.version }))
        .rejects.toThrow("Only the lead interior designer or the project manager sends the drawings to the client.");
      const lead = w.core(w.designer.user, TEAM);
      await expect(lead.command(actor, w.workspaceId, projectId, { action: "send_drawings", revisionId: r1, version: state.version })).rejects.toThrow("Check the drawings match the design first.");

      // The design check finds a mismatch: the technical team hears, the drawings task opens again.
      detail = await lead.command(actor, w.workspaceId, projectId, { action: "check_drawings", revisionId: r1, result: "changes", note: "Handles differ from the render", version: state.version });
      expect((await w.notices("project.drawings_changes")).map((row) => row.recipient)).toContain(w.tech.user);
      expect((await tasks(w, projectId)).filter((task) => task.status === "todo").map((task) => task.title)).toEqual(["Technical drawings"]);
      // R2: matches; the lead designer sends it and records the client's signed approval: the production release.
      const r2 = randomUUID();
      state = await tech.upload(actor, w.workspaceId, projectId, r2, randomUUID(), "drawing", PDF("kitchen r2"));
      detail = await lead.command(actor, w.workspaceId, projectId, { action: "check_drawings", revisionId: r2, result: "ok", version: state.version });
      expect(detail.next).toMatchObject({ kind: "drawings_client_approved", role: "lead_designer", owner: "Lina Lead" });
      state = await w.drawings(w.designer.user, TEAM).read(actor, w.workspaceId, projectId);
      expect(state.revisions[0]).toMatchObject({ number: 2, status: "checked", checkKind: "design", siteCheckedByName: "Lina Lead" });
      expect(state).toMatchObject({ canSend: true, canDecide: false });
      expect((await tasks(w, projectId)).filter((task) => task.status === "todo")).toEqual([expect.objectContaining({ title: "Client approval of the drawings", assignee: w.designer.membership })]);
      detail = await lead.command(actor, w.workspaceId, projectId, { action: "send_drawings", revisionId: r2, version: detail.project.version });
      await expect(tech.upload(actor, w.workspaceId, projectId, r2, randomUUID(), "approval", PDF("signed by tech"))).rejects.toThrow(/records the client's approval/);
      state = await w.drawings(w.designer.user, TEAM).upload(actor, w.workspaceId, projectId, r2, randomUUID(), "approval", PDF("signed"));
      detail = await lead.command(actor, w.workspaceId, projectId, { action: "decide_drawings", revisionId: r2, decision: "approve", decidedOn: w.today, decidedBy: "Maya Client",
        version: state.version });
      expect(detail.stages[0]).toMatchObject({ status: "done", finishedAutomatically: true });
      expect(await drawingsGate(w.client, w.workspaceId, projectId)).toEqual({ required: true, approved: true });
    });
  });

  it("doesn't block an older project whose drawings started before the measure, nor a route without it", async () => {
    await world(async (w) => {
      const { projectId } = await startProject(w);
      // Drawings that existed before the route asked for the measure (written as an older release would have).
      await w.client.query(`INSERT INTO project_drawing_revisions (id, workspace_id, project_id, number, created_by) VALUES ($1, $2, $3, 1, $4)`,
        [randomUUID(), w.workspaceId, projectId, w.tech.user]);
      expect(await measureGate(w.client, w.workspaceId, projectId)).toEqual({ required: true, done: true });
      const detail = await w.core(w.pm.user, MANAGE).get(actor, w.workspaceId, projectId);
      expect(detail.stages[0].checks.find((check) => check.kind === "technical_measure_done")).toMatchObject({ passed: true });
    });
    await world(async (w) => {
      const { projectId } = await startProject(w, ["drawings_uploaded", "drawings_site_checked", "drawings_client_approved"]);
      expect(await measureGate(w.client, w.workspaceId, projectId)).toEqual({ required: false, done: true });
      const state = await w.drawings(w.tech.user, TEAM).read(actor, w.workspaceId, projectId);
      expect(state).toMatchObject({ measure: null, canUpload: true, check: "site" });
      const detail = await w.core(w.pm.user, MANAGE).get(actor, w.workspaceId, projectId);
      await expect(w.core(w.pm.user, MANAGE).command(actor, w.workspaceId, projectId, { ...measureBody(randomUUID(), w.today), version: detail.project.version }))
        .rejects.toThrow("This project's route has no technical measure.");
    });
  });

  it("validates who sends drawings and the measure's due days in the settings", async () => {
    await world(async (w) => {
      const pm = w.core(w.pm.user, MANAGE);
      const current = await pm.settings(actor, w.workspaceId);
      expect(current.settings).toMatchObject({ drawingsClientRole: null, technicalMeasureDays: null });
      await expect(pm.saveSettings(actor, w.workspaceId, { version: current.settings.version, drawingsClientRole: "nobody" })).rejects.toThrow("from the project roles");
      await expect(pm.saveSettings(actor, w.workspaceId, { version: current.settings.version, technicalMeasureDays: 0 })).rejects.toThrow("1 to 60 working days");
      const roles = [...DEFAULT_ROLES, { key: "lead_designer", label: "Lead interior designer" }];
      const saved = await pm.saveSettings(actor, w.workspaceId, { version: current.settings.version, roles, drawingsClientRole: "lead_designer", technicalMeasureDays: 4 });
      expect(saved.settings).toMatchObject({ drawingsClientRole: "lead_designer", technicalMeasureDays: 4 });
      // Removing the role drops it from who sends the drawings.
      const removed = await pm.saveSettings(actor, w.workspaceId, { version: saved.settings.version, roles: DEFAULT_ROLES });
      expect(removed.settings.drawingsClientRole).toBeNull();
    });
  });
});
