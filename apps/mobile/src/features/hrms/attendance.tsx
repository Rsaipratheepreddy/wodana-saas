import { useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { Camera, Clock, LogIn, LogOut, MapPin, Repeat } from 'lucide-react-native';
import type { AttendanceSession, WorkContext, WorkMode } from '../../../../../packages/contracts/src/hrms';
import { errorMessage } from '../../core/api';
import { useFormat, wallTimeToIso } from '../../core/format';
import { haptic } from '../../core/haptics';
import { key, useT } from '../../core/i18n';
import { currentPosition } from '../../core/location';
import { MediaPermissionError, openSettings, takePhoto } from '../../core/media';
import { useOutbox, usePending } from '../../core/outbox';
import { DateField } from '../../ui/date-field';
import { ReasonSheet } from '../../ui/dialogs';
import { SegmentedControl, SelectField, TextField } from '../../ui/fields';
import { Banner, Card, Failure, ListRow, Loading, Screen, Section } from '../../ui/layout';
import { Button, Chip, Row, Stack, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { useBootstrap, useCurrentAttendance, useHrmsCommand, useLocations, useWorkContexts } from './api';
import { isStale, MODE_LABEL, minutesSince, modesFor } from './model';
import type { AttendancePayload } from './outbox';

type Kind = 'check_in' | 'check_out' | 'switch';
const KIND_LABEL: Record<Kind, string> = { check_in: key('Check in'), check_out: key('Check out'), switch: key('Switch place') };

/** Check in and out with a photo and the phone's position; works offline and asks for a reason when the server needs one. */
export function AttendanceScreen() {
  const t = useT();
  const format = useFormat();
  const toast = useToast();
  const bootstrap = useBootstrap();
  const current = useCurrentAttendance();
  const locations = useLocations();
  const contexts = useWorkContexts();
  const outbox = useOutbox();
  const pending = usePending('attendance');
  const [mode, setMode] = useState<WorkMode>('office');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [contextId, setContextId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<Kind | null>(null);
  const [switching, setSwitching] = useState(false);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick((value) => value + 1), 60_000); return () => clearInterval(timer); }, []);

  // A queued action that has gone through: say so once.
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    const now = new Map(pending.map((item) => [item.id, item.title]));
    for (const [id, title] of seen.current) if (!now.has(id)) { toast.success(t('{action} recorded', { action: title })); void current.refetch(); }
    seen.current = now;
    const blocked = pending.find((item) => item.status === 'blocked' && item.issues?.length);
    if (blocked && !reasonFor) setReasonFor(blocked.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const employee = bootstrap.data?.employee;
  const session = current.data ?? null;
  const open = !!session && !session.endedAt;
  const stale = isStale(session);
  const offices = useMemo(() => (locations.data ?? []).filter((item) => item.active && item.kind === 'office'), [locations.data]);
  const sites = useMemo(() => (locations.data ?? []).filter((item) => item.active && item.kind === 'site'), [locations.data]);
  const waiting = pending.find((item) => item.status !== 'blocked');
  const blocked = pending.find((item) => item.status === 'blocked');

  const act = async (kind: Kind) => {
    if (busy || waiting) return;
    if (kind !== 'check_out' && mode === 'site' && !locationId) { toast.error(t('Choose the site you are at.')); return; }
    setBusy(kind);
    try {
      const photo = await takePhoto({ front: true, longEdge: 1600 });
      if (!photo) return;
      const deviceAt = new Date().toISOString();
      const position = await currentPosition();
      const context = (contexts.data ?? []).find((item) => item.id === contextId);
      const segment = session?.segments[session.segments.length - 1];
      const action: AttendancePayload['action'] = {
        actionId: Crypto.randomUUID(), captureId: Crypto.randomUUID(), kind, deviceAt, position, note: note.trim(),
        mode: kind === 'check_out' ? (segment?.mode ?? 'office') : mode,
        ...(kind === 'check_in' ? {} : { expectedSessionId: session?.id ?? null, expectedVersion: session?.version }),
        ...(kind !== 'check_out' && (mode === 'office' || mode === 'site') && locationId ? { locationId } : {}),
        ...(kind !== 'check_out' && mode !== 'site' && context ? contextFields(context) : {}),
      };
      await outbox.enqueue({ id: action.actionId, kind: 'hrms.attendance', title: t(KIND_LABEL[kind]), detail: format.when(deviceAt), scope: 'attendance', payload: { action } },
        [{ key: 'photo', uri: photo.uri, name: photo.name, type: photo.type }]);
      haptic.success();
      setNote(''); setSwitching(false);
    } catch (error) {
      if (error instanceof MediaPermissionError) toast.show(t('Allow camera access in Settings to take photos.'), 'error', { label: t('Settings'), onPress: openSettings });
      else toast.error(errorMessage(error, t('Something went wrong')));
    } finally { setBusy(null); }
  };

  if (bootstrap.isLoading || current.isLoading) return <Screen title={t('Attendance')} back><Loading shape="record" count={2} /></Screen>;
  if (bootstrap.error || current.error) return <Screen title={t('Attendance')} back><Failure message={errorMessage(bootstrap.error ?? current.error, t('Attendance is unavailable.'))} onRetry={() => { void bootstrap.refetch(); void current.refetch(); }} /></Screen>;
  if (!employee || !employee.enabled) return <Screen title={t('Attendance')} back><Banner tone="neutral" title={t('Attendance is switched off for you')} detail={t('Ask HR if you should record attendance.')} /></Screen>;

  const reasonItem = pending.find((item) => item.id === reasonFor);
  const showForm = !open || switching;
  const footer = waiting ? null : open && !switching
    ? <Button label={t('Check out')} icon={LogOut} variant="primary" size="lg" full loading={busy === 'check_out'} onPress={() => act('check_out')} disabled={!!blocked} />
    : <Button label={switching ? t('Switch place') : t('Check in')} icon={Camera} variant="primary" size="lg" full loading={busy === 'check_in' || busy === 'switch'} onPress={() => act(switching ? 'switch' : 'check_in')} disabled={!!blocked} />;

  return <Screen title={t('Attendance')} subtitle={format.longDay(format.today())} back onRefresh={() => { void current.refetch(); void locations.refetch(); }} refreshing={current.isRefetching} footer={footer}>
    {waiting ? <Banner tone="info" title={t('{action} waiting to send', { action: waiting.title })} detail={waiting.status === 'sending' ? t('Sending…') : t('It sends by itself when there is a connection.')} icon={Clock} /> : null}
    {blocked ? <Banner tone="warning" title={t('{action} needs a reason', { action: blocked.title })} detail={(blocked.issues?.length ? blocked.issues.map((issue) => t(issue)).join(' · ') : blocked.error) ?? ''}
      action={{ label: blocked.issues?.length ? t('Add reason') : t('Discard'), onPress: () => (blocked.issues?.length ? setReasonFor(blocked.id) : outbox.discard(blocked.id)) }} /> : null}

    <StatusCard session={session} />

    {open && stale ? <Banner tone="danger" title={t('Still checked in from {day}', { day: format.day(format.dayOf(session!.startedAt)) })} detail={t('Check out now, or tell HR when you left.')}
      action={{ label: t('Fix'), onPress: () => setFixing(true) }} /> : null}

    {showForm ? <Stack gap={4}>
      <SegmentedControl label={t('Where are you working?')} value={mode} onChange={(next) => { setMode(next); setLocationId(null); }}
        options={modesFor(employee.remoteAllowed).map((value) => ({ value, label: t(MODE_LABEL[value]) }))} />
      {mode === 'site' ? <SelectField label={t('Site')} value={locationId} onChange={setLocationId} placeholder={t('Choose a site')}
        options={sites.map((item) => ({ value: item.id, label: item.name, detail: item.address }))} hint={!sites.length ? t('No sites are assigned to you.') : undefined} /> : null}
      {mode === 'office' && offices.length ? <SelectField label={t('Office')} value={locationId} onChange={setLocationId} placeholder={t('Choose an office')} allowClear
        options={offices.map((item) => ({ value: item.id, label: item.name, detail: item.address }))} /> : null}
      {mode !== 'site' && (contexts.data ?? []).length ? <SelectField label={t('Working on')} value={contextId} onChange={setContextId} placeholder={t('Optional')} allowClear
        options={(contexts.data ?? []).map((item) => ({ value: item.id, label: item.name, detail: item.customerName }))} /> : null}
      <TextField label={t('Note')} value={note} onChangeText={setNote} placeholder={t('Optional')} maxLength={2000} />
      {switching ? <Button label={t('Cancel')} variant="ghost" onPress={() => setSwitching(false)} /> : null}
    </Stack> : <Stack gap={2}>
      <Button label={t('Switch place')} icon={Repeat} variant="secondary" full onPress={() => setSwitching(true)} disabled={!!waiting} />
    </Stack>}

    {session?.segments.length ? <Section title={t('Today')}>
      {session.segments.map((segment, index) => <ListRow key={segment.id} first={index === 0} icon={segment.mode === 'site' ? MapPin : index === 0 ? LogIn : Repeat}
        title={segment.context.location?.name ?? segment.context.name ?? t(MODE_LABEL[segment.mode])}
        detail={`${t(MODE_LABEL[segment.mode])} · ${format.time(segment.startedAt)}–${segment.endedAt ? format.time(segment.endedAt) : t('now')}`} />)}
    </Section> : null}

    <ReasonSheet open={!!reasonItem} onClose={() => setReasonFor(null)} title={t('Why is this different?')} detail={reasonItem?.issues?.map((issue) => t(issue)).join(' · ')}
      label={t('Reason for review')} action={t('Send')} onSubmit={(reason) => { if (reasonItem) outbox.amend(reasonItem.id, { exceptionReason: reason }); }} />
    {session ? <MissingCheckoutSheet open={fixing} onClose={() => setFixing(false)} session={session} /> : null}
  </Screen>;
}

const contextFields = (context: WorkContext) => (context.kind === 'project' ? { projectId: context.id } : { caseId: context.caseId || context.id });

function StatusCard({ session }: { session: AttendanceSession | null }) {
  const t = useT();
  const format = useFormat();
  const theme = useTheme();
  const open = !!session && !session.endedAt;
  const segment = session?.segments[session.segments.length - 1];
  return <Card tone={open ? 'action' : 'muted'} style={{ gap: theme.space(1) }}>
    <Row style={{ justifyContent: 'space-between' }}>
      <Text variant="overline" tone="secondary">{open ? t('Checked in') : t('Not checked in')}</Text>
      {session?.pendingReviewCount ? <Chip label={t('{count} to review', { count: session.pendingReviewCount })} tone="warning" /> : null}
    </Row>
    {open ? <>
      <Text variant="display" style={{ fontVariant: ['tabular-nums'] }}>{format.duration(minutesSince(session!.startedAt))}</Text>
      <Text tone="secondary">{t('Since {time}', { time: format.time(session!.startedAt) })}{segment ? ` · ${segment.context.location?.name ?? segment.context.name ?? t(MODE_LABEL[segment.mode])}` : ''}</Text>
    </> : <Text variant="heading">{session?.endedAt ? t('Checked out at {time}', { time: format.time(session.endedAt) }) : t('Ready when you are')}</Text>}
  </Card>;
}

/** "I forgot to check out": the time you left and why, for your approver. */
function MissingCheckoutSheet({ open, onClose, session }: { open: boolean; onClose: () => void; session: AttendanceSession }) {
  const t = useT();
  const format = useFormat();
  const toast = useToast();
  const startDay = format.dayOf(session.startedAt);
  const [day, setDay] = useState(startDay);
  const [time, setTime] = useState('18:00');
  const [reason, setReason] = useState('');
  const actionId = useRef(Crypto.randomUUID()).current;
  const command = useHrmsCommand((api, input: Record<string, unknown>) => api.send('hrms/reviews', 'POST', input));
  const timeZone = session.calendar?.timezone || format.timeZone;
  const submit = async () => {
    try {
      const requestedAt = new Date(wallTimeToIso(day, time, timeZone));
      if (requestedAt.getTime() <= new Date(session.startedAt).getTime() || requestedAt.getTime() > Date.now()) { toast.error(t('Choose a time after you checked in and before now.')); return; }
      await command.mutateAsync({ actionId, sessionId: session.id, kind: 'missing_checkout', requestedAt: requestedAt.toISOString(), reason: reason.trim() });
      toast.success(t('Sent for approval'));
      onClose();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  return <Sheet open={open} onClose={onClose} title={t('When did you leave?')}
    footer={<Button label={t('Send for approval')} variant="primary" size="lg" full loading={command.isPending} disabled={reason.trim().length < 3} onPress={submit} />}>
    <DateField label={t('Day')} value={day} onChange={setDay} min={startDay} max={format.today()} />
    <DateField label={t('Time')} value={time} onChange={setTime} mode="time" />
    <TextField label={t('Reason')} value={reason} onChangeText={setReason} multiline maxLength={2000} placeholder={t('What happened?')} />
  </Sheet>;
}

