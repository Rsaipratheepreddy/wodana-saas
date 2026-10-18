"use client";

import { useMemo } from "react";
import { useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Health, ProjectStatus } from "@/lib/project-core/types";

const DAY = 86_400_000;

/** Dates, money and the "in N days" count, in the workspace's locale and time zone. */
export function useProjectFormat() {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  return useMemo(() => {
    const today = () => {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      return Date.parse(`${parts}T00:00:00Z`);
    };
    return {
      /** Today in the workspace's time zone, as YYYY-MM-DD. */
      today: () => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
      /** The calendar day (YYYY-MM-DD) a moment falls on in the workspace's time zone. */
      dayOf: (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)),
      /** A calendar date (YYYY-MM-DD) as the workspace writes it. */
      day: (value: string | null) => (value ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00Z`)) : ""),
      /** A calendar date without the year when it's this year: "12 Oct". */
      short: (value: string | null) => {
        if (!value) return "";
        const sameYear = value.slice(0, 4) === new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric" }).format(new Date());
        return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(new Date(`${value}T00:00:00Z`));
      },
      /** A moment, as a date in the workspace's time zone. */
      when: (value: string | null) => (value ? new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : ""),
      /** A measured size or quantity (decimal text), in the workspace's digits and separators. */
      number: (value: string | number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(Number(value)),
      money: (value: string | number | null, currency: string) => {
        if (value === null || value === "") return "";
        try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(value)); } catch { return `${currency} ${value}`; }
      },
      /** How far a date is from today: "in 12 days", "today", "3 days late". */
      until: (value: string | null) => {
        if (!value) return null;
        const days = Math.round((Date.parse(`${value}T00:00:00Z`) - today()) / DAY);
        if (days === 0) return { text: t("Today"), late: false };
        if (days > 0) return { text: days === 1 ? t("Tomorrow") : t("In {count} days", { count: days }), late: false };
        return { text: days === -1 ? t("1 day late") : t("{count} days late", { count: -days }), late: true };
      },
    };
  }, [locale, timeZone, t]);
}

/** The project's status as one word: on hold and closed win over health. */
export function useStatusLabel() {
  const t = useT();
  return (status: ProjectStatus, health: Health) => {
    if (status === "on_hold") return { tone: "hold", label: t("On hold") };
    if (status === "completed") return { tone: "done", label: t("Completed") };
    if (status === "cancelled") return { tone: "done", label: t("Cancelled") };
    if (health === "at_risk") return { tone: "risk", label: t("At risk") };
    if (health === "off_track") return { tone: "off", label: t("Off track") };
    return { tone: "ok", label: t("On track") };
  };
}
