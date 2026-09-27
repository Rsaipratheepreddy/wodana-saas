import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { CalendarDays, LogIn, LogOut, Repeat } from 'lucide-react-native';
import type { AttendanceDay, AttendanceEvent } from '../../../../../packages/contracts/src/hrms';
import { errorMessage } from '../../core/api';
import { addDays, useFormat, wallTimeToIso } from '../../core/format';
import { key, useT } from '../../core/i18n';
import { DateField } from '../../ui/date-field';
import { SelectField, TextField } from '../../ui/fields';
import { Empty, Fact, ListRow, ListScreen, Section } from '../../ui/layout';
import { Button, Stack } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useHistory, useHrmsCommand, type AttendanceHistoryWithLeave } from './api';
import { MODE_LABEL, REVIEW_KIND } from './model';

const EVENT_LABEL: Record<string, string> = { check_in: key('Checked in'), check_out: key('Checked out'), switch: key('Switched place') };

/** My last month, day by day; a day opens its times, and a wrong time can be corrected with a reason. */
export function DaysScreen() {
  const t = useT();
  const format = useFormat();
  const { day: openDay } = useLocalSearchParams<{ day?: string }>();
  const today = format.today();
  const from = addDays(today, -30);
  const history = useHistory(from, today);
  const [selected, setSelected] = useState<string | null>(openDay ?? null);
  useEffect(() => { if (openDay) setSelected(openDay); }, [openDay]);
  const days = useMemo(() => (history.data?.days ?? [])
    .filter((day) => day.scheduled || day.firstIn || day.leaveDays)
    .sort((a, b) => b.date.localeCompare(a.date)), [history.data]);
  const detail = (day: AttendanceDay) => {
    if (day.leaveDays && !day.firstIn) return day.leaveType ?? t('On leave');
    if (!day.firstIn) return day.date > today ? '' : t('No attendance');
    return `${format.time(day.firstIn)} – ${day.lastOut ? format.time(day.lastOut) : t('now')} · ${format.duration(day.workedMinutes)}`;
  };
  return <>
    <ListScreen title={t('My days')} back items={days} keyExtractor={(day) => day.date}
      loading={history.isLoading} error={history.error ? errorMessage(history.error, t('Your days could not be loaded.')) : null} onRetry={() => void history.refetch()}
      onRefresh={() => void history.refetch()} refreshing={history.isRefetching}
      empty={<Empty icon={CalendarDays} title={t('Nothing recorded yet')} />}
      renderItem={(day, _, first) => <ListRow first={first} title={format.weekday(day.date)} detail={detail(day)} onPress={() => setSelected(day.date)}
        trailing={<StatusChip status={day.status} />} />} />
    <DaySheet date={selected} history={history.data} onClose={() => setSelected(null)} />
  </>;
}

function DaySheet({ date, history, onClose }: { date: string | null; history: AttendanceHistoryWithLeave | undefined; onClose: () => void }) {
  const t = useT();
  const format = useFormat();
  const day = history?.days.find((item) => item.date === date);
  const events = (history?.events ?? []).filter((event) => date && format.dayOf(event.effectiveAt) === date).sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
  const reviews = (history?.reviews ?? []).filter((review) => events.some((event) => event.id === review.eventId) || (date && review.requestedAt && format.dayOf(review.requestedAt) === date));
  const [correcting, setCorrecting] = useState(false);
  const openSession = history?.sessions.find((session) => !session.endedAt && date && format.dayOf(session.startedAt) === date);
  return <>
    <Sheet open={!!date && !correcting} onClose={onClose} title={date ? format.longDay(date) : ''}
      footer={events.length || openSession ? <Button label={t('Correct a time')} variant="secondary" full onPress={() => setCorrecting(true)} /> : undefined}>
      {day ? <Stack gap={3}>
        <StatusChip status={day.status} />
        <Section>
          <Fact first label={t('Worked')} value={format.duration(day.workedMinutes)} />
          {day.breakdown.map((part) => <Fact key={`${part.name}-${part.mode}`} label={part.name || t(MODE_LABEL[part.mode as keyof typeof MODE_LABEL] ?? part.mode)} value={format.duration(part.minutes)} />)}
          {day.leaveType ? <Fact label={t('Leave')} value={day.leaveType} /> : null}
        </Section>
        {events.length ? <Section title={t('Times')}>
          {events.map((event, index) => <ListRow key={event.id} first={index === 0} icon={event.kind === 'check_in' ? LogIn : event.kind === 'check_out' ? LogOut : Repeat}
            title={`${t(EVENT_LABEL[event.kind] ?? event.kind)} · ${format.time(event.effectiveAt)}`}
            detail={event.effectiveAt !== event.originalAt ? t('Recorded {time}', { time: format.time(event.originalAt) }) : event.evidence.issues?.map((issue) => t(issue)).join(' · ')}
            trailing={event.evidence.verification !== 'verified' && event.evidence.verification !== 'captured' ? <StatusChip status={event.evidence.verification === 'pending_review' ? 'needs_review' : event.evidence.verification} /> : undefined} />)}
        </Section> : null}
        {reviews.length ? <Section title={t('Corrections')}>
          {reviews.map((review, index) => <ListRow key={review.id} first={index === 0} title={`${t(REVIEW_KIND[review.kind] ?? review.kind)}${review.requestedAt ? ` · ${format.when(review.requestedAt)}` : ''}`} detail={review.reason} trailing={<StatusChip status={review.status} />} />)}
        </Section> : null}
      </Stack> : null}
    </Sheet>
    {date ? <CorrectionSheet open={correcting} onClose={() => setCorrecting(false)} date={date} events={events} openSessionId={openSession?.id ?? null} timeZone={day?.timezone ?? format.timeZone} /> : null}
  </>;
}

/** A time that was wrong (or a check-out that never happened): the right time and why. */
function CorrectionSheet({ open, onClose, date, events, openSessionId, timeZone }: { open: boolean; onClose: () => void; date: string; events: AttendanceEvent[]; openSessionId: string | null; timeZone: string }) {
  const t = useT();
  const format = useFormat();
  const toast = useToast();
  const options = [
    ...events.map((event) => ({ value: event.id, label: `${t(EVENT_LABEL[event.kind] ?? event.kind)} · ${format.time(event.effectiveAt)}` })),
    ...(openSessionId ? [{ value: 'missing', label: t('I forgot to check out') }] : []),
  ];
  const [target, setTarget] = useState<string | null>(options[0]?.value ?? null);
  const [day, setDay] = useState(date);
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const actionId = useRef(Crypto.randomUUID());
  useEffect(() => { if (open) { actionId.current = Crypto.randomUUID(); setDay(date); setTime(''); setReason(''); setTarget(options[0]?.value ?? null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const command = useHrmsCommand((api, body: Record<string, unknown>) => api.send('hrms/reviews', 'POST', body));
  const event = events.find((item) => item.id === target);
  const submit = async () => {
    const requestedAt = wallTimeToIso(day, time, timeZone);
    if (new Date(requestedAt).getTime() > Date.now()) { toast.error(t('Choose a time in the past.')); return; }
    try {
      await command.mutateAsync(target === 'missing'
        ? { actionId: actionId.current, sessionId: openSessionId, kind: 'missing_checkout', requestedAt, reason: reason.trim() }
        : { actionId: actionId.current, sessionId: event?.sessionId, kind: 'correction', eventId: event?.id, requestedAt, reason: reason.trim() });
      toast.success(t('Sent for approval'));
      onClose();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  return <Sheet open={open} onClose={onClose} title={t('Correct a time')}
    footer={<Button label={t('Send for approval')} variant="primary" size="lg" full loading={command.isPending} disabled={!target || !time || reason.trim().length < 3} onPress={submit} />}>
    <SelectField label={t('Which time')} value={target} onChange={setTarget} options={options} />
    <DateField label={t('Day')} value={day} onChange={setDay} max={format.today()} />
    <DateField label={t('Correct time')} value={time} onChange={setTime} mode="time" />
    <TextField label={t('Reason')} value={reason} onChangeText={setReason} multiline maxLength={2000} placeholder={t('What happened?')} />
  </Sheet>;
}
