import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { DesignJourneyService } from "./design-journey.service";
import { runReminderSweep } from "../reminders/testing";
import { processDesignDeadlines, startInspirationTimer, startJourney } from "./design-journey.store";
import { syncDesignStages } from "./design-stage-sync";
import { designQueue, noticeDesignStep } from "../pre-projects/design-notices";
import { PreProjectsService } from "../pre-projects/pre-projects.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
type Ids = { workspaceId: string; caseId: string; designer: string; am: string; designerUser: string; amUser: string; qsUser: string; visualiser: string; visualiserUser: string };

integration("design journey (PLM-044, 047–053, 080, 081, 128)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withCase(pkg: { spacePlanning: boolean; renders: boolean } | null, work: (client: PoolClient, ids: Ids, service: DesignJourneyService) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), partyId = randomUUID(), opportunityId = randomUUID(), caseId = randomUUID(), packageId = randomUUID();
    const amUser = randomUUID(), designerUser = randomUUID(), opsUser = randomUUID(), qsUser = randomUUID(), visualiserUser = randomUUID(), am = randomUUID(), designer = randomUUID(), qs = randomUUID(), visualiser = randomUUID();
    try {
      await client.query("BEGIN");
      for (const [id, name] of [[amUser, "Aisha AM"], [designerUser, "Dana Designer"], [opsUser, "Ops"], [qsUser, "Qamar QS"], [visualiserUser, "Vik Visualiser"]])
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${id.slice(0, 8)}@example.com`, name]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Europe/London',$3)", [workspaceId, `dj-${workspaceId.slice(0, 8)}`, amUser]);
      for (const [id, user] of [[am, amUser], [designer, designerUser], [qs, qsUser], [visualiser, visualiserUser]]) await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [id, workspaceId, user]);
      for (const [membership, code] of [[qs, "quantity_surveyor"], [visualiser, "visualiser"]]) {
        const roleId = randomUUID();
        await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,$3,$3,false)", [roleId, workspaceId, code]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, membership, roleId]);
      }
      await client.query("INSERT INTO workspace_sales_settings(workspace_id,sales_admin_membership_id) VALUES($1,$2)", [workspaceId, qs]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [partyId, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, partyId, randomUUID(), randomUUID(), am]);
      await client.query("INSERT INTO crm_opportunity_designer(workspace_id,opportunity_id,membership_id) VALUES($1,$2,$3)", [workspaceId, opportunityId, designer]);
      if (pkg) {
        await client.query("INSERT INTO design_packages(id,workspace_id,code,name,pricing_method,rate,currency,area_unit,includes_space_planning,includes_renders,included_revisions) VALUES($1,$2,'bespoke','Bespoke','per_area',40,'AED','sqft',$3,$4,2)", [packageId, workspaceId, pkg.spacePlanning, pkg.renders]);
        await client.query("INSERT INTO crm_opportunity_discovery(workspace_id,opportunity_id,design_package_id) VALUES($1,$2,$3)", [workspaceId, opportunityId, packageId]);
      }
      await client.query("INSERT INTO workspace_design_settings(workspace_id,inspiration_days,site_visit_hours,design_internal_days,design_client_days,material_selection_days,estimate_days,site_visit_questions) VALUES($1,5,48,21,42,7,7,$2)",
        [workspaceId, JSON.stringify([{ key: "access", question: "How do we get in?" }, { key: "services", question: "Where are the services?" }])]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, opsUser]);
      await seedDefaultNotificationTemplates(client, workspaceId);
      await client.query("SET LOCAL session_replication_role = origin");
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: opsUser });
      const service = new DesignJourneyService({ withPermission: run, withPermissions: run, hasPermission: async () => true } as never);
      await work(client, { workspaceId, caseId, designer, am, designerUser, amUser, qsUser, visualiser, visualiserUser }, service);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  /** The Planning case read (the case page and the Planning list), as the person. */
  const cases = (client: PoolClient, userId: string) => {
    const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
    return new PreProjectsService({ withPermission: run, withPermissions: run, hasPermission: async () => true } as never, {} as never, {} as never);
  };
  const stage = async (client: PoolClient, ids: Ids, name: string) => (await client.query(`SELECT status, due_at, started_at, version, activity_id FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [ids.workspaceId, ids.caseId, name])).rows[0];

  it("runs inspiration, then a site visit due within the configured hours that needs every wall measured with photos", async () => {
    await withCase({ spacePlanning: true, renders: true }, async (client, ids, service) => {
      const started = await service.start(actor, ids.workspaceId, ids.caseId);
      expect(started.stages.map((row) => [row.stage, row.status])).toEqual([["inspiration", "active"], ["site_visit", "locked"], ["concepts", "locked"], ["space_planning", "locked"], ["material_selection", "locked"], ["renders", "locked"], ["approval", "locked"]]);
      expect((await stage(client, ids, "inspiration")).due_at).toBeNull();
      await expect(service.start(actor, ids.workspaceId, ids.caseId)).rejects.toThrow(/already started/);

      await startInspirationTimer(client, ids.workspaceId, ids.caseId);
      const inspiration = await stage(client, ids, "inspiration");
      expect(Math.round((inspiration.due_at.getTime() - Date.now()) / 86_400_000)).toBe(5);

      await service.closeInspiration(actor, ids.workspaceId, ids.caseId, { version: inspiration.version, note: "Client happy with the board" });
      const visit = await stage(client, ids, "site_visit");
      expect(visit.status).toBe("active");
      expect(Math.round((visit.due_at.getTime() - Date.now()) / 3_600_000)).toBe(48);
      const task = (await client.query(`SELECT owner_membership_id, type, due_at FROM crm_activities WHERE workspace_id = $1 AND id = $2`, [ids.workspaceId, visit.activity_id])).rows[0];
      expect(task).toMatchObject({ owner_membership_id: ids.designer, type: "task" });
      const started2 = (await client.query(`SELECT recipient_id FROM notifications WHERE workspace_id = $1 AND subject LIKE 'Site visit · %' ORDER BY recipient_id`, [ids.workspaceId])).rows.map((row) => row.recipient_id);
      expect(started2.sort()).toEqual([ids.amUser, ids.designerUser].sort());

      await service.scheduleSiteVisit(actor, ids.workspaceId, ids.caseId, { version: visit.version, startsAt: "2031-04-02T09:00:00Z", endsAt: "2031-04-02T10:30:00Z", timezone: "Europe/London", address: "Villa 12, Palm" });
      const appointment = (await client.query(`SELECT attendee_membership_ids AS members FROM crm_appointments WHERE workspace_id = $1 AND activity_id = $2`, [ids.workspaceId, visit.activity_id])).rows[0];
      expect(new Set(appointment.members)).toEqual(new Set([ids.designer, ids.am]));
      const invites = (await client.query(`SELECT recipient_id, channel FROM notifications WHERE workspace_id = $1 AND subject LIKE '%site visit with Maya Client' OR (workspace_id = $1 AND subject = 'Site visit with Maya Client')`, [ids.workspaceId])).rows;
      expect(invites.length).toBe(4);

      const current = await stage(client, ids, "site_visit");
      await expect(service.completeSiteVisit(actor, ids.workspaceId, ids.caseId, { version: current.version, summary: "Measured" })).rejects.toThrow(/Record the measurements/);
      const room = randomUUID();
      await client.query(`INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Living')`, [room, ids.workspaceId, ids.caseId]);
      const record = (id: string, title: string, status: string, files: string[]) => client.query(
        `INSERT INTO pre_project_site_records(id,workspace_id,case_id,kind,room_id,title,status,version,content,created_by,updated_by) VALUES($1,$2,$3,'measurement',$4,$5,$6,1,$7,$8,$8)`,
        [id, ids.workspaceId, ids.caseId, room, title, status, JSON.stringify({ assetIds: files }), ids.amUser]);
      await record(randomUUID(), "Living wall A", "measured", [randomUUID()]);
      const kitchen = randomUUID();
      await record(kitchen, "Kitchen wall", "measured", []);
      await expect(service.completeSiteVisit(actor, ids.workspaceId, ids.caseId, { version: current.version, summary: "Measured" })).rejects.toThrow("Add a photo for Kitchen wall");
      await client.query(`UPDATE pre_project_site_records SET content = $2 WHERE id = $1`, [kitchen, JSON.stringify({ assetIds: [randomUUID()] })]);
      // PLM-128: measurements and photos are not enough; every question on the list needs an answer.
      await expect(service.completeSiteVisit(actor, ids.workspaceId, ids.caseId, { version: current.version, summary: "Measured" })).rejects.toThrow("Answer the 2 site visit questions left");
      await expect(service.answerSiteVisit(actor, ids.workspaceId, ids.caseId, { version: current.version, answers: [{ key: "parking", answer: "x" }] })).rejects.toThrow(/not on this visit/);
      const partly = await service.answerSiteVisit(actor, ids.workspaceId, ids.caseId, { version: current.version, answers: [{ key: "access", answer: "Service lift, booked with the building" }] });
      expect(partly.siteChecklistProblem).toBe("Answer the last site visit question");
      expect(partly.checklist.map((item) => [item.key, item.answer, item.answeredByName])).toEqual([["access", "Service lift, booked with the building", "Ops"], ["services", null, null]]);
      const visitVersion = partly.stages.find((row) => row.stage === "site_visit")!.version;
      await expect(service.completeSiteVisit(actor, ids.workspaceId, ids.caseId, { version: current.version, summary: "Measured" })).rejects.toThrow(/another window/);
      const answered = await service.answerSiteVisit(actor, ids.workspaceId, ids.caseId, { version: visitVersion, answers: [{ key: "services", answer: "Two DBs in the corridor, water riser in the kitchen" }] });
      expect(answered.siteChecklistProblem).toBeNull();
      const done = await service.completeSiteVisit(actor, ids.workspaceId, ids.caseId, { version: answered.stages.find((row) => row.stage === "site_visit")!.version, summary: "All walls measured" });
      expect(done.stages.slice(0, 3).map((row) => row.status)).toEqual(["done", "done", "active"]);
      expect((await client.query(`SELECT status FROM crm_activities WHERE workspace_id = $1 AND id = $2`, [ids.workspaceId, visit.activity_id])).rows[0].status).toBe("completed");
      // PLM-049: concepts run on an internal deadline and a longer client-facing one, tracked separately.
      const concepts = done.stages.find((row) => row.stage === "concepts")!;
      expect(Math.round((new Date(concepts.dueAt as string).getTime() - Date.now()) / 86_400_000)).toBe(21);
      expect(Math.round((new Date(concepts.clientDueAt as string).getTime() - Date.now()) / 86_400_000)).toBe(42);
      expect(concepts.revisions).toEqual({ used: 0, included: 2, chargeable: false });
    });
  });

  it("ends a lapsed inspiration week and alerts once when a stage runs late", async () => {
    await withCase({ spacePlanning: false, renders: false }, async (client, ids) => {
      await startJourney(client, ids.workspaceId, ids.caseId, ids.amUser);
      expect((await client.query(`SELECT count(*)::int AS n FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2`, [ids.workspaceId, ids.caseId])).rows[0].n).toBe(5);
      await client.query(`UPDATE design_journey_stages SET due_at = now() - interval '1 minute' WHERE workspace_id = $1 AND case_id = $2 AND stage = 'inspiration'`, [ids.workspaceId, ids.caseId]);
      expect(await processDesignDeadlines(client, ids.workspaceId)).toMatchObject({ closed: 1, alerted: 0 });
      expect((await stage(client, ids, "site_visit")).status).toBe("active");

      await client.query(`UPDATE design_journey_stages SET due_at = now() - interval '1 hour' WHERE workspace_id = $1 AND case_id = $2 AND stage = 'site_visit'`, [ids.workspaceId, ids.caseId]);
      expect(await processDesignDeadlines(client, ids.workspaceId)).toMatchObject({ closed: 0, alerted: 1 });
      expect(await processDesignDeadlines(client, ids.workspaceId)).toMatchObject({ closed: 0, alerted: 0 });
      // The designer and the account manager are reminded by the reminder engine (design.stage_due), in the app and by email, once.
      await runReminderSweep(client, ids.workspaceId, { now: new Date() });
      await runReminderSweep(client, ids.workspaceId, { now: new Date() });
      const overdue = (await client.query(`SELECT recipient_id, channel FROM notifications WHERE workspace_id = $1 AND event_type = 'design.stage_due' AND subject LIKE 'Site visit%' ORDER BY channel`, [ids.workspaceId])).rows;
      expect(overdue.length).toBe(4);
    });
  });

  it("completes design stages from approved deliverables, skips an unneeded one and signs off only when everything is approved", async () => {
    await withCase({ spacePlanning: true, renders: false }, async (client, ids, service) => {
      await service.start(actor, ids.workspaceId, ids.caseId);
      await client.query(`UPDATE design_journey_stages SET status = CASE stage WHEN 'inspiration' THEN 'done' WHEN 'site_visit' THEN 'done' WHEN 'concepts' THEN 'active' ELSE status END,
        completed_at = CASE WHEN stage IN ('inspiration','site_visit') THEN now() END WHERE workspace_id = $1 AND case_id = $2`, [ids.workspaceId, ids.caseId]);
      const user = ids.amUser, asset = randomUUID();
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,sha256,created_by) VALUES($1,$2,$3,'a.pdf','application/pdf',1,'k',repeat('a',64),$4)", [asset, ids.workspaceId, ids.caseId, user]);
      const design = async (stage: string, title: string, status: string) => {
        const id = randomUUID();
        await client.query("INSERT INTO pre_project_designs(id,workspace_id,case_id,title,document_type,stage,created_by) VALUES($1,$2,$3,$4,'concept',$5,$6)", [id, ids.workspaceId, ids.caseId, title, stage, user]);
        await client.query("INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,created_by,status) VALUES($1,$2,$3,$4,1,$5,$6,$7)", [randomUUID(), ids.workspaceId, ids.caseId, id, asset, user, status]);
        return id;
      };
      const approve = (id: string) => client.query("UPDATE pre_project_design_versions SET status='approved' WHERE workspace_id=$1 AND design_id=$2", [ids.workspaceId, id]);
      const kitchen = await design("concepts", "Kitchen concept", "client_review");
      const living = await design("concepts", "Living concept", "approved");
      const layout = await design("space_planning", "Ground floor layout", "approved");
      await client.query("SET LOCAL session_replication_role = origin");
      const version = async (stage: string) => (await client.query(`SELECT version FROM design_journey_stages WHERE workspace_id=$1 AND case_id=$2 AND stage=$3`, [ids.workspaceId, ids.caseId, stage])).rows[0].version;
      const statuses = async () => Object.fromEntries((await client.query(`SELECT stage, status FROM design_journey_stages WHERE workspace_id=$1 AND case_id=$2`, [ids.workspaceId, ids.caseId])).rows.map((row) => [row.stage, row.status]));

      expect(await syncDesignStages(client, ids.workspaceId, ids.caseId, user)).toEqual([]);
      // PLM-049/051: a file's client rounds count per stage; the fourth round is the third revision, beyond the two included.
      const kitchenVersion = (await client.query(`SELECT id FROM pre_project_design_versions WHERE workspace_id=$1 AND design_id=$2`, [ids.workspaceId, kitchen])).rows[0].id;
      await client.query("SET LOCAL session_replication_role = replica");
      for (let round = 0; round < 4; round += 1)
        await client.query("INSERT INTO pre_project_design_activity(id,workspace_id,case_id,design_id,version_id,action,note,decision_by,created_by) VALUES($1,$2,$3,$4,$5,'client_review','','',$6)", [randomUUID(), ids.workspaceId, ids.caseId, kitchen, round ? randomUUID() : kitchenVersion, user]);
      await client.query("SET LOCAL session_replication_role = origin");
      expect((await service.get(actor, ids.workspaceId, ids.caseId)).stages.find((row) => row.stage === "concepts")!.revisions).toEqual({ used: 3, included: 2, chargeable: true });
      await approve(kitchen);
      // Concepts completes, and space planning (approved ahead of time) completes as soon as it opens.
      expect(await syncDesignStages(client, ids.workspaceId, ids.caseId, user)).toEqual(["concepts", "space_planning"]);
      expect(await statuses()).toMatchObject({ concepts: "done", space_planning: "done", material_selection: "active", approval: "locked" });
      expect(await statuses()).not.toHaveProperty("renders");

      // PLM-050: material selection opens with its week, a task to book the showroom appointment, and a daily reminder until it is booked.
      const materials = await stage(client, ids, "material_selection");
      expect(Math.round((materials.due_at.getTime() - Date.now()) / 86_400_000)).toBe(7);
      expect((await client.query(`SELECT title, owner_membership_id AS owner FROM crm_activities WHERE workspace_id = $1 AND id = $2`, [ids.workspaceId, materials.activity_id])).rows[0]).toEqual({ title: "Material selection: book the showroom appointment", owner: ids.designer });
      expect(await processDesignDeadlines(client, ids.workspaceId)).toMatchObject({ reminded: 1 });
      expect(await processDesignDeadlines(client, ids.workspaceId)).toMatchObject({ reminded: 0 });
      expect((await client.query(`SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND subject = 'Book the material selection · Maya Client'`, [ids.workspaceId])).rows[0].n).toBe(2);
      await service.scheduleMaterialSelection(actor, ids.workspaceId, ids.caseId, { version: await version("material_selection"), startsAt: "2031-04-09T09:00:00Z", endsAt: "2031-04-09T10:00:00Z", timezone: "Europe/London", address: "JG showroom" });
      expect((await stage(client, ids, "material_selection")).booking_reminder_at ?? null).toBeNull();
      expect((await client.query(`SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND subject = 'Material selection with Maya Client'`, [ids.workspaceId])).rows[0].n).toBe(2);
      await expect(service.skipStage(actor, ids.workspaceId, ids.caseId, "material_selection", { version: await version("material_selection"), note: " " })).rejects.toThrow(/why/);
      await expect(service.skipStage(actor, ids.workspaceId, ids.caseId, "approval", { version: await version("approval"), note: "x" })).rejects.toThrow(/Only a design stage/);
      const skipped = await service.skipStage(actor, ids.workspaceId, ids.caseId, "material_selection", { version: await version("material_selection"), note: "Client supplies all finishes" });
      expect(skipped.stages.find((row) => row.stage === "approval")?.status).toBe("active");

      // A new draft revision of a layout holds sign-off until it is approved again (concepts end with the client's choice).
      await client.query("INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,created_by,status) VALUES($1,$2,$3,$4,2,$5,$6,'draft')", [randomUUID(), ids.workspaceId, ids.caseId, layout, asset, user]);
      await client.query("INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,created_by,status) VALUES($1,$2,$3,$4,2,$5,$6,'approved')", [randomUUID(), ids.workspaceId, ids.caseId, living, asset, user]);
      const signing = async () => ({ version: await version("approval"), approvedOn: "2026-10-01", assetId: asset, signer: "Maya Client" });
      await expect(service.signOff(actor, ids.workspaceId, ids.caseId, await signing())).rejects.toThrow(/Waiting for approval: Ground floor layout/);
      await client.query("UPDATE pre_project_design_versions SET status='approved' WHERE workspace_id=$1 AND design_id=$2 AND number=2", [ids.workspaceId, layout]);
      const thread = randomUUID();
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO pre_project_design_threads(id,workspace_id,case_id,design_id,version_id,title,blocking,created_by) VALUES($1,$2,$3,$4,(SELECT id FROM pre_project_design_versions WHERE design_id=$4 AND number=2),'Island size',true,$5)", [thread, ids.workspaceId, ids.caseId, living, user]);
      await client.query("SET LOCAL session_replication_role = origin");
      await expect(service.signOff(actor, ids.workspaceId, ids.caseId, await signing())).rejects.toThrow(/open blocking comment/);
      await client.query("UPDATE pre_project_design_threads SET status='resolved' WHERE id=$1", [thread]);
      // PLM-053: the approval needs the day the client signed and the signed file.
      const approval = { version: await version("approval"), note: "Approved in the studio", approvedOn: "2026-10-01", assetId: asset, signer: "Maya Client" };
      await expect(service.signOff(actor, ids.workspaceId, ids.caseId, { ...approval, approvedOn: null })).rejects.toThrow(/day the client approved/);
      await expect(service.signOff(actor, ids.workspaceId, ids.caseId, { ...approval, approvedOn: "2099-01-01" })).rejects.toThrow(/future/);
      await expect(service.signOff(actor, ids.workspaceId, ids.caseId, { ...approval, assetId: randomUUID() })).rejects.toThrow(/signed approval/);
      await expect(service.signOff(actor, ids.workspaceId, ids.caseId, { ...approval, signer: "" })).rejects.toThrow(/who signed/);
      expect(await cases(client, ids.amUser).get(actor, ids.workspaceId, ids.caseId)).toMatchObject({ phase: "discover", designApprovedOn: null });
      const signed = await service.signOff(actor, ids.workspaceId, ids.caseId, approval);
      expect(signed.stages.every((row) => row.status === "done")).toBe(true);
      expect(signed.journey).toMatchObject({ approvedOn: "2026-10-01", approvalAssetName: "a.pdf", approvalSigner: "Maya Client", approvalMethod: "signed_document" });
      // The case read carries the approval day, so the case page and the Planning list read the case as priced next
      // (Quotation), whatever quotation the hand-off adds, instead of falling back to its first stage.
      expect(await cases(client, ids.amUser).get(actor, ids.workspaceId, ids.caseId)).toMatchObject({ designApprovedOn: "2026-10-01" });
      expect((await cases(client, ids.amUser).list(actor, ids.workspaceId, {} as never)).items.find((item: { id: string }) => item.id === ids.caseId))
        .toMatchObject({ designApprovedOn: "2026-10-01" });
      // PLM-053: no estimate yet and no commercial API here: the hand-off says where to prepare it.
      expect(signed.handoff).toEqual({ quoteId: null, problem: "Prepare the estimate from Quotations." });
      expect(Math.round((new Date(signed.journey!.estimateDueAt as Date).getTime() - Date.now()) / 86_400_000)).toBe(7);
      // The Account Manager and the Sales Admin hear it; the estimate's week runs from now.
      const told = (await client.query(`SELECT recipient_id, subject, deep_link FROM notifications WHERE workspace_id=$1 AND event_type='design.signed_off' AND channel='in_app' ORDER BY recipient_id`, [ids.workspaceId])).rows;
      expect(told).toEqual([ids.amUser, ids.qsUser].sort().map((recipient_id) => ({ recipient_id, subject: "Design approved · Maya Client", deep_link: `/workspace/pre-projects/cases/${ids.caseId}/quotations` })));
      await client.query(`UPDATE design_journeys SET estimate_due_at = now() - interval '1 hour' WHERE workspace_id = $1 AND case_id = $2`, [ids.workspaceId, ids.caseId]);
      expect(await processDesignDeadlines(client, ids.workspaceId)).toMatchObject({ estimates: 1 });
      expect(await processDesignDeadlines(client, ids.workspaceId)).toMatchObject({ estimates: 0 });
      expect((await client.query(`SELECT recipient_id FROM notifications WHERE workspace_id=$1 AND event_type='design.estimate_overdue' AND channel='in_app' ORDER BY recipient_id`, [ids.workspaceId])).rows.map((row) => row.recipient_id)).toEqual([ids.amUser, ids.qsUser].sort());
    });
  });

  it("runs a joinery order's site visit with the designer and the Account Manager, hands the measurements to the QS, and records materials as not required", async () => {
    await withCase(null, async (client, ids, service) => {
      const started = await service.start(actor, ids.workspaceId, ids.caseId);
      expect(started.journey).toMatchObject({ kind: "site_and_materials", packageName: null });
      expect(started.stages.map((row) => [row.stage, row.status])).toEqual([["site_visit", "active"], ["material_selection", "locked"]]);
      const visit = await stage(client, ids, "site_visit");
      expect(Math.round((visit.due_at.getTime() - Date.now()) / 3_600_000)).toBe(48);
      await service.scheduleSiteVisit(actor, ids.workspaceId, ids.caseId, { version: visit.version, startsAt: "2031-04-02T09:00:00Z", endsAt: "2031-04-02T10:30:00Z", timezone: "Europe/London", address: "Villa 12" });
      const appointment = (await client.query(`SELECT attendee_membership_ids AS members FROM crm_appointments WHERE workspace_id = $1 AND activity_id = $2`, [ids.workspaceId, visit.activity_id])).rows[0];
      expect(new Set(appointment.members)).toEqual(new Set([ids.designer, ids.am]));
      const room = randomUUID();
      await client.query(`INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Majlis')`, [room, ids.workspaceId, ids.caseId]);
      await client.query(`INSERT INTO pre_project_site_records(id,workspace_id,case_id,kind,room_id,title,status,version,content,created_by,updated_by) VALUES($1,$2,$3,'measurement',$4,'Majlis wall','measured',1,$5,$6,$6)`,
        [randomUUID(), ids.workspaceId, ids.caseId, room, JSON.stringify({ assetIds: [randomUUID()] }), ids.amUser]);
      const current = await stage(client, ids, "site_visit");
      const answered = await service.answerSiteVisit(actor, ids.workspaceId, ids.caseId, { version: current.version, answers: [{ key: "access", answer: "Ground floor" }, { key: "services", answer: "None affected" }] });
      // R5: the Access step nudges on a joinery order but never gates the visit; none were recorded here.
      expect((await client.query(`SELECT count(*)::int AS n FROM site_access_points WHERE workspace_id = $1 AND case_id = $2`, [ids.workspaceId, ids.caseId])).rows[0].n).toBe(0);
      const done = await service.completeSiteVisit(actor, ids.workspaceId, ids.caseId, { version: answered.stages[0].version, summary: "Walls measured for the TV unit" });
      expect(done.stages.map((row) => row.status)).toEqual(["done", "active"]);
      // PLM-080: the QS gets the measurements and photos to price.
      const qs = (await client.query(`SELECT subject, body, deep_link FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type = 'design.site_measured' AND channel = 'in_app'`, [ids.workspaceId, ids.qsUser])).rows;
      expect(qs).toEqual([{ subject: "Site measured · Maya Client", body: "Measurements and photos are in. 1 measurement sets, 1 files. Walls measured for the TV unit", deep_link: `/workspace/pre-projects/cases/${ids.caseId}/site` }]);
      // PLM-081: material selection is a step on every order; it can only be closed as not required, with who and when.
      const materials = done.stages[1];
      const closed = await service.materialsNotRequired(actor, ids.workspaceId, ids.caseId, { version: materials.version });
      expect(closed.stages[1]).toMatchObject({ status: "done", outcome: "not_required", note: "Not required for this order", completedByName: "Ops" });
      expect(closed.stages[1].completedAt).toBeInstanceOf(Date);
      await expect(service.materialsNotRequired(actor, ids.workspaceId, ids.caseId, { version: closed.stages[1].version })).rejects.toThrow(/not the current stage/);
    });
  });

  it("assigns the render task to the Visualiser once the material list is confirmed (PLM-051)", async () => {
    await withCase({ spacePlanning: false, renders: true }, async (client, ids, service) => {
      await service.start(actor, ids.workspaceId, ids.caseId);
      await client.query(`UPDATE design_journey_stages SET status = CASE WHEN stage IN ('inspiration','site_visit','concepts') THEN 'done' WHEN stage = 'material_selection' THEN 'active' ELSE status END,
        completed_at = CASE WHEN stage IN ('inspiration','site_visit','concepts') THEN now() END WHERE workspace_id = $1 AND case_id = $2`, [ids.workspaceId, ids.caseId]);
      const version = (await stage(client, ids, "material_selection")).version;
      const view = await service.skipStage(actor, ids.workspaceId, ids.caseId, "material_selection", { version, note: "Client-supplied finishes" });
      const renders = view.stages.find((row) => row.stage === "renders")!;
      expect(renders).toMatchObject({ status: "active", ownerName: "Vik Visualiser" });
      expect(Math.round((new Date(renders.dueAt as string).getTime() - Date.now()) / 86_400_000)).toBe(21);
      const task = (await client.query(`SELECT title, owner_membership_id AS owner FROM crm_activities WHERE workspace_id = $1 AND id = $2`, [ids.workspaceId, renders.activityId])).rows[0];
      expect(task).toEqual({ title: "3D renders from the confirmed material list", owner: ids.visualiser });
      const told = (await client.query(`SELECT recipient_id FROM notifications WHERE workspace_id = $1 AND subject = '3D renders · Maya Client' ORDER BY recipient_id`, [ids.workspaceId])).rows.map((row) => row.recipient_id);
      expect(told).toEqual([ids.amUser, ids.designerUser, ids.visualiserUser].sort());
    });
  });

  it("gives the 3D renders their own internal and client deadlines when the firm sets them (Palm: 5 weeks inside, 8 weeks for the client)", async () => {
    await withCase({ spacePlanning: false, renders: true }, async (client, ids, service) => {
      await client.query(`UPDATE workspace_design_settings SET render_internal_days = 35, render_client_days = 56 WHERE workspace_id = $1`, [ids.workspaceId]);
      await service.start(actor, ids.workspaceId, ids.caseId);
      await client.query(`UPDATE design_journey_stages SET status = CASE WHEN stage IN ('inspiration','site_visit','concepts') THEN 'done' WHEN stage = 'material_selection' THEN 'active' ELSE status END,
        completed_at = CASE WHEN stage IN ('inspiration','site_visit','concepts') THEN now() END WHERE workspace_id = $1 AND case_id = $2`, [ids.workspaceId, ids.caseId]);
      const view = await service.skipStage(actor, ids.workspaceId, ids.caseId, "material_selection", { version: (await stage(client, ids, "material_selection")).version, note: "Client-supplied finishes" });
      const renders = view.stages.find((row) => row.stage === "renders")!;
      const days = (at: unknown) => Math.round((new Date(at as string).getTime() - Date.now()) / 86_400_000);
      expect([days(renders.dueAt), days((renders as { clientDueAt?: unknown }).clientDueAt)]).toEqual([35, 56]);
      // The journey keeps its copy: changing the settings later doesn't move this client's deadlines.
      expect((await client.query(`SELECT render_internal_days AS internal, render_client_days AS client FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`,
        [ids.workspaceId, ids.caseId])).rows[0]).toEqual({ internal: 35, client: 56 });
    });
  });

  it("queues what's waiting on each person and tells the right people at each review step", async () => {
    await withCase({ spacePlanning: false, renders: false }, async (client, ids) => {
      const asset = randomUUID();
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,sha256,created_by) VALUES($1,$2,$3,'a.pdf','application/pdf',1,'k',repeat('a',64),$4)", [asset, ids.workspaceId, ids.caseId, ids.designerUser]);
      const make = async (title: string, status: string, reviewer: string | null, expires: string | null = null) => {
        const id = randomUUID(), version = randomUUID();
        await client.query("INSERT INTO pre_project_designs(id,workspace_id,case_id,title,document_type,stage,created_by) VALUES($1,$2,$3,$4,'concept','concepts',$5)", [id, ids.workspaceId, ids.caseId, title, ids.designerUser]);
        await client.query("INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,created_by,status,reviewer_id,client_review_expires_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9)", [version, ids.workspaceId, ids.caseId, id, asset, ids.designerUser, status, reviewer, expires]);
        return id;
      };
      await make("For the AM to review", "internal_review", ids.amUser);
      await make("Unassigned review", "internal_review", null);
      await make("With the client", "client_review", null, new Date(Date.now() + 86_400_000).toISOString());
      await make("Expired with client", "client_review", null, new Date(Date.now() - 86_400_000).toISOString());
      await make("Ready to present", "internal_approved", ids.amUser);
      await make("Sent back", "changes_requested", ids.amUser);
      await make("Still a draft", "draft", null);
      await client.query("SET LOCAL session_replication_role = origin");
      const titles = async (user: string, can: { review: boolean; recordClient: boolean }) => (await designQueue(client, ids.workspaceId, user, can)).map((item) => `${item.title}:${item.step}`).sort();
      expect(await titles(ids.amUser, { review: true, recordClient: true })).toEqual(["For the AM to review:review", "Unassigned review:review", "With the client:record_client"].sort());
      expect(await titles(ids.amUser, { review: false, recordClient: false })).toEqual(["For the AM to review:review"]);
      expect(await titles(ids.designerUser, { review: false, recordClient: false })).toEqual(["Ready to present:present", "Sent back:revise"].sort());

      const step = (action: string, fromStatus: string, actorUserId: string | null) => noticeDesignStep(client, { workspaceId: ids.workspaceId, caseId: ids.caseId, designId: randomUUID(), title: "Kitchen concept", action, fromStatus, actorUserId, reviewerUserId: ids.amUser, uploaderUserId: ids.designerUser, note: "Make the island longer", activityId: randomUUID() });
      await step("internal_review", "draft", ids.designerUser);
      await step("changes_requested", "internal_review", ids.amUser);
      await step("approved", "client_review", null);
      await step("internal_review", "draft", ids.amUser); // the reviewer sending their own file is told nothing
      const inbox = (await client.query(`SELECT recipient_id, subject, channel FROM notifications WHERE workspace_id = $1 AND event_type LIKE 'design.%' AND event_type NOT LIKE 'design.stage%' ORDER BY subject, channel`, [ids.workspaceId])).rows;
      expect(inbox).toEqual(expect.arrayContaining([
        { recipient_id: ids.amUser, subject: "Review Kitchen concept · Maya Client", channel: "in_app" },
        { recipient_id: ids.amUser, subject: "Please review: Kitchen concept (Maya Client)", channel: "email" },
        { recipient_id: ids.designerUser, subject: "Changes needed: Kitchen concept", channel: "in_app" },
        { recipient_id: ids.designerUser, subject: "Maya Client approved Kitchen concept", channel: "in_app" },
        { recipient_id: ids.amUser, subject: "Maya Client approved Kitchen concept", channel: "in_app" },
      ]));
      expect(inbox.filter((row) => row.subject.startsWith("Review Kitchen")).length).toBe(1);
    });
  });
});
