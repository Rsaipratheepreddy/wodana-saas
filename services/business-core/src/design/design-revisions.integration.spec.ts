import { ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideChange, readChanges } from "../change-requests/change-request.store";
import type { PortalContact } from "../client-portal/portal-auth";
import { presentationChoice, readDesignChoices } from "../client-portal/portal-design-decisions";
import { readPortalSettings } from "../client-portal/portal-settings";
import { decidePortalDesign } from "../commercial/portal-design-approval";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { DesignDecisionsService } from "./design-decisions.service";
import { startJourney } from "./design-journey.store";
import { readStepRevisions } from "./design-revisions.store";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Every call runs as the app role
// (wodana_app, forced RLS) in its own committed transaction, so replays, the gate and tenants are real.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Seed = { workspaceId: string; caseId: string; jobId: string; opsUser: string; amUser: string; designerUser: string; grantId: string };

integration("free design revisions, then a chargeable change request (PLM-049/051)", { timeout: 60_000 }, () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 6 });
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

  /** Setup as the owner (records written straight, without their foreign keys checked). */
  async function asOwner<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async function seed(included: number | null = 2): Promise<Seed> {
    const ids = { workspaceId: randomUUID(), caseId: randomUUID(), jobId: randomUUID(), opsUser: randomUUID(), amUser: randomUUID(), designerUser: randomUUID(), grantId: randomUUID() };
    const am = randomUUID(), designer = randomUUID(), ops = randomUUID(), partyId = randomUUID(), opportunityId = randomUUID(), packageId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      for (const [id, name] of [[ids.opsUser, "Ops"], [ids.amUser, "Account manager"], [ids.designerUser, "Lead designer"]])
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${id.slice(0, 8)}@example.com`, name]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [ids.workspaceId, `xr-${ids.workspaceId.slice(0, 8)}`, ids.opsUser]);
      for (const [id, user] of [[ops, ids.opsUser], [am, ids.amUser], [designer, ids.designerUser]])
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [id, ids.workspaceId, user]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','The client','the client')", [partyId, ids.workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, ids.workspaceId, partyId, randomUUID(), randomUUID(), am]);
      await client.query("INSERT INTO crm_opportunity_designer(workspace_id,opportunity_id,membership_id) VALUES($1,$2,$3)", [ids.workspaceId, opportunityId, designer]);
      await client.query(`INSERT INTO design_packages(id,workspace_id,code,name,pricing_method,rate,currency,area_unit,includes_space_planning,includes_renders${included === null ? "" : ",included_revisions"})
        VALUES($1,$2,'concept','Concept','per_space',10000,'AED',null,true,false${included === null ? "" : ",$3"})`, included === null ? [packageId, ids.workspaceId] : [packageId, ids.workspaceId, included]);
      await client.query("INSERT INTO crm_opportunity_discovery(workspace_id,opportunity_id,design_package_id) VALUES($1,$2,$3)", [ids.workspaceId, opportunityId, packageId]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [ids.caseId, ids.workspaceId, opportunityId, ids.opsUser]);
      await client.query("INSERT INTO client_portal_grants(id,workspace_id,case_id,name,phone,role) VALUES($1,$2,$3,'The client','+971500000001','approver')", [ids.grantId, ids.workspaceId, ids.caseId]);
      await client.query("INSERT INTO job_identities(id,workspace_id,reference,root_type,root_id,created_by) VALUES($1,$2,'J-000001','enquiry',$3,$4)", [ids.jobId, ids.workspaceId, randomUUID(), ids.opsUser]);
      await client.query("INSERT INTO job_identity_links(id,workspace_id,job_id,record_type,record_id,status,version,attached_at) VALUES($1,$2,$3,'case',$4,'active',1,now())",
        [randomUUID(), ids.workspaceId, ids.jobId, ids.caseId]);
      await seedDefaultNotificationTemplates(client, ids.workspaceId);
      await client.query("COMMIT");
    } finally { client.release(); }
    await asApp(ids.workspaceId, ids.opsUser, async (client) => {
      await startJourney(client, ids.workspaceId, ids.caseId, ids.opsUser, { flow: 1 });
      await client.query(`UPDATE design_journey_stages SET status = CASE WHEN stage IN ('inspiration', 'site_visit') THEN 'done' WHEN stage = 'concepts' THEN 'active' ELSE status END,
        completed_at = CASE WHEN stage IN ('inspiration', 'site_visit') THEN now() END WHERE workspace_id = $1 AND case_id = $2`, [ids.workspaceId, ids.caseId]);
    });
    return ids;
  }

  const ALL = ["pre_projects.view", "pre_projects.edit", "pre_projects.review_designs", "pre_projects.record_client_design_decisions", "pre_projects.manage_lifecycle"];
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  function decisions(ids: Seed, userId = ids.opsUser) {
    const access = {
      withPermission: (a: unknown, workspaceId: string, permission: string, work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) => access.withPermissions(a, workspaceId, [permission], work),
      withPermissions: async (_actor: unknown, workspaceId: string, required: string[], work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) => {
        if (!required.every((permission) => ALL.includes(permission))) throw new ForbiddenException(`Permissions required: ${required.join(", ")}`);
        return asApp(workspaceId, userId, (client) => work(client, { userId }));
      },
      hasPermission: async () => true,
    };
    return new DesignDecisionsService(access as never);
  }
  function portal(ids: Seed) {
    const contact: PortalContact = { sessionId: randomUUID(), phone: "+971500000001", name: "The client", nameConfirmed: true,
      grants: [{ id: ids.grantId, caseId: ids.caseId, name: "The client", role: "approver", email: null, confirmed: true, demo: false }] };
    return <T>(work: (ctx: never) => Promise<T>) => asApp(ids.workspaceId, "00000000-0000-4000-8000-000000000000", async (client) =>
      work({ db: client, workspaceId: ids.workspaceId, contact, settings: await readPortalSettings(client, ids.workspaceId), today: "2026-10-17" } as never));
  }
  const changesOf = (ids: Seed) => asApp(ids.workspaceId, ids.opsUser, (client) => readChanges(client, ids.workspaceId, ids.caseId));
  const links = (ids: Seed) => asApp(ids.workspaceId, ids.opsUser, async (client) => (await client.query<{ stage: string; revision: number; changeId: string; grantId: string | null; userId: string | null }>(
    `SELECT stage, revision, change_request_id AS "changeId", asked_by_grant_id AS "grantId", asked_by_user_id AS "userId" FROM design_extra_revisions WHERE workspace_id = $1 ORDER BY created_at`, [ids.workspaceId])).rows);

  /** A presentation round of concepts shown to the client: created and presented by the team. */
  async function present(ids: Seed, title: string) {
    const service = decisions(ids);
    const round = { id: randomUUID(), stage: "concepts", options: [{ id: randomUUID(), title, linkUrl: "https://www.canva.com/design/board" }] };
    await service.createPresentation(actor, ids.workspaceId, ids.caseId, round);
    const view = await service.present(actor, ids.workspaceId, ids.caseId, round.id, { version: 1 });
    return view.presentations.find((item) => item.id === round.id)!;
  }

  it("the team records the client's asks: two free revisions, the third drafts exactly one change request and the step waits until it is approved", async () => {
    const ids = await seed();
    const service = decisions(ids);
    for (let number = 1; number <= 3; number += 1) {
      const round = await present(ids, `Board ${number}`);
      const view = await service.decide(actor, ids.workspaceId, ids.caseId, round.id, { version: round.version, decision: "changes_requested", source: "meeting", decidedBy: "The client", note: `Change ${number}` });
      expect(view.revisions?.concepts).toMatchObject({ used: number, included: 2, chargeable: number > 2, waiting: number > 2 });
      expect(await changesOf(ids)).toHaveLength(number > 2 ? 1 : 0);
    }
    const [draft] = await changesOf(ids);
    expect(draft).toMatchObject({ title: "Extra revision: Concepts", status: "draft", priceImpact: "0.00", description: "Change 3", raisedByClient: false, lines: [] });
    expect(await links(ids)).toEqual([{ stage: "concepts", revision: 3, changeId: draft.id, grantId: null, userId: ids.opsUser }]);
    // The team drafting it again returns the same draft.
    const again = await service.draftExtraRevision(actor, ids.workspaceId, ids.caseId, { stage: "concepts" });
    expect(again.revisions?.concepts).toMatchObject({ waiting: true, extra: { revision: 3, changeRequestId: draft.id, reference: draft.reference, status: "draft", state: "waiting" } });
    expect(await changesOf(ids)).toHaveLength(1);
    await expect(service.draftExtraRevision(actor, ids.workspaceId, ids.caseId, { stage: "space_planning" })).rejects.toThrow(/free revisions/);

    // The lead designer and the Account Manager heard it in the app; the job's thread has one line; it is audited.
    const told = await asApp(ids.workspaceId, ids.opsUser, (client) => client.query<{ recipient: string; link: string }>(
      `SELECT recipient_id AS recipient, deep_link AS link FROM notifications WHERE workspace_id = $1 AND event_type = 'design.extra_revision' AND channel = 'in_app'`, [ids.workspaceId]));
    expect(told.rows.map((row) => row.recipient).sort()).toEqual([ids.amUser, ids.designerUser].sort());
    expect(told.rows.every((row) => row.link === `/workspace/pre-projects/cases/${ids.caseId}/variations?change=${draft.id}`)).toBe(true);
    const thread = await asApp(ids.workspaceId, ids.opsUser, (client) => client.query<{ body: string }>(`SELECT body FROM job_messages WHERE workspace_id = $1 AND job_id = $2 AND event_code = 'design_extra_revision'`, [ids.workspaceId, ids.jobId]));
    expect(thread.rows.map((row) => row.body)).toEqual([`${draft.reference} drafted: extra revision on Concepts (revision 3, 2 included)`]);
    const audit = await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`SELECT 1 FROM audit_events WHERE workspace_id = $1 AND action = 'design.extra_revision_raised.v1'`, [ids.workspaceId]));
    expect(audit.rowCount).toBe(1);

    // The next round waits: refused while the change is a draft or with the client, allowed once the client approves it.
    const next = { id: randomUUID(), stage: "concepts", options: [{ id: randomUUID(), title: "Board 4", linkUrl: "https://www.canva.com/design/board4" }] };
    await expect(service.createPresentation(actor, ids.workspaceId, ids.caseId, next)).rejects.toThrow("Waiting for the extra revision to be agreed");
    await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`UPDATE change_requests SET status = 'with_client' WHERE workspace_id = $1 AND id = $2`, [ids.workspaceId, draft.id]));
    await expect(service.createPresentation(actor, ids.workspaceId, ids.caseId, next)).rejects.toThrow(/extra revision/);
    // Once sent, the client sees it beside their design choices, and that further changes are paid.
    const choices = await portal(ids)((ctx) => readDesignChoices((ctx as { db: PoolClient }).db, ids.workspaceId, (ctx as { contact: PortalContact }).contact.grants[0], ids.caseId, true));
    expect(choices.extraRevisions).toEqual([{ stage: "concepts", label: "Concepts", changeId: draft.id }]);
    await asApp(ids.workspaceId, ids.opsUser, (client) => decideChange(client, ids.workspaceId, ids.caseId, draft.id, { decision: "approve", method: "portal", name: "The client", grantId: ids.grantId }));
    const view = await service.createPresentation(actor, ids.workspaceId, ids.caseId, next);
    expect(view.revisions?.concepts).toMatchObject({ used: 3, waiting: false, extra: { state: "agreed", status: "approved" } });
    const shown = (await service.present(actor, ids.workspaceId, ids.caseId, next.id, { version: 1 })).presentations.find((item) => item.id === next.id)!;
    expect(shown).toMatchObject({ round: 4, chargeable: true });
    // Shown to the client, the paid revision says further changes are paid; it raised no second notice to Sales.
    const later = await portal(ids)((ctx) => readDesignChoices((ctx as { db: PoolClient }).db, ids.workspaceId, (ctx as { contact: PortalContact }).contact.grants[0], ids.caseId, true));
    expect(later.presentations.find((item) => item.id === next.id)).toMatchObject({ canDecide: true, paidChanges: true });
    const notices = await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`SELECT 1 FROM notifications WHERE workspace_id = $1 AND event_type = 'design.extra_revision'`, [ids.workspaceId]));
    expect(notices.rowCount).toBe(2);
  });

  it("the client asks in the portal: a replay drafts nothing more, and the package's default of 2 applies when it doesn't say", async () => {
    const ids = await seed(null);
    const run = portal(ids);
    for (let number = 1; number <= 3; number += 1) {
      const round = await present(ids, `Board ${number}`);
      const choices = await run((ctx) => readDesignChoices((ctx as { db: PoolClient }).db, ids.workspaceId, (ctx as { contact: PortalContact }).contact.grants[0], ids.caseId, true));
      expect(choices.presentations.find((item) => item.id === round.id)?.paidChanges).toBe(number > 2);
      const ask = { caseId: ids.caseId, presentationId: round.id, version: round.version, decision: "changes", note: `Change ${number}` };
      const result = await run((ctx) => presentationChoice(ctx, ask));
      expect(result.audit.extra).toMatchObject(number > 2 ? { kind: "extra", revision: 3, included: 2, drafted: true } : { kind: "free", revision: number, included: 2 });
      expect((await run((ctx) => presentationChoice(ctx, ask))).audit).toMatchObject({ replayed: true });
    }
    const changes = await changesOf(ids);
    expect(changes).toHaveLength(1);
    // Raised by the Account Manager for the team to price (the client sees it once it is sent), asked by the client's contact.
    expect(changes[0]).toMatchObject({ title: "Extra revision: Concepts", status: "draft", raisedByClient: false, raisedBy: ids.amUser, description: "Change 3" });
    expect(await links(ids)).toEqual([{ stage: "concepts", revision: 3, changeId: changes[0].id, grantId: ids.grantId, userId: null }]);
    const choices = await run((ctx) => readDesignChoices((ctx as { db: PoolClient }).db, ids.workspaceId, (ctx as { contact: PortalContact }).contact.grants[0], ids.caseId, true));
    expect(choices.extraRevisions).toEqual([]);
  });

  it("counts the client's asks on a step's files from the portal, not the internal reviewer's", async () => {
    const ids = await seed(1);
    const designId = randomUUID(), asset = randomUUID();
    await asOwner(async (client) => {
      await client.query("INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,sha256,created_by) VALUES($1,$2,$3,'plan.pdf','application/pdf',1,$5,repeat('a',64),$4)", [asset, ids.workspaceId, ids.caseId, ids.opsUser, `design-revisions/${asset}`]);
      await client.query("INSERT INTO pre_project_designs(id,workspace_id,case_id,title,document_type,stage,created_by) VALUES($1,$2,$3,'Ground floor','2D floor plan','space_planning',$4)", [designId, ids.workspaceId, ids.caseId, ids.opsUser]);
    });
    const share = (number: number) => asOwner(async (client) => {
      const versionId = randomUUID();
      await client.query(`INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,created_by,status,client_review_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'client_review',now() + interval '7 days')`,
        [versionId, ids.workspaceId, ids.caseId, designId, number, asset, ids.opsUser]);
      return versionId;
    });
    const grant = { id: ids.grantId, name: "The client", role: "approver" };
    for (let number = 1; number <= 2; number += 1) {
      const versionId = await share(number);
      // The internal reviewer's send-back isn't the client's ask.
      await asApp(ids.workspaceId, ids.opsUser, (client) => client.query(`INSERT INTO pre_project_design_activity(id,workspace_id,case_id,design_id,version_id,action,note,decision_by,created_by) VALUES($1,$2,$3,$4,$5,'changes_requested','Scale','',$6)`,
        [randomUUID(), ids.workspaceId, ids.caseId, designId, versionId, ids.opsUser]));
      const challengeId = randomUUID();
      const ask = { versionId, decision: "changes", note: `Wider hall ${number}`, challengeId };
      await asApp(ids.workspaceId, ids.opsUser, (client) => decidePortalDesign(client, ids.workspaceId, ids.caseId, grant, ask, async () => "ok"));
      expect(await asApp(ids.workspaceId, ids.opsUser, (client) => decidePortalDesign(client, ids.workspaceId, ids.caseId, grant, ask, async () => "ok"))).toMatchObject({ replayed: true });
      const state = (await asApp(ids.workspaceId, ids.opsUser, (client) => readStepRevisions(client, ids.workspaceId, ids.caseId)))!.space_planning;
      expect(state).toMatchObject({ used: number, included: 1, waiting: number > 1 });
    }
    const changes = await changesOf(ids);
    expect(changes.map((change) => change.title)).toEqual(["Extra revision: Space planning"]);
    expect(await links(ids)).toEqual([{ stage: "space_planning", revision: 2, changeId: changes[0].id, grantId: ids.grantId, userId: null }]);
  });

  it("keeps each workspace's extra revisions to itself", async () => {
    const a = await seed(), b = await seed();
    for (let number = 1; number <= 3; number += 1) {
      const round = await present(a, `Board ${number}`);
      await decisions(a).decide(actor, a.workspaceId, a.caseId, round.id, { version: round.version, decision: "changes_requested", source: "phone", decidedBy: "The client", note: "Again" });
    }
    const [change] = await changesOf(a);
    expect(await links(a)).toHaveLength(1);
    // Under B's tenant, A's links, change and case don't exist; B can't link anything to A's records.
    expect(await links(b)).toEqual([]);
    expect(await asApp(b.workspaceId, b.opsUser, (client) => readStepRevisions(client, b.workspaceId, a.caseId))).toBeNull();
    const seen = await asApp(b.workspaceId, b.opsUser, (client) => client.query(`SELECT 1 FROM design_extra_revisions WHERE case_id = $1`, [a.caseId]));
    expect(seen.rowCount).toBe(0);
    await expect(asApp(b.workspaceId, b.opsUser, (client) => client.query(
      `INSERT INTO design_extra_revisions (workspace_id, id, case_id, stage, revision, included, change_request_id) VALUES ($1, $2, $3, 'concepts', 3, 2, $4)`,
      [a.workspaceId, randomUUID(), a.caseId, change.id]))).rejects.toThrow(/row-level security/);
    await expect(decisions(b).draftExtraRevision(actor, b.workspaceId, a.caseId, { stage: "concepts" })).rejects.toThrow(/Case not found/);
  });
});
