"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { Badge, Button, Callout, ControlledModalDialog, DesignSystemProvider, IconButton, InspectorSheet, isNoAccessError, NoAccessState, SearchInput, SelectField, useDesignSystem, useWorkspaceZoneLabel, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { crmRequest, rows, dateText, label, type RecordData } from "@/lib/crm/client";
import { calendarDayKey, calendarRange, localDateTime, moveCalendar, type CalendarMode, type CalendarEvent } from "@/lib/crm/calendar";
import { connectedGoogleForMember, crmCalendarEvents, googleCalendarEvents, projectCalendarEvents, type CalendarConnection, type CalendarMember } from "@/lib/crm/calendar-sources";
import { ActionDialog, FactList, ResourceState, options, useCrmResource, type ActionSpec } from "./crm-workbench";
import { CalendarTimeGrid } from "./calendar-time-grid";
import styles from "./crm-calendar.module.css";
import workspaceColors from "./crm-workspace-colors.module.css";
import { FollowUpSheet } from "./follow-up-editor";

function safeGoogleLink(value: unknown) { try { const url = new URL(String(value)); return url.protocol === "https:" && ["calendar.google.com", "www.google.com"].includes(url.hostname) ? url.href : undefined; } catch { return undefined; } }

const subscribeToHydration = () => () => {};
export function CrmCalendar(props: { workspaceId: string; currentUserId?: string; canView?: boolean; revision?: number }) {
  const settings = useDesignSystem();
  const t = useT();
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  // The calendar uses the viewer's locale, timezone and current local day, not the server's.
  const ready = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  return <DesignSystemProvider {...settings} className={`${styles.provider} ${workspaceColors.theme}`} portalContainer={portal} ref={setPortal}>{props.canView === false ? <NoAccessState area={t("Calendar")} /> : ready ? <LocalCrmCalendar {...props} /> : <p role="status">Loading your local calendar…</p>}</DesignSystemProvider>;
}

function LocalCrmCalendar({ workspaceId, currentUserId = "", revision = 0 }: { workspaceId: string; currentUserId?: string; revision?: number }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [mode, setMode] = useState<CalendarMode>("week");
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
  const t = useT();
  const zoneLabel = useWorkspaceZoneLabel();
  const [scope, setScope] = useState<"organization" | "personal" | "member">("organization");
  const [memberId, setMemberId] = useState("");
  const [googleSelection, setGoogleSelection] = useState("all");
  const [connectionError, setConnectionError] = useState("");
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [createOn, setCreateOn] = useState<Date | null>(null);
  const [googleCreateOn, setGoogleCreateOn] = useState<Date | null>(null);
  const range = useMemo(() => calendarRange(anchor, mode), [anchor, mode]);
  const from = range.start.toISOString(), to = range.end.toISOString();
  const currentMember = members.find(member => member.userId === currentUserId);
  const scopedMember = scope === "personal" ? currentMember : scope === "member" ? members.find(member => member.id === memberId) : undefined;
  const ownerId = scope === "organization" ? "" : scopedMember?.id ?? "";
  const key = `${workspaceId}/${from}/${to}/${scope}/${ownerId}/${refresh}/${revision}`;
  const eligibleConnections = connectedGoogleForMember(connections, scopedMember);
  const selectedConnections = (scope !== "organization" && !scopedMember ? [] : eligibleConnections).filter(connection => googleSelection === "all" || googleSelection === connection.id).slice(0, 10);
  const connectionIds = selectedConnections.map(connection => connection.id);
  const connectionIdKey = connectionIds.join(",");
  const googleKey = `${key}/${connectionIdKey}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/workspace/integration-connections?workspaceId=${workspaceId}`, { signal: controller.signal }).then(async (response) => { const payload = await response.json(); if (!response.ok) throw Object.assign(new Error(payload.message ?? "Connections unavailable"), { status: response.status }); return rows(payload) as CalendarConnection[]; }).then((items) => { if (!controller.signal.aborted) setConnections(items.filter((item) => item.provider === "google_workspace")); }).catch((error: Error) => { if (controller.signal.aborted) return; if (isNoAccessError(error)) setConnectionsDenied(true); else setConnectionError(error.message); });
    return () => controller.abort();
  }, [workspaceId, refresh]);
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
        if (cursor) throw new Error("More than 3,000 activities in this range. Choose Week or Day to see the full schedule.");
        const events = crmCalendarEvents(items);
        if (!controller.signal.aborted) setCrm({ key, events });
      } catch (error) { if (!controller.signal.aborted) setCrm({ key, events: [], error: (error as Error).message }); }
    })();
    return () => controller.abort();
  }, [workspaceId, from, to, key, ownerId, scope]);
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
          if (!response.ok) throw Object.assign(new Error(payload.message ?? "Project work could not be loaded."), { status: response.status });
          items.push(...rows(payload)); cursor = typeof payload.nextCursor === "string" ? payload.nextCursor : "";
          if (!cursor) break;
        }
        if (cursor) throw new Error("More than 3,000 project items in this range. Choose Week or Day to see the full schedule.");
        if (!controller.signal.aborted) setProject({ key, events: projectCalendarEvents(items as Parameters<typeof projectCalendarEvents>[0]) });
      } catch (error) { if (!controller.signal.aborted) setProject({ key, events: [], error: isNoAccessError(error) ? undefined : (error as Error).message }); }
    })();
    return () => controller.abort();
  }, [workspaceId, key, ownerId, scope, range.start, range.end]);
  useEffect(() => {
    if (!connectionIdKey) return;
    const connectionIds = connectionIdKey.split(",");
    const controller = new AbortController();
    void (async () => {
      try {
        // Google accepts at most 31 days per request. Split a six-week month grid safely.
        const items: Parameters<typeof googleCalendarEvents>[0] = [];
        for (let cursor = Date.parse(from); cursor < Date.parse(to); cursor += 30 * 86400000) {
          const response = await fetch("/api/workspace/crm/google-calendar", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, connectionIds, timeMin: new Date(cursor).toISOString(), timeMax: new Date(Math.min(cursor + 30 * 86400000, Date.parse(to))).toISOString(), timeZone: timezone }) });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.message ?? "Google events could not be loaded.");
          items.push(...payload.events ?? []);
        }
        if (!controller.signal.aborted) setGoogle({ key: googleKey, events: googleCalendarEvents(items, safeGoogleLink) });
      } catch (error) { if (!controller.signal.aborted) setGoogle({ key: googleKey, events: [], error: (error as Error).message }); }
    })();
    return () => controller.abort();
  }, [workspaceId, connectionIdKey, from, to, timezone, googleKey]);
  const events = [...(crm?.key === key ? crm.events : []), ...(project?.key === key ? project.events : []), ...(connectionIds.length && google?.key === googleKey ? google.events : [])].filter((event) => event.title.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.start.getTime() - b.start.getTime());
  const today = calendarDayKey(new Date());
  const newEventDate = () => calendarDayKey(anchor) === today ? new Date(Math.ceil((Date.now() + 60000) / 1800000) * 1800000) : new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 10);
  const periodTitle = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const periodSubtitle = mode === "month" ? `${new Date(anchor.getFullYear(), anchor.getMonth(), 1).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : `${range.days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${range.days.at(-1)?.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  return <div className={styles.calendarLayout}><div className={styles.calendar}>
    <header className={styles.pageHeader} aria-label="Calendar controls"><div className={styles.scopeBar}><div role="tablist" aria-label="Calendar scope" className={styles.scopeTabs}>
      <button type="button" role="tab" aria-selected={scope === "organization"} onClick={() => { setScope("organization"); setGoogleSelection("all"); }}>Organisation</button>
      {!membersDenied ? <button type="button" role="tab" aria-selected={scope === "personal"} onClick={() => { setScope("personal"); setGoogleSelection("all"); }}>Personal</button> : null}
      {scope === "member" ? <button type="button" role="tab" aria-selected="true">{scopedMember?.displayName ?? "Member"}</button> : null}
    </div><div className={styles.scopeFilters}>
      {!membersDenied ? <SelectField label={<span className="wd-visually-hidden">View member calendar</span>} aria-label="View member calendar" selectedKey={scope === "member" ? memberId : "none"} items={[{ id: "none", label: "Choose member" }, ...members.filter(member => member.status !== "suspended").map(member => ({ id: member.id, label: member.displayName }))]} onSelectionChange={value => { if (value && value !== "none") { setMemberId(String(value)); setScope("member"); setGoogleSelection("all"); } else { setMemberId(""); setScope("organization"); } }} /> : null}
      {eligibleConnections.length ? <SelectField label={<span className="wd-visually-hidden">Google calendars</span>} aria-label="Google calendars" selectedKey={googleSelection} items={[{ id: "all", label: "All Google calendars" }, ...eligibleConnections.map(connection => ({ id: connection.id, label: connection.displayName }))]} onSelectionChange={value => setGoogleSelection(String(value ?? "all"))} /> : null}
    </div></div><div className={styles.topActions}>
      <div className={styles.search}><SearchInput label="Search calendar" placeholder="Search events" value={search} onChange={setSearch} /></div>
      {!connectionsDenied ? <Link className={styles.googleLink} href="/workspace/integrations?connect=google_workspace"><Image src="/icons/integrations/google-calendar.svg" alt="" width={18} height={18} aria-hidden="true" />{connections.some(item => ["connected", "degraded"].includes(item.status)) ? "Manage Google" : "Connect Google"}</Link> : null}
      <Button size="compact" onPress={() => setCreateOn(newEventDate())}><CalendarDays size={15} aria-hidden="true" />Schedule</Button>
      <Button size="compact" variant="primary" onPress={() => connections.some(item => ["connected", "degraded"].includes(item.status)) ? setGoogleCreateOn(newEventDate()) : setCreateOn(newEventDate())}><Plus size={16} aria-hidden="true" />Add event</Button>
    </div></header>
    {memberError ? <Callout title="Members unavailable" tone="warning">{memberError}</Callout> : null}
    {scope === "personal" && members.length > 0 && !currentMember ? <Callout title="Personal calendar unavailable" tone="warning">Your workspace membership could not be identified.</Callout> : null}
    {connectionError ? <Callout title="Google connection access" tone="warning">{connectionError} Workspace events are still available.</Callout> : null}
    {crm?.key === key && crm.error ? <Callout title={t("Calendar could not load")} tone="warning">{crm.error}</Callout> : crm?.key !== key ? <Skeleton lines={6} shape="rows" /> : null}
    {project?.key === key && project.error ? <Callout title="Project schedule unavailable" tone="warning">{project.error}</Callout> : null}
    {connectionIds.length ? google?.key !== googleKey ? <p role="status">Loading Google Calendar…</p> : google.error ? <Callout title="Google Calendar unavailable" tone="warning">{google.error}</Callout> : null : null}
    <section className={styles.calendarFrame} aria-label="Calendar schedule"><div className={styles.periodBar}>
      <div className={styles.periodIdentity}><span className={styles.dateBadge}><small>{anchor.toLocaleDateString(undefined, { month: "short" })}</small><strong>{anchor.getDate()}</strong></span><span><h2>{periodTitle}</h2><small>{periodSubtitle}</small></span></div>
      <div className={styles.periodControls}><div className={styles.periodStepper}><IconButton aria-label="Previous calendar period" onPress={() => setAnchor(moveCalendar(anchor, mode, -1))}><ChevronLeft size={16} /></IconButton><Button size="compact" onPress={() => setAnchor(new Date())}>Today</Button><IconButton aria-label="Next calendar period" onPress={() => setAnchor(moveCalendar(anchor, mode, 1))}><ChevronRight size={16} /></IconButton></div><SelectField label={<span className="wd-visually-hidden">Calendar view</span>} aria-label="Calendar view" items={[{ id: "day", label: "Day view" }, { id: "week", label: "Week view" }, { id: "month", label: "Month view" }]} selectedKey={mode} onSelectionChange={value => setMode(String(value) as CalendarMode)} /><IconButton aria-label="Refresh calendar" onPress={() => { setRefresh(n => n + 1); setConnectionError(""); }}><RefreshCw size={16} /></IconButton></div>
    </div><div className={styles.scheduleMain}>{mode !== "month" ? <CalendarTimeGrid days={range.days} events={events} onSelect={setSelected} onSchedule={setCreateOn} /> : <div className={styles.scroll}><div className={styles.grid} data-mode="month" role="group" aria-label="Month calendar">
      {range.days.slice(0, 7).map(day => <div className={styles.weekday} key={day.toISOString()}>{day.toLocaleDateString(undefined, { weekday: "short" })}</div>)}
      {range.days.map(day => { const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1); const dayEvents = events.filter(event => event.start < nextDay && (event.end && event.end > event.start ? event.end > day : event.start >= day)); return <section key={day.toISOString()} className={styles.day} data-outside={day.getMonth() !== anchor.getMonth() || undefined} aria-label={day.toLocaleDateString(undefined, { dateStyle: "full" })}><button className={styles.date} aria-current={calendarDayKey(day) === today ? "date" : undefined} data-today={calendarDayKey(day) === today || undefined} type="button" aria-label={`Schedule on ${day.toLocaleDateString()}`} onClick={() => setCreateOn(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10))}>{day.getDate()}</button>{dayEvents.slice(0, 3).map(event => <button type="button" className={styles.event} data-kind={event.kind} data-provider={event.provider} key={event.id} aria-label={`${event.provider} ${event.title}`} onClick={() => setSelected(event)}><span className={styles.eventTitle}>{event.title}</span></button>)}{dayEvents.length > 3 ? <button type="button" className={styles.more} onClick={() => { setAnchor(day); setMode("day"); }}>+{dayEvents.length - 3} more</button> : null}</section>; })}
    </div></div>}</div></section>
    <footer className={styles.calendarFooter}><span>{zoneLabel ? t("Workspace: {zone}", { zone: zoneLabel }) : null}</span><span>{events.length} event{events.length === 1 ? "" : "s"} in view</span></footer>
    {createOn ? <ScheduleMeeting workspaceId={workspaceId} date={createOn} onClose={() => setCreateOn(null)} onSaved={() => { setCreateOn(null); setRefresh(n => n + 1); }} /> : null}
    {googleCreateOn ? <GoogleEventDialog workspaceId={workspaceId} connections={eligibleConnections} date={googleCreateOn} onClose={() => setGoogleCreateOn(null)} onSaved={() => { setGoogleCreateOn(null); setRefresh(n => n + 1); }} /> : null}
    {selected?.provider === "crm" ? <FollowUpSheet key={selected.id} workspaceId={workspaceId} recordId={selected.id} onClose={() => setSelected(null)} onSaved={() => setRefresh(n => n + 1)} /> : selected ? <InspectorSheet isOpen title={selected.title} onOpenChange={open => { if (!open) setSelected(null); }}><CalendarDetails workspaceId={workspaceId} event={selected} onChanged={() => setRefresh(n => n + 1)} /></InspectorSheet> : null}
  </div></div>;
}

function ScheduleMeeting({ workspaceId, date, onClose, onSaved }: { workspaceId: string; date: Date; onClose: () => void; onSaved: () => void }) {
  const customers = useCrmResource<unknown>(workspaceId, "parties?limit=100");
  const members = useCrmResource<unknown>(workspaceId, "members");
  const [start] = useState(date);
  const blockedReason = customers.loading || members.loading ? "Loading customers and sales owners…" : customers.failure || members.failure ? `Required records could not load: ${customers.failure || members.failure}. Close this form and retry.` : !rows(customers.data).length ? "Create a customer or enquiry before scheduling a CRM meeting." : !rows(members.data).length ? "No active sales owners are available." : undefined;
  return <ActionDialog workspaceId={workspaceId} onClose={onClose} onSaved={onSaved} action={{ title: "Schedule CRM meeting", blockedReason, description: "Saves a meeting and its calendar appointment together. No Google event or customer invitation is sent.", path: "activities", initial: { type: "meeting", startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600000).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, fields: [{ key: "title", label: "Meeting title", required: true }, { key: "partyId", label: "Customer", options: options(rows(customers.data), "displayName"), required: true }, { key: "ownerMembershipId", label: "Sales owner", options: options(rows(members.data), "displayName"), required: true }, { key: "startsAt", label: "Starts (local time)", type: "datetime-local", required: true }, { key: "endsAt", label: "Ends (local time)", type: "datetime-local", required: true }, { key: "location", label: "Location or meeting link" }, { key: "description", label: "Agenda", type: "textarea" }], transform: ({ startsAt, endsAt, timezone, location, ...values }) => { if (customers.failure || members.failure) throw new Error(customers.failure || members.failure); if (Date.parse(String(endsAt)) <= Date.parse(String(startsAt))) throw new Error("End time must be after start time."); return { ...values, dueAt: startsAt, appointment: { startsAt, endsAt, timezone, location: { text: location ?? "" } } }; } }} />;
}

function GoogleEventDialog({ workspaceId, connections, date, onClose, onSaved }: { workspaceId: string; connections: CalendarConnection[]; date: Date; onClose: () => void; onSaved: () => void }) {
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
  const [saving, setSaving] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const results = await Promise.all(connections.map(async connection => {
          const response = await fetch(`/api/workspace/integration-connections/${connection.id}/tools?${new URLSearchParams({ workspaceId, kind: "calendars" })}`, { signal: controller.signal });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.message ?? "Google calendars could not be loaded.");
          return (payload.calendars ?? []).filter((calendar: RecordData) => calendar.enabled && ["owner", "writer"].includes(String(calendar.accessRole))).map((calendar: RecordData) => ({ connectionId: connection.id, calendarId: String(calendar.externalId), label: `${String(calendar.displayName)} · ${connection.displayName}` }));
        }));
        if (!controller.signal.aborted) setCalendars(results.flat());
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [workspaceId, connections]);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selectedCalendar = calendars[Number(calendarIndex)];
    const from = new Date(start), to = new Date(end);
    if (!selectedCalendar) { setError("Choose a writable Google calendar in Integrations."); return; }
    if (!title.trim() || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) { setError("Enter a title and an end time after the start."); return; }
    const attendeeEmails = attendees.split(/[\s,;]+/).map(email => email.trim()).filter(Boolean);
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/workspace/integration-connections/${selectedCalendar.connectionId}/tools`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, action: "calendar.create", idempotencyKey, payload: { calendarId: selectedCalendar.calendarId, summary: title.trim(), description: description.trim() || undefined, location: location.trim() || undefined, start: from.toISOString(), end: to.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, attendeeEmails, sendUpdates: attendeeEmails.length ? "all" : "none" } }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Google event could not be created.");
      onSaved();
    } catch (failure) { setError((failure as Error).message); }
    finally { setSaving(false); }
  };
  return <ControlledModalDialog isOpen title="Add Google event" isDismissable={!saving} onOpenChange={open => { if (!open && !saving) onClose(); }} footer={<div className={styles.formActions}><Button size="compact" isDisabled={saving} onPress={onClose}>Cancel</Button><Button size="compact" variant="primary" type="submit" form="google-calendar-event" isDisabled={loading || !calendars.length} isLoading={saving}>Add event</Button></div>}>
    <form id="google-calendar-event" className={styles.eventForm} onSubmit={event => void submit(event)}>
      {error ? <Callout title="Google event needs attention" tone="warning">{error}</Callout> : null}
      {loading ? <p role="status">Loading writable calendars…</p> : !calendars.length ? <p>No writable calendar is selected. <Link href="/workspace/integrations?connect=google_workspace">Connect or choose a Google calendar</Link>.</p> : null}
      <label>Calendar<select required value={calendarIndex} onChange={event => setCalendarIndex(event.target.value)}>{calendars.map((calendar, index) => <option key={`${calendar.connectionId}/${calendar.calendarId}`} value={index}>{calendar.label}</option>)}</select></label>
      <label>Event title<input required maxLength={300} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <div className={styles.formColumns}><label>Starts<input required type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></label><label>Ends<input required type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} /></label></div>
      <label>Location<input maxLength={500} value={location} onChange={event => setLocation(event.target.value)} /></label>
      <label>Guests, separated by commas<input type="text" value={attendees} onChange={event => setAttendees(event.target.value)} placeholder="Optional email addresses" /></label>
      <label>Notes<textarea value={description} onChange={event => setDescription(event.target.value)} /></label>
      <small>Guests receive a Google invitation when you add their email addresses. The event is created in the selected Google calendar.</small>
    </form>
  </ControlledModalDialog>;
}

function CalendarDetails({ workspaceId, event, onChanged }: { workspaceId: string; event: CalendarEvent; onChanged: () => void }) {
  const resource = useCrmResource<RecordData>(workspaceId, event.provider === "crm" ? `activities/${event.id}` : null);
  const [action, setAction] = useState<ActionSpec | null>(null);
  const record = resource.data;
  const appointment = record?.appointment as RecordData | null;
  return <div className={styles.details}><Badge tone="neutral">{event.provider === "google" ? "Google Calendar · Live" : event.provider === "project" ? "Project work" : "CRM activity"}</Badge><ResourceState {...resource} retry={resource.refresh} /><FactList facts={[["Starts", event.allDay ? "All day · " + event.start.toLocaleDateString() : dateText(appointment?.startsAt ?? event.start.toISOString())], ["Ends", event.allDay ? "All day" : appointment?.endsAt || event.end ? dateText(appointment?.endsAt ?? event.end?.toISOString()) : "No end time"], ["Status", label(record?.status ?? event.status ?? "Scheduled")], ["Owner", String(record?.ownerName ?? event.ownerName ?? "Not available")], ...(event.calendarName ? [["Calendar / project", event.calendarName] as [string, string]] : []), ...(event.location ? [["Location", event.location] as [string, string]] : [])]} />{event.href ? event.provider === "project" ? <Link href={event.href}>Open project work</Link> : <a href={event.href} target="_blank" rel="noreferrer">Open in Google Calendar</a> : null}{event.description || record?.description ? <p>{String(event.description ?? record?.description)}</p> : null}{event.attendees?.length ? <p>Guests: {event.attendees.map(attendee => attendee.displayName || attendee.email).join(", ")}</p> : null}{record?.partyId ? <Link href={`/workspace/crm/customers?record=${record.partyId}`}>Open customer</Link> : null}{record?.leadId ? <Link href={`/workspace/crm/leads?lead=${record.leadId}`}>Open enquiry</Link> : null}{record?.opportunityId ? <Link href={`/workspace/crm/opportunities?record=${record.opportunityId}`}>Open opportunity</Link> : null}{record?.status === "pending" ? <div className={styles.actions}>{appointment ? <Button size="compact" onPress={() => setAction({ title: "Reschedule meeting", path: `activities/${event.id}/appointment`, method: "PATCH", initial: { version: appointment.version, startsAt: appointment.startsAt, endsAt: appointment.endsAt, timezone: appointment.timezone, location: appointment.location }, fields: [{ key: "startsAt", label: "Starts (local time)", type: "datetime-local", required: true }, { key: "endsAt", label: "Ends (local time)", type: "datetime-local", required: true }] })}>Reschedule</Button> : null}<Button size="compact" onPress={() => setAction({ title: "Complete activity", path: `activities/${event.id}/complete`, initial: { version: record.version }, fields: [{ key: "outcome", label: "Outcome", required: true }] })}>Complete</Button></div> : null}{action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={() => { resource.refresh(); onChanged(); }} /> : null}</div>;
}
