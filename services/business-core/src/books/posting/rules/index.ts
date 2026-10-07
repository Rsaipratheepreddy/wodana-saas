import type { PendingEvent } from "../../ledger/ledger";
import type { RuleAdapter } from "../support";
import { labourCosted } from "./labour";
import { billApproved, billCancelled, paymentPaid, paymentReversed } from "./payables";
import { pettyCashApproved, pettyCashReimbursed } from "./petty-cash";
import { creditNoteIssued, invoiceIssued, receiptReversed, receiptVerified } from "./receivables";
import { deliveryReversed, servicesReceived, stockMoved } from "./stock";

/**
 * The posting rules in the order a sweep runs them: each rule's events come after those it builds on (a credit note
 * after invoices, a reversal after what it reverses), so one sweep posts a whole story. P15 (manual and opening
 * journals approved through E3) is posted by the manual journal module (slice A2) when it is approved, through the
 * same `postJournal`; it has no sweep adapter.
 */
export const POSTING_ADAPTERS: ReadonlyArray<RuleAdapter<PendingEvent>> = [
  receiptVerified, // P3
  invoiceIssued, // P1
  creditNoteIssued, // P2
  receiptReversed, // P4
  billApproved, // P5
  servicesReceived, // P9
  stockMoved, // P11
  billCancelled, // P6
  paymentPaid, // P7
  paymentReversed, // P8
  deliveryReversed, // P10
  pettyCashApproved, // P12
  pettyCashReimbursed, // P13
  labourCosted as RuleAdapter<PendingEvent>, // P14
];

/** The rule that posts a source event. */
export function adapterFor(sourceType: string, sourceEvent: string) {
  const rules: Record<string, Record<string, RuleAdapter<PendingEvent>>> = {
    receipt: { verified: receiptVerified, reversed: receiptReversed },
    client_invoice: { issued: invoiceIssued },
    client_credit_note: { issued: creditNoteIssued },
    supplier_bill: { approved: billApproved, cancelled: billCancelled },
    supplier_payment: { paid: paymentPaid, reversed: paymentReversed },
    goods_receipt: { received: servicesReceived, reversed: deliveryReversed },
    stock_batch: { moved: stockMoved },
    petty_cash: { approved: pettyCashApproved, reimbursed: pettyCashReimbursed },
    labour: { costed: labourCosted as RuleAdapter<PendingEvent>, recosted: labourCosted as RuleAdapter<PendingEvent> },
  };
  return rules[sourceType]?.[sourceEvent] ?? null;
}
