import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { E164, whatsappPreflight } from "./inbox/whatsapp-preflight";

// Opt-in: PROJECT_REPOSITORY_TEST_DATABASE_URL must point at a local, migrated database with a
// superuser role. Every test runs in a transaction that is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

describe("the WhatsApp test number", () => {
  it("is an international number", () => {
    expect(E164.test("+15551234567")).toBe(true);
    expect(E164.test("0501234567")).toBe(false);
  });
});

integration("WhatsApp pre-flight (SP-7)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  it("says what isn't ready yet, then what is", async () => {
    const client = await pool.connect();
    const workspaceId = randomUUID(), admin = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Firm',$2,'USD',$3)", [workspaceId, `firm-${workspaceId.slice(0, 8)}`, admin]);
      const empty = await whatsappPreflight(client, workspaceId, "http://localhost:3000");
      expect(empty.map((check) => [check.key, check.ok])).toEqual([["https", false], ["number", false], ["templates", false], ["code_template", false], ["webhook", false]]);
      await client.query(`INSERT INTO integration_connections(id,workspace_id,provider,display_name,status,connected_by,external_account_id,configuration)
        VALUES($1,$2,'whatsapp','WhatsApp','connected',$3,'waba-1',$4)`, [randomUUID(), workspaceId, admin, { displayPhoneNumber: "+1 555 0100" }]);
      await client.query(`INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, body_template, variables, approved_at, provider_status, provider_category)
        VALUES ($1, 'portal_code', 'whatsapp', 'en', 1, 'approved', 'Your code is {{1}}', '[]', now(), 'approved', 'authentication')`, [workspaceId]);
      const ready = await whatsappPreflight(client, workspaceId, "https://app.example.test");
      expect(Object.fromEntries(ready.map((check) => [check.key, check.ok]))).toEqual({ https: true, number: true, templates: true, code_template: true, webhook: false });
      expect(ready.find((check) => check.key === "number")?.detail).toBe("+1 555 0100");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
