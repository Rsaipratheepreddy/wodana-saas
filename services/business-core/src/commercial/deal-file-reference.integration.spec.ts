import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaxNumberingService } from "../workspaces/tax-numbering.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { agreementReference, dealFileReference } from "./deal-file-reference";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

/** QA-003 (plan §4.4): Deal File references are gap-free numbers from the company's numbering, not a slice of the case id. */
integration("QA-003: Deal File numbering", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 2 });
  });
  afterAll(() => pool.end());

  async function world(work: (client: PoolClient, ids: { workspaceId: string; entityId: string; owner: string }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), entityId = randomUUID(), owner = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Olivia Owner')", [owner, `o-${owner.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `df-${workspaceId.slice(0, 8)}`, owner]);
      await client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES($1,$2,'STU','Studio','Studio LLC','AE','AED','en-AE','Asia/Dubai')`, [entityId, workspaceId]);
      const membership = randomUUID(), role = randomUUID();
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, owner]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name) VALUES($1,$2,'finance_admin','Finance admin')", [role, workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code IN ('finance.settings.manage','legal_entities.view')", [workspaceId, role]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, membership, role]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [workspaceId, owner]);
      await client.query("SET LOCAL ROLE wodana_app");
      await work(client, { workspaceId, entityId, owner });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("numbers Deal Files per company without gaps, and shows the numbering in Settings", async () => {
    await world(async (client, { workspaceId, entityId, owner }) => {
      const year = String(new Date().getUTCFullYear());
      expect(await dealFileReference(client, workspaceId, entityId, randomUUID(), year)).toMatch(/^STU-DEAL-\d{4}-00001$/);
      // A refused approval (its transaction rolled back) leaves no gap.
      await client.query("SAVEPOINT refused");
      await dealFileReference(client, workspaceId, entityId, randomUUID(), year);
      await client.query("ROLLBACK TO SAVEPOINT refused");
      expect(await dealFileReference(client, workspaceId, entityId, randomUUID(), year)).toMatch(/^STU-DEAL-\d{4}-00002$/);
      // Without a company the case still gets a reference.
      const caseId = randomUUID();
      expect(await dealFileReference(client, workspaceId, null, caseId, "2026")).toBe(`DF-2026-${caseId.slice(0, 8).toUpperCase()}`);
      // Settings › Numbering lists Deal Files with the next number.
      const database = { tenantTransaction: async (_w: string, _a: string, fn: (c: PoolClient) => Promise<unknown>) => fn(client) };
      const access = new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId: owner }) } as never);
      const numbering = await new TaxNumberingService(access).get(actor, workspaceId, entityId);
      expect(numbering.numbering.find((row) => row.documentType === "DEAL_FILE")).toMatchObject({ exists: true, prefix: "STU-DEAL-{YYYY}-", padding: 5 });
      expect(numbering.numbering.find((row) => row.documentType === "DEAL_FILE")?.preview).toMatch(/^STU-DEAL-\d{4}-00003$/);
    });
  });

  it("numbers agreements per company, never typed, and lists them in Settings (§0.3 P0)", async () => {
    await world(async (client, { workspaceId, entityId, owner }) => {
      const year = String(new Date().getUTCFullYear());
      expect(await agreementReference(client, workspaceId, entityId, randomUUID(), year)).toMatch(/^STU-AGR-\d{4}-00001$/);
      expect(await agreementReference(client, workspaceId, entityId, randomUUID(), year)).toMatch(/^STU-AGR-\d{4}-00002$/);
      // Agreements and Deal Files count separately.
      expect(await dealFileReference(client, workspaceId, entityId, randomUUID(), year)).toMatch(/^STU-DEAL-\d{4}-00001$/);
      const caseId = randomUUID();
      expect(await agreementReference(client, workspaceId, null, caseId, "2026")).toBe(`AGR-2026-${caseId.slice(0, 8).toUpperCase()}`);
      const database = { tenantTransaction: async (_w: string, _a: string, fn: (c: PoolClient) => Promise<unknown>) => fn(client) };
      const access = new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId: owner }) } as never);
      const numbering = await new TaxNumberingService(access).get(actor, workspaceId, entityId);
      expect(numbering.numbering.find((row) => row.documentType === "AGREEMENT")).toMatchObject({ exists: true, prefix: "STU-AGR-{YYYY}-", padding: 5 });
    });
  });
});
