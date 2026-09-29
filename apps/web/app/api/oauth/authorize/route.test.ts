import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });
vi.mock("@/lib/auth/backend-session", () => ({ authenticatedBackendFetch: vi.fn(), applyRotatedSession: vi.fn() }));
import { authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { GET, POST } from "./route";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const QUERY = "response_type=code&client_id=c-1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&code_challenge=abc&code_challenge_method=S256&state=s1";
const headers = { host: "palm.wodana.app", "x-forwarded-proto": "https" };
const get = (query: string) => new Request(`http://localhost:3000/api/oauth/authorize?${query}`, { headers });
const post = (body: unknown, extra: Record<string, string> = { origin: "https://palm.wodana.app" }) =>
  new Request("http://localhost:3000/api/oauth/authorize", { method: "POST", headers: { ...headers, ...extra, "content-type": "application/json" }, body: JSON.stringify(body) });
const upstream = (status: number, body: unknown) => vi.mocked(authenticatedBackendFetch).mockResolvedValue({ upstream: new Response(JSON.stringify(body), { status }), unauthenticated: false });
const sent = () => {
  const [path, init] = vi.mocked(authenticatedBackendFetch).mock.calls[0];
  return { path, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
};
const valid = { query: QUERY, workspaceId, scopes: ["read", "write"], decision: "allow" };
beforeEach(() => vi.clearAllMocks());

describe("the AI app consent route", () => {
  it("asks Business Core about the OAuth query as it came, from the browser-facing host", async () => {
    upstream(200, { client: { id: "c-1", name: "Claude", uri: null }, redirectHost: "claude.ai", scopes: ["read"], workspaces: [] });
    const response = await GET(get(QUERY));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { path, headers: forwarded } = sent();
    expect(path).toBe(`/mcp/oauth/authorize?${QUERY}`);
    expect(forwarded).toMatchObject({ "x-forwarded-host": "palm.wodana.app", "x-forwarded-proto": "https" });
  });

  it("says when the person isn't signed in, and passes a refusal on with its code", async () => {
    vi.mocked(authenticatedBackendFetch).mockResolvedValue({ upstream: null, unauthenticated: true });
    expect((await GET(get(QUERY))).status).toBe(401);
    upstream(400, { message: "This AI app isn't registered.", code: "invalid_client" });
    const refused = await GET(get(QUERY));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ message: "This AI app isn't registered.", code: "invalid_client" });
    upstream(400, { message: "PKCE with S256 is required.", code: "invalid_request", redirectTo: "https://claude.ai/cb?error=invalid_request" });
    expect(await (await GET(get(QUERY))).json()).toEqual({ message: "PKCE with S256 is required.", code: "invalid_request", redirectTo: "https://claude.ai/cb?error=invalid_request" });
  });

  it("refuses an empty or oversized query before calling Business Core", async () => {
    expect((await GET(get(""))).status).toBe(400);
    expect((await GET(get(`state=${"x".repeat(4_001)}`))).status).toBe(400);
    expect(authenticatedBackendFetch).not.toHaveBeenCalled();
  });

  it("sends the decision with the workspace and access chosen", async () => {
    upstream(200, { redirectTo: "https://claude.ai/cb?code=xyz&state=s1" });
    const response = await POST(post(valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirectTo: "https://claude.ai/cb?code=xyz&state=s1" });
    expect(sent()).toMatchObject({ path: "/mcp/oauth/authorize", body: valid, headers: { "x-forwarded-host": "palm.wodana.app", "x-forwarded-proto": "https" } });
  });

  it("refuses another site, a bad workspace, unknown access and unknown decisions", async () => {
    expect((await POST(post(valid, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(post({ ...valid, workspaceId: "not-a-workspace" }))).status).toBe(400);
    expect((await POST(post({ ...valid, scopes: ["read", "admin"] }))).status).toBe(400);
    expect((await POST(post({ ...valid, scopes: [] }))).status).toBe(400);
    expect((await POST(post({ ...valid, scopes: ["read", "read"] }))).status).toBe(400);
    expect((await POST(post({ ...valid, decision: "maybe" }))).status).toBe(400);
    expect((await POST(post({ ...valid, query: "x".repeat(4_001) }))).status).toBe(400);
    expect(authenticatedBackendFetch).not.toHaveBeenCalled();
  });
});
