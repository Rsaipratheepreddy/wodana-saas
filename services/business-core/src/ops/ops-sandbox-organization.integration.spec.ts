import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { regionFixture } from "./scenarios/scenario-regions";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Sandbox A is made in one region, then
// --organization-of A adds organization B in another region to A's customer account, for A's own test members. The CLI
// runs in a child process (the whole Nest application context, from source) as the app role wodana_app.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const run = promisify(execFile);
const fixtures = resolve(__dirname, "fixtures");
const docs = resolve(__dirname, "../../../../docs/fixtures");
const PASSWORD = `Sandbox#${randomUUID().slice(0, 8)}A1`;

type Result = { code: number; output: string };
type Json = { counts: Record<string, number>; lines: Array<{ section: string; status: string; label: string; detail?: string }>;
  members: Array<{ email: string; roles: string[]; teams: string[]; userId: string | null }>; workspace: { id?: string }; newUserIds?: string[] };
type Member = { email: string; status: string; roles: string[]; teams: string[]; userId: string };

integration("operator CLI sandbox --organization-of: a second organization in the sandbox's account (real Postgres)", () => {
  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  const a = `sbxa-${tag}`, b = `sbxb-${tag}`;
  const otherId = randomUUID(), otherOwner = randomUUID(), foreignId = randomUUID();
  const otherSlug = `other-${otherId.slice(0, 8)}`, foreignSlug = `foreign-${foreignId.slice(0, 8)}`;
  const files = ["--teams", resolve(docs, "palm-teams-access.json"), "--crm", resolve(docs, "palm-crm-intake-profile.json")];
  const makeA = ["sandbox", "--slug", a, "--name", "Sandbox A", "--region", "AE", ...files, "--password-env", "SANDBOX_TEST_PASSWORD"];
  const addB = ["sandbox", "--slug", b, "--name", "Sandbox B", "--region", "IN", "--organization-of", a, "--profile", resolve(docs, "palm-golive-config.json"), ...files, "--seed"];
  const renameA = ["sandbox", "--slug", a, "--name", "Sandbox A UAE", "--region", "AE", ...files];
  let usersBefore = -1, usersAfter = -1, workspacesBeforeApply = -1, limitAfter = -1, accountBefore: { limit: number; version: number } | null = null;
  let dry: Result, first: Result, second: Result, again: Result, rename: Result, renameAgain: Result;
  let unknownBase: Result, nonSandboxBase: Result, takenSlug: Result, foreignAccount: Result;

  async function cli(runs: string[][]): Promise<Result[]> {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", "-c role=wodana_app");
    const { stdout } = await run(process.execPath, [resolve(fixtures, "run-ops-cli.cjs"), JSON.stringify(runs)], {
      env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", AUTH_MODE: "development", REDIS_URL: "", SANDBOX_TEST_PASSWORD: PASSWORD,
        PORTAL_OTP_SECRET: "sandbox-integration-portal-secret-0123456789" },
      maxBuffer: 50 * 1024 * 1024, timeout: 900_000,
    });
    return JSON.parse(stdout.slice(stdout.lastIndexOf("@@RESULT@@") + "@@RESULT@@".length)) as Result[];
  }
  const count = async (sql: string, values: unknown[] = []) => Number((await pool.query<{ count: string }>(sql, values)).rows[0].count);
  const json = (result: Result) => JSON.parse(result.output) as Json;
  const workspaceOf = async (slug: string) => (await pool.query<{ id: string }>(`SELECT workspace_id AS id FROM tenant_login_branding WHERE login_slug = $1`, [slug])).rows[0]?.id;
  const accountOf = async (workspaceId: string) => (await pool.query<{ id: string }>(`SELECT account_id AS id FROM customer_account_organizations WHERE workspace_id = $1`, [workspaceId])).rows[0]?.id;
  const members = async (workspaceId: string) => (await pool.query<Member>(
    `SELECT person.primary_email AS email, membership.status, person.id AS "userId",
            ARRAY(SELECT role.code FROM member_roles link JOIN roles role ON role.id = link.role_id WHERE link.membership_id = membership.id ORDER BY role.code) AS roles,
            ARRAY(SELECT team.code FROM workspace_team_members link JOIN workspace_teams team ON team.id = link.team_id WHERE link.membership_id = membership.id ORDER BY team.code) AS teams
       FROM workspace_memberships membership JOIN users person ON person.id = membership.user_id WHERE membership.workspace_id = $1 ORDER BY person.primary_email`, [workspaceId])).rows;
  const testUsers = () => count(`SELECT count(*) FROM users WHERE primary_email::text LIKE $1`, [`%@${a}.test`]);

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
    // An organization made outside the sandbox command: never a base for --organization-of, its slug never taken over.
    await insertOrganization(otherId, otherSlug, "Other Studio", null);
    const [, made] = await cli([makeA, [...makeA, "--apply"]]);
    expect(made.code, made.output).toBe(0);
    const accountA = await accountOf((await workspaceOf(a))!);
    accountBefore = (await pool.query<{ limit: number; version: number }>(`SELECT organization_limit AS limit, version FROM customer_accounts WHERE id = $1`, [accountA])).rows[0];
    usersBefore = await testUsers();
    [dry] = await cli([addB]);
    workspacesBeforeApply = await count(`SELECT count(*) FROM tenant_login_branding WHERE login_slug = $1`, [b]);
    [first, second, again, rename, renameAgain, unknownBase, nonSandboxBase, takenSlug] = await cli([
      [...addB, "--apply"],
      [...addB, "--apply", "--json"],
      [...addB, "--json"],
      [...renameA, "--apply"],
      [...renameA, "--apply", "--json"],
      ["sandbox", "--slug", `sbxc-${tag}`, "--name", "Sandbox C", "--region", "IN", "--organization-of", `nope-${tag}`, "--apply"],
      ["sandbox", "--slug", `sbxc-${tag}`, "--name", "Sandbox C", "--region", "IN", "--organization-of", otherSlug, "--apply"],
      ["sandbox", "--slug", otherSlug, "--name", "Other Studio", "--region", "IN", "--organization-of", a, "--apply"],
    ]);
    usersAfter = await testUsers();
    limitAfter = (await pool.query<{ limit: number }>(`SELECT organization_limit AS limit FROM customer_accounts WHERE id = $1`, [accountA])).rows[0].limit;
    // An organization someone else linked to the sandbox's account: from then on the account is not the sandbox's alone.
    await pool.query(`UPDATE customer_accounts SET organization_limit = organization_limit + 1 WHERE id = $1`, [accountA]);
    await insertOrganization(foreignId, foreignSlug, "Foreign Studio", accountA);
    [foreignAccount] = await cli([[...addB, "--apply"]]);
  }, 1_800_000);
  afterAll(() => pool?.end());

  async function insertOrganization(id: string, slug: string, name: string, accountId: string | null) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (id === otherId) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Other Owner')", [otherOwner, `owner-${otherOwner.slice(0, 8)}@example.test`]);
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [id]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,default_timezone,created_by) VALUES($1,$2,$3,'USD','en-US','UTC',$4)", [id, name, slug, otherOwner]);
      await client.query("INSERT INTO tenant_login_branding(workspace_id,login_slug,display_name) VALUES($1,$2,$3)", [id, slug, name]);
      await client.query(`INSERT INTO legal_entities(workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES($1,'OTH',$2,$2,'US','USD','en-US','UTC')`, [id, name]);
      await client.query("INSERT INTO workspace_memberships(workspace_id,user_id,status) VALUES($1,$2,'active')", [id, otherOwner]);
      if (accountId) await client.query("INSERT INTO customer_account_organizations(account_id,workspace_id,is_default) VALUES($1,$2,false)", [accountId, id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  it("previews the organization without making it", () => {
    expect(dry.code, dry.output).toBe(0);
    expect(dry.output).toContain(`[organization] would change ${b}`);
    expect(dry.output).toContain(`owner@${a}.test`);
    expect(workspacesBeforeApply).toBe(0);
  });

  it("adds B to A's customer account through the organization request and its approval, with B's region pack and A's kit", async () => {
    expect(first.code, first.output).toBe(0);
    const idA = (await workspaceOf(a))!, idB = (await workspaceOf(b))!;
    expect(idB).toBeTruthy();
    expect(await accountOf(idB)).toBe(await accountOf(idA));
    const region = (await pool.query<{ configuration: { currency: string; locale: string; timezone: string; weekStartsOn: number } }>(
      `SELECT configuration FROM tenant_setup_profiles WHERE kind = 'region' AND code = 'IN' AND selectable ORDER BY version DESC LIMIT 1`)).rows[0].configuration;
    expect((await pool.query(`SELECT name, slug, status, default_currency AS currency, default_locale AS locale, default_timezone AS timezone, week_starts_on AS "weekStartsOn"
      FROM workspaces WHERE id = $1`, [idB])).rows[0])
      .toEqual({ name: "Sandbox B", slug: b, status: "active", currency: region.currency, locale: region.locale, timezone: region.timezone, weekStartsOn: region.weekStartsOn });
    expect((await pool.query(`SELECT country_code, base_currency FROM legal_entities WHERE workspace_id = $1`, [idB])).rows).toEqual([{ country_code: "IN", base_currency: region.currency }]);
    const setupA = (await pool.query(`SELECT firm_kit_code, plan_code FROM workspace_setup_versions WHERE workspace_id = $1`, [idA])).rows[0];
    expect((await pool.query(`SELECT region_code, firm_kit_code, plan_code FROM workspace_setup_versions WHERE workspace_id = $1`, [idB])).rows[0])
      .toEqual({ region_code: "IN", ...setupA });
    // The kit's project route and sales pipeline, as a first organization gets them.
    expect(await count(`SELECT count(*) FROM project_workflow_templates WHERE workspace_id = $1 AND is_default`, [idB])).toBe(1);
    expect(Number((await pool.query(`SELECT seat_limit FROM workspace_subscriptions WHERE workspace_id = $1`, [idB])).rows[0].seat_limit)).toBeGreaterThanOrEqual(12);
    // The request, made by A's test owner, approved; the account's organization limit raised to hold it.
    const request = (await pool.query(`SELECT request.status, request.source_workspace_id AS source, person.primary_email AS "requestedBy" FROM organization_requests request
      JOIN users person ON person.id = request.requested_by WHERE request.approved_workspace_id = $1`, [idB])).rows;
    expect(request).toEqual([{ status: "approved", source: idA, requestedBy: `owner@${a}.test` }]);
    expect(limitAfter).toBe(Math.max(accountBefore!.limit, 2));
    expect(first.output).toContain(`[organization] changed      ${b}`);
  });

  it("gives B the same test members with the same roles and teams, and makes nobody new", async () => {
    const inA = await members((await workspaceOf(a))!), inB = await members((await workspaceOf(b))!);
    expect(inB).toHaveLength(12);
    expect(inB.every((member) => member.status === "active")).toBe(true);
    const shape = (rows: Member[]) => rows.map(({ email, roles, teams, userId }) => ({ email, roles, teams, userId }));
    expect(shape(inB)).toEqual(shape(inA));
    expect(usersBefore).toBe(12);
    expect(usersAfter).toBe(12);
    expect(json(second).newUserIds).toEqual([]);
    expect(first.output).toContain("No new people");
    // Passwords are the people's own: none was set or changed.
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action = 'auth.local_password_set'`, [(await workspaceOf(b))!])).toBe(0);
    for (const result of [dry, first, second, again]) expect(result.output).not.toContain(PASSWORD);
  });

  it("covers B with the account's sign-in policy: no authenticator needed in either organization", async () => {
    const policies = (await pool.query(`SELECT linked.workspace_id AS id, account.security_policy AS policy FROM customer_account_organizations linked
      JOIN customer_accounts account ON account.id = linked.account_id WHERE linked.workspace_id = ANY($1::uuid[])`, [[await workspaceOf(a), await workspaceOf(b)]])).rows;
    expect(policies).toHaveLength(2);
    for (const row of policies) expect(row.policy).toMatchObject({ requireMfaForAdmins: false, requireMfaForAllUsers: false });
    expect(first.output).toMatch(/\[security\] unchanged +authenticator: not needed to sign in in 2 organizations/);
    expect(rename.output).toMatch(/\[security\] unchanged +authenticator: not needed to sign in in 2 organizations/);
  });

  it("applies the profile, teams and lead options without real addresses, and seeds the showcase in B's currency", async () => {
    const idB = (await workspaceOf(b))!;
    expect(first.output).toContain("financeRequests.inbox: an email address: not copied into a sandbox");
    expect(await count(`SELECT count(*) FROM workspace_teams WHERE workspace_id = $1`, [idB])).toBe(19);
    expect(await count(`SELECT count(*) FROM crm_taxonomy_options choice JOIN crm_taxonomies taxonomy ON taxonomy.id = choice.taxonomy_id
      WHERE choice.workspace_id = $1 AND taxonomy.code = 'enquiry_type' AND choice.code = 'furniture_only' AND choice.status = 'active'`, [idB])).toBe(1);
    expect(first.output).toMatch(/\[seed\] changed +showcase: [1-9]\d* created/);
    expect(await count(`SELECT count(*) FROM crm_leads WHERE workspace_id = $1`, [idB])).toBeGreaterThan(0);
    expect(await count(`SELECT count(*) FROM commercial_quotes WHERE workspace_id = $1`, [idB])).toBeGreaterThan(0);
    expect(await count(`SELECT count(*) FROM commercial_quotes WHERE workspace_id = $1 AND currency IS DISTINCT FROM 'INR'`, [idB])).toBe(0);
  });

  it("seeds the showcase with B's own country's clients: Indian mobiles and places, nothing from the emirates", async () => {
    const idB = (await workspaceOf(b))!;
    const enquiries = (await pool.query<{ reference: string; name: string; phone: string; country: string | null; area: string; region: string | null; title: string }>(
      `SELECT intake.external_event_id AS reference, party.display_name AS name, phone.raw_value AS phone, phone.country_code AS country,
              enquiry.details->>'area' AS area, enquiry.details->>'emirate' AS region, enquiry.title
         FROM crm_intake_events intake
         JOIN crm_enquiries enquiry ON enquiry.workspace_id = intake.workspace_id AND enquiry.intake_event_id = intake.id
         JOIN crm_parties party ON party.workspace_id = enquiry.workspace_id AND party.id = enquiry.party_id
         JOIN crm_contact_points phone ON phone.workspace_id = party.workspace_id AND phone.party_id = party.id AND phone.type = 'phone'
        WHERE intake.workspace_id = $1 AND intake.external_event_id LIKE 'SHOWCASE-%'`, [idB])).rows;
    // The five stories' clients and the seven enquiries.
    expect(enquiries.length).toBe(12);
    const india = regionFixture("IN");
    const states = india.places.map((place) => place.region.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
    for (const row of enquiries) {
      expect(row.phone, row.reference).toMatch(/^\+91\d{10}$/);
      expect(row.country, row.reference).toBe("IN");
      expect(india.places.map((place) => place.area), row.reference).toContain(row.area);
      expect(states, row.reference).toContain(row.region);
    }
    const emirates = /Dubai|Abu Dhabi|Jumeirah|Marina|Emirat|Sharjah|Ranches|JLT|Barari|Mirdif|Business Bay|Motor City|majlis|Ramadan|\+971/i;
    expect(enquiries.filter((row) => emirates.test(`${row.name} ${row.phone} ${row.area} ${row.title}`))).toEqual([]);
    // Nor in what the team reads around them: the chats, the follow-ups and the project tasks' titles.
    const said = (await pool.query<{ text: string }>(
      `SELECT body_text AS text FROM crm_messages WHERE workspace_id = $1 UNION ALL SELECT subject FROM crm_conversations WHERE workspace_id = $1 AND subject IS NOT NULL
       UNION ALL SELECT title FROM crm_activities WHERE workspace_id = $1 UNION ALL SELECT title FROM crm_opportunities WHERE workspace_id = $1`, [idB])).rows;
    expect(said.length).toBeGreaterThan(20);
    expect(said.filter((row) => emirates.test(row.text ?? ""))).toEqual([]);
  });

  it("changes nothing on a second run, and its dry run has nothing left to do", () => {
    const applied = json(second);
    expect(second.code, second.output).toBe(0);
    expect(applied.counts.changed ?? 0).toBe(0);
    expect(applied.counts.failed ?? 0).toBe(0);
    expect(applied.lines).toEqual(expect.arrayContaining([expect.objectContaining({ section: "organization", status: "unchanged", label: b })]));
    const preview = json(again);
    expect(again.code, again.output).toBe(0);
    expect(preview.counts["would change"] ?? 0).toBe(0);
  });

  it("audits B's writes as the operator CLI", async () => {
    const idA = (await workspaceOf(a))!, idB = (await workspaceOf(b))!;
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND via IS DISTINCT FROM 'operator_cli'`, [idB])).toBe(0);
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action = 'customer_account.organization_provisioned'`, [idB])).toBe(1);
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action IN ('customer_account.organization_requested', 'customer_account.organization_approved')
      AND via = 'operator_cli'`, [idA])).toBe(2);
    expect(await count(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action IN ('workspace.member_invited', 'workspace.invitation_accepted')`, [idB])).toBe(11 + 11);
  });

  it("keeps A's and B's records apart (tenant isolation as the app role)", async () => {
    const idA = (await workspaceOf(a))!, idB = (await workspaceOf(b))!;
    const owner = (await pool.query<{ id: string }>(`SELECT id FROM users WHERE primary_email = $1`, [`owner@${a}.test`])).rows[0].id;
    const client = await pool.connect();
    try {
      for (const [here, there] of [[idA, idB], [idB, idA]]) {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE wodana_app");
        await client.query("SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_actor_id', $2, true)", [here, owner]);
        const seen = async (sql: string, values: unknown[] = []) => Number((await client.query<{ count: string }>(sql, values)).rows[0].count);
        expect(await seen(`SELECT count(*) FROM legal_entities WHERE workspace_id = $1`, [there])).toBe(0);
        expect(await seen(`SELECT count(*) FROM crm_leads WHERE workspace_id = $1`, [there])).toBe(0);
        expect(await seen(`SELECT count(*) FROM workspace_teams WHERE workspace_id = $1`, [there])).toBe(0);
        expect(await seen(`SELECT count(*) FROM legal_entities`)).toBe(1);
        await client.query("ROLLBACK");
      }
    } finally {
      client.release();
    }
  });

  it("renames A through the workspace identity command, audited, and the slug stays", async () => {
    expect(rename.code, rename.output).toBe(0);
    const idA = (await workspaceOf(a))!;
    expect((await pool.query(`SELECT workspace.name, workspace.slug, branding.display_name AS "loginName", branding.login_slug AS "loginSlug"
      FROM workspaces workspace JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id WHERE workspace.id = $1`, [idA])).rows[0])
      .toEqual({ name: "Sandbox A UAE", slug: a, loginName: "Sandbox A UAE", loginSlug: a });
    expect(rename.output).toContain(`[workspace] changed      name: "Sandbox A" → "Sandbox A UAE"`);
    const audit = (await pool.query(`SELECT before->>'name' AS before, after->>'name' AS after, via FROM audit_events WHERE workspace_id = $1 AND action = 'workspace.updated'`, [idA])).rows;
    expect(audit).toEqual([{ before: "Sandbox A", after: "Sandbox A UAE", via: "operator_cli" }]);
    // Nothing else of A changed: its company keeps its name; a second run has nothing to do.
    expect((await pool.query(`SELECT display_name FROM legal_entities WHERE workspace_id = $1`, [idA])).rows).toEqual([{ display_name: "Sandbox A" }]);
    expect(renameAgain.code, renameAgain.output).toBe(0);
    expect(json(renameAgain).counts.changed ?? 0).toBe(0);
  });

  it("refuses a base that is not a sandbox, a slug another organization holds, and an account that is not the sandbox's alone", async () => {
    expect(unknownBase.code).toBe(1);
    expect(unknownBase.output).toContain(`nope-${tag} is not a sandbox this command made`);
    expect(nonSandboxBase.code).toBe(1);
    expect(nonSandboxBase.output).toContain(`${otherSlug} is not a sandbox this command made`);
    expect(await count(`SELECT count(*) FROM tenant_login_branding WHERE login_slug = $1`, [`sbxc-${tag}`])).toBe(0);
    expect(takenSlug.code).toBe(1);
    expect(takenSlug.output).toContain("belongs to an organization this command didn't make");
    expect(await count(`SELECT count(*) FROM workspace_memberships WHERE workspace_id = $1`, [otherId])).toBe(1);
    expect(foreignAccount.code).toBe(1);
    expect(foreignAccount.output).toContain("has organizations this command didn't make");
    expect(await count(`SELECT count(*) FROM workspace_memberships WHERE workspace_id = $1`, [foreignId])).toBe(1);
  });
});
