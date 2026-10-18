/**
 * Server-side error reporting to a Sentry-compatible endpoint (Sentry, GlitchTip), used by instrumentation.ts.
 * Off unless SENTRY_DSN is set; never throws. Sends the error, the route pattern, the path (no query string) and
 * the method only: no headers, cookies or bodies. One report per distinct error per 5 minutes, at most 30 a minute.
 */
type Dsn = { endpoint: string; publicKey: string };

export type WebErrorContext = { method?: string; path?: string; routePath?: string; routeType?: string };

const DEDUPE_MS = 5 * 60_000;
const MAX_PER_MINUTE = 30;
const recent = new Map<string, number>();
let windowStart = 0;
let windowCount = 0;

export function parseDsn(value: string | undefined): Dsn | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    const publicKey = decodeURIComponent(url.username);
    const segments = url.pathname.split("/").filter(Boolean);
    const projectId = segments.pop();
    if (!publicKey || !projectId || !/^https?:$/.test(url.protocol)) return null;
    const prefix = segments.length ? `/${segments.join("/")}` : "";
    return { endpoint: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`, publicKey };
  } catch {
    return null;
  }
}

function frames(stack: string | undefined) {
  if (!stack) return [];
  return stack.split("\n").slice(1, 51).flatMap((line) => {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!match) return [];
    return [{ function: match[1], filename: match[2], lineno: Number(match[3]), colno: Number(match[4]),
      in_app: !match[2].includes("node_modules") && !match[2].startsWith("node:") }];
  }).reverse();
}

/** Builds the envelope, or null when the error was reported recently or the minute's budget is spent. */
export function buildEnvelope(error: unknown, context: WebErrorContext, env: {
  release?: string; environment?: string; now?: number;
} = {}): string | null {
  const now = env.now ?? Date.now();
  const type = error instanceof Error ? error.name || "Error" : "Error";
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const key = `${type}:${message.slice(0, 200)}:${stack?.split("\n").slice(1, 3).join("|") ?? ""}`;
  const seen = recent.get(key);
  if (seen !== undefined && now - seen < DEDUPE_MS) return null;
  if (now - windowStart >= 60_000) { windowStart = now; windowCount = 0; }
  if (windowCount >= MAX_PER_MINUTE) return null;
  windowCount += 1;
  recent.set(key, now);
  if (recent.size > 500) for (const [entry, at] of recent) if (now - at >= DEDUPE_MS) recent.delete(entry);

  const eventId = crypto.randomUUID().replace(/-/g, "");
  const digest = (error as { digest?: unknown } | null)?.digest;
  const event = {
    event_id: eventId,
    timestamp: now / 1000,
    platform: "node",
    level: "error",
    logger: "web",
    environment: env.environment ?? "development",
    ...(env.release ? { release: env.release } : {}),
    tags: { service: "web", ...(context.routeType ? { routeType: context.routeType } : {}),
      ...(typeof digest === "string" ? { digest } : {}) },
    transaction: context.routePath,
    request: { method: context.method, url: context.path?.split("?")[0] },
    exception: { values: [{ type, value: message.slice(0, 2_000), stacktrace: { frames: frames(stack) } }] },
  };
  return [JSON.stringify({ event_id: eventId, sent_at: new Date(now).toISOString() }), JSON.stringify({ type: "event" }),
    JSON.stringify(event)].join("\n");
}

export async function reportServerError(error: unknown, context: WebErrorContext,
  send: (url: string, init: RequestInit) => Promise<unknown> = (url, init) => fetch(url, init)) {
  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn) return;
  try {
    const body = buildEnvelope(error, context, {
      release: process.env.WODANA_RELEASE_ID,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    });
    if (!body) return;
    await send(dsn.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=wodana-web/1.0`,
      },
      body,
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // Reporting never affects the response.
  }
}
