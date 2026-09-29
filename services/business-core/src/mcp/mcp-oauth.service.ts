import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { AI_USE } from "../ai-tools/ai-tool-context";
import type { RequestActor } from "../auth/actor";
import { IdentityService } from "../auth/identity.service";
import { recordAudit } from "../audit/record-audit";
import { DatabaseService } from "../database/database.service";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import {
  ACCESS_TOKEN_TTL_SECONDS, AUTHORIZATION_CODE_TTL_SECONDS, MCP_PATH, OAuthError, REFRESH_TOKEN_TTL_SECONDS, canonicalResource, grantedScopes, hashSecret, mcpResource,
  mintToken, parseScopes, parseToken, readAuthorizationClient, readAuthorizationRequest, readRegistration, redirectBack, sameHash, scopeText, verifyPkce,
  type AuthorizationRequest, type McpScope,
} from "./mcp-oauth.domain";
import { McpRateLimitService } from "./mcp-rate-limit.service";

type Db = Pick<PoolClient, "query">;
const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETTINGS_MANAGE = "workspace.settings.manage";
export const AI_APPS_PAGE = "/workspace/settings/ai-apps";

/** Who an AI app's access token acts as, where, and with which scopes. */
export type McpPrincipal = {
  workspaceId: string; userId: string; email: string; displayName: string;
  connectionId: string; tokenId: string; clientId: string; clientName: string; scopes: McpScope[];
};

export type UnavailableReason = "ai_off" | "mcp_off" | "no_ai_access";
export type WorkspaceChoice = { id: string; name: string; available: boolean; reason: UnavailableReason | null };
export type McpConnectionRow = {
  id: string; clientName: string; userId: string; userName: string; mine: boolean; scopes: McpScope[]; createdAt: string; lastUsedAt: string | null; version: number;
};
export type McpOverview = { enabled: boolean; aiEnabled: boolean; version: number; canManage: boolean; connections: McpConnectionRow[] };
export type TokenResponse = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

type ClientRow = { id: string; clientName: string; clientUri: string | null; redirectUris: string[]; authMethod: "none" | "client_secret_post" | "client_secret_basic"; secretHash: string | null };

/** An authorization request that can be answered back to the app (its client and redirect URI are known). */
export class RedirectableOAuthError extends OAuthError {
  constructor(cause: OAuthError, readonly redirectTo: string) { super(cause.error, cause.description, cause.status); }
}

const REASON_MESSAGES: Record<UnavailableReason, string> = {
  ai_off: "AI assistance is off for this workspace.",
  mcp_off: "AI apps are off for this workspace. An owner can turn them on in Settings.",
  no_ai_access: "You don't have access to Woddy in this workspace.",
};
const str = (value: unknown) => (typeof value === "string" && value ? value : null);
const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);

/**
 * A loopback redirect URI matches whatever port the app opens at request time (RFC 8252 §7.3); every other
 * redirect URI must match what was registered exactly.
 */
export function redirectMatches(registered: string, requested: string | null) {
  if (!requested) return false;
  if (registered === requested) return true;
  try {
    const a = new URL(registered);
    const b = new URL(requested);
    return a.protocol === "http:" && b.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(a.hostname) && a.hostname === b.hostname
      && a.pathname === b.pathname && a.search === b.search;
  } catch { return false; }
}

/**
 * Wodana as the OAuth 2.1 authorization server for AI apps (W-5): registration, the consent a signed-in person
 * gives for one workspace, the token endpoint (code with PKCE, rotating refresh tokens), revocation, access
 * token checks, and Settings → AI apps (the workspace switch and each person's connected apps).
 *
 * Codes and tokens name their workspace, so each is looked up in that workspace's tenant transaction under
 * RLS. Only their SHA-256 hashes are stored. A code or refresh token presented twice ends the connection.
 */
@Injectable()
export class McpOAuthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(IdentityService) private readonly identities: IdentityService,
    @Inject(McpRateLimitService) private readonly limits: McpRateLimitService,
  ) {}

  // ---------- registration (RFC 7591) ----------

  async register(body: unknown, address: string) {
    if (!(await this.limits.takeRegistration(address))) throw new OAuthError("temporarily_unavailable", "Too many registrations from this address. Try again later.", 429);
    const registration = readRegistration(body);
    const secret = registration.authMethod === "none" ? null : `wmcs_${randomBytes(32).toString("base64url")}`;
    const row = (await this.database.query<{ id: string; createdAt: Date }>(
      `INSERT INTO mcp_oauth_clients (client_name, client_uri, redirect_uris, token_endpoint_auth_method, client_secret_hash, software_id, software_version)
       VALUES ($1, $2, $3::text[], $4, $5, $6, $7) RETURNING id, created_at AS "createdAt"`,
      [registration.clientName, registration.clientUri, registration.redirectUris, registration.authMethod, secret ? hashSecret(secret) : null,
        registration.softwareId, registration.softwareVersion])).rows[0];
    return {
      client_id: row.id,
      client_id_issued_at: Math.floor(new Date(row.createdAt).getTime() / 1000),
      client_name: registration.clientName,
      ...(registration.clientUri ? { client_uri: registration.clientUri } : {}),
      redirect_uris: registration.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: registration.authMethod,
      scope: "read write",
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    };
  }

  // ---------- consent ----------

  /** What the consent screen shows: the app, what it asks for and the person's workspaces (which can allow it). */
  async authorization(actor: RequestActor, query: string, origin: string) {
    const { client, request } = await this.checkAuthorization(query, origin);
    const user = await this.identities.resolveActor(actor);
    return {
      client: { id: client.id, name: client.clientName, uri: client.clientUri },
      redirectHost: redirectHost(request.redirectUri),
      scopes: request.scopes,
      workspaces: await this.workspaceChoices(user.userId),
    };
  }

  /**
   * Allow (for one workspace, with the scopes the person kept) or deny. Allowing records the connection (one per
   * person and app in a workspace; allowing again updates it), mints a one-time code and tells the person when
   * the app is new to them. The answer is where to send the browser back to the app.
   */
  async decide(actor: RequestActor, body: Record<string, unknown>, origin: string): Promise<{ redirectTo: string }> {
    let checked: { client: ClientRow; request: AuthorizationRequest };
    try { checked = await this.checkAuthorization(typeof body.query === "string" ? body.query : "", origin); }
    catch (error) { if (error instanceof RedirectableOAuthError) return { redirectTo: error.redirectTo }; throw error; }
    const { client, request } = checked;
    if (body.decision === "deny") {
      return { redirectTo: redirectBack(request.redirectUri, { error: "access_denied", error_description: "The person did not allow access.", state: request.state, iss: origin }) };
    }
    if (body.decision !== "allow") throw new BadRequestException("Allow or deny.");
    const workspaceId = typeof body.workspaceId === "string" && UUID.test(body.workspaceId) ? body.workspaceId.toLowerCase() : null;
    if (!workspaceId) throw new BadRequestException("Choose a workspace.");
    const scopes = grantedScopes(request.scopes, Array.isArray(body.scopes) ? body.scopes.filter((item): item is string => typeof item === "string") : []);
    const code = mintToken("ac", workspaceId);
    await this.access.withPermission(actor, workspaceId, AI_USE, async (db, user) => {
      const reason = await this.unavailableReason(db, workspaceId, user.userId);
      if (reason) throw new ForbiddenException({ message: REASON_MESSAGES[reason], code: `AI_APPS_${reason.toUpperCase()}` });
      const existing = (await db.query<{ id: string }>(
        `SELECT id FROM mcp_connections WHERE workspace_id = $1 AND user_id = $2 AND client_id = $3 AND revoked_at IS NULL FOR UPDATE`,
        [workspaceId, user.userId, client.id])).rows[0];
      const connectionId = existing
        ? (await db.query<{ id: string }>(
          `UPDATE mcp_connections SET scopes = $3::text[], client_name = $4, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2 RETURNING id`,
          [workspaceId, existing.id, scopes, client.clientName])).rows[0].id
        : (await db.query<{ id: string }>(
          `INSERT INTO mcp_connections (workspace_id, user_id, client_id, client_name, scopes) VALUES ($1, $2, $3, $4, $5::text[]) RETURNING id`,
          [workspaceId, user.userId, client.id, client.clientName, scopes])).rows[0].id;
      await db.query(
        `INSERT INTO mcp_authorization_codes (workspace_id, connection_id, code_hash, redirect_uri, code_challenge, scopes, resource, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::text[], $7, now() + make_interval(secs => $8))`,
        [workspaceId, connectionId, hashSecret(code), request.redirectUri, request.codeChallenge, scopes, request.resource ?? canonicalResource(mcpResource(origin)), AUTHORIZATION_CODE_TTL_SECONDS]);
      await recordAudit(db, { workspaceId, actorUserId: user.userId, action: "ai.mcp.app_authorized", entityType: "mcp_connection", entityId: connectionId,
        after: { client: client.clientName, clientId: client.id, scopes, newConnection: !existing } });
      if (!existing) {
        // A new app acting as this person: they hear it in the app and by email, in case it wasn't them.
        const variables = { appName: client.clientName, access: scopes.includes("write") ? "read your records and prepare changes you confirm" : "read your records" };
        const key = `ai.app_connected:${connectionId}`;
        await notifyUserInApp(db, { workspaceId, recipientUserId: user.userId, code: "ai.app_connected", eventType: "ai.app_connected", variables, deepLink: AI_APPS_PAGE, idempotencyKey: key });
        await queueUserEmail(db, { workspaceId, recipientUserId: user.userId, code: "ai.app_connected", eventType: "ai.app_connected", variables, deepLink: AI_APPS_PAGE, idempotencyKey: `${key}:email` });
      }
    });
    return { redirectTo: redirectBack(request.redirectUri, { code, state: request.state, iss: origin }) };
  }

  // ---------- the token endpoint ----------

  async token(params: Record<string, unknown>, authorization: string | undefined): Promise<TokenResponse> {
    const client = await this.authenticateClient(params, authorization);
    if (params.grant_type === "authorization_code") return this.exchangeCode(client, params);
    if (params.grant_type === "refresh_token") return this.refresh(client, params);
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  }

  /** RFC 7009: revoking a refresh token ends the connection; an access token ends alone. Always answered 200. */
  async revoke(params: Record<string, unknown>, authorization: string | undefined) {
    const client = await this.authenticateClient(params, authorization);
    const token = str(params.token);
    const parsed = parseToken(token, "rt") ?? parseToken(token, "at");
    if (!token || !parsed) return;
    await this.database.tenantTransaction(parsed.workspaceId, SERVICE_ACTOR_ID, async (db) => {
      const row = (await db.query<{ id: string; kind: string; connectionId: string; clientId: string }>(
        `SELECT token.id, token.kind, token.connection_id AS "connectionId", connection.client_id AS "clientId"
           FROM mcp_tokens token JOIN mcp_connections connection ON connection.workspace_id = token.workspace_id AND connection.id = token.connection_id
          WHERE token.workspace_id = $1 AND token.token_hash = $2 FOR UPDATE OF token`, [parsed.workspaceId, hashSecret(token)])).rows[0];
      if (!row || row.clientId !== client.id) return;
      if (row.kind === "refresh") await this.endConnection(db, parsed.workspaceId, row.connectionId, "app", null);
      else await db.query(`UPDATE mcp_tokens SET revoked_at = now() WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL`, [parsed.workspaceId, row.id]);
    });
  }

  /** The person and scopes behind an access token presented at this host's MCP endpoint, or null. */
  async verifyAccessToken(token: string | null, origin: string): Promise<McpPrincipal | null> {
    const parsed = parseToken(token, "at");
    if (!token || !parsed) return null;
    return this.database.tenantTransaction(parsed.workspaceId, SERVICE_ACTOR_ID, async (db) => {
      const row = (await db.query<Omit<McpPrincipal, "workspaceId"> & { resource: string; stale: boolean }>(
        `SELECT token.id AS "tokenId", token.scopes, token.resource, connection.id AS "connectionId", connection.user_id AS "userId", connection.client_id AS "clientId",
                connection.client_name AS "clientName", app_user.primary_email AS email, app_user.display_name AS "displayName",
                (connection.last_used_at IS NULL OR connection.last_used_at < now() - interval '1 minute') AS stale
           FROM mcp_tokens token
           JOIN mcp_connections connection ON connection.workspace_id = token.workspace_id AND connection.id = token.connection_id AND connection.revoked_at IS NULL
           JOIN users app_user ON app_user.id = connection.user_id AND app_user.status = 'active'
          WHERE token.workspace_id = $1 AND token.token_hash = $2 AND token.kind = 'access' AND token.revoked_at IS NULL AND token.expires_at > now()`,
        [parsed.workspaceId, hashSecret(token)])).rows[0];
      // A token is for the MCP endpoint of the host it was issued for (RFC 8707 audience).
      if (!row || row.resource !== canonicalResource(mcpResource(origin))) return null;
      if (row.stale) await db.query(`UPDATE mcp_connections SET last_used_at = now() WHERE workspace_id = $1 AND id = $2`, [parsed.workspaceId, row.connectionId]);
      const { resource: _resource, stale: _stale, ...principal } = row;
      return { ...principal, workspaceId: parsed.workspaceId };
    });
  }

  // ---------- Settings → AI apps ----------

  overview(actor: RequestActor, workspaceId: string): Promise<McpOverview> {
    return this.access.asMember(actor, workspaceId, (db, user) => this.readOverview(db, workspaceId, user.userId));
  }

  /** Owners switch AI apps on or off for the workspace (AI assistance must be on to switch them on). */
  setEnabled(actor: RequestActor, workspaceId: string, input: { enabled?: unknown; version?: unknown }): Promise<McpOverview> {
    if (typeof input.enabled !== "boolean" || !Number.isInteger(input.version) || (input.version as number) < 0) throw new BadRequestException("Send enabled and the version you saw.");
    const enabled = input.enabled;
    return this.access.withPermission(actor, workspaceId, SETTINGS_MANAGE, async (db, user) => {
      const current = (await db.query<{ enabled: boolean; mcpEnabled: boolean; version: number }>(
        `SELECT enabled, mcp_enabled AS "mcpEnabled", version FROM workspace_ai_settings WHERE workspace_id = $1 FOR UPDATE`, [workspaceId])).rows[0];
      if ((current?.version ?? 0) !== input.version) throw new ConflictException("AI settings changed; reload and try again");
      if (enabled && !current?.enabled) throw new UnprocessableEntityException("Turn on AI assistance first.");
      await db.query(
        `INSERT INTO workspace_ai_settings (workspace_id, enabled, mcp_enabled, changed_by) VALUES ($1, false, $2, $3)
         ON CONFLICT (workspace_id) DO UPDATE SET mcp_enabled = EXCLUDED.mcp_enabled, changed_by = EXCLUDED.changed_by, changed_at = now(), version = workspace_ai_settings.version + 1`,
        [workspaceId, enabled, user.userId]);
      await recordAudit(db, { workspaceId, actorUserId: user.userId, action: enabled ? "ai.mcp.enabled" : "ai.mcp.disabled", entityType: "workspace", entityId: workspaceId,
        before: { mcpEnabled: current?.mcpEnabled ?? false }, after: { mcpEnabled: enabled } });
      return this.readOverview(db, workspaceId, user.userId);
    });
  }

  /** A person revokes their own app; an owner (workspace.settings.manage) anyone's. Revoking twice is a no-op. */
  revokeConnection(actor: RequestActor, workspaceId: string, connectionId: string, input: { version?: unknown }): Promise<McpOverview> {
    if (!Number.isInteger(input.version) || (input.version as number) < 1) throw new BadRequestException("Send the version you saw.");
    return this.access.asMember(actor, workspaceId, async (db, user) => {
      const row = (await db.query<{ userId: string; version: number; revoked: boolean }>(
        `SELECT user_id AS "userId", version, revoked_at IS NOT NULL AS revoked FROM mcp_connections WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
        [workspaceId, connectionId])).rows[0];
      const mine = row?.userId === user.userId;
      if (!row || (!mine && !(await this.access.hasPermission(db, workspaceId, user.userId, SETTINGS_MANAGE)))) throw new NotFoundException("This AI app was not found.");
      if (!row.revoked) {
        if (row.version !== input.version) throw new ConflictException("This AI app changed; reload and try again");
        await this.endConnection(db, workspaceId, connectionId, mine ? "person" : "manager", user.userId);
      }
      return this.readOverview(db, workspaceId, user.userId);
    });
  }

  // ---------- inside ----------

  private async readOverview(db: Db, workspaceId: string, userId: string): Promise<McpOverview> {
    const canManage = await this.access.hasPermission(db as PoolClient, workspaceId, userId, SETTINGS_MANAGE);
    const settings = (await db.query<{ enabled: boolean; mcpEnabled: boolean; version: number }>(
      `SELECT enabled, mcp_enabled AS "mcpEnabled", version FROM workspace_ai_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
    const connections = await db.query<Omit<McpConnectionRow, "createdAt" | "lastUsedAt"> & { createdAt: Date; lastUsedAt: Date | null }>(
      `SELECT connection.id, connection.client_name AS "clientName", connection.user_id AS "userId", app_user.display_name AS "userName",
              connection.user_id = $2 AS mine, connection.scopes, connection.created_at AS "createdAt", connection.last_used_at AS "lastUsedAt", connection.version
         FROM mcp_connections connection JOIN users app_user ON app_user.id = connection.user_id
        WHERE connection.workspace_id = $1 AND connection.revoked_at IS NULL AND ($3::boolean OR connection.user_id = $2)
        ORDER BY connection.created_at DESC LIMIT 200`, [workspaceId, userId, canManage]);
    return {
      enabled: settings?.mcpEnabled ?? false, aiEnabled: settings?.enabled ?? false, version: settings?.version ?? 0, canManage,
      connections: connections.rows.map((row) => ({ ...row, createdAt: iso(row.createdAt)!, lastUsedAt: iso(row.lastUsedAt) })),
    };
  }

  /** Ends a connection and every token it has, once, audited with the reason. */
  private async endConnection(db: Db, workspaceId: string, connectionId: string, reason: "person" | "manager" | "app" | "token_reuse", byUserId: string | null) {
    const ended = await db.query<{ clientName: string; userId: string }>(
      `UPDATE mcp_connections SET revoked_at = now(), revoked_by = $4, revoke_reason = $3, version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL RETURNING client_name AS "clientName", user_id AS "userId"`,
      [workspaceId, connectionId, reason, byUserId]);
    await db.query(`UPDATE mcp_tokens SET revoked_at = now() WHERE workspace_id = $1 AND connection_id = $2 AND revoked_at IS NULL`, [workspaceId, connectionId]);
    if (ended.rowCount) {
      await recordAudit(db, { workspaceId, actorUserId: byUserId, action: "ai.mcp.app_revoked", entityType: "mcp_connection", entityId: connectionId,
        after: { reason, client: ended.rows[0].clientName, userId: ended.rows[0].userId }, source: byUserId ? "user" : "internal" });
    }
  }

  private async readClient(clientId: string): Promise<ClientRow | null> {
    if (!UUID.test(clientId)) return null;
    return (await this.database.query<ClientRow>(
      `SELECT id, client_name AS "clientName", client_uri AS "clientUri", redirect_uris AS "redirectUris", token_endpoint_auth_method AS "authMethod", client_secret_hash AS "secretHash"
         FROM mcp_oauth_clients WHERE id = $1`, [clientId.toLowerCase()])).rows[0] ?? null;
  }

  private async checkAuthorization(query: string, origin: string): Promise<{ client: ClientRow; request: AuthorizationRequest }> {
    if (query.length > 4000) throw new OAuthError("invalid_request", "The request is too long.");
    const params = new URLSearchParams(query.replace(/^\?/, ""));
    const basics = readAuthorizationClient(params);
    const client = await this.readClient(basics.clientId);
    if (!client) throw new OAuthError("invalid_client", "This app is not registered. Connect it again from the app.");
    const registered = client.redirectUris.find((uri) => redirectMatches(uri, basics.redirectUri));
    if (!registered) throw new OAuthError("invalid_request", "The app sent an address we can't return to.");
    // From here on the app gets the error back at its redirect URI.
    try {
      const request = readAuthorizationRequest(params, basics);
      if (request.resource && new URL(request.resource).pathname !== MCP_PATH) throw new OAuthError("invalid_target", "Wodana issues tokens only for its MCP endpoint.");
      return { client, request };
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      throw new RedirectableOAuthError(error, redirectBack(basics.redirectUri, { error: error.error, error_description: error.description, state: params.get("state"), iss: origin }));
    }
  }

  private async workspaceChoices(userId: string): Promise<WorkspaceChoice[]> {
    const memberships = await this.database.actorTransaction(userId, (db) => db.query<{ id: string; name: string }>(
      `SELECT workspace.id, workspace.name FROM workspace_memberships membership JOIN workspaces workspace ON workspace.id = membership.workspace_id
        WHERE membership.user_id = $1 AND membership.status = 'active' AND workspace.status IN ('active', 'suspended')
        ORDER BY workspace.name LIMIT 50`, [userId]));
    const choices: WorkspaceChoice[] = [];
    for (const workspace of memberships.rows) {
      const reason = await this.database.tenantTransaction(workspace.id, userId, (db) => this.unavailableReason(db, workspace.id, userId));
      choices.push({ id: workspace.id, name: workspace.name, available: reason === null, reason });
    }
    return choices;
  }

  /** Why this person can't connect an AI app in this workspace, or null when they can. */
  private async unavailableReason(db: Db, workspaceId: string, userId: string): Promise<UnavailableReason | null> {
    const settings = (await db.query<{ enabled: boolean; mcpEnabled: boolean }>(
      `SELECT enabled, mcp_enabled AS "mcpEnabled" FROM workspace_ai_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
    if (!settings?.enabled) return "ai_off";
    if (!settings.mcpEnabled) return "mcp_off";
    if (!(await this.access.hasPermission(db as PoolClient, workspaceId, userId, AI_USE))) return "no_ai_access";
    return null;
  }

  /** The client, by client_id (public apps) or with its secret (in the body or HTTP Basic). */
  private async authenticateClient(params: Record<string, unknown>, authorization: string | undefined): Promise<ClientRow> {
    let clientId = str(params.client_id);
    let secret = str(params.client_secret);
    if (authorization?.startsWith("Basic ")) {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon > 0) {
        try { clientId = decodeURIComponent(decoded.slice(0, colon)); secret = decodeURIComponent(decoded.slice(colon + 1)); } catch { throw new OAuthError("invalid_client", "The client credentials can't be read.", 401); }
      }
    }
    const client = clientId ? await this.readClient(clientId) : null;
    if (!client) throw new OAuthError("invalid_client", "Unknown client.", 401);
    if (client.authMethod !== "none" && !(secret && client.secretHash && sameHash(hashSecret(secret), client.secretHash))) {
      throw new OAuthError("invalid_client", "The client secret is wrong.", 401);
    }
    return client;
  }

  private async exchangeCode(client: ClientRow, params: Record<string, unknown>): Promise<TokenResponse> {
    const code = str(params.code);
    const parsed = parseToken(code, "ac");
    if (!code || !parsed) throw new OAuthError("invalid_grant", "The code is not valid.");
    const outcome = await this.database.tenantTransaction(parsed.workspaceId, SERVICE_ACTOR_ID, async (db): Promise<{ tokens: TokenResponse } | { error: OAuthError }> => {
      const row = (await db.query<{ id: string; connectionId: string; redirectUri: string; codeChallenge: string; scopes: McpScope[]; resource: string;
        expired: boolean; used: boolean; clientId: string; revoked: boolean }>(
        `SELECT code.id, code.connection_id AS "connectionId", code.redirect_uri AS "redirectUri", code.code_challenge AS "codeChallenge", code.scopes, code.resource,
                code.expires_at <= now() AS expired, code.used_at IS NOT NULL AS used, connection.client_id AS "clientId", connection.revoked_at IS NOT NULL AS revoked
           FROM mcp_authorization_codes code
           JOIN mcp_connections connection ON connection.workspace_id = code.workspace_id AND connection.id = code.connection_id
          WHERE code.workspace_id = $1 AND code.code_hash = $2 FOR UPDATE OF code`, [parsed.workspaceId, hashSecret(code)])).rows[0];
      const invalid = { error: new OAuthError("invalid_grant", "The code is not valid.") };
      if (!row || row.clientId !== client.id) return invalid;
      if (row.used) {
        // A code used twice was intercepted or replayed: the connection and every token from it end (RFC 6749 §4.1.2).
        await this.endConnection(db, parsed.workspaceId, row.connectionId, "token_reuse", null);
        return { error: new OAuthError("invalid_grant", "This code was already used.") };
      }
      if (row.expired || row.revoked || !redirectMatches(row.redirectUri, str(params.redirect_uri))) return invalid;
      if (!verifyPkce(params.code_verifier, row.codeChallenge)) return { error: new OAuthError("invalid_grant", "The code verifier does not match.") };
      const resource = str(params.resource);
      if (resource && canonicalResource(resource) !== row.resource) return { error: new OAuthError("invalid_target", "The code was issued for another resource.") };
      await db.query(`UPDATE mcp_authorization_codes SET used_at = now() WHERE workspace_id = $1 AND id = $2`, [parsed.workspaceId, row.id]);
      return { tokens: await this.issue(db, parsed.workspaceId, row.connectionId, row.scopes, row.resource) };
    });
    if ("error" in outcome) throw outcome.error;
    return outcome.tokens;
  }

  private async refresh(client: ClientRow, params: Record<string, unknown>): Promise<TokenResponse> {
    const token = str(params.refresh_token);
    const parsed = parseToken(token, "rt");
    if (!token || !parsed) throw new OAuthError("invalid_grant", "The refresh token is not valid.");
    const outcome = await this.database.tenantTransaction(parsed.workspaceId, SERVICE_ACTOR_ID, async (db): Promise<{ tokens: TokenResponse } | { error: OAuthError }> => {
      const row = (await db.query<{ id: string; connectionId: string; scopes: McpScope[]; resource: string; expired: boolean; rotated: boolean; revoked: boolean; clientId: string; member: boolean }>(
        `SELECT token.id, token.connection_id AS "connectionId", token.scopes, token.resource, token.expires_at <= now() AS expired,
                token.rotated_at IS NOT NULL AS rotated, (token.revoked_at IS NOT NULL OR connection.revoked_at IS NOT NULL) AS revoked, connection.client_id AS "clientId",
                EXISTS (SELECT 1 FROM workspace_memberships membership WHERE membership.workspace_id = token.workspace_id AND membership.user_id = connection.user_id AND membership.status = 'active') AS member
           FROM mcp_tokens token JOIN mcp_connections connection ON connection.workspace_id = token.workspace_id AND connection.id = token.connection_id
          WHERE token.workspace_id = $1 AND token.token_hash = $2 AND token.kind = 'refresh' FOR UPDATE OF token`, [parsed.workspaceId, hashSecret(token)])).rows[0];
      const invalid = { error: new OAuthError("invalid_grant", "The refresh token is not valid.") };
      if (!row || row.clientId !== client.id) return invalid;
      if (row.rotated && !row.revoked) {
        // A refresh token is good once: presented again, it was copied, so the connection ends (OAuth 2.1 §4.3.1).
        await this.endConnection(db, parsed.workspaceId, row.connectionId, "token_reuse", null);
        return { error: new OAuthError("invalid_grant", "This refresh token was already used. Connect the app again.") };
      }
      if (row.revoked || row.rotated || row.expired || !row.member) return invalid;
      const asked = !params.scope ? row.scopes : parseScopes(params.scope);
      if (!asked || asked.some((scope) => !row.scopes.includes(scope))) return { error: new OAuthError("invalid_scope", "A refreshed token can't have more scopes than were granted.") };
      const resource = str(params.resource);
      if (resource && canonicalResource(resource) !== row.resource) return { error: new OAuthError("invalid_target", "The token was issued for another resource.") };
      await db.query(`UPDATE mcp_tokens SET rotated_at = now() WHERE workspace_id = $1 AND id = $2`, [parsed.workspaceId, row.id]);
      return { tokens: await this.issue(db, parsed.workspaceId, row.connectionId, asked, row.resource) };
    });
    if ("error" in outcome) throw outcome.error;
    return outcome.tokens;
  }

  private async issue(db: Db, workspaceId: string, connectionId: string, scopes: McpScope[], resource: string): Promise<TokenResponse> {
    const accessToken = mintToken("at", workspaceId);
    const refreshToken = mintToken("rt", workspaceId);
    await db.query(
      `INSERT INTO mcp_tokens (workspace_id, connection_id, kind, token_hash, scopes, resource, expires_at)
       VALUES ($1, $2, 'access', $3, $5::text[], $6, now() + make_interval(secs => $7)),
              ($1, $2, 'refresh', $4, $5::text[], $6, now() + make_interval(secs => $8))`,
      [workspaceId, connectionId, hashSecret(accessToken), hashSecret(refreshToken), scopes, resource, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS]);
    return { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refreshToken, scope: scopeText(scopes) };
  }
}

function redirectHost(uri: string) {
  try { const url = new URL(uri); return url.host || url.protocol.replace(/:$/, ""); } catch { return ""; }
}
