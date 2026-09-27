"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { parseDate } from "@internationalized/date";
import type { HrmsBootstrap, HrmsEmployee, MyTimeWeek, TeamTimeWeek, TimeWeek, Utilisation } from "@wodana/contracts";
import {
  Badge, Button, DataGrid, DateRangeField, EmptyState, ErrorState, InlineNotice, InspectorSheet, SelectField, TextAreaField, TextInput, useDesignSystem, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { HrmsApi } from "@/lib/hrms/api";
import { addDays, clock, parseMinutes } from "@/lib/hrms/time";
import { Facts, PeriodStepper } from "./hrms-controls";
import { useHrmsFormat } from "./hrms-format";
import { SheetStatus } from "./hrms-labels";
import styles from "./hrms.module.css";

const MIN_NOTE = 3;
type Line = { key: string; projectId: string | null; stageId: string | null; label: string; detail: string; cells: Record<string, string> };
type Row = { kind: "line"; line: Line } | { kind: "total" };
const lineKey = (projectId: string | null, stageId: string | null) => `${projectId ?? "internal"}:${stageId ?? ""}`;
const editable = (week: TimeWeek) => !week.timesheet || week.timesheet.status === "draft" || week.timesheet.status === "returned";

/** Each piece of work the week has hours for — a project (and its stage) or internal work — with its hours by day. */
function linesOf(week: MyTimeWeek, internal: string): { lines: Line[]; notes: Map<string, string> } {
  const lines = new Map<string, Line>();
  const notes = new Map<string, string>();
  for (const entry of week.entries) {
    const key = lineKey(entry.projectId, entry.stageId);
    const line = lines.get(key) ?? { key, projectId: entry.projectId, stageId: entry.stageId, label: entry.projectName ?? internal, detail: entry.stageName ?? "", cells: {} };
    lines.set(key, line);
    const minutes = (parseMinutes(line.cells[entry.workDate] ?? "") ?? 0) + entry.minutes;
    line.cells[entry.workDate] = clock(minutes);
    if (entry.note) notes.set(`${key}|${entry.workDate}`, [notes.get(`${key}|${entry.workDate}`), entry.note].filter(Boolean).join("; "));
  }
  return { lines: [...lines.values()], notes };
}

/**
 * My hours for a week: a row for each project (and stage) or internal work, a column for each day, each
 * day's total against what my calendar expects (leave marked). Saved as I go, then submitted for approval.
 */
export function TimeTab({ api, employee, date, onDate }: { api: HrmsApi; employee: HrmsEmployee; date: string | null; onDate: (weekStart: string) => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const { locale } = useDesignSystem();
  const today = format.today(employee.calendar.timezone);
  const target = date ?? today;
  const [week, setWeek] = useState<{ target: string; data: MyTimeWeek } | null>(null);
  const [draft, setDraft] = useState<{ lines: Line[]; notes: Map<string, string>; base: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const show = useCallback((data: MyTimeWeek, forTarget: string) => {
    const { lines, notes } = linesOf(data, t("Internal"));
    setWeek({ target: forTarget, data });
    setDraft({ lines, notes, base: JSON.stringify(lines) });
  }, [t]);
  const load = useCallback(async () => {
    try { show(await api.myTime(target), target); setError(""); } catch (cause) { setError(format.failure(cause, t("Your hours didn't load."))); }
  }, [api, target, show, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const current = week?.target === target ? week.data : null;
  const dayLabel = useMemo(() => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "numeric" }), [locale]);
  const open = current ? editable(current) : false;
  const days = current?.days ?? [];
  const loggable = (day: string) => open && day <= today && day >= employee.activeFrom && (!employee.activeTo || day <= employee.activeTo);
  const minutes = (line: Line, day: string) => parseMinutes(line.cells[day] ?? "") ?? 0;
  const lines = draft?.lines ?? [];
  const invalid = lines.some((line) => Object.values(line.cells).some((value) => parseMinutes(value) === null));
  const dayTotal = (day: string) => lines.reduce((sum, line) => sum + minutes(line, day), 0);
  const overDay = days.some((day) => dayTotal(day.date) > 1440);
  const weekTotal = days.reduce((sum, day) => sum + dayTotal(day.date), 0);
  const expected = days.reduce((sum, day) => sum + day.scheduledMinutes, 0);
  const dirty = Boolean(draft && JSON.stringify(draft.lines) !== draft.base);
  const setCell = (key: string, day: string, value: string) => setDraft((previous) => previous && ({
    ...previous, lines: previous.lines.map((line) => (line.key === key ? { ...line, cells: { ...line.cells, [day]: value } } : line)),
  }));
  // The cells are the draft's fields, so the columns follow it on every change.
  const columns: DataGridColumn<Row>[] = [
    { id: "work", header: t("Work"), accessorFn: (row) => (row.kind === "line" ? row.line.label : ""), size: 240, meta: { primary: true,
      renderCell: (row) => (row.kind === "total" ? <strong>{t("Total")}</strong> : <span className={styles.nameCell}><span>{row.line.label}</span>{row.line.detail ? <small>{row.line.detail}</small> : null}</span>) } },
    ...days.map((day): DataGridColumn<Row> => ({
      id: day.date, header: dayLabel.format(new Date(`${day.date}T00:00:00Z`)), size: 104, meta: { align: "end", renderCell: (row) => {
        if (row.kind === "total") return <span className={styles.dayTotal}>
          <span className={styles.number} data-over={dayTotal(day.date) > 1440 || undefined}>{clock(dayTotal(day.date)) || "0:00"}</span>
          {day.leaveDays > 0 ? <Badge tone="info">{t("Leave")}</Badge> : <small className={styles.number}>{clock(day.scheduledMinutes)}</small>}
        </span>;
        const value = row.line.cells[day.date] ?? "";
        if (!loggable(day.date)) return <span className={styles.number}>{value}</span>;
        return <TextInput label={null} aria-label={t("{work} on {day}", { work: [row.line.label, row.line.detail].filter(Boolean).join(" · "), day: format.day(day.date) })}
          inputMode="decimal" placeholder="0:00" value={value} onChange={(next) => setCell(row.line.key, day.date, next)}
          isInvalid={parseMinutes(value) === null} errorMessage={t("Like 7:30")} />;
      } },
    })),
    { id: "total", header: t("Total"), accessorFn: () => 0, size: 110, meta: { align: "end", renderCell: (row) => <span className={styles.number}>
      {row.kind === "total" ? `${clock(weekTotal) || "0:00"} / ${clock(expected) || "0:00"}` : clock(days.reduce((sum, day) => sum + minutes(row.line, day.date), 0))}</span> } },
  ];
  if (error && !current) return <ErrorState description={error} onRetry={() => void load()} />;
  const save = async (): Promise<MyTimeWeek | null> => {
    if (!current || !draft) return null;
    const entries = draft.lines.flatMap((line) => days.map((day) => ({ day: day.date, minutes: minutes(line, day.date) })).filter((cell) => cell.minutes > 0)
      .map((cell) => ({ workDate: cell.day, projectId: line.projectId, stageId: line.stageId, minutes: cell.minutes, note: draft.notes.get(`${line.key}|${cell.day}`) ?? "" })));
    const next = await api.saveWeek(current.weekStart, { version: current.timesheet?.version ?? 0, entries });
    show(next, target);
    return next;
  };
  const run = async (kind: "save" | "submit") => {
    setBusy(kind); setNotice("");
    try {
      const saved = dirty || kind === "save" ? await save() : current;
      if (kind === "submit" && saved?.timesheet) {
        const sent = await api.submitWeek(saved.timesheet.id, saved.timesheet.version);
        show({ ...sent, options: saved.options }, target);
      }
    } catch (cause) { setNotice(format.failure(cause, t("Could not save."))); }
    setBusy(null);
  };
  const used = new Set(lines.map((line) => line.key));
  const workOptions = current ? [{ id: lineKey(null, null), label: t("Internal") }, ...current.options.flatMap((project) => [
    { id: lineKey(project.id, null), label: project.name },
    ...project.stages.map((stage) => ({ id: lineKey(project.id, stage.id), label: project.name, description: stage.name })),
  ])].filter((option) => !used.has(option.id)) : [];
  const add = (key: string) => {
    const option = workOptions.find((item) => item.id === key);
    if (!option || !current) return;
    const [project, stage] = key.split(":");
    setDraft((previous) => previous && ({ ...previous, lines: [...previous.lines, {
      key, projectId: project === "internal" ? null : project, stageId: stage || null, label: option.label, detail: "description" in option ? option.description ?? "" : "", cells: {},
    }] }));
  };
  const tools = <div className={styles.toolbar}>
    <PeriodStepper label={current ? format.range(current.weekStart, addDays(current.weekStart, 6)) : format.date(target)} previousLabel={t("Previous week")} nextLabel={t("Next week")}
      canNext={Boolean(current && addDays(current.weekStart, 7) <= today)} onPrevious={() => current && onDate(addDays(current.weekStart, -7))}
      onNext={() => current && onDate(addDays(current.weekStart, 7))} />
    {current?.timesheet ? <SheetStatus status={current.timesheet.status} /> : null}
    {open && workOptions.length ? <SelectField aria-label={t("Add work")} label={null} placeholder={t("Add work")} selectedKey={null} items={workOptions}
      onSelectionChange={(key) => { if (key) add(String(key)); }} /> : null}
  </div>;
  const actions = current && open ? <>
    <Button isLoading={busy === "save"} isDisabled={Boolean(busy) || !dirty || invalid || overDay} onPress={() => void run("save")}>{t("Save")}</Button>
    <Button variant="primary" isLoading={busy === "submit"} isDisabled={Boolean(busy) || invalid || overDay || weekTotal === 0} onPress={() => void run("submit")}>{t("Submit")}</Button>
  </> : undefined;
  const sheet = current?.timesheet;
  return <>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    {overDay ? <InlineNotice tone="error" message={t("A day has at most 24 hours.")} /> : null}
    {sheet?.decisionNote && open ? <InlineNotice tone="info" message={sheet.decidedByName ? t("Sent back by {name}: {note}", { name: sheet.decidedByName, note: sheet.decisionNote })
      : t("Sent back: {note}", { note: sheet.decisionNote })} /> : null}
    <DataGrid<Row> appearance="flush" ariaLabel={t("My hours")} columns={columns} data={current ? [...lines.map((line) => ({ kind: "line" as const, line })), { kind: "total" as const }] : []}
      getRowId={(row) => (row.kind === "line" ? row.line.key : "total")} isLoading={!current} rowNumbers={false} selectable={false} showFooter={false} wrapText
      toolbarLeading={tools} toolbarActions={actions} emptyContent={<EmptyState title={t("No hours this week")} />} />
  </>;
}

/**
 * Someone's week as their manager sees it: the hours by piece of work and by day against what was expected,
 * and — while it waits — approve, or send it back saying what to change.
 */
export function TimesheetSheet({ api, week, canDecide, onClose, onDecided }: {
  api: HrmsApi; week: TimeWeek; canDecide: boolean; onClose: () => void; onDecided: (week: TimeWeek) => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "return" | null>(null);
  const [error, setError] = useState("");
  const sheet = week.timesheet;
  const deciding = canDecide && sheet?.status === "submitted";
  const expected = week.days.reduce((sum, day) => sum + day.scheduledMinutes, 0);
  const byWork = [...week.entries.reduce((map, entry) => {
    const key = lineKey(entry.projectId, entry.stageId);
    const row = map.get(key) ?? { label: entry.projectName ?? t("Internal"), detail: entry.stageName ?? "", minutes: 0 };
    row.minutes += entry.minutes;
    return map.set(key, row);
  }, new Map<string, { label: string; detail: string; minutes: number }>()).values()];
  const decide = async (decision: "approve" | "return") => {
    if (!sheet) return;
    setBusy(decision); setError("");
    try { onDecided(await api.decideWeek(sheet.id, { version: sheet.version, decision, note: note.trim() })); }
    catch (cause) { setError(format.failure(cause, t("Could not save."))); setBusy(null); }
  };
  return <InspectorSheet isOpen size="md" title={week.name} description={format.range(week.weekStart, addDays(week.weekStart, 6))} isDirty={Boolean(note.trim()) && !busy}
    onOpenChange={(value) => { if (!value) onClose(); }}
    footer={deciding ? <div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button isLoading={busy === "return"} isDisabled={Boolean(busy) || note.trim().length < MIN_NOTE} onPress={() => void decide("return")}>{t("Send back")}</Button>
      <Button variant="primary" isLoading={busy === "approve"} isDisabled={Boolean(busy)} onPress={() => void decide("approve")}>{t("Approve")}</Button>
    </div> : null}>
    <div className={styles.sheet}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <Facts items={[
        [t("Status"), sheet ? <SheetStatus key="status" status={sheet.status} /> : t("Not started")],
        [t("Hours"), `${format.duration(week.totalMinutes) || "0m"} / ${format.duration(expected) || "0m"}`],
        sheet?.submittedAt ? [t("Submitted"), format.moment(sheet.submittedAt)] : null,
        sheet?.decidedByName ? [sheet.status === "approved" ? t("Approved by") : t("Sent back by"), sheet.decidedByName] : null,
        sheet?.decisionNote ? [t("Note"), sheet.decisionNote] : null,
      ]} />
      <section className={styles.part} aria-label={t("By work")}>
        <h3 className={styles.subhead}>{t("By work")}</h3>
        {byWork.length ? <ul className={styles.list}>{byWork.map((row) => <li key={`${row.label}|${row.detail}`}>
          <span className={styles.grow}><span>{row.label}</span>{row.detail ? <small>{row.detail}</small> : null}</span>
          <span className={styles.number}>{format.duration(row.minutes)}</span>
        </li>)}</ul> : <p className={styles.muted}>{t("No hours this week")}</p>}
      </section>
      <section className={styles.part} aria-label={t("By day")}>
        <h3 className={styles.subhead}>{t("By day")}</h3>
        <ul className={styles.list}>{week.days.map((day) => {
          const logged = week.entries.filter((entry) => entry.workDate === day.date).reduce((sum, entry) => sum + entry.minutes, 0);
          return <li key={day.date}>
            <span className={styles.grow}><span>{format.day(day.date)}</span></span>
            {day.leaveDays > 0 ? <Badge tone="info">{t("Leave")}</Badge> : null}
            <span className={styles.number}>{`${clock(logged) || "0:00"} / ${clock(day.scheduledMinutes) || "0:00"}`}</span>
          </li>;
        })}</ul>
      </section>
      {deciding ? <TextAreaField label={t("Note")} description={t("Needed to send it back")} value={note} onChange={setNote} /> : null}
    </div>
  </InspectorSheet>;
}

type TeamPerson = TeamTimeWeek["people"][number];

/** My team's week: each person's logged hours against what their calendar expects, and where their timesheet is. */
export function TeamTime({ api, boot, switcher }: { api: HrmsApi; boot: HrmsBootstrap; switcher: ReactNode }) {
  const t = useT();
  const format = useHrmsFormat();
  const today = format.today(boot.workspace.timezone);
  const [date, setDate] = useState(today);
  const [data, setData] = useState<{ date: string; week: TeamTimeWeek } | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData({ date, week: await api.teamTime(date) }); setError(""); } catch (cause) { setError(format.failure(cause, t("The team's hours didn't load."))); }
  }, [api, date, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const week = data?.date === date ? data.week : null;
  const columns = useMemo<DataGridColumn<TeamPerson>[]>(() => [
    { id: "person", header: t("Person"), accessorFn: (row) => row.name, size: 220, meta: { primary: true } },
    { id: "logged", header: t("Logged"), accessorFn: (row) => row.totalMinutes, size: 120, meta: { align: "end", renderCell: (row) => <span className={styles.number}>{format.duration(row.totalMinutes) || "0m"}</span> } },
    { id: "expected", header: t("Expected"), accessorFn: (row) => row.scheduledMinutes, size: 120, meta: { align: "end", renderCell: (row) => <span className={styles.number}>{format.duration(row.scheduledMinutes) || "0m"}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.timesheet?.status ?? "", size: 180,
      meta: { renderCell: (row) => (row.timesheet ? <SheetStatus status={row.timesheet.status} /> : <span className={styles.muted}>{t("Not started")}</span>) } },
  ], [t, format]);
  const tools = <div className={styles.toolbar}>
    {switcher}
    <PeriodStepper label={week ? format.range(week.weekStart, addDays(week.weekStart, 6)) : format.date(date)} previousLabel={t("Previous week")} nextLabel={t("Next week")}
      canNext={addDays(date, 7) <= addDays(today, 6)} onPrevious={() => setDate(addDays(date, -7))} onNext={() => setDate(addDays(date, 7))} />
  </div>;
  if (error && !week) return <>{tools}<ErrorState description={error} onRetry={() => void load()} /></>;
  const person = open ? week?.people.find((row) => row.membershipId === open) ?? null : null;
  return <>
    <DataGrid<TeamPerson> appearance="flush" ariaLabel={t("Team hours")} columns={columns} data={week?.people ?? []} getRowId={(row) => row.membershipId} isLoading={!week}
      onRowAction={(row) => setOpen(row.membershipId)} rowNumbers={false} selectable={false} wrapText searchLabel={t("Search people")} toolbarLeading={tools}
      emptyContent={<EmptyState title={t("No one to show")} />} />
    {person ? <TimesheetSheet api={api} week={person} canDecide={person.canDecide} onClose={() => setOpen(null)} onDecided={() => { setOpen(null); void load(); }} /> : null}
  </>;
}

type UtilisationRow = Utilisation["people"][number];

/** Over a period: the hours each person's calendar expects, their approved project and internal hours, and the share on projects. */
export function TeamUtilisation({ api, boot, switcher }: { api: HrmsApi; boot: HrmsBootstrap; switcher: ReactNode }) {
  const t = useT();
  const format = useHrmsFormat();
  const today = format.today(boot.workspace.timezone);
  const [range, setRange] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const [data, setData] = useState<{ key: string; rows: UtilisationRow[] } | null>(null);
  const [error, setError] = useState("");
  const key = `${range.from}:${range.to}`;
  const load = useCallback(async () => {
    try { setData({ key, rows: (await api.utilisation(range.from, range.to)).people }); setError(""); } catch (cause) { setError(format.failure(cause, t("Utilisation didn't load."))); }
  }, [api, key, range, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const rows = data?.key === key ? data.rows : null;
  const columns = useMemo<DataGridColumn<UtilisationRow>[]>(() => {
    const hours = (minutes: number) => <span className={styles.number}>{format.duration(minutes) || "0m"}</span>;
    return [
    { id: "person", header: t("Person"), accessorFn: (row) => row.name, size: 220, meta: { primary: true } },
    { id: "expected", header: t("Expected"), accessorFn: (row) => row.scheduledMinutes, size: 120, meta: { align: "end", renderCell: (row) => hours(row.scheduledMinutes) } },
    { id: "project", header: t("Projects"), accessorFn: (row) => row.projectMinutes, size: 120, meta: { align: "end", renderCell: (row) => hours(row.projectMinutes) } },
    { id: "internal", header: t("Internal"), accessorFn: (row) => row.internalMinutes, size: 120, meta: { align: "end", mobileHidden: true, renderCell: (row) => hours(row.internalMinutes) } },
    { id: "share", header: t("Utilisation"), accessorFn: (row) => row.utilisation ?? -1, size: 120, meta: { align: "end",
      renderCell: (row) => <span className={styles.number}>{row.utilisation === null ? "" : t("{percent}%", { percent: format.number(row.utilisation) })}</span> } },
    ];
  }, [t, format]);
  const tools = <div className={styles.toolbar}>
    {switcher}
    <DateRangeField label={t("Dates")} value={{ start: parseDate(range.from), end: parseDate(range.to) }}
      onChange={(value) => { if (value) setRange({ from: value.start.toString(), to: value.end.toString() }); }} />
  </div>;
  if (error && !rows) return <>{tools}<ErrorState description={error} onRetry={() => void load()} /></>;
  return <DataGrid<UtilisationRow> appearance="flush" ariaLabel={t("Utilisation")} columns={columns} data={rows ?? []} getRowId={(row) => row.membershipId} isLoading={!rows}
    rowNumbers={false} selectable={false} wrapText searchLabel={t("Search people")} toolbarLeading={tools} emptyContent={<EmptyState title={t("No one to show")} />} />;
}
