import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../../notifications/default-templates";
import { timelineCheckSource } from "../../reminders/sources/sales-checks";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { TimelineChecksService } from "./timeline-checks.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each scenario is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Ids = {
  workspaceId: string; opportunityId: string; sales: string; designer: string; production: string; outsider: string;
  salesMember: string; designerMember: string; productionMember: string; outsiderMember: string;
};

/**
 * PLM-155: Sales don't promise timelines. The Account Manager asks the design team or Production (the teams the firm
 * chose) a timeline question on the opportunity; it is due the same working day and chased by the reminder engine;
 * the answer is kept on the opportunity (its history) and the Account Manager is told to reply to the client.
 */
integration("timeline checks (real Postgres)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  async function scenario(work: (client: PoolClient, ids: Ids, as: (userId: string) => TimelineChecksService) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), opportunityId = randomUUID();
    const [sales, designer, production, outsider] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const [salesMember, designerMember, productionMember, outsiderMember] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const [salesRole, designRole] = [randomUUID(), randomUUID()];
    const [designTeam, productionTeam] = [randomUUID(), randomUUID()];
    try {
      await client.query("BEGIN");
      for (const [id, name] of [[sales, "Sara Sales"], [designer, "Dina Designer"], [production, "Pavel Production"], [outsider, "Omar Outside"]]) {
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${name.split(" ")[0].toLowerCase()}-${id.slice(0, 8)}@example.com`, name]);
      }
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,default_timezone,created_by) VALUES($1,'Timeline studio',$2,'USD','en','UTC',$3)", [workspaceId, `tl-${workspaceId.slice(0, 8)}`, sales]);
      await client.query(`INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$5,$6,'active'),($2,$5,$7,'active'),($3,$5,$8,'active'),($4,$5,$9,'active')`,
        [salesMember, designerMember, productionMember, outsiderMember, workspaceId, sales, designer, production, outsider]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$3,'sales','Account managers',false),($2,$3,'team_interior_design','Interior designers',false)", [salesRole, designRole, workspaceId]);
      await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])`,
        [workspaceId, salesRole, ["crm.leads.view", "crm.opportunities.view", "crm.opportunities.manage", "crm.activities.view"]]);
      await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])`, [workspaceId, designRole, ["crm.activities.view"]]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3),($1,$4,$5)", [workspaceId, salesMember, salesRole, designerMember, designRole]);
      // The designers' and Production's teams; the outsider is in neither. Production holds no CRM permission at all.
      const unit = randomUUID();
      await client.query("INSERT INTO business_units(id,workspace_id,legal_entity_id,code,name,timezone) VALUES($1,$2,$3,'main','Main','UTC')", [unit, workspaceId, randomUUID()]);
      await client.query("INSERT INTO workspace_teams(id,workspace_id,business_unit_id,code,name,status) VALUES($1,$3,$4,'INTERIOR_DESIGN','Interior Designers','active'),($2,$3,$4,'PRODUCTION','Production','active')", [designTeam, productionTeam, workspaceId, unit]);
      await client.query("INSERT INTO workspace_team_members(workspace_id,team_id,membership_id) VALUES($1,$2,$3),($1,$4,$5)", [workspaceId, designTeam, designerMember, productionTeam, productionMember]);
      await client.query("INSERT INTO workspace_sales_settings(workspace_id,timeline_check_roles) VALUES($1,$2)", [workspaceId, ["interior_design", "production"]]);
      const party = randomUUID(), enquiry = randomUUID(), lead = randomUUID(), pipeline = randomUUID(), stage = randomUUID();
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Noura Haddad','noura haddad')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
        VALUES($1,$2,$3,$4,'Villa','company','whatsapp',now(),'E-2001','full_id','{"targetCompletion":"2027-01-15"}')`, [enquiry, workspaceId, randomUUID(), party]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,owner_membership_id,status,qualified_at,qualification_evidence,qualification_evidence_hash) VALUES($1,$2,$3,$4,$5,'qualified',now(),'{}',repeat('a', 64))", [lead, workspaceId, enquiry, party, salesMember]);
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name,is_default) VALUES($1,$2,'sales','Sales',true)", [pipeline, workspaceId]);
      await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position) VALUES($1,$2,$3,'qualified','New Opportunity',1)", [stage, workspaceId, pipeline]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,title,owner_membership_id,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at) VALUES($1,$2,$3,$4,$5,$6,'Villa',$7,'O-0007','lead_qualification',repeat('b', 64),'{}',repeat('a', 64),now())`,
        [opportunityId, workspaceId, party, lead, pipeline, stage, salesMember]);
      await seedDefaultNotificationTemplates(client, workspaceId);
      await client.query("SET LOCAL session_replication_role = origin");
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
      const as = (userId: string) => new TimelineChecksService(new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId }) } as never), new CrmEventsService());
      await work(client, { workspaceId, opportunityId, sales, designer, production, outsider, salesMember, designerMember, productionMember, outsiderMember }, as);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const notices = async (client: PoolClient, workspaceId: string, userId: string, eventType: string) =>
    (await client.query<{ channel: string; body: string | null }>(`SELECT channel, body FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type = $3 ORDER BY channel`, [workspaceId, userId, eventType])).rows;

  it("the Account Manager asks one person from the chosen teams; due by the end of the working day, they are told and reminded", async () => {
    await scenario(async (client, ids, as) => {
      const am = as(ids.sales);
      const listed = await am.list(actor, ids.workspaceId, ids.opportunityId);
      expect(listed).toMatchObject({ canAsk: true, targetCompletion: "2027-01-15" });
      expect(listed.people.map((person) => [person.name, person.teams.map((team) => team.code)])).toEqual([["Dina Designer", ["INTERIOR_DESIGN"]], ["Pavel Production", ["PRODUCTION"]]]);
      await expect(am.ask(actor, ids.workspaceId, ids.opportunityId, { requestId: randomUUID(), assigneeMembershipId: ids.outsiderMember, question: "When?" })).rejects.toThrow("Choose someone from the teams");
      const requestId = randomUUID();
      const asked = await am.ask(actor, ids.workspaceId, ids.opportunityId, { requestId, assigneeMembershipId: ids.productionMember, question: "Can we deliver the kitchen by 15 January?" });
      expect(asked).toMatchObject({ status: "open", assigneeName: "Pavel Production", askerName: "Sara Sales", teamCode: "PRODUCTION" });
      expect(new Date(String(asked.dueAt)).getTime()).toBeGreaterThan(Date.now());
      // A retried click is the same question; the same request with another question is refused.
      expect((await am.ask(actor, ids.workspaceId, ids.opportunityId, { requestId, assigneeMembershipId: ids.productionMember, question: "Can we deliver the kitchen by 15 January?" })).id).toBe(asked.id);
      await expect(am.ask(actor, ids.workspaceId, ids.opportunityId, { requestId, assigneeMembershipId: ids.productionMember, question: "Something else" })).rejects.toThrow("different question");
      expect((await notices(client, ids.workspaceId, ids.production, "crm.timeline_question")).map((row) => row.channel)).toEqual(["email", "in_app"]);
      const history = (await client.query(`SELECT action, after->>'note' AS note FROM audit_events WHERE workspace_id = $1 AND entity_type = 'crm_opportunity' AND entity_id = $2`, [ids.workspaceId, ids.opportunityId])).rows;
      expect(history).toEqual([{ action: "crm.opportunity.timeline_check_raised.v1", note: "Can we deliver the kitchen by 15 January?" }]);
      // The reminder engine chases the person asked.
      await client.query("SET LOCAL ROLE wodana_app");
      const due = await timelineCheckSource.open(client, ids.workspaceId, { now: new Date(), limit: 10, clock: {} as never });
      expect(due.map((item) => [item.sourceId, item.ownerMembershipId])).toEqual([[asked.id, ids.productionMember]]);
      await client.query("RESET ROLE");
    });
  });

  it("the person asked answers even without opening opportunities; the Account Manager is told; a second answer at the same time is refused", async () => {
    await scenario(async (client, ids, as) => {
      const asked = await as(ids.sales).ask(actor, ids.workspaceId, ids.opportunityId, { requestId: randomUUID(), assigneeMembershipId: ids.productionMember, question: "Lead time for the wardrobes?" });
      // Someone neither asked nor in Sales doesn't see it.
      await expect(as(ids.outsider).get(actor, ids.workspaceId, String(asked.id))).rejects.toThrow("Timeline question not found");
      const production = as(ids.production);
      const seen = await production.get(actor, ids.workspaceId, String(asked.id));
      expect(seen).toMatchObject({ canAnswer: true, opportunity: { reference: "O-0007", client: "Noura Haddad", targetCompletion: "2027-01-15", canOpen: false } });
      await expect(as(ids.designer).answer(actor, ids.workspaceId, String(asked.id), { version: Number(seen.version), answer: "Six weeks" })).rejects.toThrow("Only the person asked");
      const answered = await production.answer(actor, ids.workspaceId, String(asked.id), { version: Number(seen.version), answer: "Six weeks from the approved drawings; phase 1 can be ready by 10 January." });
      expect(answered).toMatchObject({ status: "answered", answeredByName: "Pavel Production" });
      // The Account Manager records the same answer at the same time: refused, naming who answered.
      await expect(as(ids.sales).answer(actor, ids.workspaceId, String(asked.id), { version: Number(seen.version), answer: "Eight weeks" })).rejects.toThrow("Pavel Production already answered");
      expect((await notices(client, ids.workspaceId, ids.sales, "crm.timeline_answered")).map((row) => row.channel)).toEqual(["email", "in_app"]);
      const history = (await client.query(`SELECT action, after->>'note' AS note FROM audit_events WHERE workspace_id = $1 AND action = 'crm.opportunity.timeline_check_completed.v1'`, [ids.workspaceId])).rows;
      expect(history).toEqual([{ action: "crm.opportunity.timeline_check_completed.v1", note: "Six weeks from the approved drawings; phase 1 can be ready by 10 January." }]);
      await client.query("SET LOCAL ROLE wodana_app");
      expect(await timelineCheckSource.stillOpen(client, ids.workspaceId, [`timeline:${asked.id}`])).toEqual(new Set());
      await client.query("RESET ROLE");
    });
  });

  it("nobody in the chosen teams, a closed opportunity and a cancelled question are each said plainly", async () => {
    await scenario(async (client, ids, as) => {
      const am = as(ids.sales);
      const asked = await am.ask(actor, ids.workspaceId, ids.opportunityId, { requestId: randomUUID(), assigneeMembershipId: ids.designerMember, question: "Concept in 7 days?" });
      expect(await am.cancel(actor, ids.workspaceId, String(asked.id), { version: Number(asked.version) })).toMatchObject({ status: "cancelled" });
      await expect(as(ids.designer).answer(actor, ids.workspaceId, String(asked.id), { version: Number(asked.version) + 1, answer: "Yes" })).rejects.toThrow("cancelled");
      await client.query("UPDATE workspace_sales_settings SET timeline_check_roles = '{visualiser}' WHERE workspace_id = $1", [ids.workspaceId]);
      await expect(am.ask(actor, ids.workspaceId, ids.opportunityId, { requestId: randomUUID(), assigneeMembershipId: ids.designerMember, question: "Renders?" })).rejects.toThrow("Nobody is in the teams that answer timeline questions");
      await client.query("UPDATE crm_opportunities SET status = 'lost' WHERE id = $1", [ids.opportunityId]);
      await expect(am.ask(actor, ids.workspaceId, ids.opportunityId, { requestId: randomUUID(), assigneeMembershipId: ids.designerMember, question: "Renders?" })).rejects.toThrow("This opportunity is closed");
    });
  });
});
