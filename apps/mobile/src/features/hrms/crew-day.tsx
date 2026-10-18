import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Camera, HardHat, Plus, UserPlus } from 'lucide-react-native';
import type { CrewPresence, HrmsWorker } from '../../../../../packages/contracts/src/hrms';
import { errorMessage, useApi } from '../../core/api';
import { useFormat } from '../../core/format';
import { key, useT } from '../../core/i18n';
import { currentPosition } from '../../core/location';
import { MediaPermissionError, openSettings, takePhoto, type LocalPhoto } from '../../core/media';
import { useOutbox, usePending } from '../../core/outbox';
import { useSession } from '../../core/session';
import { DateField } from '../../ui/date-field';
import { OptionSheet, SelectField, Stepper, TextField } from '../../ui/fields';
import { Banner, Card, Empty, Failure, Fact, ListRow, ListScreen, Loading, Screen, Section } from '../../ui/layout';
import { PhotoGrid } from '../../ui/photos';
import { Button, Chip, Row, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { hrmsKeys, useCrewDay, useCrewDays, useCrews, useSiteAccess } from './api';
import { crewDayReady, crewTotals } from './model';
import type { CrewDayPayload } from './outbox';

const PRESENCE: Array<{ value: CrewPresence; label: string }> = [{ value: 'present', label: key('Day') }, { value: 'half_day', label: key('Half') }, { value: 'absent', label: key('Away') }];

/** A project's crew days: who was on site each day, and marking today's. */
export function CrewDaysScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const days = useCrewDays(projectId);
  const canMark = !!days.data?.canMark && !!days.data.markableCrewIds.length;
  return <ListScreen title={t('Crew days')} back items={days.data?.days} keyExtractor={(day) => day.id} groupBy={(day) => format.weekday(day.workDate)}
    loading={days.isLoading} error={days.error ? errorMessage(days.error, t('Crew days could not be loaded.')) : null} onRetry={() => void days.refetch()}
    onRefresh={() => void days.refetch()} refreshing={days.isRefetching}
    empty={<Empty icon={HardHat} title={t('No crew days yet')} action={canMark ? { label: t('Mark crew day'), onPress: () => router.push({ pathname: '/crew-day/[id]', params: { id: 'new', projectId } }) } : undefined} />}
    renderItem={(day, _, first) => <ListRow first={first} icon={HardHat} title={day.crewName} onPress={() => router.push(`/crew-day/${day.id}`)}
      detail={`${day.trade} · ${Number(day.present) === 1 ? t('1 day of work') : t('{count} days of work', { count: format.number(day.present, 1) })} · ${day.markedByName}`} trailing={<StatusChip status={day.status} />} />}
    footer={canMark ? <Button label={t('Mark crew day')} icon={Plus} variant="primary" size="lg" full onPress={() => router.push({ pathname: '/crew-day/[id]', params: { id: 'new', projectId } })} /> : undefined} />;
}

type Row = { workerId: string; name: string; trade: string; presence: CrewPresence; overtime: string };

/** Mark a crew's day (who was there, overtime, a group photo at the site) or decide on one someone else marked. */
export function CrewDayScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const toast = useToast();
  const api = useApi();
  const outbox = useOutbox();
  const session = useSession();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string; projectId?: string }>();
  const isNew = params.id === 'new';
  const dayId = useRef(isNew ? Crypto.randomUUID() : params.id).current;
  const existing = useCrewDay(isNew ? null : params.id);
  const projectId = (isNew ? params.projectId : existing.data?.projectId) ?? null;
  const crews = useCrews();
  const list = useCrewDays(projectId);
  const access = useSiteAccess(projectId ?? '', !!projectId);
  const pending = usePending(`crew-day:${dayId}`);
  const [crewId, setCrewId] = useState<string | null>(null);
  const [workDate, setWorkDate] = useState(format.today());
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<LocalPhoto | null>(null);
  const [adding, setAdding] = useState(false);
  const [overtimeFor, setOvertimeFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<'approve' | 'return' | null>(null);
  const [decisionNote, setDecisionNote] = useState('');

  const day = existing.data;
  const workers = crews.data?.workers ?? [];
  const markable = (crews.data?.crews ?? []).filter((crew) => crew.active && (list.data?.markableCrewIds ?? []).includes(crew.id));
  const editable = isNew || (!!day && day.canMark && day.markedBy === session.userId && (day.status === 'draft' || day.status === 'returned'));

  // A saved day fills the form; a new one starts with the chosen crew's active workers, all present.
  useEffect(() => {
    if (day) {
      setCrewId(day.crewId); setWorkDate(day.workDate); setNote(day.note);
      setRows(day.workers.map((worker) => ({ workerId: worker.workerId, name: worker.name, trade: worker.trade, presence: worker.presence, overtime: String(Number(worker.overtimeHours) || 0) })));
    }
  }, [day]);
  useEffect(() => {
    if (!isNew || !crewId) return;
    setRows(workers.filter((worker) => worker.active && worker.crewId === crewId).map((worker) => ({ workerId: worker.id, name: worker.name, trade: worker.trade, presence: 'present', overtime: '0' })));
  }, [crewId, isNew]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isNew && !crewId && markable.length === 1) setCrewId(markable[0].id); }, [isNew, crewId, markable]);

  const totals = crewTotals(rows.map((row) => ({ presence: row.presence, overtimeHours: row.overtime })));
  const blocked = useMemo(() => new Map((access.data?.people ?? []).filter((person) => !person.cleared && person.subject.kind === 'worker').map((person) => [person.subject.id, person])), [access.data]);
  const unclear = rows.filter((row) => row.presence !== 'absent' && blocked.has(row.workerId));

  const takeGroupPhoto = async () => {
    try { const shot = await takePhoto({ longEdge: 1600 }); if (shot) setPhoto(shot); }
    catch (error) {
      if (error instanceof MediaPermissionError) toast.show(t('Allow camera access in Settings to take photos.'), 'error', { label: t('Settings'), onPress: openSettings });
      else toast.error(t('The photo could not be added. Try again.'));
    }
  };
  const submit = async () => {
    if (!crewId || !crewDayReady(rows)) return;
    setBusy(true);
    try {
      const position = await currentPosition();
      const captureId = photo ? Crypto.randomUUID() : null;
      const crew = (crews.data?.crews ?? []).find((item) => item.id === crewId);
      const payload: CrewDayPayload = {
        dayId, captureId, position,
        input: { crewId, projectId, workDate, note: note.trim(), workers: rows.map((row) => ({ workerId: row.workerId, presence: row.presence, overtimeHours: Math.round(Number(row.overtime || 0) * 100) / 100 })) },
      };
      await outbox.enqueue({ id: Crypto.randomUUID(), kind: 'hrms.crew-day', title: t('Crew day · {crew}', { crew: crew?.name ?? '' }), detail: format.day(workDate), scope: `crew-day:${dayId}`, payload },
        photo && captureId ? [{ key: 'photo', uri: photo.uri, name: photo.name, type: photo.type }] : []);
      toast.success(t('Crew day sent'));
      router.back();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
    finally { setBusy(false); }
  };
  const decide = async () => {
    if (!day || !decision) return;
    setBusy(true);
    try {
      await api.send(`hrms/crew-days/${day.id}/decision`, 'POST', { version: day.version, decision, note: decisionNote.trim() });
      void queryClient.invalidateQueries({ queryKey: hrmsKeys.all(api.workspaceId) });
      toast.success(decision === 'approve' ? t('Approved') : t('Sent back'));
      setDecision(null);
      router.back();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
    finally { setBusy(false); }
  };

  if (!isNew && existing.isLoading) return <Screen back title={t('Crew day')}><Loading shape="record" count={4} /></Screen>;
  if (!isNew && (existing.error || !day)) return <Screen back title={t('Crew day')}><Failure message={errorMessage(existing.error, t('This crew day could not be loaded.'))} onRetry={() => void existing.refetch()} /></Screen>;
  if (isNew && crews.isLoading) return <Screen back title={t('Crew day')}><Loading shape="form" count={3} /></Screen>;

  const blockedItem = pending.find((item) => item.status === 'blocked');
  const footer = editable
    ? <Button label={t('Submit crew day')} variant="primary" size="lg" full loading={busy} disabled={!crewId || !crewDayReady(rows) || !!pending.length} onPress={submit} />
    : day?.canDecide && day.status === 'submitted'
      ? <Row gap={2}>
        <Button label={t('Send back')} variant="secondary" size="lg" onPress={() => setDecision('return')} />
        <View style={{ flex: 1 }}><Button label={t('Approve')} variant="primary" size="lg" full onPress={() => setDecision('approve')} /></View>
      </Row> : undefined;

  return <Screen back title={day ? day.crewName : t('Crew day')} subtitle={day ? `${day.projectName ?? t('Workshop')} · ${format.weekday(day.workDate)}` : undefined} keyboard footer={footer}>
    {day ? <Row gap={2}><StatusChip status={day.status} /><Text variant="caption" tone="secondary">{t('Marked by {name}', { name: day.markedByName })}</Text></Row> : null}
    {day?.status === 'returned' && day.decisionNote ? <Banner tone="warning" title={t('Sent back')} detail={day.decisionNote} /> : null}
    {blockedItem ? <Banner tone="warning" title={t('Needs a reason')} detail={blockedItem.issues?.map((issue) => t(issue)).join(' · ') ?? blockedItem.error} action={{ label: t('Fix'), onPress: () => router.push('/outbox') }} />
      : pending.length ? <Banner tone="info" title={t('Waiting to send')} /> : null}

    {isNew ? <>
      <SelectField label={t('Crew')} value={crewId} onChange={setCrewId} placeholder={t('Choose a crew')} options={markable.map((crew) => ({ value: crew.id, label: crew.name, detail: [crew.trade, crew.vendorName].filter(Boolean).join(' · ') }))}
        hint={!markable.length ? t('No crews you can mark here.') : undefined} />
      <DateField label={t('Day')} value={workDate} onChange={setWorkDate} max={format.today()} />
    </> : null}

    {rows.length ? <Card tone="muted" style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <View><Text variant="number">{format.number(totals.days, 1)}</Text><Text variant="caption" tone="secondary">{t('days of work')}</Text></View>
      <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
        <Text variant="caption" tone="secondary">{t('{present} day · {half} half · {absent} away', { present: totals.present, half: totals.half, absent: totals.absent })}</Text>
        {totals.overtime ? <Text variant="caption" tone="secondary">{t('{hours} h overtime', { hours: format.number(totals.overtime, 2) })}</Text> : null}
      </View>
    </Card> : null}
    {unclear.length ? <Banner tone="warning" title={t('Not cleared for site')} detail={unclear.map((row) => row.name).join(', ')} /> : null}

    {crewId || day ? <Section title={t('Who was there')} action={editable ? <Button size="sm" variant="ghost" icon={UserPlus} label={t('Add person')} onPress={() => setAdding(true)} /> : undefined}>
      {rows.length ? rows.map((row, index) => <View key={row.workerId} style={{ paddingHorizontal: theme.space(4), paddingVertical: theme.space(3), gap: theme.space(2), borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.structuralDivider }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text variant="label">{row.name}</Text>
            <Text variant="caption" tone="secondary">{[row.trade, Number(row.overtime) ? t('+{hours} h', { hours: row.overtime }) : null].filter(Boolean).join(' · ')}</Text>
          </View>
          {blocked.has(row.workerId) ? <Chip label={t('Not cleared')} tone="warning" /> : null}
        </Row>
        {editable ? <Row gap={2}>
          {PRESENCE.map((option) => <View key={option.value} style={{ flex: 1 }}><Chip label={t(option.label)} selected={row.presence === option.value}
            onPress={() => setRows((list) => list.map((item) => (item.workerId === row.workerId ? { ...item, presence: option.value } : item)))} /></View>)}
          <Chip label={t('OT')} onPress={() => setOvertimeFor(row.workerId)} />
        </Row> : <StatusChip status={row.presence === 'present' ? 'complete' : row.presence === 'half_day' ? 'in_progress' : 'cancelled'} label={t(PRESENCE.find((option) => option.value === row.presence)!.label)} />}
      </View>) : <ListRow first title={t('Nobody in this crew yet')} onPress={editable ? () => setAdding(true) : undefined} />}
    </Section> : null}

    {editable ? <>
      <Section flat title={t('Group photo')}>
        {photo ? <PhotoGrid photos={[{ key: photo.id, uri: photo.uri }]} onRemove={() => setPhoto(null)} columns={2} max={1} />
          : <Button label={t('Take group photo')} icon={Camera} variant="secondary" size="lg" full onPress={takeGroupPhoto} />}
      </Section>
      <TextField label={t('Note')} value={note} onChangeText={setNote} multiline maxLength={2000} placeholder={t('Optional')} />
    </> : day ? <Section>
      <Fact first label={t('Group photo')} value={day.evidence.photoCaptured ? t('Taken') : t('None')} />
      {day.evidence.arrival ? <Fact label={t('Location')} value={t(day.evidence.arrival.status === 'inside' ? key('At the site') : day.evidence.arrival.status === 'outside' ? key('Away from the site') : key('Not confirmed'))} /> : null}
      {day.exceptionReason ? <Fact label={t('Reason')} value={day.exceptionReason} /> : null}
      {day.note ? <Fact label={t('Note')} value={day.note} /> : null}
    </Section> : null}

    <OptionSheet open={adding} onClose={() => setAdding(false)} title={t('Add a person')} value={null}
      options={workers.filter((worker: HrmsWorker) => worker.active && !rows.some((row) => row.workerId === worker.id)).map((worker) => ({ value: worker.id, label: worker.name, detail: worker.trade }))}
      onChange={(value) => {
        const worker = workers.find((item) => item.id === value);
        if (worker) setRows((list) => [...list, { workerId: worker.id, name: worker.name, trade: worker.trade, presence: 'present', overtime: '0' }]);
        setAdding(false);
      }} />
    <Sheet open={!!overtimeFor} onClose={() => setOvertimeFor(null)} title={t('Overtime')}
      footer={<Button label={t('Done')} variant="primary" size="lg" full onPress={() => setOvertimeFor(null)} />}>
      <Stepper label={t('Hours beyond the day')} value={rows.find((row) => row.workerId === overtimeFor)?.overtime ?? '0'} step={0.5} min={0} max={16} unit={t('h')}
        onChange={(value) => setRows((list) => list.map((item) => (item.workerId === overtimeFor ? { ...item, overtime: value } : item)))} />
    </Sheet>
    <Sheet open={!!decision} onClose={() => setDecision(null)} title={decision === 'approve' ? t('Approve this crew day?') : t('Send it back?')}
      footer={<Button label={decision === 'approve' ? t('Approve') : t('Send back')} variant="primary" size="lg" full loading={busy}
        disabled={decision === 'return' && decisionNote.trim().length < 3} onPress={decide} />}>
      <TextField label={decision === 'approve' ? t('Note') : t('What to change')} value={decisionNote} onChangeText={setDecisionNote} multiline maxLength={2000}
        placeholder={decision === 'approve' ? t('Optional') : undefined} />
    </Sheet>
  </Screen>;
}

