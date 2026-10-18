import { BadRequestException } from "@nestjs/common";
import { FINANCE_REQUEST_REFERENCE } from "../approvals/approval-titles";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../purchasing/orders";

/**
 * Finance requests (PLM-107–110): the pure rules — kinds, statuses and who moves them, how an invoice's
 * tax-exclusive amounts add up, and the field checks every command shares. No database here.
 */
export const REQUEST_KINDS = ["invoice", "refund", "payable"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const REQUEST_STATUSES = ["new", "in_progress", "needs_info", "done", "rejected"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const INVOICE_KINDS = ["standard", "progress", "web_order"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];
export const MATERIAL_LOCATIONS = ["factory", "office", "project"] as const;
export type MaterialLocation = (typeof MATERIAL_LOCATIONS)[number];
export const FILE_KINDS = ["quote", "tax_invoice", "proof", "other"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** What Finance does to a request; the requester never moves its status. */
export const FINANCE_ACTIONS = ["start", "ask", "done", "reject"] as const;
export type FinanceAction = (typeof FINANCE_ACTIONS)[number];

/** The approval-engine kind a request kind is approved under (an invoice needs none). */
export const APPROVAL_KIND: Record<RequestKind, "refund" | "payable_request" | null> = { invoice: null, refund: "refund", payable: "payable_request" };

/** FR-0007: a request's reference. */
// The approval engine reads a request's live title with the same prefix and width (approval-titles).
export const requestReference = (number: number) => `${FINANCE_REQUEST_REFERENCE.prefix}${String(number).padStart(FINANCE_REQUEST_REFERENCE.digits, "0")}`;

const OPEN: readonly RequestStatus[] = ["new", "in_progress", "needs_info"];
export const isOpen = (status: RequestStatus) => OPEN.includes(status);

/**
 * Where a Finance action takes a request, or why it can't: in progress from new; back to the requester
 * from new or in progress; done from new or in progress; rejected while open.
 */
export function nextStatus(status: RequestStatus, action: FinanceAction): RequestStatus {
  if (action === "start") {
    if (status !== "new") throw new BadRequestException("Only a new request is started.");
    return "in_progress";
  }
  if (action === "ask") {
    if (status !== "new" && status !== "in_progress") throw new BadRequestException("Only a request Finance is working on goes back to its requester.");
    return "needs_info";
  }
  if (action === "done") {
    if (status !== "new" && status !== "in_progress") throw new BadRequestException(status === "needs_info" ? "It's waiting for its requester." : "This request is closed.");
    return "done";
  }
  if (!isOpen(status)) throw new BadRequestException("This request is closed.");
  return "rejected";
}

export type LineInput = { description: string; quantity: string; unitPrice: string };
export type PricedLine = LineInput & { amount: string };

/** Each line at the currency's precision (quantity × unit price), and the request's net, tax and total. */
export function invoiceAmounts(lines: LineInput[], taxRate: string, currency: string) {
  const places = currencyDecimals(currency);
  const priced: PricedLine[] = lines.map((line) => ({ ...line, amount: Dec.of(line.quantity).mul(line.unitPrice).round(places).toFixed(4) }));
  const net = priced.reduce((sum, line) => sum.add(line.amount), Dec.ZERO).round(places);
  const tax = net.mul(taxRate).div(100).round(places);
  return { lines: priced, net: net.toFixed(4), tax: tax.toFixed(4), total: net.add(tax).toFixed(4) };
}

/** A refund's items add up to its value. */
export function refundTotal(lines: Array<{ amount: string }>, currency: string) {
  return lines.reduce((sum, line) => sum.add(line.amount), Dec.ZERO).round(currencyDecimals(currency)).toFixed(4);
}

/** The part of an amount the client pays that is before tax (a payment stage is what the client pays). */
export function netOfTax(gross: string, taxRate: string, currency: string) {
  return Dec.of(gross).div(Dec.ONE.add(Dec.of(taxRate).div(100))).round(currencyDecimals(currency)).toFixed(4);
}

/** A supplier's balance after what is paid now. */
export function balanceAfter(total: string, payNow: string) {
  return Dec.of(total).sub(payNow).toFixed(4);
}

/** The day a refund is expected: the days the firm set, from when it was approved (or submitted). Null when not set. */
export function expectedRefundOn(from: string | null, days: number | null) {
  if (!from || !days) return null;
  return new Date(Date.parse(`${from.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- field checks

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} is not valid.`);
  return value;
}

export function optionalUuid(value: unknown, label: string) {
  return value === null || value === undefined || value === "" ? null : uuid(value, label);
}

export function text(value: unknown, max: number, label: string) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new BadRequestException(`${label} is not valid.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BadRequestException(`${label} is too long (up to ${max} characters).`);
  return trimmed;
}

export function email(value: unknown, label: string) {
  const typed = text(value, 320, label);
  if (typed && !EMAIL.test(typed)) throw new BadRequestException(`${label} is not an email address.`);
  return typed;
}

/** An amount in the currency's own minor units (never more decimals than it uses), as exact text. */
export function money(value: unknown, label: string, currency: string, options: { allowZero?: boolean } = {}) {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!NUMBER.test(raw)) throw new BadRequestException(`${label} must be a number with up to 4 decimals.`);
  if (Dec.of(raw).round(currencyDecimals(currency)).cmp(raw) !== 0) throw new BadRequestException(`${label} has more decimals than ${currency} uses.`);
  if (!options.allowZero && Dec.of(raw).cmp(0) <= 0) throw new BadRequestException(`${label} must be more than zero.`);
  return Dec.of(raw).toFixed(4);
}

export function optionalMoney(value: unknown, label: string, currency: string) {
  return value === null || value === undefined || value === "" ? null : money(value, label, currency);
}

export function quantity(value: unknown, label: string) {
  const raw = value === undefined || value === null || value === "" ? "1" : typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!NUMBER.test(raw) || Dec.of(raw).cmp(0) <= 0) throw new BadRequestException(`${label} must be more than zero.`);
  return Dec.of(raw).toFixed(4);
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], message: string): T {
  if (!allowed.includes(value as T)) throw new BadRequestException(message);
  return value as T;
}
