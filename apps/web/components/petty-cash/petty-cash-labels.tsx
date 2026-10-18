"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import type { ClaimStatus, PettyCashCategory } from "@/lib/petty-cash/types";
import styles from "./petty-cash.module.css";

export const CATEGORIES: PettyCashCategory[] = ["transport", "food", "materials", "tools", "fees", "other"];

export function useCategoryLabels(): Record<PettyCashCategory, string> {
  const t = useT();
  return { transport: t("Transport"), food: t("Food"), materials: t("Materials"), tools: t("Tools"), fees: t("Fees"), other: t("Other") };
}

const TONES: Record<ClaimStatus, "neutral" | "warning" | "info" | "danger" | "success"> = {
  draft: "neutral", submitted: "warning", approved: "info", rejected: "danger", reimbursed: "success",
};

/** Where a claim stands: one word, its tone reinforcing it. */
export function ClaimStatusLabel({ status }: { status: ClaimStatus }) {
  const t = useT();
  const labels: Record<ClaimStatus, string> = { draft: t("Draft"), submitted: t("Submitted"), approved: t("Approved"), rejected: t("Rejected"), reimbursed: t("Reimbursed") };
  return <span className={styles.status} data-tone={TONES[status]}>{labels[status]}</span>;
}
