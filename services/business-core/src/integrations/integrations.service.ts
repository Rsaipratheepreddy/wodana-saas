import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { DatabaseService } from "../database/database.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import {
  CompleteGoogleConnectionDto,
  CompleteProviderConnectionDto,
  DiscoverIntegrationResourcesDto,
  IntegrationFailureDto,
  MarkIntegrationSyncedDto,
  RecordIntegrationHealthDto,
  ReportIntegrationUseDto,
  RecordIntegrationActivityDto,
} from "./dto/integration-runtime.dto";
import { UpdateIntegrationResourcesDto } from "./dto/update-integration-resources.dto";
import { providerCapabilityView } from "./provider-capabilities";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
  ) {}

  capabilities(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "integrations.view", async (client) => {
      const [connections, evidence] = await Promise.all([
        client.query(
          `SELECT id,provider,status,display_name AS "displayName",updated_at AS "updatedAt"
           FROM integration_connections
           WHERE workspace_id=$1
           ORDER BY updated_at DESC,id`,
          [workspaceId],
        ),
        client.query(
          `SELECT entity_id AS "connectionId",action,occurred_at AS "occurredAt"
           FROM audit_events
           WHERE workspace_id=$1 AND entity_type='integration_connection'
             AND occurred_at>=now()-interval '90 days'
           ORDER BY occurred_at DESC,id DESC`,
          [workspaceId],
        ),
      ]);
      return {
        generatedAt: new Date().toISOString(),
        providers: providerCapabilityView(connections.rows as never, evidence.rows as never),
      };
    });
  }

  authorizeUse(actor: RequestActor, workspaceId: string, connectionId: string, access: "read" | "write") {
    return this.access.withPermission(actor, workspaceId, access === "write" ? "integrations.manage" : "integrations.view", async (client) => {
      const connection = await this.requireConnection(client, workspaceId, connectionId, false);
      if (connection.status !== "connected") throw new ConflictException("Connect this account before using it");
      return { id: connection.id, provider: connection.provider, version: connection.version };
    });
  }

  completeProviderConnection(connectionId: string, input: CompleteProviderConnectionDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const before = await this.requireConnection(client, input.workspaceId, connectionId, true);
      if (before.provider !== input.provider || before.status !== "pending" || Number(before.version) !== input.expectedVersion) {
        throw new ConflictException("Authorization is stale or belongs to another provider");
      }
      if (!input.secretReference.startsWith(`redis:provider:${input.provider}:${input.workspaceId}:${connectionId}:`)) {
        throw new UnprocessableEntityException("Credential does not belong to this connection");
      }
      this.assertSafeActivityMetadata(input.configuration);
      const result = await client.query(
        `UPDATE integration_connections SET external_account_id = $1, granted_scopes = $2::jsonb,
         secret_reference = $3, token_expires_at = $4, configuration = configuration || $5::jsonb,
         status = 'connected', last_error_code = NULL, last_error_at = NULL, revoked_at = NULL,
         version = version + 1 WHERE id = $6 AND workspace_id = $7
         RETURNING id, provider, status, version, external_account_id AS "externalAccountId"`,
        [input.externalAccountId, JSON.stringify(input.grantedScopes), input.secretReference,
          input.tokenExpiresAt ?? null, JSON.stringify(input.configuration), connectionId, input.workspaceId],
      );
      await this.recordChange(client, { workspaceId: input.workspaceId, actorUserId: typeof before.connectedBy === "string" ? before.connectedBy : null,
        source: "integration", action: "integration.connection_connected", entityId: connectionId,
        after: result.rows[0] });
      return result.rows[0];
    });
  }

  getConnection(actor: RequestActor, workspaceId: string, connectionId: string) {
    return this.access.withPermission(actor, workspaceId, "integrations.view", async (client) => {
      const connection = await this.requireConnection(client, workspaceId, connectionId, false);
      const { connectedBy: _connectedBy, ...safeConnection } = connection;
      return safeConnection;
    });
  }

  listResources(actor: RequestActor, workspaceId: string, connectionId: string) {
    return this.access.withPermission(actor, workspaceId, "integrations.view", async (client) => {
      await this.requireConnection(client, workspaceId, connectionId, false);
      const result = await client.query(
        `SELECT id, resource_type AS "resourceType", external_id AS "externalId",
                display_name AS "displayName", enabled, direction, configuration,
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM integration_resources
         WHERE workspace_id = $1 AND connection_id = $2
         ORDER BY (configuration->>'primary')::boolean DESC NULLS LAST, display_name, external_id`,
        [workspaceId, connectionId],
      );
      return result.rows;
    });
  }

  updateResources(
    actor: RequestActor,
    workspaceId: string,
    connectionId: string,
    input: UpdateIntegrationResourcesDto,
  ) {
    return this.access.withPermission(actor, workspaceId, "integrations.manage", async (client, actorUser) => {
      const before = await this.requireConnection(client, workspaceId, connectionId, true);
      if (!["connected", "degraded"].includes(String(before.status))) {
        throw new ConflictException("Connect the integration before selecting calendars");
      }
      if (Number(before.version) !== input.version) {
        throw new ConflictException("Integration changed; reload and try again");
      }

      const ids = input.resources.map((resource) => resource.resourceId);
      if (ids.length) {
        const known = await client.query<{ id: string; configuration: Record<string, unknown> }>(
          `SELECT id, configuration FROM integration_resources
           WHERE workspace_id = $1 AND connection_id = $2 AND id = ANY($3::uuid[])
             AND COALESCE((configuration->>'available')::boolean, true)
           FOR UPDATE`,
          [workspaceId, connectionId, ids],
        );
        if (known.rowCount !== ids.length) {
          throw new UnprocessableEntityException("One or more calendars do not belong to this connection");
        }
        const knownById = new Map(known.rows.map((resource) => [resource.id, resource]));
        for (const resource of input.resources) {
          const accessRole = knownById.get(resource.resourceId)?.configuration.accessRole;
          if (
            resource.direction !== "inbound"
            && accessRole !== "owner"
            && accessRole !== "writer"
          ) {
            throw new UnprocessableEntityException(
              "A read-only Google calendar cannot use an outbound sync direction",
            );
          }
        }
      }

      for (const resource of input.resources) {
        await client.query(
          `UPDATE integration_resources
           SET enabled = $1, direction = $2::sync_direction
           WHERE id = $3 AND workspace_id = $4 AND connection_id = $5`,
          [resource.enabled, resource.direction, resource.resourceId, workspaceId, connectionId],
        );
      }
      const changed = await client.query(
        `UPDATE integration_connections
         SET version = version + 1
         WHERE id = $1 AND workspace_id = $2 AND version = $3
         RETURNING version, updated_at AS "updatedAt"`,
        [connectionId, workspaceId, input.version],
      );
      if (!changed.rowCount) throw new ConflictException("Integration changed; reload and try again");

      const response = {
        connectionId,
        version: changed.rows[0].version as number,
        updatedAt: changed.rows[0].updatedAt as Date,
        resources: await this.resourceRows(client, workspaceId, connectionId),
      };
      await this.recordChange(client, {
        workspaceId,
        actorUserId: actorUser.userId,
        source: "user",
        action: "integration.resources_updated",
        entityId: connectionId,
        before: { version: before.version },
        after: response,
      });
      return response;
    });
  }

  completeGoogleConnection(connectionId: string, input: CompleteGoogleConnectionDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const before = await this.requireConnection(client, input.workspaceId, connectionId, true);
      if (before.provider !== "google_workspace") {
        throw new UnprocessableEntityException("Connection is not a Google Workspace connection");
      }
      if (before.status !== "pending" || Number(before.version) !== input.expectedVersion) {
        throw new ConflictException("OAuth request is stale or the connection is no longer pending");
      }
      if (String(before.externalDomain).toLowerCase() !== input.externalDomain.toLowerCase()) {
        throw new UnprocessableEntityException("Authorized Google account does not match the configured domain");
      }

      await this.upsertDiscoveredResources(client, input.workspaceId, connectionId, input.resources);
      const changed = await client.query(
        `UPDATE integration_connections
         SET external_account_id = $1, external_domain = $2, status = 'connected',
             granted_scopes = $3::jsonb, secret_reference = $4, token_expires_at = $5,
             last_error_code = NULL, last_error_at = NULL, revoked_at = NULL,
             version = version + 1
         WHERE id = $6 AND workspace_id = $7 AND version = $8 AND status = 'pending'
         RETURNING id, workspace_id AS "workspaceId", legal_entity_id AS "legalEntityId",
                   provider, display_name AS "displayName", external_account_id AS "externalAccountId",
                   external_domain AS "externalDomain", status, granted_scopes AS "grantedScopes",
                   token_expires_at AS "tokenExpiresAt", version, created_at AS "createdAt",
                   updated_at AS "updatedAt"`,
        [
          input.externalAccountId.toLowerCase(), input.externalDomain.toLowerCase(),
          JSON.stringify(input.grantedScopes), input.secretReference, input.tokenExpiresAt ?? null,
          connectionId, input.workspaceId, input.expectedVersion,
        ],
      );
      if (!changed.rowCount) throw new ConflictException("OAuth request is stale");
      const response = changed.rows[0] as Record<string, unknown>;
      await this.recordChange(client, {
        workspaceId: input.workspaceId,
        actorUserId: typeof before.connectedBy === "string" ? before.connectedBy : null,
        source: "integration",
        action: "integration.connection_completed",
        entityId: connectionId,
        before,
        after: { ...response, secretReference: "[stored]" },
      });
      return response;
    });
  }

  failConnection(connectionId: string, input: IntegrationFailureDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const before = await this.requireConnection(client, input.workspaceId, connectionId, true);
      if (before.status !== "pending" || Number(before.version) !== input.expectedVersion) {
        return { ignored: true, reason: "stale_oauth_attempt" };
      }
      const changed = await client.query(
        `UPDATE integration_connections
         SET status = 'degraded', last_error_code = $1, last_error_at = now(), version = version + 1
         WHERE id = $2 AND workspace_id = $3 AND version = $4
         RETURNING id, status, last_error_code AS "lastErrorCode", version,
                   updated_at AS "updatedAt"`,
        [input.errorCode, connectionId, input.workspaceId, input.expectedVersion],
      );
      const response = changed.rows[0] as Record<string, unknown>;
      await this.recordChange(client, {
        workspaceId: input.workspaceId,
        actorUserId: typeof before.connectedBy === "string" ? before.connectedBy : null,
        source: "integration",
        action: "integration.connection_failed",
        entityId: connectionId,
        before,
        after: response,
      });
      return response;
    });
  }

  discoverResources(connectionId: string, input: DiscoverIntegrationResourcesDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const connection = await this.requireConnection(client, input.workspaceId, connectionId, true);
      if (!["connected", "degraded"].includes(String(connection.status))) {
        throw new ConflictException("Connection is not active");
      }
      await this.upsertDiscoveredResources(client, input.workspaceId, connectionId, input.resources);
      return { connectionId, resources: await this.resourceRows(client, input.workspaceId, connectionId) };
    });
  }

  markSynced(connectionId: string, input: MarkIntegrationSyncedDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      await this.requireConnection(client, input.workspaceId, connectionId, true);
      const result = await client.query(
        `UPDATE integration_connections
         SET last_synced_at = $1, last_error_code = NULL, last_error_at = NULL,
             status = CASE WHEN status = 'degraded' THEN 'connected'::integration_status ELSE status END
         WHERE id = $2 AND workspace_id = $3 AND status IN ('connected', 'degraded')
         RETURNING id, status, last_synced_at AS "lastSyncedAt", updated_at AS "updatedAt"`,
        [input.syncedAt ?? new Date().toISOString(), connectionId, input.workspaceId],
      );
      if (!result.rowCount) throw new ConflictException("Connection is not active");
      return result.rows[0];
    });
  }

  recordHealth(connectionId: string, input: RecordIntegrationHealthDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      return this.applyRuntimeHealth(client, input.workspaceId, connectionId, input, null);
    });
  }

  reportRuntimeHealth(
    actor: RequestActor,
    workspaceId: string,
    connectionId: string,
    input: ReportIntegrationUseDto,
  ) {
    return this.access.withPermission(actor, workspaceId, "integrations.view", async (client, actorUser) =>
      this.applyRuntimeHealth(client, workspaceId, connectionId, input, actorUser.userId),
    );
  }

  recordActivity(connectionId: string, input: RecordIntegrationActivityDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const connection = await this.requireConnection(client, input.workspaceId, connectionId, true);
      if (!["connected", "degraded"].includes(String(connection.status))) {
        throw new ConflictException("Connection is not active");
      }
      this.assertSafeActivityMetadata(input.metadata ?? {});
      if (typeof input.metadata?.operationId === "string") {
        const prior = await client.query(
          `SELECT id FROM audit_events WHERE workspace_id = $1 AND entity_id = $2 AND action = $3
           AND after->>'operationId' = $4 LIMIT 1`,
          [input.workspaceId, connectionId, input.action, input.metadata.operationId],
        );
        if (prior.rowCount) return { recorded: true, idempotentReplay: true };
      }
      await this.recordChange(client, {
        workspaceId: input.workspaceId,
        actorUserId: typeof connection.connectedBy === "string"
          ? connection.connectedBy
          : null,
        source: "integration",
        action: input.action,
        entityId: connectionId,
        after: { externalId: input.externalId, ...(input.metadata ?? {}) },
      });
      return { recorded: true };
    });
  }

  runtimeContext(workspaceId: string, connectionId: string) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const result = await client.query(
        `SELECT id, workspace_id AS "workspaceId", legal_entity_id AS "legalEntityId", configuration, provider,
                external_account_id AS "externalAccountId", external_domain AS "externalDomain",
                status, granted_scopes AS "grantedScopes", secret_reference AS "secretReference",
                token_expires_at AS "tokenExpiresAt", version
         FROM integration_connections
         WHERE id = $1 AND workspace_id = $2`,
        [connectionId, workspaceId],
      );
      if (!result.rowCount) throw new NotFoundException("Integration connection not found");
      const connection = result.rows[0] as Record<string, unknown>;
      return {
        ...connection,
        resources: await this.resourceRows(client, workspaceId, connectionId),
      };
    });
  }

  providerRuntime(workspaceId: string, provider: string) {
    if (!["google_workspace", "quickbooks", "whatsapp", "zoho_books"].includes(provider)) throw new UnprocessableEntityException("Unsupported integration provider");
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const result = await client.query<{ id: string }>(`SELECT id FROM integration_connections WHERE workspace_id=$1 AND provider=$2 AND status='connected' ORDER BY COALESCE((configuration->>'isDefault')::boolean,false) DESC,updated_at DESC,id LIMIT 1`, [workspaceId, provider]);
      if (!result.rowCount) throw new NotFoundException(`No connected ${provider.replaceAll("_", " ")} account`);
      const connectionId = result.rows[0].id;
      const connection = await client.query(`SELECT id,workspace_id AS "workspaceId",legal_entity_id AS "legalEntityId",configuration,provider,external_account_id AS "externalAccountId",external_domain AS "externalDomain",status,granted_scopes AS "grantedScopes",secret_reference AS "secretReference",token_expires_at AS "tokenExpiresAt",version FROM integration_connections WHERE workspace_id=$1 AND id=$2`, [workspaceId, connectionId]);
      return { ...connection.rows[0], resources: await this.resourceRows(client, workspaceId, connectionId) };
    });
  }

  private async upsertDiscoveredResources(
    client: PoolClient,
    workspaceId: string,
    connectionId: string,
    resources: CompleteGoogleConnectionDto["resources"],
  ): Promise<void> {
    const seen = new Set<string>();
    for (const resource of resources) {
      if (seen.has(resource.externalId)) {
        throw new UnprocessableEntityException("Google returned a duplicate calendar identifier");
      }
      seen.add(resource.externalId);
      await client.query(
        `INSERT INTO integration_resources
          (workspace_id, connection_id, resource_type, external_id, display_name,
           enabled, direction, configuration)
         VALUES ($1, $2, 'calendar', $3, $4, $5, $6::sync_direction,
                 $7::jsonb || '{"available":true}'::jsonb)
         ON CONFLICT (connection_id, resource_type, external_id)
         DO UPDATE SET display_name = EXCLUDED.display_name,
                       enabled = integration_resources.enabled,
                       configuration = EXCLUDED.configuration
         WHERE integration_resources.workspace_id = EXCLUDED.workspace_id`,
        [
          workspaceId, connectionId, resource.externalId, resource.displayName,
          resource.enabled, resource.direction, resource.configuration,
        ],
      );
    }
    await client.query(
      `UPDATE integration_resources
       SET enabled = false,
           configuration = jsonb_set(configuration, '{available}', 'false'::jsonb, true)
       WHERE workspace_id = $1 AND connection_id = $2 AND resource_type = 'calendar'
         AND external_id <> ALL($3::text[])`,
      [workspaceId, connectionId, [...seen]],
    );
  }

  private async resourceRows(client: PoolClient, workspaceId: string, connectionId: string) {
    const result = await client.query(
      `SELECT id, resource_type AS "resourceType", external_id AS "externalId",
              display_name AS "displayName", enabled, direction, configuration,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM integration_resources
       WHERE workspace_id = $1 AND connection_id = $2
       ORDER BY (configuration->>'primary')::boolean DESC NULLS LAST, display_name, external_id`,
      [workspaceId, connectionId],
    );
    return result.rows;
  }

  private async requireConnection(
    client: PoolClient,
    workspaceId: string,
    connectionId: string,
    lock: boolean,
  ): Promise<Record<string, unknown>> {
    const result = await client.query(
      `SELECT id, workspace_id AS "workspaceId", legal_entity_id AS "legalEntityId",
              provider, display_name AS "displayName", external_account_id AS "externalAccountId",
              external_domain AS "externalDomain", status, granted_scopes AS "grantedScopes",
              configuration, connected_by AS "connectedBy", token_expires_at AS "tokenExpiresAt",
              last_synced_at AS "lastSyncedAt", last_error_code AS "lastErrorCode",
              last_error_at AS "lastErrorAt", version, created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM integration_connections
       WHERE id = $1 AND workspace_id = $2${lock ? " FOR UPDATE" : ""}`,
      [connectionId, workspaceId],
    );
    if (!result.rowCount) throw new NotFoundException("Integration connection not found");
    return result.rows[0] as Record<string, unknown>;
  }

  private async applyRuntimeHealth(
    client: PoolClient,
    workspaceId: string,
    connectionId: string,
    input: Pick<RecordIntegrationHealthDto, "operation" | "succeeded" | "errorCode">,
    actorUserId: string | null,
  ) {
    const before = await this.requireConnection(client, workspaceId, connectionId, true);
    if (!["connected", "degraded"].includes(String(before.status))) {
      throw new ConflictException("Connection is not active");
    }
    const errorCode = input.succeeded ? null : (input.errorCode ?? "provider_unavailable");
    const changed = await client.query(
      `UPDATE integration_connections
       SET status = $1::integration_status,
           last_synced_at = CASE WHEN $2::boolean THEN now() ELSE last_synced_at END,
           last_error_code = $3,
           last_error_at = CASE WHEN $2::boolean THEN NULL ELSE now() END
       WHERE id = $4 AND workspace_id = $5
       RETURNING id, status, last_synced_at AS "lastSyncedAt",
                 last_error_code AS "lastErrorCode", last_error_at AS "lastErrorAt",
                 version, updated_at AS "updatedAt"`,
      [input.succeeded ? "connected" : "degraded", input.succeeded, errorCode, connectionId, workspaceId],
    );
    const response = changed.rows[0] as Record<string, unknown>;
    await this.recordChange(client, {
      workspaceId,
      actorUserId: actorUserId ?? (typeof before.connectedBy === "string" ? before.connectedBy : null),
      source: "integration",
      action: input.succeeded ? "integration.provider_read_succeeded" : "integration.provider_read_failed",
      entityId: connectionId,
      before: { status: before.status, lastErrorCode: before.lastErrorCode },
      after: { ...response, operation: input.operation },
    });
    return response;
  }

  private async recordChange(
    client: PoolClient,
    change: {
      workspaceId: string;
      actorUserId: string | null;
      source: "user" | "integration";
      action: string;
      entityId: string;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    },
  ): Promise<void> {
    const eventId = randomUUID();
    const correlationId = randomUUID();
    const occurredAt = new Date().toISOString();
    const payload = {
      schemaVersion: 1,
      eventId,
      workspaceId: change.workspaceId,
      aggregateType: "integration_connection",
      aggregateId: change.entityId,
      actorUserId: change.actorUserId,
      occurredAt,
      correlationId,
      causationId: null,
      data: change.after ?? {},
    };
    await client.query(
      `INSERT INTO audit_events
        (id, workspace_id, actor_user_id, source, action, entity_type, entity_id,
         before, after, correlation_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, 'integration_connection', $6, $7, $8, $9, $10)`,
      [
        eventId, change.workspaceId, change.actorUserId, change.source, change.action,
        change.entityId, change.before ?? null, change.after ?? null, correlationId, occurredAt,
      ],
    );
    await client.query(
      `INSERT INTO outbox_events
        (id, workspace_id, aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1, $2, 'integration_connection', $3, $4, $5)`,
      [eventId, change.workspaceId, change.entityId, change.action, payload],
    );
  }

  private assertSafeActivityMetadata(metadata: Record<string, unknown>): void {
    const serialized = JSON.stringify(metadata);
    if (Buffer.byteLength(serialized, "utf8") > 16_384) {
      throw new UnprocessableEntityException("Integration activity metadata is too large");
    }
    const secretKeys = new Set([
      "secret",
      "clientsecret",
      "webhooksecret",
      "accesstoken",
      "refreshtoken",
      "apikey",
      "password",
      "credential",
      "credentials",
      "privatekey",
      "authorization",
    ]);
    const inspect = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(inspect);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [key, nested] of Object.entries(value)) {
        const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
        if (secretKeys.has(normalized)) {
          throw new UnprocessableEntityException(
            "Integration credentials cannot be written to activity history",
          );
        }
        inspect(nested);
      }
    };
    inspect(metadata);
  }
}
