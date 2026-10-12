import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

/**
 * Minimal error reporting to a Sentry-compatible endpoint (Sentry, GlitchTip). Off unless SENTRY_DSN is set; never
 * throws and never blocks a request. Sends only the error (type, message, stack), the route (method + path, no query
 * or body) and the actor's subject id. Bounded: one report per distinct error per 5 minutes, at most 30 a minute.
 */
export interface ErrorReportContext {
  method?: string;
  path?: string;
  status?: number;
  subject?: string;
  source?: string;
}

interface Dsn {
  endpoint: string;
  publicKey: string;
}

interface StackFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

const DEDUPE_MS = 5 * 60_000;
const MAX_PER_MINUTE = 30;
const SEND_TIMEOUT_MS = 3_000;

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

/** V8 stack lines ("    at fn (file:line:col)") as Sentry frames, oldest call first. */
export function stackFrames(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n").slice(1, 51)) {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!match) continue;
    const filename = match[2];
    frames.push({
      ...(match[1] ? { function: match[1] } : {}),
      filename,
      lineno: Number(match[3]),
      colno: Number(match[4]),
      in_app: !filename.includes("node_modules") && !filename.startsWith("node:"),
    });
  }
  return frames.reverse();
}

function errorParts(error: unknown): { type: string; message: string; stack?: string } {
  if (error instanceof Error) return { type: error.name || "Error", message: error.message, stack: error.stack };
  if (typeof error === "string") return { type: "Error", message: error };
  try {
    return { type: "Error", message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { type: "Error", message: String(error) };
  }
}

/** The same failure seen by the exception filter and by the logger is one report. */
function fingerprint(type: string, message: string, stack?: string) {
  const top = stack?.split("\n").slice(1, 3).join("|") ?? "";
  return `${type}:${message.slice(0, 200)}:${top}`;
}

export class ErrorReporter {
  private readonly recent = new Map<string, number>();
  private readonly pending = new Set<Promise<void>>();
  private windowStart = 0;
  private windowCount = 0;

  constructor(
    private readonly dsn: Dsn | null,
    private readonly options: {
      service: string;
      environment: string;
      release?: string;
      send?: (url: string, init: RequestInit) => Promise<unknown>;
      now?: () => number;
    },
  ) {}

  static fromEnv(service: string, env: NodeJS.ProcessEnv = process.env) {
    return new ErrorReporter(parseDsn(env.SENTRY_DSN), {
      service,
      environment: env.SENTRY_ENVIRONMENT ?? env.ENVIRONMENT ?? env.NODE_ENV ?? "development",
      release: env.WODANA_RELEASE_ID,
    });
  }

  get enabled() {
    return this.dsn !== null;
  }

  captureException(error: unknown, context: ErrorReportContext = {}) {
    const parts = errorParts(error);
    this.capture(parts.type, parts.message, parts.stack, context);
  }

  /** An error-level log line (message plus the stack the logger was given, if any). */
  captureLog(message: string, stack: string | undefined, context: ErrorReportContext = {}) {
    const firstLine = stack?.split("\n")[0] ?? "";
    const typed = /^([A-Za-z]*Error|Exception)\b:?\s*(.*)$/.exec(firstLine);
    this.capture(typed?.[1] ?? "LoggedError", typed ? typed[2] || message : message, stack, context);
  }

  async flush(timeoutMs = 2_000) {
    if (!this.pending.size) return;
    await Promise.race([
      Promise.allSettled([...this.pending]),
      new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
    ]);
  }

  private capture(type: string, message: string, stack: string | undefined, context: ErrorReportContext) {
    if (!this.dsn) return;
    const now = this.options.now?.() ?? Date.now();
    const key = fingerprint(type, message, stack);
    const seen = this.recent.get(key);
    if (seen !== undefined && now - seen < DEDUPE_MS) return;
    if (now - this.windowStart >= 60_000) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    if (this.windowCount >= MAX_PER_MINUTE) return;
    this.windowCount += 1;
    this.recent.set(key, now);
    if (this.recent.size > 500) {
      for (const [entry, at] of this.recent) if (now - at >= DEDUPE_MS) this.recent.delete(entry);
    }
    const sending = this.send(type, message, stack, context, now).catch(() => undefined);
    this.pending.add(sending);
    void sending.finally(() => this.pending.delete(sending));
  }

  private async send(type: string, message: string, stack: string | undefined, context: ErrorReportContext, now: number) {
    const dsn = this.dsn as Dsn;
    const eventId = randomUUID().replace(/-/g, "");
    const event = {
      event_id: eventId,
      timestamp: now / 1000,
      platform: "node",
      level: "error",
      logger: context.source ?? this.options.service,
      server_name: hostname(),
      environment: this.options.environment,
      ...(this.options.release ? { release: this.options.release } : {}),
      tags: {
        service: this.options.service,
        ...(context.status ? { status: String(context.status) } : {}),
        ...(context.source ? { source: context.source } : {}),
      },
      ...(context.method || context.path ? { request: { method: context.method, url: context.path } } : {}),
      ...(context.subject ? { user: { id: context.subject } } : {}),
      exception: { values: [{ type, value: message.slice(0, 2_000), stacktrace: { frames: stackFrames(stack) } }] },
    };
    const body = [
      JSON.stringify({ event_id: eventId, sent_at: new Date(now).toISOString() }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n");
    const send = this.options.send ?? ((url: string, init: RequestInit) => fetch(url, init));
    await send(dsn.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=wodana-error-reporter/1.0`,
      },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  }
}
