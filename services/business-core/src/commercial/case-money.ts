import { BadRequestException } from "@nestjs/common";
import { Dec } from "../catalog-core/decimal";
import { isCurrencyCode } from "../common/regional.validators";
import { currencyDecimals } from "../common/currency";
import { number, text } from "./commercial.domain";

/**
 * A money amount for the case snapshot, rounded exactly (decimal, half away from zero) to the
 * currency's minor units, never with float math. Without a known currency it keeps two places.
 */
export function roundAmount(value: unknown, currencyCode?: string) {
  return Dec.of(number(value)).round(currencyCode ? currencyDecimals(currencyCode) : 2).toNumber();
}

/** The exact total of amounts, rounded like roundAmount. */
export function sumAmounts(values: number[], currencyCode?: string) {
  return roundAmount(values.reduce((total, value) => total.add(value), Dec.ZERO).toNumber(), currencyCode);
}

/** Whether two amounts are the same money once rounded to the currency's minor units (no float equality). */
export function sameAmount(a: number | string, b: number | string, currencyCode?: string) {
  const places = currencyCode ? currencyDecimals(currencyCode) : 2;
  return Dec.of(a).round(places).cmp(Dec.of(b).round(places)) === 0;
}

/**
 * Splits a total into shares by percent, exactly in the currency's minor units (half away from zero). The
 * last share takes what is left, so the shares always add up to the total: a receipt for "the rest" matches.
 */
export function splitByPercent(total: number | string, percents: number[], currencyCode?: string): number[] {
  const places = currencyCode ? currencyDecimals(currencyCode) : 2;
  const whole = Dec.of(total).round(places);
  let allocated = Dec.ZERO;
  return percents.map((percent, index) => {
    const share = index === percents.length - 1 ? whole.sub(allocated) : whole.mul(percent).div(100).round(places);
    allocated = allocated.add(share);
    return share.toNumber();
  });
}

/** Any ISO 4217 currency, never a fixed regional list. */
export function caseCurrency(value: unknown) {
  const code = text(value, 3, true).toUpperCase();
  if (!isCurrencyCode(code)) throw new BadRequestException("Choose a supported currency.");
  return code;
}
