import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { OperatorNotificationsService } from "../../control-plane/operator-notifications.service";
import { DatabaseService } from "../../database/database.service";
import {
  credentialView,
  PLATFORM_CREDENTIAL_PROVIDERS,
  planCredentialChange,
  ROW_COLUMNS,
  SECRET_COLUMNS,
  TEST_REASONS,
  VALUE_COLUMNS,
  type CredentialInput,
  type CredentialRow,
  type PlatformCredentialProvider,
  type SecretField,
  type TestableProvider,
  type TestReason,
  type ValueField,
} from "./platform-credentials.domain";

const REQUEST_KEY = /^[a-zA-Z0-9_-]{8,160}$/;
const PROVIDER_NAMES: Record<TestableProvider, string> = { meta: "Meta", intuit: "Intuit", zoho: "Zoho", google: "Google" };
// A Fernet token (base64url, version byte 0x80): what the intelligence service seals secrets into.
const SEALED = /^gAAAAA[A-Za-z0-9_-]{40,4000}={0,2}$/;

type RuntimeRow = {
  provider: PlatformCredentialProvider; clientId: string | null; clientSecret: string | null; webhookSecret: string | null;
  configId: string | null; graphVersion: string | null; environment: string | null; dataCenter: string | null;
  publicApiBase: string | null; version: number;
};

/**
 * Wodana Control → Platform connections: the platform's own app credentials per provider. Saves are
 * validated, version-checked, idempotent (the request key) and audited in the operator audit; secrets are
 * sealed by the intelligence service before they reach the database and are never returned. Test asks the
 * intelligence service for a safe live check of what it would use, and records the answer for this version.
 */
@Injectable()
export class PlatformCredentialsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly notifications: OperatorNotificationsService,
  ) {}

  async list(operatorUserId: string) {
    const rows = await this.database.actorTransaction(operatorUserId, (client) => this.rows(client));
    const base = rows.find((row) => row.provider === "platform")?.publicApiBase ?? null;
    return { providers: rows.map((row) => credentialView(row, base)) };
  }

  async save(provider: PlatformCredentialProvider, input: CredentialInput & { expectedVersion: number },
    requestKey: string | undefined, operatorUserId: string) {
    if (!requestKey || !REQUEST_KEY.test(requestKey)) throw new BadRequestException("A request key is required.");
    const { expectedVersion, ...fields } = input;
    const plan = planCredentialChange(provider, fields);

    // A retried save answers with what it saved, without sealing again.
    const current = await this.database.actorTransaction(operatorUserId, (client) => this.row(client, provider, false));
    if (current.lastRequestKey === requestKey) return this.list(operatorUserId);
    if (current.version !== expectedVersion) throw new ConflictException("These credentials changed. Reload and try again.");

    const sealed: Partial<Record<SecretField, { sealed: string; last4: string }>> = {};
    for (const [field, value] of Object.entries(plan.replace) as Array<[SecretField, string]>) {
      sealed[field] = { sealed: await this.seal(provider, field, value), last4: value.slice(-4) };
    }

    await this.database.actorTransaction(operatorUserId, async (client) => {
      const before = await this.row(client, provider, true);
      if (before.lastRequestKey === requestKey) return;
      if (before.version !== expectedVersion) throw new ConflictException("These credentials changed. Reload and try again.");
      const assignments: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => { values.push(value); assignments.push(`${column} = $${values.length}`); };
      const changedValues = (Object.entries(plan.values) as Array<[ValueField, string | null]>)
        .filter(([field, value]) => before[field] !== value);
      for (const [field, value] of changedValues) set(VALUE_COLUMNS[field], value);
      const secrets: Partial<Record<SecretField, "replaced" | "removed">> = {};
      for (const [field, next] of Object.entries(sealed) as Array<[SecretField, { sealed: string; last4: string }]>) {
        set(SECRET_COLUMNS[field].sealed, next.sealed);
        set(SECRET_COLUMNS[field].last4, next.last4);
        secrets[field] = "replaced";
      }
      for (const field of plan.remove) {
        if ((field === "clientSecret" ? before.clientSecretLast4 : before.webhookSecretLast4) === null) continue;
        set(SECRET_COLUMNS[field].sealed, null);
        set(SECRET_COLUMNS[field].last4, null);
        secrets[field] = "removed";
      }
      if (!assignments.length) return;
      // A change makes the last Test stale.
      assignments.push("test_status = 'untested'", "test_reason = NULL", "tested_at = NULL", "tested_by = NULL",
        "version = version + 1", "updated_at = now()");
      set("updated_by", operatorUserId);
      set("last_request_key", requestKey);
      values.push(provider, expectedVersion);
      const updated = await client.query<{ version: number }>(
        `UPDATE platform_integration_credentials SET ${assignments.join(", ")}
          WHERE provider = $${values.length - 1} AND version = $${values.length} RETURNING version`, values);
      if (!updated.rowCount) throw new ConflictException("These credentials changed. Reload and try again.");
      const auditId = await this.audit(client, operatorUserId, "platform.integration_credentials_changed", provider, {
        version: updated.rows[0].version,
        before: Object.fromEntries(changedValues.map(([field]) => [field, before[field]])),
        after: Object.fromEntries(changedValues),
        secrets,
      });
      // Every firm connects through these: the other operators who manage them are told in Wodana Control.
      const actor = await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [operatorUserId]);
      await this.notifications.notify(client, {
        permission: "platform.integrations.manage", eventType: "platform_integration.changed", exceptUserId: operatorUserId,
        sourceType: "platform_integration", sourceId: auditId, link: "/internal/platform-connections",
        // Data only (the provider's own name, or the address); the portal words the event.
        title: provider === "platform" ? (plan.values.publicApiBase ?? before.publicApiBase ?? "-") : PROVIDER_NAMES[provider],
        body: actor.rows[0]?.name ?? null,
      });
    });
    return this.list(operatorUserId);
  }

  /** A safe live check of the credentials the intelligence service would use now; nothing is sent to anyone. */
  async test(provider: PlatformCredentialProvider, operatorUserId: string) {
    if (provider === "platform") throw new BadRequestException("Choose a provider to test.");
    // Only an operator gets this far (the row is invisible to anyone else).
    await this.database.actorTransaction(operatorUserId, (client) => this.row(client, provider, false));
    const result = await this.checkWithIntelligence(provider);
    await this.database.actorTransaction(operatorUserId, async (client) => {
      if (result.version === null) return;
      const recorded = await client.query(
        `UPDATE platform_integration_credentials
            SET test_status = $2, test_reason = $3, tested_at = now(), tested_by = $4
          WHERE provider = $1 AND version = $5 RETURNING version`,
        [provider, result.ok ? "passed" : "failed", result.ok ? null : result.reason, operatorUserId, result.version]);
      // Credentials changed while the check ran: its answer is about a version nobody sees any more.
      if (!recorded.rowCount) return;
      await this.audit(client, operatorUserId, "platform.integration_credentials_tested", provider, {
        version: result.version, result: result.ok ? "passed" : "failed", ...(result.ok ? {} : { reason: result.reason }),
      });
    });
    return { ...(await this.list(operatorUserId)), result: { provider, ok: result.ok, reason: result.reason } };
  }

  /** For the intelligence service only (internal token): values with the secrets still sealed. */
  async runtime() {
    const result = await this.database.query<RuntimeRow>(
      `SELECT provider, client_id AS "clientId", client_secret_sealed AS "clientSecret", webhook_secret_sealed AS "webhookSecret",
              config_id AS "configId", graph_version AS "graphVersion", environment, data_center AS "dataCenter",
              public_api_base AS "publicApiBase", version
         FROM platform_integration_credentials_runtime()`);
    return { providers: result.rows };
  }

  private async rows(client: PoolClient) {
    const result = await client.query<CredentialRow>(`SELECT ${ROW_COLUMNS} FROM platform_integration_credentials`);
    const order = new Map(PLATFORM_CREDENTIAL_PROVIDERS.map((provider, index) => [provider, index]));
    return result.rows.sort((left, right) => (order.get(left.provider) ?? 0) - (order.get(right.provider) ?? 0));
  }

  private async row(client: PoolClient, provider: PlatformCredentialProvider, lock: boolean) {
    const result = await client.query<CredentialRow>(
      `SELECT ${ROW_COLUMNS} FROM platform_integration_credentials WHERE provider = $1${lock ? " FOR UPDATE" : ""}`, [provider]);
    if (!result.rowCount) throw new NotFoundException("Platform connection not found");
    return result.rows[0];
  }

  private async audit(client: PoolClient, operatorUserId: string, action: string, provider: PlatformCredentialProvider, details: Record<string, unknown>) {
    const id = randomUUID();
    await client.query(
      `INSERT INTO platform_operator_audit (id, actor_user_id, action, target_type, target_id, correlation_id, details)
       VALUES ($1::uuid, $2, $3, 'platform_integration', $4, $1::text, $5::jsonb)`,
      [id, operatorUserId, action, provider, JSON.stringify(details)]);
    return id;
  }

  /** The intelligence service seals with the key that already seals firms' tokens; Business Core never holds it. */
  private async seal(provider: PlatformCredentialProvider, field: SecretField, value: string) {
    const body = await this.intelligence("/integrations/providers/internal/platform-credentials/seal", { provider, field, value });
    const sealed = body && typeof body === "object" ? (body as { sealed?: unknown }).sealed : undefined;
    if (typeof sealed !== "string" || !SEALED.test(sealed)) {
      throw new ServiceUnavailableException("The secret could not be stored. Try again.");
    }
    return sealed;
  }

  private async checkWithIntelligence(provider: TestableProvider): Promise<{ ok: boolean; reason: TestReason | null; version: number | null }> {
    const body = await this.intelligence(`/integrations/providers/internal/platform-credentials/${provider}/test`, {}) as
      { ok?: unknown; reason?: unknown; version?: unknown } | null;
    if (!body || typeof body.ok !== "boolean") throw new ServiceUnavailableException("The check could not run. Try again.");
    const reason = typeof body.reason === "string" && (TEST_REASONS as readonly string[]).includes(body.reason)
      ? body.reason as TestReason : "unexpected_response";
    const version = Number.isInteger(body.version) && Number(body.version) > 0 ? Number(body.version) : null;
    return { ok: body.ok, reason: body.ok ? null : reason, version };
  }

  private async intelligence(path: string, payload: unknown) {
    const base = this.config.get<string>("INTELLIGENCE_API_URL") ?? "http://127.0.0.1:8001/api/v1";
    const token = this.config.get<string>("BUSINESS_CORE_INTERNAL_TOKEN");
    if (!token) throw new ServiceUnavailableException("The integration service is not configured.");
    const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-wodana-internal-token": token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!response?.ok) throw new ServiceUnavailableException("The integration service is unavailable. Try again.");
    return response.json().catch(() => null) as Promise<unknown>;
  }
}
