"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, Skeleton, ToggleButton, useDesignSystem } from "@/design-system";
import { dateIn, dayParts, formatDay, formatTime, slotRange, slotsByDay, type PublicSlot } from "@/lib/booking/booking";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./booking.module.css";

/**
 * Pick a day, then a time. Days and times are on the visitor's clock; the service computes the free slots
 * on the firm's calendar. `slots` may be given (a preview or test); otherwise they are loaded.
 */
export function SlotPicker({ workspace, typeSlug, firmTimeZone, visitorZone, windowDays, enquiryType, value, onChange, slots: given, reloadKey = 0 }: {
  workspace: string; typeSlug: string; firmTimeZone: string; visitorZone: string; windowDays: number; enquiryType?: string;
  value: PublicSlot | null; onChange: (slot: PublicSlot | null) => void; slots?: PublicSlot[]; reloadKey?: number;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [loaded, setLoaded] = useState<PublicSlot[] | null>(given ?? null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [day, setDay] = useState<string | null>(value ? dateIn(value.start, visitorZone) : null);

  useEffect(() => {
    if (given) { setLoaded(given); return; }
    const controller = new AbortController();
    const range = slotRange(dateIn(new Date(), firmTimeZone), windowDays);
    const query = new URLSearchParams({ ...range, ...(enquiryType ? { enquiryType } : {}) });
    setLoaded(null); setFailed(false);
    fetch(`/api/book/${workspace}/${typeSlug}/slots?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error("slots"); return (await response.json()) as { slots: PublicSlot[] }; })
      .then((result) => setLoaded(result.slots))
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [given, workspace, typeSlug, firmTimeZone, windowDays, enquiryType, reloadKey, retry]);

  const days = useMemo(() => slotsByDay(loaded ?? [], visitorZone), [loaded, visitorZone]);
  const activeDay = days.find((entry) => entry.date === day) ?? days[0] ?? null;

  if (failed) return <ErrorState title={t("Free times could not be loaded")} onRetry={() => setRetry((count) => count + 1)} />;
  if (!loaded) return <div className={styles.section} aria-busy="true"><Skeleton /><Skeleton /></div>;
  if (!days.length) return <EmptyState illustration={null} title={t("No free times in the next {days} days", { days: windowDays })} description={t("Please contact us and we will find a time.")} />;

  return <>
    <section className={styles.section} aria-labelledby="booking-day">
      <h2 id="booking-day">{t("Choose a day")}</h2>
      <ul className={styles.days}>
        {days.map((entry) => {
          const parts = dayParts(entry.date, locale);
          return <li key={entry.date}>
            <ToggleButton isSelected={entry.date === activeDay?.date} aria-label={formatDay(entry.date, locale, "long")} onPress={() => { setDay(entry.date); if (value && dateIn(value.start, visitorZone) !== entry.date) onChange(null); }}>
              <small>{parts.weekday}</small><span>{parts.date}</span>
            </ToggleButton>
          </li>;
        })}
      </ul>
    </section>
    {activeDay ? <section className={styles.section} aria-labelledby="booking-time">
      <h2 id="booking-time">{t("Choose a time")}</h2>
      <div className={styles.times} role="group" aria-label={formatDay(activeDay.date, locale, "long")}>
        {activeDay.slots.map((slot) => <ToggleButton key={slot.start} isSelected={value?.start === slot.start} onPress={() => onChange(slot)}>
          <bdi>{formatTime(slot.start, visitorZone, locale)}</bdi>
        </ToggleButton>)}
      </div>
    </section> : null}
  </>;
}
