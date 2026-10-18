"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import Link from "next/link";
import { parseDate, CalendarDate } from "@internationalized/date";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Badge, Button, ConfirmationDialog, DateField, EmptyState, ErrorState, FormDialog, IconButton, InlineNotice, InspectorSheet, ListTabs, PageTools, SelectField, Skeleton, useDesignSystem, useWorkingCalendar } from "@/design-system";
import { FactList } from "@/components/crm/crm-workbench";
import { useT } from "@/lib/i18n/i18n-provider";
import { calendarDayKey, calendarRange, moveCalendar } from "@/lib/crm/calendar";
import { pushTeamCalendar, teamRequest, type TeamCalendarView, type TeamEntry } from "@/lib/crm/team-calendar";
import { atWallClock } from "@/lib/crm/zoned-time";
import { logisticsApi } from "@/lib/logistics/client";
import type { BookingSubject, LogisticsKind, LogisticsOptions } from "@/lib/logistics/types";
import { KIND_LABEL, LogisticsBookingDialog, clashText } from "./booking-dialog";
import { RecordPermitDialog } from "./permit-dialog";
import styles from "./logistics.module.css";

const KINDS: LogisticsKind[] = ["delivery", "installation", "permit", "production", "factory_slot"];
const isLogistics = (entry: TeamEntry): entry is TeamEntry & { kind: LogisticsKind } => (KINDS as string[]).includes(entry.kind) && Boolean(entry.projectId || entry.opportunityId);
/** Moved by dragging: what isn't finished yet. */
const MOVABLE = (entry: TeamEntry) => isLogistics(entry) && !["done", "delivered", "completed", "cancelled"].includes(entry.status);
const subjectOf = (entry: TeamEntry & { kind: LogisticsKind }): BookingSubject =>
  ({ kind: entry.kind, ...(entry.projectId ? { projectId: entry.projectId } : { opportunityId: entry.opportunityId }), workOrderId: entry.workOrderId ?? null, permitId: entry.permitId ?? null });
/** PLM-136: a delivery or installation whose building permit doesn't cover its day. */
const permitMissing = (entry: TeamEntry) => Boolean(entry.permit && !entry.permit.covered);

/** Whether an entry spans a day (all logistics bookings are whole days, production may run several). */
const onDay = (entry: TeamEntry, day: string) => entry.start.slice(0, 10) <= day && (entry.end ?? entry.start).slice(0, 10) >= day;

/**
 * The factory and logistics calendar, the main booking point (PLM-135: the separate production and installation
 * calendar): deliveries (Furniture Only deals included), installations, permit collection and production across every
 * job, with who goes on each (people by name, the vehicle and the driver) and whether its building permit is in
 * (PLM-136). The factory and
 * logistics managers book on a day, drag a booking to another day, and filter by person, vehicle or kind; everyone
 * else who may read it reads it.
 */
export function LogisticsCalendar({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const working = useWorkingCalendar();
  const api = useMemo(() => logisticsApi(workspaceId), [workspaceId]);
  const [anchor, setAnchor] = useState(() => atWallClock(new Date(), timeZone));
  const [mode, setMode] = useState<"week" | "month">(() => (typeof window !== "undefined" && window.matchMedia?.("(max-width: 48rem)").matches ? "week" : "month"));
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; view?: TeamCalendarView; error?: string } | null>(null);
  const [options, setOptions] = useState<LogisticsOptions | null>(null);
  const [person, setPerson] = useState("all");
  const [vehicle, setVehicle] = useState("all");
  const [kind, setKind] = useState<"all" | LogisticsKind>("all");
  const [booking, setBooking] = useState<{ day?: string; subject?: BookingSubject } | null>(null);
  const [selected, setSelected] = useState<TeamEntry | null>(null);
  const [dropDay, setDropDay] = useState("");
  const [notice, setNotice] = useState<{ tone: "error" | "info" | "success"; message: string } | null>(null);
  const range = useMemo(() => calendarRange(anchor, mode), [anchor, mode]);
  const from = calendarDayKey(range.days[0]), to = calendarDayKey(new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate()));
  const key = `${from}/${to}/${refresh}`;
  useEffect(() => {
    const controller = new AbortController();
    teamRequest<TeamCalendarView>(workspaceId, `logistics?from=${from}&to=${to}`, "GET", undefined, controller.signal)
      .then((view) => { if (!controller.signal.aborted) setLoaded({ key, view }); })
      .catch((error: Error) => { if (!controller.signal.aborted) setLoaded({ key, error: error.message }); });
    return () => controller.abort();
  }, [workspaceId, from, to, key]);
  useEffect(() => {
    const controller = new AbortController();
    api.options(controller.signal).then(setOptions).catch(() => undefined);
    return () => controller.abort();
  }, [api, refresh]);
  const view = loaded?.key === key ? loaded.view : undefined;
  const canBook = Boolean(view?.canBook);
  const today = view?.today ?? calendarDayKey(atWallClock(new Date(), timeZone));
  const entries = (view?.entries ?? []).filter((entry) => kind === "all" || entry.kind === kind)
    .filter((entry) => person === "all" || entry.crew?.people.some((item) => item.id === person) || entry.crew?.driver?.id === person)
    .filter((entry) => vehicle === "all" || entry.crew?.vehicle?.id === vehicle);
  // After a change the team's Google calendar follows, when this person may send it (best effort).
  const changed = (message?: string) => {
    setRefresh((value) => value + 1);
    if (message) setNotice({ tone: "info", message });
    if (view?.google && view.canManage) void pushTeamCalendar(workspaceId, "logistics", t, window.location.origin).catch(() => undefined);
  };
  const move = async (entry: TeamEntry, day: string) => {
    if (!isLogistics(entry) || entry.start.slice(0, 10) === day) return;
    try {
      const result = await api.save({ ...subjectOf(entry), day, was: { start: entry.start.slice(0, 10), end: entry.end?.slice(0, 10) ?? null }, version: entry.crew?.version ?? 0 });
      changed(result.warnings.length ? result.warnings.map((clash) => clashText(clash, t)).join(" ") : undefined);
    } catch (error) { setNotice({ tone: "error", message: (error as Error).message }); }
  };
  const drop = (event: DragEvent, day: string) => {
    event.preventDefault(); setDropDay("");
    const entry = view?.entries.find((item) => item.key === event.dataTransfer.getData("text/plain"));
    if (entry && canBook) void move(entry, day);
  };
  const periodTitle = mode === "month" ? anchor.toLocaleDateString(locale, { month: "long", year: "numeric" })
    : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).formatRange(range.days[0], range.days.at(-1) ?? range.days[0]);
  const people = (options?.workers ?? []).map((worker) => ({ id: worker.id, label: worker.name }));
  const vehicles = (options?.vehicles ?? []).map((item) => ({ id: item.id, label: item.name }));
  // The calendar's controls and Book are the page's row (Factory's tabs, then these), not a row of their own.
  return <>
    <PageTools><div className={styles.toolbar} role="toolbar" aria-label={t("Calendar controls")}>
      <div className={styles.period}>
        <div className={styles.stepper}>
          <IconButton aria-label={t("Previous calendar period")} onPress={() => setAnchor(moveCalendar(anchor, mode, -1))}><ChevronLeft size={16} /></IconButton>
          <Button size="compact" onPress={() => setAnchor(atWallClock(new Date(), timeZone))}>{t("Today")}</Button>
          <IconButton aria-label={t("Next calendar period")} onPress={() => setAnchor(moveCalendar(anchor, mode, 1))}><ChevronRight size={16} /></IconButton>
        </div>
        <h2 className={styles.periodTitle} aria-live="polite">{periodTitle}</h2>
      </div>
      <div className={styles.controls}>
        <div className={styles.filter}><SelectField aria-label={t("Person")} label={<span className="wd-visually-hidden">{t("Person")}</span>} selectedKey={person}
          onSelectionChange={(value) => setPerson(String(value ?? "all"))} items={[{ id: "all", label: t("Everyone") }, ...people]} /></div>
        <div className={styles.filter}><SelectField aria-label={t("Vehicle")} label={<span className="wd-visually-hidden">{t("Vehicle")}</span>} selectedKey={vehicle}
          onSelectionChange={(value) => setVehicle(String(value ?? "all"))} items={[{ id: "all", label: t("All vehicles") }, ...vehicles]} /></div>
        <div className={styles.filter}><SelectField aria-label={t("What")} label={<span className="wd-visually-hidden">{t("What")}</span>} selectedKey={kind}
          onSelectionChange={(value) => setKind(String(value ?? "all") as "all" | LogisticsKind)}
          items={[{ id: "all", label: t("All bookings") }, ...KINDS.map((item) => ({ id: item, label: t(KIND_LABEL[item]) }))]} /></div>
        <ListTabs label={t("Calendar view")} items={[{ id: "week", label: t("Week") }, { id: "month", label: t("Month") }]} value={mode} onChange={setMode} />
        {canBook ? <Button variant="primary" onPress={() => setBooking({ day: calendarDayKey(anchor) < today ? today : calendarDayKey(anchor) })}><Plus size={16} aria-hidden="true" />{t("Book")}</Button> : null}
      </div>
    </div></PageTools>
    {notice ? <InlineNotice tone={notice.tone} message={notice.message} /> : null}
    <section className={styles.frame} aria-label={t("Factory and logistics")} aria-busy={!loaded || loaded.key !== key || undefined}>
      {!loaded || loaded.key !== key ? <div className={styles.loading}><Skeleton lines={8} shape="rows" /></div>
      : loaded.error ? <ErrorState title={t("Calendar could not load")} description={loaded.error} onRetry={() => setRefresh((value) => value + 1)} />
      : !entries.length && (person !== "all" || vehicle !== "all" || kind !== "all") ? <EmptyState title={t("Nothing booked for this filter")}
        action={<Button onPress={() => { setPerson("all"); setVehicle("all"); setKind("all"); }}>{t("Clear filters")}</Button>} />
      : <div className={styles.board} data-mode={mode} role="group" aria-label={mode === "month" ? t("Month calendar") : t("Week calendar")}>
        {range.days.slice(0, 7).map((day) => <div className={styles.weekday} key={`head-${day.toISOString()}`}>{day.toLocaleDateString(locale, { weekday: "short" })}</div>)}
        {range.days.map((date) => {
          const day = calendarDayKey(date);
          const dayEntries = entries.filter((entry) => onDay(entry, day));
          return <section key={day} className={styles.day} aria-label={date.toLocaleDateString(locale, { dateStyle: "full" })} data-empty={!dayEntries.length || undefined}
            data-outside={mode === "month" && date.getMonth() !== anchor.getMonth() || undefined} data-drop={dropDay === day || undefined}
            data-off={!working.isWorkingDay(new CalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate())) || undefined}
            onDragOver={canBook ? (event) => { event.preventDefault(); setDropDay(day); } : undefined} onDragLeave={() => setDropDay("")} onDrop={canBook ? (event) => drop(event, day) : undefined}>
            <button type="button" className={styles.date} data-today={day === today || undefined} disabled={!canBook}
              aria-label={canBook ? t("Book on {date}", { date: date.toLocaleDateString(locale) }) : date.toLocaleDateString(locale)} onClick={() => setBooking({ day })}>{date.getDate()}</button>
            {dayEntries.map((entry) => <button key={`${entry.key}:${day}`} type="button" className={styles.chip} data-kind={entry.kind} data-overdue={entry.overdue || undefined}
              data-completed={["done", "delivered", "completed"].includes(entry.status) || undefined} draggable={canBook && MOVABLE(entry)}
              onDragStart={(event) => { event.dataTransfer.setData("text/plain", entry.key); event.dataTransfer.effectAllowed = "move"; }}
              data-blocked={permitMissing(entry) || undefined}
              aria-label={[entry.overdue ? t("Overdue") : "", t(KIND_LABEL[entry.kind as LogisticsKind] ?? entry.kind as never), entry.subject].filter(Boolean).join(" · ")} onClick={() => setSelected(entry)}>
              <strong>{entry.kind === "production" && entry.detail ? `${entry.detail} · ${entry.subject}` : `${t(KIND_LABEL[entry.kind as LogisticsKind])} · ${entry.subject}`}</strong>
              {entry.crew && (entry.crew.people.length || entry.crew.vehicle) ? <small>{[entry.crew.people.find((item) => item.lead)?.name ?? entry.crew.people[0]?.name,
                entry.crew.people.length > 1 ? t("+{count}", { count: entry.crew.people.length - 1 }) : "", entry.crew.vehicle?.name].filter(Boolean).join(" · ")}</small> : null}
              {permitMissing(entry) ? <small>{t("No building permit")}</small> : null}
            </button>)}
          </section>;
        })}
      </div>}
    </section>
    {booking ? <LogisticsBookingDialog workspaceId={workspaceId} initial={{ ...booking.subject, day: booking.day ?? null }} onClose={() => setBooking(null)}
      onSaved={(result) => { setBooking(null); changed(result.warnings.length ? result.warnings.map((clash) => clashText(clash, t)).join(" ") : undefined); }} /> : null}
    {selected ? <BookingSheet workspaceId={workspaceId} entry={selected} canBook={canBook} today={today} onClose={() => setSelected(null)}
      onEdit={(subject) => { setSelected(null); setBooking({ subject }); }} onChanged={() => { setSelected(null); changed(); }} onMove={(entry, day) => { setSelected(null); void move(entry, day); }} /> : null}
  </>;
}

/**
 * One booking: what it is, when, for which project, who goes (the lead first), the vehicle and the driver. The bookers
 * change who goes, move it, record the permit or cancel it here; the job opens from its link.
 */
export function BookingSheet({ workspaceId, entry, canBook, today, onClose, onEdit, onChanged, onMove }: {
  workspaceId: string; entry: TeamEntry; canBook: boolean; today: string; onClose: () => void;
  onEdit: (subject: BookingSubject) => void; onChanged: () => void; onMove: (entry: TeamEntry, day: string) => void;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [moving, setMoving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const short = (day: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day.slice(0, 10)}T00:00:00Z`));
  const when = entry.end && entry.end.slice(0, 10) !== entry.start.slice(0, 10) ? t("{from} – {to}", { from: short(entry.start), to: short(entry.end) }) : short(entry.start);
  const logistics = isLogistics(entry) ? entry : null;
  const crew = entry.crew;
  const lead = crew?.people.find((person) => person.lead);
  return <InspectorSheet isOpen title={`${t(KIND_LABEL[entry.kind as LogisticsKind] ?? "Booking")} · ${entry.subject}`} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={canBook && logistics ? <div className="wd-dialog-actions">
      {logistics.kind !== "production" ? <Button variant="quiet" onPress={() => setCancelling(true)}>{t("Cancel booking")}</Button> : null}
      {MOVABLE(entry) ? <Button onPress={() => setMoving(true)}>{t("Move")}</Button> : null}
      {logistics.kind === "permit" ? <Button onPress={() => setRecording(true)}>{t("Record the permit")}</Button> : null}
      <Button variant="primary" onPress={() => onEdit(subjectOf(logistics))}>{t("Edit booking")}</Button>
    </div> : undefined}>
    <div className={styles.details}>
      <div className={styles.badges}><Badge hue="auto">{t(KIND_LABEL[entry.kind as LogisticsKind] ?? "Booking")}</Badge>{entry.overdue ? <Badge tone="danger">{t("Overdue")}</Badge> : null}
        {permitMissing(entry) ? <Badge tone="danger">{t("No building permit")}</Badge> : null}</div>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <FactList facts={[
        [t("When"), when],
        ...(entry.kind === "production" && entry.detail ? [[t("Work order"), entry.detail] as [string, string]] : []),
        ...(lead ? [[t("Lead"), lead.name] as [string, string]] : []),
        ...(crew?.people.length ? [[t("People"), crew.people.map((person) => person.name).join(", ")] as [string, string]] : []),
        ...(crew?.crew ? [[t("Crew"), crew.crew.name] as [string, string]] : []),
        ...(crew?.vehicle ? [[t("Vehicle"), crew.vehicle.name] as [string, string]] : []),
        ...(crew?.driver ? [[t("Driver"), crew.driver.name] as [string, string]] : []),
        ...(crew?.note ? [[t("Note"), crew.note] as [string, string]] : []),
        ...(entry.permit ? [[t("Building permit"), entry.permit.covered ? (entry.permit.validTo ? t("Valid until {date}", { date: short(entry.permit.validTo) }) : t("Collected")) : t("Missing")] as [string, string]] : []),
      ]} />
      <Link href={entry.href}>{entry.kind === "production" ? t("Open the work order") : entry.projectId ? t("Open the project") : t("Open the deal")}</Link>
    </div>
    {moving ? <MoveDialog initial={entry.start.slice(0, 10)} onClose={() => setMoving(false)} onSave={(day) => onMove(entry, day)} /> : null}
    <ConfirmationDialog isOpen={cancelling} title={t("Cancel this booking?")} body={t("The day is cleared and nobody goes.")} confirmLabel={t("Cancel booking")} isConfirming={busy}
      onOpenChange={setCancelling} onConfirm={async () => {
        if (!logistics) return;
        setBusy(true); setError("");
        try { await logisticsApi(workspaceId).cancel({ ...subjectOf(logistics), was: { start: entry.start.slice(0, 10) } }); onChanged(); }
        catch (cause) { setError((cause as Error).message); setCancelling(false); }
        finally { setBusy(false); }
      }} />
    {recording && logistics ? <RecordPermitDialog workspaceId={workspaceId} owner={logistics.projectId ? { projectId: logistics.projectId } : { opportunityId: logistics.opportunityId! }}
      permitId={logistics.permitId} today={today} onClose={() => setRecording(false)}
      onSaved={() => { setRecording(false); onChanged(); }} /> : null}
  </InspectorSheet>;
}

/** Moves a booking to another day (a work order keeps its length); the same as dragging it, by keyboard. */
function MoveDialog({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (day: string) => void }) {
  const t = useT();
  const [day, setDay] = useState<string | null>(initial);
  return <FormDialog size="md" title={t("Move booking")} submitLabel={t("Save")} onClose={onClose} isDirty={day !== initial} isSubmitDisabled={!day || day === initial}
    onSubmit={async () => onSave(day!)}>
    <DateField isRequired label={t("Day")} value={day ? parseDate(day) : null} onChange={(value) => setDay(value ? value.toString() : null)} />
  </FormDialog>;
}
