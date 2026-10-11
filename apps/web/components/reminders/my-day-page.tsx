"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fromDate, toCalendarDate, type DateValue, type ZonedDateTime } from "@internationalized/date";
import type { MyDayAssignee, MyDayItem, MyDayResponse, MyDayScope, MyDayUrgency, ReminderModule } from "@wodana/contracts";
import {
  Badge, Button, DateField, EmptyState, ErrorState, FormDialog, GroupedTable, IconMenuButton, InlineNotice, NoAccessState, NoResultsState, OwnerCell, PageShell,
  RecordName, SegmentedControl, SelectField, Skeleton, TextAreaField, formatNumber, isNoAccessError, useDesignSystem, useWorkingCalendar,
  type ActionItem, type GroupedTableColumn, type GroupedTableSection,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { useLiveInvalidate } from "@/lib/workspace/live-events";
import { remindersApi, type RemindersApi } from "@/lib/reminders/client";
import { MAX_SNOOZE_DAYS, REMINDER_MODULES, myDayHref } from "@/lib/reminders/contract";
import { REMINDER_KIND_LABELS, REMINDER_MODULE_LABELS } from "@/lib/reminders/labels";
import { MY_DAY_CHIPS, MY_DAY_URGENCY_LABELS, dueLabel, latestSnooze, snoozePresets, withoutItems } from "@/lib/reminders/my-day";
import styles from "./my-day.module.css";

export type MyDayFilter = { scope: MyDayScope; urgency?: MyDayUrgency; module?: ReminderModule };

/** The modules whose changes can add, move or close an item: any of them re-reads the list. */
export const MY_DAY_LIVE_SCOPES = ["reminders", "projects", "sales", "planning", "finance", "purchasing", "approvals", "factory", "ledger", "leads", "cases"] as const;
/** How long a snooze, done or reassign waits for Undo before it is sent. */
export const UNDO_MS = 10_000;
const POLL_MS = 60_000;

type Pending = { id: string; item: MyDayItem; message: string; failure: string; run: (keepalive?: boolean) => Promise<unknown>; timer: number };

const instant = (value: DateValue, timeZone: string) => ("timeZone" in value ? (value as ZonedDateTime).toDate() : value.toDate(timeZone));

/**
 * My day (plan §6.24a): everything due on the person (or their team) across the modules, grouped by job. A row
 * opens its record; Snooze, Mark done and Reassign wait ten seconds for Undo before they are sent.
 */
export function MyDayPage({ workspaceId, canTeam, initialFilter }: { workspaceId: string; canTeam: boolean; initialFilter: MyDayFilter }) {
  const t = useT();
  const router = useRouter();
  const { locale } = useDesignSystem();
  const api = useMemo(() => remindersApi(workspaceId), [workspaceId]);
  const [teamAllowed, setTeamAllowed] = useState(canTeam);
  const [filter, setFilter] = useState<MyDayFilter>(() => ({ ...initialFilter, scope: canTeam ? initialFilter.scope : "me" }));
  // A real navigation to My day (the Home tab, a link with filters) brings its own toolbar state.
  const initialKey = JSON.stringify(initialFilter);
  const [navigated, setNavigated] = useState(initialKey);
  const [data, setData] = useState<MyDayResponse | null>(null);
  if (navigated !== initialKey) {
    setNavigated(initialKey);
    setFilter({ ...initialFilter, scope: teamAllowed ? initialFilter.scope : "me" });
    setData(null);
  }
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const queue = useRef<Pending[]>([]);
  const [notice, setNotice] = useState("");
  const [snoozing, setSnoozing] = useState<MyDayItem | null>(null);
  const [reassigning, setReassigning] = useState<MyDayItem | null>(null);
  const [waking, setWaking] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const next = await api.myDay({ scope: filter.scope, urgency: filter.urgency, module: filter.module });
      if (request !== latest.current) return;
      setData(next); setError(null);
    } catch (cause) {
      if (request !== latest.current) return;
      // Team needs reminders.team: without it the switch goes and the person's own list shows.
      if (filter.scope === "team" && isNoAccessError(cause)) {
        setTeamAllowed(false); setFilter((current) => ({ ...current, scope: "me" }));
        window.history.replaceState(null, "", myDayHref({ ...filter, scope: "me" }));
        return;
      }
      setError(cause);
    }
  }, [api, filter]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // A command sent after its undo window re-reads the list as the toolbar is then, not as it was.
  const reload = useRef(load);
  useEffect(() => { reload.current = load; }, [load]);
  // Someone else's change re-reads the list in place; the minute poll catches what has no live event (time passing).
  useLiveInvalidate(workspaceId, MY_DAY_LIVE_SCOPES, () => void load(), 1_000);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // The toolbar's state goes into the address without a server round trip (Next keeps its router in step).
  const change = (next: MyDayFilter) => {
    setFilter(next); setData(null); setError(null);
    window.history.replaceState(null, "", myDayHref(next));
  };

  const settle = useCallback((entry: Pending) => {
    queue.current = queue.current.filter((item) => item.id !== entry.id);
    setPending(queue.current);
  }, []);
  const commit = useCallback(async (entry: Pending) => {
    try { await entry.run(); }
    catch (cause) { setNotice(cause instanceof Error && cause.message ? translateKnown(t, cause.message) : entry.failure); }
    finally { settle(entry); void reload.current(); }
  }, [settle, t]);
  /** Hides the row now and sends the command after the undo window. */
  const defer = (item: MyDayItem, message: string, failure: string, run: Pending["run"]) => {
    const entry: Pending = { id: `${item.id}:${Date.now()}`, item, message, failure, run, timer: 0 };
    entry.timer = window.setTimeout(() => void commit(entry), UNDO_MS);
    queue.current = [...queue.current, entry];
    setPending(queue.current); setNotice("");
  };
  const undo = (entry: Pending) => { window.clearTimeout(entry.timer); settle(entry); };
  // Leaving the page sends what is still waiting: the person didn't undo it.
  useEffect(() => {
    const flush = () => {
      for (const entry of queue.current) { window.clearTimeout(entry.timer); void entry.run(true).catch(() => undefined); }
      queue.current = [];
    };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, []);

  const wake = async (item: MyDayItem) => {
    setWaking(item.id); setNotice("");
    try { await api.unsnooze(item.id, item.version); await load(); }
    catch (cause) { setNotice(cause instanceof Error && cause.message ? translateKnown(t, cause.message) : t("The item couldn't be woken up.")); }
    finally { setWaking(null); }
  };

  const view = useMemo(() => (data ? withoutItems(data, new Set(pending.map((entry) => entry.item.id))) : null), [data, pending]);
  const team = filter.scope === "team";
  const label = (item: MyDayItem) => item.title || t(REMINDER_KIND_LABELS[item.kind]);
  const completeLabel = (item: MyDayItem) => (item.completeLabel ? translateKnown(t, item.completeLabel) : t("Mark done"));
  const when = (value: string) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: view?.timeZone }).format(new Date(value));

  const actionsFor = (item: MyDayItem): ActionItem[] => [
    ...(item.snoozed ? [{ id: "unsnooze", label: t("Wake up"), isDisabled: waking === item.id }] : item.actions.includes("snooze") ? [{ id: "snooze", label: t("Snooze…") }] : []),
    ...(item.actions.includes("complete") ? [{ id: "complete", label: completeLabel(item) }] : []),
    ...(item.actions.includes("reassign") ? [{ id: "reassign", label: t("Reassign…") }] : []),
  ];
  const act = (item: MyDayItem, action: string) => {
    if (action === "snooze") setSnoozing(item);
    else if (action === "reassign") setReassigning(item);
    else if (action === "unsnooze") void wake(item);
    else if (action === "complete") defer(item, t("{name}: {action}", { name: label(item), action: completeLabel(item) }), t("It couldn't be marked done."),
      (keepalive) => api.complete(item.id, item.version, keepalive));
  };

  const columns: GroupedTableColumn<MyDayItem>[] = [
    { id: "what", label: t("What"), width: team ? "34%" : "42%", render: (item) => <RecordName title={label(item)}
      detail={[t(REMINDER_KIND_LABELS[item.kind]), item.context].filter((part) => part && part !== label(item)).join(" · ")} /> },
    { id: "due", label: t("Due"), width: "18%", render: (item) => view ? <time className={styles.due} data-urgency={item.urgency} dateTime={item.snoozed?.until ?? item.dueAt ?? undefined}>
      {dueLabel(item, { today: view.today, timeZone: view.timeZone, locale, t })}</time> : null },
    { id: "reminders", label: t("Reminders"), width: "20%", mobileHidden: true, render: (item) => <span className={styles.flags}>
      {item.critical ? <Badge tone="danger">{t("Critical")}</Badge> : null}
      {item.reminders.sent || item.reminders.escalationLevel ? <Badge tone={item.reminders.escalationLevel ? "warning" : "neutral"}>
        {[item.reminders.sent ? t("Reminded {count}×", { count: item.reminders.sent }) : "", item.reminders.escalationLevel ? t("escalated") : ""].filter(Boolean).join(" · ")}</Badge> : null}
    </span> },
    ...(team ? [{ id: "owner", label: t("Owner"), width: "14%", mobileHidden: true, render: (item: MyDayItem) => <OwnerCell person={item.owner?.name ?? null} fallback={t("Unassigned")} /> }] : []),
    { id: "actions", label: t("Actions"), align: "end", width: team ? "14%" : "20%", render: (item) => {
      const items = actionsFor(item);
      return <span className={styles.actions}>
        <Link className="wd-button" data-size="compact" data-variant="secondary" href={item.href} aria-label={t("Open {name}", { name: label(item) })}>{t("Open")}</Link>
        {items.length ? <IconMenuButton ariaLabel={t("More for {name}", { name: label(item) })} items={items} onAction={(action) => act(item, action)} /> : null}
      </span>;
    } },
  ];

  const sections = useMemo<GroupedTableSection<MyDayItem>[]>(() => {
    if (!view) return [];
    const other = view.groups.filter((group) => !group.jobId).flatMap((group) => group.items);
    return [
      ...view.groups.filter((group) => group.jobId).map((group) => ({ id: group.jobId!, rows: group.items, emptyMessage: "",
        label: group.jobReference && !group.title.includes(group.jobReference) ? `${group.title} · ${group.jobReference}` : group.title })),
      ...(other.length ? [{ id: "other", label: t("Other"), rows: other, emptyMessage: "" }] : []),
    ];
  }, [view, t]);

  const counts = view?.counts;
  const filtered = Boolean(filter.urgency || filter.module);
  const toolbar = <div className={styles.toolbar}>
    {teamAllowed ? <SegmentedControl label={t("Whose items")} value={filter.scope} onChange={(value) => change({ ...filter, scope: value === "team" ? "team" : "me" })}
      options={[{ id: "me", label: t("Me") }, { id: "team", label: t("Team") }]} /> : null}
    <div className={styles.chips} role="group" aria-label={t("When")}>
      {MY_DAY_CHIPS.map((urgency) => <button key={urgency} type="button" className="wd-chip" aria-pressed={filter.urgency === urgency}
        onClick={() => change({ ...filter, urgency: filter.urgency === urgency ? undefined : urgency })}>
        {t(MY_DAY_URGENCY_LABELS[urgency])}
        {counts ? <span className="wd-count-chip">{formatNumber(counts[urgency], { locale })}</span> : null}
      </button>)}
    </div>
    <div className={styles.module}>
      <SelectField aria-label={t("Module")} label={null} accent="neutral" selectedKey={filter.module ?? "all"}
        items={[{ id: "all", label: t("All modules") }, ...REMINDER_MODULES.map((module) => ({ id: module, label: t(REMINDER_MODULE_LABELS[module]) }))]}
        onSelectionChange={(key) => change({ ...filter, module: key && key !== "all" ? key as ReminderModule : undefined })} />
    </div>
  </div>;

  const body = error && !view ? (isNoAccessError(error) ? <NoAccessState area={t("My day")} />
      : <ErrorState title={t("My day didn't load")} description={error instanceof Error && error.message ? translateKnown(t, error.message) : undefined} onRetry={() => { setError(null); void load(); }} />)
    : !view ? <Skeleton lines={6} shape="rows" />
    : !sections.length ? (filtered ? <NoResultsState onClear={() => change({ scope: filter.scope })} />
      : <EmptyState illustration={null} title={t("Nothing due today")} action={<Link className="wd-button" data-size="compact" data-variant="secondary" href="/workspace">{t("Open Home")}</Link>} />)
    : <GroupedTable<MyDayItem> ariaLabel={t("My day")} columns={columns} sections={sections} selectable={false} getRowId={(item) => item.id}
        getRowLabel={label} onRowAction={(item) => router.push(item.href)} />;

  return <PageShell title={t("My day")} toolbar={toolbar}>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    {body}
    {pending.length ? <div className={styles.undoRegion} aria-live="polite">{pending.map((entry) => <div key={entry.id} className={styles.undo} role="status">
      <span>{entry.message}</span>
      <Button size="compact" variant="quiet" onPress={() => undo(entry)}>{t("Undo")}</Button>
    </div>)}</div> : null}
    {snoozing && view ? <SnoozeDialog item={snoozing} timeZone={view.timeZone} onClose={() => setSnoozing(null)} onSnooze={(until, reason) => {
      const item = snoozing;
      setSnoozing(null);
      defer(item, t("{name} snoozed until {date}", { name: label(item), date: when(until.toISOString()) }), t("The snooze couldn't be saved."),
        (keepalive) => api.snooze(item.id, { until: until.toISOString(), reason, version: item.version }, keepalive));
    }} /> : null}
    {reassigning ? <ReassignDialog api={api} item={reassigning} onClose={() => setReassigning(null)} onReassign={(person) => {
      const item = reassigning;
      setReassigning(null);
      defer(item, t("{name} handed to {person}", { name: label(item), person: person.name }), t("The item couldn't be reassigned."),
        (keepalive) => api.reassign(item.id, { membershipId: person.membershipId, version: item.version }, keepalive));
    }} /> : null}
  </PageShell>;
}

/** When the item comes back (quick times or a date and time) and why: a snooze always says why. */
function SnoozeDialog({ item, timeZone, onClose, onSnooze }: { item: MyDayItem; timeZone: string; onClose: () => void; onSnooze: (until: Date, reason: string) => void }) {
  const t = useT();
  const { workingHours } = useDesignSystem();
  const calendar = useWorkingCalendar();
  const [now] = useState(() => new Date());
  const latest = useMemo(() => latestSnooze({ critical: item.critical, timeZone, nextWorkingDay: calendar.nextWorkingDay(toCalendarDate(fromDate(now, timeZone))), now }), [calendar, item.critical, now, timeZone]);
  const presets = useMemo(() => snoozePresets({ timeZone, morning: workingHours?.start ?? "09:00", latest, now }), [latest, now, timeZone, workingHours]);
  const [value, setValue] = useState<DateValue | null>(() => (presets[0] ? fromDate(presets[0].until, timeZone) : null));
  const [reason, setReason] = useState("");
  const chosen = value ? instant(value, timeZone).getTime() : null;
  return <FormDialog title={t("Snooze")} submitLabel={t("Snooze")} onClose={onClose} isDirty={Boolean(reason.trim())} validation="caller" onSubmit={() => {
    if (!value) throw new Error(t("Choose when it comes back."));
    const until = instant(value, timeZone);
    if (until.getTime() <= Date.now()) throw new Error(t("Choose a time in the future."));
    if (until.getTime() > latest.getTime()) throw new Error(item.critical ? t("A critical item can be snoozed only to the next working day.") : t("Snooze for {count} days at most.", { count: MAX_SNOOZE_DAYS }));
    if (!reason.trim()) throw new Error(t("Say why you're snoozing it."));
    onSnooze(until, reason.trim());
  }}>
    {presets.length ? <div className={styles.presets} role="group" aria-label={t("Quick times")}>{presets.map((preset) =>
      <button key={preset.id} type="button" className="wd-chip" aria-pressed={chosen === preset.until.getTime()} onClick={() => setValue(fromDate(preset.until, timeZone))}>{t(preset.label)}</button>)}</div> : null}
    <DateField label={t("Until")} granularity="minute" quickPicks={false} isRequired value={value} onChange={setValue}
      minValue={fromDate(now, timeZone)} maxValue={fromDate(latest, timeZone)} />
    <TextAreaField label={t("Reason")} isRequired maxLength={300} value={reason} onChange={setReason} />
  </FormDialog>;
}

/** Who else can take the item (the module's own rules decide who is offered). */
function ReassignDialog({ api, item, onClose, onReassign }: { api: RemindersApi; item: MyDayItem; onClose: () => void; onReassign: (person: MyDayAssignee) => void }) {
  const t = useT();
  const [people, setPeople] = useState<MyDayAssignee[] | null>(null);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.assignees(item.id)
      .then((list) => { if (live) setPeople(list.filter((person) => person.membershipId !== item.owner?.membershipId)); })
      .catch((cause: unknown) => { if (live) setError(cause instanceof Error && cause.message ? cause.message : t("The people could not be loaded.")); });
    return () => { live = false; };
  }, [api, item.id, item.owner?.membershipId, t]);
  return <FormDialog title={t("Reassign")} submitLabel={t("Reassign")} onClose={onClose} error={error || undefined} isSubmitDisabled={!chosen} hideSubmit={people !== null && !people.length} onSubmit={() => {
    const person = people?.find((candidate) => candidate.membershipId === chosen);
    if (!person) throw new Error(t("Choose a person."));
    onReassign(person);
  }}>
    {!people && !error ? <Skeleton lines={2} /> : null}
    {people ? people.length ? <SelectField label={t("Give to")} isRequired selectedKey={chosen} placeholder={t("Choose a person")}
      items={people.map((person) => ({ id: person.membershipId, label: person.name }))} onSelectionChange={(key) => setChosen(key ? String(key) : null)} />
      : <EmptyState illustration={null} title={t("No one else can take this")} /> : null}
  </FormDialog>;
}
