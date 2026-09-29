import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authorizationServerMetadata, canonicalResource, grantedScopes, mintToken, OAuthError, parseScopes, parseToken, protectedResourceMetadata, readAuthorizationClient,
  readAuthorizationRequest, readRegistration, redirectBack, requestOrigin, validRedirectUri, verifyPkce,
} from "./mcp-oauth.domain";
import { redirectMatches } from "./mcp-oauth.service";

const WS = "11111111-1111-4111-8111-111111111111";
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = createHash("sha256").update(verifier).digest("base64url");

describe("PKCE (S256)", () => {
  it("accepts the verifier whose hash is the challenge, and nothing else", () => {
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(`${verifier.slice(0, -1)}l`, challenge)).toBe(false);
    expect(verifyPkce(undefined, challenge)).toBe(false);
    // A verifier must be 43–128 unreserved characters; the challenge itself is not a verifier.
    expect(verifyPkce("short", challenge)).toBe(false);
    expect(verifyPkce(challenge, challenge)).toBe(false);
  });
});

describe("tokens", () => {
  it("name their workspace and kind, carry 256 random bits and parse only as their own kind", () => {
    const access = mintToken("at", WS);
    expect(access).toMatch(/^wmcp_at_11111111111141118111111111111111_[A-Za-z0-9_-]{43}$/);
    expect(parseToken(access, "at")).toEqual({ workspaceId: WS });
    expect(parseToken(access, "rt")).toBeNull();
    expect(mintToken("at", WS)).not.toBe(access);
    expect(parseToken("wmcp_at_nothex_x", "at")).toBeNull();
    expect(parseToken(42, "at")).toBeNull();
  });
});

describe("scopes", () => {
  it("always include read, refuse unknown scopes, and never grant more than was asked", () => {
    // Naming none asks for both; the person chooses on the consent screen.
    expect(parseScopes(undefined)).toEqual(["read", "write"]);
    expect(parseScopes("read")).toEqual(["read"]);
    expect(parseScopes("write")).toEqual(["read", "write"]);
    expect(parseScopes("read write")).toEqual(["read", "write"]);
    expect(parseScopes("read admin")).toBeNull();
    expect(grantedScopes(["read", "write"], ["read"])).toEqual(["read"]);
    expect(grantedScopes(["read"], ["read", "write"])).toEqual(["read"]);
    expect(grantedScopes(["read", "write"], ["write"])).toEqual(["read", "write"]);
  });
});

describe("redirect URIs and registration", () => {
  it("allow https, loopback http and an app's own scheme; never script, data or other http", () => {
    expect(validRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(validRedirectUri("http://127.0.0.1:33418/callback")).toBe(true);
    expect(validRedirectUri("http://localhost/callback")).toBe(true);
    expect(validRedirectUri("cursor://anysphere.cursor-retrieval/oauth/callback")).toBe(true);
    expect(validRedirectUri("http://evil.example/callback")).toBe(false);
    expect(validRedirectUri("javascript:alert(1)")).toBe(false);
    expect(validRedirectUri("https://claude.ai/cb#fragment")).toBe(false);
    expect(validRedirectUri("https://user:pass@claude.ai/cb")).toBe(false);
  });

  it("matches a loopback redirect on any port, everything else exactly", () => {
    expect(redirectMatches("http://127.0.0.1/callback", "http://127.0.0.1:53123/callback")).toBe(true);
    expect(redirectMatches("http://127.0.0.1/callback", "http://127.0.0.1:53123/other")).toBe(false);
    expect(redirectMatches("https://claude.ai/cb", "https://claude.ai/cb")).toBe(true);
    expect(redirectMatches("https://claude.ai/cb", "https://claude.ai/cb2")).toBe(false);
    expect(redirectMatches("https://claude.ai/cb", null)).toBe(false);
  });

  it("reads RFC 7591 metadata and refuses what Wodana does not support", () => {
    expect(readRegistration({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] }))
      .toMatchObject({ clientName: "Claude", authMethod: "none", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] });
    expect(() => readRegistration({ redirect_uris: [] })).toThrow(OAuthError);
    expect(() => readRegistration({ redirect_uris: ["http://evil.example/cb"] })).toThrow(/https, the loopback/);
    expect(() => readRegistration({ redirect_uris: ["https://a.example/cb"], grant_types: ["client_credentials"] })).toThrow(/authorization_code/);
    expect(() => readRegistration({ redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "private_key_jwt" })).toThrow(/token_endpoint_auth_method/);
    expect(readRegistration({ redirect_uris: ["https://a.example/cb"] }).clientName).toBe("AI app");
  });
});

describe("the authorization request", () => {
  const query = (extra: Record<string, string> = {}) => new URLSearchParams({
    response_type: "code", client_id: "22222222-2222-4222-8222-222222222222", redirect_uri: "https://claude.ai/cb",
    code_challenge: challenge, code_challenge_method: "S256", scope: "read write", state: "xyz", resource: "https://palm.wodana.ai/api/v1/mcp/", ...extra,
  });

  it("needs a registered-looking client and a safe redirect first, then the code flow with S256", () => {
    const client = readAuthorizationClient(query());
    expect(readAuthorizationRequest(query(), client)).toEqual({
      clientId: "22222222-2222-4222-8222-222222222222", redirectUri: "https://claude.ai/cb", codeChallenge: challenge,
      scopes: ["read", "write"], state: "xyz", resource: "https://palm.wodana.ai/api/v1/mcp",
    });
    expect(() => readAuthorizationClient(query({ client_id: "nope" }))).toThrow(/not registered/);
    expect(() => readAuthorizationRequest(query({ code_challenge_method: "plain" }), client)).toThrow(/S256/);
    expect(() => readAuthorizationRequest(query({ response_type: "token" }), client)).toThrow(OAuthError);
    expect(() => readAuthorizationRequest(query({ scope: "admin" }), client)).toThrow(/Scopes/);
  });

  it("answers back to the app with the code (or error), its state and the issuer", () => {
    const back = new URL(redirectBack("https://claude.ai/cb?x=1", { code: "c", state: "s", iss: "https://palm.wodana.ai", error: null }));
    expect(Object.fromEntries(back.searchParams)).toEqual({ x: "1", code: "c", state: "s", iss: "https://palm.wodana.ai" });
  });
});

describe("the host and its metadata", () => {
  it("uses the host nginx passes on (or the one the web app forwards), refusing malformed ones", () => {
    expect(requestOrigin({ host: "palm.wodana.ai", "x-forwarded-proto": "https" })).toBe("https://palm.wodana.ai");
    expect(requestOrigin({ host: "127.0.0.1:3000", "x-forwarded-host": "palm.wodana.ai", "x-forwarded-proto": "https" }, { forwarded: true })).toBe("https://palm.wodana.ai");
    expect(requestOrigin({ host: "127.0.0.1:3000", "x-forwarded-host": "palm.wodana.ai" })).toBe("http://127.0.0.1:3000");
    expect(requestOrigin({ host: "evil.com/\"><script>" })).toBeNull();
    expect(requestOrigin({ host: "palm.wodana.ai", "x-forwarded-proto": "gopher" })).toBeNull();
  });

  it("points apps at the endpoints on the same host", () => {
    const origin = "https://palm.wodana.ai";
    expect(authorizationServerMetadata(origin)).toMatchObject({
      issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/api/v1/mcp/oauth/token`,
      registration_endpoint: `${origin}/api/v1/mcp/oauth/register`, code_challenge_methods_supported: ["S256"], scopes_supported: ["read", "write"],
    });
    expect(protectedResourceMetadata(origin)).toMatchObject({ resource: `${origin}/api/v1/mcp`, authorization_servers: [origin] });
    expect(canonicalResource("HTTPS://Palm.Wodana.ai/api/v1/mcp/")).toBe("https://palm.wodana.ai/api/v1/mcp");
  });
});
