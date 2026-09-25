import { UnprocessableEntityException } from "@nestjs/common";

export type TaxModel = { model: "vat" | "gst" | "sales_tax" | "none" | string; label: string | null; registrationLabel: string | null };
export type TaxRateInput = { code: string; label: string; rate: string | number; isDefault: boolean };
export const DOCUMENT_TYPES = ["QUOTATION", "INVOICE", "PURCHASE_ORDER"] as const;

/** Rates are strings of up to 4 decimals between 0 and 100; exactly one default; codes unique. */
export function validateTaxRates(model: TaxModel, rates: TaxRateInput[]) {
  if (model.model === "none" && rates.length) throw new UnprocessableEntityException("This country has no sales tax, so rates cannot be added");
  const codes = new Set<string>();
  const normalized = rates.map((rate) => {
    const code = rate.code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!code) throw new UnprocessableEntityException("Every rate needs a name");
    if (codes.has(code)) throw new UnprocessableEntityException(`Two rates are called ${rate.label}`);
    codes.add(code);
    const text = String(rate.rate).trim();
    if (!/^\d{1,3}(\.\d{1,4})?$/.test(text) || Number(text) > 100) throw new UnprocessableEntityException(`${rate.label}: enter a rate between 0 and 100`);
    return { code, label: rate.label.trim(), rate: text, isDefault: Boolean(rate.isDefault) };
  });
  if (normalized.length && normalized.filter((rate) => rate.isDefault).length !== 1) throw new UnprocessableEntityException("Choose exactly one default rate");
  return normalized;
}

export type SequenceInput = { prefix: string; padding: number; resetPolicy: "never" | "annual"; nextNumber?: number };

/** Prefix is short and printable; a yearly reset needs {YYYY} in the prefix so numbers never repeat. */
export function validateSequence(input: SequenceInput, current: { nextNumber: number; currentPeriod: number | null }) {
  const prefix = input.prefix.trim();
  if (!prefix || prefix.length > 40 || !/^[\p{L}\p{N}{}\-_/. ]+$/u.test(prefix)) throw new UnprocessableEntityException("Use letters, numbers, - _ / . and {YYYY} in the prefix");
  if (!Number.isInteger(input.padding) || input.padding < 1 || input.padding > 12) throw new UnprocessableEntityException("Digits must be between 1 and 12");
  if (input.resetPolicy === "annual" && !prefix.includes("{YYYY}")) throw new UnprocessableEntityException("A yearly reset needs {YYYY} in the prefix so numbers never repeat");
  if (input.nextNumber !== undefined) {
    if (!Number.isInteger(input.nextNumber) || input.nextNumber < 1) throw new UnprocessableEntityException("The next number must be 1 or more");
    if (input.nextNumber < current.nextNumber) throw new UnprocessableEntityException(`Numbers only move forward; the next number is already ${current.nextNumber}`);
  }
  return { prefix, padding: input.padding, resetPolicy: input.resetPolicy, nextNumber: input.nextNumber ?? current.nextNumber };
}

export function previewNumber(prefix: string, padding: number, next: number, year: number) {
  return prefix.replaceAll("{YYYY}", String(year)) + String(next).padStart(padding, "0");
}
