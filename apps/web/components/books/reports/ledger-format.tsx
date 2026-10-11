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
    const isZero = (value: string) => /^-?0*(\.0*)?$/.test(value.trim());
    /** The locale's accounting form of an amount without its currency symbol: negatives in brackets where the locale does that. */
    const figure = (value: string) => money.formatToParts(value as unknown as number)
      .filter((part, index, parts) => part.type !== "currency" && !(part.type === "literal" && /^\s+$/.test(part.value)
        && (parts[index - 1]?.type === "currency" || parts[index + 1]?.type === "currency")))
      .map((part) => part.value).join("").trim();
    const percent = new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return {
      currency,
      /** A statement figure: the locale's accounting form without the currency (it is in the header), a dash for zero. */
      figure: (value: string | null | undefined) => (empty(value) ? "" : isZero(value) ? "–" : figure(value)),
      /** A percentage given as decimal text with one place ("23.5" → 23.5 %). */
      percent: (value: string | null | undefined) => (empty(value) ? "–" : percent.format(Number(value) / 100)),
      /** Decimal text below zero (and not zero). */
      negative: (value: string | null | undefined) => !empty(value) && value.trim().startsWith("-") && !isZero(value),
      /** An amount with its currency; negative amounts in brackets. */
      money: (value: string | null | undefined) => (empty(value) ? "" : money.format(value as unknown as number)),
      /** An amount without the currency (report columns, where the currency is in the title). */
      amount: (value: string | null | undefined) => (empty(value) ? "" : plain.format(value as unknown as number)),
      /** Blank for zero (debit and credit columns). */
      amountOrBlank: (value: string | null | undefined) => (empty(value) || /^-?0+(\.0+)?$/.test(value) ? "" : plain.format(value as unknown as number)),
      day: (value: string | null | undefined) => (value ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00Z`)) : ""),
      /** A month as a column header ("Oct 2026"). */
      month: (value: string | null | undefined) => (value ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00Z`)) : ""),
      /** A period as people read it ("1 Oct 2026 – 31 Oct 2026"). */
      period: (from: string | null | undefined, to: string | null | undefined) => {
        if (!from || !to) return "";
        try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).formatRange(new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`)); }
        catch { return `${from} – ${to}`; }
      },
    };
  }, [currency, locale]);
}
export type LedgerFormat = ReturnType<typeof useLedgerFormat>;
