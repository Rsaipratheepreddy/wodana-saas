"use client";

import { useMemo, type ReactNode } from "react";
import { useDesignSystem, WorkspaceRegionProvider } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ReportEntity } from "@/lib/books/reports-client";

/**
 * `t()` for the Ledger's labels. The slices of the Ledger don't edit en.json (the integrator runs
 * `npm run i18n:extract`), so until then a new label is typed as plain text; it still renders through the
 * dictionary, and the extractor reads every `t("…")` literal here.
 */
export function useLedgerT() {
  return useT() as unknown as (key: string, values?: Record<string, string | number>) => string;
}
export type LedgerT = ReturnType<typeof useLedgerT>;

/**
 * A company's region for what is inside: its locale (with the person's language), currency and time zone, from the
 * company record and region pack, never constants. Every amount and date below formats by it.
 */
export function LedgerRegion({ entity, children }: { entity: Pick<ReportEntity, "currency" | "locale" | "timeZone"> | null | undefined; children: ReactNode }) {
  if (!entity) return <>{children}</>;
  return <WorkspaceRegionProvider locale={entity.locale || undefined} currency={entity.currency} timeZone={entity.timeZone || undefined}>{children}</WorkspaceRegionProvider>;
}

/** Money and dates by the company's region (see LedgerRegion). Amounts stay decimal text: Intl formats the exact string. */
export function useLedgerFormat() {
  const { locale, currency } = useDesignSystem();
  return useMemo(() => {
    let money: Intl.NumberFormat;
    try { money = new Intl.NumberFormat(locale, { style: "currency", currency, currencySign: "accounting" }); }
    catch { money = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    const { minimumFractionDigits, maximumFractionDigits } = money.resolvedOptions();
    const plain = new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits });
    const empty = (value: string | null | undefined): value is null | undefined | "" => value === null || value === undefined || value === "";
    return {
      currency,
      /** An amount with its currency; negative amounts in brackets. */
      money: (value: string | null | undefined) => (empty(value) ? "" : money.format(value as unknown as number)),
      /** An amount without the currency (report columns, where the currency is in the title). */
      amount: (value: string | null | undefined) => (empty(value) ? "" : plain.format(value as unknown as number)),
      /** Blank for zero (debit and credit columns). */
      amountOrBlank: (value: string | null | undefined) => (empty(value) || /^-?0+(\.0+)?$/.test(value) ? "" : plain.format(value as unknown as number)),
      day: (value: string | null | undefined) => (value ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00Z`)) : ""),
    };
  }, [currency, locale]);
}
export type LedgerFormat = ReturnType<typeof useLedgerFormat>;
