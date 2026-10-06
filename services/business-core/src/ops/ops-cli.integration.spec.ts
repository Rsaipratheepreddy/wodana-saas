import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureEnquiryTypeFlows } from "../crm/flows/enquiry-type-flows";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). The CLI runs in a child process (the
// whole Nest application context, from source) against the same database as the app role wodana_app, so tenant
// isolation, permissions and version checks apply as in production. The workspace it provisions is committed (the CLI
// works in its own connections) under a unique slug.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const run = promisify(execFile);
const fixtures = resolve(__dirname, "fixtures");

type Result = { code: number; output: string };

integration("operator CLI: import and configure through the app's services (real Postgres)", () => {
  let pool: Pool;
  const workspaceId = randomUUID(), owner = randomUUID(), outsider = randomUUID();
  const slug = `ops-${workspaceId.slice(0, 8)}`;
  const ownerEmail = `owner-${owner.slice(0, 8)}@example.test`, outsiderEmail = `outsider-${outsider.slice(0, 8)}@example.test`;
  const results: Result[] = [];
  let started: Date;

  /** Runs CLI argvs in one booted context; each run's exit code and output. */
  async function cli(runs: string[][]): Promise<Result[]> {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", "-c role=wodana_app");
    const { stdout } = await run(process.execPath, [resolve(fixtures, "run-ops-cli.cjs"), JSON.stringify(runs)], {
      env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", AUTH_MODE: "development", REDIS_URL: "" }, maxBuffer: 20 * 1024 * 1024, timeout: 280_000,
    });
    return JSON.parse(stdout.slice(stdout.lastIndexOf("@@RESULT@@") + "@@RESULT@@".length)) as Result[];
  }

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Olive Owner'),($3,$4,'Otto Outsider')", [owner, ownerEmail, outsider, outsiderEmail]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,default_timezone,created_by) VALUES($1,'Ops Studio',$2,'USD','en-US','UTC',$3)", [workspaceId, slug, owner]);
      const membership = randomUUID(), admin = randomUUID(), finance = randomUUID(), operations = randomUUID();
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, owner]);
      await client.query(`INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$4,'administrator','Administrator',true),($2,$4,'finance_team','Finance',false),
        ($3,$4,'operations','Operations',false)`, [admin, finance, operations, workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions", [workspaceId, admin]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, membership, admin]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("INSERT INTO stock_locations(id,workspace_id,kind,name,is_default) VALUES($1,$2,'warehouse','Main warehouse',true),($3,$2,'other','Showroom',false)",
        [randomUUID(), workspaceId, randomUUID()]);
      await client.query("INSERT INTO catalogs(workspace_id,code,name) VALUES($1,'main','Main catalogue')", [workspaceId]);
      await client.query(`INSERT INTO legal_entities(workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES($1,'OPS','Ops Studio','Ops Studio LLC','US','USD','en-US','UTC')`, [workspaceId]);
      await client.query("INSERT INTO workspace_work_packages(id,workspace_id,name,position) VALUES($1,$2,'Joinery',0)", [randomUUID(), workspaceId]);
      const taxonomy = randomUUID();
      await client.query("INSERT INTO crm_taxonomies(id,workspace_id,code,name) VALUES($1,$2,'enquiry_type','Enquiry type')", [taxonomy, workspaceId]);
      await client.query(`INSERT INTO crm_taxonomy_options(workspace_id,taxonomy_id,code,label,position) VALUES($1,$2,'not_sure','Not sure yet',0),
        ($1,$2,'furniture','Furniture',1),($1,$2,'early_ideas','Early ideas',2)`, [workspaceId, taxonomy]);
      await ensureEnquiryTypeFlows(client, workspaceId, { actorUserId: owner });
      await seedDefaultNotificationTemplates(client, workspaceId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    started = new Date();
    const common = ["--workspace", slug, "--as", ownerEmail];
    results.push(...await cli([
      ["import", ...common, "--target", "stock", "--file", resolve(fixtures, "stock.xlsx")],
      ["import", ...common, "--target", "stock", "--file", resolve(fixtures, "stock.xlsx"), "--apply"],
      ["import", ...common, "--target", "catalog", "--file", resolve(fixtures, "catalog.xlsx"), "--mapping", "{\"ITEM\":\"description\",\"DESCRIPTION\":\"name\"}"],
      ["import", ...common, "--target", "catalog", "--file", resolve(fixtures, "catalog.xlsx"), "--mapping", "{\"ITEM\":\"description\",\"DESCRIPTION\":\"name\"}", "--apply"],
      ["import", ...common, "--target", "suppliers", "--file", resolve(fixtures, "suppliers.csv"), "--legal-entity", "OPS"],
      ["import", ...common, "--target", "suppliers", "--file", resolve(fixtures, "suppliers.csv"), "--legal-entity", "OPS", "--apply"],
      ["import", ...common, "--target", "stock", "--file", resolve(fixtures, "stock.xlsx"), "--apply"],
      ["configure", ...common, "--profile", resolve(fixtures, "sample-profile.json")],
      ["configure", ...common, "--profile", resolve(fixtures, "sample-profile.json"), "--apply", "--json"],
      ["configure", ...common, "--profile", resolve(fixtures, "sample-profile.json"), "--json"],
      ["import", "--workspace", slug, "--as", outsiderEmail, "--target", "stock", "--file", resolve(fixtures, "stock.xlsx"), "--apply"],
      ["configure", "--workspace", slug, "--as", outsiderEmail, "--profile", resolve(fixtures, "sample-profile.json"), "--apply"],
    ]));
  }, 300_000);
  afterAll(() => pool?.end());

  const count = async (sql: string, values: unknown[] = []) => Number((await pool.query<{ count: string }>(sql, values)).rows[0].count);

  it("previews an import without changing anything, then applies it through a link the app shows", async () => {
    const [stockDry, stockApply, catalogDry, catalogApply, suppliersDry, suppliersApply, stockAgain] = results;
    expect(stockDry.code).toBe(0);
    expect(stockDry.output).toContain("HARDWARE INVENTORY: 2 added, 0 changed, 0 unchanged, 1 errors");
    expect(stockDry.output).toContain("PAINT INVENTORY: 1 added");
    expect(stockDry.output).toContain("Quantity isn't a number (…).: 1 row");
    expect(stockDry.output).not.toContain("Template");
    expect(stockApply.code).toBe(0);
    expect(stockApply.output).toContain("import partial: 3 added, 0 changed, 0 unchanged, 1 errors");
    expect(stockAgain.output).toContain("import partial: 0 added, 0 changed, 3 unchanged, 1 errors");
    expect(catalogDry.output).toContain("Preview: 4 added");
    expect(catalogApply.output).toContain("import applied: 4 added");
    expect(suppliersDry.output).toContain("suppliers.csv: 3 added");
    expect(suppliersApply.output).toContain("import applied: 3 added");
    // One link per import, made like the app's (an upload, refreshable there); two runs for the stock list.
    expect(await count(`SELECT count(*) FROM import_links WHERE workspace_id = $1 AND source = 'upload' AND status = 'active'`, [workspaceId])).toBe(3);
    expect(await count(`SELECT count(*) FROM import_runs run JOIN import_links link ON link.id = run.link_id WHERE run.workspace_id = $1 AND link.target = 'stock'`, [workspaceId])).toBe(2);
    expect(await count(`SELECT count(*) FROM catalog_items WHERE workspace_id = $1`, [workspaceId])).toBe(4);
    expect(await count(`SELECT count(*) FROM catalog_items WHERE workspace_id = $1 AND name = 'Aria Sofa - 3 seater'`, [workspaceId])).toBe(1);
  });

  it("configures every section, and a second run changes nothing", async () => {
    const [dry, apply, again] = results.slice(7, 10);
    expect(dry.code).toBe(0);
    expect(dry.output).toContain("would change");
    const applied = JSON.parse(apply.output) as { counts: Record<string, number>; lines: Array<{ section: string; status: string; label: string }> };
    expect(apply.code).toBe(0);
    expect(applied.counts.failed ?? 0).toBe(0);
    const sections = new Set(applied.lines.filter((line) => line.status === "changed").map((line) => line.section));
    expect([...sections].sort()).toEqual(["approvals", "design", "enquiryTypes", "factory", "financeRequests", "firstResponse", "orderPaths", "quotations", "rolePermissions", "routes", "vehicles"]);
    expect(applied.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ section: "enquiryTypes", status: "not found", label: "enquiry type no_such_type" }),
      expect.objectContaining({ section: "quotations", status: "not found", label: "work package Missing package" }),
      expect.objectContaining({ section: "clientUpdates", status: "manual" }),
      expect.objectContaining({ section: "rolePermissions", status: "unchanged", label: "role administrator" }),
    ]));
    const second = JSON.parse(again.output) as { counts: Record<string, number> };
    expect(again.code).toBe(0);
    expect(second.counts["would change"] ?? 0).toBe(0);
    expect(second.counts.failed ?? 0).toBe(0);
  });

  it("audits every write as the member, marked as the operator CLI", async () => {
    const rows = (await pool.query<{ via: string | null; actor: string | null; count: string }>(
      `SELECT via, actor_user_id AS actor, count(*) FROM audit_events WHERE workspace_id = $1 AND occurred_at >= $2 GROUP BY via, actor_user_id`, [workspaceId, started])).rows;
    const byOwner = rows.filter((row) => row.actor === owner);
    expect(byOwner.length).toBeGreaterThan(0);
    expect(byOwner.every((row) => row.via === "operator_cli")).toBe(true);
    expect(rows.some((row) => row.actor === outsider)).toBe(false);
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND via = 'operator_cli' AND action IN ('linked_import.linked', 'logistics.vehicle_added.v1', 'project.route_changed')`,
      [workspaceId])).toBeGreaterThanOrEqual(6);
  });

  it("refuses a person who isn't an active member of the workspace, and writes nothing for them", async () => {
    const [importAsOutsider, configureAsOutsider] = results.slice(10);
    expect(importAsOutsider.code).toBe(1);
    expect(importAsOutsider.output).toContain("is not an active member");
    expect(configureAsOutsider.code).toBe(1);
    expect(configureAsOutsider.output).toContain("is not an active member");
  });
});
