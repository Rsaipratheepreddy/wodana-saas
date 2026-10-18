/**
 * AI credit arithmetic. One credit is US$0.001 of model cost; balances and ledger amounts are numeric(14,4)
 * in the database and decimal strings here, computed with integers (1 unit = 0.0001 credit), never floats.
 */
import type { AiUsage } from "./ai-provider";

const SCALE = 4;
const FACTOR = 10n ** BigInt(SCALE);
const DECIMAL = /^(-)?(\d{1,10})(?:\.(\d{1,4}))?$/;

/** Up to ten whole digits and four decimals, optionally signed. */
export function isCreditAmount(value: unknown): value is string {
  return typeof value === "string" && DECIMAL.test(value.trim());
}

/** A decimal string (as Postgres returns numeric) in 0.0001-credit units. */
export function toUnits(value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value * FACTOR;
  const text = String(value).trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new RangeError(`Not a credit amount: ${text}`);
  const fraction = (match[3] ?? "").padEnd(SCALE + 1, "0");
  let units = BigInt(match[2]) * FACTOR + BigInt(fraction.slice(0, SCALE));
  // Half up on the fifth decimal (Postgres round()).
  if (Number(fraction[SCALE]) >= 5) units += 1n;
  return match[1] ? -units : units;
}

export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const whole = absolute / FACTOR;
  const fraction = (absolute % FACTOR).toString().padStart(SCALE, "0");
  return `${negative && absolute ? "-" : ""}${whole}.${fraction}`;
}

export const normalizeCredits = (value: string | number) => fromUnits(toUnits(value));

export function compareCredits(left: string, right: string) {
  const a = toUnits(left), b = toUnits(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

export type ModelRate = { inputPerMillion: string; outputPerMillion: string };

/**
 * What a call costs: tokens × the model's rate (credits per million tokens), rounded half up to 0.0001.
 * Rates are exact to four decimals, so the product is exact before the one rounding step.
 */
export function usageCredits(usage: AiUsage, rate: ModelRate): string {
  const input = BigInt(Math.max(0, Math.trunc(usage.input_tokens || 0)));
  const output = BigInt(Math.max(0, Math.trunc(usage.output_tokens || 0)));
  const scaled = input * toUnits(rate.inputPerMillion) + output * toUnits(rate.outputPerMillion);
  const million = 1_000_000n;
  return fromUnits((scaled + million / 2n) / million);
}

/** Credits per million tokens from a list price in US$ per million tokens and the margin: 1 credit = US$0.001. */
export function creditsPerMillion(listUsdPerMillion: string, margin: string): string {
  const product = toUnits(listUsdPerMillion) * toUnits(margin) * 1000n;
  return fromUnits((product + FACTOR / 2n) / FACTOR);
}

/** The low-balance line: the workspace's own number, or 20% of the balance after its last grant or top-up. */
export function lowBalanceThreshold(account: { lowBalanceThreshold: string | null; lastTopUpBalance: string | null }) {
  if (account.lowBalanceThreshold !== null) return normalizeCredits(account.lowBalanceThreshold);
  const base = toUnits(account.lastTopUpBalance ?? "0");
  return fromUnits(base > 0n ? (base * 20n + 50n) / 100n : 0n);
}

export type CreditNotice = "low" | "exhausted";
export type NoticeState = { lowNotified: boolean; exhaustedNotified: boolean };

/**
 * Which notice a new balance calls for, told once per crossing: "low" when the balance is at or below
 * the line, "exhausted" when it is at or below zero. Going back above a line (a top-up) re-arms it.
 */
export function creditNoticeFor(balance: string, threshold: string, state: NoticeState): { notice: CreditNotice | null } & NoticeState {
  const units = toUnits(balance);
  let lowNotified = state.lowNotified && units <= toUnits(threshold);
  let exhaustedNotified = state.exhaustedNotified && units <= 0n;
  let notice: CreditNotice | null = null;
  if (units <= 0n) {
    if (!exhaustedNotified) notice = "exhausted";
    exhaustedNotified = true;
    lowNotified = true;
  } else if (units <= toUnits(threshold) && !lowNotified) {
    notice = "low";
    lowNotified = true;
  }
  return { notice, lowNotified, exhaustedNotified };
}

/** Whole credits for a notice ("182"), rounded down so a notice never shows more than is left. */
export function wholeCredits(value: string) {
  const units = toUnits(value);
  const whole = units / FACTOR;
  return (units < 0n && units % FACTOR !== 0n ? whole - 1n : whole).toString();
}
