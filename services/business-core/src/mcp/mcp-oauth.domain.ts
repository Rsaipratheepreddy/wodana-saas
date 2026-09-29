import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AI apps through MCP (W-5): Wodana is the OAuth 2.1 authorization server for its own MCP endpoint.
 * Authorization code with PKCE (S256 only), dynamic client registration (RFC 7591), 1-hour access tokens and
 * 30-day refresh tokens replaced on every use. These are the pure rules; the service stores hashes only.
 */
export const MCP_SCOPES = ["read", "write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60;
/** Where the MCP endpoint lives on every host, under Business Core's API prefix. */
export const MCP_PATH = "/api/v1/mcp";

/** An OAuth error, answered in the RFC 6749 shape ({ error, error_description }). */
export class OAuthError extends Error {
  constructor(readonly error: string, readonly description: string, readonly status = 400) { super(description); this.name = "OAuthError"; }
  get body() { return { error: this.error, error_description: this.description }; }
}

// ---------- tokens ----------

type TokenKind = "at" | "rt" | "ac";
const TOKEN = /^wmcp_(at|rt|ac)_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;

/**
 * A token names its workspace (not a secret: a uuid without dashes) so it is looked up inside that workspace's
 * tenant transaction, under RLS, without any cross-tenant read. The 256 random bits are the secret.
 */
export function mintToken(kind: TokenKind, workspaceId: string): string {
  return `wmcp_${kind}_${workspaceId.replace(/-/g, "").toLowerCase()}_${randomBytes(32).toString("base64url")}`;
}

export function parseToken(value: unknown, kind: TokenKind): { workspaceId: string } | null {
  if (typeof value !== "string" || value.length > 200) return null;
  const match = TOKEN.exec(value);
  if (!match || match[1] !== kind) return null;
  const hex = match[2];
  return { workspaceId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` };
}

export const hashSecret = (value: string) => createHash("sha256").update(value).digest("hex");

export function sameHash(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

// ---------- PKCE ----------

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** RFC 7636 S256: base64url(sha256(verifier)) equals the challenge sent with the authorization request. */
export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== "string" || !VERIFIER.test(verifier) || !CHALLENGE.test(challenge)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

// ---------- scopes ----------

/**
 * The scopes asked for: "read" is always part of a grant; anything else than read and write is refused. An app
 * that names none asks for both (RFC 6749 §3.3 default), and the person chooses on the consent screen.
 */
export function parseScopes(scope: unknown): McpScope[] | null {
  if (scope !== undefined && scope !== null && typeof scope !== "string") return null;
  const asked = new Set(String(scope ?? "").split(/\s+/).filter(Boolean));
  if (!asked.size) return ["read", "write"];
  if ([...asked].some((item) => !(MCP_SCOPES as readonly string[]).includes(item))) return null;
  return asked.has("write") ? ["read", "write"] : ["read"];
}

/** What a person granted: never more than was asked, always read. */
export function grantedScopes(asked: readonly McpScope[], chosen: readonly string[]): McpScope[] {
  return asked.includes("write") && chosen.includes("write") ? ["read", "write"] : ["read"];
}

export const scopeText = (scopes: readonly string[]) => [...scopes].sort().join(" ");

// ---------- redirect URIs and registration ----------

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "ftp:", "ws:", "wss:"]);

/**
 * A redirect URI an app may register: https anywhere, http only on the loopback (native apps, RFC 8252), or an
 * app's own private scheme ("cursor://…"). Never a fragment, never credentials in the URL.
 */
export function validRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 500) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return Boolean(url.hostname);
  if (url.protocol === "http:") return LOOPBACK.has(url.hostname);
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return false;
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && url.protocol.length >= 4;
}

export type ClientRegistration = {
  clientName: string;
  clientUri: string | null;
  redirectUris: string[];
  authMethod: "none" | "client_secret_post" | "client_secret_basic";
  softwareId: string | null;
  softwareVersion: string | null;
};

const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/** RFC 7591 client metadata, checked: only what Wodana supports is accepted. */
export function readRegistration(body: unknown): ClientRegistration {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new OAuthError("invalid_client_metadata", "Send the client metadata as a JSON object.");
  const input = body as Record<string, unknown>;
  const redirectUris = Array.isArray(input.redirect_uris) ? [...new Set(input.redirect_uris)] : [];
  if (!redirectUris.length || redirectUris.length > 10) throw new OAuthError("invalid_redirect_uri", "Register between one and ten redirect URIs.");
  if (!redirectUris.every(validRedirectUri)) throw new OAuthError("invalid_redirect_uri", "Redirect URIs must use https, the loopback address, or the app's own scheme.");
  const authMethod = input.token_endpoint_auth_method ?? "none";
  if (authMethod !== "none" && authMethod !== "client_secret_post" && authMethod !== "client_secret_basic") {
    throw new OAuthError("invalid_client_metadata", "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.");
  }
  const grantTypes = input.grant_types ?? ["authorization_code"];
  if (!Array.isArray(grantTypes) || !grantTypes.every((grant) => grant === "authorization_code" || grant === "refresh_token") || !grantTypes.includes("authorization_code")) {
    throw new OAuthError("invalid_client_metadata", "Only the authorization_code and refresh_token grants are supported.");
  }
  const responseTypes = input.response_types ?? ["code"];
  if (!Array.isArray(responseTypes) || responseTypes.some((type) => type !== "code")) throw new OAuthError("invalid_client_metadata", "Only the code response type is supported.");
  if (input.scope !== undefined && parseScopes(input.scope) === null) throw new OAuthError("invalid_client_metadata", "Scopes are read and write.");
  const clientUri = text(input.client_uri, 500);
  if (clientUri && !/^https:\/\//i.test(clientUri)) throw new OAuthError("invalid_client_metadata", "client_uri must be an https address.");
  return {
    clientName: text(input.client_name, 120) ?? "AI app",
    clientUri,
    redirectUris: redirectUris as string[],
    authMethod,
    softwareId: text(input.software_id, 200),
    softwareVersion: text(input.software_version, 80),
  };
}

// ---------- the authorization request ----------

export type AuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: McpScope[];
  state: string | null;
  resource: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The query an app opens /oauth/authorize with, in two steps: the client and its redirect URI first (an error
 * there is shown, never redirected), then the rest (an error there goes back to the app).
 */
export function readAuthorizationClient(query: URLSearchParams): { clientId: string; redirectUri: string } {
  const clientId = query.get("client_id") ?? "";
  const redirectUri = query.get("redirect_uri") ?? "";
  if (!UUID.test(clientId)) throw new OAuthError("invalid_client", "This app is not registered. Connect it again from the app.");
  if (!validRedirectUri(redirectUri)) throw new OAuthError("invalid_request", "The app sent an address we can't return to.");
  return { clientId: clientId.toLowerCase(), redirectUri };
}

export function readAuthorizationRequest(query: URLSearchParams, client: { clientId: string; redirectUri: string }): AuthorizationRequest {
  if (query.get("response_type") !== "code") throw new OAuthError("unsupported_response_type", "Only the authorization code flow is supported.");
  const codeChallenge = query.get("code_challenge") ?? "";
  if (query.get("code_challenge_method") !== "S256" || !CHALLENGE.test(codeChallenge)) throw new OAuthError("invalid_request", "PKCE with S256 is required.");
  const scopes = parseScopes(query.get("scope") ?? undefined);
  if (!scopes) throw new OAuthError("invalid_scope", "Scopes are read and write.");
  const state = query.get("state");
  if (state && state.length > 1000) throw new OAuthError("invalid_request", "state is too long.");
  const resource = query.get("resource");
  if (resource !== null && !validResource(resource)) throw new OAuthError("invalid_target", "resource must be an absolute URL without a fragment.");
  return { ...client, codeChallenge, scopes, state: state || null, resource: resource ? canonicalResource(resource) : null };
}

function validResource(value: string) {
  if (value.length > 500) return false;
  try { const url = new URL(value); return (url.protocol === "https:" || url.protocol === "http:") && !url.hash; } catch { return false; }
}

/** A resource URL compared the way RFC 8707 clients send it: lower-case scheme and host, no trailing slash. */
export function canonicalResource(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch { return value; }
}

/** Where the app is sent back: the code (or the error), the app's state and this issuer (RFC 9207). */
export function redirectBack(redirectUri: string, values: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(values)) if (value !== null && value !== undefined) url.searchParams.set(name, value);
  return url.toString();
}

// ---------- the host a request came to ----------

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$|^\[[0-9a-f:]+\](?::\d{1,5})?$/i;

/**
 * The public origin the person or app used (https://<tenant>.wodana.ai): the Host nginx passes on, or the host
 * the web app forwarded for the metadata it proxies. Only a well-formed host is used; it only ever shapes the
 * addresses sent back to the same caller.
 */
export function requestOrigin(headers: Record<string, string | string[] | undefined>, options: { forwarded?: boolean } = {}): string | null {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.split(",")[0]?.trim() ?? "";
  const host = (options.forwarded ? first(headers["x-forwarded-host"]) : "") || first(headers.host);
  const proto = first(headers["x-forwarded-proto"]) || "http";
  if (!HOST.test(host) || (proto !== "https" && proto !== "http")) return null;
  return `${proto}://${host.toLowerCase()}`;
}

export const mcpResource = (origin: string) => `${origin}${MCP_PATH}`;

/** RFC 8414 metadata for the authorization server at this origin. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/v1/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/v1/mcp/oauth/register`,
    revocation_endpoint: `${origin}/api/v1/mcp/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [...MCP_SCOPES],
    authorization_response_iss_parameter_supported: true,
  };
}

/** RFC 9728 metadata for the MCP endpoint at this origin. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

export const protectedResourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;
