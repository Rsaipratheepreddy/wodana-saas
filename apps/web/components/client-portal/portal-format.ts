import { useMemo } from "react";
import { useLanguage } from "@/lib/i18n/i18n-provider";
import type { PortalSite } from "@/lib/client-portal/types";

/**
 * Money, dates and numbers the way the tenant's country writes them (its region), in the language the
 * client reads. Amounts arrive as exact decimal strings and are never turned into floats for maths.
 */
export function usePortalFormat(region: PortalSite["region"]) {
  const { language } = useLanguage();
  return useMemo(() => {
    const country = region.country ? `-${region.country}` : "";
    // English keeps the tenant's regional format (en-AE, en-GB…); another language uses its own with the country.
    const locale = language === "en" ? region.locale : `${language}${country}`;
    const safe = (build: () => string, fallback: string) => { try { return build(); } catch { return fallback; } };
    const money = (value: string | number | null | undefined, currency?: string | null) => {
      if (value === null || value === undefined || value === "") return "";
      const code = currency || region.currency;
      // Intl formats a decimal string exactly (no binary rounding on the way).
      return safe(() => new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(String(value) as unknown as number), `${code} ${value}`);
    };
    const date = (value: string | null | undefined) => {
      if (!value) return "";
      // A calendar date (YYYY-MM-DD) is that day wherever the client is; a moment is shown in the tenant's time zone.
      const day = /^\d{4}-\d{2}-\d{2}$/.test(value);
      return safe(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: day ? "UTC" : region.timeZone })
        .format(new Date(day ? `${value}T00:00:00Z` : value)), value);
    };
    const number = (value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? ""
      : safe(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(String(value) as unknown as number), String(value)));
    return { locale, money: (value: string | number | null | undefined, currency?: string | null) => isolate(money(value, currency)), date, number };
  }, [language, region.country, region.currency, region.locale, region.timeZone]);
}

/**
 * A name, reference or amount set inside a sentence keeps its own direction (Unicode first-strong isolate), so
 * "Maya (QA Manager)" or "PRJ-0002" read right in an Arabic sentence and an Arabic name reads right in English.
 */
export function isolate(text: string | null | undefined) {
  return text ? `⁨${text}⁩` : "";
}

/** Whole days from one calendar date (YYYY-MM-DD) to another. */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

export type PortalFormat = ReturnType<typeof usePortalFormat>;
