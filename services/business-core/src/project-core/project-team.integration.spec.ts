import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { ensureJobForSource } from "../jobs/job-identity.store";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { SiteService } from "../site/site.service";
import { ProjectCoreService } from "./project-core.service";
import { completeProject } from "./project-finish";
import { carryTeamToCase, readCaseTeam } from "./project-team";
import { ProjectWorkService } from "./project-work.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const EVERYTHING = ["projects.manage", "projects.view", "pre_projects.view", "pre_projects.edit", "workspace.settings.manage", "commercial.costs.view", "receivables.view"];

type World = {
  client: PoolClient; workspaceId: string; caseId: string; quoteId: string; today: string;
  manager: string; designer: string; qs: string; seller: string;
  managerMembership: string; designerMembership: string; qsMembership: string; sellerMembership: string;
  core: (userId: string, permissions?: string[]) => ProjectCoreService; work: (userId: string, permissions?: string[]) => ProjectWorkService;
  site: (userId: string, permissions?: string[]) => SiteService;
  notices: (code: string) => Promise<Array<{ recipient: string; subject: string; body: string }>>;
};

integration("PLM-100 / PLM-089 / PLM-070 / PLM-065 / PLM-072: team carried to Won, closing with snags, installation with money owed, material status", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  /**
   * An enquiry tagged a designer and "QS not applicable"; the opportunity's own team names a factory lead; Sara owns it.
   * Its case has an accepted, signed main quotation with the advance verified and the payment before production owed.
   */
  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), leadId = randomUUID(), party = randomUUID(), opportunity = randomUUID(), kitchen = randomUUID();
    const [manager, designer, qs, seller] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const [managerMembership, designerMembership, qsMembership, sellerMembership] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Omar Manager'),($3,$4,'Dana Designer'),($5,$6,'Quinn Factory'),($7,$8,'Sara Sales')",
        [manager, `${manager.slice(0, 8)}@example.com`, designer, `${designer.slice(0, 8)}@example.com`, qs, `${qs.slice(0, 8)}@example.com`, seller, `${seller.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','UTC',$3)", [workspaceId, `pt-${workspaceId.slice(0, 8)}`, manager]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active'),($6,$2,$7,'active'),($8,$2,$9,'active')",
        [managerMembership, workspaceId, manager, designerMembership, designer, qsMembership, qs, sellerMembership, seller]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id) VALUES($1,$2,$3,$4)", [leadId, workspaceId, randomUUID(), party]);
      await client.query(`INSERT INTO crm_lead_team(workspace_id,lead_id,role_code,membership_id,not_applicable) VALUES($1,$2,'designer',$3,false),($1,$2,'quantity_surveyor',NULL,true)`,
        [workspaceId, leadId, designerMembership]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4::uuid,$5,$6,$7,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, null, randomUUID(), randomUUID(), sellerMembership]);
      // The job starts at the opportunity (this fixture has no enquiry record), then the opportunity is tied to its enquiry's lead.
      await ensureJobForSource(client, workspaceId, { type: "opportunity", id: opportunity }, manager);
      await client.query("UPDATE crm_opportunities SET lead_id = $3 WHERE workspace_id = $1 AND id = $2", [workspaceId, opportunity, leadId]);
      await client.query("INSERT INTO crm_opportunity_team(workspace_id,opportunity_id,membership_id,role) VALUES($1,$2,$3,'factory_lead')", [workspaceId, opportunity, qsMembership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, manager]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      const today = (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE 'UTC')::date::text AS today`)).rows[0].today;
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const run = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const member = (userId: string) => (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const access = (userId: string, permissions: string[]) => ({
        asMember: member(userId), withPermission: run(userId), withAnyPermission: run(userId),
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code),
      } as never);
      const builder = new QuotationBuilderService({ withPermission: run(manager), withPermissions: run(manager), withAnyPermission: run(manager), hasPermission: async () => true } as never, {} as never);
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
        { id: "p2", sourceQuoteId: quoteId, title: "Before production", amount: 1500, dueDate: today, requiredForRelease: false, requiredForProduction: true, status: "pending", proof: "", reference: "" },
        { id: "p3", sourceQuoteId: quoteId, title: "On handover", amount: 500, dueDate: today, requiredForRelease: false, requiredForProduction: false, status: "pending", proof: "", reference: "" },
      ];
      data.revision = loaded.revision + 1;
      await commercialRepository.save(client, workspaceId, caseId, data);
      await run_({
        client, workspaceId, caseId, quoteId, today, manager, designer, qs, seller, managerMembership, designerMembership, qsMembership, sellerMembership,
        core: (userId, permissions = EVERYTHING) => new ProjectCoreService(access(userId, permissions)),
        work: (userId, permissions = EVERYTHING) => new ProjectWorkService(access(userId, permissions)),
        site: (userId, permissions = EVERYTHING) => new SiteService(access(userId, permissions)),
        notices: async (code: string) => (await client.query<{ recipient: string; subject: string; body: string }>(
          `SELECT recipient_id AS recipient, subject, body FROM notifications WHERE workspace_id=$1 AND event_type=$2 AND channel='in_app' ORDER BY created_at`, [workspaceId, code])).rows,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    async function run_(value: World) { await run(value); }
  }

  it("carries the enquiry's and the opportunity's team into the Planning case and the project, never overwriting, and shows it on both", async () => {
    await world(async (w) => {
      // The case: each person in their role (which opens the case to them), QS not applicable, Sara as account manager.
      const carried = await carryTeamToCase(w.client, w.workspaceId, w.caseId, w.manager);
      expect(carried).toEqual(expect.arrayContaining([
        { role: "designer", membershipId: w.designerMembership, notApplicable: false },
        { role: "quantity_surveyor", membershipId: null, notApplicable: true },
        { role: "factory_lead", membershipId: w.qsMembership, notApplicable: false },
        { role: "account_manager", membershipId: w.sellerMembership, notApplicable: false },
      ]));
      expect(await carryTeamToCase(w.client, w.workspaceId, w.caseId, w.manager)).toEqual([]);
      const assignments = (await w.client.query<{ membershipId: string; roles: string[] }>(
        `SELECT membership_id AS "membershipId", role_keys AS roles FROM project_assignments WHERE workspace_id=$1 AND case_id=$2 ORDER BY membership_id`, [w.workspaceId, w.caseId])).rows;
      expect(assignments).toEqual(expect.arrayContaining([{ membershipId: w.designerMembership, roles: ["designer"] }, { membershipId: w.qsMembership, roles: ["factory_lead"] }]));
      const caseTeam = await readCaseTeam(w.client, w.workspaceId, w.caseId);
      expect(caseTeam.map((role) => [role.role, role.member?.name ?? null, role.notApplicable])).toEqual([
        ["account_manager", "Sara Sales", false], ["designer", "Dana Designer", false], ["quantity_surveyor", null, true], ["factory_lead", "Quinn Factory", false],
      ]);

      // Someone changes the case's factory lead; the project keeps that choice and the project manager chosen at the start.
      await w.client.query(`UPDATE project_assignments SET role_keys = '{}' WHERE workspace_id=$1 AND case_id=$2 AND membership_id=$3`, [w.workspaceId, w.caseId, w.qsMembership]);
      await w.client.query(`INSERT INTO project_assignments (workspace_id, case_id, membership_id, is_manager, active, role_keys) VALUES ($1,$2,$3,false,true,ARRAY['factory_lead']::varchar[])
        ON CONFLICT (workspace_id, case_id, membership_id) WHERE case_id IS NOT NULL DO UPDATE SET role_keys = ARRAY['designer','factory_lead']::varchar[]`, [w.workspaceId, w.caseId, w.designerMembership]);
      const { projectId } = await w.core(w.manager).start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const detail = await w.core(w.manager).get(actor, w.workspaceId, projectId);
      const team = Object.fromEntries(detail.team.map((role) => [role.role, role.member?.name ?? (role.notApplicable ? "n/a" : null)]));
      expect(team).toMatchObject({ project_manager: "Omar Manager", account_manager: "Sara Sales", designer: "Dana Designer", factory_lead: "Dana Designer", quantity_surveyor: "n/a",
        procurement: null });
      expect(detail.teamNote).toBe("");
      const started = (await w.client.query<{ after: { team: unknown[] } }>(`SELECT after FROM audit_events WHERE workspace_id=$1 AND action='project.started'`, [w.workspaceId])).rows[0];
      expect(started.after.team).toEqual(expect.arrayContaining([{ role: "quantity_surveyor", membershipId: null, notApplicable: true }]));
      // Everyone carried hears the project started, with their role.
      expect((await w.notices("project.started")).map((row) => row.recipient)).toEqual(expect.arrayContaining([w.designer, w.seller]));

      // Not applicable, then back to a person; the external people note. Each is versioned and audited; repeating is a no-op.
      let next = await w.core(w.manager).command(actor, w.workspaceId, projectId, { action: "set_member", role: "procurement", notApplicable: true, version: detail.project.version });
      expect(next.team.find((role) => role.role === "procurement")).toMatchObject({ member: null, notApplicable: true });
      const same = await w.core(w.manager).command(actor, w.workspaceId, projectId, { action: "set_member", role: "procurement", notApplicable: true, version: next.project.version });
      expect(same.project.version).toBe(next.project.version);
      next = await w.core(w.manager).command(actor, w.workspaceId, projectId, { action: "set_member", role: "quantity_surveyor", membershipId: w.qsMembership, version: next.project.version });
      expect(next.team.find((role) => role.role === "quantity_surveyor")).toMatchObject({ member: { name: "Quinn Factory" }, notApplicable: false });
      await expect(w.core(w.manager).command(actor, w.workspaceId, projectId, { action: "set_member", role: "project_manager", notApplicable: true, version: next.project.version }))
        .rejects.toThrow(/always has a project manager/);
      next = await w.core(w.manager).command(actor, w.workspaceId, projectId, { action: "set_team_note", note: "Installer: Ravi's crew", version: next.project.version });
      expect(next.teamNote).toBe("Installer: Ravi's crew");
      await expect(w.core(w.designer, ["projects.view"]).command(actor, w.workspaceId, projectId, { action: "set_team_note", note: "x", version: next.project.version }))
        .rejects.toThrow(/Only the project manager/);
      const audited = (await w.client.query<{ action: string }>(`SELECT action FROM audit_events WHERE workspace_id=$1 AND entity_id=$2 AND action IN ('project.set_member','project.set_team_note')`,
        [w.workspaceId, projectId])).rows.map((row) => row.action);
      expect(audited.sort()).toEqual(["project.set_member", "project.set_member", "project.set_team_note"]);
    });
  });

  it("refuses to complete a project while a snag is open, naming it; a closed snag lets it through", async () => {
    await world(async (w) => {
      const { projectId } = await w.core(w.manager).start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const snag = randomUUID();
      await w.work(w.manager).command(actor, w.workspaceId, projectId, { action: "create", id: snag, type: "snag", title: "Chipped door", severity: "minor", source: "internal" });
      const number = (await w.client.query<{ number: number }>(`SELECT number FROM work_items WHERE workspace_id=$1 AND id=$2`, [w.workspaceId, snag])).rows[0].number;
      const closeOut = await w.core(w.manager).closeOut(actor, w.workspaceId, projectId);
      expect(closeOut.openSnags).toEqual([{ id: snag, number, title: "Chipped door", severity: "minor" }]);
      expect(closeOut.openWork).toBe(0);
      await expect(completeProject(w.client, { workspaceId: w.workspaceId, project: { id: projectId, reference: "PRJ" }, actorUserId: w.manager }))
        .rejects.toThrow(`Before the project closes: 1 snag is still open (#${number} Chipped door).`);
      await w.client.query(`UPDATE work_items SET status = 'done', completed_at = now() WHERE workspace_id=$1 AND id=$2`, [w.workspaceId, snag]);
      await completeProject(w.client, { workspaceId: w.workspaceId, project: { id: projectId, reference: "PRJ" }, actorUserId: w.manager });
      expect((await w.client.query(`SELECT status FROM delivery_projects WHERE workspace_id=$1 AND id=$2`, [w.workspaceId, projectId])).rows[0].status).toBe("completed");
    });
  });

  it("blocks the installation sign-off while the payment due before installation is owed, says what's owed, and lets someone who manages projects sign it off with why", async () => {
    await world(async (w) => {
      const { projectId } = await w.core(w.manager).start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      // The payment before production is flagged on the terms; "On handover" isn't due before installation.
      await w.site(w.manager).command(actor, w.workspaceId, projectId, { action: "start_site", on: w.today });
      let state = await w.site(w.manager).state(actor, w.workspaceId, projectId);
      expect(state.installationOwed?.stages.map((stage) => stage.title)).toEqual(["Before production"]);
      expect(state.canSignOffOwed).toBe(true);
      // The project manager alone can't sign it off while money is owed.
      await expect(w.site(w.manager, ["projects.view"]).command(actor, w.workspaceId, projectId, { action: "finish_site", on: w.today }))
        .rejects.toThrow(/The client still owes AED .* before installation\. Finance verifies the payment first/);
      await expect(w.site(w.manager).command(actor, w.workspaceId, projectId, { action: "finish_site", on: w.today })).rejects.toThrow(/Say why installation is signed off before it's paid/);
      state = await w.site(w.manager).command(actor, w.workspaceId, projectId, { action: "finish_site", on: w.today, owedReason: "Owner agreed: paid on handover" });
      expect(state.site.finishedOn).toBe(w.today);
      const audit = (await w.client.query<{ after: Record<string, string> }>(`SELECT after FROM audit_events WHERE workspace_id=$1 AND action='site.finish_site'`, [w.workspaceId])).rows[0];
      expect(audit?.after).toMatchObject({ owedReason: "Owner agreed: paid on handover" });
      expect(audit?.after.owed).toMatch(/^AED 1500\.00/);
      // Finance (whoever manages receivables, none here) and the account manager hear, in the app and by email.
      const told = await w.notices("site.installation_owed");
      expect(told.map((row) => row.recipient)).toContain(w.seller);
      expect(told[0].body).toMatch(/Before production.*Owner agreed: paid on handover/);
    });
  });

  it("finishes site work as before when nothing is owed before installation", async () => {
    await world(async (w) => {
      const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
      const data = { ...(loaded.content as CommercialData), revision: loaded.revision + 1 };
      data.payments = data.payments.map((payment) => (payment.id === "p2" ? { ...payment, requiredForProduction: false } : payment));
      await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
      const { projectId } = await w.core(w.manager).start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      await w.site(w.manager, ["projects.view"]).command(actor, w.workspaceId, projectId, { action: "start_site", on: w.today });
      const state = await w.site(w.manager, ["projects.view"]).command(actor, w.workspaceId, projectId, { action: "finish_site", on: w.today });
      expect(state.site.finishedOn).toBe(w.today);
      expect(await w.notices("site.installation_owed")).toEqual([]);
    });
  });

  it("shows each material's status on the project's Materials tab", async () => {
    await world(async (w) => {
      const { projectId } = await w.core(w.manager).start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
      const detail = await w.core(w.manager).get(actor, w.workspaceId, projectId);
      await w.core(w.manager).command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "12", unit: "sheet", boqLineIds: [], version: detail.project.version });
      const materials = await w.core(w.manager).materials(actor, w.workspaceId, projectId);
      expect(materials.items.map((item) => [item.name, item.status])).toEqual([["Oak veneer", "required"]]);
    });
  });
});
