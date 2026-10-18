import { ConflictException, ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import type { PortalContact } from "../client-portal/portal-auth";
import { ledgerDecision, presentationChoice, readDesignChoices } from "../client-portal/portal-design-decisions";
import { designComment, designReply, designResolve, readDesignReview } from "../client-portal/portal-design";
import { ASSUME_PRESENT } from "../client-portal/portal-files";
import { readPortalSettings } from "../client-portal/portal-settings";
import { captureApprovedDesignBaseline } from "../projects/project-design-control";
import { DesignDecisionsService } from "./design-decisions.service";
import { DesignJourneyService } from "./design-journey.service";
import { startJourney } from "./design-journey.store";
import { decideChange, readChanges } from "../change-requests/change-request.store";
import { ledgerProcurementProblem, readLedger } from "./design-ledger.store";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Every service call runs as the app
// role (wodana_app, forced RLS) in its own committed transaction, so replays, stale versions and tenants are real.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Seed = { workspaceId: string; caseId: string; projectId: string; opsUser: string; amUser: string; adminUser: string; designerUser: string; grantId: string; viewerGrantId: string };

integration("design decisions: presentations and the materials ledger (plan §6.7a, PLM-049/054, E5-1/E5-2)", { timeout: 60_000 }, () => {
  let pool: Pool;
  const workspaces: string[] = [];
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

  async function seed(): Promise<Seed> {
    const ids = { workspaceId: randomUUID(), caseId: randomUUID(), projectId: randomUUID(), opsUser: randomUUID(), amUser: randomUUID(), adminUser: randomUUID(), designerUser: randomUUID(),
      grantId: randomUUID(), viewerGrantId: randomUUID() };
    const am = randomUUID(), admin = randomUUID(), designer = randomUUID(), ops = randomUUID(), partyId = randomUUID(), opportunityId = randomUUID(), packageId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      for (const [id, name] of [[ids.opsUser, "Omar Ops"], [ids.amUser, "Aisha AM"], [ids.adminUser, "Sara Sales Admin"], [ids.designerUser, "Dana Designer"]])
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${id.slice(0, 8)}@example.com`, name]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [ids.workspaceId, `dd-${ids.workspaceId.slice(0, 8)}`, ids.opsUser]);
      for (const [id, user] of [[ops, ids.opsUser], [am, ids.amUser], [admin, ids.adminUser], [designer, ids.designerUser]])
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [id, ids.workspaceId, user]);
      await client.query("INSERT INTO workspace_sales_settings(workspace_id,sales_admin_membership_id) VALUES($1,$2)", [ids.workspaceId, admin]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [partyId, ids.workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, ids.workspaceId, partyId, randomUUID(), randomUUID(), am]);
      await client.query("INSERT INTO crm_opportunity_designer(workspace_id,opportunity_id,membership_id) VALUES($1,$2,$3)", [ids.workspaceId, opportunityId, designer]);
      await client.query("INSERT INTO design_packages(id,workspace_id,code,name,pricing_method,rate,currency,area_unit,includes_space_planning,includes_renders,included_revisions) VALUES($1,$2,'concept','Concept','per_space',10000,'AED',null,false,false,2)", [packageId, ids.workspaceId]);
      await client.query("INSERT INTO crm_opportunity_discovery(workspace_id,opportunity_id,design_package_id) VALUES($1,$2,$3)", [ids.workspaceId, opportunityId, packageId]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [ids.caseId, ids.workspaceId, opportunityId, ids.opsUser]);
      await client.query("INSERT INTO client_portal_grants(id,workspace_id,case_id,name,phone,role) VALUES($1,$2,$3,'Maya Client','+971500000001','approver'),($4,$2,$3,'Omar Client','+971500000002','viewer')",
        [ids.grantId, ids.workspaceId, ids.caseId, ids.viewerGrantId]);
      await client.query("INSERT INTO delivery_projects(id,workspace_id,case_id,name,reference,quote_id,started_at,created_by) VALUES($1,$2,$3,'Villa fit-out','P-7',$5,now(),$4)", [ids.projectId, ids.workspaceId, ids.caseId, ids.opsUser, randomUUID()]);
      // E5-1 on E3: the designer holds the design reviewer's permission, so they approve changes after sign-off.
      const reviewerRole = randomUUID();
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,'design_reviewer','Design reviewer',false)", [reviewerRole, ids.workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = 'pre_projects.review_designs'", [ids.workspaceId, reviewerRole]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [ids.workspaceId, designer, reviewerRole]);
      await seedDefaultNotificationTemplates(client, ids.workspaceId);
      await client.query("COMMIT");
    } finally { client.release(); }
    workspaces.push(ids.workspaceId);
    await asApp(ids.workspaceId, ids.opsUser, (client) => startJourney(client, ids.workspaceId, ids.caseId, ids.opsUser, { flow: 2 }));
    return ids;
  }

  /** Staff services as one user with a set of permissions; anything else is refused like the real access guard. */
  function services(seedIds: Seed, permissions: string[], userId = seedIds.opsUser) {
    const access = {
      withPermission: (actor: unknown, workspaceId: string, permission: string, work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) => access.withPermissions(actor, workspaceId, [permission], work),
      withPermissions: async (_actor: unknown, workspaceId: string, required: string[], work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) => {
        if (!required.every((permission) => permissions.includes(permission))) throw new ForbiddenException(`Permissions required: ${required.join(", ")}`);
        return asApp(workspaceId, userId, (client) => work(client, { userId }));
      },
      withAnyPermission: async (_actor: unknown, workspaceId: string, any: string[], work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) => {
        if (!any.some((permission) => permissions.includes(permission))) throw new ForbiddenException(`Any permission required: ${any.join(", ")}`);
        return asApp(workspaceId, userId, (client) => work(client, { userId }));
      },
      hasPermission: async (_client: unknown, _workspaceId: string, _user: string, permission: string) => permissions.includes(permission),
    };
    return { decisions: new DesignDecisionsService(access as never), journey: new DesignJourneyService(access as never) };
  }
  const ALL = ["pre_projects.view", "pre_projects.edit", "pre_projects.review_designs", "pre_projects.record_client_design_decisions", "pre_projects.manage_lifecycle"];
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  /** The client's portal path: their contact and grants, the portal settings, inside the tenant transaction. */
  function portal(seedIds: Seed, grantId = seedIds.grantId) {
    const role = grantId === seedIds.grantId ? "approver" as const : "viewer" as const;
    const contact: PortalContact = { sessionId: randomUUID(), phone: "+971500000001", name: "Maya Client", nameConfirmed: true,
      grants: [{ id: grantId, caseId: seedIds.caseId, name: role === "approver" ? "Maya Client" : "Omar Client", role, email: null, confirmed: true, demo: false }] };
    return <T>(work: (ctx: never) => Promise<T>) => asApp(seedIds.workspaceId, "00000000-0000-4000-8000-000000000000", async (client) =>
      work({ db: client, workspaceId: seedIds.workspaceId, contact, settings: await readPortalSettings(client, seedIds.workspaceId), today: "2026-10-06" } as never));
  }

  const entry = (overrides: Record<string, unknown> = {}) => ({ id: randomUUID(), versionId: randomUUID(), kind: "material", title: "Oak veneer", specification: "Natural, matt",
    quantity: "12.5", unit: "sqm", unitPrice: "80", source: "showroom", saidAt: new Date(Date.now() - 60_000).toISOString(), ...overrides });

  it("allows, denies, replays and version-checks ledger commands, and keeps tenants apart", async () => {
    const ids = await seed();
    const { decisions } = services(ids, ALL);
    const viewer = services(ids, ["pre_projects.view"]).decisions;
    const oak = entry();
    await expect(viewer.addEntry(actor, ids.workspaceId, ids.caseId, oak)).rejects.toBeInstanceOf(ForbiddenException);
    const added = await decisions.addEntry(actor, ids.workspaceId, ids.caseId, oak);
    expect(added.entries).toHaveLength(1);
    expect(added.entries[0].current).toMatchObject({ number: 1, status: "proposed", priceImpact: "1000.00", currency: "AED", source: "showroom", recordedByName: "Omar Ops" });
    // Replay: the same command again changes nothing; the same id with other content is refused.
    expect((await decisions.addEntry(actor, ids.workspaceId, ids.caseId, oak)).entries).toHaveLength(1);
    await expect(decisions.addEntry(actor, ids.workspaceId, ids.caseId, { ...oak, title: "Walnut" })).rejects.toBeInstanceOf(ConflictException);
    // A change is a new version against the entry's version; a stale one is refused.
    const entryVersion = added.entries[0].version;
    const changed = await decisions.addVersion(actor, ids.workspaceId, ids.caseId, oak.id, { ...entry(), versionId: randomUUID(), unitPrice: "95.50", entryVersion, source: "email" });
    expect(changed.entries[0].versions.map((version) => [version.number, version.status, version.priceImpact])).toEqual([[2, "proposed", "193.75"], [1, "superseded", "1000.00"]]);
    await expect(decisions.addVersion(actor, ids.workspaceId, ids.caseId, oak.id, { ...entry(), versionId: randomUUID(), entryVersion })).rejects.toThrow(/another window/);
    // History is immutable in the database too.
    await expect(asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`UPDATE design_ledger_versions SET title = 'Pine' WHERE workspace_id = $1 AND entry_id = $2`, [ids.workspaceId, oak.id]))).rejects.toThrow(/never edited/);
    // Another tenant sees nothing and can't write to it.
    const other = await seed();
    const outsider = services(other, ALL).decisions;
    expect((await asApp(other.workspaceId, other.opsUser, (client) => readLedger(client, other.workspaceId, ids.caseId))).entries).toEqual([]);
    await expect(outsider.addVersion(actor, other.workspaceId, ids.caseId, oak.id, { ...entry(), versionId: randomUUID(), entryVersion: changed.entries[0].version })).rejects.toThrow();
    expect((await asApp(other.workspaceId, other.opsUser, (client) => client.query(`SELECT count(*)::int AS n FROM design_ledger_versions WHERE entry_id = $1`, [oak.id]))).rows[0].n).toBe(0);
  });

  it("ties a choice to this workspace's catalog item and refuses another tenant's", async () => {
    const ids = await seed();
    const other = await seed();
    const { decisions } = services(ids, ALL);
    const catalogItem = async (workspaceId: string) => {
      const catalog = randomUUID(), item = randomUUID();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("INSERT INTO catalogs(id,workspace_id,code,name) VALUES($1,$2,'core','Core')", [catalog, workspaceId]);
        await client.query("INSERT INTO catalog_items(id,workspace_id,catalog_id,code,name,item_type,unit_code,description) VALUES($1,$2,$3,'SOFA','Sofa','product','nos','Three-seat')", [item, workspaceId, catalog]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { client.release(); }
      return item;
    };
    const own = await catalogItem(ids.workspaceId);
    const foreign = await catalogItem(other.workspaceId);
    // The picker finds only this workspace's items.
    expect((await decisions.ledgerCatalog(actor, ids.workspaceId, ids.caseId, "sofa")).items.map((item) => item.id)).toEqual([own]);
    const sofa = entry({ title: "Sofa", catalogItemId: own });
    expect((await decisions.addEntry(actor, ids.workspaceId, ids.caseId, sofa)).entries[0].current).toMatchObject({ catalogItemId: own });
    // A replay that points at another item is a different command.
    await expect(decisions.addEntry(actor, ids.workspaceId, ids.caseId, { ...sofa, catalogItemId: null })).rejects.toBeInstanceOf(ConflictException);
    const stolen = entry({ title: "Sofa", catalogItemId: foreign });
    await expect(decisions.addEntry(actor, ids.workspaceId, ids.caseId, stolen)).rejects.toThrow(/Choose an item from the catalog/);
    const ledger = await decisions.ledger(actor, ids.workspaceId, ids.caseId);
    await expect(decisions.addVersion(actor, ids.workspaceId, ids.caseId, sofa.id, { ...entry({ catalogItemId: foreign }), versionId: randomUUID(), entryVersion: ledger.entries[0].version }))
      .rejects.toThrow(/Choose an item from the catalog/);
    expect((await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`SELECT count(*)::int AS n FROM design_ledger_versions WHERE catalog_item_id = $1`, [foreign]))).rows[0].n).toBe(0);
  });

  it("takes the client's confirmation through the portal, locks at sign-off, blocks procurement until then, and routes a later change (E5-1/E5-2)", async () => {
    const ids = await seed();
    const { decisions } = services(ids, ALL);
    const oak = entry();
    const tile = entry({ title: "Terrazzo tile", unitPrice: "120", quantity: "30", source: "meeting" });
    await decisions.addEntry(actor, ids.workspaceId, ids.caseId, oak);
    let ledger = await decisions.addEntry(actor, ids.workspaceId, ids.caseId, tile);
    // PLM-054: the project can't order while the list isn't locked.
    expect(await asApp(ids.workspaceId, ids.opsUser, (client) => ledgerProcurementProblem(client, ids.workspaceId, ids.projectId))).toMatch(/hasn't signed off P-7's material list/);

    // The client confirms in the portal; a viewer can't; an old version is refused; a replay is harmless.
    const run = portal(ids);
    const oakVersion = ledger.entries.find((item) => item.id === oak.id)!.current!.id;
    const choices = await run((ctx) => readDesignChoices((ctx as { db: PoolClient }).db, ids.workspaceId, (ctx as { contact: PortalContact }).contact.grants[0], ids.caseId, true));
    expect(choices.choices.map((choice) => [choice.title, choice.canDecide])).toEqual([["Oak veneer", true], ["Terrazzo tile", true]]);
    await expect(portal(ids, ids.viewerGrantId)((ctx) => ledgerDecision(ctx, { caseId: ids.caseId, entryId: oak.id, versionId: oakVersion, decision: "confirm" }))).rejects.toBeInstanceOf(ForbiddenException);
    const confirmed = await run((ctx) => ledgerDecision(ctx, { caseId: ids.caseId, entryId: oak.id, versionId: oakVersion, decision: "confirm" }));
    expect(confirmed).toMatchObject({ ok: true });
    expect((await run((ctx) => ledgerDecision(ctx, { caseId: ids.caseId, entryId: oak.id, versionId: oakVersion, decision: "confirm" }))).audit).toMatchObject({ replayed: true });
    ledger = await decisions.ledger(actor, ids.workspaceId, ids.caseId);
    expect(ledger.entries.find((item) => item.id === oak.id)!.current).toMatchObject({ status: "confirmed", confirmationMethod: "portal", confirmedByName: "Maya Client" });
    const told = (await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`SELECT recipient_id FROM notifications WHERE workspace_id = $1 AND event_type = 'design.ledger_confirmed' AND channel = 'in_app'`, [ids.workspaceId]))).rows;
    expect(told.map((row) => row.recipient_id).sort()).toEqual([ids.amUser, ids.designerUser].sort());

    // The lock waits for every confirmation (staff record one given in a meeting, with who and how).
    await expect(services(ids, ALL).decisions.approveChanges(actor, ids.workspaceId, ids.caseId, { lockNumber: 0 })).rejects.toThrow(/Lock the list at the design sign-off first/);
    const tileVersion = ledger.entries.find((item) => item.id === tile.id)!.current!.id;
    await expect(services(ids, ["pre_projects.view", "pre_projects.edit"]).decisions.recordDecision(actor, ids.workspaceId, ids.caseId, tile.id, tileVersion, { decision: "confirmed", method: "in_person", decidedBy: "Maya Client" }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await decisions.recordDecision(actor, ids.workspaceId, ids.caseId, tile.id, tileVersion, { decision: "confirmed", method: "in_person", decidedBy: "Maya Client", note: "Showroom, 6 Oct" });

    // Design sign-off locks the list; procurement is released.
    const { journey } = services(ids, ALL);
    await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`UPDATE design_journey_stages SET status = CASE WHEN stage = 'approval' THEN 'active' ELSE 'done' END, completed_at = CASE WHEN stage = 'approval' THEN NULL ELSE now() END WHERE workspace_id = $1 AND case_id = $2`, [ids.workspaceId, ids.caseId]));
    const asset = randomUUID();
    await asApp(ids.workspaceId, ids.opsUser, (client) => client.query("INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,sha256,created_by) VALUES($1,$2,$3,'signed.pdf','application/pdf',1,$5,repeat('a',64),$4)",
      [asset, ids.workspaceId, ids.caseId, ids.opsUser, `design-decisions/${asset}`]));
    const approvalVersion = (await journey.get(actor, ids.workspaceId, ids.caseId)).stages.find((stage) => stage.stage === "approval")!.version as number;
    const signed = await journey.signOff(actor, ids.workspaceId, ids.caseId, { version: approvalVersion, approvedOn: "2026-10-05", assetId: asset, signer: "Maya Client", method: "signed_document" });
    expect(signed.ledger).toMatchObject({ state: "locked", lock: { number: 1, reason: "design_sign_off" } });
    expect(signed.handoff).toMatchObject({ quoteId: null });
    expect(await asApp(ids.workspaceId, ids.opsUser, (client) => ledgerProcurementProblem(client, ids.workspaceId, ids.projectId))).toBeNull();
    const salesTold = (await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`SELECT recipient_id FROM notifications WHERE workspace_id = $1 AND event_type = 'design.signed_off' AND channel = 'in_app'`, [ids.workspaceId]))).rows;
    expect(salesTold.map((row) => row.recipient_id).sort()).toEqual([ids.amUser, ids.adminUser].sort());

    // E5-1: a change after the lock is a new version with its impact; Sales hear it; procurement keeps the locked version.
    ledger = await decisions.ledger(actor, ids.workspaceId, ids.caseId);
    const oakNow = ledger.entries.find((item) => item.id === oak.id)!;
    ledger = await decisions.addVersion(actor, ids.workspaceId, ids.caseId, oak.id, { ...entry(), versionId: randomUUID(), title: "Smoked oak veneer", unitPrice: "100", timeImpactDays: 4, entryVersion: oakNow.version, source: "email" });
    const pending = ledger.entries.find((item) => item.id === oak.id)!;
    expect(ledger.state).toBe("changes_pending");
    expect(pending.locked).toMatchObject({ number: 1 });
    expect(pending.current).toMatchObject({ number: 2, afterLock: true, priceImpact: "250.00", timeImpactDays: 4 });
    expect(await asApp(ids.workspaceId, ids.opsUser, (client) => ledgerProcurementProblem(client, ids.workspaceId, ids.projectId))).toBeNull();
    const changeNotices = (await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`SELECT recipient_id, channel, body FROM notifications WHERE workspace_id = $1 AND event_type = 'design.ledger_changed' ORDER BY channel, recipient_id`, [ids.workspaceId]))).rows;
    expect(changeNotices.filter((row) => row.channel === "in_app").map((row) => row.recipient_id).sort()).toEqual([ids.amUser, ids.adminUser].sort());
    expect(changeNotices.find((row) => row.channel === "in_app")!.body).toContain("+250.00 AED · +4 days");
    // Approval needs the client's confirmation of the change first, then re-locks.
    await expect(decisions.approveChanges(actor, ids.workspaceId, ids.caseId, { lockNumber: 1 })).rejects.toThrow(/Waiting for the client's confirmation: Smoked oak veneer/);
    await run((ctx) => ledgerDecision(ctx, { caseId: ids.caseId, entryId: oak.id, versionId: pending.current!.id, decision: "confirm" }));
    await expect(decisions.approveChanges(actor, ids.workspaceId, ids.caseId, { lockNumber: 0 })).rejects.toThrow(/another window/);
    // The change opened an E3 request (kind ledger_change) for whoever recorded it; they can't approve their own.
    const waiting = await decisions.ledger(actor, ids.workspaceId, ids.caseId);
    expect(waiting.approval).toMatchObject({ kind: "ledger_change", status: "pending", amount: "250", currency: "AED", requestedBy: { userId: ids.opsUser } });
    await expect(decisions.approveChanges(actor, ids.workspaceId, ids.caseId, { lockNumber: 1 })).rejects.toThrow(/your own/);
    const reviewer = services(ids, ["pre_projects.view"], ids.designerUser).decisions;
    const relocked = await reviewer.approveChanges(actor, ids.workspaceId, ids.caseId, { lockNumber: 1, approvalVersion: waiting.approval!.version });
    expect(relocked).toMatchObject({ state: "locked", lock: { number: 2, reason: "change_approved" }, approval: { status: "approved" } });
  });

  it("presents concept options as files or links, takes the client's choice in the portal and flags the chargeable revision", async () => {
    const ids = await seed();
    const { decisions, journey } = services(ids, ALL);
    await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`UPDATE design_journey_stages SET status = CASE WHEN stage IN ('inspiration', 'kickoff', 'site_visit') THEN 'done' WHEN stage = 'concepts' THEN 'active' ELSE status END, completed_at = CASE WHEN stage IN ('inspiration', 'kickoff', 'site_visit') THEN now() END WHERE workspace_id = $1 AND case_id = $2`, [ids.workspaceId, ids.caseId]));
    const presentation = { id: randomUUID(), stage: "concepts", options: [{ id: randomUUID(), title: "Warm minimal", linkUrl: "https://www.canva.com/design/warm" }, { id: randomUUID(), title: "Coastal", linkUrl: "https://www.canva.com/design/coastal" }] };
    await expect(decisions.createPresentation(actor, ids.workspaceId, ids.caseId, { ...presentation, options: [{ id: randomUUID(), title: "Bad", linkUrl: "http://example.com" }] })).rejects.toThrow(/https/);
    let view = await decisions.createPresentation(actor, ids.workspaceId, ids.caseId, presentation);
    view = await decisions.createPresentation(actor, ids.workspaceId, ids.caseId, presentation);
    expect(view.presentations).toHaveLength(1);
    // Nothing reaches the client before it is presented.
    const run = portal(ids);
    expect((await run((ctx) => readDesignChoices((ctx as { db: PoolClient }).db, ids.workspaceId, (ctx as { contact: PortalContact }).contact.grants[0], ids.caseId, true))).presentations).toEqual([]);
    view = await decisions.present(actor, ids.workspaceId, ids.caseId, presentation.id, { version: 1 });
    await expect(decisions.present(actor, ids.workspaceId, ids.caseId, presentation.id, { version: 1 })).rejects.toThrow(/another window/);
    const round = view.presentations[0];
    expect(round).toMatchObject({ round: 1, status: "presented", chargeable: false });
    // The client asks for changes, then picks one on the revision.
    await run((ctx) => presentationChoice(ctx, { caseId: ids.caseId, presentationId: round.id, version: round.version, decision: "changes", note: "Lighter floors" }));
    // The design team hears the client asked for changes (never "chose changes"), with what to change.
    const answered = (await asApp(ids.workspaceId, ids.opsUser, (client) => client.query<{ eventType: string; subject: string; body: string }>(
      `SELECT event_type AS "eventType", subject, body FROM notifications WHERE workspace_id = $1 AND event_type::text IN ('design.concept_chosen', 'design.client_changes') AND channel = 'in_app'`,
      [ids.workspaceId]))).rows;
    expect(answered.length).toBeGreaterThan(0);
    expect(answered.every((row) => row.eventType === "design.client_changes" && row.subject.endsWith("wants changes to Concepts") && row.body === "Lighter floors")).toBe(true);
    for (let number = 2; number <= 4; number += 1) {
      const next = { id: randomUUID(), stage: "concepts", options: [{ id: randomUUID(), title: `Warm minimal ${number}`, linkUrl: "https://www.canva.com/design/warm2" }] };
      if (number === 4) {
        // PLM-049/051: the third ask went beyond the 2 free revisions: a draft change waits to be priced and agreed first.
        await expect(decisions.createPresentation(actor, ids.workspaceId, ids.caseId, next)).rejects.toThrow("Waiting for the extra revision to be agreed");
        const draft = (await asApp(ids.workspaceId, ids.opsUser, (client) => readChanges(client, ids.workspaceId, ids.caseId)))[0];
        expect(draft).toMatchObject({ title: "Extra revision: Concepts", status: "draft", priceImpact: "0.00" });
        await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`UPDATE change_requests SET status = 'with_client' WHERE workspace_id = $1 AND id = $2`, [ids.workspaceId, draft.id]));
        await asApp(ids.workspaceId, ids.opsUser, (client) => decideChange(client, ids.workspaceId, ids.caseId, draft.id, { decision: "approve", method: "portal", name: "Maya Client", grantId: ids.grantId }));
      }
      await decisions.createPresentation(actor, ids.workspaceId, ids.caseId, next);
      view = await decisions.present(actor, ids.workspaceId, ids.caseId, next.id, { version: 1 });
      const shown = view.presentations.find((item) => item.id === next.id)!;
      expect(shown.chargeable).toBe(number === 4);
      if (number < 4) await run((ctx) => presentationChoice(ctx, { caseId: ids.caseId, presentationId: shown.id, version: shown.version, decision: "changes", note: "Again" }));
      else {
        const choose = { caseId: ids.caseId, presentationId: shown.id, version: shown.version, decision: "choose", optionId: shown.options[0].id };
        await run((ctx) => presentationChoice(ctx, choose));
        expect((await run((ctx) => presentationChoice(ctx, choose))).audit).toMatchObject({ replayed: true });
        await expect(run((ctx) => presentationChoice(ctx, { ...choose, decision: "changes", note: "No" }))).rejects.toThrow(/changed|already decided/);
      }
    }
    expect(view.revisions?.concepts).toMatchObject({ used: 3, included: 2, chargeable: true, waiting: false, extra: { revision: 3, state: "agreed" } });
    // The lead designer and the Account Manager heard of the extra revision when its change was drafted (not again when it was shown).
    const extra = (await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`SELECT recipient_id FROM notifications WHERE workspace_id = $1 AND event_type = 'design.extra_revision' AND channel = 'in_app'`, [ids.workspaceId]))).rows;
    expect(extra.map((row) => row.recipient_id).sort()).toEqual([ids.amUser, ids.designerUser].sort());
    // The client's choice completes the concept (no site measure open); samples are next (the Concept package has no renders).
    const after = await journey.get(actor, ids.workspaceId, ids.caseId);
    expect(after.stages.map((stage) => [stage.stage, stage.status])).toEqual([["inspiration", "done"], ["kickoff", "done"], ["concepts", "done"], ["samples", "active"], ["approval", "locked"]]);
    expect(after.stages.find((stage) => stage.stage === "concepts")).toMatchObject({ outcome: "chosen", note: "Client's choice: Warm minimal 4" });
  });

  it("the client's concept choice approves the chosen board and retires the other, so the main quotation's design gate passes; a job decided earlier reads the same", async () => {
    const ids = await seed();
    const { decisions } = services(ids, ALL);
    await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`UPDATE design_journey_stages SET status = CASE WHEN stage IN ('inspiration', 'kickoff', 'site_visit') THEN 'done' WHEN stage = 'concepts' THEN 'active' ELSE status END, completed_at = CASE WHEN stage IN ('inspiration', 'kickoff', 'site_visit') THEN now() END WHERE workspace_id = $1 AND case_id = $2`, [ids.workspaceId, ids.caseId]));
    // Two concept boards uploaded for the stage, as the files stood in the bug: one still a draft, one shared with the client.
    const board = async (title: string, status: "draft" | "client_review") => {
      const designId = randomUUID(), versionId = randomUUID(), asset = randomUUID();
      await asApp(ids.workspaceId, ids.opsUser, async (client) => {
        await client.query("INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,sha256,created_by) VALUES($1,$2,$3,$4,'image/png',1,$5,repeat('c',64),$6)",
          [asset, ids.workspaceId, ids.caseId, `${title}.png`, `design-decisions/${asset}`, ids.opsUser]);
        await client.query("INSERT INTO pre_project_designs(id,workspace_id,case_id,title,document_type,stage,created_by) VALUES($1,$2,$3,$4,'Concept board','concepts',$5)", [designId, ids.workspaceId, ids.caseId, title, ids.opsUser]);
        await client.query("INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,created_by,status,client_review_expires_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)",
          [versionId, ids.workspaceId, ids.caseId, designId, asset, ids.designerUser, status, status === "client_review" ? new Date(Date.now() + 7 * 86_400_000) : null]);
      });
      return { designId, versionId };
    };
    const warm = await board("Warm minimal", "draft");
    const coastal = await board("Coastal", "client_review");
    const presentation = { id: randomUUID(), stage: "concepts", options: [{ id: randomUUID(), title: "Warm minimal", designId: warm.designId }, { id: randomUUID(), title: "Coastal", designId: coastal.designId }] };
    await decisions.createPresentation(actor, ids.workspaceId, ids.caseId, presentation);
    const round = (await decisions.present(actor, ids.workspaceId, ids.caseId, presentation.id, { version: 1 })).presentations[0];
    const gate = () => asApp(ids.workspaceId, ids.opsUser, (client) => captureApprovedDesignBaseline(client, ids.workspaceId, ids.caseId,
      [{ scopeLineId: "package-line", title: "Fit-out package" }], new Date().toISOString(), undefined, { includePackageDesigns: true }));
    // Until the client decides, the main quotation waits for the designs.
    await expect(gate()).rejects.toThrow(/Approve the latest package-level designs/);
    const run = portal(ids);
    const choose = { caseId: ids.caseId, presentationId: round.id, version: round.version, decision: "choose", optionId: presentation.options[0].id };
    await run((ctx) => presentationChoice(ctx, choose));
    // The chosen board is approved with the client's decision in its history; the other is retired, with the reason.
    const files = async () => (await asApp(ids.workspaceId, ids.opsUser, (client) => client.query<{ title: string; status: string; archived: boolean; history: Array<[string, string, string | null, string | null]> }>(
      `SELECT design.title, latest.status, design.archived_at IS NOT NULL AS archived,
              coalesce((SELECT json_agg(json_build_array(activity.action, activity.decision_by, activity.decision_source, activity.client_grant_id::text) ORDER BY activity.created_at)
                          FROM pre_project_design_activity activity WHERE activity.workspace_id = design.workspace_id AND activity.design_id = design.id), '[]'::json) AS history
         FROM pre_project_designs design
         JOIN LATERAL (SELECT status FROM pre_project_design_versions version WHERE version.workspace_id = design.workspace_id AND version.design_id = design.id ORDER BY number DESC LIMIT 1) latest ON true
        WHERE design.workspace_id = $1 AND design.case_id = $2 ORDER BY design.title`, [ids.workspaceId, ids.caseId]))).rows;
    const settled = [
      { title: "Coastal", status: "client_review", archived: true, history: [["comment", "Maya Client", "client_portal", ids.grantId]] },
      { title: "Warm minimal", status: "approved", archived: false, history: [["approved", "Maya Client", "client_portal", ids.grantId]] },
    ];
    expect(await files()).toEqual(settled);
    const notes = (await asApp(ids.workspaceId, ids.opsUser, (client) => client.query<{ note: string }>(`SELECT note FROM pre_project_design_activity WHERE workspace_id = $1 AND case_id = $2 ORDER BY note`, [ids.workspaceId, ids.caseId]))).rows;
    expect(notes.map((row) => row.note)).toEqual(["Chosen by the client from Concepts.", "Not chosen: the client chose Warm minimal (Concepts)."]);
    // The main quotation's design gate now passes with the chosen board alone; a replay of the choice changes nothing more.
    expect((await gate()).links.map((link) => link.designVersionId)).toEqual([warm.versionId]);
    expect((await run((ctx) => presentationChoice(ctx, choose))).audit).toMatchObject({ replayed: true });
    expect(await files()).toEqual(settled);
    // A job whose client chose before the choice settled the files (the chosen board still a draft, the other still shared) passes the gate the same way.
    await asApp(ids.workspaceId, ids.opsUser, async (client) => {
      await client.query("UPDATE pre_project_design_versions SET status = 'draft' WHERE workspace_id = $1 AND id = $2", [ids.workspaceId, warm.versionId]);
      await client.query("UPDATE pre_project_designs SET archived_at = NULL WHERE workspace_id = $1 AND id = $2", [ids.workspaceId, coastal.designId]);
    });
    expect((await gate()).links.map((link) => [link.designVersionId, link.approvedAt !== null])).toEqual([[warm.versionId, true]]);
  });

  it("keeps one design conversation both ways: the client's pinned comments reach the team, team threads reach the client only when shared", async () => {
    const ids = await seed();
    const designId = randomUUID(), versionId = randomUUID(), asset = randomUUID(), teamThread = randomUUID();
    await asApp(ids.workspaceId, ids.opsUser, async (client) => {
      await client.query("UPDATE delivery_projects SET status = 'active' WHERE workspace_id = $1 AND id = $2", [ids.workspaceId, ids.projectId]);
      await client.query("INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,sha256,created_by) VALUES($1,$2,$3,'living.png','image/png',1,$5,repeat('b',64),$4)",
        [asset, ids.workspaceId, ids.caseId, ids.opsUser, `design-decisions/${asset}`]);
      await client.query("INSERT INTO pre_project_designs(id,workspace_id,case_id,title,document_type,stage,created_by) VALUES($1,$2,$3,'Living render','3D render / visualization','renders',$4)", [designId, ids.workspaceId, ids.caseId, ids.opsUser]);
      await client.query("INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,created_by,status,client_review_expires_at) VALUES($1,$2,$3,$4,1,$5,$6,'client_review',now() + interval '7 days')",
        [versionId, ids.workspaceId, ids.caseId, designId, asset, ids.designerUser]);
      // An internal team note on the same picture.
      await client.query("INSERT INTO pre_project_design_threads(id,workspace_id,case_id,design_id,version_id,title,blocking,created_by,anchor) VALUES($1,$2,$3,$4,$5,'Check the skirting',false,$6,'{\"x\":0.2,\"y\":0.3}')",
        [teamThread, ids.workspaceId, ids.caseId, designId, versionId, ids.designerUser]);
      await client.query("INSERT INTO pre_project_design_messages(id,workspace_id,case_id,design_id,thread_id,body,created_by) VALUES($1,$2,$3,$4,$1,'Check the skirting',$5)", [teamThread, ids.workspaceId, ids.caseId, designId, ids.designerUser]);
    });
    const run = portal(ids);
    const review = () => run((ctx) => readDesignReview((ctx as { db: PoolClient }).db, ids.workspaceId, (ctx as { contact: PortalContact }).contact.grants[0],
      { caseId: ids.caseId, caseStatus: "active", projectStatus: "active" }, ASSUME_PRESENT));
    expect((await review()).designs[0].versions[0].threads).toEqual([]);
    const pinned = await run((ctx) => designComment(ctx, { caseId: ids.caseId, versionId, text: "Can the sofa be darker?", anchor: { x: 0.5, y: 0.25 } }));
    await expect(run((ctx) => designComment(ctx, { caseId: ids.caseId, versionId, text: "x", anchor: { x: 2, y: 0 } }))).rejects.toThrow(/Tap the picture/);
    await run((ctx) => designReply(ctx, { caseId: ids.caseId, threadId: pinned.threadId, text: "Or charcoal" }));
    // The team sees the client's thread on the drawing and hears it.
    const staff = (await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`SELECT client_visible, client_grant_id, created_by, anchor FROM pre_project_design_threads WHERE workspace_id = $1 AND id = $2`, [ids.workspaceId, pinned.threadId]))).rows[0];
    expect(staff).toMatchObject({ client_visible: true, client_grant_id: ids.grantId, created_by: null, anchor: { x: 0.5, y: 0.25 } });
    const heard = (await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND event_type = 'design.client_commented' AND recipient_id = $2`, [ids.workspaceId, ids.designerUser]))).rows[0].n;
    expect(heard).toBeGreaterThan(0);
    // Sharing the team's thread (the audience switch) shows it to the client too; the client resolves only their own.
    await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`UPDATE pre_project_design_threads SET client_visible = true WHERE workspace_id = $1 AND id = $2`, [ids.workspaceId, teamThread]));
    const threads = (await review()).designs[0].versions[0].threads as Array<{ id: string; fromClient: boolean; canResolve: boolean; version: number; messages: Array<{ text: string; author: string | null }> }>;
    expect(threads.map((thread) => [thread.fromClient, thread.canResolve, thread.messages.map((message) => message.text)])).toEqual([[false, false, ["Check the skirting"]], [true, true, ["Can the sofa be darker?", "Or charcoal"]]]);
    await expect(run((ctx) => designResolve(ctx, { caseId: ids.caseId, threadId: teamThread, status: "resolved", version: threads[0].version }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run((ctx) => designResolve(ctx, { caseId: ids.caseId, threadId: pinned.threadId, status: "resolved", version: 99 }))).rejects.toThrow(/changed/);
    await run((ctx) => designResolve(ctx, { caseId: ids.caseId, threadId: pinned.threadId, status: "resolved", version: threads[1].version }));
    // Another tenant's portal can't see or write into it.
    const other = await seed();
    await expect(portal(other)((ctx) => designComment(ctx, { caseId: ids.caseId, versionId, text: "hi" }))).rejects.toThrow(/isn't shared with you/);
  });
});
