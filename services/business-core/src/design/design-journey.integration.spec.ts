import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { DesignJourneyService } from "./design-journey.service";
import { processDesignDeadlines, startInspirationTimer, startJourney } from "./design-journey.store";
import { syncDesignStages } from "./design-stage-sync";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
type Ids = { workspaceId: string; caseId: string; designer: string; am: string; designerUser: string; amUser: string };

integration("design journey (PLM-047, PLM-048, PLM-044)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withCase(pkg: { spacePlanning: boolean; renders: boolean }, work: (client: PoolClient, ids: Ids, service: DesignJourneyService) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), partyId = randomUUID(), opportunityId = randomUUID(), caseId = randomUUID(), packageId = randomUUID();
    const amUser = randomUUID(), designerUser = randomUUID(), opsUser = randomUUID(), am = randomUUID(), designer = randomUUID();
    try {
      await client.query("BEGIN");
      for (const [id, name] of [[amUser, "Aisha AM"], [designerUser, "Dana Designer"], [opsUser, "Ops"]])
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${id.slice(0, 8)}@example.com`, name]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Europe/London',$3)", [workspaceId, `dj-${workspaceId.slice(0, 8)}`, amUser]);
      for (const [id, user] of [[am, amUser], [designer, designerUser]]) await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [id, workspaceId, user]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [partyId, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, partyId, randomUUID(), randomUUID(), am]);
      await client.query("INSERT INTO crm_opportunity_designer(workspace_id,opportunity_id,membership_id) VALUES($1,$2,$3)", [workspaceId, opportunityId, designer]);
      await client.query("INSERT INTO design_packages(id,workspace_id,code,name,pricing_method,rate,currency,area_unit,includes_space_planning,includes_renders,included_revisions) VALUES($1,$2,'bespoke','Bespoke','per_area',40,'AED','sqft',$3,$4,2)", [packageId, workspaceId, pkg.spacePlanning, pkg.renders]);
      await client.query("INSERT INTO crm_opportunity_discovery(workspace_id,opportunity_id,design_package_id) VALUES($1,$2,$3)", [workspaceId, opportunityId, packageId]);
      await client.query("INSERT INTO workspace_design_settings(workspace_id,inspiration_days,site_visit_hours) VALUES($1,5,48)", [workspaceId]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, opsUser]);
      await seedDefaultNotificationTemplates(client, workspaceId);
      await client.query("SET LOCAL session_replication_role = origin");
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: opsUser });
      const service = new DesignJourneyService({ withPermission: run, withPermissions: run, hasPermission: async () => true } as never);
      await work(client, { workspaceId, caseId, designer, am, designerUser, amUser }, service);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
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
      const done = await service.completeSiteVisit(actor, ids.workspaceId, ids.caseId, { version: current.version, summary: "All walls measured" });
      expect(done.stages.slice(0, 3).map((row) => row.status)).toEqual(["done", "done", "active"]);
      expect((await client.query(`SELECT status FROM crm_activities WHERE workspace_id = $1 AND id = $2`, [ids.workspaceId, visit.activity_id])).rows[0].status).toBe("completed");
    });
  });

  it("ends a lapsed inspiration week and alerts once when a stage runs late", async () => {
    await withCase({ spacePlanning: false, renders: false }, async (client, ids) => {
      await startJourney(client, ids.workspaceId, ids.caseId, ids.amUser);
      expect((await client.query(`SELECT count(*)::int AS n FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2`, [ids.workspaceId, ids.caseId])).rows[0].n).toBe(5);
      await client.query(`UPDATE design_journey_stages SET due_at = now() - interval '1 minute' WHERE workspace_id = $1 AND case_id = $2 AND stage = 'inspiration'`, [ids.workspaceId, ids.caseId]);
      expect(await processDesignDeadlines(client, ids.workspaceId)).toEqual({ closed: 1, alerted: 0 });
      expect((await stage(client, ids, "site_visit")).status).toBe("active");

      await client.query(`UPDATE design_journey_stages SET due_at = now() - interval '1 hour' WHERE workspace_id = $1 AND case_id = $2 AND stage = 'site_visit'`, [ids.workspaceId, ids.caseId]);
      expect(await processDesignDeadlines(client, ids.workspaceId)).toEqual({ closed: 0, alerted: 1 });
      expect(await processDesignDeadlines(client, ids.workspaceId)).toEqual({ closed: 0, alerted: 0 });
      const overdue = (await client.query(`SELECT recipient_id, channel FROM notifications WHERE workspace_id = $1 AND subject LIKE 'Site visit is overdue%' ORDER BY channel`, [ids.workspaceId])).rows;
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
      await design("space_planning", "Ground floor layout", "approved");
      await client.query("SET LOCAL session_replication_role = origin");
      const statuses = async () => Object.fromEntries((await client.query(`SELECT stage, status FROM design_journey_stages WHERE workspace_id=$1 AND case_id=$2`, [ids.workspaceId, ids.caseId])).rows.map((row) => [row.stage, row.status]));

      expect(await syncDesignStages(client, ids.workspaceId, ids.caseId, user)).toEqual([]);
      await approve(kitchen);
      // Concepts completes, and space planning (approved ahead of time) completes as soon as it opens.
      expect(await syncDesignStages(client, ids.workspaceId, ids.caseId, user)).toEqual(["concepts", "space_planning"]);
      expect(await statuses()).toMatchObject({ concepts: "done", space_planning: "done", material_selection: "active", approval: "locked" });
      expect(await statuses()).not.toHaveProperty("renders");

      const version = async (stage: string) => (await client.query(`SELECT version FROM design_journey_stages WHERE workspace_id=$1 AND case_id=$2 AND stage=$3`, [ids.workspaceId, ids.caseId, stage])).rows[0].version;
      await expect(service.skipStage(actor, ids.workspaceId, ids.caseId, "material_selection", { version: await version("material_selection"), note: " " })).rejects.toThrow(/why/);
      await expect(service.skipStage(actor, ids.workspaceId, ids.caseId, "approval", { version: await version("approval"), note: "x" })).rejects.toThrow(/Only a design stage/);
      const skipped = await service.skipStage(actor, ids.workspaceId, ids.caseId, "material_selection", { version: await version("material_selection"), note: "Client supplies all finishes" });
      expect(skipped.stages.find((row) => row.stage === "approval")?.status).toBe("active");

      // A new draft revision of a concept holds sign-off until it is approved again.
      await client.query("INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,created_by,status) VALUES($1,$2,$3,$4,2,$5,$6,'draft')", [randomUUID(), ids.workspaceId, ids.caseId, living, asset, user]);
      await expect(service.signOff(actor, ids.workspaceId, ids.caseId, { version: await version("approval") })).rejects.toThrow(/Waiting for approval: Living concept/);
      await client.query("UPDATE pre_project_design_versions SET status='approved' WHERE workspace_id=$1 AND design_id=$2 AND number=2", [ids.workspaceId, living]);
      const thread = randomUUID();
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO pre_project_design_threads(id,workspace_id,case_id,design_id,version_id,title,blocking,created_by) VALUES($1,$2,$3,$4,(SELECT id FROM pre_project_design_versions WHERE design_id=$4 AND number=2),'Island size',true,$5)", [thread, ids.workspaceId, ids.caseId, living, user]);
      await client.query("SET LOCAL session_replication_role = origin");
      await expect(service.signOff(actor, ids.workspaceId, ids.caseId, { version: await version("approval") })).rejects.toThrow(/open blocking comment/);
      await client.query("UPDATE pre_project_design_threads SET status='resolved' WHERE id=$1", [thread]);
      const signed = await service.signOff(actor, ids.workspaceId, ids.caseId, { version: await version("approval"), note: "Approved in the studio" });
      expect(signed.stages.every((row) => row.status === "done")).toBe(true);
      const told = (await client.query(`SELECT recipient_id, subject, deep_link FROM notifications WHERE workspace_id=$1 AND event_type='design.signed_off' AND channel='in_app'`, [ids.workspaceId])).rows;
      expect(told).toEqual([{ recipient_id: ids.amUser, subject: "Design signed off · Maya Client", deep_link: `/workspace/pre-projects/cases/${ids.caseId}/quotations` }]);
    });
  });
});
