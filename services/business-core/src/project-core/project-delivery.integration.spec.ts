import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { HandoverService } from "../site/handover.service";
import { SiteService } from "../site/site.service";
import { WarrantyService } from "../site/warranty.service";
import { readSitesToday } from "../site/sites-today";
import { readHomeOverview } from "../workspaces/home-overview";
import { decideClientUpdate, processClientUpdateAutoSend, processClientUpdateDrafts } from "./client-updates";
import { processMaterialsWaiting, processMilestonesDue, processWeeklySummaries } from "./delivery-reminders";
import { ProjectCoreService } from "./project-core.service";
import { ProjectMoneyService } from "./project-money.service";
import { ProjectOverviewService } from "./project-overview.service";
import { noticeStageReady } from "./project-stage-watch";
import { processWorkDeadlines } from "./work-reminders";
import { ProjectWorkService } from "./project-work.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const EVERYTHING = ["projects.manage", "projects.view", "pre_projects.view", "pre_projects.edit", "workspace.settings.manage", "commercial.costs.view", "receivables.view"];

type World = {
  client: PoolClient; workspaceId: string; caseId: string; projectId: string; manager: string; designer: string; managerMembership: string; designerMembership: string; today: string;
  core: (userId: string, permissions?: string[]) => ProjectCoreService; work: (userId: string, permissions?: string[]) => ProjectWorkService;
  overview: (userId: string, permissions?: string[]) => ProjectOverviewService; money: (userId: string, permissions?: string[]) => ProjectMoneyService;
  site: (userId: string, permissions?: string[]) => SiteService; handover: (userId: string, permissions?: string[]) => HandoverService;
  warranty: (userId: string, permissions?: string[]) => WarrantyService;
  version: () => Promise<number>; notices: (code: string) => Promise<Array<{ recipient: string; subject: string; body: string; link: string }>>;
};

const day = (from: string, offset: number) => new Date(Date.parse(`${from}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

integration("project delivery v2: overview, reminders, hold, handover money, client updates", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  /** A started project (accepted quote, signed agreement, advance verified) whose week ends today on the workspace calendar. */
  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), manager = randomUUID(), designer = randomUUID();
    const managerMembership = randomUUID(), designerMembership = randomUUID(), party = randomUUID(), opportunity = randomUUID(), kitchen = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Omar Manager'),($3,$4,'Dana Designer')", [manager, `${manager.slice(0, 8)}@example.com`, designer, `${designer.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','UTC',$3)", [workspaceId, `pd-${workspaceId.slice(0, 8)}`, manager]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')", [managerMembership, workspaceId, manager, designerMembership, designer]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), designerMembership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, manager]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      // The workspace's week ends today (the weekly summary and the client update run on its last working day).
      const today = (await client.query<{ today: string; dow: number }>(`SELECT (now() AT TIME ZONE 'UTC')::date::text AS today, extract(dow FROM (now() AT TIME ZONE 'UTC'))::int AS dow`)).rows[0];
      await client.query("INSERT INTO hrms_calendars(workspace_id,name,timezone,working_days) VALUES($1,'Studio week','UTC',$2)",
        [workspaceId, [4, 3, 2, 1, 0].map((back) => (today.dow - back + 7) % 7)]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const run = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const member = (userId: string) => (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const access = (userId: string, permissions: string[]) => ({
        asMember: member(userId), withPermission: run(userId), withAnyPermission: run(userId),
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code),
      } as never);
      const builder = new QuotationBuilderService({ withPermission: run(manager), withPermissions: run(manager), withAnyPermission: run(manager), hasPermission: async () => true } as never, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "a", title: "Kitchen cabinets", unit: "m", quantity: "4.5", rate: "1200", areaId: kitchen } },
        { op: "upsert", line: { id: "b", title: "Worktop", unit: "m²", quantity: "2.25", rate: "800", areaId: kitchen } },
      ] });
      // Accepted, signed, the advance verified; the second milestone falls due today and isn't invoiced.
      const loaded = (await commercialRepository.load(client, workspaceId, caseId))!;
      const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
      const quote = data.quotes.find((item) => item.id === quoteId)!;
      quote.status = "accepted";
      quote.hash = freezeHash(quote);
      const total = 4.5 * 1200 + 2.25 * 800;
      quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: total, optionsTotal: 0, acceptedTotal: total,
        decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
      data.agreement = { quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
      data.payments = [
        { id: "p1", sourceQuoteId: quoteId, title: "Advance", amount: total / 2, dueDate: "", requiredForRelease: true, requiredForProduction: false, status: "verified", proof: "bank transfer", reference: "TT-1", evidenceKind: "operational" },
        { id: "p2", sourceQuoteId: quoteId, title: "Before production", amount: total / 2, dueDate: today.today, requiredForRelease: false, requiredForProduction: true, status: "pending", proof: "", reference: "" },
      ];
      data.revision = loaded.revision + 1;
      await commercialRepository.save(client, workspaceId, caseId, data);
      const core = (userId: string, permissions = EVERYTHING) => new ProjectCoreService(access(userId, permissions));
      const { projectId } = await core(manager).start(actor, workspaceId, caseId, { quoteId, leadMembershipId: managerMembership });
      await run_({
        client, workspaceId, caseId, projectId, manager, designer, managerMembership, designerMembership, today: today.today, core,
        work: (userId, permissions = EVERYTHING) => new ProjectWorkService(access(userId, permissions)),
        overview: (userId, permissions = EVERYTHING) => new ProjectOverviewService(access(userId, permissions)),
        money: (userId, permissions = EVERYTHING) => new ProjectMoneyService(access(userId, permissions)),
        site: (userId, permissions = EVERYTHING) => new SiteService(access(userId, permissions)),
        handover: (userId, permissions = EVERYTHING) => new HandoverService(access(userId, permissions)),
        warranty: (userId, permissions = EVERYTHING) => new WarrantyService(access(userId, permissions)),
        version: async () => (await client.query<{ version: number }>("SELECT version FROM delivery_projects WHERE workspace_id=$1 AND id=$2", [workspaceId, projectId])).rows[0].version,
        notices: async (code: string) => (await client.query<{ recipient: string; subject: string; body: string; link: string }>(
          `SELECT recipient_id AS recipient, subject, body, deep_link AS link FROM notifications WHERE workspace_id=$1 AND event_type=$2 AND channel='in_app' ORDER BY created_at`, [workspaceId, code])).rows,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    async function run_(value: World) { await run(value); }
  }

  it("Overview: blockers from the records, dates, money at a glance and recent activity", async () => {
    await world(async (w) => {
      const work = w.work(w.manager);
      const late = randomUUID(), waiting = randomUUID();
      await work.command(actor, w.workspaceId, w.projectId, { action: "create", id: late, title: "Measure the kitchen", assigneeId: w.managerMembership, dueDate: day(w.today, -3) });
      await work.command(actor, w.workspaceId, w.projectId, { action: "create", id: waiting, title: "Fit the cabinets", dueDate: day(w.today, 5) });
      await work.command(actor, w.workspaceId, w.projectId, { action: "link", itemId: waiting, predecessorId: late, kind: "fs" });
      const overview = await w.overview(w.manager).overview(actor, w.workspaceId, w.projectId);
      const keys = overview.blockers.map((blocker) => blocker.key);
      expect(keys).toEqual(expect.arrayContaining(["late_work", "blocked_work"]));
      expect(overview.blockers.find((blocker) => blocker.key === "late_work")).toMatchObject({ count: 1, href: `/workspace/projects/${w.projectId}/plan?filter=late` });
      expect(overview.work).toMatchObject({ open: 2, late: 1, blocked: 1 });
      // The Projects list says which project needs a look.
      expect((await w.core(w.manager).list(actor, w.workspaceId)).projects.find((row) => row.id === w.projectId)?.attention).toEqual({ late: 1, blocked: 1 });
      expect(overview.dates.planEnd).toBe(day(w.today, 5));
      // Money at a glance: agreed 7200, half verified, nothing spent.
      expect(overview.money).toMatchObject({ currency: "AED", agreed: "7200.00", received: "3600.00", due: "3600.00", toInvoice: 1 });
      expect(overview.activity.map((row) => row.action)).toEqual(expect.arrayContaining(["work.create", "project.started"]));
      expect(overview.activity.find((row) => row.action === "work.create")?.subject).toMatch(/^#\d+ /);
      // Without any money rights, no money.
      const blind = await w.overview(w.manager, ["projects.view", "projects.manage"]).overview(actor, w.workspaceId, w.projectId);
      expect(blind.money).toBeNull();
    });
  });

  it("D-16: a project manager sees their own project's money, not its margin", async () => {
    await world(async (w) => {
      const own = await w.money(w.manager, ["projects.view", "projects.costs.view"]).read(actor, w.workspaceId, w.projectId);
      expect(own.margin).toBeNull();
      expect(own.income.received).toBe("3600.0000");
      const full = await w.money(w.manager, ["projects.manage", "commercial.costs.view"]).read(actor, w.workspaceId, w.projectId);
      expect(full.margin).not.toBeNull();
      await expect(w.money(w.manager, ["projects.view"]).read(actor, w.workspaceId, w.projectId)).rejects.toThrow(/don't see this project's costs/);
      // Someone off the team with only projects.costs.view doesn't see it.
      const stranger = randomUUID();
      await w.client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Stranger')", [stranger, `${stranger.slice(0, 8)}@example.com`]);
      await w.client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [randomUUID(), w.workspaceId, stranger]);
      await expect(w.money(stranger, ["projects.view", "projects.costs.view"]).read(actor, w.workspaceId, w.projectId)).rejects.toThrow(/not found/i);
    });
  });

  it("D-6: the weekly summary and Home read work items, never the retired JSON", async () => {
    await world(async (w) => {
      const work = w.work(w.manager);
      await work.command(actor, w.workspaceId, w.projectId, { action: "create", id: randomUUID(), title: "Order the worktop", assigneeId: w.managerMembership, dueDate: day(w.today, -1) });
      await work.command(actor, w.workspaceId, w.projectId, { action: "create", id: randomUUID(), title: "Site survey", assigneeId: w.managerMembership, dueDate: day(w.today, 2) });
      expect(await processWeeklySummaries(w.client, w.workspaceId)).toEqual({ sent: 1 });
      expect(await processWeeklySummaries(w.client, w.workspaceId)).toEqual({ sent: 0 });
      const [summary] = await w.notices("project.weekly_summary");
      expect(summary).toMatchObject({ recipient: w.manager, link: `/workspace/projects/${w.projectId}` });
      expect(summary.body).toContain("2 open · 1 late");
      const home = await readHomeOverview(w.client, w.workspaceId, w.managerMembership, { sales: false, planning: false, projects: true, manageProjects: true });
      expect(home.metrics.myProjectTasks).toBe(2);
      expect(home.tasks[0].href).toMatch(new RegExp(`^/workspace/projects/${w.projectId}/plan\\?item=`));
      expect(home.projects[0].detail).toBe("Kickoff");
    });
  });

  it("D-7: a stage whose record-read checks pass tells its owner and the project manager once", async () => {
    await world(async (w) => {
      const core = w.core(w.manager);
      let detail = await core.get(actor, w.workspaceId, w.projectId);
      const kickoff = detail.stages[0];
      detail = await core.command(actor, w.workspaceId, w.projectId, { action: "confirm_check", stageId: kickoff.id, checkKey: "meeting", version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, w.projectId, { action: "complete_stage", stageId: kickoff.id, version: detail.project.version });
      // Material sign-off: the client signs the list off.
      detail = await core.command(actor, w.workspaceId, w.projectId, { action: "save_material", name: "Oak veneer", version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, w.projectId, { action: "send_materials", version: detail.project.version });
      const oak = (await core.materials(actor, w.workspaceId, w.projectId)).items[0];
      await core.command(actor, w.workspaceId, w.projectId, { action: "record_materials_decision", decidedBy: "Maya", method: "email", decisions: [{ itemId: oak.id, decision: "approved" }], version: detail.project.version });
      // The manager acted, so they aren't told; the daily run (no actor) tells them.
      expect(await noticeStageReady(w.client, w.workspaceId, w.projectId, null)).toBe(1);
      expect(await noticeStageReady(w.client, w.workspaceId, w.projectId, null)).toBe(0);
      const [ready] = await w.notices("project.stage_ready");
      expect(ready.subject).toMatch(/^Material sign-off can be finished/);
    });
  });

  it("D-8: on hold, the plan and the site are read-only; resuming can move the dates by the time lost", async () => {
    await world(async (w) => {
      const work = w.work(w.manager);
      const item = randomUUID();
      await work.command(actor, w.workspaceId, w.projectId, { action: "create", id: item, title: "Install", startDate: day(w.today, 1), dueDate: day(w.today, 3) });
      const core = w.core(w.manager);
      await core.command(actor, w.workspaceId, w.projectId, { action: "hold", reason: "Client travelling", version: await w.version() });
      const board = await work.board(actor, w.workspaceId, w.projectId);
      expect(board).toMatchObject({ onHold: true, canEdit: false });
      const current = board.items.find((entry) => entry.id === item)!;
      await expect(work.command(actor, w.workspaceId, w.projectId, { action: "update", itemId: item, version: current.version, title: "Install cabinets" })).rejects.toThrow(/on hold/);
      await expect(work.command(actor, w.workspaceId, w.projectId, { action: "create", id: randomUUID(), title: "More work" })).rejects.toThrow(/on hold/);
      await work.command(actor, w.workspaceId, w.projectId, { action: "comment", itemId: item, id: randomUUID(), body: "Paused with the client" });
      await expect(w.site(w.manager).command(actor, w.workspaceId, w.projectId, { action: "save_report", id: randomUUID(), noWorkReason: "Held" })).rejects.toThrow(/on hold/);
      // Held a week ago (5 working days on the calendar): resume and move the dates.
      await w.client.query("UPDATE delivery_projects SET held_at = now() - interval '7 days', promise_date = $3 WHERE workspace_id=$1 AND id=$2", [w.workspaceId, w.projectId, day(w.today, 30)]);
      const detail = await core.get(actor, w.workspaceId, w.projectId);
      expect(detail.hold).toMatchObject({ days: 7, workingDays: 5 });
      const resumed = await core.command(actor, w.workspaceId, w.projectId, { action: "resume", shiftDates: true, version: detail.project.version });
      expect(resumed.project.status).toBe("active");
      const moved = (await work.board(actor, w.workspaceId, w.projectId)).items.find((entry) => entry.id === item)!;
      expect(moved.startDate > day(w.today, 1)).toBe(true);
      expect(moved.dueDate! > day(w.today, 3)).toBe(true);
      expect(resumed.project.promiseDate! > day(w.today, 30)).toBe(true);
    });
  });

  /** Every stage before Handover done, then the client accepts a whole-project pack (with the balance still due, and why). */
  async function acceptHandover(w: World) {
    await w.client.query(`UPDATE project_stages SET status = 'done', started_at = coalesce(started_at, now()), completed_at = now(), completed_by = $3
      WHERE workspace_id = $1 AND project_id = $2 AND key <> 'handover'`, [w.workspaceId, w.projectId, w.manager]);
    await w.client.query(`UPDATE project_stages SET status = 'current', started_at = now() WHERE workspace_id = $1 AND project_id = $2 AND key = 'handover'`, [w.workspaceId, w.projectId]);
    const handover = w.handover(w.manager);
    const packId = randomUUID();
    let state = await handover.command(actor, w.workspaceId, w.projectId, { action: "create_pack", id: packId, title: "Whole home" });
    await w.client.query(`INSERT INTO handover_documents(id,workspace_id,pack_id,kind,title,original_name,mime_type,byte_size,object_key,sha256,created_by)
      VALUES($1,$2,$3,'warranty','Warranty','warranty.pdf','application/pdf',10,'handover/x',repeat('c',64),$4)`, [randomUUID(), w.workspaceId, packId, w.manager]);
    let pack = state.packs.find((entry: { id: string }) => entry.id === packId)!;
    state = await handover.command(actor, w.workspaceId, w.projectId, { action: "issue", packId, version: pack.version, confirmOpen: true, openReason: "Test" });
    pack = state.packs.find((entry: { id: string }) => entry.id === packId)!;
    await handover.command(actor, w.workspaceId, w.projectId, { action: "accept", packId, version: pack.version, decidedOn: w.today, decidedByName: "Maya", method: "in_person",
      confirmOpen: true, openReason: "Test", balanceReason: "Final payment on handover per the agreement" });
  }

  it("D-7: with 'Finish by itself' on, the client accepting the handover finishes the project, audited as automatic", async () => {
    await world(async (w) => {
      const core = w.core(w.manager);
      const settings = (await w.client.query<{ version: number }>("SELECT version FROM workspace_project_settings WHERE workspace_id = $1", [w.workspaceId])).rows[0];
      expect((await core.saveSettings(actor, w.workspaceId, { version: settings.version, autoFinish: true })).settings.autoFinish).toBe(true);
      await acceptHandover(w);
      const detail = await core.get(actor, w.workspaceId, w.projectId);
      expect(detail.project.status).toBe("completed");
      expect(detail.stages.at(-1)).toMatchObject({ key: "handover", status: "done", finishedAutomatically: true, completedByName: "Omar Manager" });
      const audits = (await w.client.query<{ action: string; actor: string | null; source: string; automatic: boolean }>(
        `SELECT action, actor_user_id AS actor, source, (after->>'automatic')::boolean AS automatic FROM audit_events
          WHERE workspace_id = $1 AND entity_id = $2 AND action IN ('project.completed', 'project.complete_stage') ORDER BY occurred_at`, [w.workspaceId, w.projectId])).rows;
      expect(audits).toEqual([
        { action: "project.complete_stage", actor: null, source: "internal", automatic: true },
        { action: "project.completed", actor: null, source: "internal", automatic: true },
      ]);
      expect((await w.notices("project.finished_automatically")).map((row) => row.recipient).sort()).toEqual([w.manager, w.designer].sort());
      // The daily run has nothing left to do.
      expect(await noticeStageReady(w.client, w.workspaceId, w.projectId, null)).toBe(0);
    });
  });

  it("D-7: with 'Finish by itself' off, an accepted handover leaves the last stage for the project manager to finish", async () => {
    await world(async (w) => {
      await acceptHandover(w);
      const detail = await w.core(w.manager).get(actor, w.workspaceId, w.projectId);
      expect(detail.project.status).toBe("active");
      expect(detail.stages.at(-1)).toMatchObject({ key: "handover", status: "current", finishedAutomatically: false });
      expect(detail.stages.at(-1)?.ready).toBe(true);
    });
  });

  it("D-9: accepting a handover with money due needs someone who manages projects and why; it stays on the pack", async () => {
    await world(async (w) => {
      const handover = w.handover(w.manager);
      const packId = randomUUID();
      let state = await handover.command(actor, w.workspaceId, w.projectId, { action: "create_pack", id: packId, title: "Kitchen handover" });
      expect(state.balance).toMatchObject({ currency: "AED", due: "3600.00" });
      expect(state.balance.toInvoice.map((row: { title: string }) => row.title)).toEqual(["Before production"]);
      await w.client.query(`INSERT INTO handover_documents(id,workspace_id,pack_id,kind,title,original_name,mime_type,byte_size,object_key,sha256,created_by)
        VALUES($1,$2,$3,'warranty','Warranty','warranty.pdf','application/pdf',10,'handover/x',repeat('c',64),$4)`, [randomUUID(), w.workspaceId, packId, w.manager]);
      let pack = state.packs.find((entry: { id: string }) => entry.id === packId)!;
      state = await handover.command(actor, w.workspaceId, w.projectId, { action: "issue", packId, version: pack.version, confirmOpen: true, openReason: "Stages open in the test" });
      pack = state.packs.find((entry: { id: string }) => entry.id === packId)!;
      const decision = { action: "accept", packId, version: pack.version, decidedOn: w.today, decidedByName: "Maya", method: "in_person", confirmOpen: true, openReason: "Test" };
      await expect(handover.command(actor, w.workspaceId, w.projectId, decision)).rejects.toThrow(/AED 3600.00 is still due\. Say why/);
      await expect(w.handover(w.manager, ["projects.view"]).command(actor, w.workspaceId, w.projectId, { ...decision, balanceReason: "Retention" })).rejects.toThrow();
      state = await handover.command(actor, w.workspaceId, w.projectId, { ...decision, balanceReason: "Final payment on handover per the agreement" });
      pack = state.packs.find((entry: { id: string }) => entry.id === packId)!;
      expect(pack).toMatchObject({ status: "accepted", balanceDue: "3600.0000", balanceCurrency: "AED", balanceReason: "Final payment on handover per the agreement" });
      // Handed over in full: site work ends that day.
      const site = (await w.client.query("SELECT site_finished_on::text AS finished FROM delivery_projects WHERE workspace_id=$1 AND id=$2", [w.workspaceId, w.projectId])).rows[0];
      expect(site.finished).toBe(w.today);
    });
  });

  it("D-10, D-13, D-14 and bulk edits: site work starts with the first report, materials and milestones are chased, work changes in bulk", async () => {
    await world(async (w) => {
      await w.site(w.manager).command(actor, w.workspaceId, w.projectId, { action: "save_report", id: randomUUID(), noWorkReason: "Access only" });
      const started = (await w.client.query("SELECT site_started_on::text AS started FROM delivery_projects WHERE workspace_id=$1 AND id=$2", [w.workspaceId, w.projectId])).rows[0];
      expect(started.started).toBe(w.today);
      // D-19: the phone's Today lists the site with my draft report for the day.
      const mine = await readSitesToday(w.client, w.workspaceId, w.manager);
      expect(mine.sites).toEqual([expect.objectContaining({ projectId: w.projectId, report: expect.objectContaining({ status: "draft" }), arriving: 0, snags: 0 })]);
      expect((await readSitesToday(w.client, w.workspaceId, randomUUID())).sites).toEqual([]);

      const core = w.core(w.manager);
      let detail = await core.command(actor, w.workspaceId, w.projectId, { action: "save_material", name: "Oak veneer", version: await w.version() });
      detail = await core.command(actor, w.workspaceId, w.projectId, { action: "send_materials", version: detail.project.version });
      await w.client.query("UPDATE project_material_revisions SET sent_at = now() - interval '10 days' WHERE workspace_id=$1 AND project_id=$2", [w.workspaceId, w.projectId]);
      // The project manager and the account manager (the Sales owner) hear it.
      expect((await processMaterialsWaiting(w.client, w.workspaceId)).sent).toBe(2);
      expect((await processMaterialsWaiting(w.client, w.workspaceId)).sent).toBe(0);
      expect((await w.notices("project.materials_waiting"))[0].body).toMatch(/R1 has been with the client for \d+ working days/);

      expect(await processMilestonesDue(w.client, w.workspaceId)).toEqual({ sent: 1 });
      expect((await w.notices("project.milestone_due"))[0]).toMatchObject({ recipient: w.manager, link: `/workspace/projects/${w.projectId}/money?view=client` });

      const work = w.work(w.manager);
      const one = randomUUID(), two = randomUUID();
      await work.command(actor, w.workspaceId, w.projectId, { action: "create", id: one, title: "Cut panels" });
      const board = await work.command(actor, w.workspaceId, w.projectId, { action: "create", id: two, title: "Edge banding" });
      const items = board.items.filter((item) => [one, two].includes(item.id)).map((item) => ({ id: item.id, version: item.version }));
      // New work lands in the current stage by default.
      expect(board.items.find((item) => item.id === one)?.stageId).toBe(detail.stages.find((stage) => stage.status === "current")?.id);
      const after = await work.command(actor, w.workspaceId, w.projectId, { action: "bulk_update", items, changes: { assigneeId: w.managerMembership, priority: "high" } });
      expect(after.items.filter((item) => [one, two].includes(item.id)).every((item) => item.assigneeId === w.managerMembership && item.priority === "high")).toBe(true);
      await expect(work.command(actor, w.workspaceId, w.projectId, { action: "bulk_update", items, changes: { priority: "low" } })).rejects.toThrow(/Someone else changed/);
    });
  });

  it("D-27: a chargeable warranty claim goes on as a variation of the project, linked both ways", async () => {
    await world(async (w) => {
      const warranty = w.warranty(w.manager);
      const claim = randomUUID();
      let state = await warranty.command(actor, w.workspaceId, w.projectId, { action: "record_claim", id: claim, raisedOn: w.today, raisedByName: "Maya", channel: "phone", description: "Hinge replaced after misuse" });
      let row = state.claims.find((item) => item.id === claim)!;
      await expect(warranty.command(actor, w.workspaceId, w.projectId, { action: "link_variation", claimId: claim, quoteId: randomUUID(), version: row.version })).rejects.toThrow(/Only a chargeable claim/);
      state = await warranty.command(actor, w.workspaceId, w.projectId, { action: "decide_claim", claimId: claim, decision: "chargeable", note: "Misuse: new hinge at cost", version: row.version });
      row = state.claims.find((item) => item.id === claim)!;
      expect(state).toMatchObject({ caseId: w.caseId, baselineQuoteId: expect.any(String) });
      const variation = randomUUID();
      await w.client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,1,2,'variation','main','draft','Hinge','AED')",
        [w.workspaceId, w.caseId, variation]);
      await expect(warranty.command(actor, w.workspaceId, w.projectId, { action: "link_variation", claimId: claim, quoteId: randomUUID(), version: row.version })).rejects.toThrow(/variation of this project/);
      state = await warranty.command(actor, w.workspaceId, w.projectId, { action: "link_variation", claimId: claim, quoteId: variation, version: row.version });
      expect(state.claims.find((item) => item.id === claim)).toMatchObject({ variationId: variation, variationNumber: 2, variationStatus: "draft", variationApplied: null });
    });
  });

  it("D-43: installation that isn't accepted raises a snag on its line and opens its finished task again", async () => {
    await world(async (w) => {
      const line = (await w.client.query<{ id: string }>("SELECT id FROM project_boq_lines WHERE project_id = $1 AND title = 'Kitchen cabinets'", [w.projectId])).rows[0];
      const work = w.work(w.manager);
      const install = randomUUID();
      let board = await work.command(actor, w.workspaceId, w.projectId, { action: "create", id: install, title: "Install the cabinets", boqLineId: line.id, assigneeId: w.designerMembership });
      board = await work.command(actor, w.workspaceId, w.projectId, { action: "update", itemId: install, status: "done", version: board.items.find((item) => item.id === install)!.version });
      const report = randomUUID(), entry = randomUUID();
      await w.client.query(`INSERT INTO site_reports(id,workspace_id,project_id,report_date,author_id,status,weather,safety,safety_note,forecast,impact,no_work_reason,notes,decision_note,
          submitted_at,decided_by,decided_at) VALUES($1,$2,$3,$4,$5,'approved','','none','','none','','','','',now(),$6,now())`, [report, w.workspaceId, w.projectId, day(w.today, -1), w.designer, w.manager]);
      await w.client.query("INSERT INTO site_report_lines(id,workspace_id,report_id,boq_line_id,installed,note) VALUES($1,$2,$3,$4,2,'')", [entry, w.workspaceId, report, line.id]);
      const site = w.site(w.manager);
      await expect(site.command(actor, w.workspaceId, w.projectId, { action: "reject_installation", reportId: report, lineId: entry, reason: "" })).rejects.toThrow(/Say what isn't right/);
      await expect(w.site(w.designer, ["projects.view"]).command(actor, w.workspaceId, w.projectId, { action: "reject_installation", reportId: report, lineId: entry, reason: "Gaps" }))
        .rejects.toThrow(/Only the project manager/);
      await site.command(actor, w.workspaceId, w.projectId, { action: "reject_installation", reportId: report, lineId: entry, reason: "Door gaps uneven" });
      board = await work.board(actor, w.workspaceId, w.projectId);
      const snag = board.items.find((item) => item.type === "snag")!;
      expect(snag).toMatchObject({ title: "Not accepted: Kitchen cabinets", severity: "major", source: "inspection", boqLineId: line.id, status: "todo" });
      expect(board.items.find((item) => item.id === install)).toMatchObject({ status: "in_progress", completedAt: null });
      expect((await w.notices("work.snag_reopened")).map((row) => row.recipient)).toEqual([w.designer]);
    });
  });

  it("PM change: the new project manager leads and hears late work; the old one keeps access without leading", async () => {
    await world(async (w) => {
      const core = w.core(w.manager);
      await w.work(w.manager).command(actor, w.workspaceId, w.projectId, { action: "create", id: randomUUID(), title: "Survey", dueDate: day(w.today, -2) });
      let detail = await core.get(actor, w.workspaceId, w.projectId);
      detail = await core.command(actor, w.workspaceId, w.projectId, { action: "set_member", role: "project_manager", membershipId: w.designerMembership, version: detail.project.version });
      expect(detail.team.find((role) => role.role === "project_manager")?.member?.membershipId).toBe(w.designerMembership);
      expect(detail.stages.find((stage) => stage.status === "current")?.owner?.membershipId).toBe(w.designerMembership);
      const leads = (await w.client.query("SELECT membership_id AS id, is_manager AS lead FROM project_assignments WHERE project_id = $1 ORDER BY is_manager DESC", [w.projectId])).rows;
      expect(leads).toEqual(expect.arrayContaining([{ id: w.designerMembership, lead: true }, { id: w.managerMembership, lead: false }]));
      // The old project manager still opens the project; late work now reaches the new one.
      await expect(w.core(w.manager, ["projects.view"]).get(actor, w.workspaceId, w.projectId)).resolves.toBeTruthy();
      await processWorkDeadlines(w.client, w.workspaceId);
      expect((await w.notices("work.overdue")).map((row) => row.recipient)).toEqual([w.designer]);
      // A project always has a project manager.
      await expect(core.command(actor, w.workspaceId, w.projectId, { action: "set_member", role: "project_manager", membershipId: null, version: await w.version() })).rejects.toThrow(/always has a project manager/);
    });
  });

  it("D-40: the week's client update is drafted from approved reports and shared only when the project manager approves it", async () => {
    await world(async (w) => {
      const report = randomUUID(), photo = randomUUID();
      const line = (await w.client.query<{ id: string }>("SELECT id FROM project_boq_lines WHERE workspace_id=$1 AND project_id=$2 ORDER BY position LIMIT 1", [w.workspaceId, w.projectId])).rows[0];
      await w.client.query(`INSERT INTO site_reports(id,workspace_id,project_id,report_date,author_id,status,weather,safety,safety_note,forecast,impact,no_work_reason,notes,decision_note,
          submitted_at,decided_by,decided_at) VALUES($1,$2,$3,$4,$5,'approved','','none','','none','','','','',now(),$6,now())`, [report, w.workspaceId, w.projectId, day(w.today, -1), w.designer, w.manager]);
      await w.client.query("INSERT INTO site_report_lines(id,workspace_id,report_id,boq_line_id,installed,note) VALUES($1,$2,$3,$4,1.5,'')", [randomUUID(), w.workspaceId, report, line.id]);
      await w.client.query(`INSERT INTO site_report_photos(id,workspace_id,report_id,original_name,mime_type,byte_size,object_key,sha256,created_by)
        VALUES($1,$2,$3,'site.jpg','image/jpeg',10,'site/x',repeat('d',64),$4)`, [photo, w.workspaceId, report, w.designer]);
      expect(await processClientUpdateDrafts(w.client, w.workspaceId)).toEqual({ drafted: 1 });
      expect(await processClientUpdateDrafts(w.client, w.workspaceId)).toEqual({ drafted: 0 });
      const detail = await w.core(w.manager).get(actor, w.workspaceId, w.projectId);
      const draft = detail.updates.find((update) => update.kind === "client_update")!;
      expect(draft).toMatchObject({ draft: true, sharedAt: null, photoIds: [photo] });
      expect(draft.note).toContain("This week: Kitchen cabinets (1.5 m).");
      // Not for someone who doesn't manage the project.
      expect((await w.core(w.designer, ["projects.view"]).get(actor, w.workspaceId, w.projectId).catch(() => null))?.updates.some((update) => update.draft) ?? false).toBe(false);
      await decideClientUpdate(w.client, { workspaceId: w.workspaceId, projectId: w.projectId, caseId: w.caseId, title: "Villa 12", updateId: draft.id, note: "Cabinets are going in.", approve: true, userId: w.manager });
      const shared = (await w.client.query("SELECT shared_at IS NOT NULL AS shared, note FROM project_status_updates WHERE id=$1", [draft.id])).rows[0];
      expect(shared).toEqual({ shared: true, note: "Cabinets are going in." });
      expect((await w.client.query("SELECT shared_at IS NOT NULL AS shared FROM site_report_photos WHERE id=$1", [photo])).rows[0].shared).toBe(true);
      await expect(decideClientUpdate(w.client, { workspaceId: w.workspaceId, projectId: w.projectId, caseId: w.caseId, title: "Villa 12", updateId: draft.id, note: "", approve: true, userId: w.manager }))
        .rejects.toThrow(/already sent/);
    });
  });

  it("D-40: with 'Send by itself', a client update nobody sent or discarded goes out after the chosen hours, audited as automatic", async () => {
    await world(async (w) => {
      const core = w.core(w.manager);
      const settings = (await w.client.query<{ version: number }>("SELECT version FROM workspace_project_settings WHERE workspace_id = $1", [w.workspaceId])).rows[0];
      // Off by default: nothing goes by itself.
      const stale = randomUUID(), fresh = randomUUID();
      await w.client.query(`INSERT INTO project_status_updates(id,workspace_id,project_id,health,note,created_by,kind,draft_week,created_at)
        VALUES($1,$3,$4,'on_track','This week: cabinets.',$5,'client_update',$6::date,now() - interval '25 hours'),($2,$3,$4,'on_track','This week: worktop.',$5,'client_update',NULL,now() - interval '2 hours')`,
        [stale, fresh, w.workspaceId, w.projectId, w.manager, day(w.today, -1)]);
      expect(await processClientUpdateAutoSend(w.client, w.workspaceId)).toEqual({ sent: 0 });
      await expect(core.saveSettings(actor, w.workspaceId, { version: settings.version, clientUpdateAutoSendHours: 0 })).rejects.toThrow(/1 to 168 hours/);
      expect((await core.saveSettings(actor, w.workspaceId, { version: settings.version, clientUpdateAutoSendHours: 24 })).settings.clientUpdateAutoSendHours).toBe(24);
      // The draft says when it will go.
      const before = await core.get(actor, w.workspaceId, w.projectId);
      const freshDraft = before.updates.find((update) => update.id === fresh)!;
      expect(Date.parse(String(freshDraft.sendsAt)) - Date.parse(String(freshDraft.at))).toBe(24 * 3_600_000);
      expect(await processClientUpdateAutoSend(w.client, w.workspaceId)).toEqual({ sent: 1 });
      expect(await processClientUpdateAutoSend(w.client, w.workspaceId)).toEqual({ sent: 0 });
      const rows = (await w.client.query<{ id: string; shared: boolean; approvedBy: string | null }>(
        `SELECT id, shared_at IS NOT NULL AS shared, approved_by AS "approvedBy" FROM project_status_updates WHERE id = ANY($1::uuid[]) ORDER BY created_at`, [[stale, fresh]])).rows;
      expect(rows).toEqual([{ id: stale, shared: true, approvedBy: w.manager }, { id: fresh, shared: false, approvedBy: null }]);
      const audit = (await w.client.query(`SELECT actor_user_id AS actor, source, after->>'automatic' AS automatic, after->>'afterHours' AS hours FROM audit_events
        WHERE workspace_id = $1 AND action = 'project.approve_client_update'`, [w.workspaceId])).rows;
      expect(audit).toEqual([{ actor: null, source: "internal", automatic: "true", hours: "24" }]);
      expect((await w.notices("project.client_update_auto_sent")).map((row) => row.recipient)).toEqual([w.manager]);
      // A project on hold holds its updates too.
      await w.client.query("UPDATE project_status_updates SET created_at = now() - interval '30 hours' WHERE id = $1", [fresh]);
      await core.command(actor, w.workspaceId, w.projectId, { action: "hold", reason: "Client travelling", version: await w.version() });
      expect(await processClientUpdateAutoSend(w.client, w.workspaceId)).toEqual({ sent: 0 });
    });
  });
});
