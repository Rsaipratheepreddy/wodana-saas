import { ConfigService } from "@nestjs/config";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvalStatus } from "../approvals/approval-engine.api";
import { decidePortalChange, raiseChange, readPortalChanges } from "../client-portal/portal-changes";
import { readBudget } from "../client-portal/portal-budget";
import type { PortalContact } from "../client-portal/portal-auth";
import { readPortalSettings } from "../client-portal/portal-settings";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { ProjectCoreService } from "../project-core/project-core.service";
import { readNeeds } from "../purchasing/orders";
import { EsignService } from "../proposals/esign.service";
import { QsReviewService } from "../proposals/qs-review.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { changeDecisionReminderSource } from "./change-request-reminder-source";
import { createSourceRegistry } from "../reminders/engine/engine";
import { sweepWorkspace } from "../reminders/engine/sweep";
import { ProjectRemindersService } from "../projects/project-reminders.service";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ChangeRequestsService } from "./change-requests.service";
import { ProjectChangesService } from "./project-changes.service";
import { approvedVariations, readProjectChange } from "./project-changes.store";
import { variationHolds } from "./variation-holds";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Fixtures are committed in their own
// workspaces; every command runs as the app role (wodana_app, forced RLS) in its own committed transaction, so replays,
// stale versions, separation of duties and tenants are real.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const NIL = "00000000-0000-4000-8000-000000000000";
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

type People = { pm: string; qs: string; qs2: string; approver: string; site: string; finance: string; factory: string; buyer: string; outsider: string; qsOnly: string };
type Seed = People & {
  workspaceId: string; caseId: string; quoteId: string; projectId: string; grantId: string; kitchen: string; study: string; wardrobe: string; pendant: string;
  membership: Record<keyof People, string>; worktopLine: string; stages: Array<{ id: string; name: string; position: number }>; fitting: string; delivery: string;
};

integration("changes on a started project: raise → price → QS → approve → client → apply (§6.20)", { timeout: 120_000 }, () => {
  let pool: Pool;
  let storage: BrandAssetStorageService;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 6 });
    storage = new BrandAssetStorageService(new ConfigService({ BRAND_ASSET_STORAGE_DIR: await mkdtemp(join(tmpdir(), "wodana-project-changes-")) }));
  });
  afterAll(() => pool.end());

  async function asApp<T>(workspaceId: string, actorId: string, work: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_actor_id', $2, true)", [workspaceId, actorId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  /** Each person's permissions; services ask for anyone's (the QS check asks about the person a quotation goes to). */
  const PERMISSIONS: Record<keyof People, string[]> = {
    pm: ["projects.manage", "projects.view", "pre_projects.view", "pre_projects.edit", "workspace.settings.manage"],
    qs: ["projects.view", "pre_projects.view", "pre_projects.edit", "commercial.estimate", "commercial.costs.view"],
    qs2: ["projects.view", "pre_projects.view", "pre_projects.edit", "commercial.estimate"],
    approver: ["projects.view", "pre_projects.view", "commercial.approve"],
    site: ["projects.view"],
    finance: ["projects.view", "commercial.finance.verify"],
    factory: ["projects.view", "factory.manage"],
    buyer: ["projects.view", "purchasing.manage"],
    outsider: ["projects.view"],
    // QA-007: a QS as firms set them up (the quantity_surveyor template): Planning and costs, no projects, no planning edits.
    qsOnly: ["pre_projects.view", "crm.opportunities.view", "commercial.costs.view", "commercial.estimate"],
  };

  function access(seed: Seed, userId: string) {
    const permissionsOf = (id: string) => PERMISSIONS[(Object.keys(PERMISSIONS) as Array<keyof People>).find((key) => seed[key] === id) ?? "outsider"];
    const own = permissionsOf(userId);
    const run = async (workspaceId: string, required: string[], any: boolean, work: (client: PoolClient, user: { userId: string; displayName: string }) => Promise<unknown>) => {
      if (required.length && !(any ? required.some((code) => own.includes(code)) : required.every((code) => own.includes(code)))) throw new ForbiddenException(`Permissions required: ${required.join(", ")}`);
      return asApp(workspaceId, userId, (client) => work(client, { userId, displayName: "T" }));
    };
    return {
      asMember: (_a: unknown, workspaceId: string, work: never) => run(workspaceId, [], false, work),
      withPermission: (_a: unknown, workspaceId: string, code: string, work: never) => run(workspaceId, [code], false, work),
      withPermissions: (_a: unknown, workspaceId: string, codes: string[], work: never) => run(workspaceId, codes, false, work),
      withAnyPermission: (_a: unknown, workspaceId: string, codes: string[], work: never) => run(workspaceId, codes, true, work),
      hasPermission: async (_c: unknown, _w: string, id: string, code: string) => permissionsOf(id).includes(code),
    } as never;
  }

  const config = new ConfigService({ WEB_ORIGIN: "https://app.example.com", NODE_ENV: "test" });
  const sentLinks: Array<{ to: string; link: string }> = [];
  const mailer = {
    sendSignatureRequest: async (input: { to: string; signUrl: string }) => { sentLinks.push({ to: input.to, link: input.signUrl }); return { status: "sent" }; },
    sendSignedCopy: async () => ({ status: "sent" }),
  };
  const database = {
    query: (text: string, values?: unknown[]) => pool.query(text, values),
    tenantTransaction: (workspaceId: string, actorId: string, work: (client: PoolClient) => Promise<unknown>) => asApp(workspaceId, actorId, work),
  };
  function services(seed: Seed, userId: string) {
    const esign = new EsignService(database as never, access(seed, userId), storage, {} as never, mailer as never, config);
    const builder = new QuotationBuilderService(access(seed, userId), storage);
    const changes = new ChangeRequestsService(access(seed, userId), esign, storage);
    return { changes: new ProjectChangesService(access(seed, userId), builder, esign, changes, storage), builder, esign, qs: new QsReviewService(access(seed, userId)),
      core: new ProjectCoreService(access(seed, userId)) };
  }

  /** The client's side: their contact and grant, the portal settings, and a code check that passes only for `good`. */
  function portal(seed: Seed, good = "123456") {
    const contact: PortalContact = { sessionId: randomUUID(), phone: "+10000000001", name: "Maya Client", nameConfirmed: true,
      grants: [{ id: seed.grantId, caseId: seed.caseId, name: "Maya Client", role: "approver", email: "maya@example.com", confirmed: true, demo: false }] };
    return <T>(work: (ctx: never) => Promise<T>) => asApp(seed.workspaceId, NIL, async (client) =>
      work({ db: client, workspaceId: seed.workspaceId, contact, settings: await readPortalSettings(client, seed.workspaceId), today: "2026-10-11",
        verify: async (_purpose: string, _challenge: string, code: string) => code === good } as never));
  }

  async function notices(seed: Seed, code: string) {
    return (await pool.query<{ recipient: string; channel: string }>(
      `SELECT recipient_id::text AS recipient, channel FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND recipient_type = 'user' ORDER BY created_at`,
      [seed.workspaceId, code])).rows;
  }
  const who = (seed: Seed, rows: Array<{ recipient: string; channel: string }>, channel = "in_app") =>
    [...new Set(rows.filter((row) => row.channel === channel).map((row) => (Object.keys(PERMISSIONS) as Array<keyof People>).find((key) => seed[key] === row.recipient) ?? row.recipient))].sort();

  async function seed(): Promise<Seed> {
    const people = Object.fromEntries((Object.keys(PERMISSIONS) as Array<keyof People>).map((key) => [key, randomUUID()])) as People;
    const membership = Object.fromEntries((Object.keys(PERMISSIONS) as Array<keyof People>).map((key) => [key, randomUUID()])) as Record<keyof People, string>;
    const ids = { workspaceId: randomUUID(), caseId: randomUUID(), quoteId: randomUUID(), grantId: randomUUID(), kitchen: randomUUID(), study: randomUUID(), wardrobe: randomUUID(), pendant: randomUUID() };
    const party = randomUUID(), opportunity = randomUUID(), catalog = randomUUID(), category = randomUUID(), book = randomUUID(), entity = randomUUID(), profile = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const names: Record<keyof People, string> = { pm: "Pia PM", qs: "Quinn QS", qs2: "Queenie QS", approver: "Ada Approver", site: "Sam Site", finance: "Fay Finance", factory: "Faisal Factory", buyer: "Bo Buyer", outsider: "Olly Outside", qsOnly: "Quentin QS" };
      for (const key of Object.keys(people) as Array<keyof People>)
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [people[key], `${people[key].slice(0, 8)}@example.com`, names[key]]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [ids.workspaceId, `pch-${ids.workspaceId.slice(0, 8)}`, people.pm]);
      for (const key of Object.keys(people) as Array<keyof People>)
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership[key], ids.workspaceId, people[key]]);
      // Roles in the database (the approval engine and the notices read them).
      for (const [key, code] of [["approver", "commercial.approve"], ["qs", "commercial.estimate"], ["qs2", "commercial.estimate"], ["qsOnly", "commercial.estimate"], ["finance", "commercial.finance.verify"],
        ["factory", "factory.manage"], ["buyer", "purchasing.manage"]] as Array<[keyof People, string]>) {
        const role = randomUUID();
        await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,$3,$3,false)", [role, ids.workspaceId, `${key}_${role.slice(0, 6)}`]);
        await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = $3", [ids.workspaceId, role, code]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [ids.workspaceId, membership[key], role]);
      }
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, ids.workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, ids.workspaceId, party, randomUUID(), randomUUID(), membership.qs]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [ids.caseId, ids.workspaceId, opportunity, people.pm]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen'),($4,$2,$3,'Study')", [ids.kitchen, ids.workspaceId, ids.caseId, ids.study]);
      await client.query("INSERT INTO client_portal_grants(id,workspace_id,case_id,name,phone,role,email) VALUES($1,$2,$3,'Maya Client','+10000000001','approver','maya@example.com')", [ids.grantId, ids.workspaceId, ids.caseId]);
      await client.query("INSERT INTO client_portal_settings(workspace_id,slug,enabled) VALUES($1,$2,true)", [ids.workspaceId, `studio-${ids.workspaceId.slice(0, 8)}`]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [ids.workspaceId, ids.caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [ids.workspaceId, ids.caseId, ids.quoteId]);
      // The firm's tax (5%), its catalogue (a made wardrobe, a bought pendant light) and its QS rules (variations from 10 000).
      await client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone,status) VALUES($1,$2,'STU','Studio','Studio LLC','AE','AED','en-AE','Asia/Dubai','active')`, [entity, ids.workspaceId]);
      await client.query(`INSERT INTO tax_profiles(id,workspace_id,legal_entity_id,name,jurisdiction_code,scheme,prices_include_tax,effective_from,version,status) VALUES($1,$2,$3,'VAT','AE','vat',false,now(),1,'active')`, [profile, ids.workspaceId, entity]);
      await client.query(`INSERT INTO tax_rates(workspace_id,tax_profile_id,code,label,rate,is_default) VALUES($1,$2,'standard','Standard','5',true)`, [ids.workspaceId, profile]);
      await client.query("INSERT INTO catalogs(id,workspace_id,code,name) VALUES($1,$2,'main','Main')", [catalog, ids.workspaceId]);
      await client.query("INSERT INTO catalog_categories(id,workspace_id,catalog_id,code,name) VALUES($1,$2,$3,'joinery','Joinery')", [category, ids.workspaceId, catalog]);
      await client.query("INSERT INTO catalog_items(id,workspace_id,catalog_id,category_id,code,name,item_type,unit_code) VALUES($1,$2,$3,$4,'WR-1','Oak wardrobe','assembly','nos'),($5,$2,$3,$4,'PL-1','Pendant light','ready_made','nos')",
        [ids.wardrobe, ids.workspaceId, catalog, category, ids.pendant]);
      await client.query("INSERT INTO price_books(id,workspace_id,catalog_id,name,currency,status,effective_from) VALUES($1,$2,$3,'Retail','AED','active','2026-01-01')", [book, ids.workspaceId, catalog]);
      await client.query("INSERT INTO price_entries(workspace_id,price_book_id,item_id,method,price,cost,status) VALUES($1,$2,$3,'fixed',4000,2500,'active'),($1,$2,$4,'fixed',450,200,'active')",
        [ids.workspaceId, book, ids.wardrobe, ids.pendant]);
      await client.query("INSERT INTO workspace_quotation_settings(workspace_id,price_book_id,qs_review,qs_review_scope,qs_variation_threshold) VALUES($1,$2,true,'rules',10000)", [ids.workspaceId, book]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, ids.workspaceId);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    const partial = { ...people, ...ids, membership } as Seed;
    // The accepted quotation (priced by the builder with the firm's tax), the agreement and the verified advance; the project starts from it.
    const { builder, core } = services(partial, people.pm);
    await builder.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [
      { op: "upsert", line: { id: "cab", title: "Kitchen cabinets", unit: "m", quantity: "4.5", rate: "1200", areaId: ids.kitchen } },
      { op: "upsert", line: { id: "top", title: "Worktop", unit: "m²", quantity: "2.25", rate: "800", areaId: ids.kitchen } },
    ] });
    await asApp(ids.workspaceId, people.pm, async (client) => {
      const loaded = (await commercialRepository.load(client, ids.workspaceId, ids.caseId))!;
      const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
      const quote = data.quotes.find((item) => item.id === ids.quoteId)!;
      quote.status = "accepted";
      quote.hash = freezeHash(quote);
      quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: quote.total, optionsTotal: 0, acceptedTotal: quote.total,
        decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Pia PM" };
      data.agreement = { quoteId: ids.quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed",
        executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Pia PM" } as never;
      data.payments = [{ id: "p1", sourceQuoteId: ids.quoteId, title: "Advance", amount: quote.total / 2, dueDate: "", requiredForRelease: true, requiredForProduction: false,
        status: "verified", proof: "bank transfer", reference: "TT-1", evidenceKind: "operational" },
        { id: "p2", sourceQuoteId: ids.quoteId, title: "Before installation", amount: quote.total / 2, dueDate: "2026-11-02", requiredForRelease: false, requiredForProduction: false, status: "pending", proof: "", reference: "" }];
      data.revision = loaded.revision + 1;
      await commercialRepository.save(client, ids.workspaceId, ids.caseId, data);
    });
    const { projectId } = await core.start(actor, ids.workspaceId, ids.caseId, { quoteId: ids.quoteId, leadMembershipId: membership.pm });
    // The team by role, the plan (two stages with dated, linked work) and the handover on Friday 6 Nov.
    const plan = { fitting: randomUUID(), delivery: randomUUID() };
    const stages = await (async () => {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        for (const [key, role] of [["qs", "quantity_surveyor"], ["site", "site_supervisor"], ["factory", "factory_lead"], ["buyer", "procurement"]] as Array<[keyof People, string]>)
          await db.query(`INSERT INTO project_assignments (id, workspace_id, project_id, membership_id, is_manager, active, role_keys) VALUES ($1, $2, $3, $4, false, true, ARRAY[$5]::varchar[])
                          ON CONFLICT (workspace_id, project_id, membership_id) WHERE project_id IS NOT NULL
                          DO UPDATE SET active = true, role_keys = array(SELECT DISTINCT unnest(project_assignments.role_keys || excluded.role_keys))`,
            [randomUUID(), ids.workspaceId, projectId, membership[key], role]);
        const rows = (await db.query<{ id: string; name: string; position: number }>(`SELECT id, name, position FROM project_stages WHERE workspace_id = $1 AND project_id = $2 ORDER BY position`,
          [ids.workspaceId, projectId])).rows;
        const production = rows.find((stage) => stage.name === "Production")!, installation = rows.find((stage) => stage.name === "Delivery and installation")!;
        await db.query(`INSERT INTO work_items (id, workspace_id, project_id, number, type, title, status, stage_id, assignee_membership_id, start_date, due_date, created_by)
                        VALUES ($1, $2, $3, 1, 'task', 'Make the joinery', 'todo', $4, $5, '2026-10-19', '2026-10-23', $6),
                               ($7, $2, $3, 2, 'task', 'Fit the joinery', 'todo', $8, $9, '2026-10-26', '2026-10-30', $6)`,
          [plan.fitting, ids.workspaceId, projectId, production.id, membership.factory, people.pm, plan.delivery, installation.id, membership.site]);
        await db.query(`INSERT INTO work_item_links (workspace_id, project_id, predecessor_id, successor_id, kind, lag_days, created_by) VALUES ($1, $2, $3, $4, 'fs', 0, $5)`,
          [ids.workspaceId, projectId, plan.fitting, plan.delivery, people.pm]);
        await db.query("UPDATE delivery_projects SET promise_date = '2026-11-06', start_date = '2026-10-01' WHERE workspace_id = $1 AND id = $2", [ids.workspaceId, projectId]);
        await db.query("COMMIT");
        return rows;
      } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
    })();
    const worktopLine = (await pool.query<{ id: string }>("SELECT id FROM project_boq_lines WHERE workspace_id = $1 AND project_id = $2 AND title = 'Worktop'", [ids.workspaceId, projectId])).rows[0].id;
    return { ...partial, projectId, stages, worktopLine, fitting: plan.fitting, delivery: plan.delivery };
  }

  it("moves the price, the plan, the money and the people: from a site supervisor's change to an applied VO-1", async () => {
    const s = await seed();
    const site = services(s, s.site).changes, qs = services(s, s.qs), qs2 = services(s, s.qs2), ada = services(s, s.approver).changes, pm = services(s, s.pm).changes;
    const production = s.stages.find((stage) => stage.name === "Production")!;

    // RAISE (the site supervisor, from the project): a catalogue wardrobe and two lights, part of the worktop out, a shelf, and three days on Production.
    const id = randomUUID();
    const input = { id, title: "Study wardrobe and lights", reason: "client_request", description: "Client asked on site.", stageImpacts: [{ stageId: production.id, days: 3 }],
      lines: [
        { id: randomUUID(), source: "catalog", catalogItemId: s.wardrobe, title: "Oak wardrobe", quantity: "1", roomId: s.study },
        { id: randomUUID(), source: "catalog", catalogItemId: s.pendant, title: "Pendant light", quantity: "2", roomId: s.kitchen },
        { id: randomUUID(), source: "boq_line", action: "omit", boqLineId: s.worktopLine, title: "Worktop", quantity: "1" },
        { id: randomUUID(), source: "custom", title: "Extra shelf", quantity: "2", unit: "nos", unitPrice: "450.50", roomId: s.study },
      ] };
    await expect(services(s, s.outsider).changes.raise(actor, s.workspaceId, s.projectId, input)).rejects.toBeInstanceOf(NotFoundException);
    let record = await site.raise(actor, s.workspaceId, s.projectId, input);
    // Joinery's three days push the fitting (its successor) and the handover: Fri 6 Nov → Wed 11 Nov.
    expect(record.change).toMatchObject({ reference: "CR-001", status: "draft", reason: "client_request", handoverBefore: "2026-11-06", handoverAfter: "2026-11-11", timeImpactDays: 3 });
    expect(record.timeline.preview).toMatchObject({ planned: true, finishDelay: 3, handoverAfter: "2026-11-11" });
    expect(record.timeline.preview!.items.map((move) => [move.title, move.dueDate])).toEqual([["Make the joinery", "2026-10-28"], ["Fit the joinery", "2026-11-04"]]);
    expect(record.next).toBeNull(); // the site supervisor raises; pricing is for Sales or the QS
    // Replay returns it; another change with the same id is refused.
    expect((await site.raise(actor, s.workspaceId, s.projectId, input)).change.id).toBe(id);
    await expect(site.raise(actor, s.workspaceId, s.projectId, { ...input, title: "Other" })).rejects.toBeInstanceOf(ConflictException);
    expect(who(s, await notices(s, "change_request.project_raised"))).toEqual(["pm", "qs"]);
    expect(who(s, await notices(s, "change_request.project_raised"), "email")).toEqual(["pm", "qs"]);

    // PRICE (the QS): a variation of the sealed quotation, priced by the shared engine with the firm's 5% tax.
    record = await qs.changes.get(actor, s.workspaceId, s.projectId, id);
    expect(record.next).toBe("price");
    await expect(qs.changes.price(actor, s.workspaceId, s.projectId, id, { version: record.change.version - 1 })).rejects.toThrow(/another window/);
    record = await qs.changes.price(actor, s.workspaceId, s.projectId, id, { version: record.change.version });
    expect(record.change.status).toBe("pricing");
    // Wardrobe 4000 + lights 900 + shelf 901 − worktop 800 (credited at what was paid) = 5001 net, 250.05 tax, 5251.05.
    expect(record.price).toMatchObject({ net: "5001.00", tax: "250.05", total: "5251.05", credit: "-840.00", value: "+5251.05", paymentRule: "before_work" });
    expect(record.price!.lines.map((line) => [line.op, line.title, line.total])).toEqual([
      ["add", "Oak wardrobe", "4200.00"], ["add", "Pendant light", "945.00"], ["omit", "Worktop", "-840.00"], ["add", "Extra shelf", "946.05"]]);
    expect(record.price!.paymentTerms).toEqual([expect.objectContaining({ title: "Before the work starts", percent: 100, requiredForRelease: true })]);
    // The commercial page can't move it on: it moves with its change.
    expect(record.qs).toBe("not_needed");
    record = (await qs.changes.price(actor, s.workspaceId, s.projectId, id, { version: record.change.version }));
    expect(record.change.status).toBe("pricing");

    // QS (the firm's rules: from 5 000 a variation goes to the QS): refused until a QS confirms its pricing.
    await pool.query("UPDATE workspace_quotation_settings SET qs_variation_threshold = 5000 WHERE workspace_id = $1", [s.workspaceId]);
    record = await qs.changes.get(actor, s.workspaceId, s.projectId, id);
    expect([record.qs, record.next]).toEqual(["needed", "send_to_qs"]);
    await expect(qs.changes.submit(actor, s.workspaceId, s.projectId, id, { version: record.change.version })).rejects.toBeInstanceOf(ConflictException);
    await qs.qs.send(actor, s.workspaceId, s.caseId, record.change.quoteId!, { assigneeUserId: s.qs2 });
    expect((await qs.changes.get(actor, s.workspaceId, s.projectId, id)).qs).toBe("with_qs");
    await qs2.qs.decide(actor, s.workspaceId, s.caseId, record.change.quoteId!, { decision: "confirm", commandId: randomUUID() });
    record = await qs.changes.get(actor, s.workspaceId, s.projectId, id);
    expect([record.qs, record.next]).toEqual(["confirmed", "submit"]);

    // APPROVE inside the firm (E3, at the variation's size); the requester can't approve their own.
    record = await qs.changes.submit(actor, s.workspaceId, s.projectId, id, { version: record.change.version });
    expect(record.change.status).toBe("pending_approval");
    expect(record.approval).toMatchObject({ kind: "change_request", status: "pending", amount: "5251.05", currency: "AED" });
    await expect(qs.changes.decide(actor, s.workspaceId, s.projectId, id, { decision: "approve" })).rejects.toThrow(/your own/);
    expect((await ada.get(actor, s.workspaceId, s.projectId, id)).next).toBe("approve");
    record = await ada.decide(actor, s.workspaceId, s.projectId, id, { decision: "approve", approvalVersion: record.approval!.version, commandId: randomUUID() });
    expect(record.change.status).toBe("to_send");
    expect(who(s, await notices(s, "change_request.ready"))).toEqual(["pm", "qs"]);

    // SEND to the client (the project manager): the variation is issued and frozen; the client and the raiser hear it.
    record = await pm.get(actor, s.workspaceId, s.projectId, id);
    expect(record.next).toBe("send");
    await expect(pm.send(actor, s.workspaceId, s.projectId, id, { version: record.change.version - 1, commandId: randomUUID() })).rejects.toThrow(/another window/);
    const sent = await pm.send(actor, s.workspaceId, s.projectId, id, { version: record.change.version, commandId: randomUUID() });
    expect(sent.change.status).toBe("with_client");
    expect(sent.emailed).toBe("maya@example.com");
    expect(sent.timeline.sent).toMatchObject({ handoverBefore: "2026-11-06", handoverAfter: "2026-11-11", finishDelay: 3 });
    expect(who(s, await notices(s, "change_request.sent"))).toEqual(["site"]);
    const clientEmails = (await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND recipient_type = 'portal_contact' AND event_type = 'portal.decision_waiting'`,
      [s.workspaceId])).rows[0].n;
    expect(clientEmails).toBeGreaterThan(0);

    // The order already placed for the worktop (to be flagged for the buyer, never changed).
    const po = randomUUID();
    const poClient = await pool.connect();
    try {
      await poClient.query("BEGIN"); await poClient.query("SET LOCAL session_replication_role = replica");
      await poClient.query(`INSERT INTO purchase_orders(id,workspace_id,number,legal_entity_id,vendor_id,currency,status,payment_terms,created_by,approved_at,sent_at) VALUES($1,$2,'PO-0007',$3,$4,'AED','sent','on_delivery',$5,now(),now())`,
        [po, s.workspaceId, randomUUID(), randomUUID(), s.buyer]);
      await poClient.query(`INSERT INTO purchase_order_lines(id,workspace_id,order_id,position,project_id,source,boq_line_id,description,specification,quantity,unit,unit_price,discount_percent,tax_rate,net,tax,total,cancelled_quantity,alternate_specification,alternate_note)
        VALUES($1,$2,$3,0,$4,'line',$5,'Worktop','',2.25,'m²',300,0,0,675,0,675,0,'','')`, [randomUUID(), s.workspaceId, po, s.projectId, s.worktopLine]);
      await poClient.query("COMMIT");
    } finally { poClient.release(); }
    await pool.query("UPDATE workspace_project_settings SET require_variation_payment = true WHERE workspace_id = $1", [s.workspaceId]);

    // The CLIENT in the portal: the priced change and the new handover; a wrong code decides nothing; approve with a code.
    const run = portal(s);
    const seen = await run((ctx) => readPortalChanges((ctx as { db: PoolClient }).db, s.workspaceId, (ctx as { contact: PortalContact }).contact.grants[0], s.caseId, true));
    expect(seen.find((change) => change.id === id)).toMatchObject({ status: "waiting", canDecide: true, priceImpact: "5251.05",
      price: { net: "5001.00", tax: "250.05", total: "5251.05" }, time: { handoverBefore: "2026-11-06", handoverAfter: "2026-11-11", stages: [{ name: "Production", delay: 3 }, { name: "Delivery and installation", delay: 3 }] } });
    expect(JSON.stringify(seen)).not.toMatch(/2500|unitCost|"cost"/);
    await expect(run((ctx) => decidePortalChange(ctx, { caseId: s.caseId, changeId: id, decision: "accept", code: "000000", version: sent.change.version }))).rejects.toThrow(/code/);
    const decided = await run((ctx) => decidePortalChange(ctx, { caseId: s.caseId, changeId: id, decision: "accept", code: "123456", version: sent.change.version }));
    expect(decided.audit).toMatchObject({ decision: "approve", replayed: false, status: "applied" });
    expect((await run((ctx) => decidePortalChange(ctx, { caseId: s.caseId, changeId: id, decision: "accept", code: "123456" }))).audit).toMatchObject({ replayed: true });

    // APPLIED in the same transaction: the contract value, the money, the plan, the scope, the material list and the orders.
    record = await pm.get(actor, s.workspaceId, s.projectId, id);
    expect(record.change).toMatchObject({ status: "applied", decisionMethod: "portal", decidedByName: "Maya Client", handoverAfter: "2026-11-11" });
    expect(record.timeline.applied).toMatchObject({ seal: "VO-1", handoverBefore: "2026-11-06", handoverAfter: "2026-11-11", orders: ["PO-0007"] });
    const money = await asApp(s.workspaceId, s.pm, (client) => approvedVariations(client, s.workspaceId, s.projectId));
    expect(money).toMatchObject({ sealed: { label: "R1", total: "7560.00" }, variationsTotal: "5251.05", agreed: "12811.05",
      variations: [{ label: "VO-1", reference: "CR-001", changeRequestId: id, net: "5001.00", tax: "250.05", total: "5251.05" }] });
    const project = (await pool.query<{ promise: string; total: string }>(
      `SELECT promise_date::text AS promise, (SELECT sum(total)::text FROM project_scope_seals WHERE project_id = $2) AS total FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [s.workspaceId, s.projectId])).rows[0];
    expect(project).toEqual({ promise: "2026-11-11", total: "12811.0500" });
    const dates = (await pool.query<{ title: string; due: string }>(`SELECT title, due_date::text AS due FROM work_items WHERE project_id = $1 ORDER BY number`, [s.projectId])).rows;
    expect(dates).toEqual([{ title: "Make the joinery", due: "2026-10-28" }, { title: "Fit the joinery", due: "2026-11-04" }]);
    const scope = (await pool.query<{ title: string; quantity: string; status: string; supply: string | null }>(
      `SELECT line.title, line.quantity::text AS quantity, line.status, package.supply FROM project_boq_lines line LEFT JOIN project_packages package ON package.id = line.package_id
        WHERE line.project_id = $1 ORDER BY line.position`, [s.projectId])).rows;
    expect(scope).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Worktop", quantity: "1.2500", status: "active" }),
      expect.objectContaining({ title: "Oak wardrobe", supply: "make" }), expect.objectContaining({ title: "Pendant light", supply: "ready_made" })]));
    // The variation's payment before the work, due now; the work it added waits for it (where the firm requires it).
    const data = await asApp(s.workspaceId, s.pm, async (client) => (await commercialRepository.load(client, s.workspaceId, s.caseId))!.content as CommercialData);
    expect(data.payments.filter((payment) => payment.sourceQuoteId === record.change.quoteId)).toEqual([expect.objectContaining({ title: "CR-001 · Before the work starts", amount: 5251.05, requiredForRelease: true })]);
    expect(data.quotes.find((quote) => quote.id === record.change.quoteId)).toMatchObject({ status: "accepted", changeRequestId: id, clientDecision: { decision: "accept", acceptedTotal: 5251.05 } });
    const held = await asApp(s.workspaceId, s.pm, (client) => variationHolds(client, s.workspaceId, [s.projectId]));
    expect([...held.values()]).toEqual(expect.arrayContaining(["VO-1"]));
    const needs = await asApp(s.workspaceId, s.pm, (client) => readNeeds(client, s.workspaceId, false, s.projectId));
    expect(needs.find((need) => need.title === "Pendant light")).toMatchObject({ blocked: "client_payment" });
    expect((await pool.query("SELECT count(*)::int AS n FROM project_material_items WHERE project_id = $1 AND name = 'Pendant light'", [s.projectId])).rows[0].n).toBe(1);
    // Who heard what: the owners, finance (to bill), the factory lead and procurement (to make and buy), the team and everyone whose work moved.
    expect(who(s, await notices(s, "change_request.decided"))).toEqual(["pm", "qs", "site"]);
    expect(who(s, await notices(s, "change_request.invoice"))).toEqual(["finance"]);
    expect(who(s, await notices(s, "change_request.materials"))).toEqual(["buyer", "factory"]);
    expect(who(s, await notices(s, "change_request.schedule_moved"))).toEqual(["buyer", "factory", "pm", "qs", "site"]);
    expect(who(s, await notices(s, "work.moved"))).toEqual(["factory", "site"]);
    // The client's budget counts the change once.
    const budget = await asApp(s.workspaceId, s.pm, async (client) => readBudget(client, s.workspaceId, s.caseId, "AED",
      await readPortalChanges(client, s.workspaceId, { id: s.grantId, caseId: s.caseId, name: "Maya", role: "approver", email: null, confirmed: true, demo: false }, s.caseId, true)));
    expect(budget).toMatchObject({ agreed: "7560.00", changesTotal: "5251.05", forecast: "12811.05" });

    // Applying again changes nothing; it's VO-1 once.
    record = await pm.apply(actor, s.workspaceId, s.projectId, id, { version: record.change.version });
    expect(record.change.status).toBe("applied");
    expect((await pool.query("SELECT count(*)::int AS n FROM project_scope_seals WHERE project_id = $1 AND kind = 'variation'", [s.projectId])).rows[0].n).toBe(1);

    // Another tenant sees nothing of it.
    const other = await seed();
    await expect(asApp(other.workspaceId, other.pm, (client) => readProjectChange(client, other.workspaceId, s.projectId, id))).rejects.toBeInstanceOf(NotFoundException);
    await expect(services(other, other.pm).changes.get(actor, other.workspaceId, s.projectId, id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("QA-007: the QS a change waits for opens it and prices it without the projects module, and nothing else of the project", async () => {
    const s = await seed();
    const pm = services(s, s.pm).changes, quentin = services(s, s.qsOnly);
    const raise = async (title: string, unitPrice: string) => (await pm.raise(actor, s.workspaceId, s.projectId, { id: randomUUID(), title, reason: "client_request",
      lines: [{ id: randomUUID(), source: "custom", title, quantity: "1", unit: "sum", unitPrice, roomId: s.study }] })).change;
    await pool.query("UPDATE workspace_quotation_settings SET qs_variation_threshold = 5000 WHERE workspace_id = $1", [s.workspaceId]);
    const big = await raise("Feature wall", "8000"), small = await raise("Paint touch-up", "300");
    let record = await pm.get(actor, s.workspaceId, s.projectId, big.id);
    record = await pm.price(actor, s.workspaceId, s.projectId, big.id, { version: record.change.version });
    await pm.price(actor, s.workspaceId, s.projectId, small.id, { version: (await pm.get(actor, s.workspaceId, s.projectId, small.id)).change.version });
    expect([record.qs, record.next]).toEqual(["needed", "send_to_qs"]);
    // Before it's with them the QS has no way into the project or its changes.
    await expect(quentin.changes.get(actor, s.workspaceId, s.projectId, big.id)).rejects.toThrow(/access to projects/);
    await expect(quentin.changes.list(actor, s.workspaceId, s.projectId)).rejects.toThrow(/access to projects/);
    await services(s, s.pm).qs.send(actor, s.workspaceId, s.caseId, record.change.quoteId!, { assigneeUserId: s.qsOnly });

    // With the QS: the change waiting for them, and only that one.
    expect((await quentin.changes.list(actor, s.workspaceId, s.projectId)).changes.map((change) => change.id)).toEqual([big.id]);
    record = await quentin.changes.get(actor, s.workspaceId, s.projectId, big.id);
    expect(record).toMatchObject({ qs: "with_qs", qsPricing: true, canOpenProject: false, actions: [], next: null, project: { caseId: s.caseId } });
    await expect(quentin.changes.get(actor, s.workspaceId, s.projectId, small.id)).rejects.toBeInstanceOf(NotFoundException);
    // Nothing else on the project: no raising, no sources, no steps, no project record.
    await expect(quentin.changes.raise(actor, s.workspaceId, s.projectId, { id: randomUUID(), title: "X", reason: "client_request", lines: [] })).rejects.toThrow(/access to projects/);
    await expect(quentin.changes.sources(actor, s.workspaceId, s.projectId, "")).rejects.toThrow(/access to projects/);
    await expect(quentin.changes.submit(actor, s.workspaceId, s.projectId, big.id, { version: record.change.version })).rejects.toThrow(/access to projects/);
    await expect(quentin.core.get(actor, s.workspaceId, s.projectId)).rejects.toThrow();
    // The QS prices the variation in the builder (prices only) and confirms it.
    const variation = await quentin.builder.builder(actor, s.workspaceId, s.caseId, record.change.quoteId!);
    expect([variation.canEdit, variation.canPrice]).toEqual([false, true]);
    const line = variation.lines.find((item) => item.title === "Feature wall")!;
    await quentin.builder.apply(actor, s.workspaceId, s.caseId, record.change.quoteId!, { ops: [{ op: "upsert", line: { id: line.id, version: line.version, rate: "7600" } }] });
    await quentin.qs.decide(actor, s.workspaceId, s.caseId, record.change.quoteId!, { decision: "confirm", commandId: randomUUID() });
    // Confirmed: it's back with Sales, and out of the QS's reach again.
    expect((await pm.get(actor, s.workspaceId, s.projectId, big.id)).qs).toBe("confirmed");
    await expect(quentin.changes.get(actor, s.workspaceId, s.projectId, big.id)).rejects.toThrow(/access to projects/);
  });

  it("declines, withdraws, reminds the client, and refuses steps out of turn", async () => {
    const s = await seed();
    const pm = services(s, s.pm).changes, ada = services(s, s.approver).changes;
    const raise = async (title: string) => (await pm.raise(actor, s.workspaceId, s.projectId, { id: randomUUID(), title, reason: "site_condition",
      lines: [{ id: randomUUID(), source: "custom", title: "Wall repair", quantity: "1", unit: "sum", unitPrice: "1200" }] })).change;
    const toClient = async (title: string) => {
      let record = await pm.get(actor, s.workspaceId, s.projectId, (await raise(title)).id);
      record = await pm.price(actor, s.workspaceId, s.projectId, record.change.id, { version: record.change.version });
      // Out of turn: applying or sending a change still being priced.
      await expect(pm.apply(actor, s.workspaceId, s.projectId, record.change.id, {})).rejects.toBeInstanceOf(ConflictException);
      await expect(pm.send(actor, s.workspaceId, s.projectId, record.change.id, { version: record.change.version, commandId: randomUUID() })).rejects.toBeInstanceOf(ConflictException);
      record = await pm.submit(actor, s.workspaceId, s.projectId, record.change.id, { version: record.change.version });
      record = await ada.decide(actor, s.workspaceId, s.projectId, record.change.id, { decision: "approve" });
      record = await pm.send(actor, s.workspaceId, s.projectId, record.change.id, { version: record.change.version, commandId: randomUUID() });
      return record;
    };
    // A change the client raised in the portal lands on the project's changes, with the team.
    const asked = randomUUID();
    await portal(s)((ctx) => raiseChange(ctx, { caseId: s.caseId, id: asked, title: "Green wallpaper in the study", description: "A dark one" }));
    expect((await pm.get(actor, s.workspaceId, s.projectId, asked)).change).toMatchObject({ status: "draft", raisedByClient: true, raisedByName: "Maya Client" });
    expect(who(s, await notices(s, "change_request.project_raised"))).toEqual(["pm", "qs"]);

    // Waiting with the client: one reminder system, the engine's change_request.client_decision (its rule: 2 and 5 days,
    // then the staff copy to the project manager). Sent on Monday 7 January 2030 at 08:00 UTC.
    const waiting = await toClient("Repair the wall");
    await pool.query("UPDATE change_requests SET sent_at = now() - interval '8 days' WHERE id = $1", [waiting.change.id]);
    const sources = createSourceRegistry([changeDecisionReminderSource]);
    const sweep = (now: string) => asApp(s.workspaceId, NIL, (client) => sweepWorkspace(client, s.workspaceId, { sources, now: new Date(now), scan: true, digests: false, health: false }));
    const reminders = async (recipientType: "portal_contact" | "user", channel: string) => (await pool.query<{ recipient: string; subject: string; link: string | null }>(
      `SELECT recipient_id::text AS recipient, subject, deep_link AS link FROM notifications WHERE workspace_id = $1 AND event_type = 'change_request.client_decision'
         AND recipient_type = $2 AND channel = $3 ORDER BY created_at`, [s.workspaceId, recipientType, channel])).rows;
    // The daily job no longer touches changes: nothing about this one is sent, even days after it went to the client.
    const aboutTheChange = async () => (await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1
      AND (event_type IN ('change_request.reminder', 'change_request.client_decision') OR idempotency_key LIKE '%' || $2 || '%' OR coalesce(deep_link, '') LIKE '%' || $2 || '%')`,
      [s.workspaceId, waiting.change.id])).rows[0].n;
    const beforeTheJob = await aboutTheChange();
    await asApp(s.workspaceId, NIL, (client) => new ProjectRemindersService({} as never).sendWorkspace(client, s.workspaceId));
    expect(await aboutTheChange()).toBe(beforeTheJob);
    await pool.query("UPDATE change_requests SET sent_at = '2030-01-07T08:00:00Z' WHERE id = $1", [waiting.change.id]);
    // Day 2 (Wednesday): the client's decision-maker, once however often the engine sweeps.
    await sweep("2030-01-09T10:00:00Z");
    await sweep("2030-01-09T10:00:00Z");
    expect((await reminders("portal_contact", "email")).map((row) => row.subject)).toEqual([`Your change ${waiting.change.reference} · Repair the wall is waiting for you`]);
    expect(await reminders("user", "in_app")).toEqual([]);
    // Day 5 is a Saturday: held to Monday's client window; then the second reminder and, after two, the project manager's copy.
    await sweep("2030-01-12T10:00:00Z");
    expect(await reminders("portal_contact", "email")).toHaveLength(1);
    await sweep("2030-01-14T10:00:00Z");
    await sweep("2030-01-14T10:00:00Z");
    expect(await reminders("portal_contact", "email")).toHaveLength(2);
    expect((await reminders("user", "in_app")).map((row) => [who(s, [{ recipient: row.recipient, channel: "in_app" }])[0], row.subject, row.link])).toEqual([
      ["pm", `Waiting on the client · ${waiting.change.reference} · Repair the wall`, `/workspace/projects/${s.projectId}/changes/${waiting.change.id}`]]);
    expect((await pool.query("SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND event_type = 'change_request.reminder'", [s.workspaceId])).rows[0].n).toBe(0);

    // Declined: the change and its variation stay as history; nothing moves.
    await expect(portal(s)((ctx) => decidePortalChange(ctx, { caseId: s.caseId, changeId: waiting.change.id, decision: "decline" }))).rejects.toThrow(/Say why/);
    await portal(s)((ctx) => decidePortalChange(ctx, { caseId: s.caseId, changeId: waiting.change.id, decision: "decline", note: "Too costly" }));
    const declined = await pm.get(actor, s.workspaceId, s.projectId, waiting.change.id);
    expect(declined.change).toMatchObject({ status: "declined", declineNote: "Too costly" });
    expect(declined.actions).toEqual([]);
    expect((await pool.query("SELECT count(*)::int AS n FROM project_scope_seals WHERE project_id = $1 AND kind = 'variation'", [s.projectId])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT status FROM commercial_quotes WHERE case_id = $1 AND id = $2", [s.caseId, declined.change.quoteId])).rows[0].status).toBe("declined");
    // Decided: its reminder closes, and nothing more goes to the client.
    await sweep("2030-01-15T10:00:00Z");
    expect((await pool.query("SELECT status FROM reminder_subjects WHERE workspace_id = $1 AND kind = 'change_request.client_decision'", [s.workspaceId])).rows).toEqual([{ status: "done" }]);
    await sweep("2030-01-21T10:00:00Z");
    expect(await reminders("portal_contact", "email")).toHaveLength(2);
    await expect(portal(s)((ctx) => decidePortalChange(ctx, { caseId: s.caseId, changeId: waiting.change.id, decision: "accept", code: "123456" }))).rejects.toThrow(/already declined/);

    // Returned by the approver: back to pricing; then withdrawn with why (its variation too).
    let record = await pm.get(actor, s.workspaceId, s.projectId, (await raise("Move the socket")).id);
    record = await pm.price(actor, s.workspaceId, s.projectId, record.change.id, { version: record.change.version });
    record = await pm.submit(actor, s.workspaceId, s.projectId, record.change.id, { version: record.change.version });
    record = await ada.decide(actor, s.workspaceId, s.projectId, record.change.id, { decision: "return", note: "Price the labour" });
    expect(record.change.status).toBe("pricing");
    await expect(pm.withdraw(actor, s.workspaceId, s.projectId, record.change.id, { version: record.change.version })).rejects.toThrow(/Say why/);
    record = await pm.withdraw(actor, s.workspaceId, s.projectId, record.change.id, { version: record.change.version, reason: "Client changed their mind" });
    expect(record.change.status).toBe("withdrawn");
    expect((await pool.query("SELECT status FROM commercial_quotes WHERE case_id = $1 AND id = $2", [s.caseId, record.change.quoteId])).rows[0].status).toBe("withdrawn");
    expect((await asApp(s.workspaceId, s.pm, (client) => approvalStatus(client, s.workspaceId, "change_request", record.change.id)))?.status).toBe("returned");
  });

  it("copies a firm's own change reminder days into the engine's rule, and only those (0307)", async () => {
    const copy = readFileSync(resolve(process.cwd(), "drizzle/0307_change_reminders_engine.sql"), "utf8").split("--> statement-breakpoint")[0];
    const client = await pool.connect();
    const firms = { standard: randomUUID(), own: randomUUID(), none: randomUUID(), ruled: randomUUID() };
    try {
      await client.query("BEGIN");
      // As before 0307: the project setting's column, and four firms on it.
      await client.query("ALTER TABLE workspace_project_settings ADD COLUMN change_reminder_days smallint[] NOT NULL DEFAULT '{3,7}'");
      await client.query("SET LOCAL session_replication_role = replica");
      for (const id of Object.values(firms))
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Firm',$2,'AED','Asia/Dubai',$1)", [id, `cr7-${id.slice(0, 8)}`]);
      await client.query(`INSERT INTO workspace_project_settings (workspace_id, roles, change_reminder_days) VALUES ($1, '[]', '{3,7}'), ($2, '[]', '{9,1,4,4}'), ($3, '[]', '{}'), ($4, '[]', '{10}')`,
        [firms.standard, firms.own, firms.none, firms.ruled]);
      // A firm that already set the kind's rule keeps it.
      await client.query(`INSERT INTO reminder_rules (workspace_id, kind, enabled, offsets, unit, working_days, escalate_after, chain, channels, digest)
        VALUES ($1, 'change_request.client_decision', true, '{1}', 'day', false, 1, '{}', '{email}', false)`, [firms.ruled]);
      await client.query(copy);
      await client.query(copy);
      const rules = (await client.query<{ workspaceId: string; enabled: boolean; offsets: number[]; escalateAfter: number; channels: string[] }>(
        `SELECT workspace_id AS "workspaceId", enabled, offsets, escalate_after AS "escalateAfter", channels FROM reminder_rules
          WHERE kind = 'change_request.client_decision' AND workspace_id = ANY($1::uuid[])`, [Object.values(firms)])).rows;
      const of = (id: string) => rules.find((rule) => rule.workspaceId === id);
      expect(of(firms.standard)).toBeUndefined();
      expect(of(firms.own)).toMatchObject({ enabled: true, offsets: [1, 4, 9], escalateAfter: 2, channels: ["whatsapp", "email"] });
      expect(of(firms.none)).toMatchObject({ enabled: false, offsets: [2, 5] });
      expect(of(firms.ruled)).toMatchObject({ offsets: [1], escalateAfter: 1, channels: ["email"] });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    // After 0307 the column is gone (nothing reads it).
    expect((await pool.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'workspace_project_settings' AND column_name = 'change_reminder_days'")).rows[0].n).toBe(0);
  });
});
