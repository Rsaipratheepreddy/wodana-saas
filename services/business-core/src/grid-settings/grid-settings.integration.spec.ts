import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { GridSettingsService } from "./grid-settings.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Every service call runs as the
// app role (wodana_app, forced RLS) in its own committed transaction, through the real permission checks.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("list defaults (R14) on a real database", { timeout: 30_000 }, () => {
  let pool: Pool;
  const workspaces: string[] = [];
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 8 });
  });
  afterAll(async () => {
    for (const id of workspaces) await pool.query("DELETE FROM workspaces WHERE id = $1", [id]).catch(() => undefined);
    await pool.end();
  });

  async function asApp<T>(workspaceId: string, actorId: string, work: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_actor_id', $2, true)", [workspaceId, actorId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  /** A workspace with a manager (Sales settings) and a viewer (can only see enquiries). */
  async function seedWorkspace() {
    const workspaceId = randomUUID(), manager = randomUUID(), viewer = randomUUID();
    const managerRole = randomUUID(), viewerRole = randomUUID(), managerMember = randomUUID(), viewerMember = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO users(id, primary_email, display_name) VALUES ($1, $2, 'Manager'), ($3, $4, 'Viewer')", [manager, `${manager}@example.com`, viewer, `${viewer}@example.com`]);
      await client.query("INSERT INTO workspaces(id, name, slug, default_currency, created_by) VALUES ($1, 'Studio', $2, 'GBP', $3)", [workspaceId, `grid-${workspaceId.slice(0, 8)}`, manager]);
      await client.query("INSERT INTO workspace_memberships(id, workspace_id, user_id, status) VALUES ($1, $2, $3, 'active'), ($4, $2, $5, 'active')", [managerMember, workspaceId, manager, viewerMember, viewer]);
      await client.query("INSERT INTO roles(id, workspace_id, code, name, is_system) VALUES ($1, $3, 'manager', 'Manager', false), ($2, $3, 'viewer', 'Viewer', false)", [managerRole, viewerRole, workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE code = ANY($3::text[])", [workspaceId, managerRole, ["crm.leads.view", "crm.settings.manage"]]);
      await client.query("INSERT INTO role_permissions(workspace_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE code = ANY($3::text[])", [workspaceId, viewerRole, ["crm.leads.view"]]);
      await client.query("INSERT INTO member_roles(workspace_id, membership_id, role_id) VALUES ($1, $2, $3), ($1, $4, $5)", [workspaceId, managerMember, managerRole, viewerMember, viewerRole]);
      await client.query("COMMIT");
    } finally { client.release(); }
    workspaces.push(workspaceId);
    return { workspaceId, manager, viewer };
  }

  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  const as = (userId: string) => {
    const identities = { resolveActor: async () => ({ userId }) };
    return new GridSettingsService(new WorkspaceAccessService({ tenantTransaction: asApp } as never, identities as never));
  };

  it("starts with no hidden columns; a manager saves the default and every member reads it", async () => {
    const ws = await seedWorkspace();
    const viewer = as(ws.viewer), manager = as(ws.manager);
    expect(await viewer.get(actor, ws.workspaceId, "crm.enquiries")).toMatchObject({ hiddenColumns: [], version: 0, canManage: false, updatedAt: null });
    expect(await manager.get(actor, ws.workspaceId, "crm.enquiries")).toMatchObject({ canManage: true });

    const saved = await manager.save(actor, ws.workspaceId, "crm.enquiries", { hiddenColumns: ["source", "budget", "source"], version: 0, requestId: randomUUID() });
    expect(saved).toMatchObject({ hiddenColumns: ["budget", "source"], version: 1, canManage: true });
    expect(await viewer.get(actor, ws.workspaceId, "crm.enquiries")).toMatchObject({ hiddenColumns: ["budget", "source"], version: 1, canManage: false });

    const changed = await manager.save(actor, ws.workspaceId, "crm.enquiries", { hiddenColumns: ["owner"], version: 1, requestId: randomUUID() });
    expect(changed).toMatchObject({ hiddenColumns: ["owner"], version: 2 });
    // Another list is separate.
    expect(await viewer.get(actor, ws.workspaceId, "crm.opportunities")).toMatchObject({ hiddenColumns: [], version: 0 });

    const audit = await pool.query(`SELECT action, before, after FROM audit_events WHERE workspace_id = $1 AND entity_type = 'workspace_grid_settings' ORDER BY occurred_at`, [ws.workspaceId]);
    expect(audit.rows.map((row) => row.action)).toEqual(["workspace.grid_default_changed.v1", "workspace.grid_default_changed.v1"]);
    expect(audit.rows[1]).toMatchObject({ before: { hiddenColumns: ["budget", "source"], version: 1 }, after: { hiddenColumns: ["owner"], version: 2 } });
  });

  it("refuses a member without the module's manage permission, and lists outside the modules", async () => {
    const ws = await seedWorkspace();
    await expect(as(ws.viewer).save(actor, ws.workspaceId, "crm.enquiries", { hiddenColumns: ["source"], version: 0, requestId: randomUUID() })).rejects.toBeInstanceOf(ForbiddenException);
    // The manager manages Sales only: the Projects list needs projects.manage.
    await expect(as(ws.manager).save(actor, ws.workspaceId, "projects.list", { hiddenColumns: ["stage"], version: 0, requestId: randomUUID() })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(as(ws.manager).get(actor, ws.workspaceId, "control.accounts")).rejects.toBeInstanceOf(NotFoundException);
    await expect(as(ws.manager).save(actor, ws.workspaceId, "crm.enquiries", { hiddenColumns: ["drop table"], version: 0, requestId: randomUUID() })).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(await as(ws.viewer).get(actor, ws.workspaceId, "crm.enquiries")).toMatchObject({ version: 0, hiddenColumns: [] });
  });

  it("keeps each workspace's defaults to itself", async () => {
    const one = await seedWorkspace(), two = await seedWorkspace();
    await as(one.manager).save(actor, one.workspaceId, "crm.enquiries", { hiddenColumns: ["source"], version: 0, requestId: randomUUID() });
    expect(await as(two.viewer).get(actor, two.workspaceId, "crm.enquiries")).toMatchObject({ hiddenColumns: [], version: 0 });
    // A member of another workspace cannot read or write it (not even learn that it exists).
    await expect(as(two.manager).get(actor, one.workspaceId, "crm.enquiries")).rejects.toBeInstanceOf(NotFoundException);
    await expect(as(two.manager).save(actor, one.workspaceId, "crm.enquiries", { hiddenColumns: [], version: 1, requestId: randomUUID() })).rejects.toBeInstanceOf(NotFoundException);
    expect(await as(one.viewer).get(actor, one.workspaceId, "crm.enquiries")).toMatchObject({ hiddenColumns: ["source"], version: 1 });
    // Forced RLS: in workspace two's tenant context, workspace one's rows are invisible and cannot be written.
    const seen = await asApp(two.workspaceId, two.manager, (client) => client.query("SELECT count(*)::int AS count FROM workspace_grid_hidden_columns WHERE workspace_id = $1", [one.workspaceId]));
    expect(seen.rows[0].count).toBe(0);
    await expect(asApp(two.workspaceId, two.manager, (client) => client.query(
      "INSERT INTO workspace_grid_settings (workspace_id, grid_key) VALUES ($1, 'crm.customers')", [one.workspaceId]))).rejects.toThrow(/row-level security/);
  });

  it("refuses a stale version and replays the same request without saving twice", async () => {
    const ws = await seedWorkspace();
    const manager = as(ws.manager);
    const requestId = randomUUID();
    const first = await manager.save(actor, ws.workspaceId, "crm.enquiries", { hiddenColumns: ["source"], version: 0, requestId });
    const replay = await manager.save(actor, ws.workspaceId, "crm.enquiries", { hiddenColumns: ["source"], version: 0, requestId });
    expect(replay).toMatchObject({ hiddenColumns: ["source"], version: first.version, replayed: true });
    await expect(manager.save(actor, ws.workspaceId, "crm.enquiries", { hiddenColumns: ["owner"], version: 0, requestId })).rejects.toBeInstanceOf(ConflictException);
    await expect(manager.save(actor, ws.workspaceId, "crm.enquiries", { hiddenColumns: ["owner"], version: 0, requestId: randomUUID() })).rejects.toThrow("This list's default changed");

    // Two people saving from the same version at once: exactly one wins.
    const results = await Promise.allSettled([
      manager.save(actor, ws.workspaceId, "crm.enquiries", { hiddenColumns: ["a"], version: 1, requestId: randomUUID() }),
      manager.save(actor, ws.workspaceId, "crm.enquiries", { hiddenColumns: ["b"], version: 1, requestId: randomUUID() }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const audits = await pool.query(`SELECT count(*)::int AS count FROM audit_events WHERE workspace_id = $1 AND action = 'workspace.grid_default_changed.v1'`, [ws.workspaceId]);
    expect(audits.rows[0].count).toBe(2);
  });
});
