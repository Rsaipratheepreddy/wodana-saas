import { Pressable, ScrollView, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import {
  Banknote, CalendarClock, CheckCircle2, ClipboardCheck, ClipboardList, CloudOff, CloudUpload, Factory, Inbox, LogIn, LogOut, PackageCheck, Truck, Users, type LucideIcon,
} from 'lucide-react-native';
import type { HomeFunnelStage, HomeUpcomingItem } from '../../../../../packages/contracts/src/home';
import { errorMessage, errorStatus } from '../../core/api';
import { appRouteFor } from '../../core/deep-links';
import { useFormat } from '../../core/format';
import { haptic } from '../../core/haptics';
import { key, useT } from '../../core/i18n';
import { useOutbox } from '../../core/outbox';
import { useOnline } from '../../core/query';
import { useSession } from '../../core/session';
import { Banner, Card, Empty, ListRow, Screen, Section, Shimmer } from '../../ui/layout';
import { Button, Row, Text } from '../../ui/primitives';
import { StatusChip } from '../../ui/status';
import { useTheme } from '../../ui/theme';
import { useToast } from '../../ui/toast';
import { useBootstrap, useCrewDays, useCurrentAttendance, useLeaveRequests, usePendingTime, useReviews } from '../hrms/api';
import { minutesSince, MODE_LABEL } from '../hrms/model';
import { useWaitingCount } from '../approvals/api';
import { useInbox } from '../inbox/api';
import { useSitesToday } from '../projects/api';
import { useDeliveries } from '../purchasing/api';
import { WoddyButton } from '../woddy/woddy-screen';
import { useHomeMetrics, useHomeSummary, useMyDay, useRefetchOnFocus } from './api';
import { expectsNumbers, figuresFor, lensFor, reportIsLate, showsPipeline, STAGE_LABEL, type Figure } from './home-model';
import { topItems } from './my-day-model';
import { MyDayRow, useZonedFormat } from './my-day-screen';

const UPCOMING: Record<HomeUpcomingItem['kind'], { label: string; icon: LucideIcon }> = {
  meeting: { label: key('Meeting'), icon: Users }, follow_up: { label: key('Follow-up'), icon: CalendarClock }, work: { label: key('Task'), icon: ClipboardList },
  delivery: { label: key('Delivery'), icon: Truck }, payment: { label: key('Payment due'), icon: Banknote }, production: { label: key('Production'), icon: Factory },
};
const VISIBLE = 6;
/** Approvals have their own row at the top of Today ("N waiting for you"): My day's copies aren't listed twice. */
const COUNTED_ABOVE = ['approval.waiting'] as const;

/**
 * Today: the web's Home for one person on the phone. First what they act on (attendance, what waits for their
 * decision, their sites), then what needs them now from My day, most urgent first, with the full list one tap
 * away; the pipeline and one or two figures for people who run the business or its front; then what's coming.
 * Every section follows what the server sent.
 */
export function TodayScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const online = useOnline();
  const session = useSession();
  const outbox = useOutbox();
  const toast = useToast();
  const hrms = session.has('hrms');
  const bootstrap = useBootstrap();
  const current = useCurrentAttendance(hrms);
  const team = !!bootstrap.data?.permissions.team;
  const teamLeave = useLeaveRequests('team', undefined, hrms && team);
  const teamReviews = useReviews('team', hrms && team);
  const teamTime = usePendingTime(hrms && team);
  const crewDays = useCrewDays(null, hrms && !!bootstrap.data?.permissions.crews);
  const sites = useSitesToday();
  const inbox = useInbox();
  const waiting = useWaitingCount();
  const deliveries = useDeliveries(session.has('projects') && session.can('stock.receive', 'purchasing.manage'));
  const summary = useHomeSummary();
  const myDay = useMyDay();
  useRefetchOnFocus(myDay.refetch);
  const zoned = useZonedFormat(myDay.data?.timeZone);
  const numbersExpected = expectsNumbers(session.can);
  const metrics = useHomeMetrics(numbersExpected);
  const today = format.today();

  const refresh = () => {
    void current.refetch(); void sites.refetch(); void summary.refetch(); void myDay.refetch(); void inbox.refetch(); void deliveries.refetch();
    void teamLeave.refetch(); void teamReviews.refetch(); void waiting.refetch(); if (numbersExpected) void metrics.refetch();
  };
  const open = current.data && !current.data.endedAt ? current.data : null;
  const segment = open?.segments[open.segments.length - 1];
  const approvals = (teamLeave.data ?? []).filter((item) => item.canDecide && ['pending', 'cancellation_pending'].includes(item.status)).length
    + (teamReviews.data ?? []).filter((item) => item.canDecide && item.status === 'pending').length
    + (teamTime.data?.weeks ?? []).filter((week) => week.canDecide).length
    + (crewDays.data?.days ?? []).filter((day) => day.status === 'submitted' && day.canDecide).length;
  const needs = topItems(myDay.data, VISIBLE, COUNTED_ABOVE);
  // A server without My day yet (an older release) answers 404: the section stays away instead of an error.
  const myDayMissing = errorStatus(myDay.error) === 404;
  const funnel = summary.data && showsPipeline(summary.data.funnel) ? summary.data.funnel : [];
  const figures = metrics.data ? figuresFor(metrics.data, lensFor(session.can)) : [];
  const upcoming = (summary.data?.upcoming ?? []).slice(0, 3);
  const expected = (deliveries.data?.expected ?? []).filter((order) => !order.due || order.due <= today).slice(0, 3);
  const blocked = outbox.items.filter((item) => item.status === 'blocked');
  // My sites first: today's report with one tap; once the workspace's daily report is due, a missing report turns amber.
  const mySites = sites.data?.sites ?? [];
  const late = reportIsLate(sites.data?.hour, sites.data?.dueTime);
  const nothing = !needs.length && !approvals && !waiting.count && !expected.length && !(inbox.unread > 0) && !mySites.length && !upcoming.length;
  const failed = summary.error ?? (myDayMissing ? null : myDay.error) ?? (hrms ? current.error : null);
  // Something the phone has no screen for is opened on the web.
  const go = (link: string | null | undefined, fallback?: string) => { const route = appRouteFor(link) ?? fallback; if (route) router.push(route as Href); else toast.show(t('Open this on the web to see it.')); };

  return <Screen large title={t('Today')} subtitle={format.longDay(today)} action={<WoddyButton />} onRefresh={refresh} refreshing={summary.isRefetching || current.isRefetching}>
    {!online ? <Banner tone="neutral" icon={CloudOff} title={t('No connection')} detail={t('Captures are saved on this phone and sent later.')} /> : null}
    {blocked.length ? <Banner tone="warning" title={blocked.length === 1 ? t('1 capture needs you') : t('{count} captures need you', { count: blocked.length })} action={{ label: t('Fix'), onPress: () => router.push('/outbox') }} />
      : outbox.items.length ? <Banner tone="info" icon={CloudUpload} title={t('{count} waiting to send', { count: outbox.items.length })} action={{ label: t('View'), onPress: () => router.push('/outbox') }} /> : null}

    {hrms && bootstrap.data?.employee?.enabled ? <Card tone={open ? 'action' : 'default'}>
      <Row style={{ justifyContent: 'space-between' }} align="center">
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="overline" tone="secondary">{t('Attendance')}</Text>
          {current.isLoading ? <Shimmer width="60%" height={20} /> : <Text variant="subheading">{open
            ? `${format.duration(minutesSince(open.startedAt))} · ${segment?.context.location?.name ?? segment?.context.name ?? (segment ? t(MODE_LABEL[segment.mode]) : '')}`
            : t('Not checked in')}</Text>}
        </View>
        <Button label={open ? t('Check out') : t('Check in')} icon={open ? LogOut : LogIn} variant={open ? 'secondary' : 'primary'} onPress={() => router.push('/hrms/attendance')} />
      </Row>
    </Card> : null}

    {waiting.count || approvals ? <Section>
      {waiting.count ? <ListRow first icon={ClipboardCheck} iconTone="warning" title={t('{count} waiting for you', { count: waiting.count })} onPress={() => router.push('/approvals')} /> : null}
      {approvals ? <ListRow first={!waiting.count} icon={Users} iconTone="warning" title={t('{count} to approve', { count: approvals })} detail={t('Leave, attendance, timesheets and crew days')} onPress={() => router.push('/hrms/team')} /> : null}
    </Section> : null}

    {mySites.length ? <Section title={t('My sites today')}>
      {mySites.map((site, index) => <ListRow key={site.projectId} first={index === 0} icon={ClipboardList} iconTone={!site.report && late ? 'warning' : 'action'} title={site.name}
        detail={[site.reference, site.report ? null : t('No report yet'), site.arriving ? t('{count} arriving', { count: site.arriving }) : null, site.snags === 1 ? t('1 snag to close') : site.snags ? t('{count} snags to close', { count: site.snags }) : null]
          .filter(Boolean).join(' · ')}
        trailing={site.report ? <StatusChip status={site.report.status} /> : <Button size="sm" label={t('Write report')} onPress={() => router.push(`/projects/${site.projectId}/report`)} />}
        onPress={() => router.push(site.report ? `/projects/${site.projectId}/reports` : `/projects/${site.projectId}/report`)} />)}
    </Section> : null}

    {myDay.isLoading ? <Section><View style={{ padding: theme.space(4), gap: theme.space(2) }}><Shimmer width="60%" height={12} /><Shimmer width="40%" height={9} /></View></Section>
      : needs.length ? <Section title={t('My day')} action={<Button size="sm" variant="ghost" label={t('See all')} onPress={() => router.push('/my-day')} />}>
        {needs.map((entry, index) => <MyDayRow key={entry.item.id} entry={entry} first={index === 0} withJob today={myDay.data?.today ?? zoned.today()} format={zoned}
          onPress={() => go(entry.item.href)} />)}
      </Section> : null}

    {funnel.length ? <Pipeline stages={funnel} onOpen={(stage) => go(stage.href)} /> : null}
    {figures.length ? <KeyNumbers figures={figures} onOpen={(figure) => router.push(figure.route as Href)} /> : null}

    {expected.length ? <Section title={t('Deliveries expected')} action={<Button size="sm" variant="ghost" label={t('All')} onPress={() => router.push('/purchasing')} />}>
      {expected.map((order, index) => <ListRow key={order.id} first={index === 0} icon={PackageCheck} title={order.supplierName} detail={`${order.number} · ${order.linesLeft === 1 ? t('1 line') : t('{count} lines', { count: order.linesLeft })}`}
        onPress={() => router.push(`/purchasing/receive/${order.id}`)} />)}
    </Section> : null}

    {upcoming.length ? <Section title={t('Coming up')}>
      {upcoming.map((item, index) => {
        const look = UPCOMING[item.kind];
        return <ListRow key={item.id} first={index === 0} icon={look.icon} title={item.title}
          detail={[item.allDay ? format.weekday(item.at.slice(0, 10)) : format.when(item.at), t(look.label), item.context].filter(Boolean).join(' · ')}
          onPress={appRouteFor(item.href) ? () => go(item.href) : undefined} />;
      })}
    </Section> : null}

    {inbox.enabled && inbox.unread ? <Section>
      <ListRow first icon={Inbox} title={t('{count} unread in your inbox', { count: inbox.unread })} onPress={() => router.push('/inbox')} />
    </Section> : null}

    {/* A failed load never reads as "all caught up". */}
    {failed && online ? <Banner tone="warning" title={t('Something went wrong')} detail={errorMessage(failed, t('Try again'))} action={{ label: t('Try again'), onPress: refresh }} /> : null}
    {!summary.isLoading && !myDay.isLoading && !failed && nothing ? <Empty icon={CheckCircle2} title={t('You’re all caught up')}
      action={session.has('crm') && session.can('crm.leads.manage') ? { label: t('New enquiry'), onPress: () => router.push('/sales/new') } : undefined} /> : null}
  </Screen>;
}

/** The business flow the person can see: a count per stage, and how many have stalled. */
function Pipeline({ stages, onOpen }: { stages: HomeFunnelStage[]; onOpen: (stage: HomeFunnelStage) => void }) {
  const t = useT();
  const theme = useTheme();
  return <Section title={t('Pipeline')} flat>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space(2) }}>
      {stages.map((stage) => <Pressable key={stage.id} accessibilityRole="button"
        accessibilityLabel={[t(STAGE_LABEL[stage.id]), String(stage.count), stage.stuck ? t('{count} stalled', { count: stage.stuck }) : ''].filter(Boolean).join(', ')}
        onPress={() => { haptic.tap(); onOpen(stage); }}
        style={({ pressed }) => ({ minWidth: 104, minHeight: 88, padding: theme.space(3), gap: theme.space(1), borderRadius: theme.radius.lg, borderWidth: 1,
          borderColor: stage.stuck ? theme.colors.warning : theme.colors.structuralDivider, backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface })}>
        <Text variant="caption" tone="secondary" numberOfLines={1}>{t(STAGE_LABEL[stage.id])}</Text>
        <Text variant="number">{stage.count}</Text>
        {stage.stuck ? <Text variant="caption" tone="warning" numberOfLines={1}>{t('{count} stalled', { count: stage.stuck })}</Text> : null}
      </Pressable>)}
    </ScrollView>
  </Section>;
}

/** One or two figures that matter for the person's role, each with how it compares to last month. */
function KeyNumbers({ figures, onOpen }: { figures: Figure[]; onOpen: (figure: Figure) => void }) {
  const t = useT();
  const format = useFormat();
  const value = (figure: Figure) => (figure.value.kind === 'money' ? format.money(figure.value.amount, figure.value.currency)
    : figure.value.kind === 'share' ? t('{count} of {total}', { count: figure.value.count, total: figure.value.total }) : format.number(figure.value.value, 0));
  return <Row gap={2} align="stretch">
    {figures.map((figure) => <Card key={figure.id} style={{ flex: 1 }} onPress={() => { haptic.tap(); onOpen(figure); }}>
      <Text variant="caption" tone="secondary" numberOfLines={2}>{t(figure.label)}</Text>
      <Text variant="number" numberOfLines={1} adjustsFontSizeToFit>{value(figure)}</Text>
      {figure.note ? <Text variant="caption" tone={figure.note.tone === 'neutral' ? 'tertiary' : figure.note.tone} numberOfLines={2}>{t(figure.note.key, figure.note.values)}</Text> : null}
    </Card>)}
  </Row>;
}
