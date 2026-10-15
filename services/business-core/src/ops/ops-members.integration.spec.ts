import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). `members --deactivate` on a workspace
// with an owner and two members: a dry run writes nothing, --apply suspends them through the member command (audited
// via the operator CLI), and a second run is unchanged. The acting owner is refused and stays active.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const run = promisify(execFile);
const fixtures = resolve(__dirname, "fixtures");

type Result = { code: number; output: string };
type Json = { counts: Record<string, number>; lines: Array<{ status: string; label: string; detail?: string }> };

integration("operator CLI members --deactivate (real Postgres)", () => {
  let pool: Pool;
  const workspaceId = randomUUID();
  const slug = `mem-${workspaceId.slice(0, 8)}`;
  const people = ["owner", "sales", "designer"].map((key) => ({ key, userId: randomUUID(), membership: randomUUID(), email: `${key}-${workspaceId.slice(0, 8)}@example.test` }));
  const [owner, sales, designer] = people;
  let dry: Result, apply: Result, again: Result;
  let afterDry: Record<string, string>;

  async function cli(runs: string[][]): Promise<Result[]> {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", "-c role=wodana_app");
    const { stdout } = await run(process.execPath, [resolve(fixtures, "run-ops-cli.cjs"), JSON.stringify(runs)], {
      env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", AUTH_MODE: "development", REDIS_URL: "" }, maxBuffer: 20 * 1024 * 1024, timeout: 280_000,
    });
    return JSON.parse(stdout.slice(stdout.lastIndexOf("@@RESULT@@") + "@@RESULT@@".length)) as Result[];
  }
  const json = (result: Result) => JSON.parse(result.output) as Json;
  const statuses = async () => Object.fromEntries((await pool.query<{ email: string; status: string }>(
    `SELECT app_user.primary_email::text AS email, membership.status::text AS status FROM workspace_memberships membership
       JOIN users app_user ON app_user.id = membership.user_id WHERE membership.workspace_id = $1`, [workspaceId])).rows.map((row) => [row.email, row.status]));

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const person of people) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [person.userId, person.email, person.key]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,default_timezone,created_by) VALUES($1,'Members Studio',$2,'AED','en-US','UTC',$3)", [workspaceId, slug, owner.userId]);
      const ownerRole = randomUUID(), salesRole = randomUUID();
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$3,'owner','Owner',true),($2,$3,'sales','Sales',false)", [ownerRole, salesRole, workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions", [workspaceId, ownerRole]);
      for (const person of people) {
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [person.membership, workspaceId, person.userId]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, person.membership, person === owner ? ownerRole : salesRole]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const common = ["members", "--workspace", slug, "--as", owner.email, "--deactivate", [sales.email, designer.email, owner.email].join(","), "--json"];
    [dry] = await cli([common]);
    afterDry = await statuses();
    [apply, again] = await cli([[...common, "--apply"], [...common, "--apply"]]);
  }, 600_000);
  afterAll(() => pool?.end());

  it("previews without writing anything, and refuses the acting member", () => {
    expect(json(dry).lines.map((line) => [line.label, line.status])).toEqual([[sales.email, "would change"], [designer.email, "would change"], [owner.email, "failed"]]);
    expect(Object.values(afterDry)).toEqual(["active", "active", "active"]);
  });

  it("suspends the members through the member command, audited via the operator CLI", async () => {
    expect(json(apply).lines.map((line) => [line.label, line.status])).toEqual([[sales.email, "changed"], [designer.email, "changed"], [owner.email, "failed"]]);
    expect(await statuses()).toEqual({ [owner.email]: "active", [sales.email]: "suspended", [designer.email]: "suspended" });
    const audits = (await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM audit_events WHERE workspace_id = $1 AND via = 'operator_cli' AND action = 'workspace.member_updated'", [workspaceId])).rows[0].count;
    expect(audits).toBe(2);
  });

  it("is unchanged on a second run", () => {
    expect(json(again).lines.map((line) => [line.label, line.status])).toEqual([[sales.email, "unchanged"], [designer.email, "unchanged"], [owner.email, "failed"]]);
  });
});
