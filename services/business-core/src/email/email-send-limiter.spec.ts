import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { EmailSendLimiter, emailSendRate, processEmailSendLimiter } from "./email-send-limiter";

/** The most sends inside any rolling window of `length` ms. */
function busiestWindow(times: number[], length: number) {
  const sorted = [...times].sort((a, b) => a - b);
  let most = 0;
  for (let start = 0, end = 0; end < sorted.length; end++) {
    while (sorted[end] - sorted[start] >= length) start++;
    most = Math.max(most, end - start + 1);
  }
  return most;
}

describe("EmailSendLimiter", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-09T06:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  /** Starts `count` sends at once (concurrent dispatch loops) and records when each was let through. */
  async function burst(limiter: EmailSendLimiter, count: number, notAfter?: number) {
    const started = Date.now();
    const granted: number[] = [];
    const refused: number[] = [];
    const all = Promise.all(Array.from({ length: count }, async (_, index) => {
      const slot = await limiter.acquire(notAfter);
      if (slot.granted) granted.push(Date.now() - started);
      else refused.push(index);
    }));
    await vi.runAllTimersAsync();
    await all;
    return { granted, refused };
  }

  it("spreads a burst: 5 go at once, then one every fifth of a second, never more than 5 in any second", async () => {
    const { granted } = await burst(new EmailSendLimiter({ perSecond: 5, perMinute: 120 }), 50);
    expect(granted).toHaveLength(50);
    expect(granted.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(granted[5]).toBe(1_000);
    expect(busiestWindow(granted, 1_000)).toBe(5);
    // 50 sends at 5 a second: the last leaves after 9 seconds.
    expect(Math.max(...granted)).toBe(9_000);
  });

  it("holds the per-minute cap: the 121st send of a minute waits for the minute to roll", async () => {
    const { granted } = await burst(new EmailSendLimiter({ perSecond: 5, perMinute: 120 }), 130);
    expect(busiestWindow(granted, 60_000)).toBe(120);
    expect(busiestWindow(granted, 1_000)).toBeLessThanOrEqual(5);
    const sorted = [...granted].sort((a, b) => a - b);
    expect(sorted[119]).toBeLessThan(60_000);
    expect(sorted[120]).toBeGreaterThanOrEqual(60_000);
  });

  it("is safe across concurrent loops: interleaved acquirers never share a slot or break the windows", async () => {
    const limiter = new EmailSendLimiter({ perSecond: 3, perMinute: 20 });
    const started = Date.now();
    const times: number[] = [];
    const loop = async (sends: number) => {
      for (let index = 0; index < sends; index++) {
        const slot = await limiter.acquire();
        if (slot.granted) times.push(Date.now() - started);
      }
    };
    const loops = Promise.all([loop(10), loop(10), loop(10)]);
    await vi.runAllTimersAsync();
    await loops;
    expect(times).toHaveLength(30);
    expect(busiestWindow(times, 1_000)).toBe(3);
    expect(busiestWindow(times, 60_000)).toBe(20);
  });

  it("refuses, without taking it, a slot later than the caller's deadline", async () => {
    const limiter = new EmailSendLimiter({ perSecond: 5, perMinute: 120 });
    const deadline = Date.now() + 1_500;
    const { granted, refused } = await burst(limiter, 20, deadline);
    // Slots at 0 s (5) and 1 s (5) fit before 1.5 s; the other ten are refused and nothing was taken for them.
    expect(granted).toHaveLength(10);
    expect(refused).toHaveLength(10);
    expect(limiter.nextSlotAt()).toBe(new Date("2030-01-09T06:00:02Z").getTime());
    // It is now 06:00:01; the next slot is a second away.
    const refusal = await limiter.acquire(Date.now());
    expect(refusal).toEqual({ granted: false, retryAfterMs: 1_000 });
  });

  it("pauses every send after a provider throttle, including those already waiting", async () => {
    const limiter = new EmailSendLimiter({ perSecond: 5, perMinute: 120 });
    const started = Date.now();
    const times: number[] = [];
    const sends = Promise.all(Array.from({ length: 7 }, async () => { await limiter.acquire(); times.push(Date.now() - started); }));
    await vi.advanceTimersByTimeAsync(0);
    // Five went at once; the provider says wait three seconds.
    limiter.pause(3_000);
    await vi.runAllTimersAsync();
    await sends;
    expect(times.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(Math.min(...times.slice(5))).toBeGreaterThanOrEqual(3_000);
  });

  it("reads EMAIL_SEND_PER_SECOND and EMAIL_SEND_PER_MINUTE, falling back on the defaults; one limiter per process", () => {
    expect(emailSendRate(new ConfigService({}))).toEqual({ perSecond: 5, perMinute: 120 });
    expect(emailSendRate(new ConfigService({ EMAIL_SEND_PER_SECOND: "10", EMAIL_SEND_PER_MINUTE: "300" }))).toEqual({ perSecond: 10, perMinute: 300 });
    expect(emailSendRate(new ConfigService({ EMAIL_SEND_PER_SECOND: "0", EMAIL_SEND_PER_MINUTE: "lots" }))).toEqual({ perSecond: 5, perMinute: 120 });
    const first = processEmailSendLimiter({ perSecond: 5, perMinute: 120 });
    const second = processEmailSendLimiter({ perSecond: 8, perMinute: 200 });
    expect(second).toBe(first);
    expect(first.rate).toEqual({ perSecond: 8, perMinute: 200 });
    first.configure({ perSecond: 5, perMinute: 120 });
  });
});
