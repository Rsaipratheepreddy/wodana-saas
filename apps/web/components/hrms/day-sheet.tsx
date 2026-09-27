"use client";

import { useState } from "react";
import { Time } from "@internationalized/date";
import type { AttendanceDay, AttendanceEvent, AttendanceHistory, AttendanceSession } from "@wodana/contracts";
import { Button, ControlledModalDialog, InlineNotice, InspectorSheet, SelectField, TextAreaField, TimeField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { HrmsApi } from "@/lib/hrms/api";
import { localDay, wallTime, zonedInstant } from "@/lib/hrms/client";
import { useHrmsFormat } from "./hrms-format";
import { DayStatus, ReviewStatus, dayState, useHrmsLabels } from "./hrms-labels";
import { EvidencePhoto, Facts } from "./hrms-controls";
import styles from "./hrms.module.css";

const MIN_REASON = 3;

/** One day's record from a month of history: its events (by when they took effect) and the reviews asked about them. */
export function dayRecord(day: AttendanceDay, history: AttendanceHistory) {
  const onDay = (value: string) => localDay(day.timezone, new Date(value)) === day.date;
  const events = history.events.filter((event) => event.sessionId && onDay(event.effectiveAt)).sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
  const sessionIds = new Set([...events.map((event) => event.sessionId), ...history.sessions.filter((session) => onDay(session.startedAt)).map((session) => session.id)]);
  const eventIds = new Set(events.map((event) => event.id));
  const reviews = history.reviews.filter((review) => (review.eventId ? eventIds.has(review.eventId) : sessionIds.has(review.sessionId)));
  const open = history.sessions.find((session) => !session.endedAt && onDay(session.startedAt)) ?? null;
  return { events, reviews, open };
}

/** A day of my attendance: when I came and went, where, the photos and locations, and what I've asked to correct. */
export function DaySheet({ api, day, history, today, onClose, onChanged }: {
  api: HrmsApi; day: AttendanceDay; history: AttendanceHistory; today: string; onClose: () => void; onChanged: () => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const labels = useHrmsLabels();
  const [asking, setAsking] = useState<"correction" | "missing_checkout" | null>(null);
  const zone = day.timezone;
  const { events, reviews, open } = dayRecord(day, history);
  const placeOf = (event: AttendanceEvent) => {
    const segment = history.segments.find((item) => item.startEventId === event.id) ?? history.segments.find((item) => item.endEventId === event.id);
    return event.evidence.location?.name ?? segment?.context.location?.name ?? (segment ? labels.mode(segment.mode) : "");
  };
  // A session left open on an earlier day is closed by asking for its check-out time.
  const missing = open && day.date !== today && !reviews.some((review) => review.kind === "missing_checkout" && review.status === "pending" && review.sessionId === open.id) ? open : null;
  const where = day.breakdown.length ? day.breakdown.map((item) => [item.name, format.duration(item.minutes)].filter(Boolean).join(" · ")).join(", ") : day.place ?? "";
  return <InspectorSheet isOpen size="md" title={format.longDay(day.date)} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={events.length || missing ? <div className="wd-dialog-actions"><span className={styles.spacer} />
      {missing ? <Button onPress={() => setAsking("missing_checkout")}>{t("Missing check-out")}</Button> : null}
      {events.length ? <Button onPress={() => setAsking("correction")}>{t("Ask for correction")}</Button> : null}
    </div> : null}>
    <div className={styles.sheet}>
      <Facts items={[
        [t("Status"), <DayStatus key="status" state={dayState(day)} />],
        day.firstIn ? [t("In"), format.time(day.firstIn, zone)] : null,
        day.lastOut ? [t("Out"), format.time(day.lastOut, zone)] : null,
        day.elapsedMinutes > 0 ? [t("Hours"), format.duration(day.elapsedMinutes)] : null,
        where ? [t("Where"), where] : null,
        day.leaveType ? [t("Leave"), day.leaveType] : null,
      ]} />
      {events.length ? <section className={styles.part} aria-label={t("Events")}>
        <h3 className={styles.subhead}>{t("Events")}</h3>
        <ul className={styles.list}>{events.map((event) => <li key={event.id}>
          <span className={styles.number}>{format.time(event.effectiveAt, zone)}</span>
          <span className={styles.grow}><span>{[labels.event(event.kind), placeOf(event)].filter(Boolean).join(" · ")}</span>
            <small>{[labels.location(event.evidence.arrival?.status), event.effectiveAt !== event.originalAt ? t("Corrected from {time}", { time: format.time(event.originalAt, zone) }) : "", event.note].filter(Boolean).join(" · ")}</small></span>
          {event.captureId && event.evidence.photoCaptured ? <EvidencePhoto src={api.photoUrl(event.captureId)} alt={t("Photo at {time}", { time: format.time(event.effectiveAt, zone) })} /> : null}
        </li>)}</ul>
      </section> : null}
      {reviews.length ? <section className={styles.part} aria-label={t("Reviews")}>
        <h3 className={styles.subhead}>{t("Reviews")}</h3>
        <ul className={styles.list}>{reviews.map((review) => <li key={review.id}>
          <span className={styles.grow}><span>{[labels.review(review.kind), review.requestedAt ? format.time(review.requestedAt, zone) : ""].filter(Boolean).join(" · ")}</span>
            <small>{[review.reason, review.decisionReason].filter(Boolean).join(" · ")}</small></span>
          <ReviewStatus status={review.status} />
        </li>)}</ul>
      </section> : null}
    </div>
    {asking ? <ReviewRequestDialog api={api} kind={asking} day={day} events={events} session={missing} onClose={() => setAsking(null)}
      onSent={() => { setAsking(null); onChanged(); }} /> : null}
  </InspectorSheet>;
}

const toTime = (value: string) => { const [hour, minute] = value.split(":").map(Number); return new Time(hour, minute); };
const hhmm = (value: Time) => `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;

/** Ask for a check-in or check-out time to be corrected, or for the check-out I missed; a manager decides. */
function ReviewRequestDialog({ api, kind, day, events, session, onClose, onSent }: {
  api: HrmsApi; kind: "correction" | "missing_checkout"; day: AttendanceDay; events: AttendanceEvent[]; session: AttendanceSession | null; onClose: () => void; onSent: () => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const labels = useHrmsLabels();
  const zone = day.timezone;
  const [actionId] = useState(() => crypto.randomUUID());
  const [eventId, setEventId] = useState<string | null>(events[0]?.id ?? null);
  const event = events.find((item) => item.id === eventId) ?? null;
  const [time, setTime] = useState<Time | null>(() => (kind === "correction" ? (events[0] ? toTime(wallTime(events[0].effectiveAt, zone)) : null) : toTime(session?.calendar.dayEnd ?? "18:00")));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const at = time ? zonedInstant(day.date, hhmm(time), zone) : null;
  const [openedAt] = useState(() => Date.now());
  const future = Boolean(at && at.getTime() > openedAt);
  const ready = Boolean(at) && !future && reason.trim().length >= MIN_REASON && (kind === "missing_checkout" ? Boolean(session) : Boolean(event));
  const send = async () => {
    if (!at) return;
    setBusy(true); setError("");
    try {
      await api.requestReview({ actionId, kind, sessionId: kind === "correction" ? event!.sessionId : session!.id, ...(kind === "correction" ? { eventId: event!.id } : {}),
        requestedAt: at.toISOString(), reason: reason.trim() });
      onSent();
    } catch (cause) { setError(format.failure(cause, t("Could not send."))); setBusy(false); }
  };
  return <ControlledModalDialog isOpen size="md" title={kind === "correction" ? t("Ask for correction") : t("Missing check-out")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!ready} onPress={() => void send()}>{t("Send request")}</Button></div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {kind === "correction" ? <SelectField label={t("Event")} isRequired selectedKey={eventId} placeholder={t("Choose")}
        onSelectionChange={(key) => { const next = events.find((item) => item.id === key); setEventId(next?.id ?? null); if (next) setTime(toTime(wallTime(next.effectiveAt, zone))); }}
        items={events.map((item) => ({ id: item.id, label: `${labels.event(item.kind)} · ${format.time(item.effectiveAt, zone)}` }))} /> : null}
      <TimeField label={kind === "correction" ? t("Correct time") : t("Checked out at")} isRequired value={time} onChange={(value) => setTime(value ? new Time(value.hour, value.minute) : null)}
        isInvalid={future} errorMessage={future ? t("Choose a time that has passed.") : undefined} />
      <TextAreaField label={t("Reason")} isRequired value={reason} onChange={setReason} />
    </div>
  </ControlledModalDialog>;
}
