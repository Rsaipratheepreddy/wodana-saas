"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import { deadlineText, durationParts, respondBy } from "@/lib/crm/sales-time";
import styles from "./respond-by-chip.module.css";

/** The current time, re-read every `interval` so countdowns tick while the page is open (S-5). */
export function useNow(interval = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [interval]);
  return now;
}

export function durationText(minutes: number, t: Translate) {
  const parts = durationParts(minutes);
  if (parts.unit === "min") return t("{minutes} min", { minutes: parts.minutes });
  if (parts.unit === "h") return parts.minutes ? t("{hours} h {minutes} min", { hours: parts.hours, minutes: parts.minutes }) : t("{hours} h", { hours: parts.hours });
  return t("{days} d", { days: parts.days });
}

/** S-6: "Respond by 10:00 · 42 min", amber at the warning and red once overdue. */
export function RespondByChip({ lead, now }: { lead: { slaStatus?: string | null; slaDueAt?: string | null; slaWarningAt?: string | null }; now: number }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const timer = respondBy(lead, now);
  if (!timer) return null;
  const at = deadlineText(timer.dueAt, { locale, timeZone }, new Date(now));
  const left = durationText(timer.minutesLeft, t);
  const label = timer.state === "breached" ? t("Respond by {when} · {duration} overdue", { when: at, duration: left }) : t("Respond by {when} · {duration}", { when: at, duration: left });
  return <span className={styles.chip} data-state={timer.state} title={label}><Timer aria-hidden="true" size={12} /><span>{label}</span></span>;
}
