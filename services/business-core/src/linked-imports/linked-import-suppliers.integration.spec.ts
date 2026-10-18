import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CatalogV2Service } from "../catalog-core/catalog-v2.service";
import { InventoryService } from "../inventory/inventory.service";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { SuppliersService } from "../purchasing/suppliers.service";
import { suggestMapping } from "./import-mapping";
import { LinkedImportsService } from "./linked-imports.service";
import type { SourceSheet } from "./linked-import-source";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = {} as never;

type World = { client: PoolClient; workspaceId: string; owner: string; as: (userId: string, canApprove?: boolean) => { imports: LinkedImportsService; suppliers: SuppliersService } };

// A supplier sheet as firms keep it: the directors' approval in its own column.
const HEADING = ["Company Name", "Supplier Type", "DIRECTORS APPROVED/NOT APPROVED"];
const list = (rows: string[][]): SourceSheet[] => [{ name: "Suppliers", rows: [HEADING, ...rows] }];

integration("a supplier sheet's approval column (L6)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), owner = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Rana Owner')", [owner, `${owner.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,default_locale,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai','en-AE',$3)", [workspaceId, `sup-${workspaceId.slice(0, 8)}`, owner]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [randomUUID(), workspaceId, owner]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const run_ = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const access = (userId: string, canApprove: boolean) => ({ asMember: (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId }),
        withPermission: run_(userId), withPermissions: run_(userId), withAnyPermission: run_(userId),
        hasPermission: async (_c: unknown, _w: string, _u: string, permission: string) => permission !== "vendors.approve" || canApprove } as never);
      const db = { query: (text: string, values?: unknown[]) => client.query(text, values), tenantTransaction: (_w: string, _a: string, fn: (c: PoolClient) => unknown) => fn(client) } as never;
      const as = (userId: string, canApprove = true) => {
        const suppliers = new SuppliersService(access(userId, canApprove));
        return { suppliers, imports: new LinkedImportsService(access(userId, canApprove), db, new InventoryService(access(userId, canApprove)),
          new CatalogV2Service(access(userId, canApprove), {} as never), { read: vi.fn() } as never, suppliers) };
      };
      await run({ client, workspaceId, owner, as });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("sets approved, nominated (preferred) and not approved; N/A and blank leave the approval as it is; the words stay as an attribute", async () => {
    await world(async (w) => {
      const { imports, suppliers } = w.as(w.owner);
      // Reviewed before: N/A on the sheet doesn't undo it.
      const kept = randomUUID();
      await suppliers.save(actor, w.workspaceId, { id: kept, name: "Kept Joinery", categories: ["Joinery"] });
      const before = (await suppliers.list(actor, w.workspaceId)).suppliers.find((item) => item.id === kept)!;
      await suppliers.approve(actor, w.workspaceId, kept, { version: before.version, approval: "approved" });

      const sheets = list([
        ["Stone Co", "Marble", "APPROVED MARBLE SUPPLIER"],
        ["Paint Co", "Paint", "NOMINATED PAINT SUPPLIER"],
        ["Cheap Co", "Tiles", "NOT APPROVED"],
        ["Kept Joinery", "Joinery", "N/A"],
        ["New Lamps", "Lighting", ""],
      ]);
      // The importer's guess maps the column to the approval.
      const mapping = suggestMapping("suppliers", HEADING);
      expect(mapping.columns).toMatchObject({ "Company Name": "name", "Supplier Type": "categories", "DIRECTORS APPROVED/NOT APPROVED": "approval" });
      const draft = { target: "suppliers", source: "upload", name: "Suppliers", mapping, sheets };
      const preview = await imports.preview(actor, w.workspaceId, draft);
      expect(preview.rows.find((row) => row.key === "Stone Co")?.changes).toContain("Approval → Approved");
      expect(preview.rows.find((row) => row.key === "Paint Co")?.changes).toContain("Approval → Preferred for Paint");
      expect(preview.rows.find((row) => row.key === "Cheap Co")?.changes).toContain("Approval → Not approved");
      expect(preview.rows.find((row) => row.key === "Kept Joinery")?.changes ?? []).not.toEqual(expect.arrayContaining([expect.stringMatching(/^Approval/)]));
      await imports.apply(actor, w.workspaceId, { ...draft, runId: randomUUID(), expectedFingerprint: preview.fingerprint });

      const state = (await suppliers.list(actor, w.workspaceId)).suppliers;
      const find = (name: string) => state.find((item) => item.name === name)!;
      expect(find("Stone Co")).toMatchObject({ approval: "approved", preferredFor: [], approvalNote: "APPROVED MARBLE SUPPLIER",
        attributes: [{ name: "DIRECTORS APPROVED/NOT APPROVED", value: "APPROVED MARBLE SUPPLIER" }] });
      expect(find("Paint Co")).toMatchObject({ approval: "approved", preferredFor: ["Paint"] });
      expect(find("Cheap Co")).toMatchObject({ approval: "not_approved", approvalNote: "NOT APPROVED" });
      expect(find("Kept Joinery")).toMatchObject({ approval: "approved", attributes: [{ name: "DIRECTORS APPROVED/NOT APPROVED", value: "N/A" }] });
      expect(find("New Lamps")).toMatchObject({ approval: "pending" });
      const audit = (await w.client.query<{ count: string }>(`SELECT count(*)::text AS count FROM audit_events WHERE workspace_id = $1 AND action = 'supplier.approval_changed'`, [w.workspaceId])).rows[0];
      // The one made by hand above, and three from the sheet.
      expect(audit.count).toBe("4");

      // The same sheet again changes nothing.
      const again = await imports.preview(actor, w.workspaceId, draft);
      expect(again.summary).toMatchObject({ added: 0, changed: 0 });
    });
  });

  it("leaves the approval to someone who may approve suppliers, and says so", async () => {
    await world(async (w) => {
      const { imports, suppliers } = w.as(w.owner, false);
      const draft = { target: "suppliers", source: "upload", name: "Suppliers", mapping: suggestMapping("suppliers", HEADING), sheets: list([["Stone Co", "Marble", "APPROVED"]]) };
      const preview = await imports.preview(actor, w.workspaceId, draft);
      expect(preview.rows[0]).toMatchObject({ outcome: "added", message: "The approval wasn't imported: approving suppliers needs the approve permission." });
      await imports.apply(actor, w.workspaceId, { ...draft, runId: randomUUID(), expectedFingerprint: preview.fingerprint });
      expect((await suppliers.list(actor, w.workspaceId)).suppliers[0]).toMatchObject({ name: "Stone Co", approval: "pending", attributes: [{ name: "DIRECTORS APPROVED/NOT APPROVED", value: "APPROVED" }] });
    });
  });
});
