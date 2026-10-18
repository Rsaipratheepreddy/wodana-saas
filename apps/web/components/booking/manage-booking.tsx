"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { CalendarPlus, CircleCheck } from "lucide-react";
import { Badge, Button, Callout, ConfirmationDialog, TextAreaField } from "@/design-system";
import { browserZone, type ManageView, type PublicSlot } from "@/lib/booking/booking";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { BookingFacts, ChosenTime } from "./public-booking";
import { SlotPicker } from "./slot-picker";
import styles from "./booking.module.css";

/** The visitor's own booking, from the signed link: add it to a calendar, move it, or cancel it. */
export function ManageBooking({ data, workspace, token, slots }: { data: ManageView; workspace: string; token: string; slots?: PublicSlot[] }) {
  const t = useT();
  const [booking, setBooking] = useState(data.booking);
  const [visitorZone, setVisitorZone] = useState(data.booking.visitorTimeZone);
  useEffect(() => { setVisitorZone(browserZone(data.booking.visitorTimeZone)); }, [data.booking.visitorTimeZone]);
  const [moving, setMoving] = useState(false);
  const [slot, setSlot] = useState<PublicSlot | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const live = booking.status === "pending" || booking.status === "confirmed";

  const send = async (action: "cancel" | "reschedule", body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/book/${workspace}/manage/${token}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: booking.version, ...body }) });
      const result = await response.json().catch(() => ({}));
      if (response.status === 409 && result.code === "slot_taken") { setSlot(null); setReloadKey((key) => key + 1); throw new Error(t("That time was just taken. Choose another time")); }
      if (!response.ok) throw new Error(result.message ?? t("Please try again."));
      return result;
    } catch (failure) { setError(failure instanceof Error ? translateKnown(t, failure.message) : t("Please try again.")); return null; }
    finally { setBusy(false); }
  };
  const move = async () => {
    if (!slot) return;
    const result = await send("reschedule", { start: slot.start, timeZone: visitorZone });
    if (result) { setBooking((current) => ({ ...current, start: result.start, end: result.end, version: result.version })); setMoving(false); setSlot(null); setNotice(t("Your booking has a new time.")); }
  };
  const cancel = async () => {
    const result = await send("cancel", reason.trim() ? { reason: reason.trim() } : {});
    setConfirmCancel(false);
    if (result) { setBooking((current) => ({ ...current, status: "cancelled", version: result.version, canChange: false })); setNotice(t("Your booking is cancelled.")); }
  };
  const statusLabel = { pending: t("Waiting for confirmation"), confirmed: t("Confirmed"), cancelled: t("Cancelled"), completed: t("Completed"), no_show: t("Missed") }[booking.status];

  return <main className={styles.page}>
    <div className={styles.panel}>
      <header className={styles.heading}>
        {data.branding.logoUrl ? <div className={styles.brand}><Image src={data.branding.logoUrl} alt={t("{name} logo", { name: data.branding.displayName })} width={140} height={56} unoptimized /></div>
          : data.branding.displayName ? <div className={styles.brand}><span>{data.branding.displayName}</span></div> : null}
        <h1>{data.type.name}</h1>
        <BookingFacts durationMinutes={data.type.durationMinutes} locationKind={data.type.locationKind} locationDetail={data.type.locationDetail} visitorZone={visitorZone} firmTimeZone={data.timeZone} />
      </header>
      {notice ? <Callout tone="success" title={notice}>{booking.status === "cancelled" ? t("We are sorry to miss you.") : t("A new invitation is on its way to your email.")}</Callout> : null}
      <ChosenTime slot={{ start: booking.start, end: booking.end }} visitorZone={visitorZone} firmTimeZone={data.timeZone}
        action={<Badge tone={booking.status === "cancelled" || booking.status === "no_show" ? "danger" : booking.status === "pending" ? "warning" : "success"}>{statusLabel}</Badge>} />
      {error ? <Callout tone="danger" title={t("Not changed")}>{error}</Callout> : null}
      {live && !booking.canChange && booking.reason ? <Callout tone="info" title={t("This booking can't be changed online")}>{translateKnown(t, booking.reason)}</Callout> : null}
      {moving ? <>
        <SlotPicker workspace={workspace} typeSlug={data.type.slug} firmTimeZone={data.timeZone} visitorZone={visitorZone} windowDays={data.type.windowDays} value={slot} onChange={setSlot} slots={reloadKey ? undefined : slots} reloadKey={reloadKey} />
        <div className={styles.footer}>
          <Button variant="quiet" onPress={() => { setMoving(false); setSlot(null); }}>{t("Cancel")}</Button>
          <Button variant="primary" isDisabled={!slot} isLoading={busy} onPress={() => void move()}>{t("Move to this time")}</Button>
        </div>
      </> : live ? <div className={styles.doneActions}>
        <a className={styles.linkButton} data-primary href={`/api/book/${workspace}/manage/${token}/ics`} download="booking.ics"><CalendarPlus size={15} aria-hidden="true" />{t("Add to calendar")}</a>
        {booking.canChange ? <>
          <Button onPress={() => { setMoving(true); setNotice(""); }}>{t("Reschedule")}</Button>
          <Button variant="danger" onPress={() => setConfirmCancel(true)}>{t("Cancel booking")}</Button>
        </> : null}
      </div> : <section className={styles.done}><CircleCheck size={32} aria-hidden="true" /><p>{statusLabel}</p></section>}
      <ConfirmationDialog isOpen={confirmCancel} onOpenChange={setConfirmCancel} title={t("Cancel this booking?")} confirmLabel={t("Cancel booking")} isConfirming={busy} onConfirm={() => void cancel()}
        body={<TextAreaField label={t("Reason (optional)")} value={reason} onChange={setReason} />} />
      <p className={styles.powered}>{t("Powered by Wodana")}</p>
    </div>
  </main>;
}
