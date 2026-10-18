import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Briefcase, CalendarClock, Camera, CheckCircle2, Circle, CircleDot, MinusCircle, Search, UserRound, type LucideIcon } from 'lucide-react-native';
import { errorMessage } from '../../core/api';
import { useFormat, type Format } from '../../core/format';
import { useT, type T } from '../../core/i18n';
import { useTheme } from '../../ui/theme';
import { useSession } from '../../core/session';
import { FilterChips, SearchField } from '../../ui/fields';
import { Card, Empty, Failure, ListRow, ListScreen, Loading, Progress, Screen, Section } from '../../ui/layout';
import { Button, Chip, IconButton, Row, Stack, Text } from '../../ui/primitives';
import { useJobs, useJourney } from './api';
import {
  captureTarget, CHAPTER_HUE, CHAPTER_LABEL, chapterBands, chapterCounts, CHAPTERS, dayIn, filterJobs, jobDetail, LANE_LABEL, progressShare, STATE_LABEL, stepRoute, urgencyOf,
  type JobRow, type JourneyChapter, type JourneyStep, type JourneyStepState, type JourneyView, type MyStep,
} from './model';

const STATE_ICON: Record<JourneyStepState, { icon: LucideIcon; tone: 'success' | 'action' | 'info' | 'neutral' }> = {
  done: { icon: CheckCircle2, tone: 'success' }, now: { icon: CircleDot, tone: 'action' }, next: { icon: Circle, tone: 'info' },
  upcoming: { icon: Circle, tone: 'neutral' }, skipped: { icon: MinusCircle, tone: 'neutral' },
};

/** A due date on the person's calendar: a date as it is, an instant by its day in the workspace's zone. */
export const dueText = (value: string, format: Format) => format.day(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dayIn(new Date(value), format.timeZone));

/** The chapter as a calm-hued chip (the web's colours). */
export function ChapterChip({ chapter }: { chapter: JourneyChapter }) {
  const t = useT();
  return <Chip hue={CHAPTER_HUE[chapter]} label={t(CHAPTER_LABEL[chapter])} />;
}

/** A job's progress bar in its chapter's hue, with "3 of 40" spoken and shown. */
function JobProgress({ progress, chapter }: { progress: { done: number; total: number }; chapter: JourneyChapter | null }) {
  const t = useT();
  const label = t('{done} of {total}', { done: progress.done, total: progress.total });
  return <Row gap={2}>
    <View style={{ flex: 1 }}><Progress value={progressShare(progress)} hue={chapter ? CHAPTER_HUE[chapter] : undefined} label={label} /></View>
    <Text variant="caption" tone="tertiary">{label}</Text>
  </Row>;
}

/** One job in the list: what it is, then its chapter, step now and whether it is late, then how far along it is. */
function JobListRow({ row, first, onPress }: { row: JobRow; first: boolean; onPress: () => void }) {
  const t = useT();
  const theme = useTheme();
  const format = useFormat();
  const late = row.now ? urgencyOf(row.now.dueAt, new Date(), format.timeZone) === 'late' : false;
  return <ListRow first={first} title={row.title ?? row.reference} detail={jobDetail(row)} onPress={onPress}
    meta={<Stack gap={2} style={{ paddingTop: theme.space(1) }}>
      {row.now && row.chapter ? <Row gap={2} wrap>
        <ChapterChip chapter={row.chapter} />
        <Text variant="caption" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>{t(row.now.label)}</Text>
        {late ? <Chip tone="danger" label={t('Late')} /> : null}
      </Row> : <Chip tone="success" label={t('Every step is done')} />}
      <JobProgress progress={row.progress} chapter={row.chapter} />
    </Stack>} />;
}

/** Jobs: every job I see from enquiry to warranty, newest first; a chapter filter with counts and a search. */
export function JobsScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const jobs = useJobs();
  const [chapter, setChapter] = useState<'all' | JourneyChapter>('all');
  const [search, setSearch] = useState('');
  const [pulling, setPulling] = useState(false);
  const rows = useMemo(() => jobs.data?.pages.flatMap((page) => page.items) ?? [], [jobs.data]);
  const total = jobs.data?.pages[0]?.total ?? 0;
  const counts = chapterCounts(rows);
  const shown = filterJobs(rows, chapter, search);
  const chips = [{ value: 'all' as const, label: `${t('All')} · ${format.number(total, 0)}` },
    ...CHAPTERS.filter((key) => counts.get(key) || key === chapter).map((key) => ({ value: key, label: `${t(CHAPTER_LABEL[key])} · ${format.number(counts.get(key) ?? 0, 0)}` }))];
  return <ListScreen title={t('Jobs')} back items={shown} keyExtractor={(row) => row.id}
    toolbar={rows.length ? <Stack gap={3}>
      <SearchField value={search} onChange={setSearch} placeholder={t('Search')} />
      {chips.length > 1 ? <FilterChips value={chapter} onChange={setChapter} options={chips} /> : null}
    </Stack> : undefined}
    loading={jobs.isLoading} error={jobs.error && !rows.length ? errorMessage(jobs.error, t('Could not load')) : null} onRetry={() => void jobs.refetch()}
    onRefresh={() => { setPulling(true); void jobs.refetch().finally(() => setPulling(false)); }} refreshing={pulling}
    onEndReached={() => { if (jobs.hasNextPage && !jobs.isFetchingNextPage) void jobs.fetchNextPage(); }} loadingMore={jobs.isFetchingNextPage}
    empty={rows.length ? <Empty icon={Search} title={t('No matches')} /> : <Empty icon={Briefcase} title={t('Nothing here yet')} detail={t('A job starts with its enquiry.')} />}
    renderItem={(row, _, first) => <JobListRow row={row} first={first} onPress={() => router.push(`/jobs/${row.id}`)} />} />;
}

/** Where a photo from this job goes: the project's site photos once it is being made or installed, else the case's survey. */
export function capturePlace(view: Pick<JourneyView, 'steps' | 'now'>, can: { survey: boolean; projects: boolean }) {
  const target = captureTarget([view.now?.href ?? null, ...view.steps.map((step) => step.href)]);
  const building = !!view.now && ['make', 'install', 'care'].includes(view.now.chapter);
  if (target.projectId && can.projects && (building || !target.caseId || !can.survey)) return { projectId: target.projectId };
  if (target.caseId && can.survey) return { caseId: target.caseId };
  return null;
}

/** The step now: what it is, when it is done, who has it, when it is due, and the one action that opens it on the phone. */
function NowCard({ view }: { view: JourneyView & { now: NonNullable<JourneyView['now']> } }) {
  const t = useT();
  const format = useFormat();
  const router = useRouter();
  const now = view.now;
  const route = stepRoute(now.href);
  const late = urgencyOf(now.dueAt, new Date(), format.timeZone) === 'late';
  return <Card tone="action">
    <Row gap={2} wrap>
      <Chip tone="action" label={t(STATE_LABEL.now)} />
      <ChapterChip chapter={now.chapter} />
      {late ? <Chip tone="danger" label={t('Late')} /> : null}
    </Row>
    <Text variant="subheading">{t(now.label)}</Text>
    <Text variant="caption" tone="secondary">{t('Done when: {condition}', { condition: t(now.doneWhen) })}</Text>
    <Row gap={2} wrap>
      <Chip icon={UserRound} label={now.owner ?? t(LANE_LABEL[now.lane])} />
      {now.dueAt ? <Chip icon={CalendarClock} label={t('Due {date}', { date: dueText(now.dueAt, format) })} /> : null}
    </Row>
    {route ? <Button label={t('Open {step}', { step: t(now.label) })} variant="primary" full onPress={() => router.push(route as Href)} /> : null}
  </Card>;
}

function stepDetail(step: JourneyStep, t: T, format: Format) {
  if (step.state === 'done') return [step.doneAt ? dueText(step.doneAt, format) : null, step.doneBy, step.note].filter(Boolean).join(' · ');
  if (step.note) return t(step.note);
  return step.dueAt ? t('Due {date}', { date: dueText(step.dueAt, format) }) : '';
}

/** A job: its step now at the top, then every step by chapter. Steps the phone can work open their screen. */
export function JobScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const session = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const journey = useJourney(id);
  const view = journey.data;
  if (journey.isLoading) return <Screen back><Loading shape="record" count={5} /></Screen>;
  if (!view) return <Screen back><Failure message={errorMessage(journey.error, t('Could not load'))} onRetry={() => void journey.refetch()} /></Screen>;
  const place = capturePlace(view, {
    survey: session.has('pre-project') && session.can('pre_projects.edit'),
    projects: session.has('projects') && session.can('projects.view', 'projects.manage'),
  });
  const done = view.chapters.reduce((sum, chapter) => sum + chapter.done, 0);
  const total = view.chapters.reduce((sum, chapter) => sum + chapter.total, 0);
  return <Screen back title={view.title ?? view.reference} subtitle={jobDetail(view)}
    action={place ? <IconButton icon={Camera} label={t('Take photo')} onPress={() => router.push({ pathname: '/capture/photo', params: place })} /> : undefined}
    onRefresh={() => void journey.refetch()} refreshing={journey.isRefetching}>
    {view.now ? <NowCard view={{ ...view, now: view.now }} /> : <Chip tone="success" label={t('Every step is done')} />}
    <JobProgress progress={{ done, total }} chapter={view.now?.chapter ?? null} />
    {chapterBands(view).map((band) => <Section key={band.key} title={`${t(CHAPTER_LABEL[band.key])} · ${t('{done} of {total}', { done: band.done, total: band.total })}`}>
      {band.steps.map((step, index) => {
        const look = STATE_ICON[step.state];
        const route = step.state === 'skipped' ? null : stepRoute(step.href);
        return <ListRow key={step.key} first={index === 0} icon={look.icon} iconTone={look.tone} title={t(step.label)} detail={stepDetail(step, t, format)}
          trailing={step.state === 'now' || step.state === 'next' ? <Chip tone={step.state === 'now' ? 'action' : 'info'} label={t(STATE_LABEL[step.state])} /> : undefined}
          onPress={route ? () => router.push(route as Href) : undefined} />;
      })}
    </Section>)}
  </Screen>;
}

/** One step of mine (My day): the step, its job, its chapter and when it is due; a press opens the job. */
export function MyStepRow({ item, first, onPress, onLongPress }: { item: MyStep; first: boolean; onPress: () => void; onLongPress?: () => void }) {
  const t = useT();
  const theme = useTheme();
  const format = useFormat();
  return <ListRow first={first} icon={STATE_ICON.now.icon} iconTone={item.urgency === 'late' ? 'danger' : item.urgency === 'today' ? 'action' : 'neutral'}
    title={t(item.step.label)} detail={[item.title ?? item.reference, item.client].filter(Boolean).join(' · ')}
    meta={<Row gap={2} wrap style={{ paddingTop: theme.space(1) }}>
      <ChapterChip chapter={item.chapter} />
      {item.urgency === 'late' ? <Chip tone="danger" label={t('Late')} /> : item.urgency === 'today' ? <Chip tone="action" label={t('Due today')} /> : null}
      {item.step.dueAt && item.urgency !== 'today' ? <Text variant="caption" tone={item.urgency === 'late' ? 'danger' : 'tertiary'}>{t('Due {date}', { date: dueText(item.step.dueAt, format) })}</Text> : null}
    </Row>}
    onPress={onPress} onLongPress={onLongPress} />;
}
