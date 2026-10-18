import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import {
  AlarmClock, BellRing, BookOpen, Briefcase, Camera, Check, CheckCircle2, ClipboardCheck, ClipboardList, ExternalLink, Factory, FileText, Palette, PhoneCall, Truck, Wallet, type LucideIcon,
} from 'lucide-react-native';
import type { MyDayItem, ReminderModule } from '../../../../../packages/contracts/src/reminders';
import { errorMessage } from '../../core/api';
import { appRouteFor } from '../../core/deep-links';
import { makeFormat, useFormat, type Format } from '../../core/format';
import { useT } from '../../core/i18n';
import { ActionSheet, type SheetAction } from '../../ui/dialogs';
import { FilterChips, TextField } from '../../ui/fields';
import { Banner, Empty, ListRow, ListScreen, Section } from '../../ui/layout';
import { Button, Chip, Row, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { SwipeRow, type SwipeAction } from '../../ui/swipe-row';
import { useTheme } from '../../ui/theme';
import { useToast } from '../../ui/toast';
import { useSession } from '../../core/session';
import { useBootstrap as useWorkCalendars } from '../hrms/api';
import { missing, useMySteps } from '../jobs/api';
import { captureTarget, orderMySteps, stepRoute, stepsFor, type MyStep } from '../jobs/model';
import { MyStepRow } from '../jobs/screens';
import { useMyDay, useMyDayCommand, useRefetchOnFocus } from './api';
import {
  FILTERS, groupedEntries, groupHeading, isFilter, myDayDueLabel, remindedLabel, rowActions, rowDetail, snoozePresets, snoozeProblem, URGENCY_LABEL,
  type MyDayEntry, type MyDayFilter, type SnoozePresetId,
} from './my-day-model';

const MODULE_ICON: Record<ReminderModule, LucideIcon> = {
  sales: PhoneCall, quotations: FileText, design: Palette, projects: ClipboardList, purchasing: Truck, factory: Factory, finance: Wallet, ledger: BookOpen, approvals: ClipboardCheck,
};
const TONE = { overdue: 'danger', today: 'action', waiting: 'warning', upcoming: 'info', snoozed: 'neutral' } as const;

/** Dates and times on the person's own calendar (My day sends their time zone), in the workspace's locale. */
export function useZonedFormat(timeZone: string | null | undefined): Format {
  const format = useFormat();
  return useMemo(() => (!timeZone || timeZone === format.timeZone ? format : makeFormat({ locale: format.locale, timeZone, currency: format.currency })), [format, timeZone]);
}

/**
 * One My day row: what it is, its context (and job when there is no job heading above), then when it is due, the
 * critical marker and how often it was chased ("Reminded 2× · escalated").
 */
export function MyDayRow({ entry, first, today, format, withJob, onPress, onLongPress }: {
  entry: MyDayEntry; first: boolean; today: string; format: Format; withJob?: boolean; onPress: () => void; onLongPress?: () => void;
}) {
  const t = useT();
  const { item, group } = entry;
  const due = myDayDueLabel(item, today, format.timeZone, { time: (value) => format.time(value), date: (value) => format.day(value), when: (value) => format.when(value) });
  const reminded = remindedLabel(item);
  const job = withJob && group.jobId ? groupHeading(group, '') : '';
  return <ListRow first={first} icon={MODULE_ICON[item.module] ?? ClipboardCheck} iconTone={TONE[item.urgency]} title={item.title}
    detail={rowDetail(item, job)}
    meta={due || item.critical || reminded ? <Row gap={2} wrap>
      {item.critical ? <Chip label={t('Critical')} tone="danger" /> : null}
      {due ? <Text variant="caption" tone={item.urgency === 'overdue' ? 'danger' : 'tertiary'}>{t(due.key, due.values)}</Text> : null}
      {reminded ? <Text variant="caption" tone={item.reminders.escalationLevel > 0 ? 'warning' : 'tertiary'}>{t(reminded.key, reminded.values)}</Text> : null}
    </Row> : undefined}
    onPress={onPress} onLongPress={onLongPress} />;
}

/**
 * My day: everything due for me, one job after another. Swipe towards the end to mark it done (when its module
 * allows), towards the start to snooze it (a reason is required) or wake a snoozed one; a long press offers the
 * same. Tapping opens the record, as a push does. It refreshes on focus, on push and every minute.
 */
export function MyDayScreen() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const format = useFormat();
  const params = useLocalSearchParams<{ urgency?: string }>();
  const [filter, setFilter] = useState<MyDayFilter>(isFilter(params.urgency) ? params.urgency : 'all');
  const list = useMyDay(filter === 'all' ? null : filter);
  useRefetchOnFocus(list.refetch);
  const command = useMyDayCommand();
  const [pulling, setPulling] = useState(false);
  // Each sheet keeps its item while it slides away.
  const [menu, setMenu] = useState<{ item: MyDayItem; open: boolean } | null>(null);
  const [snoozing, setSnoozing] = useState<{ item: MyDayItem; open: boolean } | null>(null);
  const snoozeItem = (item: MyDayItem) => setSnoozing({ item, open: true });
  const data = list.data;
  const zoned = useZonedFormat(data?.timeZone);
  const today = data?.today ?? zoned.today();
  const entries = useMemo(() => groupedEntries(data, filter), [data, filter]);
  // The job steps that are mine now (`GET jobs/my-day`): late first, then due today, then the rest, under the same chips.
  const mySteps = useMySteps();
  useRefetchOnFocus(mySteps.refetch);
  const session = useSession();
  const allSteps = useMemo(() => (mySteps.data ? orderMySteps(mySteps.data.items, new Date(), mySteps.data.timeZone) : []), [mySteps.data]);
  const steps = stepsFor(allSteps, filter);
  const [stepMenu, setStepMenu] = useState<{ item: MyStep; open: boolean } | null>(null);
  const stepActions = (item: MyStep): SheetAction[] => {
    const route = stepRoute(item.step.href);
    const target = captureTarget([item.step.href]);
    const photo = target.caseId && session.has('pre-project') && session.can('pre_projects.edit') ? { caseId: target.caseId }
      : target.projectId && session.has('projects') && session.can('projects.view', 'projects.manage') ? { projectId: target.projectId } : null;
    return [
      { label: t('Open'), icon: Briefcase, onPress: () => router.push(`/jobs/${item.jobId}`) },
      ...(route ? [{ label: t('Open {step}', { step: t(item.step.label) }), icon: ExternalLink, onPress: () => router.push(route as Href) }] : []),
      ...(photo ? [{ label: t('Take photo'), icon: Camera, onPress: () => router.push({ pathname: '/capture/photo', params: photo }) }] : []),
    ];
  };

  const open = (item: MyDayItem) => {
    const route = appRouteFor(item.href);
    if (route) router.push(route as Href);
    else toast.show(t('Open this on the web to see it.'));
  };
  const run = async (action: () => Promise<unknown>) => {
    try { await action(); } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  const complete = (item: MyDayItem) => run(async () => { await command.mutateAsync({ kind: 'complete', item }); toast.success(t('Done')); });
  const wake = (item: MyDayItem) => run(() => command.mutateAsync({ kind: 'unsnooze', item }));
  const snooze = async (item: MyDayItem, until: string, reason: string) => {
    const result = await command.mutateAsync({ kind: 'snooze', item, until, reason });
    const now = result.item;
    toast.show(t('Snoozed'), 'success', now ? { label: t('Undo'), onPress: () => void wake(now) } : undefined);
  };
  const doneLabel = (item: MyDayItem) => (item.completeLabel ? t(item.completeLabel) : t('Mark done'));
  const swipes = (item: MyDayItem): { start: SwipeAction | null; end: SwipeAction | null } => {
    const can = rowActions(item);
    return {
      start: can.complete ? { label: doneLabel(item), icon: Check, tone: 'success', onPress: () => void complete(item) } : null,
      end: can.snooze ? { label: t('Snooze'), icon: AlarmClock, tone: 'warning', onPress: () => snoozeItem(item) }
        : can.wake ? { label: t('Wake now'), icon: BellRing, tone: 'info', onPress: () => void wake(item) } : null,
    };
  };
  const menuActions = (item: MyDayItem): SheetAction[] => {
    const can = rowActions(item);
    return [
      { label: t('Open'), icon: ExternalLink, onPress: () => open(item) },
      ...(can.snooze ? [{ label: t('Snooze'), icon: AlarmClock, onPress: () => snoozeItem(item) }] : []),
      ...(can.wake ? [{ label: t('Wake now'), icon: BellRing, onPress: () => void wake(item) }] : []),
      ...(can.complete ? [{ label: doneLabel(item), icon: Check, onPress: () => void complete(item) }] : []),
    ];
  };
  // A chip shows when it has something (or is chosen); "All" is always there.
  const count = (value: Exclude<MyDayFilter, 'all'>) => (data?.counts[value] ?? 0) + stepsFor(allSteps, value).length;
  const chips = FILTERS.filter((value) => value === 'all' || value === filter || count(value) > 0)
    .map((value) => ({ value, label: value === 'all' ? t('All') : `${t(URGENCY_LABEL[value])} · ${format.number(count(value), 0)}` }));
  const stepsSection = steps.length ? <Section title={t('Steps')}>
    {steps.map((item, index) => <MyStepRow key={item.jobId} item={item} first={index === 0} onPress={() => router.push(`/jobs/${item.jobId}`)}
      onLongPress={() => setStepMenu({ item, open: true })} />)}
  </Section> : null;
  // A server without the job steps yet (an older release) answers 404: only the reminders show.
  const stepsFailed = mySteps.error && !missing(mySteps.error) && !mySteps.data;

  return <>
    <ListScreen title={t('My day')} back items={entries} keyExtractor={(entry) => entry.item.id} groupBy={(entry) => groupHeading(entry.group, t('Other work'))}
      toolbar={chips.length > 1 || stepsSection || stepsFailed ? <>
        {chips.length > 1 ? <FilterChips value={filter} onChange={setFilter} options={chips} /> : null}
        {stepsFailed ? <Banner tone="warning" title={t('Something went wrong')} detail={errorMessage(mySteps.error, t('Try again'))} action={{ label: t('Try again'), onPress: () => void mySteps.refetch() }} /> : null}
        {stepsSection}
      </> : undefined}
      loading={list.isLoading} error={list.error && !data ? errorMessage(list.error, t('Try again')) : null} onRetry={() => void list.refetch()}
      onRefresh={() => { setPulling(true); void Promise.all([list.refetch(), mySteps.refetch()]).finally(() => setPulling(false)); }} refreshing={pulling}
      empty={steps.length ? null : <Empty icon={CheckCircle2} title={filter === 'all' ? t('Nothing due today') : t('Nothing matches')} />}
      renderItem={(entry, _, first) => {
        const { start, end } = swipes(entry.item);
        return <SwipeRow start={start} end={end}>
          <MyDayRow entry={entry} first={first} today={today} format={zoned} onPress={() => open(entry.item)} onLongPress={() => setMenu({ item: entry.item, open: true })} />
        </SwipeRow>;
      }} />
    <ActionSheet open={!!menu?.open} onClose={() => setMenu((value) => value && { ...value, open: false })} title={menu?.item.title} actions={menu ? menuActions(menu.item) : []} />
    <ActionSheet open={!!stepMenu?.open} onClose={() => setStepMenu((value) => value && { ...value, open: false })} title={stepMenu ? t(stepMenu.item.step.label) : undefined}
      actions={stepMenu ? stepActions(stepMenu.item) : []} />
    <SnoozeSheet open={!!snoozing?.open} item={snoozing?.item ?? null} timeZone={zoned.timeZone} format={zoned}
      onClose={() => setSnoozing((value) => value && { ...value, open: false })} onSnooze={snooze} />
  </>;
}

/** Snooze until later today, tomorrow or next week, with the reason the server requires. A refusal shows here. */
function SnoozeSheet({ open, item, timeZone, format, onClose, onSnooze }: {
  open: boolean; item: MyDayItem | null; timeZone: string; format: Format; onClose: () => void; onSnooze: (item: MyDayItem, until: string, reason: string) => Promise<void>;
}) {
  const t = useT();
  const theme = useTheme();
  const [choice, setChoice] = useState<SnoozePresetId | null>(null);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The working day's start and end from the person's work calendar (the HRMS bootstrap, already fetched where the
  // workspace has HRMS); without one the reminder settings' default quiet hours stand.
  const calendars = useWorkCalendars();
  const calendar = calendars.data?.employee?.calendar ?? calendars.data?.calendars[0];
  const hours = calendar ? { morning: calendar.dayStart, evening: calendar.dayEnd } : undefined;
  // The choices are worked out from the moment the sheet opens (`open` is a dependency for that), and stay while it closes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const presets = useMemo(() => (item ? snoozePresets(new Date(), timeZone, item.critical, hours) : []), [open, item, timeZone, hours?.morning, hours?.evening]);
  useEffect(() => {
    if (!open) return;
    setChoice(presets[0]?.id ?? null);
    setReason('');
    setFailure(null);
  }, [open, presets]);
  const until = presets.find((preset) => preset.id === choice)?.until ?? null;
  const problem = snoozeProblem({ until, reason }, new Date());
  const submit = async () => {
    if (!item || !until || problem || busy) return;
    setBusy(true);
    setFailure(null);
    try { await onSnooze(item, until, reason); onClose(); }
    catch (error) { setFailure(errorMessage(error, t('Something went wrong'))); }
    finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title={t('Snooze')} subtitle={item?.title}
    footer={<Button label={t('Snooze')} variant="primary" size="lg" full disabled={!!problem} loading={busy} onPress={() => void submit()} />}>
    {failure ? <Banner tone="danger" title={failure} /> : null}
    <View style={{ gap: theme.space(2) }}>
      <FilterChips value={choice ?? ''} onChange={(value) => setChoice(value as SnoozePresetId)} options={presets.map((preset) => ({ value: preset.id, label: t(preset.label) }))} />
      {until ? <Text variant="caption" tone="secondary">{t('Until {date}', { date: format.when(until) })}</Text> : null}
    </View>
    <TextField label={t('Reason')} value={reason} onChangeText={setReason} multiline maxLength={500} hint={reason.trim() ? undefined : t('Needs a reason')} />
  </Sheet>;
}
