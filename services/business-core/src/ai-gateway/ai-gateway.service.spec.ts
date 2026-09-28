import { afterEach, describe, expect, it, vi } from "vitest";
import { AiGatewayService } from "./ai-gateway.service";

const actor = {} as never;
function gateway(enabled: boolean) {
  const queries: string[] = [];
  const client = { query: vi.fn(async (sql: string) => { queries.push(sql); return sql.includes("FROM workspace_ai_settings") ? { rows: enabled ? [{ enabled: true }] : [] } : { rows: [] }; }) };
  const access = { withPermission: vi.fn(async (_a: unknown, _w: string, _p: string, work: (c: typeof client, u: { userId: string }) => unknown) => work(client, { userId: "u1" })) };
  return { service: new AiGatewayService(access as never), queries };
}
const answer = (text: string, finishReason = "STOP") => async () => new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text: "thinking…", thought: true }, { text }] } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 } }), { status: 200 });

describe("AI gateway", () => {
  afterEach(() => { delete process.env.GEMINI_API_KEY; });
  it("refuses when the workspace has AI off, before any call", async () => {
    process.env.GEMINI_API_KEY = "test";
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
    process.env.GEMINI_API_KEY = "test";
    const { service, queries } = gateway(true);
    service.useFetcher(answer('```json\n{"rows":[{"line":1}]}\n```'));
    await expect(service.run(actor, "w", { feature: "catalog.import_clean", system: "s", prompt: "p", validate: (v) => (v as { rows: unknown[] }).rows.length })).resolves.toBe(1);
    expect(queries.some((sql) => sql.includes("INSERT INTO ai_usage_events"))).toBe(true);
  });
  it("rejects unreadable or unfitting answers without leaking them", async () => {
    process.env.GEMINI_API_KEY = "test";
    const { service } = gateway(true);
    service.useFetcher(answer("Sure! Here are your rows..."));
    await expect(service.run(actor, "w", { feature: "f", system: "s", prompt: "p", validate: (v) => v })).rejects.toThrow(/could not be read/);
    service.useFetcher(answer('{"rows":"nope"}'));
    await expect(service.run(actor, "w", { feature: "f", system: "s", prompt: "p", validate: () => { throw new Error("bad"); } })).rejects.toThrow(/did not fit/);
    service.useFetcher(answer('{"rows":[', "MAX_TOKENS"));
    await expect(service.run(actor, "w", { feature: "f", system: "s", prompt: "p", validate: (v) => v })).rejects.toThrow(/cut short/);
  });
});

describe("AI gateway for the web assistants (W-0)", () => {
  afterEach(() => { delete process.env.GEMINI_API_KEY; });
  const request = { systemInstruction: { parts: [{ text: "You are Woddy" }] }, contents: [{ role: "user", parts: [{ text: "facts" }] }], generationConfig: { maxOutputTokens: 100 } };

  it("never calls the provider when the workspace switched AI off", async () => {
    process.env.GEMINI_API_KEY = "test";
    const { service } = gateway(false);
    const fetcher = vi.fn();
    service.useFetcher(fetcher);
    await expect(service.generate(actor, "w", { feature: "crm.chat", request })).rejects.toThrow(/AI assistance is off/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("passes the assistant's request through, returns the answer's text and logs the call", async () => {
    process.env.GEMINI_API_KEY = "test";
    const { service, queries } = gateway(true);
    const fetcher = vi.fn(answer("Call Maya tomorrow."));
    service.useFetcher(fetcher);
    await expect(service.generate(actor, "w", { feature: "crm.chat", request })).resolves.toMatchObject({ text: "Call Maya tomorrow.", finishReason: "STOP" });
    // The deployment's model decides how it thinks.
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ ...request, generationConfig: { ...request.generationConfig, thinkingConfig: { thinkingLevel: "low" } } });
    expect(queries.some((sql) => sql.includes("INSERT INTO ai_usage_events"))).toBe(true);
  });

  it("refuses tools or anything beyond the prompt, and unknown features", async () => {
    process.env.GEMINI_API_KEY = "test";
    const { service } = gateway(true);
    await expect(service.generate(actor, "w", { feature: "crm.chat", request: { ...request, tools: [{}] } })).rejects.toThrow(/only/);
    await expect(service.generate(actor, "w", { feature: "anything", request })).rejects.toThrow(/Unknown AI feature/);
  });

  it("limits each workspace per feature per minute", async () => {
    process.env.GEMINI_API_KEY = "test";
    const { service } = gateway(true);
    service.useFetcher(answer("ok"));
    for (let call = 0; call < 5; call++) await service.generate(actor, "w-limit", { feature: "quotation.plan", request });
    await expect(service.generate(actor, "w-limit", { feature: "quotation.plan", request })).rejects.toThrow(/wait a minute/);
    await expect(service.generate(actor, "w-other", { feature: "quotation.plan", request })).resolves.toMatchObject({ text: "ok" });
  });

  it("retries the long quotation plan once when the provider is briefly unavailable", async () => {
    process.env.GEMINI_API_KEY = "test";
    const { service } = gateway(true);
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockImplementationOnce(answer("{}"));
    service.useFetcher(fetcher);
    await expect(service.generate(actor, "w-retry", { feature: "quotation.plan", request, timeoutMs: 20_000 })).resolves.toMatchObject({ text: "{}" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
