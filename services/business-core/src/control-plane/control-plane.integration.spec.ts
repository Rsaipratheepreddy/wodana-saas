import { ConflictException, ForbiddenException, HttpException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantWriteBlockGuard } from "../auth/tenant-write-block.guard";
import { DatabaseService } from "../database/database.service";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { DEFAULT_SALES_PIPELINE } from "../crm/default-sales-pipeline";
import { TenantDomainsService } from "../workspaces/tenant-domains.service";
import { AccountDirectoryService } from "./account-directory.service";
import { ControlPlaneSweepService } from "./control-plane-sweep.service";
import { OrganizationSeatsService } from "./organization-seats.service";
import { ControlNoticesService } from "./control-notices.service";
import { SupportSessionsService } from "./support-sessions.service";
import { TenantLifecycleService } from "./tenant-lifecycle.service";
import type { PlatformOperatorPermission } from "../auth/platform-operator-policy";
import { platformOperatorPermissions } from "../auth/platform-operator-policy";
import { ViewAsService } from "../auth/view-as/view-as.service";
import { ROLE_TEMPLATES } from "../workspaces/role-templates";

// Real PostgreSQL, run as the app role (forced RLS applies). Rows are committed so concurrent commands
// really race; every row this suite creates is removed afterwards.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("control plane with PostgreSQL", () => {
  const run = randomUUID().slice(0, 8);
  const operatorA = randomUUID(), operatorB = randomUUID();
  const ownerEmail = `owner-${run}@control-plane.test`;
  const externalTenantId = `control-plane-${run}`;
  const slug = `control-plane-${run}`;
  const provisionKey = `provision-${run}-key`;
  const workspaceIds: string[] = [];
  const userEmails = [ownerEmail, `a-${run}@control-plane.test`, `b-${run}@control-plane.test`,
    `seat-1-${run}@control-plane.test`, `seat-2-${run}@control-plane.test`, `seat-3-${run}@control-plane.test`];
  let owner: Pool;
  let db: DatabaseService;
  let workspaces: WorkspacesService;
  let lifecycle: TenantLifecycleService;
  let support: SupportSessionsService;
  let directory: AccountDirectoryService;
  let sweep: ControlPlaneSweepService;
  let seatsService: OrganizationSeatsService;
  let ownerUserId = "";
  let workspaceId = "";

  const provisionInput = () => ({
    externalTenantId,
    name: `Control Plane ${run}`,
    slug,
    defaultCurrency: "USD",
    defaultLocale: "en-US",
    defaultTimezone: "UTC",
    unitSystem: "metric" as const,
    weekStartsOn: 1,
    firstLegalEntity: { code: "CP", displayName: "Control Plane", registeredName: "Control Plane Ltd",
      countryCode: "US", baseCurrency: "USD", locale: "en-US", timezone: "UTC" },
    owner: { email: ownerEmail, displayName: "Owner Person" },
  });
  const operator = (userId: string, role: Parameters<typeof platformOperatorPermissions>[0] = "administrator") =>
    ({ userId, permissions: platformOperatorPermissions(role) as PlatformOperatorPermission[] });
  const actor = { subject: `local:${ownerEmail}`, provider: "local", email: ownerEmail, displayName: "Owner Person" };
  const invite = (email: string) => workspaces.inviteMember(actor as never, workspaceId, { email, roleCodes: ["member"] } as never);
  const guardContext = (method: string) => ({
    getType: () => "http", getHandler: () => undefined, getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ method, params: { workspaceId } }) }),
  }) as never;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    owner = new Pool({ connectionString: url.toString() });
    const role = await owner.query("SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app'");
    if (role.rowCount) url.searchParams.set("options", "-c role=wodana_app");
    const config = new ConfigService({ DATABASE_URL: url.toString(), WEB_ORIGIN: "http://localhost:3108" });
    db = new DatabaseService(config);
    const email = new TransactionalEmailService(config, db);
    const identities = { resolveActor: async () => ({ ...actor, userId: ownerUserId }) };
    const access = new WorkspaceAccessService(db, identities as never);
    workspaces = new WorkspacesService(db, identities as never, access, {} as never,
      { sendWorkspaceInvitation: async () => ({ status: "not_configured", provider: null, messageId: null }) } as never);
    const notices = new ControlNoticesService(db, email);
    lifecycle = new TenantLifecycleService(db, notices);
    support = new SupportSessionsService(db);
    directory = new AccountDirectoryService(db);
    seatsService = new OrganizationSeatsService(db);
    const domains = new TenantDomainsService(db, notices);
    domains.lookupTxt = async () => [];
    sweep = new ControlPlaneSweepService(db, lifecycle, support, domains, new ViewAsService(db, identities as never));
    await owner.query(`INSERT INTO users (id, primary_email, display_name) VALUES ($1, $2, 'Operator A'), ($3, $4, 'Operator B')`,
      [operatorA, userEmails[1], operatorB, userEmails[2]]);
    await owner.query(`INSERT INTO platform_administrators (user_id, role) VALUES ($1, 'administrator'), ($2, 'administrator')`,
      [operatorA, operatorB]);
  });

  afterAll(async () => {
    await db?.onModuleDestroy();
    if (!owner) return;
    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      const tables = await client.query<{ table: string }>(
        `SELECT DISTINCT columns.table_name AS table FROM information_schema.columns columns
           JOIN information_schema.tables tables ON tables.table_name = columns.table_name
            AND tables.table_schema = columns.table_schema AND tables.table_type = 'BASE TABLE'
          WHERE columns.table_schema = 'public' AND columns.column_name = 'workspace_id'`);
      const accounts = await client.query<{ id: string }>(
        `SELECT account_id AS id FROM customer_account_organizations WHERE workspace_id = ANY($1::uuid[])`, [workspaceIds]);
      for (const { table } of tables.rows) {
        await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [workspaceIds]);
      }
      const accountIds = accounts.rows.map((row) => row.id);
      for (const table of ["customer_account_memberships", "customer_account_contracts", "account_contract_versions",
        "account_billing_document_events", "account_billing_documents", "account_collection_state_versions"]) {
        await client.query(`DELETE FROM ${table} WHERE account_id = ANY($1::uuid[])`, [accountIds]);
      }
      await client.query(`DELETE FROM customer_accounts WHERE id = ANY($1::uuid[])`, [accountIds]);
      await client.query(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [workspaceIds]);
      await client.query(`DELETE FROM platform_operator_audit WHERE actor_user_id = ANY($1::uuid[]) OR target_id = $2
        OR details->>'workspaceId' = ANY($3::text[])`, [[operatorA, operatorB], externalTenantId, workspaceIds]);
      await client.query(`DELETE FROM platform_administrators WHERE user_id = ANY($1::uuid[])`, [[operatorA, operatorB]]);
      await client.query(`DELETE FROM users WHERE primary_email = ANY($1::text[])`, [userEmails]);
      await client.query("COMMIT");
    } finally {
      client.release();
      await owner.end();
    }
  });

  it("provisions once per idempotency key and refuses the key for another request", async () => {
    const first = await workspaces.provisionTenant(provisionInput(), provisionKey, operatorA);
    workspaceId = String((first as { workspace: { id: string } }).workspace.id);
    workspaceIds.push(workspaceId);
    const replay = await workspaces.provisionTenant(provisionInput(), provisionKey, operatorA);
    expect(replay).toMatchObject({ replayed: true, workspace: { id: workspaceId } });
    const count = await owner.query(`SELECT count(*)::int AS count FROM workspaces WHERE slug = $1`, [slug]);
    expect(count.rows[0].count).toBe(1);
    await expect(workspaces.provisionTenant({ ...provisionInput(), name: "Another name" }, provisionKey, operatorA))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(directory.slugAvailability(slug)).resolves.toMatchObject({ available: false, suggestion: `${slug}-2` });

    // The owner accepts: an active owner membership for the rest of the suite.
    const user = await owner.query<{ id: string }>(`SELECT id FROM users WHERE primary_email = $1`, [ownerEmail]);
    ownerUserId = user.rows[0].id;
    const membership = await owner.query<{ id: string }>(
      `INSERT INTO workspace_memberships (workspace_id, user_id, status, joined_at) VALUES ($1, $2, 'active', now()) RETURNING id`,
      [workspaceId, ownerUserId]);
    await owner.query(`INSERT INTO member_roles (workspace_id, membership_id, role_id)
      SELECT $1, $2, id FROM roles WHERE workspace_id = $1 AND code = 'owner'`, [workspaceId, membership.rows[0].id]);
    await owner.query(`UPDATE workspace_invitations SET status = 'accepted', accepted_at = now() WHERE workspace_id = $1`, [workspaceId]);
  });

  it("opens with the firm's people to invite into and a default Sales pipeline", async () => {
    const roles = await owner.query<{ code: string; isSystem: boolean; permissions: number }>(
      `SELECT role.code, role.is_system AS "isSystem", count(granted.permission_id)::int AS permissions
         FROM roles role LEFT JOIN role_permissions granted ON granted.role_id = role.id
        WHERE role.workspace_id = $1 GROUP BY role.id ORDER BY role.code`, [workspaceId]);
    // The people who approve and pay come with the kit too, so the Owner isn't the only one who can act.
    expect(roles.rows.map((role) => role.code)).toEqual([
      "administrator", "buyer", "factory_lead", "finance", "finance_approver", "finance_reviewer", "member", "operations_approver", "owner", "project_manager",
      "purchasing_approver", "qc_inspector", "quantity_surveyor", "sales", "site_supervisor", "storekeeper", "viewer",
    ]);
    const byCode = Object.fromEntries(roles.rows.map((role) => [role.code, role]));
    // Sales sends its own quotes: it names the client's decision-maker (portal.contacts.manage).
    // The kit's Sales template, plus asking Woddy, which every kit role gets (the AI switch and credits still decide).
    const salesTemplate = ROLE_TEMPLATES.find((template) => template.code === "sales")!;
    expect(byCode.sales).toMatchObject({ isSystem: false, permissions: new Set([...salesTemplate.permissions, "ai.suggestions.use"]).size });
    expect(byCode.project_manager.permissions).toBeGreaterThan(byCode.site_supervisor.permissions);
    const salesPermissions = await owner.query<{ code: string }>(
      `SELECT permission.code FROM role_permissions granted JOIN roles role ON role.id = granted.role_id
         JOIN permissions permission ON permission.id = granted.permission_id
        WHERE role.workspace_id = $1 AND role.code = 'sales' ORDER BY permission.code`, [workspaceId]);
    const codes = salesPermissions.rows.map((row) => row.code);
    expect(codes).toEqual(expect.arrayContaining(["crm.leads.manage", "crm.opportunities.manage", "pre_projects.create", "pre_projects.edit", "ai.suggestions.use"]));
    expect([...codes].sort()).toEqual([...new Set([...salesTemplate.permissions, "ai.suggestions.use"])].sort());
    // No costs, approvals or settings; recording a client's decision given outside the portal is Sales' (Q-24).
    expect(codes.filter((code) => code.startsWith("commercial.") || code === "crm.settings.manage")).toEqual(["commercial.record_decision"]);

    const pipelines = await owner.query<{ code: string; isDefault: boolean; status: string; stages: number }>(
      `SELECT pipeline.code, pipeline.is_default AS "isDefault", pipeline.status,
              (SELECT count(*)::int FROM crm_pipeline_stages stage WHERE stage.pipeline_id = pipeline.id AND stage.status = 'active') AS stages
         FROM crm_pipelines pipeline WHERE pipeline.workspace_id = $1`, [workspaceId]);
    expect(pipelines.rows).toEqual([{ code: "sales", isDefault: true, status: "active", stages: DEFAULT_SALES_PIPELINE.stages.length }]);
  });

  it("lists the account for operators only", async () => {
    const listed = await directory.list(operatorA, { search: slug });
    expect(listed.accounts).toHaveLength(1);
    expect(listed.accounts[0].organizations[0]).toMatchObject({ workspaceId, slug, state: "trial" });
    await expect(directory.list(ownerUserId, {})).rejects.toThrow("Wodana operator access is required");
  });

  it("suspends reversibly: reads and exports work, writes are refused with a reason, and people are told", async () => {
    const suspended = await lifecycle.transition(externalTenantId, { expectedVersion: 0, to: "suspended",
      reason: "Suspended for the integration test" }, `suspend-${run}-key`, operatorA);
    expect(suspended).toMatchObject({ state: "suspended", workspaceStatus: "suspended", replayed: false });
    // The same key replays; a stale version is refused.
    await expect(lifecycle.transition(externalTenantId, { expectedVersion: 0, to: "suspended",
      reason: "Suspended for the integration test" }, `suspend-${run}-key`, operatorA)).resolves.toMatchObject({ replayed: true });
    await expect(lifecycle.transition(externalTenantId, { expectedVersion: 0, to: "active",
      reason: "Stale decision from an old screen" }, `stale-${run}-key`, operatorA)).rejects.toBeInstanceOf(ConflictException);

    const guard = new TenantWriteBlockGuard({ getAllAndOverride: () => false } as never, db);
    await expect(guard.canActivate(guardContext("GET"))).resolves.toBe(true);
    const blocked = await guard.canActivate(guardContext("POST")).catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(HttpException);
    expect((blocked as HttpException).getStatus()).toBe(423);
    expect(await workspaces.listMembers(actor as never, workspaceId)).toHaveLength(1);
    const refused = await invite(userEmails[3]).catch((error: unknown) => error);
    expect((refused as HttpException).getStatus()).toBe(423);

    const notices = await db.tenantTransaction(workspaceId, operatorA, (client) => client.query<{ audience: string; channel: string; status: string }>(
      `SELECT audience, channel, status FROM tenant_control_notices WHERE workspace_id = $1 AND event_type = 'lifecycle.suspended'`,
      [workspaceId]));
    expect(notices.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ audience: "tenant_owner", channel: "in_app", status: "sent" }),
      expect.objectContaining({ audience: "tenant_owner", channel: "email", status: "pending" }),
      expect.objectContaining({ audience: "operator", channel: "email", status: "not_configured" }),
    ]));

    await lifecycle.transition(externalTenantId, { expectedVersion: 1, to: "active", reason: "Payment received, access restored" },
      `reactivate-${run}-key`, operatorA);
    await expect(guard.canActivate(guardContext("POST"))).resolves.toBe(true);
  });

  it("denies tenant records without the operator's own active session and revokes it when the role changes", async () => {
    const denied = await support.members(externalTenantId, operator(operatorA)).catch((error: unknown) => error);
    expect(denied).toBeInstanceOf(ForbiddenException);
    const session = await support.request(externalTenantId, { reason: "Customer asked for help with roles", durationMinutes: 30 },
      `support-${run}-key`, operator(operatorA));
    await expect(support.command(externalTenantId, session.id, "approve", { expectedVersion: session.version }, operator(operatorA)))
      .rejects.toThrow("second operator");
    const approved = await support.command(externalTenantId, session.id, "approve", { expectedVersion: session.version }, operator(operatorB));
    await expect(support.members(externalTenantId, operator(operatorA))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(support.members(externalTenantId, operator(operatorB))).rejects.toBeInstanceOf(ForbiddenException);
    const started = await support.command(externalTenantId, session.id, "start", { expectedVersion: approved.version }, operator(operatorA));
    expect(started.status).toBe("active");
    const opened = await support.members(externalTenantId, operator(operatorA));
    expect(opened.members).toHaveLength(1);

    await owner.query(`UPDATE platform_administrators SET role = 'domain_operator' WHERE user_id = $1`, [operatorA]);
    const revoked = await support.members(externalTenantId, operator(operatorA)).catch((error: unknown) => error);
    expect((revoked as ForbiddenException).getResponse()).toMatchObject({ reason: "role_changed" });
    const state = await db.tenantTransaction(workspaceId, operatorB, (client) => client.query<{ status: string; endReason: string }>(
      `SELECT status, end_reason AS "endReason" FROM tenant_support_sessions WHERE id = $1`, [session.id]));
    expect(state.rows[0]).toEqual({ status: "revoked", endReason: "operator_role_changed" });
    await owner.query(`UPDATE platform_administrators SET role = 'administrator' WHERE user_id = $1`, [operatorA]);
  });

  it("gives the last seat to exactly one of two simultaneous invites, and keeps members after a downgrade", async () => {
    await owner.query(`UPDATE workspace_subscriptions SET seat_limit = 2 WHERE workspace_id = $1`, [workspaceId]);
    const results = await Promise.allSettled([invite(userEmails[3]), invite(userEmails[4])]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect((rejected!.reason as HttpException).getStatus()).toBe(409);
    expect(JSON.stringify((rejected!.reason as HttpException).getResponse())).toContain("Workspace seat limit reached");

    const before = await seatsService.view(externalTenantId, operatorA);
    await expect(seatsService.change(externalTenantId, { expectedVersion: before.version + 1, seatLimit: 1,
      reason: "Downgrade from a stale screen" }, operatorA)).rejects.toBeInstanceOf(ConflictException);
    await seatsService.change(externalTenantId, { expectedVersion: before.version, seatLimit: 1,
      reason: "Customer moved to a smaller plan" }, operatorA);
    await expect(invite(userEmails[5])).rejects.toBeInstanceOf(ConflictException);
    const seats = await seatsService.view(externalTenantId, operatorA);
    expect(seats.history[0]).toMatchObject({ from: 2, to: 1, reason: "Customer moved to a smaller plan" });
    expect(seats.position).toMatchObject({ limit: 1, members: 1, invitesBlocked: true });
    expect(await workspaces.listMembers(actor as never, workspaceId)).toHaveLength(1);
  });

  it("starts grace when payment is past due and suspends when grace ends, once, with notices", async () => {
    await owner.query(`INSERT INTO account_billing_documents (account_id, document_type, provider, external_reference, status,
        currency, total_amount, balance_amount, issued_at, due_at)
      SELECT account_id, 'invoice', 'manual', $2, 'issued', 'USD', 100, 100, now() - interval '40 days', now() - interval '10 days'
        FROM customer_account_organizations WHERE workspace_id = $1`, [workspaceId, `INV-${run}`]);
    await expect(sweep.runWorkspace(workspaceId)).resolves.toMatchObject({ lifecycle: "grace" });
    await expect(sweep.runWorkspace(workspaceId)).resolves.toMatchObject({ lifecycle: null });
    const grace = await lifecycle.overview(externalTenantId, operatorA);
    expect(grace).toMatchObject({ state: "grace", workspaceStatus: "active" });
    expect(grace.history[0]).toMatchObject({ automated: true, state: "grace" });

    // Time passes: the stored grace end moves into the past (the table is append-only, so the test steps around its trigger).
    const clock = await owner.connect();
    try {
      await clock.query("BEGIN");
      await clock.query("SET LOCAL session_replication_role = replica");
      await clock.query(`UPDATE tenant_lifecycle_versions SET grace_ends_at = now() - interval '1 minute'
        WHERE workspace_id = $1 AND state = 'grace'`, [workspaceId]);
      await clock.query("COMMIT");
    } finally {
      clock.release();
    }
    await expect(sweep.runWorkspace(workspaceId)).resolves.toMatchObject({ lifecycle: "suspended" });
    const suspended = await lifecycle.overview(externalTenantId, operatorA);
    expect(suspended).toMatchObject({ state: "suspended", workspaceStatus: "suspended" });
    expect(suspended.notices.map((notice) => notice.eventType)).toEqual(expect.arrayContaining(["lifecycle.grace_started", "lifecycle.suspended"]));
  });
});
