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

type Part = { text?: unknown; thought?: unknown; inlineData?: { mimeType?: unknown; data?: unknown } };
type Content = { role?: unknown; parts?: unknown };
/** The request every assistant builds: systemInstruction, contents and generationConfig. */
export type ModelRequest = { systemInstruction?: unknown; contents: unknown[]; generationConfig?: Record<string, unknown> };

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
  | { document: { format: string; name: string; source: { bytes: Uint8Array } } };
export type ConverseInput = {
  modelId: string;
  system?: Array<{ text: string }>;
  messages: Array<{ role: "user" | "assistant"; content: ConverseBlock[] }>;
  inferenceConfig?: { maxTokens?: number; temperature?: number };
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
  return { modelId: model, ...(system.length ? { system: [{ text: system.join("\n\n") }] } : {}), messages, inferenceConfig };
}

const STOP_REASONS: Record<string, string> = {
  end_turn: "STOP", stop_sequence: "STOP", max_tokens: "MAX_TOKENS", model_context_window_exceeded: "MAX_TOKENS",
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

function tokens(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/** Removes a Markdown code fence around a JSON answer. */
export function stripCodeFences(text: string) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
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
