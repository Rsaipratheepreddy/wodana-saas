import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../../notifications/default-templates";
import { OpportunityDiscoveryService } from "./discovery.service";
import { IntroMeetingService } from "./intro-meeting.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Ids = { workspaceId: string; opportunityId: string; amMembership: string; designerA: string; designerB: string; designerAUser: string; amUser: string };

integration("intro meeting and dedicated designer (PLM-043, PLM-088)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withOpportunity(work: (client: PoolClient, ids: Ids, service: IntroMeetingService, admin: { value: boolean }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), partyId = randomUUID(), enquiryId = randomUUID(), leadId = randomUUID(), opportunityId = randomUUID(), floorPlanId = randomUUID();
    const amUser = randomUUID(), designerAUser = randomUUID(), designerBUser = randomUUID();
    const amMembership = randomUUID(), designerA = randomUUID(), designerB = randomUUID();
    const admin = { value: false };
    try {
      await client.query("BEGIN");
      for (const [id, name] of [[amUser, "Aisha AM"], [designerAUser, "Dana Designer"], [designerBUser, "Omar Designer"]])
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${id.slice(0, 8)}@example.com`, name]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio One',$2,'AED','Europe/London',$3)", [workspaceId, `intro-${workspaceId.slice(0, 8)}`, amUser]);
      for (const [id, user] of [[amMembership, amUser], [designerA, designerAUser], [designerB, designerBUser]])
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [id, workspaceId, user]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [partyId, workspaceId]);
      await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
        VALUES($1,$2,$3,$4,'Villa','referral','external',now(),'E-1','fit_out','{"customerType":"homeowner"}')`, [enquiryId, workspaceId, randomUUID(), partyId]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id) VALUES($1,$2,$3,$4)", [leadId, workspaceId, enquiryId, partyId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, partyId, leadId, randomUUID(), randomUUID(), amMembership]);
      await client.query("INSERT INTO crm_lead_qualification_values(workspace_id,lead_id,question_key,value) VALUES($1,$2,$3,$4)", [workspaceId, leadId, `requirement_asset_${floorPlanId}`, JSON.stringify({ id: floorPlanId, name: "plan.pdf", mimeType: "application/pdf" })]);
      await seedDefaultNotificationTemplates(client, workspaceId);
      await client.query("SET LOCAL session_replication_role = origin");
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: amUser });
      const access = { withPermission: run, withPermissions: run, hasPermission: async () => admin.value } as never;
      const discovery = new OpportunityDiscoveryService(access);
      const service = new IntroMeetingService(access, { record: async () => randomUUID() } as never, discovery);
      await work(client, { workspaceId, opportunityId, amMembership, designerA, designerB, designerAUser, amUser }, service, admin);
      void floorPlanId;
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  const slot = (day: number, hour = 9) => ({ startsAt: `2031-03-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`, endsAt: `2031-03-${String(day).padStart(2, "0")}T${String(hour + 1).padStart(2, "0")}:00:00Z`, timezone: "Europe/London" });

  it("waits for discovery, books into the designer's calendar, invites both and sets the designer", async () => {
    await withOpportunity(async (client, ids, service) => {
      const before = await service.get(actor, ids.workspaceId, ids.opportunityId);
      expect(before.blockers.map((item) => item.key)).toEqual(["floorPlan", "area", "clientEmail"]);
      expect(before.timezone).toBe("Europe/London");
      await expect(service.book(actor, ids.workspaceId, ids.opportunityId, { designerMembershipId: ids.designerA, mode: "in_person", ...slot(3) })).rejects.toThrow(/Discovery first: Floor plan, Area, Client email/);

      const plan = (await client.query(`SELECT value->>'id' AS id FROM crm_lead_qualification_values WHERE workspace_id = $1`, [ids.workspaceId])).rows[0].id;
      await client.query(`INSERT INTO crm_opportunity_discovery(workspace_id,opportunity_id,area,area_unit,client_email,floor_plan_asset_id) VALUES($1,$2,120,'sqm','maya@example.com',$3)`, [ids.workspaceId, ids.opportunityId, plan]);

      const booked = await service.book(actor, ids.workspaceId, ids.opportunityId, { designerMembershipId: ids.designerA, mode: "online", place: "https://meet.example.com/abc", ...slot(3) });
      expect(booked.designer).toMatchObject({ membershipId: ids.designerA, name: "Dana Designer" });
      expect(booked.intro).toMatchObject({ title: "Intro to Studio One", status: "pending", timezone: "Europe/London", location: { mode: "online", url: "https://meet.example.com/abc" } });
      const appointment = (await client.query(`SELECT attendee_membership_ids AS members FROM crm_appointments WHERE workspace_id = $1 AND activity_id = $2`, [ids.workspaceId, booked.intro!.activityId])).rows[0];
      expect(new Set(appointment.members)).toEqual(new Set([ids.designerA, ids.amMembership]));
      const owner = (await client.query(`SELECT owner_membership_id FROM crm_activities WHERE workspace_id = $1 AND id = $2`, [ids.workspaceId, booked.intro!.activityId])).rows[0];
      expect(owner.owner_membership_id).toBe(ids.designerA);
      const team = (await client.query(`SELECT membership_id FROM crm_opportunity_team WHERE workspace_id = $1 AND opportunity_id = $2 AND role = 'designer'`, [ids.workspaceId, ids.opportunityId])).rows;
      expect(team.map((row) => row.membership_id)).toEqual([ids.designerA]);
      // the designer is told (the booking AM is not notified about their own action)
      const notices = (await client.query(`SELECT recipient_id, channel FROM notifications WHERE workspace_id = $1 ORDER BY channel`, [ids.workspaceId])).rows;
      expect(notices).toEqual([{ recipient_id: ids.designerAUser, channel: "email" }, { recipient_id: ids.designerAUser, channel: "in_app" }]);

      await expect(service.book(actor, ids.workspaceId, ids.opportunityId, { designerMembershipId: ids.designerA, mode: "in_person", ...slot(4) })).rejects.toThrow(/already booked/);
    });
  });

  it("§0.3 P0: booking the intro moves the card to Intro booked, recorded like any stage move", async () => {
    await withOpportunity(async (client, ids, service) => {
      const pipeline = randomUUID(), first = randomUUID(), intro = randomUUID(), qualified = randomUUID();
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [pipeline, ids.workspaceId]);
      await client.query(`INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position,probability) VALUES
        ($1,$4,$5,'qualified','New Opportunity',1,20),($2,$4,$5,'intro_booked','Intro booked',2,25),($3,$4,$5,'qualification','Qualified',3,35)`, [first, intro, qualified, ids.workspaceId, pipeline]);
      await client.query("UPDATE crm_opportunities SET pipeline_id = $3, stage_id = $4 WHERE workspace_id = $1 AND id = $2", [ids.workspaceId, ids.opportunityId, pipeline, first]);
      const plan = (await client.query(`SELECT value->>'id' AS id FROM crm_lead_qualification_values WHERE workspace_id = $1`, [ids.workspaceId])).rows[0].id;
      await client.query(`INSERT INTO crm_opportunity_discovery(workspace_id,opportunity_id,area,area_unit,client_email,floor_plan_asset_id) VALUES($1,$2,120,'sqm','maya@example.com',$3)`, [ids.workspaceId, ids.opportunityId, plan]);
      await client.query("SET LOCAL session_replication_role = origin");
      const versionBefore = Number((await client.query("SELECT version FROM crm_opportunities WHERE id = $1", [ids.opportunityId])).rows[0].version);
      await service.book(actor, ids.workspaceId, ids.opportunityId, { designerMembershipId: ids.designerA, mode: "in_person", ...slot(3) });
      const after = (await client.query("SELECT stage_id, probability::int AS probability, version FROM crm_opportunities WHERE id = $1", [ids.opportunityId])).rows[0];
      expect(after).toMatchObject({ stage_id: intro, probability: 25, version: versionBefore + 1 });
      expect((await client.query("SELECT from_stage_id, to_stage_id, reason FROM crm_stage_history WHERE opportunity_id = $1", [ids.opportunityId])).rows)
        .toEqual([{ from_stage_id: first, to_stage_id: intro, reason: "Intro booked" }]);
      expect(Number((await client.query("SELECT count(*) FROM crm_forecast_snapshots WHERE opportunity_id = $1 AND snapshot_reason = 'stage_changed'", [ids.opportunityId])).rows[0].count)).toBe(1);
    });
  });

  it("PLM-155: names what the enquiry still needs (marked as the enquiry's), and a Discovery email counts though the enquiry form left it empty", async () => {
    await withOpportunity(async (client, ids, service) => {
      // The firm requires the area and the client's target completion before the intro (Palm); the email too (the default).
      await client.query(`INSERT INTO crm_enquiry_requirements(workspace_id,enquiry_type,field_key,required_at) VALUES($1,'fit_out','area','book_intro'),($1,'fit_out','targetCompletion','book_intro'),($1,'fit_out','email','book_intro')`, [ids.workspaceId]);
      // The enquiry form saves an email it wasn't given as "".
      const enquiry = async (patch: string) => {
        await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: the enquiry's intake event isn't seeded
        await client.query(`UPDATE crm_enquiries SET details = details || $2::jsonb WHERE workspace_id = $1`, [ids.workspaceId, patch]);
        await client.query("SET LOCAL session_replication_role = origin");
      };
      await enquiry('{"contact":{"email":""}}');
      const plan = (await client.query(`SELECT value->>'id' AS id FROM crm_lead_qualification_values WHERE workspace_id = $1`, [ids.workspaceId])).rows[0].id;
      await client.query(`INSERT INTO crm_opportunity_discovery(workspace_id,opportunity_id,area,area_unit,client_email,floor_plan_asset_id) VALUES($1,$2,120,'sqm','maya@example.com',$3)`, [ids.workspaceId, ids.opportunityId, plan]);
      const before = await service.get(actor, ids.workspaceId, ids.opportunityId);
      expect(before.blockers).toEqual([
        { key: "area", label: "Enter the area", where: "enquiry" },
        { key: "targetCompletion", label: "Enter the client's target completion date", where: "enquiry" },
      ]);
      const refused = await service.book(actor, ids.workspaceId, ids.opportunityId, { designerMembershipId: ids.designerA, mode: "in_person", ...slot(3) }).catch((error) => error as { message: string; response?: { missing?: unknown[] } });
      expect(refused.message).toBe("Complete the enquiry: Enter the area, Enter the client's target completion date");
      expect(refused.response?.missing).toEqual(before.blockers);
      await enquiry('{"area":"Arabian Ranches","targetCompletion":"2027-01-15"}');
      expect((await service.get(actor, ids.workspaceId, ids.opportunityId)).blockers).toEqual([]);
    });
  });

  it("refuses a clash in the designer's calendar", async () => {
    await withOpportunity(async (client, ids, service) => {
      const plan = (await client.query(`SELECT value->>'id' AS id FROM crm_lead_qualification_values WHERE workspace_id = $1`, [ids.workspaceId])).rows[0].id;
      await client.query(`INSERT INTO crm_opportunity_discovery(workspace_id,opportunity_id,area,area_unit,client_email,floor_plan_asset_id) VALUES($1,$2,120,'sqm','maya@example.com',$3)`, [ids.workspaceId, ids.opportunityId, plan]);
      const other = (await client.query(`INSERT INTO crm_activities(workspace_id,opportunity_id,type,title,owner_membership_id,due_at) VALUES($1,$4,'meeting','Site visit',$2,$3) RETURNING id`, [ids.workspaceId, ids.designerA, slot(5).startsAt, ids.opportunityId])).rows[0].id;
      await client.query(`INSERT INTO crm_appointments(workspace_id,activity_id,starts_at,ends_at,timezone) VALUES($1,$2,$3,$4,'Europe/London')`, [ids.workspaceId, other, slot(5).startsAt, slot(5).endsAt]);
      await expect(service.book(actor, ids.workspaceId, ids.opportunityId, { designerMembershipId: ids.designerA, mode: "in_person", startsAt: "2031-03-05T09:30:00Z", endsAt: "2031-03-05T10:30:00Z", timezone: "Europe/London" })).rejects.toThrow(/busy then \(Site visit\)/);
    });
  });

  it("changes the designer only with a reason and a CRM owner or admin", async () => {
    await withOpportunity(async (client, ids, service, admin) => {
      const first = await service.changeDesigner(actor, ids.workspaceId, ids.opportunityId, { membershipId: ids.designerA, reason: "", version: 0 });
      expect(first.designer?.membershipId).toBe(ids.designerA);
      await expect(service.changeDesigner(actor, ids.workspaceId, ids.opportunityId, { membershipId: ids.designerB, reason: "Client asked", version: 1 })).rejects.toThrow(/CRM owner or admin/);
      admin.value = true;
      const caseId = (await client.query(`INSERT INTO pre_project_cases(workspace_id,opportunity_id,created_by) VALUES($1,$2,$3) RETURNING id`, [ids.workspaceId, ids.opportunityId, ids.amUser])).rows[0].id;
      await expect(service.changeDesigner(actor, ids.workspaceId, ids.opportunityId, { membershipId: ids.designerB, reason: " ", version: 1 })).rejects.toThrow(/reason/);
      await expect(service.changeDesigner(actor, ids.workspaceId, ids.opportunityId, { membershipId: ids.designerB, reason: "Client asked", version: 0 })).rejects.toThrow(/another window/);
      const changed = await service.changeDesigner(actor, ids.workspaceId, ids.opportunityId, { membershipId: ids.designerB, reason: "Client asked", version: 1 });
      expect(changed.designer).toMatchObject({ membershipId: ids.designerB, name: "Omar Designer", version: 2 });
      expect(changed.history.map((entry: { toName: string; reason: string | null }) => [entry.toName, entry.reason])).toEqual([["Omar Designer", "Client asked"], ["Dana Designer", null]]);
      const team = (await client.query(`SELECT membership_id FROM crm_opportunity_team WHERE workspace_id = $1 AND opportunity_id = $2 AND role = 'designer'`, [ids.workspaceId, ids.opportunityId])).rows;
      expect(team.map((row) => row.membership_id)).toEqual([ids.designerB]);
      // the open Design & Planning case gets the new designer
      const caseTeam = (await client.query(`SELECT membership_id FROM project_assignments WHERE workspace_id = $1 AND case_id = $2 AND active`, [ids.workspaceId, caseId])).rows;
      expect(caseTeam.map((row) => row.membership_id)).toContain(ids.designerB);
    });
  });
});
