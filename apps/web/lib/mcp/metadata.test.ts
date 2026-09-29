import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GET as authorizationServer } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as protectedResource } from "@/app/.well-known/oauth-protected-resource/[[...resource]]/route";

const metadata = { issuer: "https://palm.wodana.app", authorization_endpoint: "https://palm.wodana.app/oauth/authorize" };
const request = (path: string, headers: Record<string, string> = { host: "palm.wodana.app", "x-forwarded-proto": "https" }) => new Request(`http://127.0.0.1:3000${path}`, { headers });
const resource = (segments?: string[]) => ({ params: Promise.resolve(segments ? { resource: segments } : {}) });

afterEach(() => vi.unstubAllGlobals());

describe("OAuth metadata for AI apps", () => {
  it("serves the authorization server's metadata from Business Core, named after the browser-facing host", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(metadata), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await authorizationServer(request("/.well-known/oauth-authorization-server"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(metadata);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/mcp\/oauth\/authorization-server$/);
    expect(init.headers).toMatchObject({ "x-forwarded-host": "palm.wodana.app", "x-forwarded-proto": "https" });
  });

  it("serves the protected resource's metadata for the host and the MCP endpoint only", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ resource: "https://palm.wodana.app/api/v1/mcp" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect((await protectedResource(request("/.well-known/oauth-protected-resource"), resource())).status).toBe(200);
    expect((await protectedResource(request("/.well-known/oauth-protected-resource/api/v1/mcp"), resource(["api", "v1", "mcp"]))).status).toBe(200);
    expect((await protectedResource(request("/.well-known/oauth-protected-resource/admin"), resource(["admin"]))).status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toMatch(/\/mcp\/oauth\/protected-resource$/);
  });

  it("uses the request's own scheme without a proxy, and passes Business Core's status on", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "server_error" }), { status: 500 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await authorizationServer(request("/.well-known/oauth-authorization-server", { host: "localhost:3000" }));
    expect(response.status).toBe(500);
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ "x-forwarded-host": "localhost:3000", "x-forwarded-proto": "http" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect((await authorizationServer(request("/.well-known/oauth-authorization-server"))).status).toBe(503);
  });
});
