import { ConflictException } from "@nestjs/common";
export function verifiedInvoiceSnapshot(
  invoice: Record<string, unknown>,
  expected: {
    id: string;
    amount: number;
    currency: string;
    accountId?: string;
  },
) {
  const { total, balance } = invoice;
  if (
    String(invoice.id) !== expected.id ||
    Boolean(expected.accountId && invoice.accountId !== expected.accountId) ||
    typeof total !== "number" ||
    typeof balance !== "number" ||
    !Number.isFinite(total) ||
    !Number.isFinite(balance) ||
    balance < 0 ||
    balance > total ||
    Math.round(total * 100) !== Math.round(expected.amount * 100) ||
    invoice.currency !== expected.currency
  )
    throw new ConflictException(
      "Accounting must return this invoice with a valid balance, matching milestone total and currency.",
    );
  const status =
    typeof invoice.status === "string" ? invoice.status.toLowerCase() : "";
  if (!status)
    throw new ConflictException("Accounting did not return an invoice status.");
  let paymentUrl: string | null = null;
  if (
    typeof invoice.paymentUrl === "string" &&
    !["draft", "void", "voided", "deleted"].includes(status)
  ) {
    try {
      const url = new URL(invoice.paymentUrl);
      if (url.protocol === "https:" && !url.username && !url.password)
        paymentUrl = url.href;
    } catch {}
  }
  const settled =
    balance === 0 &&
    ["paid", "sent", "unpaid", "partially_paid"].includes(status);
  return { total, balance, status, paymentUrl, settled };
}

export function paymentIsVerified(
  payment: {
    status: string;
    invoice?: {
      accountId?: string;
      balance: number;
      refreshedAt: string;
      lastError?: string;
    };
  },
  now = Date.now(),
) {
  if (payment.status !== "verified") return false;
  if (!payment.invoice) return true;
  const checkedAt = Date.parse(payment.invoice.refreshedAt);
  return (
    Boolean(payment.invoice.accountId) &&
    payment.invoice.balance === 0 &&
    !payment.invoice.lastError &&
    Number.isFinite(checkedAt) &&
    checkedAt <= now &&
    now - checkedAt <= 86400000
  );
}
