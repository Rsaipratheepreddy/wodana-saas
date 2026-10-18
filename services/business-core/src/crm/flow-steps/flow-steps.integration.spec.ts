import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DesignJourneyService } from "../../design/design-journey.service";
import { PreProjectsService } from "../../pre-projects/pre-projects.service";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmFlowsService } from "../flows/crm-flows.service";
import { flowChecksum, type FlowDefinition } from "../flows/flow-definition";
import { flowTemplate } from "../flows/flow-templates";
import { CrmOpportunitiesService } from "../opportunities/crm-opportunities.service";
import { OpportunityDiscoveryService } from "../opportunities/discovery.service";
import { IntroMeetingService } from "../opportunities/intro-meeting.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { FlowMigrationService } from "./flow-migration.service";
import { SiteVisitBookingService } from "./site-visit-booking.service";
import { StepSkipsService } from "./step-skips.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Tenant = { workspaceId: string; admin: string; sales: string; designer: string; viewer: string; salesMember: string; designerMember: string;
  flowId: string; v1: string; opportunityId: string; pipelineId: string };
type Services = { skips: StepSkipsService; migration: FlowMigrationService; siteVisits: SiteVisitBookingService; flows: CrmFlowsService };

/**
 * A job's steps against the real database, every command as the app role under forced RLS with the real permission
 * checks: E2-3 (a running job keeps its version; moving it is explicit), E2-5 / PLM-081 (a step marked not needed,
 * with a reason) and PLM-080 / PLM-044 (the joinery site visit in time both people have free).
 */
integration("a job's steps (plan §5a, §7a E2; PLM-044/080/081)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  const definition = (): FlowDefinition => structuredClone(flowTemplate("fit_out_joinery")!.definition);

  async function tenant(client: PoolClient): Promise<Tenant> {
    const workspaceId = randomUUID(), admin = randomUUID(), sales = randomUUID(), designer = randomUUID(), viewer = randomUUID();
    const [adminMember, salesMember, designerMember, viewerMember] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const [adminRole, salesRole, viewerRole] = [randomUUID(), randomUUID(), randomUUID()];
    const taxonomyId = randomUUID(), optionId = randomUUID(), flowId = randomUUID(), v1 = randomUUID(), pipelineId = randomUUID(), partyId = randomUUID();
    await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Admin'),($3,$4,'Sara Sales'),($5,$6,'Dana Designer'),($7,$8,'Vic Viewer')",
      [admin, `a-${admin}@example.com`, sales, `s-${sales}@example.com`, designer, `d-${designer}@example.com`, viewer, `v-${viewer}@example.com`]);
    await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
    await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,default_locale,created_by) VALUES($1,'Steps',$2,'GBP','Europe/London','en-GB',$3)",
      [workspaceId, `steps-${workspaceId.slice(0, 8)}`, admin]);
    await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$5,$6,'active'),($2,$5,$7,'active'),($3,$5,$8,'active'),($4,$5,$9,'active')",
      [adminMember, salesMember, designerMember, viewerMember, workspaceId, admin, sales, designer, viewer]);
    await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$4,'administrator','Administrator',true),($2,$4,'sales','Sales',false),($3,$4,'viewer','Viewer',false)",
      [adminRole, salesRole, viewerRole, workspaceId]);
    await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions", [workspaceId, adminRole]);
    await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])",
      [workspaceId, salesRole, ["crm.opportunities.view", "crm.opportunities.manage", "crm.activities.view", "crm.activities.manage", "crm.leads.view"]]);
    await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])",
      [workspaceId, viewerRole, ["crm.opportunities.view"]]);
    await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3),($1,$4,$5),($1,$6,$5),($1,$7,$8)",
      [workspaceId, adminMember, adminRole, salesMember, salesRole, designerMember, viewerMember, viewerRole]);
    await client.query("INSERT INTO crm_taxonomies(id,workspace_id,code,name) VALUES($1,$2,'enquiry_type','Enquiry types')", [taxonomyId, workspaceId]);
    await client.query("INSERT INTO crm_taxonomy_options(id,workspace_id,taxonomy_id,code,label,flow) VALUES($1,$2,$3,'joinery','Joinery','joinery')", [optionId, workspaceId, taxonomyId]);
    await client.query("INSERT INTO crm_flows(id,workspace_id,code,name,enquiry_type_option_id) VALUES($1,$2,'joinery','Joinery',$3)", [flowId, workspaceId, optionId]);
    await client.query("INSERT INTO crm_flow_versions(id,workspace_id,flow_id,version,definition,checksum,source,published_by) VALUES($1,$2,$3,1,$4::jsonb,$5,'published',$6)",
      [v1, workspaceId, flowId, JSON.stringify(definition()), flowChecksum(definition()), admin]);
    await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name,is_default) VALUES($1,$2,'sales','Sales',true)", [pipelineId, workspaceId]);
    for (const [index, code] of ["qualified", "qualification", "proposal", "negotiation", "won", "lost"].entries())
      await client.query("INSERT INTO crm_pipeline_stages(workspace_id,pipeline_id,code,name,position,probability) VALUES($1,$2,$3,$3,$4,10)", [workspaceId, pipelineId, code, index + 1]);
    await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya','maya')", [partyId, workspaceId]);
    const enquiryId = randomUUID(), leadId = randomUUID(), opportunityId = randomUUID();
    await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
      VALUES($1,$2,$3,$4,'Kitchen joinery','referral','external',now(),'E-1','joinery','{"customerType":"end_user"}')`, [enquiryId, workspaceId, randomUUID(), partyId]);
    await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id) VALUES($1,$2,$3,$4)", [leadId, workspaceId, enquiryId, partyId]);
    await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,title,reference,next_action_at,owner_membership_id,
        conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
      VALUES($1,$2,$3,$4,$5,(SELECT id FROM crm_pipeline_stages WHERE pipeline_id = $5 AND code = 'qualified'),'Kitchen joinery','O-1',now() + interval '1 day',$6,
        'lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, partyId, leadId, pipelineId, salesMember]);
    await client.query("SET LOCAL session_replication_role = origin");
    return { workspaceId, admin, sales, designer, viewer, salesMember, designerMember, flowId, v1, opportunityId, pipelineId };
  }

  async function scenario(work: (client: PoolClient, as: (userId: string) => Services, home: Tenant, other: Tenant) => Promise<void>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const home = await tenant(client);
      const other = await tenant(client);
      // Every command runs as the app role inside its own savepoint, like a tenant transaction.
      const database = {
        tenantTransaction: async (ws: string, actorUserId: string, fn: (c: PoolClient) => Promise<unknown>) => {
          await client.query("SAVEPOINT tenant");
          try {
            await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [ws, actorUserId]);
            await client.query("SET LOCAL ROLE wodana_app");
            const result = await fn(client);
            await client.query("RESET ROLE");
            await client.query("RELEASE SAVEPOINT tenant");
            return result;
          } catch (error) {
            await client.query("ROLLBACK TO SAVEPOINT tenant");
            await client.query("RESET ROLE");
            throw error;
          }
        },
      };
      const as = (userId: string): Services => {
        const access = new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId }) } as never);
        const events = new CrmEventsService();
        const discovery = new OpportunityDiscoveryService(access);
        const journey = new DesignJourneyService(access);
        return {
          skips: new StepSkipsService(access, discovery, journey),
          migration: new FlowMigrationService(access, discovery),
          siteVisits: new SiteVisitBookingService(access, discovery, new PreProjectsService(access, events, new CrmOpportunitiesService(access, events)), journey, new IntroMeetingService(access, events, discovery)),
          flows: new CrmFlowsService(access),
        };
      };
      await work(client, as, home, other);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  const job = async (client: PoolClient, id: string) =>
    (await client.query<{ version: number; flowVersionId: string | null }>(`SELECT version, flow_version_id AS "flowVersionId" FROM crm_opportunities WHERE id = $1`, [id])).rows[0];
  const audits = async (client: PoolClient, workspaceId: string, action: string) =>
    Number((await client.query("SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action = $2", [workspaceId, action])).rows[0].count);

  it("E2-3: a running job keeps its version when the type's steps change; moving it is explicit, previewed, version-checked and idempotent", async () => {
    await scenario(async (client, as, home, other) => {
      const admin = as(home.admin);
      await admin.siteVisits.view(actor, home.workspaceId, home.opportunityId); // the job reads its steps: it pins version 1
      expect((await job(client, home.opportunityId)).flowVersionId).toBe(home.v1);

      const next = definition();
      next.steps.unshift({ key: "contact", name: "Log the first contact", role: "sales", check: "contact_logged", column: "qualified" });
      next.steps = next.steps.filter((step) => step.key !== "first_contact");
      const published = await admin.flows.publish(actor, home.workspaceId, home.flowId, { expectedVersion: 1, definition: next });
      expect(published.version).toBe(2);
      await admin.siteVisits.view(actor, home.workspaceId, home.opportunityId);
      expect((await job(client, home.opportunityId)).flowVersionId).toBe(home.v1);

      const preview = await admin.migration.preview(actor, home.workspaceId, home.flowId);
      expect(preview).toMatchObject({ toVersion: 2, truncated: false });
      expect(preview.jobs).toHaveLength(1);
      expect(preview.jobs[0]).toMatchObject({ opportunityId: home.opportunityId, fromVersion: 1, changed: true, added: [{ key: "contact" }] });
      expect(preview.jobs[0].newlyMissing.map((item) => item.stepKey)).toContain("contact");

      await expect(as(home.sales).migration.preview(actor, home.workspaceId, home.flowId)).rejects.toThrow("Permissions required: crm.settings.manage");
      await expect(admin.migration.migrate(actor, home.workspaceId, home.flowId, { toVersion: 1, opportunityIds: [home.opportunityId] })).rejects.toThrow("These steps changed in another window");
      const before = await job(client, home.opportunityId);
      const moved = await admin.migration.migrate(actor, home.workspaceId, home.flowId, { toVersion: 2, opportunityIds: [home.opportunityId] });
      expect(moved).toMatchObject({ toVersion: 2, moved: [home.opportunityId], unchanged: [], skipped: [] });
      const after = await job(client, home.opportunityId);
      expect(after.flowVersionId).toBe(published.id);
      expect(after.version).toBe(before.version + 1);
      expect(await audits(client, home.workspaceId, "crm.opportunity.flow_migrated.v1")).toBe(1);
      const audit = (await client.query("SELECT after FROM audit_events WHERE workspace_id = $1 AND action = 'crm.opportunity.flow_migrated.v1'", [home.workspaceId])).rows[0].after;
      expect(audit).toMatchObject({ version: 2, reason: "Moved to version 2" });

      // The same move sent again changes nothing.
      expect(await admin.migration.migrate(actor, home.workspaceId, home.flowId, { toVersion: 2, opportunityIds: [home.opportunityId] })).toMatchObject({ moved: [], unchanged: [home.opportunityId] });
      expect(await audits(client, home.workspaceId, "crm.opportunity.flow_migrated.v1")).toBe(1);

      // Another tenant sees neither the flow nor the job.
      await expect(as(other.admin).migration.preview(actor, other.workspaceId, home.flowId)).rejects.toThrow("Flow not found");
      expect(await as(other.admin).migration.migrate(actor, other.workspaceId, other.flowId, { toVersion: 1, opportunityIds: [home.opportunityId] }))
        .toMatchObject({ moved: [], skipped: [{ opportunityId: home.opportunityId, reason: "Not found" }] });
    });
  });

  it("E2-5 / PLM-081: material selection is marked Not required for this order with a reason; required steps and the proof never are", async () => {
    await scenario(async (client, as, home, other) => {
      const sales = as(home.sales);
      const version = async () => (await job(client, home.opportunityId)).version;
      await expect(sales.skips.skip(actor, home.workspaceId, home.opportunityId, "material_selection", { version: await version(), reason: "  " })).rejects.toThrow("Say why this step isn't needed");
      await expect(sales.skips.skip(actor, home.workspaceId, home.opportunityId, "quotation", { version: await version(), reason: "Not needed" })).rejects.toThrow("Only a step marked Used if needed");
      await expect(sales.skips.skip(actor, home.workspaceId, home.opportunityId, "payment_proof", { version: await version(), reason: "Not needed" })).rejects.toThrow("Only a step marked Used if needed");
      await expect(sales.skips.skip(actor, home.workspaceId, home.opportunityId, "nothing_here", { version: await version(), reason: "Not needed" })).rejects.toThrow("isn't on this job's steps");
      await expect(sales.skips.skip(actor, home.workspaceId, home.opportunityId, "material_selection", { version: (await version()) - 1, reason: "Stale" })).rejects.toThrow("Opportunity changed");
      await expect(as(home.viewer).skips.skip(actor, home.workspaceId, home.opportunityId, "material_selection", { version: await version(), reason: "Not needed" })).rejects.toThrow("Permissions required");

      const start = await version();
      const commandId = randomUUID();
      const reason = "Client reuses the existing cabinet fronts";
      const skipped = await sales.skips.skip(actor, home.workspaceId, home.opportunityId, "material_selection", { version: start, reason, commandId });
      expect(skipped).toMatchObject({ version: start + 1, stepKey: "material_selection", replay: false, caseSynced: false, skip: { reason, by: "Sara Sales" } });
      // Replays: the same command, and the same skip sent again from the version the person saw.
      expect(await sales.skips.skip(actor, home.workspaceId, home.opportunityId, "material_selection", { version: start + 1, reason: "Other", commandId })).toMatchObject({ replay: true });
      expect(await sales.skips.skip(actor, home.workspaceId, home.opportunityId, "material_selection", { version: start, reason })).toMatchObject({ replay: true });
      expect(Number((await client.query("SELECT count(*) FROM crm_opportunity_step_skips WHERE opportunity_id = $1", [home.opportunityId])).rows[0].count)).toBe(1);
      expect(await audits(client, home.workspaceId, "crm.opportunity.step_skipped.v1")).toBe(1);

      // The job's line shows it as not needed, with the reason.
      const view = await sales.siteVisits.view(actor, home.workspaceId, home.opportunityId);
      expect(view.applies).toBe(true);
      const { loadFlowFacts } = await import("../opportunities/flow-facts");
      const { flowProgress } = await import("../flows/flow-interpreter");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [home.workspaceId]);
      const facts = await loadFlowFacts(client, home.workspaceId, home.opportunityId);
      expect(flowProgress(facts.flowDefinition.definition, facts).line.find((step) => step.key === "material_selection")).toMatchObject({ state: "skipped", skip: { reason } });

      // Forced RLS: another tenant reads none of it, and the app role can't rewrite a reason.
      await client.query("SAVEPOINT rls");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [other.workspaceId]);
      await client.query("SET LOCAL ROLE wodana_app");
      expect(Number((await client.query("SELECT count(*) FROM crm_opportunity_step_skips")).rows[0].count)).toBe(0);
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [home.workspaceId]);
      await expect(client.query("UPDATE crm_opportunity_step_skips SET reason = 'changed'")).rejects.toThrow(/permission denied/);
      await client.query("ROLLBACK TO SAVEPOINT rls");
      await client.query("RESET ROLE");
      await expect(as(other.admin).skips.skip(actor, other.workspaceId, home.opportunityId, "material_selection", { version: 1, reason: "Cross tenant" })).rejects.toThrow("Opportunity not found");

      // Undo: the step is needed again; the skip row stays with who undid it.
      const undone = await sales.skips.unskip(actor, home.workspaceId, home.opportunityId, "material_selection", { version: start + 1, reason: "Client changed their mind" });
      expect(undone).toMatchObject({ version: start + 2, skip: null });
      expect(await sales.skips.unskip(actor, home.workspaceId, home.opportunityId, "material_selection", { version: start + 1 })).toMatchObject({ skip: null });
      expect((await client.query("SELECT revoked_by, revoke_reason FROM crm_opportunity_step_skips WHERE opportunity_id = $1", [home.opportunityId])).rows[0])
        .toEqual({ revoked_by: home.sales, revoke_reason: "Client changed their mind" });
    });
  });

  it("PLM-080 / PLM-044: the joinery site visit is booked in time the salesperson and the designer both have free; the Account Manager is invited", async () => {
    await scenario(async (client, as, home) => {
      const admin = as(home.admin);
      const free = await admin.siteVisits.slots(actor, home.workspaceId, home.opportunityId, { designerMembershipId: home.designerMember, minutes: "120" });
      expect(free.slots.length).toBeGreaterThan(0);
      // The designer is busy at the first free time: it is no longer offered.
      const first = free.slots[0];
      await client.query("SET LOCAL session_replication_role = replica");
      const busy = randomUUID();
      await client.query(`INSERT INTO crm_activities(id,workspace_id,opportunity_id,type,title,owner_membership_id,priority,due_at,status,created_by) VALUES($1,$2,$6,'meeting','Showroom',$3,'normal',$4,'pending',$5)`,
        [busy, home.workspaceId, home.designerMember, first.start, home.admin, home.opportunityId]);
      await client.query(`INSERT INTO crm_appointments(workspace_id,activity_id,starts_at,ends_at,timezone,attendee_membership_ids) VALUES($1,$2,$3,$4,'Europe/London','[]')`,
        [home.workspaceId, busy, first.start, first.end]);
      await client.query("SET LOCAL session_replication_role = origin");
      const again = await admin.siteVisits.slots(actor, home.workspaceId, home.opportunityId, { designerMembershipId: home.designerMember, minutes: "120" });
      expect(again.slots.map((slot) => slot.start)).not.toContain(first.start);

      await expect(admin.siteVisits.book(actor, home.workspaceId, home.opportunityId, { designerMembershipId: home.designerMember, startsAt: first.start, minutes: 120, timezone: "Europe/London", version: 0 }))
        .rejects.toThrow("That time isn't free for both of them any more");
      await expect(as(home.viewer).siteVisits.book(actor, home.workspaceId, home.opportunityId, { designerMembershipId: home.designerMember, startsAt: again.slots[0].start, minutes: 120, timezone: "Europe/London", version: 0 }))
        .rejects.toThrow("Permissions required");

      const slot = again.slots[0];
      const booked = await admin.siteVisits.book(actor, home.workspaceId, home.opportunityId, { designerMembershipId: home.designerMember, startsAt: slot.start, minutes: 120, timezone: "Europe/London", address: "Villa 12", version: 0 });
      expect(booked).toMatchObject({ applies: true, designer: { membershipId: home.designerMember }, salesperson: { membershipId: home.salesMember } });
      expect(new Date(booked.visit!.startsAt!).toISOString()).toBe(slot.start);
      const appointment = (await client.query<{ attendees: string[] }>(
        `SELECT appointment.attendee_membership_ids AS attendees FROM crm_appointments appointment JOIN design_journey_stages stage ON stage.activity_id = appointment.activity_id
          WHERE stage.workspace_id = $1 AND stage.stage = 'site_visit'`, [home.workspaceId])).rows[0];
      expect(appointment.attendees).toEqual(expect.arrayContaining([home.designerMember, home.salesMember]));
      expect(await audits(client, home.workspaceId, "crm.opportunity.site_visit_booked.v1")).toBe(1);

      // Replay: the same time again changes nothing; another time from a stale view is refused.
      await admin.siteVisits.book(actor, home.workspaceId, home.opportunityId, { designerMembershipId: home.designerMember, startsAt: slot.start, minutes: 120, timezone: "Europe/London", version: 0 });
      expect(await audits(client, home.workspaceId, "crm.opportunity.site_visit_booked.v1")).toBe(1);
      await expect(admin.siteVisits.book(actor, home.workspaceId, home.opportunityId, { designerMembershipId: home.designerMember, startsAt: again.slots.at(-1)!.start, minutes: 120, timezone: "Europe/London", version: 0 }))
        .rejects.toThrow("The site visit changed in another window");
      // The dedicated designer is the one who goes.
      await expect(admin.siteVisits.slots(actor, home.workspaceId, home.opportunityId, { designerMembershipId: home.salesMember }))
        .rejects.toThrow("dedicated designer");
    });
  });

  it("PLM-080: two jobs booking the same salesperson at the same time at once — one gets it, the other is offered the next free times", async () => {
    // Real, separate transactions (committed), so the two bookings genuinely race.
    const seed = await pool.connect();
    let home: Tenant, second: { opportunityId: string; designerMember: string };
    try {
      await seed.query("BEGIN");
      home = await tenant(seed);
      const designer = randomUUID(), designerMember = randomUUID(), partyId = randomUUID(), enquiryId = randomUUID(), leadId = randomUUID(), opportunityId = randomUUID();
      await seed.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Dev Designer')", [designer, `d2-${designer}@example.com`]);
      await seed.query("SET LOCAL session_replication_role = replica");
      await seed.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [designerMember, home.workspaceId, designer]);
      await seed.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) SELECT workspace_id,$2,role_id FROM member_roles WHERE workspace_id = $1 AND membership_id = $3", [home.workspaceId, designerMember, home.designerMember]);
      await seed.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Omar','omar')", [partyId, home.workspaceId]);
      await seed.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
        VALUES($1,$2,$3,$4,'Wardrobes','referral','external',now(),'E-2','joinery','{"customerType":"end_user"}')`, [enquiryId, home.workspaceId, randomUUID(), partyId]);
      await seed.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id) VALUES($1,$2,$3,$4)", [leadId, home.workspaceId, enquiryId, partyId]);
      await seed.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,title,reference,next_action_at,owner_membership_id,
          conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,(SELECT id FROM crm_pipeline_stages WHERE pipeline_id = $5 AND code = 'qualified'),'Wardrobes','O-2',now() + interval '1 day',$6,
          'lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, home.workspaceId, partyId, leadId, home.pipelineId, home.salesMember]);
      await seed.query("SET LOCAL session_replication_role = origin");
      await seed.query("COMMIT");
      second = { opportunityId, designerMember };
    } catch (error) { await seed.query("ROLLBACK"); throw error; }
    finally { seed.release(); }

    const database = {
      tenantTransaction: async (ws: string, actorUserId: string, fn: (c: PoolClient) => Promise<unknown>) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL ROLE wodana_app");
          await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [ws, actorUserId]);
          const result = await fn(client);
          await client.query("COMMIT");
          return result;
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      },
    };
    // Both bookings pass their first check before either writes: each waits here (after the check, before the write) for the other.
    let arrived = 0, release!: () => void;
    const bothChecked = new Promise<void>((resolve) => { release = resolve; });
    const service = () => {
      const access = new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId: home.admin }) } as never);
      const events = new CrmEventsService();
      const discovery = new OpportunityDiscoveryService(access);
      const journey = new DesignJourneyService(access);
      const start = journey.start.bind(journey);
      journey.start = (async (...args: Parameters<typeof journey.start>) => { if (++arrived === 2) release(); await bothChecked; return start(...args); }) as typeof journey.start;
      return new SiteVisitBookingService(access, discovery, new PreProjectsService(access, events, new CrmOpportunitiesService(access, events)), journey, new IntroMeetingService(access, events, discovery));
    };
    const [one, two] = [service(), service()];
    const free = await one.slots(actor, home.workspaceId, home.opportunityId, { designerMembershipId: home.designerMember, minutes: "120" });
    const slot = free.slots[0];
    const results = await Promise.allSettled([
      one.book(actor, home.workspaceId, home.opportunityId, { designerMembershipId: home.designerMember, startsAt: slot.start, minutes: 120, timezone: "Europe/London", version: 0 }),
      two.book(actor, home.workspaceId, second.opportunityId, { designerMembershipId: second.designerMember, startsAt: slot.start, minutes: 120, timezone: "Europe/London", version: 0 }),
    ]);
    expect(arrived).toBe(2);
    const won = results.filter((result) => result.status === "fulfilled");
    const lost = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason.message).toBe("That time isn't free for both of them any more. Choose another time.");
    const next = (lost[0].reason.getResponse() as { next: Array<{ start: string }> }).next;
    expect(next.length).toBeGreaterThan(0);
    expect(Date.parse(next[0].start)).toBeGreaterThan(Date.parse(slot.start));

    const check = await pool.connect();
    try {
      // The salesperson is on exactly one visit then, and only the winner's booking is audited.
      const visits = (await check.query(`SELECT count(*)::int AS n FROM crm_appointments appointment JOIN design_journey_stages stage ON stage.workspace_id = appointment.workspace_id AND stage.activity_id = appointment.activity_id
        WHERE appointment.workspace_id = $1 AND stage.stage = 'site_visit' AND appointment.starts_at = $2 AND appointment.attendee_membership_ids ? $3::text`, [home.workspaceId, slot.start, home.salesMember])).rows[0].n;
      expect(visits).toBe(1);
      expect(await audits(check, home.workspaceId, "crm.opportunity.site_visit_booked.v1")).toBe(1);
    } finally { check.release(); }
  });
});
