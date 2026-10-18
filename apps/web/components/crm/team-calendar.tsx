"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { parseDate, type CalendarDate } from "@internationalized/date";
type Day = CalendarDate | null;
import { Badge, Button, DateField, FormDialog, InspectorSheet, MoreDetails, NumericInput, SegmentedControl, SelectField, Skeleton, TextAreaField, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { RecordData } from "@/lib/crm/client";
import type { CalendarConnection } from "@/lib/crm/calendar-sources";
import { BOOKING_KINDS, BOOKING_PERSON_LABEL, BOOKING_WORK_LABEL, bookingAssignees, bookingDefaultDays, ENTRY_LABEL, isBookingKind, TEAM_LABEL, teamEntryTitle, teamRequest,
  type BookingKind, type BookingOptions, type Team, type TeamEntry, type TeamSettings } from "@/lib/crm/team-calendar";
import { FactList } from "./crm-workbench";
import styles from "./crm-calendar.module.css";

const shortDay = (day: string, locale: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

/**
 * One team calendar entry: what it is, when, for whom and who does it, with the link to its record. Render and 2D time
 * is done, moved or cancelled here by the people who book it.
 */
export function TeamEntrySheet({ workspaceId, entry, canBook, onClose, onChanged }: { workspaceId: string; entry: TeamEntry; canBook: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const booking = isBookingKind(entry.kind) && entry.status === "booked" && canBook;
  const when = entry.allDay
    ? entry.end && entry.end !== entry.start ? t("{from} – {to}", { from: shortDay(entry.start, locale), to: shortDay(entry.end, locale) }) : shortDay(entry.start, locale)
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(entry.start));
  const change = async (action: "complete" | "cancel") => {
    setBusy(action); setError("");
    try { await teamRequest(workspaceId, `bookings/${entry.recordId}/${action}`, "POST", { version: entry.version }); onChanged(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(""); }
  };
  const status: Record<string, string> = { booked: t("Booked"), done: t("Done"), active: t("In progress"), planned: t("Planned"), released: t("Released"), in_production: t("In production"),
    ready: t("Ready"), on_hold: t("On hold"), delivered: t("Delivered"), part_delivered: t("Part delivered"), not_booked: t("Not booked"), not_started: t("Not started"), in_progress: t("In progress"),
    pending: t("Scheduled"), completed: t("Completed"), presented: t("Presented"), chosen: t("Chosen"), changes_requested: t("Changes requested") };
  return <InspectorSheet isOpen title={teamEntryTitle(entry, t)} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={booking ? <div className="wd-dialog-actions">
      <Button variant="quiet" isLoading={busy === "cancel"} onPress={() => void change("cancel")}>{t("Cancel booking")}</Button>
      <Button onPress={() => setMoving(true)}>{t("Move")}</Button>
      <Button variant="primary" isLoading={busy === "complete"} onPress={() => void change("complete")}>{t("Mark done")}</Button>
    </div> : undefined}>
    <div className={styles.details}>
      <div className={styles.actions}><Badge hue="auto">{t(ENTRY_LABEL[entry.kind])}</Badge>{entry.overdue ? <Badge tone="danger">{t("Overdue")}</Badge> : null}</div>
      {error ? <p role="alert">{error}</p> : null}
      <FactList facts={[
        [t("When"), when],
        ...(entry.days ? [[t("Days needed"), entry.days === 1 ? t("1 day") : t("{count} days", { count: entry.days })] as [string, string]] : []),
        [t("Status"), status[entry.status] ?? entry.status],
        ...(entry.ownerName ? [[t("With"), entry.ownerName] as [string, string]] : []),
        ...(isBookingKind(entry.kind) ? entry.detail ? [[t("Note"), entry.detail] as [string, string]] : [] : []),
      ]} />
      <Link href={entry.href}>{t("Open the job")}</Link>
    </div>
    {moving ? <MoveBookingDialog workspaceId={workspaceId} entry={entry} onClose={() => setMoving(false)} onSaved={() => { setMoving(false); onChanged(); onClose(); }} /> : null}
  </InspectorSheet>;
}

function MoveBookingDialog({ workspaceId, entry, onClose, onSaved }: { workspaceId: string; entry: TeamEntry; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [start, setStart] = useState<CalendarDate | null>(() => parseDate(entry.start));
  const [days, setDays] = useState(entry.days ?? 1);
  return <FormDialog size="md" title={t("Move booking")} submitLabel={t("Save")} onClose={onClose} isDirty={start?.toString() !== entry.start || days !== entry.days}
    isSubmitDisabled={!start || !days} onSubmit={async () => {
      await teamRequest(workspaceId, `bookings/${entry.recordId}/move`, "POST", { version: entry.version, startsOn: start!.toString(), days });
      onSaved();
    }}>
    <DateField isRequired label={t("Starts")} value={start} onChange={(value) => setStart(value as Day)} />
    <NumericInput isRequired label={t("Days needed")} minValue={1} maxValue={60} value={days} onChange={(value) => setDays(Number.isFinite(value) ? value : 1)} />
  </FormDialog>;
}

/**
 * A designer books design time on a job and tags who does it (PLM-177): 2D design drawings one of the job's designers,
 * 3D renders the Visualiser, technical drawings the technical team. The days default to the firm's setting for each
 * kind; the work item goes to that person.
 */
export function BookDesignTimeDialog({ workspaceId, date, onClose, onSaved }: { workspaceId: string; date: string; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [options, setOptions] = useState<BookingOptions | null>(null);
  const [failure, setFailure] = useState("");
  const [caseId, setCaseId] = useState("");
  const [kind, setKind] = useState<BookingKind>("render");
  const [assignee, setAssignee] = useState("");
  const [start, setStart] = useState<CalendarDate | null>(() => parseDate(date));
  const [days, setDays] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [commandId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    const controller = new AbortController();
    teamRequest<BookingOptions>(workspaceId, "booking-options", "GET", undefined, controller.signal).then((next) => {
      setOptions(next);
      setAssignee(bookingAssignees(next, "", "render").find((person) => person.team)?.id ?? "");
    }).catch((cause: Error) => { if (!controller.signal.aborted) setFailure(cause.message); });
    return () => controller.abort();
  }, [workspaceId]);
  // The job and the work decide who is offered: the person picked stays while they still fit, else the first who does.
  const choose = (nextCase: string, nextKind: BookingKind) => {
    setCaseId(nextCase); setKind(nextKind);
    if (!options) return;
    const fit = bookingAssignees(options, nextCase, nextKind);
    if (!fit.some((person) => person.id === assignee && (person.team || !fit.some((other) => other.team)))) setAssignee(fit.find((person) => person.team)?.id ?? "");
  };
  const defaultDays = options ? bookingDefaultDays(options, kind) : 1;
  const names = new Map((options?.members ?? []).map((member) => [member.id, member.name]));
  const members = options ? bookingAssignees(options, caseId, kind).map((person) => ({ id: person.id,
    label: person.team ? t(BOOKING_PERSON_LABEL[kind], { name: names.get(person.id) ?? "" }) : names.get(person.id) ?? "" })) : [];
  return <FormDialog title={t("Book design time")} submitLabel={t("Book")} error={failure || undefined} onClose={onClose} isDirty={Boolean(caseId || note)}
    isSubmitDisabled={!options || !caseId || !assignee || !start}
    lead={!options && !failure ? <Skeleton lines={3} shape="form" /> : null}
    onSubmit={async () => {
      await teamRequest(workspaceId, "bookings", "POST", { caseId, kind, assigneeMembershipId: assignee, startsOn: start!.toString(), days: days ?? defaultDays, note: note.trim() || undefined, commandId });
      onSaved();
    }}>
    {options ? <>
      <SelectField isRequired label={t("Job")} selectedKey={caseId || null} onSelectionChange={(key) => choose(String(key ?? ""), kind)} items={options.cases.map((item) => ({ id: item.id, label: item.title }))} />
      <SegmentedControl label={t("Work")} value={kind} onChange={(value) => { choose(caseId, value as BookingKind); setDays(null); }}
        options={BOOKING_KINDS.map((id) => ({ id, label: t(BOOKING_WORK_LABEL[id]) }))} />
      <SelectField isRequired label={t("Who does it")} selectedKey={assignee || null} onSelectionChange={(key) => setAssignee(String(key ?? ""))} items={members} />
      <DateField isRequired label={t("Starts")} value={start} onChange={(value) => setStart(value as Day)} />
      <NumericInput isRequired label={t("Days needed")} description={t("Working days")} minValue={1} maxValue={60} value={days ?? defaultDays}
        onChange={(value) => setDays(Number.isFinite(value) ? value : null)} />
      <MoreDetails filled={note.trim() ? 1 : 0}><TextAreaField label={t("Note")} maxLength={500} value={note} onChange={setNote} /></MoreDetails>
    </> : null}
  </FormDialog>;
}

/**
 * Where a team calendar goes besides Wodana: one connected Google calendar (or none, everything stays in Wodana), and
 * for the design team the days the designers, the Visualiser and the technical team need by default.
 */
export function TeamCalendarSettingsDialog({ workspaceId, team, settings, connections, onClose, onSaved }: {
  workspaceId: string; team: Team; settings: TeamSettings; connections: CalendarConnection[]; onClose: () => void; onSaved: (next: TeamSettings) => void;
}) {
  const t = useT();
  const target = settings.targets[team];
  const [calendars, setCalendars] = useState<Array<{ id: string; connectionId: string; calendarId: string; label: string }> | null>(null);
  const [choice, setChoice] = useState(target.connectionId && target.calendarId ? `${target.connectionId}|${target.calendarId}` : "none");
  const [designDrawingDays, setDesignDrawingDays] = useState(settings.designDrawingDays ?? 3);
  const [renderDays, setRenderDays] = useState(settings.renderDays);
  const [drawingDays, setDrawingDays] = useState(settings.drawingDays);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const found = await Promise.all(connections.filter((connection) => ["connected", "degraded"].includes(connection.status)).map(async (connection) => {
          const response = await fetch(`/api/workspace/integration-connections/${connection.id}/tools?${new URLSearchParams({ workspaceId, kind: "calendars" })}`, { signal: controller.signal });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.message ?? t("Google calendars could not be loaded."));
          return (payload.calendars ?? []).filter((calendar: RecordData) => calendar.enabled && ["owner", "writer"].includes(String(calendar.accessRole)))
            .map((calendar: RecordData) => ({ id: `${connection.id}|${String(calendar.externalId)}`, connectionId: connection.id, calendarId: String(calendar.externalId), label: `${String(calendar.displayName)} · ${connection.displayName}` }));
        }));
        if (!controller.signal.aborted) setCalendars(found.flat());
      } catch (cause) { if (!controller.signal.aborted) { setFailure((cause as Error).message); setCalendars([]); } }
    })();
    return () => controller.abort();
  }, [workspaceId, connections, t]);
  const items = [{ id: "none", label: t("Keep it in Wodana") }, ...(calendars ?? []),
    ...(choice !== "none" && calendars && !calendars.some((item) => item.id === choice) ? [{ id: choice, label: target.calendarId ?? choice }] : [])];
  const initial = target.connectionId && target.calendarId ? `${target.connectionId}|${target.calendarId}` : "none";
  return <FormDialog size="md" title={t("{team} calendar", { team: t(TEAM_LABEL[team]) })} submitLabel={t("Save")} error={failure || undefined} onClose={onClose}
    isDirty={choice !== initial || designDrawingDays !== (settings.designDrawingDays ?? 3) || renderDays !== settings.renderDays || drawingDays !== settings.drawingDays} isSubmitDisabled={!calendars}
    onSubmit={async () => {
      const [connectionId, ...rest] = choice === "none" ? [null] : choice.split("|");
      const next = await teamRequest<TeamSettings>(workspaceId, `${team}/settings`, "PUT", { connectionId, calendarId: connectionId ? rest.join("|") : null, version: target.version,
        ...(team === "design" ? { designDrawingDays, renderDays, drawingDays } : {}) });
      onSaved(next);
    }}>
    {!calendars ? <Skeleton lines={2} shape="form" /> : <SelectField label={t("Google calendar")} description={t("The team's work is also sent there. Everyone still sees it in Wodana.")}
      selectedKey={choice} onSelectionChange={(key) => setChoice(String(key ?? "none"))} items={items} />}
    {team === "design" ? <>
      <NumericInput isRequired label={t("Days the designers need for 2D drawings")} minValue={1} maxValue={60} value={designDrawingDays} onChange={(value) => setDesignDrawingDays(Number.isFinite(value) ? value : 1)} />
      <NumericInput isRequired label={t("Days the Visualiser needs")} minValue={1} maxValue={60} value={renderDays} onChange={(value) => setRenderDays(Number.isFinite(value) ? value : 1)} />
      <NumericInput isRequired label={t("Days the technical team needs")} minValue={1} maxValue={60} value={drawingDays} onChange={(value) => setDrawingDays(Number.isFinite(value) ? value : 1)} />
    </> : null}
  </FormDialog>;
}
