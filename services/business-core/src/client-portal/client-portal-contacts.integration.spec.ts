import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClientPortalAdminService } from "./client-portal-admin.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each call commits in its own
// tenant transaction as the app role, like the API; the throwaway workspaces are removed afterwards.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "Sara Sales" } as never;
const MOBILE = "+971501234567";

/**
 * Opening Send to client reads the case's contacts, and reading them adds the case's own client as its first
 * decision-maker. The dialog reads them more than once at the same moment: every read succeeds and the client is
 * added once (one contact, one audit entry), however the reads interleave.
 */
integration("the case's client added as its first contact", { timeout: 30_000 }, () => {
  let pool: Pool;
  const workspaces: string[] = [];
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 8 });
  });
  afterAll(async () => {
    // Best effort: the throwaway database is dropped after the run.
    for (const id of workspaces) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        for (const table of ["audit_events", "outbox_events", "client_portal_grants", "pre_project_cases", "crm_opportunities", "crm_contact_points", "crm_parties", "workspace_memberships"])
          await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [id]);
        await client.query("DELETE FROM workspaces WHERE id = $1", [id]);
        await client.query("COMMIT");
      } catch { await client.query("ROLLBACK").catch(() => undefined); } finally { client.release(); }
    }
    await pool.end();
  });

  /** A case whose client has a mobile and no portal contact yet. */
  async function seedCase() {
    const workspaceId = randomUUID(), userId = randomUUID(), membershipId = randomUUID(), partyId = randomUUID(), opportunityId = randomUUID(), caseId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sara Sales')", [userId, `${userId}@example.com`]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,default_locale,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai','en-AE',$3)",
        [workspaceId, `cc-${workspaceId.slice(0, 8)}`, userId]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membershipId, workspaceId, userId]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [partyId, workspaceId]);
      await client.query("INSERT INTO crm_contact_points(workspace_id,party_id,type,label,raw_value,normalized_value,country_code,is_primary) VALUES($1,$2,'phone','mobile',$3,$4,'AE',true)",
        [workspaceId, partyId, MOBILE, MOBILE]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, partyId, randomUUID(), randomUUID(), membershipId]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, userId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
    workspaces.push(workspaceId);
    return { workspaceId, userId, caseId };
  }

  /**
   * The portal admin service as the API runs it: each call in its own committed tenant transaction as the app role.
   * `beforeInsert` runs just before the contact is inserted, so a test can hold calls there until all have looked.
   */
  function admin(userId: string, beforeInsert?: () => Promise<void>) {
    const run = async (_actor: unknown, workspaceId: string, _permissions: unknown, work: (client: PoolClient, user: { userId: string; displayName: string }) => Promise<unknown>) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE wodana_app");
        await client.query("SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_actor_id', $2, true)", [workspaceId, userId]);
        const query = client.query.bind(client) as (...args: unknown[]) => unknown;
        const gated = new Proxy(client, { get: (target, key) => key !== "query" ? Reflect.get(target, key) : async (...args: unknown[]) => {
          if (beforeInsert && typeof args[0] === "string" && args[0].includes("INSERT INTO client_portal_grants")) await beforeInsert();
          return query(...args);
        } });
        const result = await work(gated, { userId, displayName: "Sara Sales" });
        await client.query("COMMIT");
        return result;
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { client.release(); }
    };
    const access = { withAnyPermission: run, withPermission: run, withPermissions: run, hasPermission: async () => true };
    return new ClientPortalAdminService(access as never, new ConfigService({}), {} as never);
  }

  const stored = async (workspaceId: string, caseId: string) => ({
    contacts: (await pool.query("SELECT phone, role, active FROM client_portal_grants WHERE workspace_id = $1 AND case_id = $2", [workspaceId, caseId])).rows,
    audits: Number((await pool.query("SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action = 'client_portal.contact_added'", [workspaceId])).rows[0].count),
  });

  it("two reads in a row add the client once", async () => {
    const { workspaceId, userId, caseId } = await seedCase();
    const service = admin(userId);
    const first = await service.contacts(actor, workspaceId, caseId);
    const second = await service.contacts(actor, workspaceId, caseId);
    expect(first.contacts).toHaveLength(1);
    expect(second.contacts).toEqual(first.contacts);
    expect(await stored(workspaceId, caseId)).toEqual({ contacts: [{ phone: MOBILE, role: "approver", active: true }], audits: 1 });
  });

  it("reads at the same moment, each finding no contact yet, all succeed and add the client once", async () => {
    const { workspaceId, userId, caseId } = await seedCase();
    // Every read has looked (and found no contact) before any of them inserts: the race the Send dialog hit.
    const readers = 3;
    let arrived = 0, release!: () => void;
    const allLooked = new Promise<void>((resolve) => { release = resolve; });
    const service = admin(userId, async () => { arrived += 1; if (arrived === readers) release(); await allLooked; });
    const results = await Promise.all(Array.from({ length: readers }, () => service.contacts(actor, workspaceId, caseId)));
    expect(arrived).toBe(readers);
    for (const result of results) expect(result.contacts.map((contact) => contact.phone)).toEqual([MOBILE]);
    expect(await stored(workspaceId, caseId)).toEqual({ contacts: [{ phone: MOBILE, role: "approver", active: true }], audits: 1 });
  });
});
