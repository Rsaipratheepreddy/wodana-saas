import { describe, expect, it } from "vitest";
import {
  aiConfigured, aiModelFor, aiProviderName, bedrockRegion, classifyBedrockError, outputCap, readConverse, readGemini, stripCodeFences, TextOnlyModelError, toConverse,
} from "./ai-provider";

describe("choosing the provider", () => {
  it("keeps today's behaviour when AI_PROVIDER is unset: Gemini when its key is set, otherwise nothing", () => {
    expect(aiProviderName({})).toBeNull();
    expect(aiProviderName({ GEMINI_API_KEY: "k" })).toBe("gemini");
    expect(aiModelFor("gemini", { GEMINI_API_KEY: "k" })).toBe("gemini-3.5-flash");
    expect(aiModelFor("gemini", { GEMINI_MODEL: "gemini-3.1-flash-lite" })).toBe("gemini-3.1-flash-lite");
    expect(aiConfigured({})).toBe(false);
  });

  it("uses Bedrock without a key, Nova Lite by default, in the configured region", () => {
    expect(aiProviderName({ AI_PROVIDER: "bedrock" })).toBe("bedrock");
    expect(aiConfigured({ AI_PROVIDER: " Bedrock " })).toBe(true);
    expect(aiModelFor("bedrock", {})).toBe("apac.amazon.nova-lite-v1:0");
    expect(aiModelFor("bedrock", { AI_MODEL: "apac.amazon.nova-micro-v1:0" })).toBe("apac.amazon.nova-micro-v1:0");
    expect(aiModelFor("bedrock", { AI_MODEL: "openai.gpt-oss-120b-1:0" })).toBe("openai.gpt-oss-120b-1:0");
    expect(bedrockRegion({ BEDROCK_REGION: "ap-south-1", AWS_REGION: "us-east-1" })).toBe("ap-south-1");
    expect(bedrockRegion({ AWS_REGION: "eu-west-1" })).toBe("eu-west-1");
    expect(bedrockRegion({})).toBe("ap-south-1");
  });

  it("does not fall back to Gemini when a key is missing or the provider is unknown", () => {
    expect(aiProviderName({ AI_PROVIDER: "gemini" })).toBeNull();
    expect(aiProviderName({ AI_PROVIDER: "other", GEMINI_API_KEY: "k" })).toBeNull();
    expect(aiModelFor("gemini", { AI_PROVIDER: "gemini", AI_MODEL: "gemini-3.1-flash-lite", GEMINI_MODEL: "gemini-3.5-flash" })).toBe("gemini-3.1-flash-lite");
  });
});

describe("the request in Converse terms", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
  const pdf = Buffer.from("%PDF-1.7").toString("base64");

  it("turns text and inline files into blocks, joins consecutive turns and starts with the person", () => {
    const input = toConverse({
      systemInstruction: { parts: [{ text: "Plan rooms." }, { text: "  " }] },
      contents: [
        { role: "model", parts: [{ text: "An opening the model said" }] },
        { role: "user", parts: [{ text: "Brief" }, { inlineData: { mimeType: "image/png", data: png } }] },
        { role: "user", parts: [{ text: "" }, { inlineData: { mimeType: "application/pdf", data: pdf } }, { text: "thinking", thought: true }] },
        { role: "model", parts: [{ text: "Noted." }] },
        { role: "user", parts: [{ text: "Go" }] },
      ],
      generationConfig: { maxOutputTokens: 2048 },
    }, "apac.amazon.nova-lite-v1:0", {});
    expect(input.system).toEqual([{ text: "Plan rooms." }]);
    expect(input.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(input.messages[0].content).toEqual([
      { text: "Brief" },
      { image: { format: "png", source: { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) } } },
      { document: { format: "pdf", name: "Reference 1", source: { bytes: new Uint8Array(Buffer.from("%PDF-1.7")) } } },
    ]);
    expect(input.inferenceConfig).toEqual({ maxTokens: 2048 });
  });

  it("asks for JSON in words, with the schema when one is given", () => {
    const schema = { type: "OBJECT", properties: { summary: { type: "STRING" } }, required: ["summary"] };
    const input = toConverse({ contents: [{ role: "user", parts: [{ text: "x" }] }], generationConfig: { responseMimeType: "application/json", responseSchema: schema } }, "apac.amazon.nova-lite-v1:0", {});
    expect(input.system?.[0].text).toBe(`Respond with one JSON value only: no prose before or after it, no Markdown, no code fences. The JSON must match this schema:\n${JSON.stringify(schema)}`);
  });

  it("refuses files for a text-only model and caps output per model", () => {
    const image = { contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: png } }] }] };
    expect(() => toConverse(image, "apac.amazon.nova-micro-v1:0", {})).toThrow(TextOnlyModelError);
    expect(() => toConverse(image, "openai.gpt-oss-120b-1:0", {})).toThrow(TextOnlyModelError);
    expect(outputCap("apac.amazon.nova-lite-v1:0", {})).toBe(10_000);
    expect(outputCap("apac.amazon.nova-lite-v1:0", { AI_MAX_OUTPUT_TOKENS: "5000" })).toBe(5000);
    expect(outputCap("something-new", {})).toBeNull();
    expect(toConverse({ contents: [{ role: "user", parts: [{ text: "x" }] }], generationConfig: { maxOutputTokens: 24_000 } }, "apac.amazon.nova-lite-v1:0", {}).inferenceConfig).toEqual({ maxTokens: 10_000 });
  });
});

describe("reading answers", () => {
  it("reads Converse text without reasoning, its stop reason and token use", () => {
    expect(readConverse({
      output: { message: { content: [{ reasoningContent: { reasoningText: { text: "private" } } }, { text: "First." }, { text: "Second." }] } },
      stopReason: "end_turn", usage: { inputTokens: 2000, outputTokens: 300, totalTokens: 2300 },
    }, "\n")).toEqual({ text: "First.\nSecond.", finishReason: "STOP", usage: { input_tokens: 2000, output_tokens: 300 } });
    expect(readConverse({ output: { message: { content: [] } }, stopReason: "max_tokens" }, "").finishReason).toBe("MAX_TOKENS");
    expect(readConverse({ stopReason: "guardrail_intervened" }, "").finishReason).toBe("SAFETY");
    expect(readConverse(null, "")).toEqual({ text: "", finishReason: null, usage: { input_tokens: 0, output_tokens: 0 } });
  });

  it("reads Gemini's token use", () => {
    expect(readGemini({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "a", thought: true }, { text: "b" }] } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 } }, ""))
      .toEqual({ text: "b", finishReason: "STOP", usage: { input_tokens: 120, output_tokens: 40 } });
  });

  it("strips code fences around JSON", () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });

  it("sorts Bedrock errors into throttled, temporary, denied and failed", () => {
    expect(classifyBedrockError({ name: "ThrottlingException" })).toBe("throttled");
    expect(classifyBedrockError({ name: "ServiceUnavailableException" })).toBe("temporary");
    expect(classifyBedrockError({ name: "AccessDeniedException" })).toBe("denied");
    expect(classifyBedrockError({ name: "ValidationException" })).toBe("failed");
    expect(classifyBedrockError(new TypeError("fetch failed"))).toBe("failed");
  });
});
