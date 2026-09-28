import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../database/database.service";
import { seedDefaultNotificationTemplates } from "../../notifications/default-templates";
import { ensurePurchasingSettings } from "../../purchasing/orders";
import type { RequestActor } from "../actor";
import { IdentityService } from "../identity.service";
import { runViewingAs, type ViewAsContext } from "./view-as.context";
import { ViewAsGuard } from "./view-as.guard";
import { ViewAsService } from "./view-as.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back,
// except the one proving that view-as work is discarded, which cleans up its own committed fixture.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type People = "owner" | "admin" | "sales" | "operator";
type World = {
  a: string; b: string;
  users: Record<People, string>; memberships: Record<People, string>; roles: { owner: string; administrator: string; sales: string };
  actor: (who: People) => RequestActor & { sessionId: string };
  viewAs: ViewAsService; identities: IdentityService; guard: ViewAsGuard;
};

integration("view as", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  const failure = async (client: PoolClient, work: () => Promise<unknown>) => {
    await client.query("SAVEPOINT expected_failure");
    try { await work(); return null; } catch (error) { return error as { code?: string; message: string; getResponse?: () => unknown }; }
    finally { await client.query("ROLLBACK TO SAVEPOINT expected_failure"); }
  };
  const code = (error: unknown) => ((error as ForbiddenException).getResponse() as { code?: string }).code;

  async function world(work: (client: PoolClient, world: World) => Promise<void>) {
    const client = await pool.connect();
    const a = randomUUID(), b = randomUUID();
    const users = { owner: randomUUID(), admin: randomUUID(), sales: randomUUID(), operator: randomUUID() };
    const memberships = { owner: randomUUID(), admin: randomUUID(), sales: randomUUID(), operator: randomUUID() };
    const roles = { owner: randomUUID(), administrator: randomUUID(), sales: randomUUID() };
    const sessions = { owner: randomUUID(), admin: randomUUID(), sales: randomUUID(), operator: randomUUID() };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      const names: Record<People, string> = { owner: "Olivia Owner", admin: "Adam Admin", sales: "Sara Sales", operator: "Omar Operator" };
      for (const who of Object.keys(users) as People[]) {
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [users[who], `va-${users[who].slice(0, 8)}@example.com`, names[who]]);
        await client.query("INSERT INTO user_identities(user_id,provider,provider_subject,email_at_provider,last_login_at) VALUES($1,'local',$2,$3,'2026-01-01T00:00:00Z')",
          [users[who], `local:${users[who]}`, `va-${users[who].slice(0, 8)}@example.com`]);
      }
      for (const [workspaceId, name] of [[a, "Studio A"], [b, "Studio B"]]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,$2,$3,'USD',$4)", [workspaceId, name, `va-${workspaceId.slice(0, 8)}`, users.owner]);
        await client.query("INSERT INTO workspace_onboarding(workspace_id,status,current_step) VALUES($1,'completed','complete')", [workspaceId]);
      }
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$4,'owner','Owner',true),($2,$4,'administrator','Administrator',true),($3,$4,'sales','Sales',false)",
        [roles.owner, roles.administrator, roles.sales, a]);
      await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1, role.id, permission.id
          FROM (VALUES ($2::uuid), ($3::uuid)) role(id) CROSS JOIN permissions permission`, [a, roles.owner, roles.administrator]);
      await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code IN ('crm.leads.view','crm.activities.view')`, [a, roles.sales]);
      const assigned: Record<People, string> = { owner: roles.owner, admin: roles.administrator, sales: roles.sales, operator: roles.sales };
      for (const who of Object.keys(users) as People[]) {
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status,joined_at) VALUES($1,$2,$3,'active',now())", [memberships[who], a, users[who]]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [a, memberships[who], assigned[who]]);
      }
      await client.query("INSERT INTO platform_administrators(user_id, role) VALUES($1,'support_observer')", [users.operator]);
      await seedDefaultNotificationTemplates(client, a);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("SET LOCAL ROLE wodana_app");

      // One test transaction stands in for the pool: tenant work sets its workspace and actor, as in production.
      const setTenant = (workspaceId: string, actorId: string) =>
        client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [workspaceId, actorId]);
      const db = {
        query: (text: string, values: unknown[] = []) => client.query(text, values),
        transaction: async <T>(fn: (c: PoolClient) => Promise<T>) => fn(client),
        tenantTransaction: async <T>(workspaceId: string, actorId: string, fn: (c: PoolClient) => Promise<T>) => { await setTenant(workspaceId, actorId); return fn(client); },
        actorTransaction: async <T>(actorId: string, fn: (c: PoolClient) => Promise<T>) => {
          await client.query("SELECT set_config('app.current_workspace_id','',true), set_config('app.current_actor_id',$1,true)", [actorId]); return fn(client);
        },
      } as unknown as DatabaseService;
      const identities = new IdentityService(db);
      const viewAs = new ViewAsService(db, identities);
      const guard = new ViewAsGuard({ getAllAndOverride: () => false } as never, viewAs);
      const actor = (who: People) => ({ subject: `local:${users[who]}`, provider: "local", email: `va-${users[who].slice(0, 8)}@example.com`,
        displayName: who, sessionId: sessions[who], mfaVerifiedAt: new Date() });
      await work(client, { a, b, users, memberships, roles, actor, viewAs, identities, guard });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const httpContext = (request: object) => ({
    getType: () => "http", getHandler: () => undefined, getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as never;

  it("lets an owner view as a team member, refuses every change, and keeps reads as the subject", async () => {
    await world(async (client, { a, users, memberships, actor, viewAs, identities, guard }) => {
      const started = await viewAs.start(actor("owner"), a, { kind: "person", membershipId: memberships.sales, returnPath: "/workspace/settings/members" }, "view-as-test-1");
      expect(started).toMatchObject({ kind: "person", subjectName: "Sara Sales", subjectRoleLabel: "Sales", returnPath: "/workspace/settings/members", replayed: false });
      expect(new Date(started.expiresAt).getTime() - new Date(started.startedAt).getTime()).toBe(30 * 60_000);
      // Idempotent: the same key returns the same view.
      expect(await viewAs.start(actor("owner"), a, { kind: "person", membershipId: memberships.sales }, "view-as-test-1"))
        .toMatchObject({ sessionId: started.sessionId, replayed: true });

      // Every change from that sign-in session is refused; reads go through as the subject and are recorded.
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const refused = await guard.canActivate(httpContext({ method, params: { workspaceId: a }, headers: {}, originalUrl: `/api/v1/workspaces/${a}/crm/leads`, actor: actor("owner") }))
          .catch((error: unknown) => error);
        expect(code(refused)).toBe("view_as_read_only");
      }
      const read = { method: "GET", params: { workspaceId: a }, headers: {}, originalUrl: `/api/v1/workspaces/${a}/crm/leads?page=1`, actor: actor("owner") as RequestActor };
      await expect(guard.canActivate(httpContext(read))).resolves.toBe(true);
      const session = read.actor.viewAs as ViewAsContext;
      expect(session).toMatchObject({ sessionId: started.sessionId, kind: "person", effectiveUserId: users.sales, viewerUserId: users.owner });
      // The subject's permissions narrowed to the viewer's, plus what every member has.
      expect([...session.permissions].sort()).toEqual(["crm.activities.view", "crm.leads.view", "hrms.self"]);
      await guard.canActivate(httpContext({ ...read, params: {}, originalUrl: "/api/v1/me", headers: { "x-wodana-page": "/workspace/crm/leads" }, actor: actor("owner") }));
      await guard.canActivate(httpContext({ ...read, actor: actor("owner") }));
      const visits = await client.query(`SELECT route, open_count AS count FROM view_as_session_views WHERE session_id = $1 ORDER BY route`, [started.sessionId]);
      expect(visits.rows).toEqual([{ route: "GET /crm/leads", count: 2 }, { route: "page /workspace/crm/leads", count: 1 }]);

      // The viewer's other sign-in sessions are not in the view.
      expect(await viewAs.resolve({ ...actor("owner"), sessionId: randomUUID() })).toBeNull();

      // /me is the subject's: their name, roles and permissions in that one workspace, and the view's banner facts.
      const profile = await runViewingAs(session, true, () => identities.getProfile({ ...actor("owner"), viewAs: session }));
      expect(profile).toMatchObject({ id: users.sales, displayName: "Sara Sales", platformRole: null, pendingInvitations: [],
        viewAs: { sessionId: started.sessionId, subjectName: "Sara Sales", subjectRoleLabel: "Sales" } });
      expect(profile.memberships.map((membership) => [membership.workspaceId, membership.roles])).toEqual([[a, ["sales"]]]);
      expect(profile.memberships[0].allowedPermissions).not.toContain("workspace.view_as");
      expect(profile.memberships[0].allowedModules).toEqual(["workspace", "crm", "hrms"]);

      // No chaining: a view can't be started from inside a view.
      expect(code(await failure(client, () => viewAs.start({ ...actor("owner"), viewAs: session }, a, { kind: "person", membershipId: memberships.admin }, "view-as-test-2"))))
        .toBe("view_as_chained");

      // Exit: the audit keeps the pages and routes, the subject is told, and their Security > Activity lists it.
      const exited = await viewAs.exit({ ...actor("owner"), viewAs: session }, a, started.sessionId);
      expect(exited).toMatchObject({ returnPath: "/workspace/settings/members", endReason: "exited" });
      expect(await viewAs.resolve(actor("owner"))).toBeNull();
      await expect(guard.canActivate(httpContext({ ...read, method: "POST", actor: actor("owner") }))).resolves.toBe(true);
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [a]);
      const audit = await client.query<{ action: string; actor: string; after: { routes?: unknown[]; reason?: string } }>(
        `SELECT action, actor_user_id AS actor, after FROM audit_events WHERE workspace_id = $1 AND entity_id = $2 ORDER BY occurred_at, action`,
        [a, started.sessionId]);
      expect(audit.rows.map((row) => [row.action, row.actor])).toEqual([["view_as.started", users.owner], ["view_as.ended", users.owner]]);
      expect(audit.rows[1].after).toMatchObject({ reason: "exited", routes: [{ route: "GET /crm/leads", count: 2 }, { route: "page /workspace/crm/leads", count: 1 }] });
      const notices = await client.query(`SELECT subject, body, deep_link AS link FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type = 'workspace.viewed_as'`, [a, users.sales]);
      expect(notices.rows).toEqual([{ subject: "Olivia Owner viewed as you", body: expect.stringMatching(/^Read-only, 1 min from .+\. Security lists every view\.$/), link: "/workspace/settings/security#activity" }]);
      const mine = await viewAs.aboutMe(actor("sales"), a);
      expect(mine.sessions).toEqual([expect.objectContaining({ viewerName: "Olivia Owner", minutes: 1, open: false })]);
      // Exiting again is harmless.
      expect(await viewAs.exit(actor("owner"), a, started.sessionId)).toMatchObject({ endReason: "exited" });
    });
  });

  it("refuses an administrator viewing as an owner, a Wodana operator, oneself, and people without the permission", async () => {
    await world(async (client, { a, memberships, actor, viewAs }) => {
      const refused = async (who: People, membershipId: string) => failure(client, () =>
        viewAs.start(actor(who), a, { kind: "person", membershipId }, `refuse-${randomUUID()}`));
      expect(code(await refused("admin", memberships.owner))).toBe("view_as_owner_protected");
      expect(code(await refused("owner", memberships.operator))).toBe("view_as_operator");
      expect(code(await refused("owner", memberships.owner))).toBe("view_as_self");
      expect(code(await refused("sales", memberships.admin))).toBe("view_as_not_allowed");
      const missing = await refused("owner", randomUUID());
      expect(missing).toBeInstanceOf(NotFoundException);
      // An administrator may view as another administrator's peer (a team member) and as an administrator.
      await expect(viewAs.start(actor("admin"), a, { kind: "person", membershipId: memberships.sales }, "admin-sales-test-1")).resolves.toMatchObject({ subjectName: "Sara Sales" });
    });
  });

  it("previews a role for 15 minutes with that role's permissions, and ends a view past its time", async () => {
    await world(async (client, { a, users, roles, memberships, actor, viewAs }) => {
      const preview = await viewAs.start(actor("admin"), a, { kind: "role", roleId: roles.sales }, "role-preview-test-1");
      expect(new Date(preview.expiresAt).getTime() - new Date(preview.startedAt).getTime()).toBe(15 * 60_000);
      const session = await viewAs.resolve(actor("admin"));
      expect(session).toMatchObject({ kind: "role", effectiveUserId: users.admin, subjectName: "Sales" });
      expect([...session!.permissions].sort()).toEqual(["crm.activities.view", "crm.leads.view", "hrms.self"]);
      expect(code(await failure(client, () => viewAs.start(actor("admin"), a, { kind: "role", roleId: roles.owner }, "role-preview-test-2")))).toBe("view_as_owner_protected");

      // A person view past its 30 minutes: the next request ends it (as the sweep would) and the subject is told.
      const view = await viewAs.start(actor("owner"), a, { kind: "person", membershipId: memberships.sales }, "expiring-test-1");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [a]);
      await client.query(`UPDATE view_as_sessions SET started_at = now() - interval '40 minutes', expires_at = now() - interval '10 minutes' WHERE id = $1`, [view.sessionId]);
      expect(await viewAs.resolve(actor("owner"))).toBeNull();
      const ended = await client.query(`SELECT end_reason AS reason, subject_notified_at IS NOT NULL AS notified FROM view_as_sessions WHERE id = $1`, [view.sessionId]);
      expect(ended.rows).toEqual([{ reason: "expired", notified: true }]);

      // The workspace can turn the notice off (version-checked); the Activity record stays.
      await expect(viewAs.updateSettings(actor("owner"), a, { notifySubject: false, version: 1 })).rejects.toThrow(/changed/);
      expect(await viewAs.updateSettings(actor("owner"), a, { notifySubject: false, version: 0 })).toEqual({ notifySubject: false, version: 1 });
      const quiet = await viewAs.start(actor("owner"), a, { kind: "person", membershipId: memberships.sales }, "quiet-test-1");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [a]);
      await client.query(`UPDATE view_as_sessions SET started_at = now() - interval '40 minutes', expires_at = now() - interval '10 minutes' WHERE id = $1`, [quiet.sessionId]);
      expect(await viewAs.sweep(a)).toEqual({ expired: 1 });
      const notices = await client.query(`SELECT count(*)::int AS count FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type = 'workspace.viewed_as'`, [a, users.sales]);
      expect(notices.rows[0].count).toBe(1);
      expect((await viewAs.aboutMe(actor("sales"), a)).sessions).toHaveLength(2);
    });
  });

  it("keeps view-as sessions, their pages and the setting inside their workspace (forced RLS)", async () => {
    await world(async (client, { a, b, memberships, actor, viewAs }) => {
      const started = await viewAs.start(actor("owner"), a, { kind: "person", membershipId: memberships.sales }, "rls-test-1");
      await viewAs.updateSettings(actor("owner"), a, { notifySubject: false, version: 0 });
      const session = await viewAs.resolve(actor("owner"));
      await viewAs.recordVisit(session!, "GET /crm/leads");
      const guarded = await client.query<{ name: string }>(
        `SELECT relname AS name FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity ORDER BY relname`,
        [["view_as_sessions", "view_as_session_views", "workspace_view_as_settings"]]);
      expect(guarded.rows.map((row) => row.name)).toEqual(["view_as_session_views", "view_as_sessions", "workspace_view_as_settings"]);
      const policies = await client.query<{ table: string }>(`SELECT tablename AS table FROM pg_policies WHERE policyname = 'tenant_isolation'
        AND tablename IN ('view_as_sessions', 'view_as_session_views', 'workspace_view_as_settings') ORDER BY tablename`);
      expect(policies.rows).toHaveLength(3);

      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [b]);
      for (const table of ["view_as_sessions", "view_as_session_views", "workspace_view_as_settings"]) {
        expect((await client.query(`SELECT 1 FROM ${table}`)).rowCount).toBe(0);
      }
      expect((await client.query(`UPDATE view_as_sessions SET end_reason = 'revoked', ended_at = now() WHERE id = $1`, [started.sessionId])).rowCount).toBe(0);
      expect(await failure(client, () => client.query(`INSERT INTO view_as_session_views (workspace_id, session_id, route) VALUES ($1, $2, 'sneak')`, [a, started.sessionId])))
        .toMatchObject({ message: expect.stringMatching(/row-level security/) });
      // The record can't be removed by the app.
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [a]);
      expect(await failure(client, () => client.query(`DELETE FROM view_as_sessions WHERE id = $1`, [started.sessionId]))).toMatchObject({ code: "42501" });
      expect((await client.query(`SELECT count(*)::int AS count FROM view_as_sessions`)).rows[0].count).toBe(1);
    });
  });

  it("discards every write made while viewing as someone: no last seen, no default rows, no changes", async () => {
    const setup = await pool.connect();
    const user = randomUUID(), subject = randomUUID(), workspaceId = randomUUID();
    const database = new DatabaseService({ get: (key: string, fallback?: unknown) => key === "DATABASE_URL" ? databaseUrl : fallback } as never);
    try {
      await setup.query("BEGIN");
      await setup.query("SET LOCAL session_replication_role = replica");
      await setup.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Viewer'),($3,$4,'Subject')",
        [user, `va-${user.slice(0, 8)}@example.com`, subject, `va-${subject.slice(0, 8)}@example.com`]);
      await setup.query("INSERT INTO user_identities(user_id,provider,provider_subject,email_at_provider,last_login_at) VALUES($1,'local',$2,$3,'2026-01-01T00:00:00Z'),($4,'local',$5,$6,'2026-01-01T00:00:00Z')",
        [user, `local:${user}`, `va-${user.slice(0, 8)}@example.com`, subject, `local:${subject}`, `va-${subject.slice(0, 8)}@example.com`]);
      await setup.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Discard',$2,'USD',$3)", [workspaceId, `va-${workspaceId.slice(0, 8)}`, user]);
      await setup.query("COMMIT");

      const session: ViewAsContext = { sessionId: randomUUID(), workspaceId, kind: "person", viewerUserId: user, viewerMembershipId: randomUUID(),
        subjectUserId: subject, subjectMembershipId: randomUUID(), subjectRoleId: null, subjectName: "Subject", subjectRoleLabel: null,
        effectiveUserId: subject, permissions: new Set(), startedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), returnPath: null };
      const actor = { subject: `local:${user}`, provider: "local", email: "v@example.com", displayName: "Viewer", viewAs: session };
      const identities = new IdentityService(database);
      await runViewingAs(session, true, async () => {
        // The identity is the subject's, and neither person gets a "last sign-in" from it.
        expect(await identities.resolveActor(actor)).toMatchObject({ userId: subject });
        // A read that creates its default row on first use still reads, and the row does not stay.
        const settings = await database.tenantTransaction(workspaceId, subject, (client) => ensurePurchasingSettings(client, workspaceId));
        expect(settings).toMatchObject({ version: 1 });
        // A mark-read or "last seen" style write inside a read, through a transaction or a single statement.
        await database.tenantTransaction(workspaceId, subject, (client) => client.query("UPDATE user_identities SET last_login_at = now() WHERE user_id = $1", [subject]));
        await database.query("UPDATE users SET display_name = 'Changed' WHERE id = $1", [subject]);
      });
      const after = await setup.query<{ name: string; seen: Date }>(
        `SELECT app_user.display_name AS name, identity.last_login_at AS seen FROM users app_user JOIN user_identities identity ON identity.user_id = app_user.id WHERE app_user.id = ANY($1::uuid[]) ORDER BY app_user.display_name`,
        [[user, subject]]);
      expect(after.rows.map((row) => [row.name, row.seen.toISOString()])).toEqual([["Subject", "2026-01-01T00:00:00.000Z"], ["Viewer", "2026-01-01T00:00:00.000Z"]]);
      await setup.query("SELECT set_config('app.current_workspace_id',$1,false)", [workspaceId]);
      expect((await setup.query("SELECT 1 FROM workspace_purchasing_settings WHERE workspace_id = $1", [workspaceId])).rowCount).toBe(0);
      // Outside a view the same write is kept, so the discard is the view's doing.
      await database.query("UPDATE users SET display_name = 'Subject kept' WHERE id = $1", [subject]);
      expect((await setup.query("SELECT display_name AS name FROM users WHERE id = $1", [subject])).rows[0].name).toBe("Subject kept");
    } finally {
      await setup.query("ROLLBACK").catch(() => undefined);
      await setup.query("BEGIN");
      await setup.query("SET LOCAL session_replication_role = replica");
      await setup.query("DELETE FROM workspace_purchasing_settings WHERE workspace_id = $1", [workspaceId]);
      await setup.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await setup.query("DELETE FROM user_identities WHERE user_id = ANY($1::uuid[])", [[user, subject]]);
      await setup.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[user, subject]]);
      await setup.query("COMMIT");
      setup.release();
      await database.onModuleDestroy();
    }
  });
});
