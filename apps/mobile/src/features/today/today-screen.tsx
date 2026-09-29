import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, CheckCircle2, ClipboardCheck, ClipboardList, CloudOff, CloudUpload, Inbox, ListChecks, LogIn, LogOut, PackageCheck, PhoneCall, Users } from 'lucide-react-native';
import type { HomeOverview } from '../../../../../packages/contracts/src/home';
import { errorMessage, useApi } from '../../core/api';
import { appRouteFor } from '../../core/deep-links';
import { useFormat } from '../../core/format';
import { key, useT } from '../../core/i18n';
import { useOutbox } from '../../core/outbox';
import { useOnline } from '../../core/query';
import { useSession } from '../../core/session';
import { Banner, Card, Empty, ListRow, Screen, Section, Shimmer } from '../../ui/layout';
import { Button, Row, Text } from '../../ui/primitives';
import { StatusChip } from '../../ui/status';
import { useTheme } from '../../ui/theme';
import { useBootstrap, useCrewDays, useCurrentAttendance, useLeaveRequests, usePendingTime, useReviews } from '../hrms/api';
import { minutesSince, MODE_LABEL } from '../hrms/model';
import { useWaitingCount } from '../approvals/api';
import { useInbox } from '../inbox/api';
import { useOpenWork, useSitesToday } from '../projects/api';
import { WorkTrailing } from '../projects/plan-screen';
import { useDeliveries } from '../purchasing/api';
import { WoddyButton } from '../woddy/woddy-screen';

const OVERDUE = key('Overdue follow-up');

/**
 * Today: my next actions, each with the button that does it — attendance, work due, what waits for my
 * approval, follow-ups and deliveries expected. Nothing here is decoration.
 */
export function TodayScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const api = useApi();
  const online = useOnline();
  const session = useSession();
  const outbox = useOutbox();
  const hrms = session.has('hrms');
  const projects = session.has('projects') && session.can('projects.view', 'projects.manage');
  const bootstrap = useBootstrap();
  const current = useCurrentAttendance(hrms);
  const team = !!bootstrap.data?.permissions.team;
  const teamLeave = useLeaveRequests('team', undefined, hrms && team);
  const teamReviews = useReviews('team', hrms && team);
  const teamTime = usePendingTime(hrms && team);
  const crewDays = useCrewDays(null, hrms && !!bootstrap.data?.permissions.crews);
  const work = useOpenWork('mine');
  const sites = useSitesToday();
  const inbox = useInbox();
  const waiting = useWaitingCount();
  const deliveries = useDeliveries(session.has('projects') && session.can('stock.receive', 'purchasing.manage'));
  const overview = useQuery({ queryKey: ['home-overview', api.workspaceId], queryFn: () => api.get<HomeOverview>('home-overview') });
  const today = format.today();

  const refresh = () => { void current.refetch(); void work.refetch(); void sites.refetch(); void overview.refetch(); void inbox.refetch(); void deliveries.refetch(); void teamLeave.refetch(); void teamReviews.refetch(); void waiting.refetch(); };
  const open = current.data && !current.data.endedAt ? current.data : null;
  const segment = open?.segments[open.segments.length - 1];
  const due = (work.data?.items ?? []).filter((item) => item.dueDate && item.dueDate <= today).slice(0, 5);
  const approvals = (teamLeave.data ?? []).filter((item) => item.canDecide && ['pending', 'cancellation_pending'].includes(item.status)).length
    + (teamReviews.data ?? []).filter((item) => item.canDecide && item.status === 'pending').length
    + (teamTime.data?.weeks ?? []).filter((week) => week.canDecide).length
    + (crewDays.data?.days ?? []).filter((day) => day.status === 'submitted' && day.canDecide).length;
  const followUps = overview.data?.sales ?? [];
  const expected = (deliveries.data?.expected ?? []).filter((order) => !order.due || order.due <= today).slice(0, 3);
  const blocked = outbox.items.filter((item) => item.status === 'blocked');
  // My sites first: today's report with one tap; after 19:00 a missing report turns amber.
  const mySites = sites.data?.sites ?? [];
  const late = (sites.data?.hour ?? 0) >= 19;
  const nothing = !due.length && !approvals && !waiting.count && !followUps.length && !expected.length && !(inbox.unread > 0) && !mySites.length;
  const loading = work.isLoading || overview.isLoading;
  const failed = (projects ? work.error : null) ?? overview.error ?? (hrms ? current.error : null);

  return <Screen large title={t('Today')} subtitle={format.longDay(today)} action={<WoddyButton />} onRefresh={refresh} refreshing={current.isRefetching || work.isRefetching}>
    {!online ? <Banner tone="neutral" icon={CloudOff} title={t('No connection')} detail={t('Captures are saved on this phone and sent later.')} /> : null}
    {blocked.length ? <Banner tone="warning" title={t('{count} captures need you', { count: blocked.length })} action={{ label: t('Fix'), onPress: () => router.push('/outbox') }} />
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

    {waiting.count ? <Section>
      <ListRow first icon={ClipboardCheck} iconTone="warning" title={t('{count} waiting for you', { count: waiting.count })} onPress={() => router.push('/approvals')} />
    </Section> : null}

    {approvals ? <Section>
      <ListRow first icon={Users} iconTone="warning" title={t('{count} to approve', { count: approvals })} detail={t('Leave, attendance, timesheets and crew days')} onPress={() => router.push('/hrms/team')} />
    </Section> : null}

    {mySites.length ? <Section title={t('My sites today')}>
      {mySites.map((site, index) => <ListRow key={site.projectId} first={index === 0} icon={ClipboardList} iconTone={!site.report && late ? 'warning' : 'action'} title={site.name}
        detail={[site.reference, site.report ? null : t('No report yet'), site.arriving ? t('{count} arriving', { count: site.arriving }) : null, site.snags ? t('{count} snags to close', { count: site.snags }) : null]
          .filter(Boolean).join(' · ')}
        trailing={site.report ? <StatusChip status={site.report.status} /> : <Button size="sm" label={t('Write report')} onPress={() => router.push(`/projects/${site.projectId}/report`)} />}
        onPress={() => router.push(site.report ? `/projects/${site.projectId}/reports` : `/projects/${site.projectId}/report`)} />)}
    </Section> : null}

    {projects && (due.length || work.isLoading) ? <Section title={t('Due today')} action={<Button size="sm" variant="ghost" label={t('All')} onPress={() => router.push('/projects/tasks')} />}>
      {work.isLoading ? <View style={{ padding: theme.space(4), gap: theme.space(2) }}><Shimmer width="60%" height={12} /><Shimmer width="40%" height={9} /></View> : due.map((item, index) => <ListRow key={item.id} first={index === 0} icon={ListChecks} title={item.title}
        detail={`${item.projectReference} · #${item.number}${item.dueDate && item.dueDate < today ? ` · ${t('due {day}', { day: format.day(item.dueDate) })}` : ''}`}
        trailing={<WorkTrailing item={item} />} onPress={() => router.push(`/projects/${item.projectId}/task/${item.id}`)} />)}
    </Section> : null}

    {followUps.length ? <Section title={t('Follow-ups')} action={<Button size="sm" variant="ghost" label={t('All')} onPress={() => router.push('/sales/follow-ups')} />}>
      {followUps.map((item, index) => <ListRow key={item.id} first={index === 0} icon={item.detail === OVERDUE ? PhoneCall : CalendarCheck} iconTone={item.detail === OVERDUE ? 'danger' : 'action'}
        title={item.title} detail={[t(item.detail), item.date ? format.when(item.date) : null].filter(Boolean).join(' · ')}
        onPress={() => router.push((appRouteFor(item.href) ?? '/sales/follow-ups') as Href)} />)}
    </Section> : null}

    {expected.length ? <Section title={t('Deliveries expected')} action={<Button size="sm" variant="ghost" label={t('All')} onPress={() => router.push('/purchasing')} />}>
      {expected.map((order, index) => <ListRow key={order.id} first={index === 0} icon={PackageCheck} title={order.supplierName} detail={`${order.number} · ${t('{count} lines', { count: order.linesLeft })}`}
        onPress={() => router.push(`/purchasing/receive/${order.id}`)} />)}
    </Section> : null}

    {inbox.enabled && inbox.unread ? <Section>
      <ListRow first icon={Inbox} title={t('{count} unread in your inbox', { count: inbox.unread })} onPress={() => router.push('/inbox')} />
    </Section> : null}

    {/* A failed load never reads as "all caught up". */}
    {failed && online ? <Banner tone="warning" title={t('Something went wrong')} detail={errorMessage(failed, t('Try again'))} action={{ label: t('Try again'), onPress: refresh }} /> : null}
    {!loading && !failed && nothing ? <Empty icon={CheckCircle2} title={t('You’re all caught up')} /> : null}
  </Screen>;
}
