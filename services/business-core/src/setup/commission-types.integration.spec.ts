import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readCommissionTypes, saveCommissionTypes } from "./commission-types";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("the firm's commission types on the database (§0.3 P3)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withWorkspaces(work: (client: PoolClient, ids: { workspaceId: string; otherId: string; user: string }) => Promise<void>) {
    const client = await pool.connect();
    const ids = { workspaceId: randomUUID(), otherId: randomUUID(), user: randomUUID() };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Owner')", [ids.user, `o-${ids.user.slice(0, 8)}@example.com`]);
      for (const id of [ids.workspaceId, ids.otherId]) await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Commission',$2,'USD',$3)", [id, `ct-${id.slice(0, 8)}`, ids.user]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ids.workspaceId]);
      await work(client, ids);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("starts from the kit, saves the firm's list version-checked, retires a removed type and keeps it to the firm", async () => {
    await withWorkspaces(async (client, { workspaceId, otherId, user }) => {
      const kit = await readCommissionTypes(client, workspaceId);
      expect(kit).toMatchObject({ fromKit: true, types: [{ code: "sales" }, { code: "designer" }, { code: "referral" }] });
      const saved = await saveCommissionTypes(client, workspaceId, user, { version: kit.version, types: [{ code: "sales", label: "Sales" }, { label: "Project management fee" }] });
      expect(saved.after.types.map((type) => type.code)).toEqual(["sales", "project_management_fee"]);
      await expect(saveCommissionTypes(client, workspaceId, user, { version: kit.version, types: [{ label: "Referral" }] })).rejects.toThrow("another window");
      expect((await client.query("SELECT code, active FROM setup_commission_types WHERE workspace_id=$1 ORDER BY code", [workspaceId])).rows)
        .toEqual([{ code: "project_management_fee", active: true }, { code: "sales", active: true }]);
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [otherId]);
      expect((await readCommissionTypes(client, otherId)).fromKit).toBe(true);
      expect((await client.query("SELECT count(*)::int AS n FROM setup_commission_types WHERE workspace_id=$1", [workspaceId])).rows[0].n).toBe(0);
    });
  });
});
