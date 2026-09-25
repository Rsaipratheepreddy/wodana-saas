import { afterEach, describe, expect, it, vi } from "vitest";
import { AiGatewayService } from "./ai-gateway.service";

const actor = {} as never;
function gateway(enabled: boolean) {
  const queries: string[] = [];
  const client = { query: vi.fn(async (sql: string) => { queries.push(sql); return sql.includes("FROM workspace_ai_settings") ? { rows: enabled ? [{ enabled: true }] : [] } : { rows: [] }; }) };
  const access = { withPermission: vi.fn(async (_a: unknown, _w: string, _p: string, work: (c: typeof client, u: { userId: string }) => unknown) => work(client, { userId: "u1" })) };
  return { service: new AiGatewayService(access as never), queries };
}
const answer = (text: string) => async () => new Response(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 120, output_tokens: 40 } }), { status: 200 });

describe("AI gateway", () => {
  afterEach(() => { delete process.env.ANTHROPIC_API_KEY; });
  it("refuses when the workspace has AI off, before any call", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const { service } = gateway(false);
    const fetcher = vi.fn();
    service.useFetcher(fetcher);
    await expect(service.run(actor, "w", { feature: "f", system: "s", prompt: "p", validate: (v) => v })).rejects.toThrow(/AI assistance is off/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("says it is not set up when no provider key exists", async () => {
    const { service } = gateway(true);
    await expect(service.run(actor, "w", { feature: "f", system: "s", prompt: "p", validate: (v) => v })).rejects.toThrow(/not set up/);
  });
  it("returns validated JSON (even inside code fences) and logs usage", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const { service, queries } = gateway(true);
    service.useFetcher(answer('```json\n{"rows":[{"line":1}]}\n```'));
    await expect(service.run(actor, "w", { feature: "catalog.import_clean", system: "s", prompt: "p", validate: (v) => (v as { rows: unknown[] }).rows.length })).resolves.toBe(1);
    expect(queries.some((sql) => sql.includes("INSERT INTO ai_usage_events"))).toBe(true);
  });
  it("rejects unreadable or unfitting answers without leaking them", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const { service } = gateway(true);
    service.useFetcher(answer("Sure! Here are your rows..."));
    await expect(service.run(actor, "w", { feature: "f", system: "s", prompt: "p", validate: (v) => v })).rejects.toThrow(/could not be read/);
    service.useFetcher(answer('{"rows":"nope"}'));
    await expect(service.run(actor, "w", { feature: "f", system: "s", prompt: "p", validate: () => { throw new Error("bad"); } })).rejects.toThrow(/did not fit/);
  });
});
