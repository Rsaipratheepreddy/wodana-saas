import { ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { beforeQuoteIssued } from "../proposals/quote-issue";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { designStageSource } from "../reminders/sources/designs";
import { DesignDecisionsService } from "./design-decisions.service";
import { completeStage, startJourney } from "./design-journey.store";
import { FinishesService } from "./finishes.service";
import { specificationGateProblem } from "./finishes.store";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Every service call runs as the app role
// (wodana_app, forced RLS) in its own committed transaction, as the person named, with only the permissions given.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

type Who = "ops" | "lead" | "junior" | "admin" | "coordinator" | "qs" | "factory" | "outsider";
type Seed = { workspaceId: string; caseId: string; quoteId: string; roomId: string; people: Record<Who, { user: string; member: string }> };

const DESIGNER = ["pre_projects.view", "pre_projects.edit", "pre_projects.record_client_design_decisions"];
const COORDINATOR = ["pre_projects.view", "pre_projects.manage_materials", "projects.view", "catalog.view", "catalog.samples.manage"];
const QS = ["pre_projects.view", "commercial.estimate", "commercial.costs.view", "commercial.costs.manage"];
const ALL = [...DESIGNER, "pre_projects.manage_lifecycle", "pre_projects.manage_materials", "workspace.settings.manage", "catalog.samples.manage", "catalog.view"];

integration("the finishes schedule, material log and samples (PLM-146, PLM-156, PLM-157)", { timeout: 180_000 }, () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 8 });
  });
  afterAll(async () => { await pool.end(); });

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

  /** A design job (Bespoke package, the new order) with its design team on the case; or, with `design: false`, a furniture order's case without design. */
  async function seed(options: { design?: boolean } = {}): Promise<Seed> {
    const workspaceId = randomUUID(), caseId = randomUUID(), opportunityId = randomUUID(), partyId = randomUUID(), quoteId = randomUUID(), roomId = randomUUID(), pkg = randomUUID();
    const names: Record<Who, string> = { ops: "Omar Ops", lead: "Lina Lead", junior: "Jad Junior", admin: "Sara Sales Admin", coordinator: "Mona Materials", qs: "Qasim QS",
      factory: "Faris Factory", outsider: "Olga Other" };
    const people = Object.fromEntries(Object.keys(names).map((key) => [key, { user: randomUUID(), member: randomUUID() }])) as Seed["people"];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      for (const [key, name] of Object.entries(names))
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [people[key as Who].user, `${people[key as Who].user.slice(0, 8)}@example.com`, name]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'EUR','Europe/Madrid',$3)", [workspaceId, `fin-${workspaceId.slice(0, 8)}`, people.ops.user]);
      for (const person of Object.values(people)) await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [person.member, workspaceId, person.user]);
      // Who hears it by permission: the QS team prices quotations; the production lead approves factory work.
      for (const [code, who, permission] of [["qs_team", people.qs, "commercial.estimate"], ["production_lead", people.factory, "factory.approve"]] as const) {
        const role = randomUUID();
        await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,$3,$3,false)", [role, workspaceId, code]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, who.member, role]);
        await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = $3", [workspaceId, role, permission]);
      }
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [partyId, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, partyId, randomUUID(), randomUUID(), people.ops.member]);
      if (options.design !== false) {
        await client.query(`INSERT INTO design_packages(id,workspace_id,code,name,pricing_method,rate,currency,area_unit,includes_space_planning,includes_renders,included_revisions,review_role_code,rate_from,unit_definition)
          VALUES ($1,$2,'bespoke','Bespoke Interior Design','per_area',40,'EUR','sqft',true,true,2,null,false,null)`, [pkg, workspaceId]);
        await client.query("INSERT INTO crm_opportunity_discovery(workspace_id,opportunity_id,design_package_id,area,area_unit) VALUES($1,$2,$3,2000,'sqft')", [workspaceId, opportunityId, pkg]);
        await client.query(`INSERT INTO workspace_design_settings(workspace_id,inspiration_days,site_visit_questions,concept_options_max) VALUES($1,7,'[]',2)`, [workspaceId]);
      }
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, people.ops.user]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Master bathroom')", [roomId, workspaceId, caseId]);
      // The design team on the job (PLM-151): lead, junior and Sales Admin.
      for (const [who, role] of [["lead", "designer"], ["junior", "junior_designer"], ["admin", "sales_admin"], ["coordinator", "material_coordinator"]] as const)
        await client.query("INSERT INTO project_assignments(workspace_id,case_id,membership_id,role_keys) VALUES($1,$2,$3,ARRAY[$4]::varchar[])", [workspaceId, caseId, people[who].member, role]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quotation','EUR')",
        [workspaceId, caseId, quoteId]);
      await seedDefaultNotificationTemplates(client, workspaceId);
      await client.query("COMMIT");
    } finally { client.release(); }
    if (options.design !== false) await asApp(workspaceId, people.ops.user, (client) => startJourney(client, workspaceId, caseId, people.ops.user));
    return { workspaceId, caseId, quoteId, roomId, people };
  }

  /** Services as one person with a set of permissions; anything else is refused like the real access guard. */
  function as(ids: Seed, who: Who, permissions: string[]) {
    const userId = ids.people[who].user;
    const access = {
      withPermission: (_actor: unknown, workspaceId: string, permission: string, work: (client: PoolClient, user: { userId: string; displayName: string }) => Promise<unknown>) =>
        access.withPermissions(_actor, workspaceId, [permission], work),
      withPermissions: async (_actor: unknown, workspaceId: string, required: string[], work: (client: PoolClient, user: { userId: string; displayName: string }) => Promise<unknown>) => {
        if (!required.every((permission) => permissions.includes(permission))) throw new ForbiddenException(`Permissions required: ${required.join(", ")}`);
        return asApp(workspaceId, userId, (client) => work(client, { userId, displayName: who }));
      },
      withAnyPermission: async (_actor: unknown, workspaceId: string, any: string[], work: (client: PoolClient, user: { userId: string; displayName: string }) => Promise<unknown>) => {
        if (!any.some((permission) => permissions.includes(permission))) throw new ForbiddenException(`Any permission required: ${any.join(", ")}`);
        return asApp(workspaceId, userId, (client) => work(client, { userId, displayName: who }));
      },
      hasPermission: async (_client: unknown, _workspaceId: string, _user: string, permission: string) => permissions.includes(permission),
      grantedPermissions: async (_client: unknown, _workspaceId: string, _user: string, asked: string[]) => new Set(asked.filter((permission) => permissions.includes(permission))),
    };
    const stored = new Map<string, Buffer>();
    const storage = { put: async (key: string, body: Buffer) => { stored.set(key, body); }, read: async (key: string) => ({ body: stored.get(key) ?? Buffer.from("") }) };
    return { finishes: new FinishesService(access as never, storage as never), decisions: new DesignDecisionsService(access as never),
      builder: new QuotationBuilderService(access as never, storage as never) };
  }
  const sql = <T extends Record<string, unknown> = Record<string, unknown>>(ids: Seed, text: string, values: unknown[] = []) =>
    asApp(ids.workspaceId, ids.people.ops.user, async (client) => (await client.query<T>(text, values)).rows);
  const told = async (ids: Seed, code: string) => (await sql<{ recipient: string }>(ids,
    `SELECT DISTINCT recipient_id AS recipient FROM notifications WHERE workspace_id = $1 AND event_type::text = $2 AND channel = 'in_app' ORDER BY 1`, [ids.workspaceId, code])).map((row) => row.recipient);
  const asset = async (ids: Seed, name = "photo.png", mime = "image/png") => {
    const id = randomUUID();
    await sql(ids, "INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,sha256,created_by) VALUES($1,$2,$3,$4,$5,1,$6,repeat('a',64),$7)",
      [id, ids.workspaceId, ids.caseId, name, mime, `k-${id}`, ids.people.lead.user]);
    return id;
  };
  const material = (title: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), versionId: randomUUID(), kind: "material", title, source: "showroom",
    saidAt: new Date(Date.now() - 60_000).toISOString(), ...extra });
  /** The design stages before samples done (as if they ran), samples on. */
  const atSamples = (ids: Seed) => sql(ids, `UPDATE design_journey_stages SET status = CASE WHEN stage = 'samples' THEN 'active' WHEN stage = 'approval' THEN 'locked' ELSE 'done' END,
    completed_at = CASE WHEN stage IN ('samples', 'approval') THEN NULL ELSE now() END WHERE workspace_id = $1 AND case_id = $2`, [ids.workspaceId, ids.caseId]);
  const approveSamples = (ids: Seed) => asApp(ids.workspaceId, ids.people.lead.user, (client) => completeStage(client, ids.workspaceId, ids.caseId, "samples", ids.people.lead.user, "3 materials confirmed", "samples_approved"));
  const confirm = async (ids: Seed, entryId: string, versionId: string, decision: "confirmed" | "declined" = "confirmed") =>
    as(ids, "lead", DESIGNER).decisions.recordDecision(actor, ids.workspaceId, ids.caseId, entryId, versionId, { decision, method: "in_person", decidedBy: "Maya Client", note: decision === "declined" ? "Prefers matt" : null });

  it("keeps the material log: the Material Coordinator records materials (not design choices) with where they come from, the sample and its photo", async () => {
    const ids = await seed();
    const coordinator = as(ids, "coordinator", COORDINATOR), lead = as(ids, "lead", DESIGNER), ops = as(ids, "ops", ALL);
    // The sample library: own stock first, tagged with the firm's price bands (amounts in the workspace's currency).
    const settings = await ops.finishes.saveSettings(actor, ids.workspaceId, { version: 0, bands: [{ label: "Entry", maxAmount: "80" }, { label: "Premium", minAmount: "200" }],
      categories: [{ key: "hard_finishes", label: "Hard finishes" }, { key: "sanitary_ware", label: "Sanitary ware", clientSignature: true }], specificationGate: true,
      materialEditorSlots: ["lead_designer", "junior_designer", "sales_admin"] });
    expect(settings.currency).toBe("EUR");
    expect(settings.bands.map((band) => [band.label, band.minAmount, band.maxAmount])).toEqual([["Entry", null, "80.00"], ["Premium", "200.00", null]]);
    const premium = settings.bands[1].id;
    const marble = randomUUID(), brand = randomUUID();
    await coordinator.finishes.saveSample(actor, ids.workspaceId, { id: brand, name: "Calacatta Viola (Brand slab)", origin: "brand", priceBandId: premium, categoryKey: "hard_finishes" });
    await coordinator.finishes.saveSample(actor, ids.workspaceId, { id: marble, name: "Calacatta Gold", code: "MB-01", origin: "own_stock", priceBandId: premium, location: "Showroom rack B" });
    expect((await coordinator.finishes.samples(actor, ids.workspaceId, { q: "calacatta" })).samples.map((sample) => sample.name)).toEqual(["Calacatta Gold", "Calacatta Viola (Brand slab)"]);
    expect((await coordinator.finishes.samples(actor, ids.workspaceId, { band: premium, category: "hard_finishes" })).samples.map((sample) => sample.id)).toEqual([brand]);
    // Two people saving the same sample: the second, on the old version, is refused.
    const saved = await coordinator.finishes.saveSample(actor, ids.workspaceId, { id: marble, version: 1, name: "Calacatta Gold", code: "MB-01", origin: "own_stock", priceBandId: premium, location: "Rack C" });
    await expect(coordinator.finishes.saveSample(actor, ids.workspaceId, { id: marble, version: 1, name: "Calacatta Gold", origin: "own_stock", location: "Rack D" })).rejects.toThrow(/Someone changed this sample/);
    expect(saved.version).toBe(2);
    await expect(lead.finishes.saveSample(actor, ids.workspaceId, { id: randomUUID(), name: "Not mine" })).rejects.toThrow(ForbiddenException);
    // A photo of the sample (a real image), and the library's search for choosing a material puts the own-stock sample first.
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#c0a080" } }).png().toBuffer();
    expect((await coordinator.finishes.samplePhoto(actor, ids.workspaceId, marble, { buffer: png, originalname: "gold.png", mimetype: "image/png", size: png.length }))?.hasPhoto).toBe(true);
    const choices = await lead.decisions.ledgerCatalog(actor, ids.workspaceId, ids.caseId, "calacatta");
    expect(choices.samples.map((sample) => [sample.name, sample.origin, sample.hasPhoto])).toEqual([["Calacatta Gold", "own_stock", true], ["Calacatta Viola (Brand slab)", "brand", false]]);

    // The coordinator adds the material with its sample photo (uploaded to the case) and where it comes from; a design choice isn't theirs.
    const photo = await coordinator.finishes.upload(actor, ids.workspaceId, ids.caseId, randomUUID(), { buffer: png, originalname: "slab.png", mimetype: "image/png", size: png.length });
    const floor = material("Calacatta Gold floor", { origin: "own_stock", sampleId: marble, samplePhotoAssetId: photo.id, supplier: "Own stock", roomId: ids.roomId, categoryKey: "hard_finishes",
      location: "Floor", specification: "Honed, 60x120" });
    let ledger = await coordinator.decisions.addEntry(actor, ids.workspaceId, ids.caseId, floor);
    expect(ledger.entries[0].current).toMatchObject({ origin: "own_stock", outsourced: false, sampleName: "Calacatta Gold", samplePhotoName: "slab.png" });
    await expect(coordinator.decisions.addEntry(actor, ids.workspaceId, ids.caseId, { ...material("Arched doorway"), kind: "design" })).rejects.toThrow(/designers record the design choices/);
    // A local supplier's material is the outsourced one; saying otherwise is refused.
    await expect(coordinator.decisions.addEntry(actor, ids.workspaceId, ids.caseId, material("Basin", { origin: "own_stock", outsourced: true }))).rejects.toThrow(/local supplier/);
    const basin = material("Freestanding basin", { origin: "local_supplier", supplier: "Ceramica LLC", categoryKey: "sanitary_ware", roomId: ids.roomId });
    ledger = await coordinator.decisions.addEntry(actor, ids.workspaceId, ids.caseId, basin);
    expect(ledger.entries.find((entry) => entry.id === basin.id)?.current).toMatchObject({ outsourced: true, origin: "local_supplier", signOff: "pending" });
    // An old version (recorded before origins: only the outsourced flag) reads sensibly.
    const old = material("Old brass tap");
    await lead.decisions.addEntry(actor, ids.workspaceId, ids.caseId, { ...old, outsourced: true });
    expect((await sql(ids, "SELECT origin FROM design_ledger_versions WHERE workspace_id = $1 AND id = $2", [ids.workspaceId, old.versionId]))[0].origin).toBeNull();

    let schedule = await lead.finishes.schedule(actor, ids.workspaceId, ids.caseId);
    const row = (id: string) => schedule.entries.find((entry) => entry.id === id)!;
    expect(row(floor.id)).toMatchObject({ status: "in_process", categoryLabel: "Hard finishes", location: "Floor", roomName: "Master bathroom",
      current: { origin: "own_stock", sampleName: "Calacatta Gold", samplePhotoAssetId: photo.id } });
    expect(row(old.id).current?.origin).toBe("local_supplier");
    expect(row(basin.id).signature).toMatchObject({ required: true, signed: false });
    expect(schedule).toMatchObject({ canEdit: true, canManageMaterials: true, canShare: true, categories: expect.arrayContaining([expect.objectContaining({ key: "sanitary_ware", clientSignature: true })]) });
    expect((await coordinator.finishes.schedule(actor, ids.workspaceId, ids.caseId))).toMatchObject({ canEdit: false, canManageMaterials: true, canSendToQs: false, canShare: false });

    // The client's decisions drive the log: Approved, Not approved.
    await confirm(ids, floor.id, floor.versionId);
    await confirm(ids, old.id, old.versionId, "declined");
    schedule = await lead.finishes.schedule(actor, ids.workspaceId, ids.caseId);
    expect([row(floor.id).status, row(old.id).status]).toEqual(["approved", "not_approved"]);

    // Placement (the installation view) by two people: the second, on the old version, is refused; the same values again change nothing.
    const entryVersion = row(floor.id).version;
    schedule = await coordinator.finishes.details(actor, ids.workspaceId, ids.caseId, floor.id, { entryVersion, location: "Floor and skirting", installNote: "Book-matched" });
    await expect(lead.finishes.details(actor, ids.workspaceId, ids.caseId, floor.id, { entryVersion, location: "Walls" })).rejects.toThrow(/changed in another window/);
    await lead.finishes.details(actor, ids.workspaceId, ids.caseId, floor.id, { entryVersion, location: "Floor and skirting", installNote: "Book-matched" });
    await expect(lead.finishes.details(actor, ids.workspaceId, ids.caseId, floor.id, { entryVersion: row(floor.id).version, categoryKey: "no_such" })).rejects.toThrow(/finish categories/);
    expect(row(floor.id)).toMatchObject({ location: "Floor and skirting", installNote: "Book-matched" });
    // Someone outside the design team reads nothing they can't (no Planning access).
    await expect(as(ids, "outsider", ["projects.view"]).finishes.schedule(actor, ids.workspaceId, ids.caseId)).rejects.toThrow(ForbiddenException);
  });

  it("marks the finishes after the samples, sends them to QS, flags the old price when one changes, and holds the final quotation until the specification is final", async () => {
    const ids = await seed();
    const ops = as(ids, "ops", ALL), lead = as(ids, "lead", DESIGNER), qs = as(ids, "qs", QS), junior = as(ids, "junior", DESIGNER);
    await ops.finishes.saveSettings(actor, ids.workspaceId, { version: 0, specificationGate: true, finishesToQsDays: 2, materialEditorSlots: ["lead_designer", "junior_designer", "sales_admin"] });
    await atSamples(ids);
    const marble = material("Calacatta marble", { categoryKey: "hard_finishes", specification: "Polished, 2 cm" });
    const veneer = material("Smoked oak veneer", { categoryKey: "hard_finishes" });
    for (const entry of [marble, veneer]) { await lead.decisions.addEntry(actor, ids.workspaceId, ids.caseId, entry); await confirm(ids, entry.id, entry.versionId); }
    // Before the samples are approved, nothing goes to QS, and the final quotation waits.
    await expect(lead.finishes.sendToQs(actor, ids.workspaceId, ids.caseId, {})).rejects.toThrow(/Approve the samples first/);
    expect(await asApp(ids.workspaceId, ids.people.ops.user, (client) => specificationGateProblem(client, ids.workspaceId, ids.caseId, ids.quoteId))).toMatch(/samples aren't approved/);

    // Samples approved: the step "Mark the finishes and send them to QS" opens for the lead designer, with its due date, and the reminder engine chases it.
    await approveSamples(ids);
    const task = (await sql<{ owner: string; due: Date; status: string }>(ids, `SELECT owner_membership_id AS owner, due_at AS due, status FROM design_journey_tasks WHERE workspace_id = $1 AND case_id = $2 AND task = 'finishes_to_qs'`,
      [ids.workspaceId, ids.caseId]))[0];
    expect(task).toMatchObject({ owner: ids.people.lead.member, status: "open" });
    // Working days (the close of the 2nd working day after today), so 2 to 5 calendar days depending on the weekend.
    const days = (new Date(task.due).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(1);
    expect(days).toBeLessThan(6);
    expect(await told(ids, "finishes.to_mark")).toEqual([ids.people.lead.user]);
    const due = await asApp(ids.workspaceId, ids.people.ops.user, (client) => designStageSource.open(client, ids.workspaceId, { now: new Date(Date.now() + 7 * 86_400_000), limit: 50 } as never));
    expect(due.find((item) => item.key === `design_task:${ids.caseId}:finishes_to_qs`)).toMatchObject({ ownerMembershipId: ids.people.lead.member, title: "Finishes to QS" });

    // The designer marks the marble on a render snapshot; the same marker again is a replay.
    const crop = await asset(ids, "kitchen-render-crop.png");
    const snapshot = { id: randomUUID(), assetId: crop, markerX: 41.5, markerY: 62.25, label: "Calacatta, polished" };
    await lead.finishes.addSnapshot(actor, ids.workspaceId, ids.caseId, marble.id, snapshot);
    let schedule = await lead.finishes.addSnapshot(actor, ids.workspaceId, ids.caseId, marble.id, snapshot);
    expect(schedule.entries.find((entry) => entry.id === marble.id)?.snapshots).toEqual([expect.objectContaining({ markerX: 41.5, markerY: 62.25, label: "Calacatta, polished" })]);
    await expect(lead.finishes.addSnapshot(actor, ids.workspaceId, ids.caseId, marble.id, { ...snapshot, id: randomUUID(), assetId: await asset(ids, "spec.pdf", "application/pdf") }))
      .rejects.toThrow(/render snapshot \(an image\)/);

    // Send to QS: the hand-off, the step done, the QS told. Sending again (nothing changed) is the same hand-off.
    schedule = await lead.finishes.sendToQs(actor, ids.workspaceId, ids.caseId, { note: "Marble from the sample meeting" });
    expect(schedule.specification).toMatchObject({ final: true, handoff: { number: 1, finishes: 2 } });
    expect((await lead.finishes.sendToQs(actor, ids.workspaceId, ids.caseId, {})).sent).toEqual({ number: 1, replayed: true });
    expect(await told(ids, "finishes.sent_to_qs")).toEqual([ids.people.qs.user]);
    expect((await sql(ids, `SELECT status FROM design_journey_tasks WHERE workspace_id = $1 AND case_id = $2 AND task = 'finishes_to_qs'`, [ids.workspaceId, ids.caseId]))[0].status).toBe("done");
    expect(await asApp(ids.workspaceId, ids.people.ops.user, (client) => specificationGateProblem(client, ids.workspaceId, ids.caseId, ids.quoteId))).toBeNull();

    // The quotation: lines priced from the finishes. The material column is the designers': the QS links lines to finishes but doesn't type it.
    await lead.builder.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [
      { op: "upsert", line: { id: "kitchen-floor", title: "Kitchen floor", unit: "m²", quantity: "30", rate: "0" } },
      { op: "upsert", line: { id: "cabinets", title: "Cabinets", unit: "m", quantity: "6", rate: "0", material: "Smoked oak" } },
    ] });
    let state = await qs.builder.builder(actor, ids.workspaceId, ids.caseId, ids.quoteId);
    expect(state.canEditMaterial).toBe(false);
    expect(state.finishes.entries.map((entry) => [entry.title, entry.sent, entry.snapshots])).toEqual([["Calacatta marble", true, 1], ["Smoked oak veneer", true, 0]]);
    const line = state.lines.find((item) => item.id === "kitchen-floor")!;
    // Even someone who edits quotations (not on the design team) can't change it.
    await expect(as(ids, "qs", [...QS, "pre_projects.edit"]).builder.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId,
      { ops: [{ op: "upsert", line: { id: "kitchen-floor", version: line.version, material: "Porcelain" } }] })).rejects.toThrow(/designer's/);
    state = await as(ids, "qs", [...QS, "pre_projects.edit"]).builder.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [{ op: "finish", lineId: "kitchen-floor", entryId: marble.id, version: line.version }] });
    expect(state.lines.find((item) => item.id === "kitchen-floor")?.material).toBe("Calacatta marble · Polished, 2 cm");
    expect(state.finishes.links).toEqual([{ lineId: "kitchen-floor", entryId: marble.id, stale: false, removed: false }]);
    // The junior designer may edit the column.
    const cabinets = state.lines.find((item) => item.id === "cabinets")!;
    state = await junior.builder.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [{ op: "upsert", line: { id: "cabinets", version: cabinets.version, material: "Smoked oak veneer" } }] });
    expect(state.lines.find((item) => item.id === "cabinets")?.material).toBe("Smoked oak veneer");

    // A finish changed after QS priced it: the QS hears it, the old price is flagged, the specification isn't final until it is sent again.
    await lead.decisions.addVersion(actor, ids.workspaceId, ids.caseId, marble.id, { versionId: randomUUID(), entryVersion: (await lead.decisions.ledger(actor, ids.workspaceId, ids.caseId)).entries
      .find((entry) => entry.id === marble.id)!.version, title: "Calacatta marble", specification: "Honed, 2 cm", source: "meeting", saidAt: new Date(Date.now() - 1000).toISOString() });
    expect(await told(ids, "finishes.changed")).toEqual([ids.people.qs.user]);
    state = await qs.builder.builder(actor, ids.workspaceId, ids.caseId, ids.quoteId);
    expect(state.finishes.links).toEqual([{ lineId: "kitchen-floor", entryId: marble.id, stale: true, removed: false }]);
    expect(state.specification).toMatchObject({ applies: true, final: false, problem: expect.stringMatching(/Calacatta marble changed after the finishes went to QS/) });
    await expect(asApp(ids.workspaceId, ids.people.ops.user, (client) => beforeQuoteIssued(client, { workspaceId: ids.workspaceId, caseId: ids.caseId, quoteId: ids.quoteId, familyId: null,
      kind: "quotation", actorUserId: ids.people.ops.user }))).rejects.toThrow(/changed after the finishes went to QS/);
    // A budget range the client asked for may go before it; the client can't accept it as the final quotation.
    await expect(lead.finishes.budgetRange(actor, ids.workspaceId, ids.caseId, ids.quoteId, { budgetRange: true, note: "" })).rejects.toThrow(/how the client asked/);
    await lead.finishes.budgetRange(actor, ids.workspaceId, ids.caseId, ids.quoteId, { budgetRange: true, note: "Maya asked for a range by email, 12 Oct" });
    expect(await asApp(ids.workspaceId, ids.people.ops.user, (client) => specificationGateProblem(client, ids.workspaceId, ids.caseId, ids.quoteId))).toBeNull();
    await lead.finishes.budgetRange(actor, ids.workspaceId, ids.caseId, ids.quoteId, { budgetRange: false });
    // Sent again: final; the QS re-links the line to the new version and the flag goes.
    await lead.finishes.sendToQs(actor, ids.workspaceId, ids.caseId, {});
    state = await as(ids, "qs", [...QS, "pre_projects.edit"]).builder.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId,
      { ops: [{ op: "finish", lineId: "kitchen-floor", entryId: marble.id }] });
    expect(state.finishes.links[0]).toMatchObject({ stale: false });
    expect(state.lines.find((item) => item.id === "kitchen-floor")?.material).toBe("Calacatta marble · Honed, 2 cm");
    expect(state.specification).toMatchObject({ final: true, problem: null });
    // A finish removed after it went to QS: told, and the line priced from it is flagged.
    const entry = (await lead.decisions.ledger(actor, ids.workspaceId, ids.caseId)).entries.find((item) => item.id === marble.id)!;
    await lead.decisions.archive(actor, ids.workspaceId, ids.caseId, marble.id, { entryVersion: entry.version });
    expect((await qs.builder.builder(actor, ids.workspaceId, ids.caseId, ids.quoteId)).finishes.links[0]).toMatchObject({ stale: true, removed: true });
  });

  it("shares the sample log with the factory: the factory lead hears it and reads it from the Factory; only the lead designer shares", async () => {
    const ids = await seed();
    const lead = as(ids, "lead", DESIGNER), junior = as(ids, "junior", DESIGNER), factory = as(ids, "factory", ["factory.view", "factory.approve"]);
    const tile = material("Zellige tile", { categoryKey: "hard_finishes", samplePhotoAssetId: await asset(ids, "zellige.png") });
    await lead.decisions.addEntry(actor, ids.workspaceId, ids.caseId, tile);
    await expect(factory.finishes.factorySchedule(actor, ids.workspaceId, ids.caseId)).rejects.toThrow(/wasn't shared/);
    await expect(junior.finishes.share(actor, ids.workspaceId, ids.caseId, {})).rejects.toThrow(/lead designer shares/);
    await lead.finishes.share(actor, ids.workspaceId, ids.caseId, { note: "For the vanity unit" });
    expect(await told(ids, "finishes.factory_shared")).toEqual([ids.people.factory.user]);
    expect((await factory.finishes.factoryList(actor, ids.workspaceId)).shares).toEqual([expect.objectContaining({ caseId: ids.caseId, clientName: "Maya Client", note: "For the vanity unit" })]);
    const read = await factory.finishes.factorySchedule(actor, ids.workspaceId, ids.caseId);
    expect(read).toMatchObject({ canEdit: false, canShare: false, entries: [expect.objectContaining({ title: "Zellige tile" })] });
    // The factory opens the sample's photo through the schedule (and nothing else of the case).
    await expect(factory.finishes.asset(actor, ids.workspaceId, { caseId: ids.caseId }, await asset(ids, "private.pdf", "application/pdf"), false)).rejects.toThrow(/File not found/);
  });

  it("keeps the schedule as a plain list on a job without design: no samples step, and the final quotation isn't held", async () => {
    const ids = await seed({ design: false });
    const lead = as(ids, "lead", DESIGNER), ops = as(ids, "ops", ALL);
    await ops.finishes.saveSettings(actor, ids.workspaceId, { version: 0, specificationGate: true });
    const sofa = material("Boucle sofa fabric", { categoryKey: "soft_finishes" });
    await lead.decisions.addEntry(actor, ids.workspaceId, ids.caseId, sofa);
    const schedule = await lead.finishes.schedule(actor, ids.workspaceId, ids.caseId);
    expect(schedule.specification).toMatchObject({ gate: false, samplesStep: false });
    expect(schedule.entries.map((entry) => [entry.title, entry.categoryLabel])).toEqual([["Boucle sofa fabric", "Soft finishes"]]);
    expect(await asApp(ids.workspaceId, ids.people.ops.user, (client) => specificationGateProblem(client, ids.workspaceId, ids.caseId, ids.quoteId))).toBeNull();
    // Sending to QS needs no samples step here.
    expect((await lead.finishes.sendToQs(actor, ids.workspaceId, ids.caseId, {})).specification.handoff?.number).toBe(1);
  });
});
