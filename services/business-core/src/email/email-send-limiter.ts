/**
 * The outbound email limit of this process (every TransactionalEmailService send takes a slot first), so a burst
 * (a reminder catch-up, a dispatch loop draining a backlog) is spread out instead of being refused by the provider.
 *
 * Two token buckets, one per second (EMAIL_SEND_PER_SECOND, default 5) and one per minute (EMAIL_SEND_PER_MINUTE,
 * default 120). A spent token comes back one window after the send it paid for, so no rolling second holds more than
 * the per-second number and no rolling minute more than the per-minute one. Slots are handed out first come, first
 * served: taking one is synchronous (Node runs it on one thread), so concurrent dispatch loops never share a slot.
 *
 * Business Core runs as one process in production; the limit is kept in memory. Several instances would each get
 * the full rate and would need a shared (Redis) limiter instead.
 */
import type { ConfigService } from "@nestjs/config";

export type EmailSendRate = { perSecond: number; perMinute: number };
export const DEFAULT_EMAIL_SEND_RATE: EmailSendRate = { perSecond: 5, perMinute: 120 };

/** EMAIL_SEND_PER_SECOND and EMAIL_SEND_PER_MINUTE (positive whole numbers), else the defaults. */
export function emailSendRate(config: Pick<ConfigService, "get">): EmailSendRate {
  const read = (key: string, fallback: number) => {
    const text = String(config.get<string | number>(key) ?? "").trim();
    const value = Number(text);
    return text && Number.isInteger(value) && value > 0 ? value : fallback;
  };
  return { perSecond: read("EMAIL_SEND_PER_SECOND", DEFAULT_EMAIL_SEND_RATE.perSecond), perMinute: read("EMAIL_SEND_PER_MINUTE", DEFAULT_EMAIL_SEND_RATE.perMinute) };
}

/** The limiter's clock (Date.now and setTimeout; fake timers in tests). */
export type LimiterClock = { now(): number; sleep(ms: number): Promise<void> };
const realClock: LimiterClock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

/** A slot: taken (after waiting `waitedMs`), or refused because the next one is later than the caller can wait. */
export type EmailSlot = { granted: true; waitedMs: number } | { granted: false; retryAfterMs: number };

/** One bucket: `size` tokens, each back `length` ms after the send it was spent on. */
class TokenWindow {
  /** The moments the last `size` tokens were spent, oldest first. */
  private readonly spent: number[] = [];

  constructor(public size: number, readonly length: number) {}

  /** The first moment at or after `at` when a token is free. */
  freeAt(at: number) {
    return this.spent.length < this.size ? at : Math.max(at, this.spent[this.spent.length - this.size] + this.length);
  }

  spend(at: number) {
    this.spent.push(at);
    if (this.spent.length > this.size) this.spent.splice(0, this.spent.length - this.size);
  }
}

export class EmailSendLimiter {
  private readonly second: TokenWindow;
  private readonly minute: TokenWindow;
  /** The latest slot handed out: slots go in order. */
  private last = 0;
  /** The provider throttled us (HTTP 429): nothing leaves before this moment. */
  private pausedUntil = 0;

  constructor(rate: EmailSendRate = DEFAULT_EMAIL_SEND_RATE, private readonly clock: LimiterClock = realClock) {
    this.second = new TokenWindow(rate.perSecond, 1_000);
    this.minute = new TokenWindow(rate.perMinute, 60_000);
  }

  get rate(): EmailSendRate {
    return { perSecond: this.second.size, perMinute: this.minute.size };
  }

  configure(rate: EmailSendRate) {
    this.second.size = rate.perSecond;
    this.minute.size = rate.perMinute;
  }

  /** When the next send could go, without taking the slot. */
  nextSlotAt(now = this.clock.now()) {
    const from = Math.max(now, this.last, this.pausedUntil);
    return Math.max(this.second.freeAt(from), this.minute.freeAt(from));
  }

  /**
   * Takes the next slot and waits for it. With `notAfter` (epoch ms), a slot later than that is refused and nothing is
   * taken: the caller puts the message back and tries again after `retryAfterMs`. A pause raised while waiting (the
   * provider throttled another send) sends the caller to the back of the queue, behind the pause.
   */
  async acquire(notAfter?: number): Promise<EmailSlot> {
    const started = this.clock.now();
    for (;;) {
      const now = this.clock.now();
      const slot = this.nextSlotAt(now);
      if (notAfter !== undefined && slot > notAfter) return { granted: false, retryAfterMs: Math.max(1, slot - now) };
      this.last = slot;
      this.second.spend(slot);
      this.minute.spend(slot);
      if (slot > now) await this.clock.sleep(slot - now);
      if (this.pausedUntil > this.clock.now()) continue;
      return { granted: true, waitedMs: this.clock.now() - started };
    }
  }

  /** The provider said slow down: no slot before `ms` from now. */
  pause(ms: number) {
    this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + Math.max(0, ms));
  }
}

let processLimiter: EmailSendLimiter | null = null;

/** The one limiter every mailer of this process shares (its rate follows the latest configuration). */
export function processEmailSendLimiter(rate: EmailSendRate): EmailSendLimiter {
  if (!processLimiter) processLimiter = new EmailSendLimiter(rate);
  else processLimiter.configure(rate);
  return processLimiter;
}
