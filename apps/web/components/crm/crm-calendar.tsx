"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Badge, Button, Callout, DesignSystemProvider, IconButton, InspectorSheet, SearchInput, SegmentedControl, SelectField, useDesignSystem } from "@/design-system";
import { crmRequest, rows, dateText, label, type RecordData } from "@/lib/crm/client";
import { calendarDayKey, calendarRange, moveCalendar, type CalendarMode, type CalendarEvent } from "@/lib/crm/calendar";
import { ActionDialog, FactList, ResourceState, options, useCrmResource, type ActionSpec } from "./crm-workbench";
import { CalendarTimeGrid } from "./calendar-time-grid";
import styles from "./crm-calendar.module.css";
import workspaceColors from "./crm-workspace-colors.module.css";
import { useWorkspaceFocus } from "@/components/workspace/workspace-focus";
import { FollowUpSheet } from "./follow-up-editor";

function safeGoogleLink(value: unknown) { try { const url = new URL(String(value)); return url.protocol === "https:" && ["calendar.google.com", "www.google.com"].includes(url.hostname) ? url.href : undefined; } catch { return undefined; } }

const subscribeToHydration = () => () => {};
export function CrmCalendar(props: { workspaceId: string; revision?: number; focused?: boolean }) {
  useWorkspaceFocus(props.focused === false ? undefined : "Calendar");
  const settings = useDesignSystem();
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  // The calendar uses the viewer's locale, timezone and current local day, not the server's.
  const ready = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  return <DesignSystemProvider {...settings} className={`${styles.provider} ${workspaceColors.theme}`} portalContainer={portal} ref={setPortal}>{ready ? <LocalCrmCalendar {...props} /> : <p role="status">Loading your local calendar…</p>}</DesignSystemProvider>;
}

function LocalCrmCalendar({ workspaceId, revision = 0 }: { workspaceId: string; revision?: number }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [mode, setMode] = useState<CalendarMode>("week");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [crm, setCrm] = useState<{ key: string; events: CalendarEvent[]; error?: string } | null>(null);
  const [google, setGoogle] = useState<{ key: string; events: CalendarEvent[]; error?: string } | null>(null);
  const [connections, setConnections] = useState<RecordData[]>([]);
  const [connectionError, setConnectionError] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [createOn, setCreateOn] = useState<Date | null>(null);
  const range = useMemo(() => calendarRange(anchor, mode), [anchor, mode]);
  const from = range.start.toISOString(), to = range.end.toISOString();
  const key = `${workspaceId}/${from}/${to}/${refresh}/${revision}`;
  const googleKey = `${key}/${connectionId}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/workspace/integration-connections?workspaceId=${workspaceId}`, { signal: controller.signal }).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.message ?? "Connections unavailable"); return rows(payload); }).then((items) => setConnections(items.filter((item) => item.provider === "google_workspace"))).catch((error: Error) => { if (!controller.signal.aborted) setConnectionError(error.message); });
    return () => controller.abort();
  }, [workspaceId, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const items: RecordData[] = [];
      let cursor: string | null = null;
      try {
        for (let page = 0; page < 30; page += 1) {
          const payload: { data: RecordData[]; nextCursor: string | null } = await crmRequest(workspaceId, `activities?limit=100&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "GET", undefined, controller.signal);
          items.push(...payload.data); cursor = payload.nextCursor;
          if (!cursor) break;
        }
        if (cursor) throw new Error("More than 3,000 activities in this range. Choose Week or Day to see the full schedule.");
        const events = items.filter((item) => item.status !== "cancelled").map((item): CalendarEvent => { const appointment = item.appointment as RecordData | undefined; return { id: item.id, title: String(item.title), start: new Date(String(appointment?.startsAt ?? item.dueAt)), ...(appointment?.endsAt ? { end: new Date(String(appointment.endsAt)) } : {}), provider: "crm", kind: String(item.type ?? "task"), status: String(item.status) }; }).filter((item) => Number.isFinite(item.start.getTime()));
        if (!controller.signal.aborted) setCrm({ key, events });
      } catch (error) { if (!controller.signal.aborted) setCrm({ key, events: [], error: (error as Error).message }); }
    })();
    return () => controller.abort();
  }, [workspaceId, from, to, key]);
  useEffect(() => {
    if (!connectionId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        // Google accepts at most 31 days per request. Split a six-week month grid safely.
        const events: CalendarEvent[] = [];
        for (let cursor = Date.parse(from); cursor < Date.parse(to); cursor += 30 * 86400000) {
          const response = await fetch("/api/workspace/crm/google-calendar", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, connectionIds: [connectionId], timeMin: new Date(cursor).toISOString(), timeMax: new Date(Math.min(cursor + 30 * 86400000, Date.parse(to))).toISOString(), timeZone: timezone }) });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.message ?? "Google events could not be loaded.");
          for (const item of payload.events ?? []) {
            const allDay = Boolean(item.start?.date);
            const id = `${item.connectionId}/${item.calendarId}/${item.id}`;
            if (!events.some((event) => event.id === id)) events.push({ id, title: item.title, start: new Date(item.start?.dateTime ?? `${item.start?.date}T00:00:00`), end: new Date(item.end?.dateTime ?? `${item.end?.date}T00:00:00`), allDay, provider: "google", href: safeGoogleLink(item.htmlLink), calendarName: item.calendarName });
          }
        }
        if (!controller.signal.aborted) setGoogle({ key: googleKey, events });
      } catch (error) { if (!controller.signal.aborted) setGoogle({ key: googleKey, events: [], error: (error as Error).message }); }
    })();
    return () => controller.abort();
  }, [workspaceId, connectionId, from, to, timezone, googleKey]);
  const events = [...(crm?.key === key ? crm.events : []), ...(connectionId && google?.key === googleKey ? google.events : [])].filter((event) => event.title.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.start.getTime() - b.start.getTime());
  const today = calendarDayKey(new Date());
  const mini = calendarRange(anchor, 'month');
  const periodTitle = mode === 'week' ? `${range.days[0].toLocaleDateString(undefined, { day:'numeric', month:'short' })} – ${range.days[6].toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' })}` : anchor.toLocaleDateString(undefined, { month:'long', year:'numeric', ...(mode==='day'?{day:'numeric'}:{}) });
  return <div className={styles.calendarLayout}><div className={styles.calendar}>
    <div className={styles.toolbar}><div className={styles.navigation}><h2>{periodTitle}</h2><Button size="compact" onPress={() => setAnchor(new Date())}>Today</Button><IconButton aria-label="Previous calendar period" onPress={() => setAnchor(moveCalendar(anchor, mode, -1))}><ChevronLeft size={17} /></IconButton><IconButton aria-label="Next calendar period" onPress={() => setAnchor(moveCalendar(anchor, mode, 1))}><ChevronRight size={17} /></IconButton></div><div className={styles.actions}><div className={styles.search}><SearchInput label="Search calendar" placeholder="Search events…" value={search} onChange={setSearch} /></div>{connections.length ? <div className={styles.connection}><SelectField label={<span className="wd-visually-hidden">Google Calendar connection</span>} aria-label="Google Calendar connection" items={[{ id: "crm", label: "CRM only" }, ...connections.map((item) => ({ id: item.id, label: String(item.displayName) }))]} disabledKeys={connections.filter((item) => !["connected", "degraded"].includes(String(item.status))).map((item) => item.id)} selectedKey={connectionId || "crm"} onSelectionChange={(key) => setConnectionId(key === "crm" ? "" : String(key))} /></div> : null}<SegmentedControl label="Calendar view" options={[{ id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "month", label: "Month" }]} value={mode} onChange={(value) => setMode(value as CalendarMode)} /><IconButton aria-label="Refresh calendar" onPress={() => { setRefresh((n) => n + 1); setConnectionError(""); }}><RefreshCw size={15} /></IconButton><Button size="compact" variant="primary" onPress={() => setCreateOn(calendarDayKey(anchor) === calendarDayKey(new Date()) ? new Date(Math.ceil((Date.now() + 60000) / 1800000) * 1800000) : new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 10))}>Schedule meeting</Button></div></div>
    {connectionError ? <Callout title="Google connection access" tone="warning">{connectionError} CRM activities are still available.</Callout> : null}
    {crm?.key === key && crm.error ? <Callout title="Calendar could not load" tone="warning">{crm.error}</Callout> : crm?.key !== key ? <p role="status">Loading CRM activities…</p> : null}
    {connectionId ? google?.key !== googleKey ? <p role="status">Loading Google Calendar…</p> : google.error ? <Callout title="Google Calendar unavailable" tone="warning">{google.error}</Callout> : null : null}
    <div className={styles.scheduleLayout}><div className={styles.scheduleMain}>{mode !== 'month' ? <CalendarTimeGrid days={range.days} events={events} onSelect={setSelected} onSchedule={setCreateOn}/> : <div className={styles.scroll}><div className={styles.grid} data-mode={mode} role="group" aria-label={`${label(mode)} calendar`}>
      {range.days.slice(0, 7).map((day) => <div className={styles.weekday} key={day.toISOString()}>{day.toLocaleDateString(undefined, { weekday: "short" })}</div>)}
      {range.days.map((day) => { const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1); const dayEvents = events.filter((event) => event.start < nextDay && (event.end && event.end > event.start ? event.end > day : event.start >= day)); return <section key={day.toISOString()} className={styles.day} data-outside={mode === "month" && day.getMonth() !== anchor.getMonth() || undefined} aria-label={day.toLocaleDateString(undefined, { dateStyle: "full" })}><button className={styles.date} aria-current={calendarDayKey(day) === today ? "date" : undefined} data-today={calendarDayKey(day) === today || undefined} type="button" aria-label={`Schedule on ${day.toLocaleDateString()}`} onClick={() => setCreateOn(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10))}>{day.getDate()}</button>{dayEvents.slice(0, mode === "month" ? 2 : undefined).map((event) => <button type="button" className={styles.event} data-kind={event.kind} data-provider={event.provider} data-completed={event.status === "completed" || undefined} key={event.id} aria-label={`${event.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${event.provider === "google" ? "Google" : "CRM"} ${event.title}`} title={`${event.title} · ${event.start.toLocaleString()} · ${event.provider === "google" ? "Google Calendar" : "CRM"}`} onClick={() => setSelected(event)}><CalendarDays size={12} /><span><small>{event.allDay ? "All day" : event.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}{mode === "month" ? "" : ` · ${event.provider === "google" ? "Google" : "CRM"}`}</small><span className={styles.eventTitle}>{event.title}</span></span></button>)}{mode === "month" && dayEvents.length > 2 ? <button type="button" className={styles.more} onClick={() => { setAnchor(day); setMode("day"); }}>+{dayEvents.length - 2} more</button> : null}</section>; })}
    </div></div>}</div><aside className={styles.calendarSide}>
      <section aria-label="Date navigator"><div className={styles.miniHeading}><strong>{anchor.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</strong><IconButton aria-label="Previous month" onPress={()=>setAnchor(moveCalendar(anchor,'month',-1))}><ChevronLeft size={14}/></IconButton><IconButton aria-label="Next month" onPress={()=>setAnchor(moveCalendar(anchor,'month',1))}><ChevronRight size={14}/></IconButton></div><div className={styles.miniGrid}>{mini.days.slice(0,7).map(day=><span key={day.toISOString()}>{day.toLocaleDateString(undefined,{weekday:'narrow'})}</span>)}{mini.days.map(day=><button key={day.toISOString()} type="button" aria-label={`View ${day.toLocaleDateString(undefined,{dateStyle:'full'})}`} aria-pressed={calendarDayKey(day)===calendarDayKey(anchor)} data-outside={day.getMonth()!==anchor.getMonth()||undefined} data-today={calendarDayKey(day)===today||undefined} onClick={()=>setAnchor(day)}>{day.getDate()}</button>)}</div></section>
      <div className={styles.legend}><span data-kind="task">Follow-ups</span><span data-kind="call">Calls</span><span data-kind="meeting">Meetings</span>{connectionId?<span data-kind="google">Google Calendar</span>:null}</div>
      <small className={styles.zoneName}>{timezone}</small>
    </aside></div>
    {createOn ? <ScheduleMeeting workspaceId={workspaceId} date={createOn} onClose={() => setCreateOn(null)} onSaved={() => setRefresh((n) => n + 1)} /> : null}
    {selected?.provider === "crm" ? <FollowUpSheet key={selected.id} workspaceId={workspaceId} recordId={selected.id} onClose={() => setSelected(null)} onSaved={() => setRefresh((n) => n + 1)} /> : selected ? <InspectorSheet isOpen title={selected.title} onOpenChange={(open) => { if (!open) setSelected(null); }}><CalendarDetails workspaceId={workspaceId} event={selected} onChanged={() => setRefresh((n) => n + 1)} /></InspectorSheet> : null}
  </div></div>;
}

function ScheduleMeeting({ workspaceId, date, onClose, onSaved }: { workspaceId: string; date: Date; onClose: () => void; onSaved: () => void }) {
  const customers = useCrmResource<unknown>(workspaceId, "parties?limit=100");
  const members = useCrmResource<unknown>(workspaceId, "members");
  const [start] = useState(date);
  const blockedReason = customers.loading || members.loading ? "Loading customers and sales owners…" : customers.failure || members.failure ? `Required records could not load: ${customers.failure || members.failure}. Close this form and retry.` : !rows(customers.data).length ? "Create a customer or enquiry before scheduling a CRM meeting." : !rows(members.data).length ? "No active sales owners are available." : undefined;
  return <ActionDialog workspaceId={workspaceId} onClose={onClose} onSaved={onSaved} action={{ title: "Schedule CRM meeting", blockedReason, description: "Saves a meeting and its calendar appointment together. No Google event or customer invitation is sent.", path: "activities", initial: { type: "meeting", startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600000).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, fields: [{ key: "title", label: "Meeting title", required: true }, { key: "partyId", label: "Customer", options: options(rows(customers.data), "displayName"), required: true }, { key: "ownerMembershipId", label: "Sales owner", options: options(rows(members.data), "displayName"), required: true }, { key: "startsAt", label: "Starts (local time)", type: "datetime-local", required: true }, { key: "endsAt", label: "Ends (local time)", type: "datetime-local", required: true }, { key: "location", label: "Location or meeting link" }, { key: "description", label: "Agenda", type: "textarea" }], transform: ({ startsAt, endsAt, timezone, location, ...values }) => { if (customers.failure || members.failure) throw new Error(customers.failure || members.failure); if (Date.parse(String(endsAt)) <= Date.parse(String(startsAt))) throw new Error("End time must be after start time."); return { ...values, dueAt: startsAt, appointment: { startsAt, endsAt, timezone, location: { text: location ?? "" } } }; } }} />;
}

function CalendarDetails({ workspaceId, event, onChanged }: { workspaceId: string; event: CalendarEvent; onChanged: () => void }) {
  const resource = useCrmResource<RecordData>(workspaceId, event.provider === "crm" ? `activities/${event.id}` : null);
  const [action, setAction] = useState<ActionSpec | null>(null);
  const record = resource.data;
  const appointment = record?.appointment as RecordData | null;
  return <div className={styles.details}><Badge tone="neutral">{event.provider === "google" ? "Google Calendar · Live read" : "CRM activity"}</Badge><ResourceState {...resource} retry={resource.refresh} /><FactList facts={[["Starts", dateText(appointment?.startsAt ?? event.start.toISOString())], ["Ends", appointment?.endsAt || event.end ? dateText(appointment?.endsAt ?? event.end?.toISOString()) : "No end time"], ["Status", label(record?.status ?? event.status ?? "Scheduled")], ["Sales owner", String(record?.ownerName ?? "Not available")]]} />{event.href ? <a href={event.href} target="_blank" rel="noreferrer">Open in Google Calendar</a> : null}{record?.description ? <p>{String(record.description)}</p> : null}{record?.partyId ? <Link href={`/workspace/crm/customers?record=${record.partyId}`}>Open customer</Link> : null}{record?.leadId ? <Link href={`/workspace/crm/leads?lead=${record.leadId}`}>Open enquiry</Link> : null}{record?.opportunityId ? <Link href={`/workspace/crm/opportunities?record=${record.opportunityId}`}>Open opportunity</Link> : null}{record?.status === "pending" ? <div className={styles.actions}>{appointment ? <Button size="compact" onPress={() => setAction({ title: "Reschedule meeting", path: `activities/${event.id}/appointment`, method: "PATCH", initial: { version: appointment.version, startsAt: appointment.startsAt, endsAt: appointment.endsAt, timezone: appointment.timezone, location: appointment.location }, fields: [{ key: "startsAt", label: "Starts (local time)", type: "datetime-local", required: true }, { key: "endsAt", label: "Ends (local time)", type: "datetime-local", required: true }] })}>Reschedule</Button> : null}<Button size="compact" onPress={() => setAction({ title: "Complete activity", path: `activities/${event.id}/complete`, initial: { version: record.version }, fields: [{ key: "outcome", label: "Outcome", required: true }] })}>Complete</Button></div> : null}{action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={() => { resource.refresh(); onChanged(); }} /> : null}</div>;
}
