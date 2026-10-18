/**
 * The model providers behind the AI gateway. Every caller builds one request shape (system instruction,
 * contents with text and inline file parts, generation settings); this file sends it to the deployment's
 * provider and reads back the text, the finish reason and the provider's own token count.
 *
 * AI_PROVIDER=bedrock uses Amazon Bedrock's Converse API with the host's AWS role (no key).
 * AI_PROVIDER=gemini (or unset, when GEMINI_API_KEY is set) uses Google's Gemini API.
 */

export type AiProviderName = "bedrock" | "gemini";
export type AiUsage = { input_tokens: number; output_tokens: number };
export type ProviderAnswer = { text: string; finishReason: string | null; usage: AiUsage };
// Agent turns (W-1): tools are declared once in Gemini's shape and translated for Converse (toolConfig,
// toolUse, toolResult); a turn's calls and the model's own content are read back by readConverseTurn and
// readGeminiTurn.

type Part = {
  text?: unknown; thought?: unknown; inlineData?: { mimeType?: unknown; data?: unknown };
  functionCall?: { id?: unknown; name?: unknown; args?: unknown }; functionResponse?: { id?: unknown; name?: unknown; response?: unknown };
};
type Content = { role?: unknown; parts?: unknown };
/**
 * A tool the model may call (W-1), in Gemini's function-declaration shape; Converse gets it as a toolSpec.
 * `parameters` is a JSON schema kept to the subset both providers read: type, description, properties,
 * required, items, enum, minItems and maxItems.
 */
export type ToolDeclaration = { name: string; description: string; parameters: Record<string, unknown> };
/** A tool call the model asked for. `id` is the provider's own (Converse always sends one; Gemini may). */
export type ToolCall = { id?: string; name: string; args: Record<string, unknown> };
/**
 * The request every assistant builds: systemInstruction, contents and generationConfig. An agent turn adds
 * `tools`; its contents then carry `functionCall` parts (the model's) and `functionResponse` parts (the results).
 */
export type ModelRequest = {
  systemInstruction?: unknown; contents: unknown[]; generationConfig?: Record<string, unknown>;
  tools?: Array<{ functionDeclarations: ToolDeclaration[] }>;
};
/** One agent turn read back: the text, the calls, and the model's own content to send back next turn. */
export type ProviderTurn = ProviderAnswer & { calls: ToolCall[]; parts: unknown[] };

type Env = Record<string, string | undefined>;

export const DEFAULT_BEDROCK_MODEL = "apac.amazon.nova-lite-v1:0";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

/** Which provider this deployment uses, or null when AI is not set up. */
export function aiProviderName(env: Env = process.env): AiProviderName | null {
  const chosen = env.AI_PROVIDER?.trim().toLowerCase();
  if (chosen === "bedrock") return "bedrock";
  if (!chosen || chosen === "gemini") return env.GEMINI_API_KEY?.trim() ? "gemini" : null;
  return null;
}

/** The model id the deployment calls. */
export function aiModelFor(provider: AiProviderName, env: Env = process.env): string {
  if (provider === "bedrock") return env.AI_MODEL?.trim() || DEFAULT_BEDROCK_MODEL;
  const explicit = env.AI_PROVIDER?.trim().toLowerCase() === "gemini" ? env.AI_MODEL?.trim() : "";
  return explicit || env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

export function bedrockRegion(env: Env = process.env) {
  return env.BEDROCK_REGION?.trim() || env.AWS_REGION?.trim() || "ap-south-1";
}

/** Whether the deployment can call a model at all (the per-workspace switch comes on top). */
export function aiConfigured(env: Env = process.env) {
  return aiProviderName(env) !== null;
}

/** Models that read text only: a request with images or documents is refused before it is sent. */
const TEXT_ONLY = /nova-micro|gpt-oss/i;
/** The most each model family writes in one answer; a larger request is lowered to it. */
const OUTPUT_CAPS: Array<[RegExp, number]> = [
  [/amazon\.nova-(micro|lite|pro)-v1/i, 10_000],
  [/amazon\.nova-2-lite/i, 32_000],
  [/gpt-oss/i, 32_000],
  [/claude-haiku-4-5/i, 32_000],
];

export function outputCap(model: string, env: Env = process.env): number | null {
  const override = Number.parseInt(env.AI_MAX_OUTPUT_TOKENS ?? "", 10);
  if (Number.isInteger(override) && override > 0) return override;
  return OUTPUT_CAPS.find(([pattern]) => pattern.test(model))?.[1] ?? null;
}

export class TextOnlyModelError extends Error {
  constructor() { super("The AI model in use reads text only"); this.name = "TextOnlyModelError"; }
}

const IMAGE_FORMATS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpeg", "image/jpg": "jpeg", "image/gif": "gif", "image/webp": "webp" };
const DOCUMENT_FORMATS: Record<string, string> = {
  "application/pdf": "pdf", "text/csv": "csv", "text/plain": "txt", "text/markdown": "md", "text/html": "html",
  "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

type ConverseBlock =
  | { text: string }
  | { image: { format: string; source: { bytes: Uint8Array } } }
  | { document: { format: string; name: string; source: { bytes: Uint8Array } } }
  | { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }
  | { toolResult: { toolUseId: string; content: Array<{ text: string }>; status?: "success" | "error" } };
export type ConverseInput = {
  modelId: string;
  system?: Array<{ text: string }>;
  messages: Array<{ role: "user" | "assistant"; content: ConverseBlock[] }>;
  inferenceConfig?: { maxTokens?: number; temperature?: number };
  toolConfig?: { tools: Array<{ toolSpec: { name: string; description: string; inputSchema: { json: Record<string, unknown> } } }>; toolChoice: { auto: Record<string, never> } };
};

const textOf = (value: unknown) => (typeof value === "string" ? value : "");
const partsOf = (value: unknown): Part[] => (Array.isArray(value) ? value.filter((part) => part && typeof part === "object") as Part[] : []);

/** What the model must do when the caller asked for JSON: Converse has no JSON switch for every model. */
export function jsonInstruction(schema: unknown) {
  const base = "Respond with one JSON value only: no prose before or after it, no Markdown, no code fences.";
  return schema && typeof schema === "object" ? `${base} The JSON must match this schema:\n${JSON.stringify(schema)}` : base;
}

/** The caller's request in Bedrock Converse terms. */
export function toConverse(request: ModelRequest, model: string, env: Env = process.env): ConverseInput {
  const config = (request.generationConfig ?? {}) as Record<string, unknown>;
  const system = partsOf((request.systemInstruction as { parts?: unknown } | undefined)?.parts)
    .map((part) => textOf(part.text).trim()).filter(Boolean);
  if (config.responseMimeType === "application/json") system.push(jsonInstruction(config.responseSchema ?? config.responseJsonSchema));
  const textOnly = TEXT_ONLY.test(model);
  let files = 0;
  const messages: ConverseInput["messages"] = [];
  for (const content of request.contents as Content[]) {
    const role = content?.role === "model" || content?.role === "assistant" ? "assistant" : "user";
    const blocks: ConverseBlock[] = [];
    for (const part of partsOf(content?.parts)) {
      if (part.thought) continue;
      if (part.functionCall && typeof part.functionCall === "object") {
        const call = part.functionCall;
        blocks.push({ toolUse: { toolUseId: textOf(call.id) || `call_${textOf(call.name)}`, name: textOf(call.name), input: objectOf(call.args) } });
        continue;
      }
      if (part.functionResponse && typeof part.functionResponse === "object") {
        const result = part.functionResponse;
        const response = objectOf(result.response);
        blocks.push({ toolResult: { toolUseId: textOf(result.id) || `call_${textOf(result.name)}`, content: [{ text: JSON.stringify(response) }], ...(response.error ? { status: "error" as const } : {}) } });
        continue;
      }
      const text = textOf(part.text);
      if (text.trim()) { blocks.push({ text }); continue; }
      const mimeType = textOf(part.inlineData?.mimeType).toLowerCase();
      const data = textOf(part.inlineData?.data);
      if (!mimeType || !data) continue;
      if (textOnly) throw new TextOnlyModelError();
      const bytes = new Uint8Array(Buffer.from(data, "base64"));
      if (IMAGE_FORMATS[mimeType]) blocks.push({ image: { format: IMAGE_FORMATS[mimeType], source: { bytes } } });
      else if (DOCUMENT_FORMATS[mimeType]) blocks.push({ document: { format: DOCUMENT_FORMATS[mimeType], name: `Reference ${++files}`, source: { bytes } } });
      else blocks.push({ text: `[An attachment of type ${mimeType} could not be read.]` });
    }
    if (!blocks.length) continue;
    // Converse alternates between the person and the model: consecutive turns of one side are joined.
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(...blocks);
    else if (messages.length || role === "user") messages.push({ role, content: blocks });
  }
  const requested = typeof config.maxOutputTokens === "number" && config.maxOutputTokens > 0 ? Math.floor(config.maxOutputTokens) : 4000;
  const cap = outputCap(model, env);
  const inferenceConfig: NonNullable<ConverseInput["inferenceConfig"]> = { maxTokens: cap ? Math.min(requested, cap) : requested };
  if (typeof config.temperature === "number") inferenceConfig.temperature = config.temperature;
  const declarations = (request.tools ?? []).flatMap((tool) => tool.functionDeclarations ?? []);
  const toolConfig: ConverseInput["toolConfig"] = declarations.length
    ? { tools: declarations.map((tool) => ({ toolSpec: { name: tool.name, description: tool.description, inputSchema: { json: tool.parameters } } })), toolChoice: { auto: {} } }
    : undefined;
  return { modelId: model, ...(system.length ? { system: [{ text: system.join("\n\n") }] } : {}), messages, inferenceConfig, ...(toolConfig ? { toolConfig } : {}) };
}

const objectOf = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

const STOP_REASONS: Record<string, string> = {
  end_turn: "STOP", stop_sequence: "STOP", tool_use: "TOOL_CALL", max_tokens: "MAX_TOKENS", model_context_window_exceeded: "MAX_TOKENS",
  content_filtered: "SAFETY", guardrail_intervened: "SAFETY", malformed_model_output: "MALFORMED",
};

/** A Converse answer's text (reasoning blocks left out), finish reason (in the Gemini names the callers read) and token use. */
export function readConverse(value: unknown, separator: string): ProviderAnswer {
  const body = value as { output?: { message?: { content?: Array<{ text?: unknown }> } }; stopReason?: unknown; usage?: { inputTokens?: unknown; outputTokens?: unknown } } | null;
  const text = (body?.output?.message?.content ?? []).map((block) => textOf(block?.text)).filter(Boolean).join(separator).trim();
  const stop = textOf(body?.stopReason);
  return {
    text,
    finishReason: stop ? STOP_REASONS[stop] ?? stop.toUpperCase() : null,
    usage: { input_tokens: tokens(body?.usage?.inputTokens), output_tokens: tokens(body?.usage?.outputTokens) },
  };
}

/** A Gemini answer's text without the model's thoughts, its finish reason and token use. */
export function readGemini(value: unknown, separator: string): ProviderAnswer {
  const body = value as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>; usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown } } | null;
  const candidate = body?.candidates?.[0];
  return {
    text: (candidate?.content?.parts ?? []).filter((part) => !part.thought && part.text).map((part) => part.text ?? "").join(separator).trim(),
    finishReason: candidate?.finishReason ?? null,
    usage: { input_tokens: tokens(body?.usageMetadata?.promptTokenCount), output_tokens: tokens(body?.usageMetadata?.candidatesTokenCount) },
  };
}

/**
 * An agent turn from Converse: the answer plus its tool calls, and the assistant's content in the shared
 * shape (text and `functionCall` parts) so the next turn sends it back as it was.
 */
export function readConverseTurn(value: unknown): ProviderTurn {
  const answer = readConverse(value, "\n");
  const blocks = (value as { output?: { message?: { content?: unknown[] } } } | null)?.output?.message?.content ?? [];
  const calls: ToolCall[] = [];
  const parts: unknown[] = [];
  for (const block of blocks) {
    const item = objectOf(block);
    if (typeof item.text === "string" && item.text.trim()) parts.push({ text: item.text });
    const use = objectOf(item.toolUse);
    if (typeof use.name === "string" && use.name) {
      const call: ToolCall = { id: textOf(use.toolUseId) || undefined, name: use.name, args: objectOf(use.input) };
      calls.push(call);
      parts.push({ functionCall: { ...(call.id ? { id: call.id } : {}), name: call.name, args: call.args } });
    }
  }
  return { ...answer, finishReason: calls.length ? "TOOL_CALL" : answer.finishReason, calls, parts };
}

/**
 * An agent turn from Gemini: the answer plus its function calls. The model's parts go back unchanged
 * (Gemini 3 signs its function calls, and the signature must be returned with them).
 */
export function readGeminiTurn(value: unknown): ProviderTurn {
  const answer = readGemini(value, "\n");
  const body = value as { candidates?: Array<{ content?: { parts?: unknown[] } }> } | null;
  const parts = (body?.candidates?.[0]?.content?.parts ?? []).filter((part) => part && typeof part === "object");
  const calls: ToolCall[] = [];
  for (const part of parts as Part[]) {
    const call = part.functionCall;
    if (call && typeof call.name === "string" && call.name) calls.push({ id: textOf(call.id) || undefined, name: call.name, args: objectOf(call.args) });
  }
  return { ...answer, finishReason: calls.length ? "TOOL_CALL" : answer.finishReason, calls, parts };
}

/** Nova can think aloud in <thinking> tags before it answers; the person sees the answer only. */
export function withoutThinking(text: string) {
  return text.replace(/<thinking>[\s\S]*?(<\/thinking>|$)/gi, "").trim();
}

function tokens(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/** Removes a Markdown code fence around a JSON answer. */
export function stripCodeFences(text: string) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

/**
 * The JSON inside a model's answer. Gemini has a JSON mode; Bedrock's Converse doesn't, so a model there may wrap
 * the value in a sentence or a fenced block. Returns the answer unchanged when no JSON value can be found in it.
 */
export function jsonFromModel(text: string) {
  const stripped = stripCodeFences(text);
  const parses = (candidate: string) => { try { JSON.parse(candidate); return true; } catch { return false; } };
  if (parses(stripped)) return stripped;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1]?.trim();
  if (fenced && parses(fenced)) return fenced;
  const start = stripped.search(/[{[]/);
  const end = Math.max(stripped.lastIndexOf("}"), stripped.lastIndexOf("]"));
  if (start >= 0 && end > start && parses(stripped.slice(start, end + 1))) return stripped.slice(start, end + 1);
  return stripped;
}

export type ProviderFailure = "throttled" | "temporary" | "denied" | "failed";

/**
 * How a Bedrock error is handled: throttled (retry later), temporary (one retry for the long plan),
 * denied (the host may not call the model: AI is not available) or failed.
 */
export function classifyBedrockError(error: unknown): ProviderFailure {
  const name = (error as { name?: unknown })?.name;
  if (typeof name !== "string") return "failed";
  if (["ThrottlingException", "ServiceQuotaExceededException", "TooManyRequestsException"].includes(name)) return "throttled";
  if (["ServiceUnavailableException", "ModelNotReadyException", "InternalServerException", "ModelTimeoutException"].includes(name)) return "temporary";
  if (["AccessDeniedException", "UnrecognizedClientException", "ResourceNotFoundException", "CredentialsProviderError", "ExpiredTokenException", "InvalidSignatureException"].includes(name)) return "denied";
  return "failed";
}
