import { randomUUID } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SuppliersService } from "./suppliers.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const ALL = ["vendors.view", "vendors.manage", "vendors.approve", "purchasing.view", "purchasing.manage", "purchasing.approve", "projects.manage", "projects.view"];

type World = { client: PoolClient; workspaceId: string; buyer: string; director: string; factory: string; interiors: string; as: (userId: string, permissions?: string[]) => { suppliers: SuppliersService } };

integration("purchasing (plan §6.13–6.14)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(work: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), buyer = randomUUID(), director = randomUUID(), factory = randomUUID(), interiors = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Bina Buyer'),($3,$4,'Dara Director')", [buyer, `${buyer.slice(0, 8)}@example.com`, director, `${director.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `pu-${workspaceId.slice(0, 8)}`, buyer]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')", [randomUUID(), workspaceId, buyer, randomUUID(), director]);
      for (const [id, code, name] of [[factory, "FAC", "Studio Furniture Manufacturing"], [interiors, "INT", "Studio Interiors Trading"]])
        await client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,$3,$4,$4,'AE','AED','en-AE','Asia/Dubai')`, [id, workspaceId, code, name]);
      await client.query("SET LOCAL session_replication_role = origin");
      const as = (userId: string, permissions = ALL) => {
        const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
          const codes = Array.isArray(code) ? code : [code];
          if (!codes.every((item) => permissions.includes(item))) throw new ForbiddenException("Not allowed");
          return fn(client, { userId });
        };
        const access = { withPermission: run, withPermissions: run, withAnyPermission: run, asMember: (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId }),
          hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never;
        return { suppliers: new SuppliersService(access) };
      };
      await work({ client, workspaceId, buyer, director, factory, interiors, as });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("keeps the supplier register: terms, deals and companies; approval only by an approver; archive with a reason", async () => {
    await world(async (w) => {
      const buyer = w.as(w.buyer, ALL.filter((code) => code !== "vendors.approve")).suppliers;
      const id = randomUUID();
      let state = await buyer.save(actor, w.workspaceId, { id, version: 0, name: "Nile Marble & Granite Factory LLC", categories: ["Marble", "travertine", "marble"],
        paymentTerms: "split", advancePercent: "50", termsNote: "Slabs upfront", deal: "discount", dealPercent: "10", contactName: "Mohamed", phone: "+971503175797",
        email: "sales@nile.example", locality: "Al Quoz", entityIds: [w.factory] });
      const nile = state.suppliers.find((item) => item.id === id)!;
      expect(nile).toMatchObject({ code: "NILE-MARBLE-GRANITE-FACTORY", categories: ["Marble", "travertine"], approval: "pending", paymentTerms: "split", advancePercent: "50.00",
        deal: "discount", dealPercent: "10.00", contactName: "Mohamed", locality: "Al Quoz", entityIds: [w.factory], status: "active" });
      expect(state).toMatchObject({ canManage: true, canApprove: false, categories: ["Marble", "travertine"] });
      await expect(buyer.save(actor, w.workspaceId, { id: randomUUID(), version: 0, name: "  nile marble & granite factory llc " })).rejects.toThrow(/Another supplier has this name/);
      await expect(buyer.save(actor, w.workspaceId, { id: randomUUID(), version: 0, name: "Ritver Paints", paymentTerms: "split" })).rejects.toThrow(/advance is a percentage/);
      await expect(buyer.save(actor, w.workspaceId, { id, version: nile.version - 1, name: "Nile" })).rejects.toThrow(/Someone else changed/);
      await expect(buyer.approve(actor, w.workspaceId, id, { version: nile.version, approval: "approved" })).rejects.toThrow(/Not allowed/);

      const director = w.as(w.director).suppliers;
      await expect(director.approve(actor, w.workspaceId, id, { version: nile.version, approval: "approved", preferredFor: ["Glass"] })).rejects.toThrow(/isn't one of this supplier's categories/);
      await expect(director.approve(actor, w.workspaceId, id, { version: nile.version, approval: "on_hold" })).rejects.toThrow(/Say why/);
      state = await director.approve(actor, w.workspaceId, id, { version: nile.version, approval: "approved", preferredFor: ["marble"] });
      expect(state.suppliers[0]).toMatchObject({ approval: "approved", preferredFor: ["Marble"], approvalByName: "Dara Director" });
      // Dropping a category drops it from the preferred list.
      state = await buyer.save(actor, w.workspaceId, { id, version: state.suppliers[0].version, name: "Nile Marble & Granite Factory LLC", categories: ["travertine"], paymentTerms: "credit", creditDays: 30 });
      expect(state.suppliers[0]).toMatchObject({ categories: ["travertine"], preferredFor: [], approval: "approved", paymentTerms: "credit", creditDays: 30, advancePercent: null, deal: "none" });

      await expect(buyer.archive(actor, w.workspaceId, id, { version: state.suppliers[0].version })).rejects.toThrow(/Say why/);
      state = await buyer.archive(actor, w.workspaceId, id, { version: state.suppliers[0].version, reason: "Closed its Dubai branch" });
      expect(state.suppliers[0]).toMatchObject({ status: "archived", archivedReason: "Closed its Dubai branch" });
      state = await buyer.archive(actor, w.workspaceId, id, { version: state.suppliers[0].version, restore: true });
      expect(state.suppliers[0].status).toBe("active");
    });
  });

  it("imports a supplier list kept per company: one supplier per name, approvals only for an approver, safe to run again", async () => {
    await world(async (w) => {
      const rows = [
        { key: "Preferred:4", name: "SIOM MARBLE & GRANITE TR. LLC", categories: "Marble", approval: "APPROVED MARBLE SUPPLIER", deal: "Discount as Requested / Approval", terms: "Payment Upfront",
          contactName: "Ramiz - +971 52 846 6806", email: "ramiz@siom.example", locality: "Sharjah", entityId: w.factory },
        { key: "Manufacturing:9", name: "Siom Marble & Granite Tr. LLC", categories: "Marble, Travertine", approval: "", terms: "", entityId: w.factory },
        { key: "Manufacturing:12", name: "Ritver Paints Manufacturing LLC", categories: "Paint", approval: "NOMINATED PAINT SUPPLIER", terms: "Payment Upfront", deal: "N/A", entityId: w.factory },
        { key: "Interiors:3", name: "Casabella Better Living", categories: "Carpet, Curtain, Wallpaper", terms: "Month End - SOA", deal: "upon request", entityId: w.interiors },
        { key: "Interiors:4", name: "Ritver Paints Manufacturing LLC", categories: "Paint", terms: "30 days after item received", entityId: w.interiors },
        { key: "Interiors:5", name: "", categories: "Trees" },
      ];
      const buyer = w.as(w.buyer, ALL.filter((code) => code !== "vendors.approve")).suppliers;
      const preview = await buyer.importSuppliers(actor, w.workspaceId, { rows });
      expect(preview.plan.map((item) => [item.name, item.action, item.approval, item.approvalSkipped])).toEqual([
        ["SIOM MARBLE & GRANITE TR. LLC", "create", "pending", true], ["Ritver Paints Manufacturing LLC", "create", "pending", true], ["Casabella Better Living", "create", "pending", false]]);
      expect((await w.client.query("SELECT 1 FROM workspace_vendors WHERE workspace_id = $1", [w.workspaceId])).rowCount).toBe(0);

      const director = w.as(w.director).suppliers;
      let state = await director.importSuppliers(actor, w.workspaceId, { rows, commit: true });
      expect(state.imported).toEqual({ created: 3, merged: 0 });
      const byName = (name: string) => state.suppliers.find((item) => item.name === name)!;
      expect(byName("SIOM MARBLE & GRANITE TR. LLC")).toMatchObject({ categories: ["Marble", "Travertine"], approval: "approved", preferredFor: [], deal: "on_request", paymentTerms: "upfront",
        contactName: "Ramiz - +971 52 846 6806", locality: "Sharjah", entityIds: [w.factory] });
      expect(byName("Ritver Paints Manufacturing LLC")).toMatchObject({ approval: "approved", preferredFor: ["Paint"], paymentTerms: "credit", creditDays: 30 });
      expect([...byName("Ritver Paints Manufacturing LLC").entityIds].sort()).toEqual([w.factory, w.interiors].sort());
      expect(byName("Casabella Better Living")).toMatchObject({ categories: ["Carpet", "Curtain", "Wallpaper"], paymentTerms: "statement", approval: "pending" });

      // Again, with one new category: nothing is duplicated and what's set stays.
      state = await director.importSuppliers(actor, w.workspaceId, { rows: [...rows, { key: "Interiors:9", name: "casabella better living", categories: "Rugs", entityId: w.interiors }], commit: true });
      expect(state.imported).toEqual({ created: 0, merged: 3 });
      expect(state.suppliers).toHaveLength(3);
      expect(state.suppliers.find((item) => item.name === "Casabella Better Living")!.categories).toEqual(["Carpet", "Curtain", "Wallpaper", "Rugs"]);
    });
  });
});
