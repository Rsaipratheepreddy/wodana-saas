import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureEnquiryTypeFlows } from "../crm/flows/enquiry-type-flows";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). `configure --teams --packages --profile`
// on an existing workspace with Palm's fixtures: a dry run writes nothing, --apply adds only what is missing (teams,
// roles, permissions, packages, the minimum deposit) through the app's commands, and a second run changes nothing.
// What the workspace had beyond the files (a team, its member, a role's extra permission, a package) is untouched.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const run = promisify(execFile);
const fixtures = resolve(__dirname, "fixtures");
const docs = resolve(__dirname, "../../../../docs/fixtures");

type Result = { code: number; output: string };
type Line = { section: string; status: string; label: string; detail?: string };
type Json = { counts: Record<string, number>; lines: Line[] };

integration("operator CLI configure: teams access and design packages on an existing workspace, additive only (real Postgres)", () => {
  let pool: Pool;
  const workspaceId = randomUUID(), owner = randomUUID(), mia = randomUUID();
  const slug = `cfg-${workspaceId.slice(0, 8)}`;
  const ownerEmail = `owner-${owner.slice(0, 8)}@example.test`;
  const ids = { miaMembership: randomUUID(), salesRole: randomUUID(), legacyRole: randomUUID(), financeRole: randomUUID(), salesTeam: randomUUID(), legacyTeam: randomUUID(),
    designTeam: randomUUID(), designUnit: randomUUID(), salesUnit: randomUUID(), legacyPackage: randomUUID(), creativeDirector: randomUUID(), concept: randomUUID() };
  const teamsFile = JSON.parse(readFileSync(resolve(docs, "palm-teams-access.json"), "utf8")) as { teams: Array<{ code: string; permissions: string[] }> };
  const salesPermissions = teamsFile.teams.find((team) => team.code === "SALES")!.permissions;
  const files = ["--teams", resolve(docs, "palm-teams-access.json"), "--packages", resolve(docs, "palm-design-packages.json"), "--profile", resolve(docs, "palm-golive-config.json")];
  let dry: Result, apply: Result, again: Result, teamsOnly: Result;
  let afterDry: Record<string, number>;
  let started: Date;

  async function cli(runs: string[][]): Promise<Result[]> {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", "-c role=wodana_app");
    const { stdout } = await run(process.execPath, [resolve(fixtures, "run-ops-cli.cjs"), JSON.stringify(runs)], {
      env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", AUTH_MODE: "development", REDIS_URL: "" }, maxBuffer: 20 * 1024 * 1024, timeout: 280_000,
    });
    return JSON.parse(stdout.slice(stdout.lastIndexOf("@@RESULT@@") + "@@RESULT@@".length)) as Result[];
  }
  const count = async (sql: string, values: unknown[] = [workspaceId]) => Number((await pool.query<{ count: string }>(sql, values)).rows[0].count);
  const json = (result: Result) => JSON.parse(result.output) as Json;
  const state = async () => ({
    roles: await count("SELECT count(*) FROM roles WHERE workspace_id = $1"),
    rolePermissions: await count("SELECT count(*) FROM role_permissions WHERE workspace_id = $1"),
    teams: await count("SELECT count(*) FROM workspace_teams WHERE workspace_id = $1"),
    teamRoles: await count("SELECT count(*) FROM workspace_team_roles WHERE workspace_id = $1"),
    teamMembers: await count("SELECT count(*) FROM workspace_team_members WHERE workspace_id = $1"),
    packages: await count("SELECT count(*) FROM design_packages WHERE workspace_id = $1"),
    packageVersions: await count("SELECT coalesce(sum(version), 0) AS count FROM design_packages WHERE workspace_id = $1"),
    designSettings: await count("SELECT count(*) FROM workspace_design_settings WHERE workspace_id = $1"),
    audits: await count("SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND via = 'operator_cli'"),
  });
  const permissionsOf = async (code: string) => (await pool.query<{ code: string }>(
    `SELECT permission.code FROM roles role JOIN role_permissions link ON link.role_id = role.id JOIN permissions permission ON permission.id = link.permission_id
      WHERE role.workspace_id = $1 AND role.code = $2 ORDER BY 1`, [workspaceId, code])).rows.map((row) => row.code);
  const team = async (code: string) => (await pool.query<{ id: string; unit: string; version: number; roles: string[]; members: Array<{ membership: string; lead: boolean }> }>(
    `SELECT team.id, unit.name AS unit, team.version,
            ARRAY(SELECT role.code FROM workspace_team_roles link JOIN roles role ON role.id = link.role_id WHERE link.team_id = team.id ORDER BY 1) AS roles,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('membership', member.membership_id, 'lead', member.is_lead)) FROM workspace_team_members member WHERE member.team_id = team.id), '[]') AS members
       FROM workspace_teams team JOIN business_units unit ON unit.id = team.business_unit_id WHERE team.workspace_id = $1 AND team.code = $2`, [workspaceId, code])).rows[0];
  const pkg = async (code: string) => (await pool.query(
    `SELECT pricing_method AS "pricingMethod", rate::text AS rate, currency, area_unit AS "areaUnit", rate_from AS "rateFrom", review_role_code AS "reviewRoleCode",
            required_role_code AS "requiredRoleCode", unit_definition AS "unitDefinition", included_revisions AS "includedRevisions", status, version
       FROM design_packages WHERE workspace_id = $1 AND code = $2`, [workspaceId, code])).rows[0];

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Olive Owner'),($3,$4,'Mia Member')", [owner, ownerEmail, mia, `mia-${mia.slice(0, 8)}@example.test`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,default_timezone,created_by) VALUES($1,'Configure Studio',$2,'AED','en-US','UTC',$3)", [workspaceId, slug, owner]);
      const membership = randomUUID(), admin = randomUUID();
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')", [membership, workspaceId, owner, ids.miaMembership, mia]);
      // The firm's roles before: the administrator; the Sales team's role short of one permission the file gives and with
      // one it doesn't; a kit role named like the Finance team; and a role of a team the file doesn't know.
      await client.query(`INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$5,'administrator','Administrator',true),($2,$5,'team_sales','Account Managers / Sales',false),
        ($3,$5,'legacy_crew','Legacy crew',false),($4,$5,'finance_team','Finance',false)`, [admin, ids.salesRole, ids.legacyRole, ids.financeRole, workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions", [workspaceId, admin]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])",
        [workspaceId, ids.salesRole, [...salesPermissions.filter((code) => code !== "crm.reports.view"), "stock.view"]]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code IN ('catalog.view')", [workspaceId, ids.legacyRole]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code IN ('payables.view')", [workspaceId, ids.financeRole]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, membership, admin]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("INSERT INTO stock_locations(id,workspace_id,kind,name,is_default) VALUES($1,$2,'warehouse','Main warehouse',true)", [randomUUID(), workspaceId]);
      await client.query(`INSERT INTO legal_entities(workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES($1,'CFG','Configure Studio','Configure Studio LLC','AE','AED','en-US','UTC')`, [workspaceId]);
      await client.query("INSERT INTO workspace_work_packages(id,workspace_id,name,position) VALUES($1,$2,'Joinery',0)", [randomUUID(), workspaceId]);
      // Two business units (new teams go in the first by name) and three teams: Sales with Mia, Interior design with
      // Mia as lead but without its role, and a team the file doesn't know, with Mia.
      await client.query(`INSERT INTO business_units(id,workspace_id,legal_entity_id,code,name,timezone) SELECT $1::uuid,$3::uuid,id,'SALES','Sales','UTC' FROM legal_entities WHERE workspace_id=$3
        UNION ALL SELECT $2::uuid,$3::uuid,id,'DESIGN','Design','UTC' FROM legal_entities WHERE workspace_id=$3`, [ids.salesUnit, ids.designUnit, workspaceId]);
      await client.query(`INSERT INTO workspace_teams(id,workspace_id,business_unit_id,code,name,status) VALUES($1,$4,$5,'SALES','Account Managers / Sales','active'),
        ($2,$4,$5,'LEGACY','Legacy crew','active'),($3,$4,$6,'INTERIOR_DESIGN','Interior Designers','active')`, [ids.salesTeam, ids.legacyTeam, ids.designTeam, workspaceId, ids.salesUnit, ids.designUnit]);
      await client.query("INSERT INTO workspace_team_roles(workspace_id,team_id,role_id) VALUES($1,$2,$3),($1,$4,$5)", [workspaceId, ids.salesTeam, ids.salesRole, ids.legacyTeam, ids.legacyRole]);
      await client.query("INSERT INTO workspace_team_members(workspace_id,team_id,membership_id,is_lead) VALUES($1,$2,$5,false),($1,$3,$5,false),($1,$4,$5,true)",
        [workspaceId, ids.salesTeam, ids.legacyTeam, ids.designTeam, ids.miaMembership]);
      // The packages as the file had them before 13 Oct (PLM-041): Concept without the layout or what a space is, the Creative Director
      // package requiring its designer's role at a fixed rate; no Bespoke package; and one the file doesn't list (with the revisions the
      // profile's design section gives every active package, so only the files could change it).
      await client.query(`INSERT INTO design_packages(id,workspace_id,code,name,pricing_method,rate,currency,area_unit,included_revisions,includes_space_planning,includes_renders,
          required_role_code,inclusions,position)
        VALUES($1,$4,'concept','Concept Package','per_space',10000,'AED',NULL,2,false,false,NULL,'Mood boards, two concepts and material selection.',1),
              ($2,$4,'creative_director','Designed by the Creative Director','per_area',100,'AED','sqft',2,true,true,'creative_director','Led by the Creative Director.',3),
              ($3,$4,'legacy_package','Legacy package','fixed',999,'AED',NULL,2,false,false,NULL,NULL,9)`,
        [ids.concept, ids.creativeDirector, ids.legacyPackage, workspaceId]);
      const taxonomy = randomUUID();
      await client.query("INSERT INTO crm_taxonomies(id,workspace_id,code,name) VALUES($1,$2,'enquiry_type','Enquiry type')", [taxonomy, workspaceId]);
      await client.query(`INSERT INTO crm_taxonomy_options(workspace_id,taxonomy_id,code,label,position) VALUES($1,$2,'not_sure','Not sure yet',0),
        ($1,$2,'furniture_only','Furniture only',1),($1,$2,'interior_design','Interior design',2)`, [workspaceId, taxonomy]);
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
    const common = ["configure", "--workspace", slug, "--as", ownerEmail];
    [dry] = await cli([[...common, ...files, "--json"]]);
    afterDry = await state();
    [apply, again, teamsOnly] = await cli([
      [...common, ...files, "--apply", "--json"],
      [...common, ...files, "--apply", "--json"],
      [...common, "--teams", resolve(docs, "palm-teams-access.json"), "--packages", resolve(docs, "palm-design-packages.json"), "--json"],
    ]);
  }, 600_000);
  afterAll(() => pool?.end());

  it("previews every change without writing anything", async () => {
    expect(dry.code, dry.output).toBe(0);
    const report = json(dry);
    expect(report.counts.failed ?? 0, dry.output).toBe(0);
    expect(report.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ section: "teams", status: "would change", label: "role team_technical_lead", detail: "created with 4 permissions" }),
      expect.objectContaining({ section: "teams", status: "would change", label: "role team_material_coordinator", detail: "created with 8 permissions" }),
      expect.objectContaining({ section: "teams", status: "would change", label: "team TECHNICAL_LEAD", detail: "Technical Lead: created in Design" }),
      expect.objectContaining({ section: "teams", status: "would change", label: "team MATERIAL_COORDINATOR", detail: "Material Coordinator: created in Design" }),
      expect.objectContaining({ section: "teams", status: "would change", label: "role team_sales", detail: "1 permissions added: crm.reports.view" }),
      // A team without its role gets it, though the role itself is only made with --apply.
      expect.objectContaining({ section: "teams", status: "would change", label: "team INTERIOR_DESIGN", detail: "gets role team_interior_design" }),
      // A role the workspace has with the team's name is the team's (no second Finance role).
      expect.objectContaining({ section: "teams", status: "would change", label: "role finance_team" }),
      expect.objectContaining({ section: "teams", status: "unchanged", label: "team SALES", detail: "has role team_sales" }),
      expect.objectContaining({ section: "packages", status: "would change", label: "minimum design deposit", detail: "none → 100% of the design fee" }),
      expect.objectContaining({ section: "packages", status: "would change", label: "design package concept one unit is", detail: "(none) → 1 space = 1 room with a door" }),
      expect.objectContaining({ section: "packages", status: "would change", label: "design package concept space planning", detail: "false → true" }),
      expect.objectContaining({ section: "packages", status: "would change", label: "design package concept inclusions", detail: "changed" }),
      expect.objectContaining({ section: "packages", status: "would change", label: "design package bespoke", detail: "added: Bespoke Interior Design: 40.00 AED per sqft" }),
      expect.objectContaining({ section: "packages", status: "would change", label: "design package creative_director priced from its rate", detail: "false → true" }),
      // The file leaves the required role out: the package no longer asks its designer to be the Creative Director; the Creative Director reviews.
      expect.objectContaining({ section: "packages", status: "would change", label: "design package creative_director required role", detail: "creative_director → (none)" }),
      expect.objectContaining({ section: "packages", status: "would change", label: "design package creative_director reviewed by", detail: "(none) → creative_director" }),
      expect.objectContaining({ section: "packages", status: "info", label: "design package legacy_package", detail: "not in the file: left as it is" }),
      expect.objectContaining({ section: "profile", status: "info", label: "dry run" }),
    ]));
    // Concept's price and Creative Director's rate are as the file says already.
    expect(report.lines.filter((line) => line.section === "packages" && /^design package \w+ (rate|priced|currency)$/.test(line.label))).toEqual([]);
    // Nothing is said about the team the file doesn't know, and nothing was written.
    expect(report.lines.some((line) => line.label.includes("LEGACY") || line.label.includes("legacy_crew"))).toBe(false);
    expect(afterDry).toEqual({ roles: 4, rolePermissions: expect.any(Number), teams: 3, teamRoles: 2, teamMembers: 3, packages: 3, packageVersions: 3, designSettings: 0, audits: 0 });
    expect(afterDry.rolePermissions).toBe(await count("SELECT count(*) FROM permissions", []) + salesPermissions.length + 2);
  });

  it("applies the teams, roles and permissions, adding only what is missing", async () => {
    expect(apply.code, apply.output).toBe(0);
    expect(json(apply).counts.failed ?? 0, apply.output).toBe(0);
    expect(await count("SELECT count(*) FROM workspace_teams WHERE workspace_id = $1")).toBe(teamsFile.teams.length + 1);
    // The new teams, in the first business unit by name, with their own role and nobody in them.
    expect(await team("TECHNICAL_LEAD")).toMatchObject({ unit: "Design", roles: ["team_technical_lead"], members: [] });
    expect(await team("MATERIAL_COORDINATOR")).toMatchObject({ unit: "Design", roles: ["team_material_coordinator"], members: [] });
    expect(await permissionsOf("team_material_coordinator")).toEqual(expect.arrayContaining(["pre_projects.manage_materials", "catalog.samples.manage", "pre_projects.view"]));
    // The Sales role gains the permission it lacked and keeps the one the file doesn't give; its team keeps Mia.
    expect(await permissionsOf("team_sales")).toEqual([...new Set([...salesPermissions, "stock.view"])].sort());
    expect(await team("SALES")).toMatchObject({ roles: ["team_sales"], members: [{ membership: ids.miaMembership, lead: false }], version: 1 });
    // Interior design gets its role and keeps its lead.
    expect(await team("INTERIOR_DESIGN")).toMatchObject({ unit: "Design", roles: ["team_interior_design"], members: [{ membership: ids.miaMembership, lead: true }] });
    // Finance uses the kit role named like it: no team_finance role.
    expect(await team("FINANCE")).toMatchObject({ roles: ["finance_team"], members: [] });
    expect(await count("SELECT count(*) FROM roles WHERE workspace_id = $1 AND code = 'team_finance'")).toBe(0);
    expect(await permissionsOf("finance_team")).toContain("commercial.finance.verify");
  });

  it("leaves the team, member, role and package the files don't name untouched", async () => {
    expect(await team("LEGACY")).toMatchObject({ unit: "Sales", version: 1, roles: ["legacy_crew"], members: [{ membership: ids.miaMembership, lead: false }] });
    expect(await permissionsOf("legacy_crew")).toEqual(["catalog.view"]);
    expect((await pool.query("SELECT version FROM roles WHERE id = $1", [ids.legacyRole])).rows[0].version).toBe(1);
    expect(await pkg("legacy_package")).toMatchObject({ pricingMethod: "fixed", rate: "999.00", status: "active", version: 1, includedRevisions: 2 });
    expect(await count("SELECT count(*) FROM workspace_memberships WHERE workspace_id = $1 AND status = 'active'")).toBe(2);
    expect(await count("SELECT count(*) FROM member_roles WHERE workspace_id = $1 AND membership_id = $2", [workspaceId, ids.miaMembership])).toBe(0);
  });

  it("applies the design packages and the minimum deposit through Settings › Design's commands", async () => {
    expect(await pkg("concept")).toMatchObject({ pricingMethod: "per_space", rate: "10000.00", currency: "AED", areaUnit: null, unitDefinition: "1 space = 1 room with a door",
      rateFrom: false, reviewRoleCode: null, requiredRoleCode: null, status: "active", version: 2 });
    expect(await pkg("bespoke")).toMatchObject({ pricingMethod: "per_area", areaUnit: "sqft", rate: "40.00", currency: "AED", status: "active", version: 1 });
    expect(await pkg("creative_director")).toMatchObject({ pricingMethod: "per_area", areaUnit: "sqft", rate: "100.00", rateFrom: true, reviewRoleCode: "creative_director",
      requiredRoleCode: null, includedRevisions: 2, version: 2 });
    // Palm's deposit is the whole design fee (a percentage), so no amount or currency is kept.
    expect((await pool.query("SELECT minimum_design_deposit::text AS amount, currency, minimum_design_deposit_percent::text AS percent FROM workspace_design_settings WHERE workspace_id = $1", [workspaceId])).rows[0])
      .toEqual({ amount: null, currency: null, percent: "100.00" });
  });

  it("applies teams and packages before the profile's sections that name them", () => {
    const lines = json(apply).lines;
    // Factory inspections name the Creative Director package.
    expect(lines).toContainEqual(expect.objectContaining({ section: "factory", status: "changed", label: "design packages the director inspects", detail: "none → creative_director" }));
    // Role permissions and the timeline teams name roles and teams the teams file added in the same run (in the dry run they were not found yet).
    expect(json(dry).lines).toContainEqual(expect.objectContaining({ section: "rolePermissions", status: "not found", label: "role team_sales_admin" }));
    // The Sales Admin's role gets closing chats either from the teams file (its permissions) or the profile's grant.
    expect(lines.some((line) => line.label === "role team_sales_admin" && ((line.section === "rolePermissions" && line.status === "changed")
      || (line.section === "teams" && line.status === "changed")))).toBe(true);
    expect(lines).toContainEqual(expect.objectContaining({ section: "sales", status: "changed", label: "timeline questions go to" }));
    expect(lines.filter((line) => line.status === "not found" && ["rolePermissions", "sales", "factory"].includes(line.section) && /team|creative_director/.test(line.label))).toEqual([]);
  });

  it("changes nothing on a second run", () => {
    expect(again.code, again.output).toBe(0);
    const second = json(again);
    expect(second.counts.changed ?? 0, again.output).toBe(0);
    expect(second.counts.failed ?? 0).toBe(0);
    const teamsAndPackages = json(teamsOnly);
    expect(teamsOnly.code, teamsOnly.output).toBe(0);
    expect(teamsAndPackages.counts["would change"] ?? 0, teamsOnly.output).toBe(0);
    expect(teamsAndPackages.lines).toContainEqual(expect.objectContaining({ section: "teams", status: "unchanged", label: "role team_material_coordinator" }));
    expect(teamsAndPackages.lines).toContainEqual(expect.objectContaining({ section: "packages", status: "unchanged", label: "design package concept",
      detail: "Concept Package: 10000.00 AED per space (1 space = 1 room with a door)" }));
  });

  it("audits every write as the member, marked as the operator CLI", async () => {
    const rows = (await pool.query<{ action: string; count: string }>(
      `SELECT action, count(*) FROM audit_events WHERE workspace_id = $1 AND occurred_at >= $2 AND via = 'operator_cli' AND actor_user_id = $3 GROUP BY action`, [workspaceId, started, owner])).rows;
    const by = Object.fromEntries(rows.map((row) => [row.action, Number(row.count)]));
    expect(by["design.package_created"]).toBe(1);
    expect(by["design.package_updated"]).toBe(2);
    expect(by["design.minimum_deposit_changed"]).toBe(1);
    expect(by["workspace.team_created"]).toBe(teamsFile.teams.length - 2);
    expect(by["role.created"]).toBeGreaterThan(0);
    expect(await count("SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND occurred_at >= $2 AND actor_user_id = $3 AND via IS DISTINCT FROM 'operator_cli'",
      [workspaceId, started, owner])).toBe(0);
  });

  it("loads Palm's discovery questions and joinery checklists from the questions file: previewed, set whole with --apply, unchanged on a second run", async () => {
    const common = ["configure", "--workspace", slug, "--as", ownerEmail, "--packages", resolve(docs, "palm-design-questions.json")];
    const from = new Date();
    const [preview, applied, repeat] = await cli([[...common, "--json"], [...common, "--apply", "--json"], [...common, "--apply", "--json"]]);
    for (const result of [preview, applied, repeat]) {
      expect(result.code, result.output).toBe(0);
      expect(json(result).counts.failed ?? 0, result.output).toBe(0);
    }
    // The packages are as the packages file set them; only the question list changes, from the product's default list.
    expect(json(preview).lines.filter((line) => line.status === "would change")).toEqual([expect.objectContaining({ section: "packages", label: "site visit questions",
      detail: "7 general questions in 1 section, 0 checks, 0 checklists (0 for every job), 0 with match words → 31 general questions in 6 sections, 150 checks, 15 checklists (1 for every job), 14 with match words" })]);
    expect(json(applied).lines).toContainEqual(expect.objectContaining({ section: "packages", status: "changed", label: "site visit questions" }));
    expect(json(repeat).counts.changed ?? 0, repeat.output).toBe(0);
    expect(json(repeat).lines).toContainEqual(expect.objectContaining({ section: "packages", status: "unchanged", label: "site visit questions" }));
    const stored = (await pool.query<{ questions: Array<{ key: string; kind?: string }>; scopes: Array<{ scope: string; everyJob?: boolean }> }>(
      "SELECT site_visit_questions AS questions, site_visit_scopes AS scopes FROM workspace_design_settings WHERE workspace_id = $1", [workspaceId])).rows[0];
    expect([stored.questions.length, stored.questions.filter((question) => question.kind === "check").length, stored.scopes.length]).toEqual([181, 150, 15]);
    // One write, audited as the member through the operator CLI.
    expect(await count("SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND occurred_at >= $2 AND action = 'design.flow_settings_changed.v1' AND via = 'operator_cli'",
      [workspaceId, from])).toBe(1);
  }, 300_000);
});
