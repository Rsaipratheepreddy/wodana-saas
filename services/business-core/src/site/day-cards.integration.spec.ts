import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { ProjectCoreService } from "../project-core/project-core.service";
import { ProjectWorkService } from "../project-core/project-work.service";
import { workdays } from "../project-core/work-calendar";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { readDayFeed, type DayCard } from "./day-cards";
import { SiteService } from "./site.service";
import { readSitesToday } from "./sites-today";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const EVERYTHING = ["projects.manage", "projects.view", "pre_projects.view", "pre_projects.edit", "workspace.settings.manage", "commercial.costs.view", "receivables.view"];
const day = (from: string, offset: number) => new Date(Date.parse(`${from}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

type World = {
  client: PoolClient; workspaceId: string; projectId: string; manager: string; supervisor: string; managerMembership: string; supervisorMembership: string; today: string;
  workingDays: number[];
  site: (userId: string) => SiteService; work: (userId: string) => ProjectWorkService;
  notices: (code: string) => Promise<Array<{ recipient: string; body: string; link: string }>>;
  photo: (reportId: string) => Promise<string>;
};

integration("daily progress as day cards (real database)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  /** A running project (accepted quote, signed, advance verified): Omar manages it, Sara reports from site. */
  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), manager = randomUUID(), supervisor = randomUUID();
    const managerMembership = randomUUID(), supervisorMembership = randomUUID(), party = randomUUID(), opportunity = randomUUID(), kitchen = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Omar Manager'),($3,$4,'Sara Supervisor')",
        [manager, `${manager.slice(0, 8)}@example.com`, supervisor, `${supervisor.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','UTC',$3)", [workspaceId, `dc-${workspaceId.slice(0, 8)}`, manager]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')",
        [managerMembership, workspaceId, manager, supervisorMembership, supervisor]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), managerMembership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, manager]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      const today = (await client.query<{ today: string; dow: number }>(`SELECT (now() AT TIME ZONE 'UTC')::date::text AS today, extract(dow FROM (now() AT TIME ZONE 'UTC'))::int AS dow`)).rows[0];
      // Five working days ending today; the two days before them are off.
      const workingDays = [4, 3, 2, 1, 0].map((back) => (today.dow - back + 7) % 7);
      await client.query("INSERT INTO hrms_calendars(workspace_id,name,timezone,working_days) VALUES($1,'Studio week','UTC',$2)", [workspaceId, workingDays]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const run = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const member = (userId: string) => (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      // Omar manages all projects; Sara sees projects and is on this one's team as its site supervisor.
      const access = (userId: string) => ({ asMember: member(userId), withPermission: run(userId), withAnyPermission: run(userId),
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => (userId === manager ? EVERYTHING : ["projects.view"]).includes(code) } as never);
      const builder = new QuotationBuilderService({ withPermission: run(manager), withPermissions: run(manager), withAnyPermission: run(manager), hasPermission: async () => true } as never, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [{ op: "upsert", line: { id: "a", title: "Kitchen cabinets", unit: "m", quantity: "4.5", rate: "1200", areaId: kitchen } }] });
      const loaded = (await commercialRepository.load(client, workspaceId, caseId))!;
      const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
      const quote = data.quotes.find((item) => item.id === quoteId)!;
      quote.status = "accepted";
      quote.hash = freezeHash(quote);
      quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: 5400, optionsTotal: 0, acceptedTotal: 5400,
        decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
      data.agreement = { quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
      data.payments = [{ id: "p1", sourceQuoteId: quoteId, title: "Advance", amount: 5400, dueDate: "", requiredForRelease: true, requiredForProduction: false, status: "verified", proof: "bank transfer", reference: "TT-1", evidenceKind: "operational" }];
      data.revision = loaded.revision + 1;
      await commercialRepository.save(client, workspaceId, caseId, data);
      const { projectId } = await new ProjectCoreService(access(manager)).start(actor, workspaceId, caseId, { quoteId, leadMembershipId: managerMembership });
      await client.query("INSERT INTO project_assignments(workspace_id, project_id, membership_id, role_keys, active) VALUES($1,$2,$3,ARRAY['site_supervisor'],true)",
        [workspaceId, projectId, supervisorMembership]);
      await run_({
        client, workspaceId, projectId, manager, supervisor, managerMembership, supervisorMembership, today: today.today, workingDays,
        site: (userId) => new SiteService(access(userId)), work: (userId) => new ProjectWorkService(access(userId)),
        notices: async (code) => (await client.query<{ recipient: string; body: string; link: string }>(
          `SELECT recipient_id AS recipient, body, deep_link AS link FROM notifications WHERE workspace_id=$1 AND event_type=$2 AND channel='in_app' ORDER BY created_at`, [workspaceId, code])).rows,
        // A photo already stored (the upload's storage isn't part of these tests).
        photo: async (reportId) => {
          const id = randomUUID();
          await client.query(`INSERT INTO site_report_photos (id, workspace_id, report_id, original_name, mime_type, byte_size, object_key, sha256, created_by, area_id)
            VALUES ($1, $2, $3, 'kitchen.jpg', 'image/jpeg', 100, $4, repeat('c', 64), $5, $6)`, [id, workspaceId, reportId, `site/reports/${workspaceId}/${id}/original`, supervisor, kitchen]);
          return id;
        },
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    async function run_(value: World) { await run(value); }
  }

  const reportOf = (state: { reports: Array<{ id: string; version: number }> }, id: string) => state.reports.find((report) => report.id === id)!;
  const cardOf = (state: { days: { cards: DayCard[] } }, date: string) => state.days.cards.find((card) => card.date === date)!;

  it("a day card: the report's work, crew, photos, issues, materials and tomorrow, through approval, client visibility and the issue's life", async () => {
    await world(async (w) => {
      const task = randomUUID();
      const board = await w.work(w.manager).command(actor, w.workspaceId, w.projectId, { action: "create", id: task, title: "Fit kitchen carcasses", dueDate: w.today });
      const stageId = board.items.find((item: { id: string }) => item.id === task)?.stageId;
      const site = w.site(w.supervisor), manager = w.site(w.manager);
      const reportId = randomUUID(), socket = randomUUID(), column = randomUUID(), tile = randomUUID();
      let state = await site.command(actor, w.workspaceId, w.projectId, { action: "save_report", id: reportId,
        tasks: [{ workItemId: task, progress: 100 }], workforce: [{ trade: "Carpenters", people: 3 }],
        issues: [{ id: socket, severity: "major", description: "Socket in the wrong place", ownerId: w.managerMembership, dueOn: day(w.today, -1) },
          { id: column, severity: "critical", description: "Column behind the kitchen wall" }, { id: tile, severity: "minor", description: "Chipped tile" }],
        materials: [{ direction: "received", description: "Plywood 18 mm", quantity: "20", unit: "sheet" }], next: [{ title: "Template the worktop" }] });
      // While it's a draft, issues change in the report, not on the card.
      await expect(site.command(actor, w.workspaceId, w.projectId, { action: "update_issue", issueId: socket, version: 1, status: "resolved" })).rejects.toThrow(/until the report is submitted/);
      // A photo taken by mistake comes off while it's a draft (its author only).
      const wrong = await w.photo(reportId);
      state = await site.state(actor, w.workspaceId, w.projectId);
      await expect(manager.command(actor, w.workspaceId, w.projectId, { action: "remove_photo", reportId, version: reportOf(state, reportId).version, photoId: wrong })).rejects.toThrow(/Only its author/);
      state = await site.command(actor, w.workspaceId, w.projectId, { action: "remove_photo", reportId, version: reportOf(state, reportId).version, photoId: wrong });
      expect(cardOf(state, w.today).photos).toEqual([]);
      await w.photo(reportId);
      state = await site.state(actor, w.workspaceId, w.projectId);
      state = await site.command(actor, w.workspaceId, w.projectId, { action: "submit", reportId, version: reportOf(state, reportId).version });

      let card = cardOf(state, w.today);
      expect(card).toMatchObject({ status: "submitted", clientVisible: false, people: 3, crew: [{ trade: "Carpenters", people: 3, source: "report" }] });
      expect(card.reports).toEqual([expect.objectContaining({ id: reportId, authorName: "Sara Supervisor", status: "submitted", waitingFor: ["Omar Manager"] })]);
      expect(card.work).toEqual([expect.objectContaining({ kind: "task", title: "Fit kitchen carcasses", progress: 100, stageId })]);
      expect(card.stageIds).toEqual([stageId]);
      expect(card.photos).toEqual([expect.objectContaining({ area: "Kitchen" })]);
      expect(card.materials).toEqual([expect.objectContaining({ direction: "received", description: "Plywood 18 mm", quantity: "20.0000", source: "report" })]);
      expect(card.next.map((item) => item.title)).toEqual(["Template the worktop"]);
      // Open issues, the most serious first; the major one is past its due date and has its owner.
      expect(card.issues.map((item) => [item.description, item.status, item.overdue])).toEqual([
        ["Column behind the kitchen wall", "open", false], ["Socket in the wrong place", "open", true], ["Chipped tile", "open", false]]);
      expect(card.issues[1]).toMatchObject({ ownerId: w.managerMembership, ownerName: "Omar Manager", dueOn: day(w.today, -1) });

      // Approval: never by the author; sent back with what to change, then approved and kept internal.
      await expect(site.command(actor, w.workspaceId, w.projectId, { action: "approve_hold", reportId, version: reportOf(state, reportId).version })).rejects.toThrow(/project manager/);
      state = await manager.command(actor, w.workspaceId, w.projectId, { action: "return", reportId, version: reportOf(state, reportId).version, note: "Add the worktop photo" });
      expect(cardOf(state, w.today)).toMatchObject({ status: "returned", reports: [expect.objectContaining({ decisionNote: "Add the worktop photo", decidedByName: "Omar Manager" })] });
      state = await site.command(actor, w.workspaceId, w.projectId, { action: "submit", reportId, version: reportOf(state, reportId).version });
      state = await manager.command(actor, w.workspaceId, w.projectId, { action: "approve_hold", reportId, version: reportOf(state, reportId).version });
      expect(cardOf(state, w.today)).toMatchObject({ status: "approved", clientVisible: false, reports: [expect.objectContaining({ delivery: "internal" })] });

      // Client visibility: only the manager decides; on sends it (once), off takes it off the client's page, on puts it back.
      await expect(site.command(actor, w.workspaceId, w.projectId, { action: "set_client_visibility", reportId, version: reportOf(state, reportId).version, visible: true }))
        .rejects.toThrow(/project manager/);
      state = await manager.command(actor, w.workspaceId, w.projectId, { action: "set_client_visibility", reportId, version: reportOf(state, reportId).version, visible: true });
      expect(cardOf(state, w.today)).toMatchObject({ clientVisible: true, reports: [expect.objectContaining({ delivery: "sent", hidden: false })] });
      const view = (await w.client.query("SELECT client_view AS view FROM site_reports WHERE workspace_id=$1 AND id=$2", [w.workspaceId, reportId])).rows[0].view;
      // The client's card never carries the crew, the internal issues or the materials.
      expect(JSON.stringify(view)).not.toMatch(/Carpenters|Socket|Plywood/);
      state = await manager.command(actor, w.workspaceId, w.projectId, { action: "set_client_visibility", reportId, version: reportOf(state, reportId).version, visible: false });
      expect(cardOf(state, w.today)).toMatchObject({ clientVisible: false, reports: [expect.objectContaining({ delivery: "sent", hidden: true })] });
      expect((await readDayFeed(w.client, w.workspaceId, w.projectId, { latest: 3, sentOnly: true })).cards).toEqual([]);
      await expect(manager.command(actor, w.workspaceId, w.projectId, { action: "set_client_visibility", reportId, version: reportOf(state, reportId).version, visible: false }))
        .rejects.toThrow(/already off/);
      state = await manager.command(actor, w.workspaceId, w.projectId, { action: "set_client_visibility", reportId, version: reportOf(state, reportId).version, visible: true });
      expect(cardOf(state, w.today).clientVisible).toBe(true);
      expect((await readDayFeed(w.client, w.workspaceId, w.projectId, { latest: 3, sentOnly: true })).cards.map((item) => item.date)).toEqual([w.today]);

      // The issue's life on the card: given to Sara, then resolved with how; version-checked.
      const socketIssue = () => cardOf(state, w.today).issues.find((item) => item.id === socket)!;
      state = await manager.command(actor, w.workspaceId, w.projectId, { action: "update_issue", issueId: socket, version: socketIssue().version, ownerId: w.supervisorMembership, dueOn: day(w.today, 2) });
      expect(socketIssue()).toMatchObject({ ownerName: "Sara Supervisor", dueOn: day(w.today, 2), overdue: false });
      expect((await w.notices("site.issue_assigned")).map((notice) => [notice.recipient, notice.link])).toEqual([[w.supervisor, `/workspace/projects/${w.projectId}/site?day=${w.today}`]]);
      await expect(manager.command(actor, w.workspaceId, w.projectId, { action: "update_issue", issueId: socket, version: 1, status: "resolved" })).rejects.toThrow(/changed elsewhere/);
      state = await manager.command(actor, w.workspaceId, w.projectId, { action: "update_issue", issueId: socket, version: socketIssue().version, status: "resolved", resolution: "Moved by the electrician" });
      expect(socketIssue()).toMatchObject({ status: "resolved", resolvedByName: "Omar Manager", resolution: "Moved by the electrician" });
      expect((await w.notices("site.issue_resolved")).map((notice) => notice.recipient)).toEqual([w.supervisor]);
      state = await manager.command(actor, w.workspaceId, w.projectId, { action: "update_issue", issueId: socket, version: socketIssue().version, status: "open" });
      expect(socketIssue()).toMatchObject({ status: "open", resolvedAt: null, resolution: "" });

      // One tap: the column becomes a change request (a project change for a site condition), the tile a snag; retries make nothing new.
      state = await site.command(actor, w.workspaceId, w.projectId, { action: "raise_issue", issueId: column, kind: "change_request" });
      state = await site.command(actor, w.workspaceId, w.projectId, { action: "raise_issue", issueId: column, kind: "change_request" });
      const change = (await w.client.query("SELECT id, title, reason, project_id AS \"projectId\" FROM change_requests WHERE workspace_id=$1", [w.workspaceId])).rows;
      expect(change).toEqual([{ id: column, title: "Column behind the kitchen wall", reason: "site_condition", projectId: w.projectId }]);
      expect(cardOf(state, w.today).issues.find((item) => item.id === column)).toMatchObject({ raised: "change_request", changeRequestId: column, changeRequestReference: "CR-001" });
      state = await site.command(actor, w.workspaceId, w.projectId, { action: "raise_issue", issueId: tile, kind: "snag" });
      const snag = cardOf(state, w.today).issues.find((item) => item.id === tile)!;
      expect(snag).toMatchObject({ raised: "snag" });
      expect(snag.workItemNumber).toBeGreaterThan(0);
      expect((await w.client.query("SELECT type FROM work_items WHERE workspace_id=$1 AND id=$2", [w.workspaceId, snag.workItemId])).rows[0].type).toBe("snag");

      // The progress report (PDF) for the period: the client's card of the approved day, never the crew, internal issues or materials.
      const printed = await manager.progressReport(actor, w.workspaceId, w.projectId, { from: day(w.today, -6), to: w.today });
      expect(printed).toMatchObject({ project: { name: expect.any(String) }, from: day(w.today, -6), to: w.today });
      expect(printed.days.map((entry) => entry.date)).toEqual([w.today]);
      expect(printed.days[0].completed).toEqual(["Fit kitchen carcasses"]);
      expect(JSON.stringify(printed)).not.toMatch(/Carpenters|Socket|Plywood|Column behind/);
      await expect(manager.progressReport(actor, w.workspaceId, w.projectId, { to: w.today })).rejects.toThrow(/period/);

      const audit = (await w.client.query("SELECT action FROM audit_events WHERE workspace_id=$1 AND action LIKE 'site.%' ORDER BY occurred_at", [w.workspaceId])).rows.map((row) => row.action);
      expect(audit).toEqual(expect.arrayContaining(["site.update_issue", "site.set_client_visibility", "site.remove_photo", "site.raise_issue"]));
    });
  });

  it("two people's reports of a day make one card; the missing working days follow the workspace calendar; the latest days and today's card read alike", async () => {
    await world(async (w) => {
      const site = w.site(w.supervisor), manager = w.site(w.manager);
      // Site work started ten days ago.
      await w.client.query("UPDATE delivery_projects SET site_started_on = $3 WHERE workspace_id=$1 AND id=$2", [w.workspaceId, w.projectId, day(w.today, -10)]);
      const mine = randomUUID(), theirs = randomUUID(), backdated = randomUUID();
      await site.command(actor, w.workspaceId, w.projectId, { action: "save_report", id: mine, noWorkReason: "Waiting for the client's tiles", workforce: [{ trade: "Tilers", people: 2 }] });
      let state = await manager.command(actor, w.workspaceId, w.projectId, { action: "save_report", id: theirs, workforce: [{ trade: "Tilers", people: 1 }, { trade: "Electricians", people: 2 }] });
      await w.photo(theirs);
      state = await site.state(actor, w.workspaceId, w.projectId);
      state = await site.command(actor, w.workspaceId, w.projectId, { action: "submit", reportId: mine, version: reportOf(state, mine).version });
      // The same person again on the same day: open the one they have.
      await w.client.query("SAVEPOINT duplicate");
      await expect(site.command(actor, w.workspaceId, w.projectId, { action: "save_report", id: randomUUID(), noWorkReason: "Again" })).rejects.toThrow(/already have a report for that day/);
      await w.client.query("ROLLBACK TO SAVEPOINT duplicate");
      // A missed day, written today (backdated), with a report.
      const missedDay = [...Array(10).keys()].map((back) => day(w.today, -(back + 1))).find((date) => w.workingDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()))!;
      await site.command(actor, w.workspaceId, w.projectId, { action: "save_report", id: backdated, reportDate: missedDay, noWorkReason: "Rain" });
      state = await site.state(actor, w.workspaceId, w.projectId);
      state = await site.command(actor, w.workspaceId, w.projectId, { action: "submit", reportId: backdated, version: reportOf(state, backdated).version });
      await expect(site.command(actor, w.workspaceId, w.projectId, { action: "save_report", id: randomUUID(), reportDate: day(w.today, 1), noWorkReason: "Later" })).rejects.toThrow(/hasn't come/);

      const card = cardOf(state, w.today);
      expect(card.reports.map((report) => [report.authorName, report.status])).toEqual(expect.arrayContaining([["Sara Supervisor", "submitted"], ["Omar Manager", "draft"]]));
      expect(card.status).toBe("submitted");
      // Tilers add up across the reports; the crew is counted once per trade.
      expect(card.crew).toEqual([{ trade: "Tilers", people: 3, source: "report" }, { trade: "Electricians", people: 2, source: "report" }]);
      expect(cardOf(state, missedDay).reports[0]).toMatchObject({ backdated: true, noWorkReason: "Rain" });

      // Missing: the working days since site work started with no submitted report, never today (reported) or the missed day.
      const math = workdays({ workingDays: w.workingDays, holidays: [] });
      const expected = [...Array(11).keys()].map((back) => day(w.today, -back)).filter((date) => math.isWorking(date) && date !== w.today && date !== missedDay);
      expect(state.days.missing).toEqual(expected);

      // The Overview's latest day, and the phone's / Home's today card, are the same card.
      const latest = await site.days(actor, w.workspaceId, w.projectId, { latest: "1" });
      expect(latest.cards.map((item) => item.date)).toEqual([w.today]);
      await expect(site.days(actor, w.workspaceId, w.projectId, { latest: "99" })).rejects.toThrow(/1 to 31/);
      const range = await site.days(actor, w.workspaceId, w.projectId, { from: day(w.today, -400), to: w.today });
      expect(range.from).toBe(day(w.today, -91));
      const today = await readSitesToday(w.client, w.workspaceId, w.supervisor);
      expect(today.sites).toEqual([expect.objectContaining({ projectId: w.projectId, report: { id: mine, status: "submitted" } })]);
      expect(today.sites[0].card).toMatchObject({ date: w.today, status: "submitted", people: 5 });
    });
  });
});
