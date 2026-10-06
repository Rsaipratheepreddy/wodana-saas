"use client";

import { DocumentTable, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ClientPresentation, ClientSummaryRow } from "@/lib/proposals/client";
import { money, plain } from "@/lib/quotation/format";

const SUMMARY: Record<ClientSummaryRow["key"], string> = {
  "Cost of items": "Cost of items", Markup: "Markup", "Items at cost": "Items at cost", "Our fee": "Our fee", Subtotal: "Subtotal", Discount: "Discount", Tax: "Tax", Total: "Total",
};

/**
 * R3: the price as the client reads it in the firm's disclosure mode — cost, markup and price per line, or
 * items at cost and the fee once. The same rows the PDF and the portal show; the total never changes.
 */
export function ClientPriceBreakdown({ presentation, currency, decimals, taxLabel }: { presentation: ClientPresentation; currency: string; decimals: number; taxLabel?: string }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const amount = (value: string | null) => money(value, currency, decimals, locale);
  const disclosed = presentation.mode === "disclosed_markup";
  return <DocumentTable label={t("Price breakdown")} getRowKey={(row) => row.id} rows={presentation.lines.filter((line) => !line.optional)} columns={[
    { id: "item", header: t("Item"), cell: (row) => row.title },
    { id: "quantity", header: t("Qty"), align: "end", cell: (row) => `${plain(row.quantity, locale)} ${row.unit}`.trim() },
    ...(disclosed ? [
      { id: "cost", header: t("Cost"), align: "end" as const, cell: (row: ClientPresentation["lines"][number]) => amount(row.cost) },
      { id: "markup", header: t("Markup"), align: "end" as const, cell: (row: ClientPresentation["lines"][number]) => (row.markupPercent === null ? "—" : `${plain(row.markupPercent, locale, 2)}%`) },
    ] : []),
    { id: "rate", header: presentation.mode === "fee_based" ? t("Cost") : t("Rate"), align: "end", cell: (row) => amount(row.rate) },
    { id: "amount", header: t("Amount"), align: "end", cell: (row) => amount(row.amount) },
  ]} summary={presentation.summary.map((row, index) => ({
    key: `${row.key}:${index}`,
    label: row.key === "Tax" ? `${taxLabel ?? t("Tax")}${row.rate ? ` ${plain(row.rate, locale, 2)}%` : ""}` : t(SUMMARY[row.key] as never),
    value: amount(row.amount), emphasis: row.key === "Total",
  }))} />;
}
