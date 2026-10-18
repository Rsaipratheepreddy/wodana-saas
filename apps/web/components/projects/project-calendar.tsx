"use client";

import { useMemo, useState } from "react";
import { Button, Checkbox, ControlledModalDialog, DataGrid, DayAgenda, IconMenuButton, MonthCalendar, monthOf, type ActionItem, type DataGridColumn, type MonthCalendarEvent, type MonthCalendarTone } from "@/design-system";
import { label, type ProjectResource, type ProjectState } from "@/lib/projects/execution";
import { quantityToSource } from "@/lib/projects/purchasing";
import type { WorkCalendar } from "../../../../services/business-core/src/projects/project-calendar";
import s from "./project-workspace.module.css";
import c from "./project-calendar.module.css";

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const kinds = [
  { id: "task", label: "Tasks" },
  { id: "milestone", label: "Milestones" },
  { id: "material", label: "Materials needed" },
  { id: "delivery", label: "Deliveries" },
  { id: "booking", label: "Team bookings" },
  { id: "report", label: "Site updates" },
] as const;
type Kind = (typeof kinds)[number]["id"];
export type ProjectCalendarEvent = MonthCalendarEvent & { kind: Kind; recordId: string };

/** Everything with a date in the project, in one list the calendar and agenda share. */
export function projectCalendarEvents(state: ProjectState, today: string): ProjectCalendarEvent[] {
  const d = state.data, root = `/workspace/projects/${state.id}`;
  const resourceName = (id: string) => state.resources.find((resource) => resource.id === id)?.name ?? "Team";
  const events: ProjectCalendarEvent[] = [];
  for (const task of d.tasks) {
    if (task.status === "cancelled" || !task.start || d.tasks.some((child) => child.parentId === task.id && child.status !== "cancelled")) continue;
    const tone: MonthCalendarTone = ["blocked", "on_hold"].includes(task.status) ? "danger" : task.status === "completed" ? "success" : task.status === "planned" && task.end < today ? "warning" : "brand";
    events.push({ id: `task:${task.id}`, recordId: task.id, kind: "task", date: task.start, endDate: task.end || task.start, title: task.title, detail: `${task.area || label(task.location)} · ${label(task.status)}`, tone });
  }
  for (const milestone of d.milestones ?? []) {
    const overdue = !milestone.acceptedAt && milestone.dueDate < today;
    events.push({ id: `milestone:${milestone.id}`, recordId: milestone.id, kind: "milestone", date: milestone.dueDate, title: milestone.title, detail: milestone.acceptedAt ? "Milestone accepted" : overdue ? "Milestone overdue" : "Milestone due", tone: milestone.acceptedAt ? "success" : overdue ? "danger" : "info", href: `${root}/plan-teams?view=schedule` });
  }
  for (const material of d.materials) {
    if (!material.needBy) continue;
    const shortfall = material.supply === "company" && quantityToSource(material, d.orders) > 0;
    events.push({ id: `material:${material.id}`, recordId: material.id, kind: "material", date: material.needBy, title: `${material.title} needed`, detail: `${material.required} ${material.unit}${shortfall ? " · not yet ordered" : ""}`, tone: shortfall ? (material.needBy < today ? "danger" : "warning") : "neutral", href: `${root}/material-planning` });
  }
  for (const order of d.orders) {
    if (!order.promisedDate || ["enquiry", "cancelled"].includes(order.status)) continue;
    const received = order.receipts.reduce((n, receipt) => n + receipt.accepted, 0);
    const done = order.status === "closed" || received >= order.quantity;
    events.push({ id: `order:${order.id}`, recordId: order.id, kind: "delivery", date: order.promisedDate, title: `${order.number} · ${order.vendor}`, detail: `${order.quantity} ${order.unit} · ${label(order.status)}`, tone: done ? "success" : order.promisedDate < today ? "danger" : "info", href: `${root}/procurement?record=${order.id}` });
  }
  for (const booking of state.bookings) {
    if (booking.projectId !== state.id) continue;
    events.push({ id: `booking:${booking.id}`, recordId: booking.taskId, kind: "booking", date: booking.start, endDate: booking.end, title: `${resourceName(booking.resourceId)} booked`, detail: booking.taskTitle, tone: "neutral" });
  }
  for (const report of d.reports) {
    events.push({ id: `report:${report.id}`, recordId: report.id, kind: "report", date: report.date, title: report.summary || `${label(report.location)} update`, detail: `${report.author} · ${label(report.status)}`, tone: report.status === "approved" ? "success" : report.status === "returned" ? "danger" : "neutral", href: `${root}/daily-progress?record=${report.id}` });
  }
  return events.sort((left, right) => left.date.localeCompare(right.date));
}

const defaultCalendar = (): WorkCalendar => ({ weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: "08:00", endTime: "17:00", holidays: [] });

export function ProjectCalendar({ state, run, busy, today, onOpen }: {
  state: ProjectState;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
  today: string;
  onOpen: (recordId: string) => void;
}) {
  const [month, setMonth] = useState(() => monthOf(today));
  const [day, setDay] = useState(today);
  const [active, setActive] = useState<Set<Kind>>(() => new Set(kinds.map((kind) => kind.id)));
  const [resource, setResource] = useState<ProjectResource | null>(null);
  const [calendar, setCalendar] = useState<WorkCalendar>(defaultCalendar);
  const [error, setError] = useState("");
  const all = useMemo(() => projectCalendarEvents(state, today), [state, today]);
  const events = useMemo(() => all.filter((event) => active.has(event.kind)), [all, active]);
  const count = (kind: Kind) => all.filter((event) => event.kind === kind).length;
  const working = state.resources.map((item) => item.calendar?.weekdays).filter((weekdays): weekdays is number[] => Boolean(weekdays));
  const nonWorking = working.length ? [0, 1, 2, 3, 4, 5, 6].filter((weekday) => working.every((weekdays) => !weekdays.includes(weekday))) : [];
  const person = (id: string) => state.members.find((member) => member.id === id)?.name ?? "";
  const columns: DataGridColumn<ProjectResource>[] = [
    { id: "resource", header: "Resource", size: 220, accessorFn: (r) => r.name, meta: { primary: true, renderCell: (r) => <span className={c.title}><strong>{r.name}</strong><small>{label(r.kind)}{r.members.length ? ` · ${r.members.map(person).filter(Boolean).join(", ")}` : ""}</small></span> } },
    { id: "week", header: "Working week", size: 220, accessorFn: (r) => r.calendar?.weekdays.length ?? 7, meta: { renderCell: (r) => <span className={c.week}>{dayNames.map((name, index) => <span data-on={(r.calendar?.weekdays ?? [0, 1, 2, 3, 4, 5, 6]).includes(index) || undefined} key={name}>{name.slice(0, 1)}</span>)}</span> } },
    { id: "shift", header: "Daily shift", size: 130, accessorFn: (r) => r.calendar?.startTime ?? "", meta: { renderCell: (r) => r.calendar ? `${r.calendar.startTime} – ${r.calendar.endTime}` : <span className={c.muted}>Full day</span> } },
    { id: "exceptions", header: "Non-working dates", size: 150, accessorFn: (r) => r.calendar?.holidays.length ?? 0, meta: { align: "end", renderCell: (r) => r.calendar?.holidays.length ? r.calendar.holidays.length : <span className={c.muted}>None</span> } },
    { id: "actions", header: "", size: 56, enableSorting: false, enableHiding: false, meta: { align: "end", renderCell: (r) => {
      if (!state.canManage) return null;
      const items: ActionItem[] = [{ id: "edit", label: r.calendar ? "Edit calendar" : "Set calendar" }];
      return <span data-grid-interactive><IconMenuButton ariaLabel={`Calendar actions for ${r.name}`} items={items} onAction={() => { setResource(r); setError(""); setCalendar(r.calendar ?? defaultCalendar()); }} /></span>;
    } } },
  ];
  return <div className={c.wrap}>
    <div className="wd-calendar-filters" role="group" aria-label="Show on calendar">
      {kinds.map((kind) => <Checkbox isSelected={active.has(kind.id)} key={kind.id} onChange={(checked) => setActive((current) => { const next = new Set(current); if (checked) next.add(kind.id); else next.delete(kind.id); return next; })}>{kind.label}{count(kind.id) ? ` · ${count(kind.id)}` : ""}</Checkbox>)}
    </div>
    <div className="wd-calendar-layout">
      <MonthCalendar events={events} month={month} nonWorkingWeekdays={nonWorking} onMonthChange={setMonth} onSelect={setDay} selected={day} today={today} />
      <DayAgenda day={day} empty="Nothing scheduled for this day" events={events} onOpen={(event) => onOpen((event as ProjectCalendarEvent).recordId)} />
    </div>
    <details className={c.hours}>
      <summary><span><strong>Working hours & exceptions</strong><small>Bookings respect each team’s shift, working days, dated exceptions and approved leave. Times are in {state.timezone ?? "workspace time"}.</small></span><span className={c.hint}>{state.resources.length} resource{state.resources.length === 1 ? "" : "s"}</span></summary>
      <div className={c.hoursBody}>
        <DataGrid appearance="flush" ariaLabel="Resource calendars" columns={columns} data={state.resources} emptyDescription="Add crews, people or factory slots under Teams & bookings, then set their working calendar here." emptyTitle="No resources yet" getRowId={(r) => r.id} pageSize={50} rowNumbers={false} selectable={false} showToolbar={false} />
      </div>
    </details>
    <ControlledModalDialog isOpen={Boolean(resource)} onOpenChange={(open) => !open && setResource(null)} title={`Calendar · ${resource?.name ?? ""}`}>
      <form className={s.form} onSubmit={async (event) => {
        event.preventDefault();
        if (await run("resource", { resource: { ...resource, calendar } })) setResource(null);
        else setError("Calendar was not saved. Release future bookings before changing a resource calendar.");
      }}>
        {error ? <p className={s.error} role="alert">{error}</p> : null}
        <fieldset className={c.fieldset}>
          <legend>Working days</legend>
          <div className={c.days}>{dayNames.map((name, index) => <Checkbox isSelected={calendar.weekdays.includes(index)} key={name} onChange={(checked) => setCalendar({ ...calendar, weekdays: checked ? [...calendar.weekdays, index].sort() : calendar.weekdays.filter((weekday) => weekday !== index) })}>{name.slice(0, 3)}</Checkbox>)}</div>
        </fieldset>
        <div className={s.grid}>
          <label className={s.field}>Shift starts<input onChange={(event) => setCalendar({ ...calendar, startTime: event.target.value })} required type="time" value={calendar.startTime} /></label>
          <label className={s.field}>Shift ends<input onChange={(event) => setCalendar({ ...calendar, endTime: event.target.value })} required type="time" value={calendar.endTime === "24:00" ? "23:59" : calendar.endTime} /></label>
        </div>
        <div className={c.exceptionsHead}><h3>Non-working dates</h3><Button onPress={() => setCalendar({ ...calendar, holidays: [...calendar.holidays, { date: "", reason: "" }] })} size="compact">Add exception</Button></div>
        {calendar.holidays.map((holiday, index) => <div className={c.exception} key={index}>
          <label className={s.field}>Date<input onChange={(event) => setCalendar({ ...calendar, holidays: calendar.holidays.map((item, position) => position === index ? { ...item, date: event.target.value } : item) })} required type="date" value={holiday.date} /></label>
          <label className={s.field}>Reason<input onChange={(event) => setCalendar({ ...calendar, holidays: calendar.holidays.map((item, position) => position === index ? { ...item, reason: event.target.value } : item) })} required value={holiday.reason} /></label>
          <Button onPress={() => setCalendar({ ...calendar, holidays: calendar.holidays.filter((_, position) => position !== index) })} size="compact" variant="quiet">Remove</Button>
        </div>)}
        <p className={s.muted}>Release future bookings before changing a resource calendar, then rebook the affected work against the new availability.</p>
        <div className={c.dialogActions}><Button onPress={() => setResource(null)}>Cancel</Button><Button isDisabled={busy} type="submit" variant="primary">Save calendar</Button></div>
      </form>
    </ControlledModalDialog>
  </div>;
}
