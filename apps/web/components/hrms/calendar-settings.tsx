"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Time, parseDate } from "@internationalized/date";
import type { CalendarInput, HrmsBootstrap, HrmsCalendar, HrmsHoliday } from "@wodana/contracts";
import {
  Badge, Button, Checkbox, ConfirmationDialog, ControlledModalDialog, DataGrid, DateRangeField, EmptyState, ErrorState, InlineNotice, InspectorSheet, SelectField, TextInput, TimeField,
  type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { HrmsApi } from "@/lib/hrms/api";
import { timeZoneOptions } from "@/lib/workspace/regional-options";
import { useHrmsFormat } from "./hrms-format";
import styles from "./hrms.module.css";

const toTime = (value: string) => { const [hour, minute] = value.split(":").map(Number); return new Time(hour, minute); };
const hhmm = (value: { hour: number; minute: number }) => `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;

/** Work calendars: the time zone, working week and hours people follow, how many follow each, and its holidays. */
export function CalendarSettings({ api, boot, creating, onCreateDone, onChanged }: {
  api: HrmsApi; boot: HrmsBootstrap; creating: boolean; onCreateDone: () => void; onChanged: () => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const [calendars, setCalendars] = useState<HrmsCalendar[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setCalendars(await api.calendars()); setError(""); } catch (cause) { setError(format.failure(cause, t("Calendars didn't load."))); }
  }, [api, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const columns = useMemo<DataGridColumn<HrmsCalendar>[]>(() => [
    { id: "name", header: t("Name"), accessorFn: (row) => row.name, size: 220, meta: { primary: true, renderCell: (row) => <span className={styles.inline}>{row.name}{row.isDefault ? <Badge tone="info">{t("Default")}</Badge> : null}</span> } },
    { id: "timezone", header: t("Time zone"), accessorFn: (row) => row.timezone, size: 180, meta: { mobileHidden: true, renderCell: (row) => row.timezone.replaceAll("_", " ") } },
    { id: "week", header: t("Working week"), accessorFn: (row) => format.workingWeek(row.workingDays), size: 160 },
    { id: "hours", header: t("Hours"), accessorFn: (row) => row.dayStart, size: 150, meta: { mobileHidden: true, renderCell: (row) => `${format.clock(row.dayStart)}–${format.clock(row.dayEnd)}` } },
    { id: "holidays", header: t("Holidays"), accessorFn: (row) => row.holidayList.length, size: 110, meta: { renderCell: (row) => <span className={styles.number}>{format.number(row.holidayList.length)}</span> } },
    { id: "people", header: t("People"), accessorFn: (row) => row.people, size: 100, meta: { renderCell: (row) => <span className={styles.number}>{format.number(row.people)}</span> } },
  ], [t, format]);
  if (error && !calendars) return <ErrorState description={error} onRetry={() => void load()} />;
  const open = openId ? calendars?.find((calendar) => calendar.id === openId) ?? null : null;
  const template = calendars?.find((calendar) => calendar.isDefault) ?? calendars?.[0] ?? null;
  const saved = (calendar: HrmsCalendar) => {
    setCalendars((current) => [...(current ?? []).filter((item) => item.id !== calendar.id), calendar]);
    onCreateDone(); setOpenId(calendar.id); void load(); onChanged();
  };
  return <>
    <DataGrid<HrmsCalendar> ariaLabel={t("Calendars")} columns={columns} data={calendars ?? []} getRowId={(row) => row.id} isLoading={!calendars}
      onRowAction={(row) => setOpenId(row.id)} rowNumbers={false} selectable={false} wrapText searchLabel={t("Search calendars")} emptyContent={<EmptyState title={t("No calendars yet")} />} />
    {open ? <CalendarSheet key={open.id} api={api} calendar={open} template={template} zone={boot.workspace.timezone} onClose={() => setOpenId(null)} onSaved={saved}
      onHolidaysChanged={() => void load()} /> : null}
    {creating && calendars ? <CalendarSheet key="new" api={api} calendar={null} template={template} zone={boot.workspace.timezone} onClose={onCreateDone} onSaved={saved}
      onHolidaysChanged={() => void load()} /> : null}
  </>;
}

/** A calendar: its name, time zone, working days in the locale's week, and when a day starts, turns half and ends; then its holidays. */
function CalendarSheet({ api, calendar, template, zone, onClose, onSaved, onHolidaysChanged }: {
  api: HrmsApi; calendar: HrmsCalendar | null; template: HrmsCalendar | null; zone: string; onClose: () => void; onSaved: (calendar: HrmsCalendar) => void; onHolidaysChanged: () => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const source = calendar ?? template;
  const initial: CalendarInput = {
    name: calendar?.name ?? "", timezone: source?.timezone ?? zone, workingDays: [...(source?.workingDays ?? [1, 2, 3, 4, 5])].sort((a, b) => a - b),
    dayStart: source?.dayStart ?? "09:00", halfDay: source?.halfDay ?? "13:00", dayEnd: source?.dayEnd ?? "18:00",
  };
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => {
    const options = timeZoneOptions();
    return options.some((option) => option.id === form.timezone) ? options : [{ id: form.timezone, label: form.timezone.replaceAll("_", " ") }, ...options];
  }, [form.timezone]);
  const set = <K extends keyof CalendarInput>(key: K, value: CalendarInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const ordered = form.dayStart < form.halfDay && form.halfDay < form.dayEnd;
  const valid = Boolean(form.name.trim()) && form.workingDays.length > 0 && ordered;
  const save = async () => {
    setBusy(true); setError("");
    try {
      const input = { ...form, name: form.name.trim() };
      onSaved(calendar ? await api.updateCalendar(calendar.id, { ...input, version: calendar.version }) : await api.createCalendar(input));
    } catch (cause) { setError(format.failure(cause, t("Could not save."))); }
    setBusy(false);
  };
  const timeField = (key: "dayStart" | "halfDay" | "dayEnd", label: string) => <TimeField label={label} isRequired value={toTime(form[key])}
    onChange={(value) => { if (value) set(key, hhmm(value)); }} isInvalid={!ordered} />;
  return <InspectorSheet isOpen size="md" title={calendar?.name ?? t("New calendar")} isDirty={dirty && !busy} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={<div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button variant="primary" isLoading={busy} isDisabled={!dirty || !valid} onPress={() => void save()}>{t("Save")}</Button></div>}>
    <div className={styles.sheet}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextInput label={t("Name")} isRequired value={form.name} onChange={(value) => set("name", value)} maxLength={120} />
      <SelectField label={t("Time zone")} isRequired selectedKey={form.timezone} onSelectionChange={(key) => { if (key) set("timezone", String(key)); }} items={zones} />
      <fieldset className={styles.weekdays}>
        <legend>{t("Working days")}</legend>
        <div>{format.week.map((day) => <Checkbox key={day.day} aria-label={day.long} isSelected={form.workingDays.includes(day.day)}
          onChange={(on) => set("workingDays", (on ? [...form.workingDays, day.day] : form.workingDays.filter((item) => item !== day.day)).sort((a, b) => a - b))}>{day.short}</Checkbox>)}</div>
      </fieldset>
      <div className={styles.trio}>
        {timeField("dayStart", t("Starts"))}
        {timeField("halfDay", t("Half day"))}
        {timeField("dayEnd", t("Ends"))}
      </div>
      {!ordered ? <InlineNotice tone="error" message={t("A day starts before its half, and its half before its end.")} /> : null}
      {calendar ? <Holidays api={api} calendar={calendar} onChanged={onHolidaysChanged} /> : null}
    </div>
  </InspectorSheet>;
}

/** A calendar's holidays, earliest first: each a name and one or more days. */
function Holidays({ api, calendar, onChanged }: { api: HrmsApi; calendar: HrmsCalendar; onChanged: () => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const [editing, setEditing] = useState<HrmsHoliday | "new" | null>(null);
  const [removing, setRemoving] = useState<HrmsHoliday | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const holidays = [...calendar.holidayList].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  return <section className={styles.part} aria-label={t("Holidays")}>
    <h3 className={styles.subhead}>{t("Holidays")}</h3>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {holidays.length ? <ul className={styles.list}>{holidays.map((holiday) => <li key={holiday.id}>
      <span className={styles.grow}><span>{holiday.name}</span><small>{[format.range(holiday.startsOn, holiday.endsOn), format.days(holiday.days)].join(" · ")}</small></span>
      <Button size="compact" variant="quiet" aria-label={t("Edit {name}", { name: holiday.name })} onPress={() => setEditing(holiday)}>{t("Edit")}</Button>
      <Button size="compact" variant="quiet" aria-label={t("Remove {name}", { name: holiday.name })} onPress={() => setRemoving(holiday)}>{t("Remove")}</Button>
    </li>)}</ul> : <p className={styles.muted}>{t("No holidays yet")}</p>}
    <div><Button size="compact" onPress={() => setEditing("new")}>{t("Add holiday")}</Button></div>
    {editing ? <HolidayDialog api={api} calendarId={calendar.id} holiday={editing === "new" ? null : editing} onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); onChanged(); }} /> : null}
    <ConfirmationDialog isOpen={Boolean(removing)} onOpenChange={(open) => { if (!open) setRemoving(null); }} isConfirming={busy} confirmLabel={t("Remove")}
      title={removing ? t("Remove {name}?", { name: removing.name }) : ""} body={removing ? format.range(removing.startsOn, removing.endsOn) : ""}
      onConfirm={async () => {
        if (!removing) return;
        setBusy(true); setError("");
        try { await api.removeHoliday(removing.id, removing.version); onChanged(); } catch (cause) { setError(format.failure(cause, t("Could not save."))); }
        setBusy(false); setRemoving(null);
      }} />
  </section>;
}

function HolidayDialog({ api, calendarId, holiday, onClose, onSaved }: { api: HrmsApi; calendarId: string; holiday: HrmsHoliday | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const [name, setName] = useState(holiday?.name ?? "");
  const [range, setRange] = useState<{ start: string; end: string } | null>(holiday ? { start: holiday.startsOn, end: holiday.endsOn } : null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!range) return;
    setBusy(true); setError("");
    const input = { name: name.trim(), startsOn: range.start, endsOn: range.end };
    try { if (holiday) await api.updateHoliday(holiday.id, { ...input, version: holiday.version }); else await api.addHoliday(calendarId, input); onSaved(); }
    catch (cause) { setError(format.failure(cause, t("Could not save."))); setBusy(false); }
  };
  return <ControlledModalDialog isOpen size="md" title={holiday ? holiday.name : t("Add holiday")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!name.trim() || !range} onPress={() => void save()}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextInput label={t("Name")} isRequired value={name} onChange={setName} maxLength={120} />
      <DateRangeField label={t("Dates")} isRequired value={range ? { start: parseDate(range.start), end: parseDate(range.end) } : null}
        onChange={(value) => setRange(value ? { start: value.start.toString(), end: value.end.toString() } : null)} />
    </div>
  </ControlledModalDialog>;
}
