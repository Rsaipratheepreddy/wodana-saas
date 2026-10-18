import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyPassword } from "../auth/local-password";
import { flowChecksum } from "../crm/flows/flow-definition";
import { STARTER_FLOWS } from "../crm/flows/starter-flows";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). The CLI runs in a child process (the
// whole Nest application context, from source) as the app role wodana_app, so provisioning, tenant isolation,
// permissions and version checks apply as in production. The sandbox it makes is committed under a unique slug.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const run = promisify(execFile);
const fixtures = resolve(__dirname, "fixtures");
const docs = resolve(__dirname, "../../../../docs/fixtures");
const PASSWORD = `Sandbox#${randomUUID().slice(0, 8)}A1`;

type Result = { code: number; output: string };
type Json = { counts: Record<string, number>; lines: Array<{ section: string; status: string; label: string; detail?: string }>;
  members: Array<{ email: string; roles: string[]; teams: string[]; userId: string | null }>; workspace: { id?: string }; deviceLimitExemptUserIds?: string };

integration("operator CLI sandbox: a test workspace through the app's own provisioning (real Postgres)", () => {
  let pool: Pool;
  const slug = `sbx-${randomUUID().slice(0, 8)}`;
  const otherId = randomUUID(), otherOwner = randomUUID();
  const otherSlug = `other-${otherId.slice(0, 8)}`;
  const full = ["sandbox", "--slug", slug, "--name", "Sandbox Test", "--region", "AE", "--profile", resolve(docs, "palm-golive-config.json"),
    "--teams", resolve(docs, "palm-teams-access.json"), "--crm", resolve(docs, "palm-crm-intake-profile.json"), "--password-env", "SANDBOX_TEST_PASSWORD", "--seed"];
  let dry: Result;
  let workspaceBeforeApply = -1;
  let first: Result, second: Result, again: Result, withoutTeams: Result, refused: Result, outsider: Result;

  async function cli(runs: string[][]): Promise<Result[]> {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", "-c role=wodana_app");
    const { stdout } = await run(process.execPath, [resolve(fixtures, "run-ops-cli.cjs"), JSON.stringify(runs)], {
      env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", AUTH_MODE: "development", REDIS_URL: "", SANDBOX_TEST_PASSWORD: PASSWORD,
        PORTAL_OTP_SECRET: "sandbox-integration-portal-secret-0123456789" },
      maxBuffer: 50 * 1024 * 1024, timeout: 400_000,
    });
    return JSON.parse(stdout.slice(stdout.lastIndexOf("@@RESULT@@") + "@@RESULT@@".length)) as Result[];
  }
  const count = async (sql: string, values: unknown[] = []) => Number((await pool.query<{ count: string }>(sql, values)).rows[0].count);
  const json = (result: Result) => JSON.parse(result.output) as Json;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
    // Another organization, made outside the sandbox command: its slug must be refused and its data never seen.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Other Owner')", [otherOwner, `owner-${otherOwner.slice(0, 8)}@example.test`]);
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [otherId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,default_timezone,created_by) VALUES($1,'Other Studio',$2,'USD','en-US','UTC',$3)", [otherId, otherSlug, otherOwner]);
      await client.query("INSERT INTO tenant_login_branding(workspace_id,login_slug,display_name) VALUES($1,$2,'Other Studio')", [otherId, otherSlug]);
      await client.query(`INSERT INTO legal_entities(workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES($1,'OTH','Other Studio','Other Studio LLC','US','USD','en-US','UTC')`, [otherId]);
      await client.query("INSERT INTO workspace_memberships(workspace_id,user_id,status) VALUES($1,$2,'active')", [otherId, otherOwner]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    [dry] = await cli([full]);
    workspaceBeforeApply = await count(`SELECT count(*) FROM tenant_login_branding WHERE login_slug = $1`, [slug]);
    [first, second, again, withoutTeams, refused, outsider] = await cli([
      [...full, "--apply"],
      [...full, "--apply", "--json"],
      [...full, "--json"],
      // A re-run without --teams leaves the members (team-only ones included) as they are.
      ["sandbox", "--slug", slug, "--name", "Sandbox Test", "--region", "AE", "--password-env", "SANDBOX_TEST_PASSWORD", "--apply", "--json"],
      ["sandbox", "--slug", otherSlug, "--name", "Other Studio", "--region", "AE", "--password-env", "SANDBOX_TEST_PASSWORD", "--apply"],
      ["configure", "--workspace", otherSlug, "--as", `owner@${slug}.test`, "--profile", resolve(fixtures, "sample-profile.json"), "--apply"],
    ]);
  }, 600_000);
  afterAll(() => pool?.end());

  const workspaceId = async () => (await pool.query<{ id: string }>(`SELECT workspace_id AS id FROM tenant_login_branding WHERE login_slug = $1`, [slug])).rows[0]?.id;

  it("previews without making anything", () => {
    expect(dry.code, dry.output).toBe(0);
    expect(dry.output).toContain(`[workspace] would change ${slug}: provisioned: AE region pack`);
    expect(dry.output).toContain(`owner@${slug}.test`);
    expect(workspaceBeforeApply).toBe(0);
  });

  it("provisions the workspace like Wodana Control: region pack, firm kit, login slug, seats, no authenticator needed", async () => {
    expect(first.code, first.output).toBe(0);
    const id = await workspaceId();
    expect(id).toBeTruthy();
    const region = (await pool.query<{ configuration: { currency: string; locale: string; timezone: string } }>(
      `SELECT configuration FROM tenant_setup_profiles WHERE kind = 'region' AND code = 'AE' AND selectable ORDER BY version DESC LIMIT 1`)).rows[0].configuration;
    const workspace = (await pool.query(`SELECT name, slug, status, default_currency AS currency, default_locale AS locale, default_timezone AS timezone FROM workspaces WHERE id = $1`, [id])).rows[0];
    expect(workspace).toEqual({ name: "Sandbox Test", slug, status: "active", currency: region.currency, locale: region.locale, timezone: region.timezone });
    expect((await pool.query(`SELECT region_code, firm_kit_code, plan_code FROM workspace_setup_versions WHERE workspace_id = $1`, [id])).rows[0])
      .toEqual({ region_code: "AE", firm_kit_code: "design_build_deal_first", plan_code: "starter" });
    expect(await count(`SELECT count(*) FROM tenant_provisioning_requests WHERE external_tenant_id = $1 AND workspace_id = $2`, [`sandbox-${slug}`, id])).toBe(1);
    expect(Number((await pool.query(`SELECT seat_limit FROM workspace_subscriptions WHERE workspace_id = $1`, [id])).rows[0].seat_limit)).toBeGreaterThanOrEqual(12);
    const policy = (await pool.query(`SELECT account.security_policy AS policy FROM customer_account_organizations linked JOIN customer_accounts account ON account.id = linked.account_id
      WHERE linked.workspace_id = $1`, [id])).rows[0].policy;
    expect(policy).toMatchObject({ requireMfaForAdmins: false, requireMfaForAllUsers: false });
    expect(await count(`SELECT count(*) FROM workspace_onboarding WHERE workspace_id = $1 AND status = 'completed'`, [id])).toBe(1);
    // The region pack's tax model with its standard rate.
    expect(await count(`SELECT count(*) FROM tax_rates WHERE workspace_id = $1 AND is_default AND effective_to IS NULL`, [id])).toBe(1);
  });

  it("makes one active member per role with the workspace's roles and teams and a password, printing ids but never the password", async () => {
    const id = await workspaceId();
    const members = (await pool.query<{ email: string; status: string; roles: string[]; teams: string[]; userId: string }>(
      `SELECT person.primary_email AS email, membership.status, person.id AS "userId",
              ARRAY(SELECT role.code FROM member_roles link JOIN roles role ON role.id = link.role_id WHERE link.membership_id = membership.id ORDER BY role.code) AS roles,
              ARRAY(SELECT team.code FROM workspace_team_members link JOIN workspace_teams team ON team.id = link.team_id WHERE link.membership_id = membership.id ORDER BY team.code) AS teams
         FROM workspace_memberships membership JOIN users person ON person.id = membership.user_id WHERE membership.workspace_id = $1 ORDER BY person.primary_email`, [id])).rows;
    const by = Object.fromEntries(members.map((member) => [member.email.replace(`@${slug}.test`, ""), member]));
    expect(Object.keys(by).sort()).toEqual(["accountant", "design-manager", "designer", "factory", "finance", "logistics", "manager", "owner", "purchasing", "qs", "sales", "site"]);
    expect(members.every((member) => member.status === "active")).toBe(true);
    expect(by.owner.roles).toEqual(["owner"]);
    expect(by.sales).toMatchObject({ roles: ["sales"], teams: ["SALES"] });
    expect(by.qs).toMatchObject({ roles: ["quantity_surveyor"], teams: ["QS"] });
    expect(by.designer.teams).toEqual(["INTERIOR_DESIGN"]);
    // Team-only members keep no role of their own, even after a re-run without --teams (no "member" role added).
    expect([by.designer.roles, by["design-manager"].roles]).toEqual([[], []]);
    expect(withoutTeams.code, withoutTeams.output).toBe(0);
    expect(json(withoutTeams).lines.filter((line) => line.section === "members" && line.status === "changed")).toEqual([]);
    expect(by.manager.roles).toEqual(["administrator", "operations_approver", "project_manager"]);
    const credentials = (await pool.query<{ hash: string; salt: string }>(
      `SELECT password_hash AS hash, password_salt AS salt FROM local_auth_credentials WHERE user_id = ANY($1::uuid[])`, [members.map((member) => member.userId)])).rows;
    expect(credentials).toHaveLength(12);
    expect(await verifyPassword(PASSWORD, credentials[0].salt, credentials[0].hash)).toBe(true);
    expect(await count(`SELECT count(*) FROM user_identities WHERE provider = 'local' AND user_id = ANY($1::uuid[])`, [members.map((member) => member.userId)])).toBe(12);
    for (const result of [dry, first, second, again]) expect(result.output).not.toContain(PASSWORD);
    expect(first.output).toContain(`owner@${slug}.test`);
    expect(first.output).toContain(by.sales.userId);
    expect(json(second).deviceLimitExemptUserIds?.split(",").sort()).toEqual(members.map((member) => member.userId).sort());
    expect(first.output).toContain("emails were not sent");
  });

  it("copies no real address from the profile, and says so", async () => {
    const id = await workspaceId();
    expect(first.output).toContain("financeRequests.inbox: an email address: not copied into a sandbox");
    expect((await pool.query(`SELECT finance_inbox FROM finance_request_settings WHERE workspace_id = $1`, [id])).rows[0]?.finance_inbox ?? null).toBeNull();
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND (coalesce(after::text, '') ILIKE '%palmlivingae%' OR coalesce(before::text, '') ILIKE '%palmlivingae%')`, [id])).toBe(0);
    // Nor the firm's name: the lead options, the seeded notices and the showcase's client say the sandbox's own words.
    expect(first.output).toMatch(/firm name: \d+ labels say Sandbox Test, not the firm the file was written for/);
    expect(await count(`SELECT count(*) FROM crm_taxonomy_options WHERE workspace_id = $1 AND label ILIKE '%palm living%'`, [id])).toBe(0);
    expect(await count(`SELECT count(*) FROM crm_taxonomies WHERE workspace_id = $1 AND name ILIKE '%palm living%'`, [id])).toBe(0);
    expect(await count(`SELECT count(*) FROM crm_taxonomy_options WHERE workspace_id = $1 AND label = 'Sandbox Test Enquiry'`, [id])).toBe(1);
    expect(await count(`SELECT count(*) FROM notifications WHERE workspace_id = $1 AND (coalesce(subject, '') || body) ILIKE ANY (ARRAY['%palm living%', '%palmliving%'])`, [id])).toBe(0);
    expect(await count(`SELECT count(*) FROM crm_contact_points WHERE workspace_id = $1 AND raw_value ILIKE '%palmliving%'`, [id])).toBe(0);
    // The rest of the profile, the teams and the lead options are there.
    expect(await count(`SELECT count(*) FROM workspace_teams WHERE workspace_id = $1`, [id])).toBe(20);
    expect(await count(`SELECT count(*) FROM crm_taxonomy_options choice JOIN crm_taxonomies taxonomy ON taxonomy.id = choice.taxonomy_id
      WHERE choice.workspace_id = $1 AND taxonomy.code = 'enquiry_type' AND choice.code = 'furniture_only' AND choice.status = 'active'`, [id])).toBe(1);
    // QA-002: each enquiry type's steps start from its flow (Design, Fit-out, Furniture), not a two-step Basic copy.
    const starters = Object.fromEntries((await pool.query<{ code: string; starter: string }>(
      `SELECT choice.code, coalesce(origin.code, owned.code) AS starter FROM crm_taxonomy_options choice
         JOIN crm_taxonomies taxonomy ON taxonomy.id = choice.taxonomy_id AND taxonomy.code = 'enquiry_type'
         JOIN crm_flows owned ON owned.workspace_id = choice.workspace_id AND owned.enquiry_type_option_id = choice.id
         LEFT JOIN crm_flows origin ON origin.workspace_id = owned.workspace_id AND origin.id = owned.split_from_flow_id
        WHERE choice.workspace_id = $1 AND choice.status = 'active'`, [id])).rows.map((row) => [row.code, row.starter]));
    expect(starters).toMatchObject({ interior_design_furniture: "design", furniture_only: "furniture", full_fit_out: "fit_out" });
  });

  it("seeds the showcase through the members, so every main section has records", async () => {
    const id = await workspaceId();
    expect(first.output).toMatch(/\[seed\] changed +showcase: [1-9]\d* created/);
    expect(await count(`SELECT count(*) FROM crm_leads WHERE workspace_id = $1`, [id])).toBeGreaterThan(0);
    expect(await count(`SELECT count(*) FROM commercial_quotes WHERE workspace_id = $1`, [id])).toBeGreaterThan(0);
    expect(await count(`SELECT count(*) FROM project_execution WHERE workspace_id = $1`, [id])).toBeGreaterThan(0);
    expect(await count(`SELECT count(*) FROM purchase_orders WHERE workspace_id = $1`, [id])).toBeGreaterThan(0);
    expect(await count(`SELECT count(*) FROM site_reports WHERE workspace_id = $1`, [id])).toBeGreaterThan(0);
    // In the emirates the showcase keeps its clients as written.
    expect((await pool.query(`SELECT party.display_name AS name, phone.raw_value AS phone, enquiry.details->>'area' AS area, enquiry.details->>'emirate' AS emirate, enquiry.title
        FROM crm_intake_events intake JOIN crm_enquiries enquiry ON enquiry.workspace_id = intake.workspace_id AND enquiry.intake_event_id = intake.id
        JOIN crm_parties party ON party.workspace_id = enquiry.workspace_id AND party.id = enquiry.party_id
        JOIN crm_contact_points phone ON phone.workspace_id = party.workspace_id AND phone.party_id = party.id AND phone.type = 'phone'
       WHERE intake.workspace_id = $1 AND intake.external_event_id IN ('SHOWCASE-ENQ-6', 'SHOWCASE-MARINA-1804') ORDER BY intake.external_event_id`, [id])).rows).toEqual([
      { name: "Nikolai Petrov", phone: "+971506000016", area: "Palm Jumeirah", emirate: "dubai", title: "Nikolai Petrov · Palm Jumeirah, Dubai" },
      { name: "Reem Al Marzouqi", phone: "+971502000002", area: "Dubai Marina", emirate: "dubai", title: "Reem Al Marzouqi · Dubai Marina, Dubai" },
    ]);
  });

  it("changes nothing on a second run, and its dry run has nothing left to do", () => {
    const applied = json(second);
    expect(second.code, second.output).toBe(0);
    expect(applied.counts.changed ?? 0).toBe(0);
    expect(applied.counts.failed ?? 0).toBe(0);
    expect(applied.lines).toEqual(expect.arrayContaining([expect.objectContaining({ section: "seed", status: "unchanged", label: "showcase" })]));
    const preview = json(again);
    expect(again.code, again.output).toBe(0);
    expect(preview.counts["would change"] ?? 0).toBe(0);
  });

  it("audits every write, marked as the operator CLI", async () => {
    const id = await workspaceId();
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND via IS DISTINCT FROM 'operator_cli'`, [id])).toBe(0);
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action IN ('workspace.provisioned', 'workspace.invitation_accepted', 'auth.local_password_set',
      'tenant.security_policy_updated', 'workspace.member_invited')`, [id])).toBe(1 + 12 + 12 + 1 + 11);
    expect(await count(`SELECT count(*) FROM platform_operator_audit WHERE action = 'tenant.security_policy_updated' AND target_id = $1`, [`sandbox-${slug}`])).toBe(1);
  });

  it("refuses another organization's slug and changes nothing there; its members see nothing of it", async () => {
    expect(refused.code).toBe(1);
    expect(refused.output).toContain("belongs to an organization this command didn't make");
    expect(await count(`SELECT count(*) FROM tenant_provisioning_requests WHERE external_tenant_id = $1`, [`sandbox-${otherSlug}`])).toBe(0);
    expect(await count(`SELECT count(*) FROM workspace_memberships WHERE workspace_id = $1`, [otherId])).toBe(1);
    expect(outsider.code).toBe(1);
    expect(outsider.output).toContain("is not an active member");
    // Tenant isolation, as the app role in the sandbox owner's context: the other organization's rows don't exist.
    const id = await workspaceId();
    const owner = (await pool.query<{ id: string }>(`SELECT id FROM users WHERE primary_email = $1`, [`owner@${slug}.test`])).rows[0].id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_actor_id', $2, true)", [id, owner]);
      const seen = async (sql: string) => Number((await client.query<{ count: string }>(sql, [otherId])).rows[0].count);
      expect(await seen(`SELECT count(*) FROM legal_entities WHERE workspace_id = $1`)).toBe(0);
      expect(await seen(`SELECT count(*) FROM workspace_memberships WHERE workspace_id = $1`)).toBe(0);
      expect(Number((await client.query<{ count: string }>(`SELECT count(*) FROM legal_entities`)).rows[0].count)).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("QA-002: a later run repairs a workspace made before enquiry types started from their flows (untouched Basic copies only), once, audited", async () => {
    const id = await workspaceId();
    const basic = STARTER_FLOWS.basic.definition;
    const typeId = async (code: string) => (await pool.query<{ id: string }>(`SELECT choice.id FROM crm_taxonomy_options choice
      JOIN crm_taxonomies taxonomy ON taxonomy.id = choice.taxonomy_id AND taxonomy.code = 'enquiry_type' WHERE choice.workspace_id = $1 AND choice.code = $2`, [id, code])).rows[0].id;
    // As the CLI used to leave it: these types own an untouched copy of Basic; another one's Basic copy was edited by the firm.
    for (const [code, edited] of [["furniture_only", false], ["interior_design_furniture", false], ["full_fit_out", true]] as const) {
      const type = await typeId(code);
      await pool.query(`UPDATE crm_flows SET enquiry_type_option_id = NULL, status = CASE WHEN code IN ('basic', 'design', 'fit_out', 'furniture') THEN status ELSE 'archived' END
        WHERE workspace_id = $1 AND enquiry_type_option_id = $2`, [id, type]);
      const flow = (await pool.query<{ id: string }>(`INSERT INTO crm_flows (workspace_id, code, name, enquiry_type_option_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [id, `${code.slice(0, 30)}_old`, code, type])).rows[0].id;
      await pool.query(`INSERT INTO crm_flow_versions (workspace_id, flow_id, version, definition, checksum, source) VALUES ($1, $2, 1, $3::jsonb, $4, 'starter')`,
        [id, flow, JSON.stringify(basic), flowChecksum(basic)]);
      if (edited) await pool.query(`INSERT INTO crm_flow_versions (workspace_id, flow_id, version, definition, checksum, source) VALUES ($1, $2, 2, $3::jsonb, $4, 'published')`,
        [id, flow, JSON.stringify(basic), flowChecksum(basic)]);
      await pool.query(`UPDATE crm_taxonomy_options SET flow = $3 WHERE workspace_id = $1 AND id = $2`, [id, type, `${code.slice(0, 30)}_old`]);
    }
    const [preview, repair, rerun] = await cli([[...full, "--json"], [...full, "--apply", "--json"], [...full, "--apply", "--json"]]);
    for (const result of [preview, repair, rerun]) expect(result.code, result.output).toBe(0);
    const repairs = (result: Result) => json(result).lines.filter((line) => line.label.startsWith("enquiry_type ›")).map((line) => [line.label, line.status]).sort();
    expect(repairs(preview)).toEqual([["enquiry_type › furniture_only", "would change"], ["enquiry_type › interior_design_furniture", "would change"]]);
    expect(repairs(repair)).toEqual([["enquiry_type › furniture_only", "changed"], ["enquiry_type › interior_design_furniture", "changed"]]);
    const starters = Object.fromEntries((await pool.query<{ code: string; starter: string }>(
      `SELECT choice.code, coalesce(origin.code, owned.code) AS starter FROM crm_taxonomy_options choice
         JOIN crm_taxonomies taxonomy ON taxonomy.id = choice.taxonomy_id AND taxonomy.code = 'enquiry_type'
         JOIN crm_flows owned ON owned.workspace_id = choice.workspace_id AND owned.enquiry_type_option_id = choice.id
         LEFT JOIN crm_flows origin ON origin.workspace_id = owned.workspace_id AND origin.id = owned.split_from_flow_id
        WHERE choice.workspace_id = $1 AND choice.status = 'active'`, [id])).rows.map((row) => [row.code, row.starter]));
    // Repaired; the firm's edited steps stay as they are.
    expect(starters).toMatchObject({ furniture_only: "furniture", interior_design_furniture: "design", full_fit_out: "full_fit_out_old" });
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action = 'crm.enquiry_type.flow_repaired.v1'`, [id])).toBe(2);
    // Run again: nothing left to repair.
    expect(repairs(rerun)).toEqual([]);
    expect(json(rerun).lines.find((line) => line.label === "enquiry type flows")?.status).toBe("unchanged");
  }, 600_000);
});
