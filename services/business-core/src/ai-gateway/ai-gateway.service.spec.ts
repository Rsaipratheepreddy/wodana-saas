import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ai-credits", async (original) => ({
  ...await original<typeof import("./ai-credits")>(),
  checkCredits: vi.fn(async () => null),
  chargeUsage: vi.fn(async () => null),
}));
import { chargeUsage, checkCredits } from "./ai-credits";
import { AiGatewayService } from "./ai-gateway.service";

const actor = {} as never;
function gateway(enabled: boolean) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const client = { query: vi.fn(async (sql: string, values: unknown[] = []) => { queries.push({ sql, values }); return sql.includes("FROM workspace_ai_settings") ? { rows: enabled ? [{ enabled: true }] : [] } : { rows: [] }; }) };
  const access = { withPermission: vi.fn(async (_a: unknown, _w: string, _p: string, work: (c: typeof client, u: { userId: string }) => unknown) => work(client, { userId: "u1" })) };
  return { service: new AiGatewayService(access as never), queries, logged: () => queries.filter((query) => query.sql.includes("INSERT INTO ai_usage_events")) };
}
const answer = (text: string, finishReason = "STOP") => async () => new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text: "thinking…", thought: true }, { text }] } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 } }), { status: 200 });
const converse = (text: string, stopReason = "end_turn") => ({ output: { message: { role: "assistant", content: [{ reasoningContent: { reasoningText: { text: "hmm" } } }, { text }] } }, stopReason, usage: { inputTokens: 2000, outputTokens: 300, totalTokens: 2300 } });
const awsError = (name: string) => Object.assign(new Error(`${name} from AWS`), { name });

const ENV = ["GEMINI_API_KEY", "GEMINI_MODEL", "AI_PROVIDER", "AI_MODEL", "BEDROCK_REGION", "AWS_REGION"];
beforeEach(() => { vi.mocked(checkCredits).mockResolvedValue(null); vi.mocked(chargeUsage).mockClear(); });
afterEach(() => { for (const key of ENV) delete process.env[key]; });

describe("AI gateway", () => {
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
    const { service, logged } = gateway(true);
    service.useFetcher(answer('```json\n{"rows":[{"line":1}]}\n```'));
    await expect(service.run(actor, "w", { feature: "catalog.import_clean", system: "s", prompt: "p", validate: (v) => (v as { rows: unknown[] }).rows.length })).resolves.toBe(1);
    expect(logged()[0].values).toEqual([expect.any(String), "w", "catalog.import_clean", "gemini", "gemini-3.5-flash", 120, 40, "ok", expect.any(Number), "u1"]);
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
    const { service, logged } = gateway(true);
    const fetcher = vi.fn(answer("Call Maya tomorrow."));
    service.useFetcher(fetcher);
    await expect(service.generate(actor, "w", { feature: "crm.chat", request })).resolves.toMatchObject({ text: "Call Maya tomorrow.", finishReason: "STOP", provider: "gemini" });
    // The deployment's model decides how it thinks.
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ ...request, generationConfig: { ...request.generationConfig, thinkingConfig: { thinkingLevel: "low" } } });
    expect(logged()).toHaveLength(1);
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

describe("AI gateway on Amazon Bedrock", () => {
  const woddy = {
    systemInstruction: { parts: [{ text: "You are Woddy" }] },
    contents: [
      { role: "user", parts: [{ text: "facts" }] },
      { role: "model", parts: [{ text: "I will use this context." }] },
      { role: "user", parts: [{ text: "What next?" }] },
    ],
    generationConfig: { maxOutputTokens: 4096, temperature: 0.2 },
  };
  const bedrock = (reply: unknown | (() => Promise<unknown>)) => {
    const send = vi.fn(typeof reply === "function" ? reply as () => Promise<unknown> : async () => reply);
    return { send, input: (call = 0) => (send.mock.calls[call] as unknown as [{ input: Record<string, unknown> }])[0].input };
  };

  it("needs no key: the host's AWS role is the credential", async () => {
    process.env.AI_PROVIDER = "bedrock";
    expect(new AiGatewayService({} as never).configured).toBe(true);
  });

  it("sends Converse with the system, alternating turns and limits, and charges the provider's token count", async () => {
    process.env.AI_PROVIDER = "bedrock";
    const { service, logged } = gateway(true);
    const client = bedrock(converse("Call Maya tomorrow."));
    service.useBedrock(client);
    await expect(service.generate(actor, "w", { feature: "crm.chat", request: woddy })).resolves.toEqual({ text: "Call Maya tomorrow.", finishReason: "STOP", model: "apac.amazon.nova-lite-v1:0", provider: "bedrock" });
    expect(client.input()).toEqual({
      modelId: "apac.amazon.nova-lite-v1:0",
      system: [{ text: "You are Woddy" }],
      messages: [
        { role: "user", content: [{ text: "facts" }] },
        { role: "assistant", content: [{ text: "I will use this context." }] },
        { role: "user", content: [{ text: "What next?" }] },
      ],
      inferenceConfig: { maxTokens: 4096, temperature: 0.2 },
    });
    expect(logged()[0].values.slice(2, 8)).toEqual(["crm.chat", "bedrock", "apac.amazon.nova-lite-v1:0", 2000, 300, "ok"]);
    expect(chargeUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ workspaceId: "w", model: "apac.amazon.nova-lite-v1:0", feature: "crm.chat", usage: { input_tokens: 2000, output_tokens: 300 }, userId: "u1" }));
  });

  it("asks for JSON in words and reads a fenced answer for the JSON callers", async () => {
    process.env.AI_PROVIDER = "bedrock";
    process.env.AI_MODEL = "apac.amazon.nova-micro-v1:0";
    const { service } = gateway(true);
    const client = bedrock(converse('```json\n{"rows":[1,2]}\n```'));
    service.useBedrock(client);
    await expect(service.run(actor, "w", { feature: "quotation.draft", system: "Draft rooms.", prompt: "p", maxTokens: 12_000, validate: (v) => (v as { rows: number[] }).rows })).resolves.toEqual([1, 2]);
    const input = client.input() as { system: Array<{ text: string }>; inferenceConfig: { maxTokens: number; temperature: number } };
    expect(input.system[0].text).toMatch(/Respond with one JSON value only/);
    // Nova writes at most 10,000 tokens: a larger request is lowered to it.
    expect(input.inferenceConfig).toEqual({ maxTokens: 10_000, temperature: 0 });
  });

  it("charges nothing for a failed call", async () => {
    process.env.AI_PROVIDER = "bedrock";
    const { service, logged } = gateway(true);
    service.useBedrock(bedrock(async () => { throw awsError("ValidationException"); }));
    await expect(service.generate(actor, "w", { feature: "crm.chat", request: woddy })).rejects.toThrow(/did not answer/);
    expect(logged()[0].values[7]).toBe("failed");
    expect(chargeUsage).not.toHaveBeenCalled();
  });

  it("says try again later when Bedrock throttles, and not available when the role may not call the model", async () => {
    process.env.AI_PROVIDER = "bedrock";
    const { service } = gateway(true);
    service.useBedrock(bedrock(async () => { throw awsError("ThrottlingException"); }));
    await expect(service.generate(actor, "w", { feature: "crm.chat", request: woddy })).rejects.toMatchObject({ status: 429, response: { code: "AI_PROVIDER_BUSY" } });
    service.useBedrock(bedrock(async () => { throw awsError("AccessDeniedException"); }));
    await expect(service.generate(actor, "w", { feature: "crm.chat", request: woddy })).rejects.toMatchObject({ status: 503, response: { code: "AI_NOT_AVAILABLE" } });
  });

  it("retries the long plan once after a throttle", async () => {
    process.env.AI_PROVIDER = "bedrock";
    const { service } = gateway(true);
    const client = bedrock(async () => converse("{}"));
    client.send.mockRejectedValueOnce(awsError("ThrottlingException"));
    service.useBedrock(client);
    await expect(service.generate(actor, "w-plan", { feature: "quotation.plan", request: woddy, timeoutMs: 20_000 })).resolves.toMatchObject({ text: "{}" });
    expect(client.send).toHaveBeenCalledTimes(2);
  });
});

describe("AI credits at the gateway", () => {
  const request = { contents: [{ role: "user", parts: [{ text: "facts" }] }] };

  it("refuses with 402 when credits are used up, before any model call", async () => {
    process.env.AI_PROVIDER = "bedrock";
    vi.mocked(checkCredits).mockResolvedValue("exhausted");
    const { service, logged } = gateway(true);
    const client = { send: vi.fn() };
    service.useBedrock(client);
    await expect(service.generate(actor, "w", { feature: "crm.chat", request })).rejects.toMatchObject({
      status: 402, response: { message: "AI credits are used up. Ask your admin to top up.", code: "AI_CREDITS_EXHAUSTED" } });
    await expect(service.run(actor, "w", { feature: "quotation.draft", system: "s", prompt: "p", validate: (v) => v })).rejects.toMatchObject({ status: 402 });
    expect(client.send).not.toHaveBeenCalled();
    expect(logged()).toHaveLength(0);
  });

  it("refuses for the rest of the day when a daily cap is reached", async () => {
    process.env.AI_PROVIDER = "bedrock";
    const { service } = gateway(true);
    vi.mocked(checkCredits).mockResolvedValue("workspace_daily");
    await expect(service.generate(actor, "w", { feature: "crm.chat", request })).rejects.toMatchObject({ status: 429, response: { code: "AI_WORKSPACE_DAILY_LIMIT" } });
    vi.mocked(checkCredits).mockResolvedValue("platform_daily");
    await expect(service.generate(actor, "w", { feature: "crm.chat", request })).rejects.toMatchObject({ status: 429, response: { code: "AI_PLATFORM_DAILY_LIMIT" } });
  });

  it("charges an answer that was cut short or empty nothing", async () => {
    process.env.AI_PROVIDER = "bedrock";
    const { service } = gateway(true);
    service.useBedrock({ send: vi.fn(async () => converse("partial", "max_tokens")) });
    await expect(service.generate(actor, "w", { feature: "crm.chat", request })).resolves.toMatchObject({ finishReason: "MAX_TOKENS" });
    expect(chargeUsage).not.toHaveBeenCalled();
  });
});
