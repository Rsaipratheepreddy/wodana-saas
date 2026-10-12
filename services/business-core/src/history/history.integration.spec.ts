import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { HistoryService } from "./history.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back; every read
// runs as the app role under forced RLS, as the API does.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Person = "sales" | "buyer" | "raiser" | "finance" | "outsider";
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

integration("Record history on real Postgres (who did what; only for those who may see the record; per tenant)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  type Ids = { workspaceId: string; otherWorkspaceId: string; people: Record<Person, string>; opportunityId: string; otherOpportunityId: string; ownRequest: string; theirRequest: string };

  async function scenario(work: (client: PoolClient, ids: Ids, as: (person: Person) => HistoryService) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), otherWorkspaceId = randomUUID();
    const people: Record<Person, string> = { sales: randomUUID(), buyer: randomUUID(), raiser: randomUUID(), finance: randomUUID(), outsider: randomUUID() };
    const opportunityId = randomUUID(), otherOpportunityId = randomUUID(), ownRequest = randomUUID(), theirRequest = randomUUID();
    try {
      await client.query("BEGIN");
      for (const [key, id] of Object.entries(people))
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${key}-${id.slice(0, 8)}@example.com`, key === "sales" ? "Sara Sales" : key[0].toUpperCase() + key.slice(1)]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      for (const ws of [workspaceId, otherWorkspaceId])
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by,default_timezone) VALUES($1,'History firm',$2,'AED',$3,'Asia/Dubai')", [ws, `hist-${ws.slice(0, 8)}`, people.sales]);
      const grants: Record<Person, [string, string[]]> = {
        sales: [workspaceId, ["crm.opportunities.view", "crm.leads.view"]],
        buyer: [workspaceId, ["purchasing.view"]],
        raiser: [workspaceId, ["finance_requests.raise"]],
        finance: [workspaceId, ["finance_requests.manage", "finance_requests.raise"]],
        // Everything, but in another organization.
        outsider: [otherWorkspaceId, ["crm.opportunities.view", "crm.leads.view", "purchasing.view", "finance_requests.manage"]],
      };
      for (const [person, [ws, permissions]] of Object.entries(grants) as Array<[Person, [string, string[]]]>) {
        const roleId = randomUUID(), membership = randomUUID();
        await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,$3,$3,false)", [roleId, ws, person]);
        await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])", [ws, roleId, permissions]);
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, ws, people[person]]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [ws, membership, roleId]);
      }
      for (const [ws, id, title] of [[workspaceId, opportunityId, "Villa 14 fit-out"], [otherWorkspaceId, otherOpportunityId, "Other firm's villa"]]) {
        const partyId = randomUUID(), pipelineId = randomUUID(), stageId = randomUUID();
        await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Aisha Rahman','aisha rahman')", [partyId, ws]);
        await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [pipelineId, ws]);
        await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position) VALUES($1,$2,$3,'new','New',1)", [stageId, ws, pipelineId]);
        await client.query("INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,amount,currency_code) VALUES($1,$2,$3,$4,$5,$6,'O-0009',250000,'AED')",
          [id, ws, partyId, pipelineId, stageId, title]);
      }
      for (const [id, number, by] of [[ownRequest, 1, people.raiser], [theirRequest, 2, people.finance]] as const)
        await client.query("INSERT INTO finance_requests(id,workspace_id,number,kind,requested_by,currency,total_amount,party_id,reason) VALUES($1,$2,$3,'refund',$4,'AED',1500,gen_random_uuid(),'Overpaid')", [id, workspaceId, number, by]);
      // The audit trail, as the commands write it, a minute apart.
      let minutes = 10;
      const recordAudit = (_db: PoolClient, event: { workspaceId: string; actorUserId: string; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown }) =>
        client.query(`INSERT INTO audit_events(workspace_id,actor_user_id,source,action,entity_type,entity_id,before,after,correlation_id,occurred_at)
          VALUES($1,$2,'user',$3,$4,$5,$6::jsonb,$7::jsonb,gen_random_uuid(),now() - make_interval(mins => $8))`,
        [event.workspaceId, event.actorUserId, event.action, event.entityType, event.entityId, event.before ? JSON.stringify(event.before) : null, event.after ? JSON.stringify(event.after) : null, minutes--]);
      await recordAudit(client, { workspaceId, actorUserId: people.sales, action: "crm.opportunity.created.v1", entityType: "crm_opportunity", entityId: opportunityId,
        after: { id: opportunityId, title: "Villa 14 fit-out", status: "open", amount: "250000.0000", currency_code: "AED" } });
      await recordAudit(client, { workspaceId, actorUserId: people.sales, action: "crm.opportunity.stage_changed.v1", entityType: "crm_opportunity", entityId: opportunityId,
        before: { status: "open", probability: "20.00", version: 1 }, after: { status: "open", probability: "50.00", version: 2 } });
      await recordAudit(client, { workspaceId, actorUserId: people.sales, action: "crm.lead.contact_logged.v1", entityType: "crm_activity", entityId: randomUUID(),
        after: { opportunityId, note: "Called about the kitchen" } });
      await recordAudit(client, { workspaceId, actorUserId: people.finance, action: "approvals.approved.v1", entityType: "approval_request", entityId: randomUUID(),
        after: { subjectId: opportunityId, kind: "deal_file", note: "Receipt checked." } });
      // A finance request's own log (the history reads it in place of its audit rows).
      for (const [id, by] of [[ownRequest, people.raiser], [theirRequest, people.finance]])
        await client.query("INSERT INTO finance_request_events(id,workspace_id,request_id,kind,from_status,to_status,note,actor_id) VALUES(gen_random_uuid(),$1,$2,'submitted',NULL,'new','',$3)", [workspaceId, id, by]);
      await recordAudit(client, { workspaceId: otherWorkspaceId, actorUserId: people.outsider, action: "crm.opportunity.created.v1", entityType: "crm_opportunity", entityId: otherOpportunityId,
        after: { id: otherOpportunityId, title: "Other firm's villa" } });
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
      const as = (person: Person) => new HistoryService(new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId: people[person] }) } as never));
      await work(client, { workspaceId, otherWorkspaceId, people, opportunityId, otherOpportunityId, ownRequest, theirRequest }, as);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("reads an opportunity's history newest first, with who, what, changes and the workspace's time zone, filtered by kind", async () => {
    await scenario(async (_client, { workspaceId, opportunityId, people }, as) => {
      const page = await as("sales").read(actor, workspaceId, "opportunity", opportunityId, {});
      expect(page.timeZone).toBe("Asia/Dubai");
      expect(page.items.map((item) => [item.verb, item.subject, item.category])).toEqual([
        ["approved", "deal_file", "approval"], ["logged_contact", "task", "message"], ["advanced", "opportunity", "change"], ["created", "opportunity", "change"],
      ]);
      expect(page.items[2]).toMatchObject({ reference: "O-0009", actor: { id: people.sales, name: "Sara Sales", kind: "person", roles: ["sales"] },
        changes: [{ field: "probability", before: "20.00", after: "50.00" }] });
      expect(JSON.stringify(page.items)).not.toMatch(/crm\.opportunity|\.v1/);
      // Sales without the value permission don't see the opportunity's value in its history either.
      expect(page.items[3].amount).toBeNull();
      expect(JSON.stringify(page.items)).not.toContain("250000");
      expect((await as("sales").read(actor, workspaceId, "opportunity", opportunityId, { filter: "approvals" })).items.map((item) => item.verb)).toEqual(["approved"]);
      expect((await as("sales").read(actor, workspaceId, "opportunity", opportunityId, { filter: "messages" })).items.map((item) => item.verb)).toEqual(["logged_contact"]);
      expect((await as("sales").read(actor, workspaceId, "opportunity", opportunityId, { filter: "changes" })).items).toHaveLength(2);
      await expect(as("sales").read(actor, workspaceId, "opportunity", opportunityId, { filter: "everything" })).rejects.toThrow("Choose all");
      await expect(as("sales").read(actor, workspaceId, "nonsense", opportunityId, {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it("pages with a cursor", async () => {
    await scenario(async (_client, { workspaceId, opportunityId }, as) => {
      const first = await as("sales").read(actor, workspaceId, "opportunity", opportunityId, {});
      expect(first.next).toBeNull();
      const last = first.items.at(1)!;
      const rest = await as("sales").read(actor, workspaceId, "opportunity", opportunityId, { before: `${last.occurredAt}|${last.id}` });
      expect(rest.items.map((item) => item.id)).toEqual(first.items.slice(2).map((item) => item.id));
    });
  });

  it("shows a record's history only to those who may see the record", async () => {
    await scenario(async (_client, { workspaceId, opportunityId, ownRequest, theirRequest }, as) => {
      // Purchasing can't read opportunities, so not their history either.
      await expect(as("buyer").read(actor, workspaceId, "opportunity", opportunityId, {})).rejects.toBeInstanceOf(ForbiddenException);
      // Someone who only raises finance requests sees the history of their own, not of others'.
      expect((await as("raiser").read(actor, workspaceId, "finance_request", ownRequest, {})).items.map((item) => [item.verb, item.reference, item.actor.name]))
        .toEqual([["submitted", "FR-0001", "Raiser"]]);
      await expect(as("raiser").read(actor, workspaceId, "finance_request", theirRequest, {})).rejects.toBeInstanceOf(NotFoundException);
      expect((await as("finance").read(actor, workspaceId, "finance_request", theirRequest, {})).items).toHaveLength(1);
    });
  });

  it("keeps each organization's history to itself", async () => {
    await scenario(async (_client, { workspaceId, otherWorkspaceId, opportunityId, otherOpportunityId }, as) => {
      // Not a member of the first organization: it isn't there for them at all.
      await expect(as("outsider").read(actor, workspaceId, "opportunity", opportunityId, {})).rejects.toThrow("Workspace not found");
      // In their own organization the other firm's record id finds nothing (RLS), and their own history holds only their events.
      await expect(as("outsider").read(actor, otherWorkspaceId, "opportunity", opportunityId, {})).rejects.toBeInstanceOf(NotFoundException);
      const own = await as("outsider").read(actor, otherWorkspaceId, "opportunity", otherOpportunityId, {});
      expect(own.items).toHaveLength(1);
      expect(own.items[0].verb).toBe("created");
      // Nor do the sales team's events leak into it.
      expect(own.items[0].actor.name).toBe("Outsider");
    });
  });
});
