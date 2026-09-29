import { tKey } from "@/lib/i18n/keys";

/**
 * AI is paused, not broken: the workspace's AI credits are used up, or today's AI limit is reached.
 * Business Core refuses these calls before they reach the model; the web shows the message calmly, with
 * its next step, instead of an error. The messages are the ones Business Core sends.
 */
export const AI_PAUSE_MESSAGES = {
  AI_CREDITS_EXHAUSTED: tKey("AI credits are used up. Ask your admin to top up."),
  AI_WORKSPACE_DAILY_LIMIT: tKey("Today's AI limit for this workspace is reached. Try again tomorrow."),
  AI_PLATFORM_DAILY_LIMIT: tKey("AI is paused for today. Try again tomorrow."),
} as const;
export type AiPauseCode = keyof typeof AI_PAUSE_MESSAGES;

const PAUSES = new Set<string>(Object.values(AI_PAUSE_MESSAGES));

/** The pause behind a refused AI request (from its code, or 402 Payment Required), or null. */
export function aiPauseOf(status: number, payload: unknown): AiPauseCode | null {
  const code = payload && typeof payload === "object" ? (payload as { code?: unknown }).code : undefined;
  if (typeof code === "string" && code in AI_PAUSE_MESSAGES) return code as AiPauseCode;
  return status === 402 ? "AI_CREDITS_EXHAUSTED" : null;
}

/** Whether a failure message is an AI pause (for screens that keep only the message). */
export function isAiPauseMessage(message: unknown): message is string {
  return typeof message === "string" && PAUSES.has(message);
}
