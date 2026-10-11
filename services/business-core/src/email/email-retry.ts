/**
 * Which email failures are worth trying again, and when. Provider throttling (HTTP 429), provider errors (5xx),
 * timeouts and network errors are retryable: the notice stays scheduled with backoff (1, 5, 15 and 60 minutes, each
 * ±20% so a burst doesn't come back at once), never sooner than the provider's Retry-After. Every other refusal (a 4xx
 * other than 429, a rejected message) is permanent. After the last retry, or once the notice is a day old, it fails.
 */

/** The waits before the 2nd, 3rd, 4th and 5th attempts. */
export const EMAIL_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
/** The first send and four retries. */
export const EMAIL_MAX_ATTEMPTS = EMAIL_RETRY_DELAYS_MS.length + 1;
/** Nothing is sent again once the notice is older than this. */
export const EMAIL_RETRY_MAX_AGE_MS = 24 * 60 * 60_000;
/** A Retry-After longer than this is read as this (one odd header never parks a notice for days). */
export const EMAIL_RETRY_AFTER_CAP_MS = 6 * 60 * 60_000;
/** How long the whole process stops sending after the provider throttled us without saying for how long. */
export const PROVIDER_THROTTLE_PAUSE_MS = 1_000;
/** The longest the whole process stops sending after a throttle; the throttled notice itself waits its own backoff. */
export const PROVIDER_THROTTLE_PAUSE_CAP_MS = 60_000;

/** A provider failure, classified: its code (no recipient data), whether to try again, and the provider's wait. */
export type ProviderFailure = { errorCode: string; retryable: boolean; retryAfterMs?: number; throttled: boolean };

/** Retry-After as milliseconds from `now`: seconds ("120") or an HTTP date. Null when absent or unreadable. */
export function retryAfterMs(value: string | null | undefined, now = Date.now()): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1_000);
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** A Mailgun answer that wasn't 2xx: 429 and 5xx are retryable, every other status is permanent. */
export function mailgunFailure(status: number, retryAfter: string | null | undefined, now = Date.now()): ProviderFailure {
  const throttled = status === 429;
  const retryable = throttled || status >= 500;
  const wait = retryable ? retryAfterMs(retryAfter, now) : null;
  return { errorCode: `MAILGUN_HTTP_${status}`, retryable, throttled, ...(wait !== null ? { retryAfterMs: wait } : {}) };
}

/** Mailgun never answered: a timeout or a network error, both retryable. */
export function mailgunTransportFailure(error: unknown): ProviderFailure {
  const name = error instanceof Error ? error.name : "UnknownError";
  return { errorCode: name === "TimeoutError" || name === "AbortError" ? "MAILGUN_TIMEOUT" : "MAILGUN_UNREACHABLE", retryable: true, throttled: false };
}

const SES_THROTTLES = new Set(["Throttling", "ThrottlingException", "TooManyRequestsException", "RequestLimitExceeded", "SlowDown"]);
const SES_TRANSIENT = new Set(["TimeoutError", "AbortError", "RequestTimeout", "RequestTimeoutException", "NetworkingError", "ServiceUnavailable",
  "ServiceUnavailableException", "InternalFailure", "InternalServerError", "InternalServiceErrorException"]);
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENOTFOUND", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);

type AwsError = { name?: string; code?: string; $fault?: string; $retryable?: { throttling?: boolean }; $metadata?: { httpStatusCode?: number }; $response?: { headers?: Record<string, string> } };

/** An SES send that threw: throttling, a 5xx, a timeout or a network error is retryable; a rejection is permanent. */
export function sesFailure(error: unknown, now = Date.now()): ProviderFailure {
  const aws = (error ?? {}) as AwsError;
  const name = error instanceof Error ? error.name : typeof aws.name === "string" ? aws.name : "UnknownError";
  const status = aws.$metadata?.httpStatusCode;
  const throttled = SES_THROTTLES.has(name) || status === 429 || aws.$retryable?.throttling === true;
  const timeout = name === "TimeoutError" || name === "AbortError";
  const retryable = throttled || timeout || SES_TRANSIENT.has(name) || (typeof status === "number" && status >= 500) || aws.$fault === "server"
    || (typeof aws.code === "string" && NETWORK_CODES.has(aws.code));
  const wait = retryable ? retryAfterMs(aws.$response?.headers?.["retry-after"], now) : null;
  return { errorCode: timeout ? "SES_TIMEOUT" : `SES_${name.replace(/[^A-Za-z0-9]/g, "")}`, retryable, throttled, ...(wait !== null ? { retryAfterMs: wait } : {}) };
}

/**
 * When to try a failed retryable email again: after attempt `attempt` (1 = the first send), the backoff step with
 * jitter, never before the provider's Retry-After. Null when it should fail instead: the attempts are used up, or the
 * retry would land more than a day after the notice was raised.
 */
export function nextEmailRetry(input: { attempt: number; createdAt: Date; retryAfterMs?: number | null; now?: Date; random?: () => number }): Date | null {
  const now = (input.now ?? new Date()).getTime();
  if (!Number.isInteger(input.attempt) || input.attempt < 1 || input.attempt >= EMAIL_MAX_ATTEMPTS) return null;
  const base = EMAIL_RETRY_DELAYS_MS[input.attempt - 1];
  const jittered = Math.round(base * (0.8 + 0.4 * Math.min(1, Math.max(0, (input.random ?? Math.random)()))));
  const providerWait = Math.min(Math.max(0, input.retryAfterMs ?? 0), EMAIL_RETRY_AFTER_CAP_MS);
  const at = now + Math.max(jittered, providerWait);
  return at - input.createdAt.getTime() > EMAIL_RETRY_MAX_AGE_MS ? null : new Date(at);
}

/** A notice raised more than a day ago is never sent again (a retry found late fails instead). */
export const tooOldToRetry = (createdAt: Date, now = new Date()) => now.getTime() - createdAt.getTime() > EMAIL_RETRY_MAX_AGE_MS;
