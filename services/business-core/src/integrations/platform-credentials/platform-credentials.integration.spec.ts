import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OperatorNotificationsService } from "../../control-plane/operator-notifications.service";
import { DatabaseService } from "../../database/database.service";
import { PlatformCredentialsService } from "./platform-credentials.service";

// Real PostgreSQL as the app role (forced RLS and column privileges apply). The rows are platform-wide, so
// the suite snapshots them first and puts them back afterwards. The intelligence service is stubbed: it
// seals with an obviously fake token and answers checks as told.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const FAKE_SECRET = "fake-meta-app-secret-for-tests-0001";
const FAKE_TOKEN = "fake-verify-token-for-tests-9999";
const sealedFor = (value: string) => `gAAAAA${Buffer.from(`sealed:${value}`).toString("base64url").padEnd(60, "A")}`;

integration("platform integration credentials with PostgreSQL", () => {
  const run = randomUUID().slice(0, 8);
  const operatorA = randomUUID(), operatorB = randomUUID(), outsider = randomUUID();
  const emails = [`a-${run}@platform-credentials.test`, `b-${run}@platform-credentials.test`, `c-${run}@platform-credentials.test`];
  let owner: Pool;
  let db: DatabaseService;
  let service: PlatformCredentialsService;
  let snapshot: Array<Record<string, unknown>> = [];
  let testAnswer: { ok: boolean; reason?: string; version: number } = { ok: true, version: 1 };

  const intelligence = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { value?: string };
    if (url.endsWith("/platform-credentials/seal")) return new Response(JSON.stringify({ sealed: sealedFor(body.value!) }));
    if (url.includes("/platform-credentials/meta/test")) return new Response(JSON.stringify(testAnswer));
    return new Response("{}", { status: 404 });
  });

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    owner = new Pool({ connectionString: url.toString() });
    const role = await owner.query("SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app'");
    if (role.rowCount) url.searchParams.set("options", "-c role=wodana_app");
    const config = new ConfigService({ DATABASE_URL: url.toString(), INTELLIGENCE_API_URL: "http://intelligence.test/api/v1",
      BUSINESS_CORE_INTERNAL_TOKEN: "fake-internal-token-for-tests" });
    db = new DatabaseService(config);
    service = new PlatformCredentialsService(db, config, new OperatorNotificationsService(db));
    snapshot = (await owner.query("SELECT * FROM platform_integration_credentials")).rows;
    await owner.query(`INSERT INTO users (id, primary_email, display_name) VALUES ($1, $2, 'Operator A'), ($3, $4, 'Operator B'), ($5, $6, 'Not an operator')`,
      [operatorA, emails[0], operatorB, emails[1], outsider, emails[2]]);
    await owner.query(`INSERT INTO platform_administrators (user_id, role) VALUES ($1, 'administrator'), ($2, 'administrator')`, [operatorA, operatorB]);
    vi.stubGlobal("fetch", intelligence);
  });

  afterEach(() => intelligence.mockClear());

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db?.onModuleDestroy();
    if (!owner) return;
    // Other suites notify every active operator (a new sales enquiry): stop being one first, and let any
    // notice already on its way land before the users go, so their inserts never meet a missing user.
    await owner.query(`DELETE FROM platform_administrators WHERE user_id = ANY($1::uuid[])`, [[operatorA, operatorB]]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      for (const saved of snapshot) {
        const columns = Object.keys(saved).filter((column) => column !== "provider");
        await client.query(
          `UPDATE platform_integration_credentials SET ${columns.map((column, index) => `${column} = $${index + 2}`).join(", ")} WHERE provider = $1`,
          [saved.provider, ...columns.map((column) => saved[column])]);
      }
      await client.query(`DELETE FROM platform_operator_notifications WHERE recipient_user_id = ANY($1::uuid[])`, [[operatorA, operatorB]]);
      await client.query(`DELETE FROM platform_operator_audit WHERE actor_user_id = ANY($1::uuid[])`, [[operatorA, operatorB]]);
      await client.query(`DELETE FROM platform_administrators WHERE user_id = ANY($1::uuid[])`, [[operatorA, operatorB]]);
      await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[operatorA, operatorB, outsider]]);
      await client.query("COMMIT");
    } finally {
      client.release();
      await owner.end();
    }
  });

  const metaVersion = async () => Number((await owner.query(`SELECT version FROM platform_integration_credentials WHERE provider = 'meta'`)).rows[0].version);

  it("is invisible to anyone who is not an active Wodana operator", async () => {
    const seen = await db.actorTransaction(outsider, (client) => client.query("SELECT provider FROM platform_integration_credentials"));
    expect(seen.rowCount).toBe(0);
    const changed = await db.actorTransaction(outsider, (client) =>
      client.query(`UPDATE platform_integration_credentials SET client_id = 'hijack' WHERE provider = 'meta'`));
    expect(changed.rowCount).toBe(0);
    await expect(service.list(outsider)).resolves.toEqual({ providers: [] });
    await expect(service.save("meta", { expectedVersion: 1, clientId: "1234567" }, `key-${run}-outsider`, outsider))
      .rejects.toBeInstanceOf(NotFoundException);
    // Rows are fixed: the app role neither adds nor removes providers.
    await expect(db.actorTransaction(operatorA, (client) => client.query(`DELETE FROM platform_integration_credentials WHERE provider = 'zoho'`)))
      .rejects.toThrow(/permission denied/);
  });

  it("never lets the app role read a sealed secret, even as an operator", async () => {
    await expect(db.actorTransaction(operatorA, (client) => client.query("SELECT client_secret_sealed FROM platform_integration_credentials")))
      .rejects.toThrow(/permission denied/);
    await expect(db.actorTransaction(operatorA, (client) => client.query("SELECT * FROM platform_integration_credentials")))
      .rejects.toThrow(/permission denied/);
    const list = await service.list(operatorA);
    expect(list.providers.map((item) => item.provider)).toEqual(["platform", "meta", "intuit", "zoho", "google"]);
  });

  it("saves through the intelligence service's seal, shows set · last 4 and returns the secret nowhere", async () => {
    const version = await metaVersion();
    const saved = await service.save("meta", {
      expectedVersion: version, clientId: "1234567890", configId: "998877665544", graphVersion: "v23.0",
      clientSecret: FAKE_SECRET, webhookSecret: FAKE_TOKEN,
    }, `key-${run}-meta-1`, operatorA);
    const meta = saved.providers.find((item) => item.provider === "meta")!;
    expect(meta).toMatchObject({ status: "set", version: version + 1, values: { clientId: "1234567890", configId: "998877665544" },
      secrets: { clientSecret: { set: true, last4: FAKE_SECRET.slice(-4) }, webhookSecret: { set: true, last4: FAKE_TOKEN.slice(-4) } } });
    const seals = intelligence.mock.calls.filter(([url]) => String(url).endsWith("/seal"));
    expect(seals.map(([, init]) => JSON.parse(String(init.body)))).toEqual([
      { provider: "meta", field: "clientSecret", value: FAKE_SECRET }, { provider: "meta", field: "webhookSecret", value: FAKE_TOKEN },
    ]);
    const response = JSON.stringify(saved);
    for (const secret of [FAKE_SECRET, FAKE_TOKEN, sealedFor(FAKE_SECRET)]) expect(response).not.toContain(secret);

    const stored = await owner.query(`SELECT client_secret_sealed, webhook_secret_sealed FROM platform_integration_credentials WHERE provider = 'meta'`);
    expect(stored.rows[0]).toEqual({ client_secret_sealed: sealedFor(FAKE_SECRET), webhook_secret_sealed: sealedFor(FAKE_TOKEN) });
    const audit = await owner.query(`SELECT action, target_id, details FROM platform_operator_audit WHERE actor_user_id = $1 ORDER BY created_at`, [operatorA]);
    expect(audit.rows.at(-1)).toMatchObject({ action: "platform.integration_credentials_changed", target_id: "meta",
      details: { secrets: { clientSecret: "replaced", webhookSecret: "replaced" }, after: { clientId: "1234567890" } } });
    for (const secret of [FAKE_SECRET, FAKE_TOKEN, "gAAAAA"]) expect(JSON.stringify(audit.rows)).not.toContain(secret);

    // The intelligence service's read carries the sealed values only.
    const runtime = await service.runtime();
    const runtimeMeta = runtime.providers.find((item) => item.provider === "meta")!;
    expect(runtimeMeta).toMatchObject({ clientId: "1234567890", clientSecret: sealedFor(FAKE_SECRET), webhookSecret: sealedFor(FAKE_TOKEN) });
    expect(JSON.stringify(runtime)).not.toContain(FAKE_SECRET);
  });

  it("tells the other operators, not the one who changed it", async () => {
    const notices = await owner.query<{ recipient: string; title: string; body: string }>(
      `SELECT recipient_user_id AS recipient, title, body FROM platform_operator_notifications
        WHERE event_type = 'platform_integration.changed' AND recipient_user_id = ANY($1::uuid[])`, [[operatorA, operatorB]]);
    expect(notices.rows).toEqual([{ recipient: operatorB, title: "Meta", body: "Operator A" }]);
  });

  it("lands a retried save once and refuses a stale version", async () => {
    const version = await metaVersion();
    const retried = await service.save("meta", { expectedVersion: version - 1, clientId: "1234567890", clientSecret: FAKE_SECRET },
      `key-${run}-meta-1`, operatorA);
    expect(retried.providers.find((item) => item.provider === "meta")!.version).toBe(version);
    expect(intelligence).not.toHaveBeenCalled();
    await expect(service.save("meta", { expectedVersion: version - 1, configId: "111111" }, `key-${run}-meta-2`, operatorB))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.save("meta", { expectedVersion: version, environment: "production" }, `key-${run}-meta-3`, operatorB))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save("meta", { expectedVersion: version, configId: "123456" }, undefined, operatorB))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(await metaVersion()).toBe(version);
  });

  it("records a Test for the version it checked, and a change makes it stale", async () => {
    const version = await metaVersion();
    testAnswer = { ok: false, reason: "rejected", version };
    const failed = await service.test("meta", operatorA);
    expect(failed.result).toEqual({ provider: "meta", ok: false, reason: "rejected" });
    expect(failed.providers.find((item) => item.provider === "meta")).toMatchObject({ status: "test_failed", version, test: { reason: "rejected" } });

    testAnswer = { ok: true, version: version - 1 };
    const stale = await service.test("meta", operatorA);
    expect(stale.providers.find((item) => item.provider === "meta")!.status).toBe("test_failed");

    testAnswer = { ok: true, version };
    expect((await service.test("meta", operatorA)).providers.find((item) => item.provider === "meta")!.status).toBe("tested_ok");
    const changed = await service.save("meta", { expectedVersion: version, webhookSecret: null }, `key-${run}-meta-4`, operatorA);
    expect(changed.providers.find((item) => item.provider === "meta")).toMatchObject({
      status: "not_set", test: null, secrets: { webhookSecret: { set: false, last4: null } } });
    const stored = await owner.query(`SELECT webhook_secret_sealed FROM platform_integration_credentials WHERE provider = 'meta'`);
    expect(stored.rows[0].webhook_secret_sealed).toBeNull();
    await expect(service.test("platform", operatorA)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("keeps the public address as an HTTPS origin and builds every URL from it", async () => {
    const version = Number((await owner.query(`SELECT version FROM platform_integration_credentials WHERE provider = 'platform'`)).rows[0].version);
    const saved = await service.save("platform", { expectedVersion: version, publicApiBase: "https://api.platform-credentials.test/" },
      `key-${run}-platform-1`, operatorA);
    expect(saved.providers.find((item) => item.provider === "google")!.urls).toEqual([
      { id: "callback", url: "https://api.platform-credentials.test/api/v1/integrations/google/oauth/callback" },
    ]);
    await expect(db.actorTransaction(operatorA, (client) => client.query(
      `UPDATE platform_integration_credentials SET public_api_base = 'https://x.test/path' WHERE provider = 'platform'`)))
      .rejects.toThrow(/check constraint/);
  });
});
