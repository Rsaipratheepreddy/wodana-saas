"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import type { Bill, PaymentMethod, RunStatus } from "@/lib/payables/types";
import { subtractExact } from "@/lib/purchasing/amounts";
import styles from "./finance.module.css";

type Tone = "neutral" | "info" | "warning" | "success" | "danger";

/**
 * Where an invoice stands for the people who pay: its state, or once approved, how much is paid and
 * whether it's late. Retention held until handover is never late; when it's all that's left, it says so.
 */
export function billState(bill: Bill, today: string): { key: string; tone: Tone } {
  if (bill.status !== "approved") return { key: bill.status, tone: bill.status === "held" ? "warning" : bill.status === "cancelled" ? "danger" : "neutral" };
  if (Number(bill.balance) <= 0) return { key: "paid", tone: "success" };
  if (subtractExact(bill.balance, bill.retentionHeld) === "0") return { key: "retention", tone: "neutral" };
  if (bill.dueDate && bill.dueDate < today) return { key: "overdue", tone: "danger" };
  return { key: Number(bill.paid) > 0 ? "part_paid" : "to_pay", tone: "info" };
}

export function BillStatusLabel({ bill, today }: { bill: Bill; today: string }) {
  const t = useT();
  const labels: Record<string, string> = {
    draft: t("Draft"), held: t("Held"), cancelled: t("Cancelled"), paid: t("Paid"), overdue: t("Overdue"), part_paid: t("Part paid"), to_pay: t("To pay"), retention: t("Retention"),
  };
  const state = billState(bill, today);
  return <span className={styles.status} data-tone={state.tone}>{labels[state.key]}</span>;
}

const RUN_TONES: Record<RunStatus, Tone> = { draft: "neutral", submitted: "warning", approved: "info", paid: "success", cancelled: "danger" };

export function RunStatusLabel({ status }: { status: RunStatus }) {
  const t = useT();
  const labels: Record<RunStatus, string> = { draft: t("Draft"), submitted: t("Submitted"), approved: t("Approved"), paid: t("Paid"), cancelled: t("Cancelled") };
  return <span className={styles.status} data-tone={RUN_TONES[status]}>{labels[status]}</span>;
}

export function useMethodLabels(): Record<PaymentMethod, string> {
  const t = useT();
  return { bank: t("Bank transfer"), cheque: t("Cheque"), cash: t("Cash"), card: t("Card"), other: t("Other") };
}

/** A decimal string without trailing zeros ("4.5000" → "4.5"). */
export const plain = (value: string) => (value.includes(".") ? value.replace(/\.?0+$/, "") : value) || "0";
