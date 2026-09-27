"use client";

import { useMemo } from "react";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Approval, Deal, PaymentTerms, Supplier } from "@/lib/purchasing/types";

/** "50.00" → "50", "12.50" → "12.5": a stored percentage as people write it. */
export const percentText = (value: string | null) => (value ? value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : "");

/** The words for approvals, payment terms and deals, and a supplier's terms and deal in one line. */
export function useSupplierLabels() {
  const t = useT();
  return useMemo(() => {
    const approval: Record<Approval, string> = { pending: t("Not reviewed"), approved: t("Approved"), not_approved: t("Not approved"), on_hold: t("On hold") };
    const terms: Record<PaymentTerms, string> = { upfront: t("Upfront"), on_delivery: t("On delivery"), split: t("Advance, rest on delivery"), credit: t("Credit"), statement: t("Monthly statement") };
    const deal: Record<Deal, string> = { none: t("None"), discount: t("Discount"), commission: t("Commission"), on_request: t("On request") };
    return {
      approval, terms, deal,
      /** The payment terms, and the retention held from each invoice when there is one. */
      termsText: (supplier: Pick<Supplier, "paymentTerms" | "advancePercent" | "creditDays"> & { retentionPercent?: string }) => [
        supplier.paymentTerms === "split" ? t("{percent}% advance, rest on delivery", { percent: percentText(supplier.advancePercent) })
          : supplier.paymentTerms === "credit" ? t("{count} days credit", { count: supplier.creditDays ?? 0 })
          : terms[supplier.paymentTerms],
        supplier.retentionPercent && Number(supplier.retentionPercent) ? t("{percent}% retention", { percent: percentText(supplier.retentionPercent) }) : "",
      ].filter(Boolean).join(" · "),
      dealText: (supplier: Pick<Supplier, "deal" | "dealPercent">) =>
        supplier.deal === "discount" ? t("{percent}% discount", { percent: percentText(supplier.dealPercent) })
          : supplier.deal === "commission" ? t("{percent}% commission", { percent: percentText(supplier.dealPercent) })
          : supplier.deal === "on_request" ? t("Discount on request") : "",
    };
  }, [t]);
}
