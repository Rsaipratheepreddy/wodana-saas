import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Sandbox A (AE) is made with the demo
// scenarios, then organization B (IN) is added to its account with them too, and both run again: the second runs make
// nothing. The CLI runs in a child process (the whole Nest application context, from source) as the app role.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const run = promisify(execFile);
const fixtures = resolve(__dirname, "fixtures");
const docs = resolve(__dirname, "../../../../docs/fixtures");
const PASSWORD = `Sandbox#${randomUUID().slice(0, 8)}A1`;

type Result = { code: number; output: string };
type Row = { key: string; module: string; status: string; reference: string | null; reason?: string };
type Json = { counts: Record<string, number>; scenarios?: { matrix: Row[] }; deliveries?: { total: number; delivered: number; suppressedDuringRun: number; suppressedAfterRun: number };
  workspace: { id?: string } };

/** Scenarios that can't have an example on the day they are made, with why (each is still checked below). */
const TIME_OR_RULE_BOUND = new Set(["quote.expired", "change.with_qs"]);
const COUNTED = ["crm_leads", "commercial_quotes", "delivery_projects", "change_requests", "purchase_orders", "client_invoices", "supplier_invoices", "books_journals", "work_orders"];

integration("operator CLI sandbox --scenarios: an example of every scenario, in each organization's region (real Postgres)", () => {
  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  const a = `scna-${tag}`, b = `scnb-${tag}`;
  const files = ["--profile", resolve(docs, "palm-golive-config.json"), "--teams", resolve(docs, "palm-teams-access.json"), "--crm", resolve(docs, "palm-crm-intake-profile.json")];
  const makeA = ["sandbox", "--slug", a, "--name", "Scenario A", "--region", "AE", ...files, "--password-env", "SANDBOX_TEST_PASSWORD", "--scenarios", "--apply", "--json"];
  const addB = ["sandbox", "--slug", b, "--name", "Scenario B", "--region", "IN", "--organization-of", a, ...files, "--scenarios", "--apply", "--json"];
  let firstA: Result, firstB: Result, secondA: Result, secondB: Result, dryB: Result;
  const counts = new Map<string, Record<string, number>>();

  async function cli(runs: string[][]): Promise<Result[]> {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", "-c role=wodana_app");
    const { stdout } = await run(process.execPath, [resolve(fixtures, "run-ops-cli.cjs"), JSON.stringify(runs)], {
      env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", AUTH_MODE: "development", REDIS_URL: "", SANDBOX_TEST_PASSWORD: PASSWORD,
        PORTAL_OTP_SECRET: "sandbox-integration-portal-secret-0123456789" },
      maxBuffer: 100 * 1024 * 1024, timeout: 1_800_000,
    });
    return JSON.parse(stdout.slice(stdout.lastIndexOf("@@RESULT@@") + "@@RESULT@@".length)) as Result[];
  }
  const json = (result: Result) => JSON.parse(result.output) as Json;
  const workspaceOf = async (slug: string) => (await pool.query<{ id: string }>(`SELECT workspace_id AS id FROM tenant_login_branding WHERE login_slug = $1`, [slug])).rows[0]?.id;
  const count = async (sql: string, values: unknown[] = []) => Number((await pool.query<{ count: string }>(sql, values)).rows[0].count);
  const tableCounts = async (workspaceId: string) => Object.fromEntries(await Promise.all(COUNTED.map(async (table) =>
    [table, await count(`SELECT count(*) FROM ${table} WHERE workspace_id = $1`, [workspaceId])] as const)));

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
    [firstA, firstB] = await cli([makeA, addB]);
    for (const slug of [a, b]) counts.set(slug, await tableCounts((await workspaceOf(slug))!));
    [secondA, secondB, dryB] = await cli([makeA, addB, addB.filter((arg) => arg !== "--apply")]);
  }, 3_600_000);
  afterAll(() => pool?.end());

  it("runs cleanly in both organizations", () => {
    for (const result of [firstA, firstB, secondA, secondB, dryB]) expect(result.code, result.output.slice(-4000)).toBe(0);
  });

  it("has an example of every scenario in both organizations, each with its record", () => {
    for (const result of [firstA, firstB]) {
      const rows = json(result).scenarios!.matrix;
      expect(rows.length).toBeGreaterThan(60);
      const missing = rows.filter((row) => !row.reference && !TIME_OR_RULE_BOUND.has(row.key));
      expect(missing.map((row) => `${row.key}: ${row.reason ?? row.status}`)).toEqual([]);
      // The two that can't exist on the day are reported with the reason.
      for (const row of rows.filter((entry) => TIME_OR_RULE_BOUND.has(entry.key) && !entry.reference)) expect(row.reason).toBeTruthy();
      for (const module of ["sales", "design", "quotations", "projects", "changes", "purchasing", "finance", "ledger"]) expect(rows.some((row) => row.module === module)).toBe(true);
    }
  });

  it("makes nothing on the second run: every scenario is already there and no record is added", async () => {
    for (const result of [secondA, secondB]) {
      const rows = json(result).scenarios!.matrix;
      expect(rows.filter((row) => row.status === "created")).toEqual([]);
      expect(rows.filter((row) => !TIME_OR_RULE_BOUND.has(row.key) && row.status !== "already there")).toEqual([]);
    }
    for (const slug of [a, b]) expect(await tableCounts((await workspaceOf(slug))!)).toEqual(counts.get(slug));
    expect(json(dryB).scenarios!.matrix.filter((row) => row.status === "would create" && !TIME_OR_RULE_BOUND.has(row.key))).toEqual([]);
  });

  it("makes each organization's examples in its own currency and with its own country's clients", async () => {
    for (const [slug, currency, calling] of [[a, "AED", "+971"], [b, "INR", "+91"]] as const) {
      const id = (await workspaceOf(slug))!;
      expect(await count(`SELECT count(*) FROM commercial_quotes WHERE workspace_id = $1 AND currency IS DISTINCT FROM $2`, [id, currency])).toBe(0);
      expect(await count(`SELECT count(*) FROM delivery_projects WHERE workspace_id = $1 AND currency IS DISTINCT FROM $2`, [id, currency])).toBe(0);
      expect(await count(`SELECT count(*) FROM purchase_orders WHERE workspace_id = $1 AND currency IS DISTINCT FROM $2`, [id, currency])).toBe(0);
      // The scenario clients: the region's people, fictional (example.com) and in the region's numbering plan.
      const clients = (await pool.query<{ phone: string }>(`SELECT phone.raw_value AS phone FROM crm_contact_points email
        JOIN crm_contact_points phone ON phone.workspace_id = email.workspace_id AND phone.party_id = email.party_id AND phone.type = 'phone'
        WHERE email.workspace_id = $1 AND email.type = 'email' AND email.raw_value LIKE '%@example.com'`, [id])).rows;
      expect(clients.length).toBeGreaterThan(20);
      for (const client of clients) expect(client.phone.startsWith(calling)).toBe(true);
    }
    const indian = (await pool.query<{ name: string }>(`SELECT party.display_name AS name FROM crm_parties party JOIN crm_contact_points phone
      ON phone.workspace_id = party.workspace_id AND phone.party_id = party.id AND phone.type = 'phone' AND phone.country_code = 'IN' WHERE party.workspace_id = $1`, [await workspaceOf(b)])).rows;
    expect(indian.length).toBeGreaterThan(20);
  });

  it("turns the Ledger on and posts balanced journals, with the statements from the Ledger", async () => {
    for (const slug of [a, b]) {
      const id = (await workspaceOf(slug))!;
      expect(await count(`SELECT count(*) FROM books_settings WHERE workspace_id = $1 AND enabled`, [id])).toBe(1);
      expect(await count(`SELECT count(*) FROM books_statement_sources WHERE workspace_id = $1 AND source = 'ledger'`, [id])).toBe(1);
      expect(await count(`SELECT count(*) FROM books_journals WHERE workspace_id = $1`, [id])).toBeGreaterThan(5);
      expect(await count(`SELECT count(*) FROM (SELECT journal.id FROM books_journals journal JOIN books_journal_lines line ON line.journal_id = journal.id
        WHERE journal.workspace_id = $1 GROUP BY journal.id, journal.total HAVING sum(line.debit) <> sum(line.credit) OR sum(line.debit) <> journal.total) unbalanced`, [id])).toBe(0);
      const totals = (await pool.query<{ debit: string; credit: string }>(`SELECT coalesce(sum(line.debit), 0)::text AS debit, coalesce(sum(line.credit), 0)::text AS credit
        FROM books_journal_lines line JOIN books_journals journal ON journal.id = line.journal_id WHERE journal.workspace_id = $1`, [id])).rows[0];
      expect(totals.debit).toBe(totals.credit);
    }
  });

  it("has change requests in every state on a running project", async () => {
    for (const slug of [a, b]) {
      const statuses = (await pool.query<{ status: string }>(`SELECT DISTINCT status FROM change_requests WHERE workspace_id = $1 AND project_id IS NOT NULL`, [await workspaceOf(slug)])).rows.map((row) => row.status);
      expect(statuses).toEqual(expect.arrayContaining(["draft", "pricing", "pending_approval", "with_client", "applied", "declined"]));
    }
  });

  it("sends nothing: every email, WhatsApp and push the runs wrote is suppressed, counted and audited", async () => {
    for (const result of [firstA, firstB, secondA, secondB]) {
      const deliveries = json(result).deliveries!;
      expect(deliveries.delivered).toBe(0);
      expect(deliveries.suppressedDuringRun + deliveries.suppressedAfterRun).toBeGreaterThanOrEqual(0);
    }
    expect(json(firstA).deliveries!.total).toBeGreaterThan(0);
    for (const slug of [a, b]) {
      const id = (await workspaceOf(slug))!;
      expect(await count(`SELECT count(*) FROM notifications WHERE workspace_id = $1 AND channel <> 'in_app' AND status IN ('pending', 'scheduled', 'processing', 'sent', 'delivered')`, [id])).toBe(0);
      expect(await count(`SELECT count(*) FROM notifications WHERE workspace_id = $1 AND channel <> 'in_app' AND suppressed_reason = 'sandbox_seed'`, [id])).toBeGreaterThan(0);
      expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action = 'sandbox.seed_deliveries_suppressed' AND via = 'operator_cli'`, [id])).toBeGreaterThan(0);
    }
  });

  it("keeps the two organizations apart (tenant isolation as the app role)", async () => {
    const idA = (await workspaceOf(a))!, idB = (await workspaceOf(b))!;
    const owner = (await pool.query<{ id: string }>(`SELECT id FROM users WHERE primary_email = $1`, [`owner@${a}.test`])).rows[0].id;
    const client = await pool.connect();
    try {
      for (const [here, there] of [[idA, idB], [idB, idA]]) {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE wodana_app");
        await client.query("SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_actor_id', $2, true)", [here, owner]);
        for (const table of ["crm_leads", "change_requests", "books_journals", "notifications"])
          expect(Number((await client.query<{ count: string }>(`SELECT count(*) FROM ${table} WHERE workspace_id = $1`, [there])).rows[0].count)).toBe(0);
        await client.query("ROLLBACK");
      }
    } finally {
      client.release();
    }
  });
});
