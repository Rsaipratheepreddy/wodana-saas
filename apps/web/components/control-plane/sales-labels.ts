"use client";

import { useMemo } from "react";
import type { StatusTone } from "@/design-system";
import { useLanguage, useT } from "@/lib/i18n/i18n-provider";
import type { SalesEnquiryDetail, SalesEnquiryStatus, SalesEnquirySummary } from "@/lib/internal/sales";

type Label = { label: string; tone: StatusTone };
type NoticeStatus = SalesEnquiryDetail["notices"][number]["status"];

/** Fired with the number of new enquiries whenever a page learns it, so the portal's notice stays current. */
export const NEW_ENQUIRIES_EVENT = "wodana:sales-new-enquiries";

export function announceNewEnquiries(count: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<number>(NEW_ENQUIRIES_EVENT, { detail: count }));
}

/** A country's name in the interface language, with its code; the code alone when the name is unknown. */
export function useCountryName() {
  const { language } = useLanguage();
  return useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames([language], { type: "region" }); } catch { names = null; }
    return (code: string | null | undefined) => {
      if (!code) return "";
      const upper = code.toUpperCase();
      let name = "";
      try { name = names?.of(upper) ?? ""; } catch { name = ""; }
      return name && name !== upper ? `${name} · ${upper}` : upper;
    };
  }, [language]);
}

/** The enquiry's summary fields, for a list row that is replaced after a command. */
export function summaryOf(detail: SalesEnquiryDetail): SalesEnquirySummary {
  const { id, reference, name, email, company, countryCode, phone, teamSize, status, assignee, source, createdAt, updatedAt, version } = detail;
  return { id, reference, name, email, company, countryCode, phone, teamSize, status, assignee, source, createdAt, updatedAt, version };
}

export function useSalesLabels() {
  const t = useT();
  return useMemo(() => {
    const status: Record<SalesEnquiryStatus, Label> = {
      new: { label: t("New"), tone: "info" },
      contacted: { label: t("Contacted"), tone: "neutral" },
      qualified: { label: t("Qualified"), tone: "warning" },
      won: { label: t("Won"), tone: "success" },
      lost: { label: t("Lost"), tone: "neutral" },
    };
    /** The button that moves an enquiry forward (or closes it); a closed one only reopens. */
    const move: Record<Exclude<SalesEnquiryStatus, "new">, string> = {
      contacted: t("Mark contacted"),
      qualified: t("Mark qualified"),
      won: t("Mark won"),
      lost: t("Mark lost"),
    };
    const reopen = t("Reopen");
    const notice: Record<NoticeStatus, Label> = {
      pending: { label: t("Pending"), tone: "info" },
      sent: { label: t("Sent"), tone: "success" },
      failed: { label: t("Failed"), tone: "danger" },
      not_configured: { label: t("Not configured"), tone: "warning" },
    };
    const action: Record<string, string> = {
      received: t("Received"),
      status_changed: t("Status changed"),
      assigned: t("Assignee changed"),
      note_added: t("Note added"),
    };
    return { status, move, reopen, notice, action };
  }, [t]);
}
