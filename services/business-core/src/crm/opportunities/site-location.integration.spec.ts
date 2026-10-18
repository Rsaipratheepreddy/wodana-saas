import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PreProjectsService } from "../../pre-projects/pre-projects.service";
import { OpportunityDiscoveryService } from "./discovery.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Ids = { workspaceId: string; opportunityId: string; otherWorkspaceId: string; otherOpportunityId: string; actor: string };

integration("property position and the job's site", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function seed(client: PoolClient, actor: string) {
    const workspaceId = randomUUID(), partyId = randomUUID(), opportunityId = randomUUID();
    await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
    await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Geo',$2,'EUR',$3)", [workspaceId, `geo-${workspaceId.slice(0, 8)}`, actor]);
    await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [randomUUID(), workspaceId, actor]);
    await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Lena','lena')", [partyId, workspaceId]);
    await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
      VALUES($1,$2,$3,$4,$5,'Lakeside flat','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, partyId, randomUUID(), randomUUID()]);
    return { workspaceId, opportunityId };
  }

  async function withJob(work: (client: PoolClient, ids: Ids, services: { discovery: OpportunityDiscoveryService; cases: PreProjectsService; asApp: <T>(workspaceId: string, fn: () => Promise<T>) => Promise<T> }) => Promise<void>) {
    const client = await pool.connect();
    const actor = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'AM')", [actor, `geo-${actor.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers and parent rows
      const other = await seed(client, actor);
      const home = await seed(client, actor);
      await client.query("SET LOCAL session_replication_role = origin");
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: actor });
      // A tenant transaction as the app role (NOBYPASSRLS), bound to one workspace.
      const asApp = async <T>(workspaceId: string, fn: () => Promise<T>) => {
        await client.query("SAVEPOINT tenant");
        try {
          await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
          await client.query("SET LOCAL ROLE wodana_app");
          const result = await fn();
          await client.query("RESET ROLE");
          await client.query("RELEASE SAVEPOINT tenant");
          return result;
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT tenant");
          await client.query("RESET ROLE");
          throw error;
        } finally {
          await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [home.workspaceId]);
        }
      };
      await work(client, { ...home, otherWorkspaceId: other.workspaceId, otherOpportunityId: other.opportunityId, actor }, {
        discovery: new OpportunityDiscoveryService({ withPermission: run } as never),
        cases: new PreProjectsService({ withPermissions: run } as never, { record: async () => undefined } as never, {} as never),
        asApp,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  const sites = async (client: PoolClient, workspaceId: string) => (await client.query<{ caseId: string | null; projectId: string | null; address: string; latitude: number; longitude: number; radiusM: number; name: string }>(
    `SELECT case_id AS "caseId", project_id AS "projectId", address, latitude, longitude, radius_m AS "radiusM", name FROM work_locations WHERE workspace_id = $1 AND kind = 'site'`, [workspaceId])).rows;

  it("saves the position as table data: validated, version-checked and audited", async () => {
    await withJob(async (client, { workspaceId, opportunityId }, { discovery }) => {
      const saved = await discovery.save(actor, workspaceId, opportunityId, { version: 0, propertyLocation: "12 Lake Road", latitude: 47.36667123456, longitude: 8.55 });
      expect(saved.facts).toMatchObject({ propertyLocation: "12 Lake Road", latitude: 47.3666712, longitude: 8.55 });
      const row = (await client.query("SELECT latitude::text AS latitude, longitude::text AS longitude FROM crm_opportunity_discovery WHERE workspace_id = $1 AND opportunity_id = $2", [workspaceId, opportunityId])).rows[0];
      expect(row).toEqual({ latitude: "47.3666712", longitude: "8.5500000" });
      await expect(discovery.save(actor, workspaceId, opportunityId, { version: 1, latitude: 91 })).rejects.toThrow(/latitude between -90 and 90/);
      await expect(discovery.save(actor, workspaceId, opportunityId, { version: 1, longitude: -180.5 })).rejects.toThrow(/longitude between -180 and 180/);
      await expect(discovery.save(actor, workspaceId, opportunityId, { version: 1, latitude: null })).rejects.toThrow(/both latitude and longitude/);
      await expect(discovery.save(actor, workspaceId, opportunityId, { version: 0, latitude: 1, longitude: 1 })).rejects.toThrow(/another window/);
      await client.query("SAVEPOINT half");
      await expect(client.query("UPDATE crm_opportunity_discovery SET latitude = NULL WHERE workspace_id = $1 AND opportunity_id = $2", [workspaceId, opportunityId])).rejects.toThrow(/coordinates_check/);
      await client.query("ROLLBACK TO SAVEPOINT half");
      const cleared = await discovery.save(actor, workspaceId, opportunityId, { version: 1, latitude: null, longitude: null });
      expect(cleared.facts).toMatchObject({ latitude: null, longitude: null, propertyLocation: "12 Lake Road" });
      const audit = (await client.query("SELECT after FROM audit_events WHERE workspace_id = $1 AND action = 'crm.opportunity.discovery_saved' ORDER BY occurred_at", [workspaceId])).rows;
      expect(audit[0].after).toMatchObject({ latitude: 47.3666712, longitude: 8.55 });
    });
  }, 30_000);

  it("never reads or writes another workspace's property", async () => {
    await withJob(async (_client, { workspaceId, opportunityId, otherWorkspaceId, otherOpportunityId }, { discovery, asApp }) => {
      await asApp(workspaceId, () => discovery.save(actor, workspaceId, opportunityId, { version: 0, latitude: 10, longitude: 20 }));
      // Bound to the other workspace, this opportunity does not exist, whichever id the caller names.
      await expect(asApp(otherWorkspaceId, () => discovery.save(actor, otherWorkspaceId, opportunityId, { latitude: 1, longitude: 1 }))).rejects.toThrow(/Opportunity not found/);
      await expect(asApp(otherWorkspaceId, () => discovery.save(actor, workspaceId, opportunityId, { latitude: 1, longitude: 1 }))).rejects.toThrow(/Opportunity not found/);
      const mine = await asApp(workspaceId, () => discovery.get(actor, workspaceId, opportunityId));
      expect(mine.facts).toMatchObject({ latitude: 10, longitude: 20 });
      const theirs = await asApp(otherWorkspaceId, () => discovery.get(actor, otherWorkspaceId, otherOpportunityId));
      expect(theirs.facts).toMatchObject({ latitude: null, longitude: null });
    });
  }, 30_000);

  it("gives the planning case one site for check-in, and a replay or a later save never adds another", async () => {
    await withJob(async (client, { workspaceId, opportunityId }, { discovery, cases }) => {
      await discovery.save(actor, workspaceId, opportunityId, { version: 0, propertyLocation: "12 Lake Road", latitude: 47.3667, longitude: 8.55 });
      const started = await cases.start(actor, workspaceId, opportunityId);
      expect(started).toMatchObject({ siteAddress: "12 Lake Road", siteLatitude: 47.3667, siteLongitude: 8.55 });
      expect(await sites(client, workspaceId)).toEqual([{ caseId: started.id, projectId: null, address: "12 Lake Road", latitude: 47.3667, longitude: 8.55, radiusM: 150, name: "Lakeside flat" }]);
      const replay = await cases.start(actor, workspaceId, opportunityId);
      expect(replay.id).toBe(started.id);
      // A corrected position moves the site that still sits on the old one; saving again changes nothing more.
      await discovery.save(actor, workspaceId, opportunityId, { version: 1, latitude: 47.3668, longitude: 8.5501 });
      await discovery.save(actor, workspaceId, opportunityId, { version: 2, latitude: 47.3668, longitude: 8.5501 });
      expect(await sites(client, workspaceId)).toMatchObject([{ caseId: started.id, latitude: 47.3668, longitude: 8.5501 }]);
      // Once someone moves it in Workplaces, it is theirs.
      await client.query("UPDATE work_locations SET latitude = 47.4 WHERE workspace_id = $1", [workspaceId]);
      await discovery.save(actor, workspaceId, opportunityId, { version: 3, latitude: 47.5, longitude: 8.6 });
      expect(await sites(client, workspaceId)).toMatchObject([{ latitude: 47.4, longitude: 8.5501 }]);
      const audit = (await client.query("SELECT action FROM audit_events WHERE workspace_id = $1 AND entity_type = 'work_location' ORDER BY occurred_at", [workspaceId])).rows.map((row) => row.action);
      expect(audit).toEqual(["work_location.created_from_property", "work_location.moved_with_property"]);
    });
  }, 30_000);

  it("creates the site when the position arrives after the case, and none without a position", async () => {
    await withJob(async (client, { workspaceId, opportunityId }, { discovery, cases }) => {
      const started = await cases.start(actor, workspaceId, opportunityId);
      expect(started).toMatchObject({ siteAddress: null, siteLatitude: null });
      expect(await sites(client, workspaceId)).toEqual([]);
      await discovery.save(actor, workspaceId, opportunityId, { version: 0, latitude: -33.8688, longitude: 151.2093 });
      expect(await sites(client, workspaceId)).toMatchObject([{ caseId: started.id, latitude: -33.8688, longitude: 151.2093, address: "" }]);
    });
  }, 30_000);
});
