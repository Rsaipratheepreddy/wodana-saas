"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDate } from "@internationalized/date";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { nextWorkingHalfHour, useWorkingCalendar, Badge, Button, DesignSystemProvider, ErrorState, FormDialog, IconButton, IconMenuButton, InlineNotice, InspectorSheet, isNoAccessError, ListTabs, MoreDetails, NoAccessState, PageShell, SelectField, ToolbarSearch, TextAreaField, TextInput, useDesignSystem, useWorkspaceZoneLabel, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { crmRequest, rows, label, type RecordData } from "@/lib/crm/client";
import { calendarDayKey, calendarRange, localDateTime, moveCalendar, type CalendarMode, type CalendarEvent } from "@/lib/crm/calendar";
import { connectedGoogleForMember, crmCalendarEvents, googleCalendarEvents, projectCalendarEvents, type CalendarConnection, type CalendarMember } from "@/lib/crm/calendar-sources";
import { atWallClock, fromWallClock, zonedDateTimeToIso } from "@/lib/crm/zoned-time";
import { ActionDialog, FactList, ResourceState, options, useCrmResource, type ActionSpec } from "./crm-workbench";
import { CalendarTimeGrid } from "./calendar-time-grid";
import styles from "./crm-calendar.module.css";
import workspaceColors from "./crm-workspace-colors.module.css";
import { FollowUpSheet } from "./follow-up-editor";
import { CrmDateTimeField } from "./crm-date-time-field";

function safeGoogleLink(value: unknown) { try { const url = new URL(String(value)); return url.protocol === "https:" && ["calendar.google.com", "www.google.com"].includes(url.hostname) ? url.href : undefined; } catch { return undefined; } }

const subscribeToHydration = () => () => {};
export function CrmCalendar(props: { workspaceId: string; currentUserId?: string; canView?: boolean; revision?: number }) {
  const t = useT();
  const settings = useDesignSystem();
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  // The calendar draws the workspace's days and hours (its region's time zone) in the viewer's language; it
  // renders after hydration because "today" and "now" are only known in the browser.
  const ready = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  return <DesignSystemProvider {...settings} className={`${styles.provider} ${workspaceColors.theme}`} portalContainer={portal} ref={setPortal}>{props.canView === false ? <NoAccessState area={t("Calendar")} /> : ready ? <LocalCrmCalendar {...props} /> : <p role="status">{t("Loading your local calendar…")}</p>}</DesignSystemProvider>;
}

function LocalCrmCalendar({ workspaceId, currentUserId = "", revision = 0 }: { workspaceId: string; currentUserId?: string; revision?: number }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  // Days, hours and "today" are the workspace's wall clock (CAL-2): a Dubai meeting stays at 10:00 in India.
  const wallNow = () => atWallClock(new Date(), timeZone);
  const [anchor, setAnchor] = useState(wallNow);
  const router = useRouter();
  // A phone shows one day at a time; a wider screen starts on the week.
  const [mode, setMode] = useState<CalendarMode>(() => (typeof window !== "undefined" && window.matchMedia?.("(max-width: 48rem)").matches ? "day" : "week"));
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [crm, setCrm] = useState<{ key: string; events: CalendarEvent[]; error?: string } | null>(null);
  const [project, setProject] = useState<{ key: string; events: CalendarEvent[]; error?: string } | null>(null);
  const [google, setGoogle] = useState<{ key: string; events: CalendarEvent[]; error?: string } | null>(null);
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [members, setMembers] = useState<CalendarMember[]>([]);
  const [memberError, setMemberError] = useState("");
  // Sources the person's role can't read are left out quietly: the calendar shows what they can use.
  const [membersDenied, setMembersDenied] = useState(false);
  const [connectionsDenied, setConnectionsDenied] = useState(false);
  const [scope, setScope] = useState<"organization" | "personal" | "member">("organization");
  const [memberId, setMemberId] = useState("");
  const [googleSelection, setGoogleSelection] = useState("all");
  const [connectionError, setConnectionError] = useState("");
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [createOn, setCreateOn] = useState<Date | null>(null);
  const [googleCreateOn, setGoogleCreateOn] = useState<Date | null>(null);
  const range = useMemo(() => calendarRange(anchor, mode), [anchor, mode]);
  const from = fromWallClock(range.start, timeZone).toISOString(), to = fromWallClock(range.end, timeZone).toISOString();
  const currentMember = members.find(member => member.userId === currentUserId);
  const scopedMember = scope === "personal" ? currentMember : scope === "member" ? members.find(member => member.id === memberId) : undefined;
  const ownerId = scope === "organization" ? "" : scopedMember?.id ?? "";
  const key = `${workspaceId}/${from}/${to}/${scope}/${ownerId}/${refresh}/${revision}`;
  const eligibleConnections = connectedGoogleForMember(connections, scopedMember);
  const selectedConnections = (scope !== "organization" && !scopedMember ? [] : eligibleConnections).filter(connection => googleSelection === "all" || googleSelection === connection.id).slice(0, 10);
  const connectionIds = selectedConnections.map(connection => connection.id);
  const connectionIdKey = connectionIds.join(",");
  const googleKey = `${key}/${connectionIdKey}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/workspace/integration-connections?workspaceId=${workspaceId}`, { signal: controller.signal }).then(async (response) => { const payload = await response.json(); if (!response.ok) throw Object.assign(new Error(payload.message ?? t("Connections unavailable")), { status: response.status }); return rows(payload) as CalendarConnection[]; }).then((items) => { if (!controller.signal.aborted) setConnections(items.filter((item) => item.provider === "google_workspace")); }).catch((error: Error) => { if (controller.signal.aborted) return; if (isNoAccessError(error)) setConnectionsDenied(true); else setConnectionError(error.message); });
    return () => controller.abort();
  }, [workspaceId, refresh, t]);
  useEffect(() => {
    const controller = new AbortController();
    void crmRequest<CalendarMember[]>(workspaceId, "members", "GET", undefined, controller.signal).then(payload => { if (!controller.signal.aborted) { setMembers(rows(payload) as CalendarMember[]); setMemberError(""); } }).catch((error: Error) => { if (controller.signal.aborted) return; if (isNoAccessError(error)) setMembersDenied(true); else setMemberError(error.message); });
    return () => controller.abort();
  }, [workspaceId, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const items: RecordData[] = [];
      let cursor: string | null = null;
      try {
        if (scope !== "organization" && !ownerId) { setCrm({ key, events: [] }); return; }
        for (let page = 0; page < 30; page += 1) {
          const payload: { data: RecordData[]; nextCursor: string | null } = await crmRequest(workspaceId, `activities?limit=100&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${ownerId ? `&ownerMembershipId=${encodeURIComponent(ownerId)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "GET", undefined, controller.signal);
          items.push(...payload.data); cursor = payload.nextCursor;
          if (!cursor) break;
        }
        if (cursor) throw new Error(t("More than 3,000 activities in this range. Choose Week or Day to see the full schedule."));
        const events = crmCalendarEvents(items, timeZone);
        if (!controller.signal.aborted) setCrm({ key, events });
      } catch (error) { if (!controller.signal.aborted) setCrm({ key, events: [], error: (error as Error).message }); }
    })();
    return () => controller.abort();
  }, [workspaceId, from, to, key, ownerId, scope, timeZone, t]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const items: RecordData[] = [];
      let cursor = "";
      try {
        if (scope !== "organization" && !ownerId) { setProject({ key, events: [] }); return; }
        const startDay = calendarDayKey(range.start), endDay = calendarDayKey(range.end);
        for (let page = 0; page < 30; page += 1) {
          const query = new URLSearchParams({ workspaceId, view: "all", from: startDay, to: endDay, ...(ownerId ? { ownerId } : {}), ...(cursor ? { cursor } : {}) });
          const response = await fetch(`/api/projects/work-queue?${query}`, { signal: controller.signal, cache: "no-store" });
          const payload = await response.json();
          if (!response.ok) throw Object.assign(new Error(payload.message ?? t("Project work could not be loaded.")), { status: response.status });
          items.push(...rows(payload)); cursor = typeof payload.nextCursor === "string" ? payload.nextCursor : "";
          if (!cursor) break;
        }
        if (cursor) throw new Error(t("More than 3,000 project items in this range. Choose Week or Day to see the full schedule."));
        if (!controller.signal.aborted) setProject({ key, events: projectCalendarEvents(items as Parameters<typeof projectCalendarEvents>[0]) });
      } catch (error) { if (!controller.signal.aborted) setProject({ key, events: [], error: isNoAccessError(error) ? undefined : (error as Error).message }); }
    })();
    return () => controller.abort();
  }, [workspaceId, key, ownerId, scope, range.start, range.end, t]);
  useEffect(() => {
    if (!connectionIdKey) return;
    const connectionIds = connectionIdKey.split(",");
    const controller = new AbortController();
    void (async () => {
      try {
        // Google accepts at most 31 days per request. Split a six-week month grid safely.
        const items: Parameters<typeof googleCalendarEvents>[0] = [];
        for (let cursor = Date.parse(from); cursor < Date.parse(to); cursor += 30 * 86400000) {
          const response = await fetch("/api/workspace/crm/google-calendar", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, connectionIds, timeMin: new Date(cursor).toISOString(), timeMax: new Date(Math.min(cursor + 30 * 86400000, Date.parse(to))).toISOString(), timeZone }) });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.message ?? t("Google events could not be loaded."));
          items.push(...payload.events ?? []);
        }
        if (!controller.signal.aborted) setGoogle({ key: googleKey, events: googleCalendarEvents(items, safeGoogleLink, timeZone) });
      } catch (error) { if (!controller.signal.aborted) setGoogle({ key: googleKey, events: [], error: (error as Error).message }); }
    })();
    return () => controller.abort();
  }, [workspaceId, connectionIdKey, from, to, timeZone, googleKey, t]);
  const events = [...(crm?.key === key ? crm.events : []), ...(project?.key === key ? project.events : []), ...(connectionIds.length && google?.key === googleKey ? google.events : [])].filter((event) => event.title.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.start.getTime() - b.start.getTime());
  const today = calendarDayKey(wallNow());
  // A new event starts at the next working half-hour (today while the working day is open, else the next working
  // day's start), or at the start of the working day on another day being viewed.
  const workingCalendar = useWorkingCalendar();
  const newEventDate = () => {
    if (calendarDayKey(anchor) !== today) {
      const [hour = 10, minute = 0] = (workingCalendar.workingHours?.start ?? "10:00").split(":").map(Number);
      return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), hour, minute);
    }
    return nextWorkingHalfHour(atWallClock(Date.now(), timeZone), workingCalendar, workingCalendar.workingHours);
  };
  // One period label: "October 2026" for a month, "5 – 11 Oct 2026" for a week, "Tuesday 6 October 2026" for a day.
  const periodTitle = mode === "month" ? anchor.toLocaleDateString(locale, { month: "long", year: "numeric" })
    : mode === "day" ? anchor.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).formatRange(range.days[0], range.days.at(-1) ?? range.days[0]);
  const googleConnected = connections.some(item => ["connected", "degraded"].includes(item.status));
  const addEvent = () => googleConnected ? setGoogleCreateOn(newEventDate()) : setCreateOn(newEventDate());
  const whose = scope === "member" ? memberId : scope;
  const whoseItems = [{ id: "organization", label: t("Everyone") }, ...(!membersDenied ? [{ id: "personal", label: t("Only me") },
    ...members.filter(member => member.status !== "suspended" && member.userId !== currentUserId).map(member => ({ id: member.id, label: member.displayName }))] : [])];
  const menu = [{ id: "schedule", label: t("Schedule a CRM meeting") }, ...(!connectionsDenied ? [{ id: "google", label: googleConnected ? t("Manage Google") : t("Connect Google") }] : []), { id: "refresh", label: t("Refresh") }];
  const notice = memberError ? memberError : scope === "personal" && members.length > 0 && !currentMember ? t("Your workspace membership could not be identified.") : connectionError
    ? `${connectionError} ${t("Workspace events are still available.")}` : project?.key === key && project.error ? project.error
    : connectionIds.length && google?.key === googleKey && google.error ? google.error : "";
  return <PageShell title={t("Calendar")} kind="dashboard" action={<Button variant="primary" onPress={addEvent}><Plus size={16} aria-hidden="true" />{t("New event")}</Button>}>
    <div className={styles.toolbar} role="toolbar" aria-label={t("Calendar controls")}>
      <div className={styles.period}>
        <div className={styles.stepper}><IconButton aria-label={t("Previous calendar period")} onPress={() => setAnchor(moveCalendar(anchor, mode, -1))}><ChevronLeft size={16} /></IconButton>
          <Button size="compact" onPress={() => setAnchor(wallNow())}>{t("Today")}</Button>
          <IconButton aria-label={t("Next calendar period")} onPress={() => setAnchor(moveCalendar(anchor, mode, 1))}><ChevronRight size={16} /></IconButton></div>
        <h2 className={styles.periodTitle} aria-live="polite">{periodTitle}</h2>
      </div>
      <div className={styles.controls}>
        <ToolbarSearch label={t("Search calendar")} value={search} onChange={setSearch} />
        {whoseItems.length > 1 ? <div className={styles.whose}><SelectField label={<span className="wd-visually-hidden">{t("Whose calendar")}</span>} aria-label={t("Whose calendar")} selectedKey={whose}
          items={whoseItems} onSelectionChange={value => { const id = String(value ?? "organization"); setGoogleSelection("all");
            if (id === "organization" || id === "personal") { setScope(id); setMemberId(""); } else { setMemberId(id); setScope("member"); } }} /></div> : null}
        {eligibleConnections.length > 1 ? <div className={styles.whose}><SelectField label={<span className="wd-visually-hidden">{t("Google calendars")}</span>} aria-label={t("Google calendars")} selectedKey={googleSelection}
          items={[{ id: "all", label: t("All Google calendars") }, ...eligibleConnections.map(connection => ({ id: connection.id, label: connection.displayName }))]} onSelectionChange={value => setGoogleSelection(String(value ?? "all"))} /></div> : null}
        <ListTabs label={t("Calendar view")} items={[{ id: "day", label: t("Day") }, { id: "week", label: t("Week") }, { id: "month", label: t("Month") }]} value={mode} onChange={setMode} />
        <IconMenuButton ariaLabel={t("Calendar options")} items={menu} onAction={(id) => {
          if (id === "schedule") setCreateOn(newEventDate());
          else if (id === "google") router.push("/workspace/integrations?connect=google_workspace");
          else { setRefresh(n => n + 1); setConnectionError(""); }
        }} />
      </div>
    </div>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    <section className={styles.frame} aria-label={t("Calendar schedule")} aria-busy={crm?.key !== key || (connectionIds.length > 0 && google?.key !== googleKey) || undefined}>
      {crm?.key !== key ? <div className={styles.loading}><Skeleton lines={8} shape="rows" /></div>
      : crm.error ? <ErrorState title={t("Calendar could not load")} description={crm.error} onRetry={() => setRefresh(n => n + 1)} />
      : mode !== "month" ? <CalendarTimeGrid days={range.days} today={today} events={events} onSelect={setSelected} onSchedule={setCreateOn} />
      : <div className={styles.monthScroll}><div className={styles.month} role="group" aria-label={t("Month calendar")}>
        {range.days.slice(0, 7).map(day => <div className={styles.weekday} key={day.toISOString()}>{day.toLocaleDateString(locale, { weekday: "short" })}</div>)}
        {range.days.map(day => { const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1); const dayEvents = events.filter(event => event.start < nextDay && (event.end && event.end > event.start ? event.end > day : event.start >= day));
          return <section key={day.toISOString()} className={styles.day} data-outside={day.getMonth() !== anchor.getMonth() || undefined} data-off={!workingCalendar.isWorkingDay(new CalendarDate(day.getFullYear(), day.getMonth() + 1, day.getDate())) || undefined} aria-label={day.toLocaleDateString(locale, { dateStyle: "full" })}>
            <button className={styles.date} aria-current={calendarDayKey(day) === today ? "date" : undefined} data-today={calendarDayKey(day) === today || undefined} type="button" aria-label={t("Schedule on {date}", { date: day.toLocaleDateString(locale) })} onClick={() => setCreateOn(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10))}>{day.getDate()}</button>
            {dayEvents.slice(0, 3).map(event => <button type="button" className={styles.chip} data-kind={event.kind} data-provider={event.provider} data-completed={event.status === "completed" || undefined} key={event.id} aria-label={`${event.provider} ${event.title}`} onClick={() => setSelected(event)}>
              {!event.allDay ? <small>{event.start.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}</small> : null}<span className={styles.eventTitle}>{event.title}</span></button>)}
            {dayEvents.length > 3 ? <button type="button" className={styles.more} onClick={() => { setAnchor(day); setMode("day"); }}>{t("+{count} more", { count: dayEvents.length - 3 })}</button> : null}
          </section>; })}
      </div></div>}
    </section>
    {createOn ? <ScheduleMeeting workspaceId={workspaceId} date={createOn} onClose={() => setCreateOn(null)} onSaved={() => { setCreateOn(null); setRefresh(n => n + 1); }} /> : null}
    {googleCreateOn ? <GoogleEventDialog workspaceId={workspaceId} connections={eligibleConnections} date={googleCreateOn} onClose={() => setGoogleCreateOn(null)} onSaved={() => { setGoogleCreateOn(null); setRefresh(n => n + 1); }} /> : null}
    {selected?.provider === "crm" ? <FollowUpSheet key={selected.id} workspaceId={workspaceId} recordId={selected.id} onClose={() => setSelected(null)} onSaved={() => setRefresh(n => n + 1)} /> : selected ? <InspectorSheet isOpen title={selected.title} onOpenChange={open => { if (!open) setSelected(null); }}><CalendarDetails workspaceId={workspaceId} event={selected} onChanged={() => setRefresh(n => n + 1)} /></InspectorSheet> : null}
  </PageShell>;
}

function ScheduleMeeting({ workspaceId, date, onClose, onSaved }: { workspaceId: string; date: Date; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const customers = useCrmResource<unknown>(workspaceId, "parties?limit=100");
  // The people who can own CRM work (the same list and rule the server checks), readable by Sales.
  const members = useCrmResource<unknown>(workspaceId, "sales-owners");
  const { timeZone } = useDesignSystem();
  // The slot picked on the grid is the workspace's wall clock; the meeting is saved at that moment in its zone.
  const [start] = useState(() => fromWallClock(date, timeZone));
  const blockedReason = customers.loading || members.loading ? t("Loading customers and sales owners…") : customers.failure || members.failure ? t("Required records could not load: {error}. Close this form and retry.", { error: customers.failure || members.failure }) : !rows(customers.data).length ? t("Create a customer or enquiry before scheduling a CRM meeting.") : !rows(members.data).length ? t("No active sales owners are available.") : undefined;
  return <ActionDialog workspaceId={workspaceId} onClose={onClose} onSaved={onSaved} action={{ title: t("Schedule CRM meeting"), blockedReason, description: t("Saves a meeting and its calendar appointment together. No Google event or customer invitation is sent."), path: "activities", initial: { type: "meeting", startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600000).toISOString(), timezone: timeZone }, fields: [{ key: "title", label: t("Meeting title"), required: true }, { key: "partyId", label: t("Customer"), options: options(rows(customers.data), "displayName"), required: true }, { key: "ownerMembershipId", label: t("Sales owner"), options: options(rows(members.data), "displayName"), required: true }, { key: "startsAt", label: t("Starts"), type: "datetime-local", required: true }, { key: "endsAt", label: t("Ends"), type: "datetime-local", required: true }, { key: "location", label: t("Location or meeting link") }, { key: "description", label: t("Agenda"), type: "textarea" }], transform: ({ startsAt, endsAt, timezone, location, ...values }) => { if (customers.failure || members.failure) throw new Error(customers.failure || members.failure); if (Date.parse(String(endsAt)) <= Date.parse(String(startsAt))) throw new Error(t("End time must be after start time.")); return { ...values, dueAt: startsAt, appointment: { startsAt, endsAt, timezone, location: { text: location ?? "" } } }; } }} />;
}

function GoogleEventDialog({ workspaceId, connections, date, onClose, onSaved }: { workspaceId: string; connections: CalendarConnection[]; date: Date; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  // The fields read the workspace's wall clock, like the grid the slot was picked on.
  const { timeZone } = useDesignSystem();
  const [calendars, setCalendars] = useState<Array<{ connectionId: string; calendarId: string; label: string }>>([]);
  const [calendarIndex, setCalendarIndex] = useState("0");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(localDateTime(date));
  const [end, setEnd] = useState(localDateTime(new Date(date.getTime() + 3600000)));
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [attendees, setAttendees] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const results = await Promise.all(connections.map(async connection => {
          const response = await fetch(`/api/workspace/integration-connections/${connection.id}/tools?${new URLSearchParams({ workspaceId, kind: "calendars" })}`, { signal: controller.signal });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.message ?? t("Google calendars could not be loaded."));
          return (payload.calendars ?? []).filter((calendar: RecordData) => calendar.enabled && ["owner", "writer"].includes(String(calendar.accessRole))).map((calendar: RecordData) => ({ connectionId: connection.id, calendarId: String(calendar.externalId), label: `${String(calendar.displayName)} · ${connection.displayName}` }));
        }));
        if (!controller.signal.aborted) setCalendars(results.flat());
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [workspaceId, connections, t]);
  const submit = async () => {
    const selectedCalendar = calendars[Number(calendarIndex)];
    // The fields hold the workspace's wall clock, so they are read in its zone.
    const from = new Date(zonedDateTimeToIso(start, timeZone) ?? NaN), to = new Date(zonedDateTimeToIso(end, timeZone) ?? NaN);
    if (!selectedCalendar) throw new Error(t("Choose a writable Google calendar in Connections."));
    if (!title.trim() || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) throw new Error(t("Enter a title and an end time after the start."));
    const attendeeEmails = attendees.split(/[\s,;]+/).map(email => email.trim()).filter(Boolean);
    const response = await fetch(`/api/workspace/integration-connections/${selectedCalendar.connectionId}/tools`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, action: "calendar.create", idempotencyKey, payload: { calendarId: selectedCalendar.calendarId, summary: title.trim(), description: description.trim() || undefined, location: location.trim() || undefined, start: from.toISOString(), end: to.toISOString(), timeZone, attendeeEmails, sendUpdates: attendeeEmails.length ? "all" : "none" } }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? t("Google event could not be created."));
    onSaved();
  };
  return <FormDialog error={error || undefined} errorTitle={t("Google event needs attention")} isDirty={Boolean(title.trim() || location.trim() || attendees.trim() || description.trim())}
    isSubmitDisabled={loading || !calendars.length} onClose={onClose} onSubmit={submit} submitLabel={t("Add event")} title={t("Add Google event")}
    lead={loading ? <p role="status">{t("Loading writable calendars…")}</p> : !calendars.length ? <p>{t("No writable calendar is selected.")} <Link href="/workspace/integrations?connect=google_workspace">{t("Connect or choose a Google calendar")}</Link>.</p> : null}>
    <SelectField isRequired label={t("Calendar")} items={calendars.map((calendar, index) => ({ id: String(index), label: calendar.label }))} selectedKey={calendarIndex} onSelectionChange={(key) => setCalendarIndex(String(key ?? "0"))} />
    <TextInput isRequired label={t("Event title")} maxLength={300} value={title} onChange={setTitle} />
    <CrmDateTimeField isRequired label={t("Starts")} value={start} onChange={setStart} />
    <CrmDateTimeField isRequired label={t("Ends")} value={end} onChange={setEnd} />
    <MoreDetails filled={[location, attendees, description].filter((value) => value.trim()).length}>
      <TextInput label={t("Location")} maxLength={500} value={location} onChange={setLocation} />
      <TextInput description={t("Guests receive a Google invitation.")} label={t("Guests, separated by commas")} value={attendees} onChange={setAttendees} />
      <TextAreaField label={t("Notes")} value={description} onChange={setDescription} />
    </MoreDetails>
  </FormDialog>;
}

function CalendarDetails({ workspaceId, event, onChanged }: { workspaceId: string; event: CalendarEvent; onChanged: () => void }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const zoneLabel = useWorkspaceZoneLabel();
  const resource = useCrmResource<RecordData>(workspaceId, event.provider === "crm" ? `activities/${event.id}` : null);
  const [action, setAction] = useState<ActionSpec | null>(null);
  const record = resource.data;
  const appointment = record?.appointment as RecordData | null;
  // The workspace's time, and the viewer's own only when their zone differs.
  const at = (saved: unknown, wall?: Date) => {
    const instant = typeof saved === "string" && saved ? new Date(saved) : wall ? fromWallClock(wall, timeZone) : null;
    if (!instant || !Number.isFinite(instant.getTime())) return t("Not scheduled");
    const text = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(instant);
    return zoneLabel ? t("{time} · {local} your time", { time: text, local: new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(instant) }) : text;
  };
  return <div className={styles.details}><Badge tone="neutral">{event.provider === "google" ? t("Google Calendar · Live") : event.provider === "project" ? t("Project work") : t("CRM activity")}</Badge><ResourceState {...resource} retry={resource.refresh} /><FactList facts={[[t("Starts"), event.allDay ? t("All day · {date}", { date: event.start.toLocaleDateString(locale) }) : at(appointment?.startsAt, event.start)], [t("Ends"), event.allDay ? t("All day") : appointment?.endsAt || event.end ? at(appointment?.endsAt, event.end) : t("No end time")], [t("Status"), label(record?.status ?? event.status, t("Scheduled"))], [t("Owner"), String(record?.ownerName ?? event.ownerName ?? t("Not available"))], ...(event.calendarName ? [[t("Calendar / project"), event.calendarName] as [string, string]] : []), ...(event.location ? [[t("Location"), event.location] as [string, string]] : [])]} />{event.href ? event.provider === "project" ? <Link href={event.href}>{t("Open project work")}</Link> : <a href={event.href} target="_blank" rel="noreferrer">{t("Open in Google Calendar")}</a> : null}{event.description || record?.description ? <p>{String(event.description ?? record?.description)}</p> : null}{event.attendees?.length ? <p>{t("Guests: {guests}", { guests: event.attendees.map(attendee => attendee.displayName || attendee.email).join(", ") })}</p> : null}{record?.partyId ? <Link href={`/workspace/crm/customers?record=${record.partyId}`}>{t("Open customer")}</Link> : null}{record?.leadId ? <Link href={`/workspace/crm/leads?lead=${record.leadId}`}>{t("Open enquiry")}</Link> : null}{record?.opportunityId ? <Link href={`/workspace/crm/opportunities?record=${record.opportunityId}`}>{t("Open opportunity")}</Link> : null}{record?.status === "pending" ? <div className={styles.actions}>{appointment ? <Button size="compact" onPress={() => setAction({ title: t("Reschedule meeting"), path: `activities/${event.id}/appointment`, method: "PATCH", initial: { version: appointment.version, startsAt: appointment.startsAt, endsAt: appointment.endsAt, timezone: appointment.timezone, location: appointment.location }, fields: [{ key: "startsAt", label: t("Starts"), type: "datetime-local", required: true }, { key: "endsAt", label: t("Ends"), type: "datetime-local", required: true }] })}>{t("Reschedule")}</Button> : null}<Button size="compact" onPress={() => setAction({ title: t("Complete activity"), path: `activities/${event.id}/complete`, initial: { version: record.version }, fields: [{ key: "outcome", label: t("Outcome"), required: true }] })}>{t("Complete")}</Button></div> : null}{action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={() => { resource.refresh(); onChanged(); }} /> : null}</div>;
}
