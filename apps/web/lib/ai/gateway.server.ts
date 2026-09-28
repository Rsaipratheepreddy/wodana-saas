import "server-only";

import { authenticatedBackendFetch, type AuthenticatedBackendResult } from "@/lib/auth/backend-session";
import { businessApiUrl } from "@/lib/auth/server";

/**
 * The web assistants reach the model only through Business Core's AI gateway, which applies the
 * workspace's AI switch, the person's `ai.suggestions.use`, a per-workspace limit shared by every
 * instance, and the usage log. The web holds no model key.
 */
export type AiFeature = "crm.chat" | "crm.assist" | "commercial.assist" | "quotation.plan";

/** The provider request without the model: the gateway accepts systemInstruction, contents and generationConfig only. */
export type AiRequest = {
  systemInstruction?: unknown;
  contents: unknown[];
  generationConfig?: Record<string, unknown>;
};

export type AiRefusal = "off" | "not-configured" | "no-access" | "rate-limited" | "unavailable";
export type AiAnswer =
  | { ok: true; text: string; finishReason: string | null; model: string; rotatedSession?: AuthenticatedBackendResult["rotatedSession"] }
  | { ok: false; reason: AiRefusal; status: number; rotatedSession?: AuthenticatedBackendResult["rotatedSession"] };

/** Why the gateway refused: the workspace switched AI off, the deployment has no key, the person can't use AI, the limit, or the provider. */
export function refusalOf(status: number, payload: unknown): AiRefusal {
  const code = payload && typeof payload === "object" ? (payload as { code?: unknown }).code : undefined;
  if (code === "AI_OFF") return "off";
  if (code === "AI_NOT_CONFIGURED") return "not-configured";
  if (status === 403) return "no-access";
  if (status === 429) return "rate-limited";
  return "unavailable";
}

export async function generateThroughGateway(
  workspaceId: string,
  feature: AiFeature,
  request: AiRequest,
  options: { timeoutMs?: number; accessToken?: string } = {},
): Promise<AiAnswer> {
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 30_000, 5_000), 110_000);
  const path = `/workspaces/${workspaceId}/ai/generate`;
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ feature, request, timeoutMs }),
    cache: "no-store",
    // The gateway's own budget plus a moment for its checks and the log.
    signal: AbortSignal.timeout(timeoutMs + 5_000),
  };
  let upstream: Response | null;
  let rotatedSession: AuthenticatedBackendResult["rotatedSession"];
  if (options.accessToken) {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${options.accessToken}`);
    upstream = await fetch(businessApiUrl(path), { ...init, headers }).catch(() => null);
  } else {
    const result = await authenticatedBackendFetch(path, init);
    upstream = result.upstream;
    rotatedSession = result.rotatedSession;
    if (result.unauthenticated) return { ok: false, reason: "no-access", status: 401, rotatedSession };
  }
  if (!upstream) return { ok: false, reason: "unavailable", status: 503, rotatedSession };
  const payload = await upstream.json().catch(() => null) as { text?: unknown; finishReason?: unknown; model?: unknown } | null;
  if (!upstream.ok) return { ok: false, reason: refusalOf(upstream.status, payload), status: upstream.status, rotatedSession };
  return {
    ok: true,
    text: typeof payload?.text === "string" ? payload.text : "",
    finishReason: typeof payload?.finishReason === "string" ? payload.finishReason : null,
    model: typeof payload?.model === "string" ? payload.model : "",
    rotatedSession,
  };
}
