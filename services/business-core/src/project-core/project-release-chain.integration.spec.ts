import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { processStagesReady } from "./delivery-reminders";
import { ProjectCoreService } from "./project-core.service";
import { drawingsGate } from "./project-drawings";
import { ProjectDrawingsService } from "./project-drawings.service";
import { noticeReadyToStart } from "./project-release";
import { ProjectWorkService } from "./project-work.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const MANAGE = ["projects.manage", "projects.view", "pre_projects.view", "pre_projects.edit", "workspace.settings.manage"];
const TEAM = ["projects.view", "pre_projects.view"];
const FACTORY = ["factory.view", "factory.manage"];
const PDF = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);

type Person = { user: string; membership: string };
type World = {
  client: PoolClient; workspaceId: string; caseId: string; quoteId: string; today: string;
  pm: Person; tech: Person; factory: Person; ops: Person;
  core: (userId: string, permissions: string[]) => ProjectCoreService;
  drawings: (userId: string, permissions: string[]) => ProjectDrawingsService;
  work: (userId: string, permissions: string[]) => ProjectWorkService;
  notices: (code: string, channel?: string) => Promise<Array<{ recipient: string; subject: string; body: string; link: string }>>;
  verifyProductionPayment: () => Promise<void>;
};

integration("technical drawings to production release (PLM-056 … 062, 068)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  /** An accepted, signed quote with its advance verified; the joinery deposit (before production) still pending. */
  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), party = randomUUID(), opportunity = randomUUID(), kitchen = randomUUID();
    const person = (): Person => ({ user: randomUUID(), membership: randomUUID() });
    const pm = person(), tech = person(), factory = person(), ops = person();
    try {
      await client.query("BEGIN");
      const names: Array<[Person, string]> = [[pm, "Omar Manager"], [tech, "Tara Technical"], [factory, "Faris Factory"], [ops, "Olga Ops"]];
      for (const [who, name] of names) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [who.user, `${who.user.slice(0, 8)}@example.com`, name]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','UTC',$3)", [workspaceId, `rc-${workspaceId.slice(0, 8)}`, pm.user]);
      for (const [who] of names) await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [who.membership, workspaceId, who.user]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), pm.membership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, pm.user]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      // The people who run the factory and the people who start projects hold their permissions through roles.
      for (const [who, code, permissions] of [[factory, "factory", FACTORY], [ops, "operations", ["projects.manage"]]] as const) {
        const role = randomUUID();
        await client.query("INSERT INTO roles (id, workspace_id, code, name) VALUES ($1, $2, $3, $3)", [role, workspaceId, code]);
        await client.query("INSERT INTO role_permissions (workspace_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE code = ANY($3::text[])", [workspaceId, role, permissions]);
        await client.query("INSERT INTO member_roles (workspace_id, membership_id, role_id) VALUES ($1, $2, $3)", [workspaceId, who.membership, role]);
      }
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
      data.payments = [
        { id: "p1", sourceQuoteId: quoteId, title: "Advance", amount: 2000, dueDate: "", requiredForRelease: true, requiredForProduction: false, status: "verified", proof: "bank transfer", reference: "TT-1", evidenceKind: "operational" },
        { id: "p2", sourceQuoteId: quoteId, title: "Joinery deposit", amount: 2000, dueDate: today, requiredForRelease: false, requiredForProduction: true, status: "pending", proof: "", reference: "" },
      ];
      data.revision = loaded.revision + 1;
      await commercialRepository.save(client, workspaceId, caseId, data);
      const storage = new Map<string, Buffer>();
      const files = { put: async (key: string, body: Buffer) => { storage.set(key, body); }, read: async (key: string) => ({ body: storage.get(key)! }) } as never;
      await run_({
        client, workspaceId, caseId, quoteId, today, pm, tech, factory, ops,
        core: (userId, permissions) => new ProjectCoreService(access(userId, permissions)),
        drawings: (userId, permissions) => new ProjectDrawingsService(access(userId, permissions), files),
        work: (userId, permissions) => new ProjectWorkService(access(userId, permissions)),
        notices: async (code, channel = "in_app") => (await client.query<{ recipient: string; subject: string; body: string; link: string }>(
          `SELECT recipient_id AS recipient, subject, body, deep_link AS link FROM notifications WHERE workspace_id=$1 AND event_type=$2 AND channel=$3 ORDER BY created_at`,
          [workspaceId, code, channel])).rows,
        verifyProductionPayment: async () => {
          const current = (await commercialRepository.load(client, workspaceId, caseId))!;
          const next = { ...(current.content as CommercialData), revision: current.revision + 1 };
          next.payments = next.payments.map((payment) => payment.id === "p2" ? { ...payment, status: "verified", proof: "bank transfer", reference: "TT-2", evidenceKind: "operational" } : payment);
          await commercialRepository.save(client, workspaceId, caseId, next);
        },
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    async function run_(value: World) { await run(value); }
  }

  /** The route Palm would configure: the slot at kickoff, the drawing chain, then production. */
  async function startProject(w: World) {
    const settings = await w.core(w.pm.user, MANAGE).saveTemplate(actor, w.workspaceId, { name: "Joinery", isDefault: true, stages: [
      { name: "Kickoff", ownerRole: "project_manager", checks: [{ kind: "lead_assigned" }, { kind: "factory_slot_booked" }] },
      { name: "Technical drawings", ownerRole: "technical_designer", checks: [{ kind: "drawings_uploaded" }, { kind: "drawings_site_checked" }, { kind: "drawings_client_approved" }] },
      { name: "Production", ownerRole: "factory_lead", checks: [{ kind: "everything_made" }] },
      { name: "Handover", ownerRole: "project_manager", checks: [{ kind: "confirm", label: "Keys handed over" }] },
    ] });
    const templateId = settings.templates.find((template) => template.name === "Joinery")!.id;
    const { projectId } = await w.core(w.pm.user, MANAGE).start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.pm.membership, templateId });
    let detail = await w.core(w.pm.user, MANAGE).get(actor, w.workspaceId, projectId);
    for (const [role, who] of [["technical_designer", w.tech], ["factory_lead", w.factory]] as const)
      detail = await w.core(w.pm.user, MANAGE).command(actor, w.workspaceId, projectId, { action: "set_member", role, membershipId: who.membership, version: detail.project.version });
    return { projectId, detail };
  }

  const tasks = async (w: World, projectId: string) => (await w.client.query<{ id: string; title: string; status: string; assignee: string | null; version: number }>(
    `SELECT id, title, status, assignee_membership_id AS assignee, version FROM work_items WHERE workspace_id = $1 AND project_id = $2 AND stage_check IS NOT NULL ORDER BY number`,
    [w.workspaceId, projectId])).rows;

  it("PLM-056: the people who start projects hear at once when the deal is approved, until the project starts with its project manager", async () => {
    await world(async (w) => {
      expect(await noticeReadyToStart(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, actorUserId: w.pm.user })).toBe(1);
      expect(await noticeReadyToStart(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, actorUserId: w.pm.user })).toBe(0);
      const told = await w.notices("project.ready_to_start");
      expect(told).toEqual([expect.objectContaining({ recipient: w.ops.user, subject: "Ready to start · O-1 · Villa 12", link: `/workspace/projects?start=${w.caseId}` })]);
      expect(await w.notices("project.ready_to_start", "email")).toHaveLength(1);
      await startProject(w);
      // Started (with its project manager): nobody is asked again.
      await w.client.query(`DELETE FROM notifications WHERE workspace_id = $1 AND event_type = 'project.ready_to_start'`, [w.workspaceId]);
      expect(await noticeReadyToStart(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, actorUserId: w.pm.user })).toBe(0);
    });
  });

  it("PLM-068: the factory hears to book its slot once the joinery deposit is in, and books it on the project", async () => {
    await world(async (w) => {
      const { projectId } = await startProject(w);
      // The kickoff asks for a slot: its task waits with the factory lead, but nobody is told to book before the deposit.
      expect(await tasks(w, projectId)).toEqual([expect.objectContaining({ title: "Book the factory slot", status: "todo" })]);
      expect(await w.notices("project.factory_slot_due")).toEqual([]);
      await w.verifyProductionPayment();
      await processStagesReady(w.client, w.workspaceId);
      await processStagesReady(w.client, w.workspaceId);
      expect((await w.notices("project.factory_slot_due")).map((row) => row.recipient)).toEqual([w.factory.user]);
      expect(await w.notices("project.factory_slot_due", "email")).toHaveLength(1);
      // The factory (not on the team beyond its lead role) books the slot; the project manager hears.
      const outsider = await w.core(w.factory.user, FACTORY).get(actor, w.workspaceId, projectId);
      expect(outsider.canBookSlot).toBe(true);
      expect(outsider.canManage).toBe(false);
      const booked = await w.core(w.factory.user, FACTORY).command(actor, w.workspaceId, projectId, { action: "book_factory_slot", date: "2026-11-02", note: "Line 2", version: outsider.project.version });
      expect(booked.factorySlot).toMatchObject({ date: "2026-11-02", note: "Line 2", byName: "Faris Factory" });
      expect((await w.notices("project.factory_slot_booked")).map((row) => row.recipient)).toEqual([w.pm.user]);
      expect(await tasks(w, projectId)).toEqual([expect.objectContaining({ title: "Book the factory slot", status: "done" })]);
      expect(booked.stages[0].checks.every((check) => check.passed)).toBe(true);
      // Someone outside the project and the factory can't book it.
      await expect(w.core(w.tech.user, TEAM).command(actor, w.workspaceId, projectId, { action: "book_factory_slot", date: "2026-11-03", version: booked.project.version }))
        .rejects.toThrow(/project manager or the factory/);
    });
  });

  it("PLM-057 … 062: drawings uploaded, checked on site, approved by the client: the factory is released and the project moves to Production", async () => {
    await world(async (w) => {
      const { projectId } = await startProject(w);
      const pm = w.core(w.pm.user, MANAGE);
      let detail = await pm.command(actor, w.workspaceId, projectId, { action: "book_factory_slot", date: "2026-11-02", version: (await pm.get(actor, w.workspaceId, projectId)).project.version });
      detail = await pm.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: detail.stages[0].id, version: detail.project.version });
      expect(detail.stages[1]).toMatchObject({ name: "Technical drawings", status: "current" });
      // Unlocked by the stage: the technical drawer has the drawings task, with links to what it needs.
      let open = (await tasks(w, projectId)).filter((task) => task.status === "todo");
      expect(open).toEqual([expect.objectContaining({ title: "Technical drawings", assignee: w.tech.membership })]);
      const sheet = await w.work(w.tech.user, TEAM).item(actor, w.workspaceId, projectId, open[0].id);
      expect(sheet.links.map((link: { key: string }) => link.key)).toEqual(["drawings", "measurements", "materials", "designs"]);
      expect((await w.notices("work.assigned")).some((row) => row.recipient === w.tech.user && /Technical drawings/.test(`${row.subject} ${row.body}`))).toBe(true);
      // Production waits for the client's approval.
      expect(await drawingsGate(w.client, w.workspaceId, projectId)).toEqual({ required: true, approved: false });

      // R1: uploaded by the technical drawer; the site check comes next, for the drawer and the project manager.
      const r1 = randomUUID();
      const drawings = w.drawings(w.tech.user, TEAM);
      let state = await drawings.upload(actor, w.workspaceId, projectId, r1, randomUUID(), "drawing", { buffer: PDF("kitchen r1"), originalname: "kitchen.pdf", mimetype: "application/pdf", size: 40 });
      expect(state.revisions).toEqual([expect.objectContaining({ number: 1, status: "uploaded" })]);
      expect(state.canCheck).toBe(true);
      open = (await tasks(w, projectId)).filter((task) => task.status === "todo");
      expect(open).toEqual([expect.objectContaining({ title: "Technical site check", assignee: w.tech.membership })]);
      // A record-driven task is done by its record, not by hand.
      await expect(w.work(w.tech.user, TEAM).command(actor, w.workspaceId, projectId, { action: "update", itemId: open[0].id, version: open[0].version, status: "done" }))
        .rejects.toThrow(/finishes by itself/);
      detail = await pm.get(actor, w.workspaceId, projectId);
      await expect(pm.command(actor, w.workspaceId, projectId, { action: "send_drawings", revisionId: r1, version: detail.project.version })).rejects.toThrow("Record the technical site check first.");

      // The project manager's site check finds changes: the drawer hears and the drawings task opens again.
      await expect(pm.command(actor, w.workspaceId, projectId, { action: "check_drawings", revisionId: r1, result: "changes", version: detail.project.version })).rejects.toThrow("Say what needs changing.");
      detail = await pm.command(actor, w.workspaceId, projectId, { action: "check_drawings", revisionId: r1, result: "changes", note: "Sink wall is 40 mm shorter", version: detail.project.version });
      expect(await w.notices("project.drawings_changes")).toEqual([expect.objectContaining({ recipient: w.tech.user, body: "Omar Manager: Sink wall is 40 mm shorter" })]);
      expect((await tasks(w, projectId)).filter((task) => task.status === "todo").map((task) => task.title)).toEqual(["Technical drawings"]);

      // R2 passes the drawer's site check; the client's approval is the project manager's.
      const r2 = randomUUID();
      await expect(drawings.upload(actor, w.workspaceId, projectId, r1, randomUUID(), "drawing", { buffer: PDF("late"), originalname: "late.pdf", mimetype: "application/pdf", size: 30 }))
        .rejects.toThrow(/already checked/);
      state = await drawings.upload(actor, w.workspaceId, projectId, r2, randomUUID(), "drawing", { buffer: PDF("kitchen r2"), originalname: "kitchen-r2.pdf", mimetype: "application/pdf", size: 40 });
      expect(state.revisions.map((revision) => `${revision.number}:${revision.status}`)).toEqual(["2:uploaded", "1:changes_needed"]);
      detail = await w.core(w.tech.user, TEAM).command(actor, w.workspaceId, projectId, { action: "check_drawings", revisionId: r2, result: "ok", version: state.version });
      expect((await tasks(w, projectId)).filter((task) => task.status === "todo")).toEqual([expect.objectContaining({ title: "Client approval of the drawings", assignee: w.pm.membership })]);
      await expect(w.core(w.tech.user, TEAM).command(actor, w.workspaceId, projectId, { action: "send_drawings", revisionId: r2, version: detail.project.version }))
        .rejects.toThrow("Only the project manager can do this.");
      detail = await pm.command(actor, w.workspaceId, projectId, { action: "send_drawings", revisionId: r2, version: detail.project.version });
      expect(detail.drawings.latest).toMatchObject({ number: 2, status: "sent" });

      // The client approves: the project manager records the day, who decided and the signed file.
      const decide = { action: "decide_drawings", revisionId: r2, decision: "approve", decidedOn: w.today, decidedBy: "Maya Client" };
      await expect(pm.command(actor, w.workspaceId, projectId, { ...decide, version: detail.project.version })).rejects.toThrow("Attach the client's signed approval first.");
      state = await w.drawings(w.pm.user, MANAGE).upload(actor, w.workspaceId, projectId, r2, randomUUID(), "approval", { buffer: PDF("signed"), originalname: "signed.pdf", mimetype: "application/pdf", size: 30 });
      detail = await pm.command(actor, w.workspaceId, projectId, { ...decide, version: state.version });
      expect(state.revisions[0].files.map((file) => file.kind)).toEqual(["drawing", "approval"]);

      // Released: the stage finished by itself, the project is in Production, the factory hears (by email too).
      expect(detail.stages[1]).toMatchObject({ status: "done", finishedAutomatically: true });
      expect(detail.stages[2]).toMatchObject({ name: "Production", status: "current" });
      expect(await drawingsGate(w.client, w.workspaceId, projectId)).toEqual({ required: true, approved: true });
      const approved = await w.notices("project.drawings_approved");
      expect(approved.map((row) => row.recipient).sort()).toEqual([w.factory.user].sort());
      expect(approved[0]).toMatchObject({ link: `/workspace/projects/${projectId}/scope?view=drawings` });
      expect(await w.notices("project.drawings_approved", "email")).toHaveLength(1);
      expect((await tasks(w, projectId)).every((task) => task.status === "done")).toBe(true);

      // The factory reads the approved drawings, the material list and the BOQ, without changing them.
      const reader = await w.drawings(w.factory.user, ["factory.view"]).read(actor, w.workspaceId, projectId);
      expect(reader.revisions[0]).toMatchObject({ number: 2, status: "approved", decidedByName: "Maya Client", decisionVia: "recorded" });
      expect(reader.canUpload || reader.canCheck || reader.canSend || reader.canDecide).toBe(false);
      const file = await w.drawings(w.factory.user, ["factory.view"]).file(actor, w.workspaceId, projectId, reader.revisions[0].files[0].id, false);
      expect(file.body.toString()).toContain("kitchen r2");
      expect((await w.core(w.factory.user, ["factory.view"]).scope(actor, w.workspaceId, projectId)).canManage).toBe(false);
      expect((await w.core(w.factory.user, ["factory.view"]).materials(actor, w.workspaceId, projectId)).items).toEqual([]);
      await expect(w.core(w.factory.user, ["factory.view"]).command(actor, w.workspaceId, projectId, { action: "rename", name: "x", version: detail.project.version }))
        .rejects.toThrow();

      // No stage starts without a project manager.
      await w.client.query(`UPDATE project_assignments SET role_keys = array_remove(role_keys, 'project_manager'), is_manager = false WHERE workspace_id = $1 AND project_id = $2`,
        [w.workspaceId, projectId]);
      await expect(pm.command(actor, w.workspaceId, projectId, { action: "skip_stage", stageId: detail.stages[2].id, reason: "Ready-made", version: detail.project.version }))
        .rejects.toThrow("Name the project manager before Handover starts.");
    });
  });

  it("a role marked not applicable on the project counts as named for its stage check (PLM-100)", async () => {
    await world(async (w) => {
      const { projectId } = await startProject(w);
      const pm = w.core(w.pm.user, MANAGE);
      let detail = await pm.get(actor, w.workspaceId, projectId);
      const route = await pm.saveTemplate(actor, w.workspaceId, { name: "Installer", stages: [
        { name: "Kickoff", ownerRole: "project_manager", checks: [{ kind: "role_assigned", role: "installation_lead" }] },
        { name: "Handover", ownerRole: "project_manager", checks: [{ kind: "confirm", label: "Keys handed over" }] },
      ] });
      expect(route.templates.some((template) => template.name === "Installer")).toBe(true);
      // The running project keeps its own stages: give its current stage the same check.
      await w.client.query(`UPDATE project_stages SET checks = '[{"key":"installer","kind":"role_assigned","role":"installation_lead"}]'::jsonb WHERE workspace_id = $1 AND id = $2`,
        [w.workspaceId, detail.stages[0].id]);
      detail = await pm.get(actor, w.workspaceId, projectId);
      expect(detail.stages[0].checks[0].passed).toBe(false);
      detail = await pm.command(actor, w.workspaceId, projectId, { action: "set_member", role: "installation_lead", notApplicable: true, version: detail.project.version });
      expect(detail.stages[0].checks[0].passed).toBe(true);
      expect(detail.stages[0].ready).toBe(true);
    });
  });

  it("a stage skipped for standard furniture doesn't hold production back", async () => {
    await world(async (w) => {
      const { projectId } = await startProject(w);
      const pm = w.core(w.pm.user, MANAGE);
      let detail = await pm.get(actor, w.workspaceId, projectId);
      detail = await pm.command(actor, w.workspaceId, projectId, { action: "skip_stage", stageId: detail.stages[1].id, reason: "Standard furniture", version: detail.project.version });
      expect(await drawingsGate(w.client, w.workspaceId, projectId)).toEqual({ required: false, approved: true });
      expect(detail.drawings).toMatchObject({ inRoute: false, latest: null });
    });
  });

  it("PLM-057: drawings only for the items that need them; standard items with their catalogue drawing skip the stage by themselves", async () => {
    await world(async (w) => {
      const { projectId } = await startProject(w);
      const pm = w.core(w.pm.user, MANAGE);
      // A line with no catalogue item is bespoke: it needs drawings, and production waits for them.
      let state = await w.drawings(w.tech.user, TEAM).read(actor, w.workspaceId, projectId);
      expect(state).toMatchObject({ needed: true, canDecideItems: true, items: [expect.objectContaining({ title: "Kitchen cabinets", needed: true, rule: { needed: true, reason: "bespoke" }, override: null })] });
      expect(await drawingsGate(w.client, w.workspaceId, projectId)).toEqual({ required: true, approved: false });

      // The same line as a standard catalogue piece: without a drawing on the catalogue it still needs one; with it, it doesn't.
      const catalog = randomUUID(), item = randomUUID();
      await w.client.query("INSERT INTO catalogs (id, workspace_id, code, name) VALUES ($1, $2, 'core', 'Core collection')", [catalog, w.workspaceId]);
      await w.client.query(`INSERT INTO catalog_units (workspace_id, code, label, kind, to_base) VALUES ($1, 'pcs', 'Pieces', 'count', 1) ON CONFLICT DO NOTHING`, [w.workspaceId]);
      await w.client.query(`INSERT INTO catalog_items (id, workspace_id, catalog_id, code, name, item_type, unit_code) VALUES ($1, $2, $3, 'SOFA-3', 'Sofa 3 seater', 'product', 'pcs')`,
        [item, w.workspaceId, catalog]);
      await w.client.query(`UPDATE project_boq_lines SET catalog_item_id = $3 WHERE workspace_id = $1 AND project_id = $2`, [w.workspaceId, projectId, item]);
      state = await w.drawings(w.tech.user, TEAM).read(actor, w.workspaceId, projectId);
      expect(state.items[0]).toMatchObject({ needed: true, rule: { reason: "no_catalogue_drawing" }, catalogName: "Sofa 3 seater", catalogDrawingUrl: null });
      await w.client.query(`UPDATE catalog_items SET technical_drawing_url = 'https://drive.example.com/sofa-3.pdf' WHERE workspace_id = $1 AND id = $2`, [w.workspaceId, item]);
      state = await w.drawings(w.tech.user, TEAM).read(actor, w.workspaceId, projectId);
      expect(state).toMatchObject({ needed: false, items: [expect.objectContaining({ needed: false, rule: { needed: false, reason: "catalogue_drawing" }, catalogDrawingUrl: "https://drive.example.com/sofa-3.pdf" })] });
      expect(await drawingsGate(w.client, w.workspaceId, projectId)).toEqual({ required: false, approved: true });

      // The technical team can still ask for drawings, saying why; who and when are kept.
      let detail = await pm.get(actor, w.workspaceId, projectId);
      const tech = w.core(w.tech.user, TEAM);
      await expect(tech.command(actor, w.workspaceId, projectId, { action: "set_drawing_need", lineId: state.items[0].lineId, needed: true, version: detail.project.version })).rejects.toThrow("Say why.");
      await expect(w.core(w.factory.user, FACTORY).command(actor, w.workspaceId, projectId, { action: "set_drawing_need", lineId: state.items[0].lineId, needed: true, reason: "x", version: detail.project.version }))
        .rejects.toThrow();
      detail = await tech.command(actor, w.workspaceId, projectId, { action: "set_drawing_need", lineId: state.items[0].lineId, needed: true, reason: "Client changed the arm width", version: detail.project.version });
      state = await w.drawings(w.tech.user, TEAM).read(actor, w.workspaceId, projectId);
      expect(state.items[0]).toMatchObject({ needed: true, override: { needed: true, reason: "Client changed the arm width", byName: "Tara Technical" } });
      expect(await drawingsGate(w.client, w.workspaceId, projectId)).toEqual({ required: true, approved: false });
      // Back to the rule.
      detail = await tech.command(actor, w.workspaceId, projectId, { action: "set_drawing_need", lineId: state.items[0].lineId, needed: null, version: detail.project.version });
      expect((await w.drawings(w.tech.user, TEAM).read(actor, w.workspaceId, projectId)).items[0]).toMatchObject({ needed: false, override: null });

      // Kickoff done: the drawings stage has nothing to draw, so it is skipped with the reason and production is current.
      detail = await pm.command(actor, w.workspaceId, projectId, { action: "book_factory_slot", date: "2026-11-02", version: detail.project.version });
      detail = await pm.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: detail.stages[0].id, version: detail.project.version });
      expect(detail.stages[1]).toMatchObject({ name: "Technical drawings", status: "skipped", skipReason: "No item needs technical drawings." });
      expect(detail.stages[2]).toMatchObject({ name: "Production", status: "current" });
      expect((await tasks(w, projectId)).filter((task) => task.status === "todo")).toEqual([]);
    });
  });

  it("PLM-057: a drawings stage already under way moves on once the team decides no item needs drawings", async () => {
    await world(async (w) => {
      const { projectId } = await startProject(w);
      const pm = w.core(w.pm.user, MANAGE);
      let detail = await pm.command(actor, w.workspaceId, projectId, { action: "book_factory_slot", date: "2026-11-02", version: (await pm.get(actor, w.workspaceId, projectId)).project.version });
      detail = await pm.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: detail.stages[0].id, version: detail.project.version });
      expect(detail.stages[1]).toMatchObject({ name: "Technical drawings", status: "current" });
      const line = (await w.drawings(w.pm.user, MANAGE).read(actor, w.workspaceId, projectId)).items[0];
      detail = await pm.command(actor, w.workspaceId, projectId, { action: "set_drawing_need", lineId: line.lineId, needed: false, reason: "Standard piece, drawing on file", version: detail.project.version });
      expect(detail.stages[1]).toMatchObject({ status: "skipped", skipReason: "No item needs technical drawings." });
      expect(detail.stages[2]).toMatchObject({ name: "Production", status: "current" });
      // Its drawings task stops with it.
      expect((await tasks(w, projectId)).find((task) => task.title === "Technical drawings")).toMatchObject({ status: "cancelled" });
    });
  });
});
