import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/backend-session", () => ({ authenticatedBackendFetch: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ businessApiUrl: (path: string) => `http://core/api/v1${path}` }));
import { authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { askWoddy } from "@/lib/crm/woddy.server";
import { generateThroughGateway, refusalOf } from "./gateway.server";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const request = { contents: [{ role: "user", parts: [{ text: "facts" }] }] };
const reply = (body: unknown, status = 200) => ({ upstream: new Response(JSON.stringify(body), { status }), unauthenticated: status === 401 });

afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe("the web assistants' AI gateway (W-0)", () => {
  it("asks Business Core, never the provider, and returns the answer", async () => {
    vi.mocked(authenticatedBackendFetch).mockResolvedValue(reply({ text: "Call Maya.", finishReason: "STOP", model: "gemini" }));
    await expect(generateThroughGateway(workspaceId, "crm.chat", request)).resolves.toMatchObject({ ok: true, text: "Call Maya.", finishReason: "STOP" });
    const [path, init] = vi.mocked(authenticatedBackendFetch).mock.calls[0];
    expect(path).toBe(`/workspaces/${workspaceId}/ai/generate`);
    expect(JSON.parse(String(init?.body))).toEqual({ feature: "crm.chat", request, timeoutMs: 30_000 });
  });

  it("uses a session rotated earlier in the same request instead of refreshing again", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ text: "ok", finishReason: "STOP", model: "m" })));
    vi.stubGlobal("fetch", fetcher);
    await generateThroughGateway(workspaceId, "crm.assist", request, { accessToken: "rotated" });
    expect(authenticatedBackendFetch).not.toHaveBeenCalled();
    expect(new Headers((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get("authorization")).toBe("Bearer rotated");
  });

  it("names why the gateway refused", async () => {
    expect(refusalOf(503, { code: "AI_OFF" })).toBe("off");
    expect(refusalOf(503, { code: "AI_NOT_CONFIGURED" })).toBe("not-configured");
    expect(refusalOf(403, {})).toBe("no-access");
    expect(refusalOf(429, { code: "AI_RATE_LIMITED" })).toBe("rate-limited");
    expect(refusalOf(503, null)).toBe("unavailable");
    vi.mocked(authenticatedBackendFetch).mockResolvedValue(reply({ message: "off", code: "AI_OFF" }, 503));
    await expect(askWoddy(workspaceId, {}, [{ role: "user", text: "Hi" }])).rejects.toThrow("Woddy is off for this workspace. An admin can turn AI on in Settings.");
  });

  it("no web code calls the model provider or holds its key", () => {
    const root = join(__dirname, "../..");
    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const name of readdirSync(directory)) {
        if (["node_modules", ".next", "e2e"].includes(name)) continue;
        const path = join(directory, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && /generativelanguage\.googleapis|GEMINI_API_KEY/.test(readFileSync(path, "utf8"))) offenders.push(path.slice(root.length + 1));
      }
    };
    for (const folder of ["app", "lib", "components"]) walk(join(root, folder));
    expect(offenders).toEqual([]);
  });
});
