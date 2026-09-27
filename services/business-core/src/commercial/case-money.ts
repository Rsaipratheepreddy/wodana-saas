import { BadRequestException } from "@nestjs/common";
import { Dec } from "../catalog-core/decimal";
import { isCurrencyCode } from "../common/regional.validators";
import { currencyDecimals } from "../purchasing/orders";
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

/** Any ISO 4217 currency, never a fixed regional list. */
export function caseCurrency(value: unknown) {
  const code = text(value, 3, true).toUpperCase();
  if (!isCurrencyCode(code)) throw new BadRequestException("Choose a supported currency.");
  return code;
}
