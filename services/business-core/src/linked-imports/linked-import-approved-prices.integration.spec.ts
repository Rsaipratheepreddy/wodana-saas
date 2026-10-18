import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CatalogV2Service } from "../catalog-core/catalog-v2.service";
import { InventoryService } from "../inventory/inventory.service";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { SuppliersService } from "../purchasing/suppliers.service";
import { catalogLine, searchCatalog } from "../quotation/quote-catalog";
import { LinkedImportsService } from "./linked-imports.service";
import type { SourceSheet } from "./linked-import-source";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = {} as never;

// A price list as a firm's official collection writes it: some prices on request.
const priceList = (rows: string[][]): SourceSheet[] => [{ name: "Sofas", rows: [["Code", "Name", "Unit", "Cost", "Price"], ...rows] }];
const MAPPING = { columns: { Code: "code", Name: "name", Unit: "unit", Cost: "cost", Price: "price" } };
const FIRST = [["SOF-1", "Aria sofa", "pcs", "4,100", "9,800"], ["SOF-2", "Luna sofa", "pcs", "", "ENQUIRE"], ["CHR-1", "Mira chair", "pcs", "800", "1,950"]];

type World = { client: PoolClient; workspaceId: string; owner: string; clerk: string; as: (userId: string) => LinkedImportsService; catalogs: CatalogV2Service };

integration("approved list prices from a linked catalogue import (L17)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), owner = randomUUID(), clerk = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Rana Owner'),($3,$4,'Sam Clerk')", [owner, `${owner.slice(0, 8)}@example.com`, clerk, `${clerk.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `apr-${workspaceId.slice(0, 8)}`, owner]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')", [randomUUID(), workspaceId, owner, randomUUID(), clerk]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      // The owner reviews and approves prices; the clerk manages the catalogue only.
      const permissions: Record<string, string[]> = { [owner]: ["catalog.manage", "catalog.view", "commercial.estimate"], [clerk]: ["catalog.manage", "catalog.view"] };
      const run_ = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const access = (userId: string) => ({ asMember: (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId }),
        withPermission: run_(userId), withPermissions: run_(userId), withAnyPermission: run_(userId),
        hasPermission: async (_c: unknown, _w: string, member: string, code: string) => (permissions[member] ?? []).includes(code) } as never);
      const db = { query: (text: string, values?: unknown[]) => client.query(text, values), tenantTransaction: (_w: string, _a: string, fn: (c: PoolClient) => unknown) => fn(client) } as never;
      const as = (userId: string) => new LinkedImportsService(access(userId), db, new InventoryService(access(userId)), new CatalogV2Service(access(userId), {} as never), { read: async () => ({}) } as never,
        new SuppliersService(access(userId)));
      await run({ client, workspaceId, owner, clerk, as, catalogs: new CatalogV2Service(access(owner), {} as never) });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const entries = async (w: World) => (await w.client.query<{ code: string; price: string; status: string }>(
    `SELECT item.code, entry.price::text AS price, entry.status FROM price_entries entry JOIN catalog_items item ON item.id = entry.item_id
      WHERE entry.workspace_id = $1 ORDER BY item.code, entry.status = 'expired' DESC, entry.price`, [w.workspaceId])).rows;
  const books = async (w: World) => (await w.client.query<{ status: string; currency: string }>(`SELECT status, currency FROM price_books WHERE workspace_id = $1`, [w.workspaceId])).rows;
  const quoted = async (w: World, search: string) => (await searchCatalog(w.client, w.workspaceId, { search, currency: "AED", priceBookId: null }))
    .map((hit) => ({ code: hit.code, rate: hit.rate }));
  const audits = async (w: World, action: string) => (await w.client.query<{ after: Record<string, unknown> }>(
    `SELECT after FROM audit_events WHERE workspace_id = $1 AND action = $2 ORDER BY occurred_at`, [w.workspaceId, action])).rows.map((row) => row.after);

  it("puts an approved price list live in an active book, quotes it, supersedes a changed price, and changes nothing on a re-run", async () => {
    await world(async (w) => {
      const service = w.as(w.owner);
      const { id: catalogId } = await w.catalogs.createCatalog(actor, w.workspaceId, { name: "Core Collection" });
      expect((await service.overview(actor, w.workspaceId, { target: "catalog", catalogId })).canApprovePrices).toBe(true);
      const draft = { target: "catalog", source: "upload", name: "Core Collection", catalogId, mapping: MAPPING, sheets: priceList(FIRST), approvedPrices: true };
      const preview = await service.preview(actor, w.workspaceId, draft);
      expect(preview.prices).toEqual({ approved: true, refused: false });
      expect(preview.rows.find((row) => row.key === "SOF-1")?.changes).toEqual(["Price — → 9800, cost — → 4100"]);
      const linked = await service.apply(actor, w.workspaceId, { ...draft, runId: randomUUID(), expectedFingerprint: preview.fingerprint });
      expect(linked.runs[0]).toMatchObject({ status: "applied", added: 3 });
      expect(linked.link).toMatchObject({ approvedPrices: true });
      expect(await books(w)).toEqual([{ status: "active", currency: "AED" }]);
      expect(await entries(w)).toEqual([{ code: "CHR-1", price: "1950.000000", status: "active" }, { code: "SOF-1", price: "9800.000000", status: "active" }]);

      // The quote builder's catalogue panel shows the price and an added line takes it; a price on request still has none.
      expect(await quoted(w, "sofa")).toEqual([{ code: "SOF-1", rate: "9800.000000" }, { code: "SOF-2", rate: null }]);
      const sofa = (await w.client.query<{ id: string }>(`SELECT id FROM catalog_items WHERE workspace_id = $1 AND code = 'SOF-1'`, [w.workspaceId])).rows[0].id;
      expect(await catalogLine(w.client, w.workspaceId, { itemId: sofa, currency: "AED", priceBookId: null, decimals: 2 })).toMatchObject({ rate: "9800.00", unitCost: "4100.000000", priceReason: null });

      // Audited as coming from the import: the link and its run.
      const linkId = linked.link.id;
      const approvals = await audits(w, "catalog.price_approved_list");
      expect(approvals).toHaveLength(2);
      expect(approvals[0]).toMatchObject({ source: { via: "linked_import", linkId, runId: linked.runs[0].id } });
      expect(await audits(w, "catalog.price_book_active")).toEqual([expect.objectContaining({ source: { via: "linked_import", linkId, runId: linked.runs[0].id } })]);

      // A re-run with the same prices changes nothing.
      const again = await service.refresh(actor, w.workspaceId, linkId, { runId: randomUUID(), sheets: priceList(FIRST) });
      expect(again.runs[0]).toMatchObject({ status: "applied", added: 0, changed: 0, unchanged: 3 });
      expect(await entries(w)).toHaveLength(2);

      // A changed price supersedes the live one (kept as history), live at once.
      const repriced = await service.refresh(actor, w.workspaceId, linkId, { runId: randomUUID(), sheets: priceList([[...FIRST[0].slice(0, 4), "10,200"], FIRST[1], FIRST[2]]) });
      expect(repriced.runs[0]).toMatchObject({ changed: 1, unchanged: 2 });
      expect(repriced.rows[0]).toMatchObject({ key: "SOF-1", outcome: "changed", message: "Price 9800 → 10200" });
      expect(await entries(w)).toEqual([{ code: "CHR-1", price: "1950.000000", status: "active" },
        { code: "SOF-1", price: "9800.000000", status: "expired" }, { code: "SOF-1", price: "10200.000000", status: "active" }]);
      expect(await quoted(w, "aria")).toEqual([{ code: "SOF-1", rate: "10200.000000" }]);

      // Someone who can't approve prices refreshing the link drafts the change for review; the live price stays quoted.
      const byClerk = await w.as(w.clerk).refresh(actor, w.workspaceId, linkId, { runId: randomUUID(), sheets: priceList([[...FIRST[0].slice(0, 4), "10,500"], FIRST[1], FIRST[2]]) });
      expect(byClerk.rows[0]).toMatchObject({ key: "SOF-1", message: "Price 10200 → 10500 (draft until reviewed)" });
      expect((await entries(w)).filter((entry) => entry.code === "SOF-1").map((entry) => entry.status)).toEqual(["expired", "expired", "draft"]);
    });
  });

  it("drafts prices for a member who can't approve them, then approves the existing drafts on a re-run without duplicates", async () => {
    await world(async (w) => {
      const { id: catalogId } = await w.catalogs.createCatalog(actor, w.workspaceId, { name: "Core Collection" });
      const clerk = w.as(w.clerk);
      expect((await clerk.overview(actor, w.workspaceId, { target: "catalog", catalogId })).canApprovePrices).toBe(false);
      const draft = { target: "catalog", source: "upload", name: "Core Collection", catalogId, mapping: MAPPING, sheets: priceList(FIRST), approvedPrices: true };
      const preview = await clerk.preview(actor, w.workspaceId, draft);
      expect(preview.prices).toEqual({ approved: false, refused: true });
      expect(preview.rows.find((row) => row.key === "SOF-1")?.changes).toEqual(["Price — → 9800, cost — → 4100 (draft until reviewed)"]);
      const linked = await clerk.apply(actor, w.workspaceId, { ...draft, runId: randomUUID(), expectedFingerprint: preview.fingerprint });
      expect(linked.link).toMatchObject({ approvedPrices: false });
      expect(await books(w)).toEqual([{ status: "draft", currency: "AED" }]);
      expect(await entries(w)).toEqual([{ code: "CHR-1", price: "1950.000000", status: "draft" }, { code: "SOF-1", price: "9800.000000", status: "draft" }]);
      expect(await quoted(w, "sofa")).toEqual([{ code: "SOF-1", rate: null }, { code: "SOF-2", rate: null }]);

      // The same file again, as approved prices by someone who may: the drafts go live as they are, and the book is put in use.
      const owner = w.as(w.owner);
      const rerun = { linkId: linked.link.id, version: linked.link.version, name: "Core Collection", mapping: MAPPING, sheets: priceList(FIRST), approvedPrices: true };
      const approving = await owner.preview(actor, w.workspaceId, rerun);
      expect(approving.prices).toEqual({ approved: true, refused: false });
      expect(approving.summary).toMatchObject({ added: 0, changed: 2, unchanged: 1 });
      expect(approving.rows.filter((row) => row.outcome === "changed").map((row) => [row.key, row.changes])).toEqual([["SOF-1", ["Price 9800 approved"]], ["CHR-1", ["Price 1950 approved"]]]);
      const applied = await owner.apply(actor, w.workspaceId, { ...rerun, runId: randomUUID(), expectedFingerprint: approving.fingerprint });
      expect(applied.runs[0]).toMatchObject({ status: "applied", changed: 2, unchanged: 1 });
      expect(applied.link).toMatchObject({ approvedPrices: true });
      expect(await books(w)).toEqual([{ status: "active", currency: "AED" }]);
      expect(await entries(w)).toEqual([{ code: "CHR-1", price: "1950.000000", status: "active" }, { code: "SOF-1", price: "9800.000000", status: "active" }]);
      expect(await quoted(w, "sofa")).toEqual([{ code: "SOF-1", rate: "9800.000000" }, { code: "SOF-2", rate: null }]);
      expect(await audits(w, "catalog.price_approved_list")).toEqual([
        expect.objectContaining({ status: "active", source: { via: "linked_import", linkId: linked.link.id, runId: applied.runs[0].id } }),
        expect.objectContaining({ status: "active" })]);

      // Once more: nothing to approve.
      const third = { ...rerun, version: applied.link.version };
      const settled = await owner.preview(actor, w.workspaceId, third);
      expect(settled.summary).toMatchObject({ changed: 0, unchanged: 3 });
      expect((await owner.apply(actor, w.workspaceId, { ...third, runId: randomUUID(), expectedFingerprint: settled.fingerprint })).runs[0]).toMatchObject({ changed: 0, unchanged: 3 });
      expect(await entries(w)).toHaveLength(2);

      // The clerk can't turn the setting off; the link keeps it.
      const kept = await clerk.apply(actor, w.workspaceId, { ...third, version: (await owner.detail(actor, w.workspaceId, linked.link.id)).link.version, approvedPrices: false, runId: randomUUID() });
      expect(kept.link).toMatchObject({ approvedPrices: true });
    });
  });
});
