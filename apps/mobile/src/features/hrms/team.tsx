import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, ClipboardCheck, HardHat, Plane, Users } from 'lucide-react-native';
import type { AttendanceReview, LeaveRequest, PendingTimeWeeks } from '../../../../../packages/contracts/src/hrms';
import { errorMessage, useApi } from '../../core/api';
import { useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { useSession } from '../../core/session';
import { SegmentedControl, TextField } from '../../ui/fields';
import { Banner, Empty, Failure, Fact, ListRow, Loading, Screen, Section } from '../../ui/layout';
import { AuthImage } from '../../ui/photos';
import { Avatar, Button, Stack } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { hrmsKeys, useBootstrap, useCrewDays, useHistory, useLeaveRequests, usePendingTime, useReviews } from './api';
import { leaveRange } from './leave';
import { REVIEW_KIND } from './model';


type Item =
  | { kind: 'leave'; id: string; leave: LeaveRequest }
  | { kind: 'review'; id: string; review: AttendanceReview }
  | { kind: 'week'; id: string; week: PendingTimeWeeks['weeks'][number] };

/** Team: what waits for my decision (leave, attendance, timesheets, crew days) and who is in today. */
export function TeamScreen() {
  const t = useT();
  const [view, setView] = useState<'approve' | 'today'>('approve');
  return <Screen title={t('Team')} back below={<SegmentedControl value={view} onChange={setView} options={[{ value: 'approve', label: t('To approve') }, { value: 'today', label: t('Today') }]} />}>
    {view === 'approve' ? <ToApprove /> : <TeamToday />}
  </Screen>;
}

function ToApprove() {
  const t = useT();
  const format = useFormat();
  const router = useRouter();
  const bootstrap = useBootstrap();
  const team = !!bootstrap.data?.permissions.team;
  const leave = useLeaveRequests('team', undefined, team);
  const reviews = useReviews('team', team);
  const weeks = usePendingTime(team);
  const crewDays = useCrewDays(null, !!bootstrap.data?.permissions.crews);
  const [open, setOpen] = useState<Item | null>(null);
  const items = useMemo<Item[]>(() => [
    ...(leave.data ?? []).filter((item) => item.canDecide && (item.status === 'pending' || item.status === 'cancellation_pending')).map((item) => ({ kind: 'leave' as const, id: item.id, leave: item })),
    ...(reviews.data ?? []).filter((item) => item.canDecide && item.status === 'pending').map((item) => ({ kind: 'review' as const, id: item.id, review: item })),
    ...(weeks.data?.weeks ?? []).filter((item) => item.canDecide && item.timesheet).map((item) => ({ kind: 'week' as const, id: item.timesheet!.id, week: item })),
  ], [leave.data, reviews.data, weeks.data]);
  const days = (crewDays.data?.days ?? []).filter((day) => day.status === 'submitted' && day.canDecide);
  const loading = bootstrap.isLoading || leave.isLoading || reviews.isLoading || weeks.isLoading;
  const error = leave.error ?? reviews.error ?? weeks.error;
  if (loading) return <Loading count={4} />;
  if (error) return <Failure message={errorMessage(error, t('Approvals could not be loaded.'))} onRetry={() => { void leave.refetch(); void reviews.refetch(); void weeks.refetch(); }} />;
  if (!items.length && !days.length) return <Empty icon={CheckCircle2} title={t('Nothing to approve')} />;
  return <>
    {items.length ? <Section>
      {items.map((item, index) => item.kind === 'leave'
        ? <ListRow key={item.id} first={index === 0} icon={Plane} title={item.leave.name} onPress={() => setOpen(item)}
          detail={`${item.leave.status === 'cancellation_pending' ? t('Cancel leave') : item.leave.leaveTypeName} · ${leaveRange(item.leave, format, t)}`} />
        : item.kind === 'review'
          ? <ListRow key={item.id} first={index === 0} icon={ClipboardCheck} title={item.review.name ?? ''} onPress={() => setOpen(item)}
            detail={`${t(REVIEW_KIND[item.review.kind] ?? item.review.kind)} · ${format.when(item.review.requestedAt ?? item.review.originalAt ?? item.review.createdAt)}`} />
          : <ListRow key={item.id} first={index === 0} icon={CalendarClock} title={item.week.name} onPress={() => setOpen(item)}
            detail={`${t('Week of {day}', { day: format.day(item.week.weekStart) })} · ${format.duration(item.week.totalMinutes)}`} />)}
    </Section> : null}
    {days.length ? <Section title={t('Crew days')}>
      {days.map((day, index) => <ListRow key={day.id} first={index === 0} icon={HardHat} title={`${day.crewName} · ${day.projectName ?? t('Workshop')}`}
        detail={`${format.weekday(day.workDate)} · ${t('{count} days of work', { count: format.number(day.present, 1) })}`} onPress={() => router.push(`/crew-day/${day.id}`)} />)}
    </Section> : null}
    <DecisionSheet item={open} onClose={() => setOpen(null)} />
  </>;
}

/** One request, what it's about, and the decision with a note (the server keeps a note with every decision). */
function DecisionSheet({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const t = useT();
  const theme = useTheme();
  const format = useFormat();
  const toast = useToast();
  const api = useApi();
  const session = useSession();
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const close = () => { setNote(''); onClose(); };
  const decide = async (decision: 'approve' | 'reject' | 'return') => {
    if (!item) return;
    setBusy(decision);
    try {
      if (item.kind === 'leave') await api.send(`hrms/leave/requests/${item.id}/decision`, 'POST', { decision, reason: note.trim() });
      if (item.kind === 'review') await api.send(`hrms/reviews/${item.id}/decision`, 'POST', { decision, reason: note.trim() });
      if (item.kind === 'week') await api.send(`hrms/time/${item.id}/decision`, 'POST', { version: item.week.timesheet!.version, decision, note: note.trim() });
      toast.success(decision === 'approve' ? t('Approved') : decision === 'return' ? t('Sent back') : t('Not approved'));
      void queryClient.invalidateQueries({ queryKey: hrmsKeys.all(session.workspaceId) });
      close();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
    finally { setBusy(null); }
  };
  const noteRequired = item?.kind !== 'week';
  const ready = note.trim().length >= 3;
  let title = '';
  let body: ReactNode = null;
  if (item?.kind === 'leave') {
    title = item.leave.name;
    body = <Section>
      <Fact first label={t('Type')} value={item.leave.leaveTypeName} />
      <Fact label={t('When')} value={leaveRange(item.leave, format, t)} />
      <Fact label={t('Days')} value={format.number(item.leave.days, 1)} />
      <Fact label={t('Reason')} value={item.leave.status === 'cancellation_pending' ? item.leave.cancellationReason ?? '' : item.leave.reason} />
    </Section>;
  } else if (item?.kind === 'review') {
    const review = item.review;
    title = review.name ?? '';
    body = <Stack gap={3}>
      <Section>
        <Fact first label={t('Request')} value={t(REVIEW_KIND[review.kind] ?? review.kind)} />
        {review.originalAt ? <Fact label={t('Recorded')} value={format.when(review.originalAt)} /> : null}
        {review.requestedAt ? <Fact label={t('Asked for')} value={format.when(review.requestedAt)} /> : null}
        <Fact label={t('Reason')} value={review.reason || review.evidence?.exceptionReason || '—'} />
      </Section>
      {review.evidence?.issues?.length ? <Banner tone="warning" title={review.evidence.issues.map((issue) => t(issue)).join(' · ')} /> : null}
      {review.captureId && bootstrap.data?.permissions.evidence
        ? <AuthImage path={`hrms/captures/${review.captureId}/photo`} style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: theme.radius.lg }} accessibilityLabel={t('Check-in photo')} /> : null}
    </Stack>;
  } else if (item?.kind === 'week') {
    title = item.week.name;
    const byDay = item.week.entries.reduce<Record<string, number>>((sum, entry) => ({ ...sum, [entry.workDate]: (sum[entry.workDate] ?? 0) + entry.minutes }), {});
    body = <Section>
      {Object.entries(byDay).sort().map(([day, minutes], index) => <Fact key={day} first={index === 0} label={format.weekday(day)} value={format.duration(minutes)} />)}
      <Fact label={t('Total')} value={format.duration(item.week.totalMinutes)} />
    </Section>;
  }
  return <Sheet open={!!item} onClose={close} title={title}
    footer={<>
      <Button label={t('Approve')} variant="primary" size="lg" full loading={busy === 'approve'} disabled={(noteRequired && !ready) || !!busy} onPress={() => decide('approve')} />
      <Button label={item?.kind === 'week' ? t('Send back') : t('Reject')} variant="ghost" full loading={busy === 'reject' || busy === 'return'} disabled={!ready || !!busy}
        onPress={() => decide(item?.kind === 'week' ? 'return' : 'reject')} />
    </>}>
    {body}
    <TextField label={noteRequired ? t('Note') : t('Note (to send back)')} value={note} onChangeText={setNote} multiline maxLength={2000} placeholder={t('A few words for them')} />
  </Sheet>;
}

/** Who is in today, where, and who is away. */
function TeamToday() {
  const t = useT();
  const format = useFormat();
  const today = format.today();
  const history = useHistory(today, today, 'team');
  const days = [...(history.data?.days ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  if (history.isLoading) return <Loading count={5} />;
  if (history.error) return <Failure message={errorMessage(history.error, t('Your team could not be loaded.'))} onRetry={() => void history.refetch()} />;
  if (!days.length) return <Empty icon={Users} title={t('No one on your team yet')} />;
  return <Section>
    {days.map((day, index) => <ListRow key={day.membershipId} first={index === 0} leading={<Avatar name={day.name} person={{ id: day.membershipId }} />} title={day.name}
      detail={day.open ? `${day.place ?? t('Checked in')} · ${t('since {time}', { time: format.time(day.firstIn) })}` : day.leaveType ?? (day.firstIn ? `${format.time(day.firstIn)} – ${format.time(day.lastOut)}` : day.scheduled ? '' : t('Day off'))}
      trailing={<StatusChip status={day.status} />} />)}
  </Section>;
}

