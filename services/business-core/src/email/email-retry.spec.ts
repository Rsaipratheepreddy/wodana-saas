import { describe, expect, it } from "vitest";
import { EMAIL_MAX_ATTEMPTS, mailgunFailure, mailgunTransportFailure, nextEmailRetry, retryAfterMs, sesFailure, tooOldToRetry } from "./email-retry";

const now = new Date("2030-01-09T06:00:00Z");
const minutes = (value: number) => value * 60_000;
const after = (at: Date | null) => (at ? at.getTime() - now.getTime() : null);

describe("email retry classification", () => {
  it("treats Mailgun 429 as a retryable throttle, with or without Retry-After", () => {
    expect(mailgunFailure(429, "30", now.getTime())).toEqual({ errorCode: "MAILGUN_HTTP_429", retryable: true, throttled: true, retryAfterMs: 30_000 });
    expect(mailgunFailure(429, new Date(now.getTime() + 90_000).toUTCString(), now.getTime())).toMatchObject({ retryable: true, retryAfterMs: 90_000 });
    expect(mailgunFailure(429, null, now.getTime())).toEqual({ errorCode: "MAILGUN_HTTP_429", retryable: true, throttled: true });
    expect(mailgunFailure(429, "soon", now.getTime())).toEqual({ errorCode: "MAILGUN_HTTP_429", retryable: true, throttled: true });
  });

  it("retries 5xx, timeouts and network errors; keeps every other 4xx permanent", () => {
    for (const status of [500, 502, 503, 504]) expect(mailgunFailure(status, null)).toMatchObject({ errorCode: `MAILGUN_HTTP_${status}`, retryable: true, throttled: false });
    for (const status of [400, 401, 403, 404, 408, 413, 422]) expect(mailgunFailure(status, "30")).toEqual({ errorCode: `MAILGUN_HTTP_${status}`, retryable: false, throttled: false });
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect(mailgunTransportFailure(timeout)).toEqual({ errorCode: "MAILGUN_TIMEOUT", retryable: true, throttled: false });
    expect(mailgunTransportFailure(new TypeError("fetch failed"))).toEqual({ errorCode: "MAILGUN_UNREACHABLE", retryable: true, throttled: false });
  });

  it("classifies SES errors the same way", () => {
    const aws = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(name), { name, ...extra });
    expect(sesFailure(aws("TooManyRequestsException", { $metadata: { httpStatusCode: 429 } }))).toMatchObject({ errorCode: "SES_TooManyRequestsException", retryable: true, throttled: true });
    expect(sesFailure(aws("Throttling", { $response: { headers: { "retry-after": "5" } } }), now.getTime())).toMatchObject({ retryable: true, throttled: true, retryAfterMs: 5_000 });
    expect(sesFailure(aws("InternalFailure", { $fault: "server", $metadata: { httpStatusCode: 500 } }))).toMatchObject({ retryable: true, throttled: false });
    expect(sesFailure(aws("TimeoutError"))).toMatchObject({ errorCode: "SES_TIMEOUT", retryable: true });
    expect(sesFailure(aws("Error", { code: "ECONNRESET" }))).toMatchObject({ retryable: true });
    expect(sesFailure(aws("MessageRejected", { $fault: "client", $metadata: { httpStatusCode: 400 } }))).toEqual({ errorCode: "SES_MessageRejected", retryable: false, throttled: false });
    expect(sesFailure(aws("AccountSuspendedException"))).toMatchObject({ retryable: false });
  });

  it("reads Retry-After as seconds or an HTTP date", () => {
    expect(retryAfterMs("120", now.getTime())).toBe(120_000);
    expect(retryAfterMs("1.5", now.getTime())).toBe(1_500);
    expect(retryAfterMs(new Date(now.getTime() + 45_000).toUTCString(), now.getTime())).toBe(45_000);
    expect(retryAfterMs(new Date(now.getTime() - 45_000).toUTCString(), now.getTime())).toBe(0);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("")).toBeNull();
  });
});

describe("email retry backoff", () => {
  const createdAt = new Date(now.getTime() - minutes(2));
  const middle = () => 0.5;

  it("waits 1, 5, 15 then 60 minutes, then gives up", () => {
    expect([1, 2, 3, 4].map((attempt) => after(nextEmailRetry({ attempt, createdAt, now, random: middle })))).toEqual([minutes(1), minutes(5), minutes(15), minutes(60)]);
    expect(EMAIL_MAX_ATTEMPTS).toBe(5);
    expect(nextEmailRetry({ attempt: 5, createdAt, now, random: middle })).toBeNull();
  });

  it("spreads retries by ±20% so a burst doesn't come back at once", () => {
    expect(after(nextEmailRetry({ attempt: 1, createdAt, now, random: () => 0 }))).toBe(48_000);
    expect(after(nextEmailRetry({ attempt: 1, createdAt, now, random: () => 1 }))).toBe(72_000);
    const spread = new Set(Array.from({ length: 50 }, () => after(nextEmailRetry({ attempt: 2, createdAt, now }))));
    expect(spread.size).toBeGreaterThan(10);
  });

  it("never retries before the provider's Retry-After (capped at six hours)", () => {
    expect(after(nextEmailRetry({ attempt: 1, createdAt, now, retryAfterMs: minutes(10), random: middle }))).toBe(minutes(10));
    expect(after(nextEmailRetry({ attempt: 3, createdAt, now, retryAfterMs: 30_000, random: middle }))).toBe(minutes(15));
    expect(after(nextEmailRetry({ attempt: 1, createdAt, now, retryAfterMs: minutes(60 * 48), random: middle }))).toBe(minutes(360));
  });

  it("doesn't send anything again more than a day after it was raised", () => {
    const yesterday = new Date(now.getTime() - minutes(24 * 60 - 30));
    expect(nextEmailRetry({ attempt: 1, createdAt: yesterday, now, random: middle })).not.toBeNull();
    expect(nextEmailRetry({ attempt: 4, createdAt: yesterday, now, random: middle })).toBeNull();
    expect(tooOldToRetry(new Date(now.getTime() - minutes(24 * 60 + 1)), now)).toBe(true);
    expect(tooOldToRetry(yesterday, now)).toBe(false);
  });
});
