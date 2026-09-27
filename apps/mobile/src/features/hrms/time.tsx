import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';
import type { MyTimeWeek, TimeEntry } from '../../../../../packages/contracts/src/hrms';
import { errorMessage, useApi } from '../../core/api';
import { addDays, useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { SelectField, Stepper, TextField } from '../../ui/fields';
import { Banner, Failure, ListRow, Loading, Screen, Section } from '../../ui/layout';
import { Button, IconButton, Row, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { hrmsKeys, useBootstrap, useMyTime } from './api';

type Draft = TimeEntry & { key: string };
const toDrafts = (week: MyTimeWeek | undefined): Draft[] => (week?.entries ?? []).map((entry, index) => ({ ...entry, key: entry.id ?? `e${index}` }));

/** My hours this week, per day and project; saved together and sent to my manager as one week. */
export function TimeScreen() {
  const t = useT();
  const format = useFormat();
  const toast = useToast();
  const api = useApi();
  const queryClient = useQueryClient();
  const { week: weekParam } = useLocalSearchParams<{ week?: string }>();
  const [date, setDate] = useState(weekParam?.slice(0, 10) || format.today());
  const week = useMyTime(date);
  const bootstrap = useBootstrap();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<{ draft: Draft | null; day: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDrafts(toDrafts(week.data)); setDirty(false); }, [week.data]);

  const status = week.data?.timesheet?.status ?? 'draft';
  const editable = status === 'draft' || status === 'returned';
  const today = format.today();
  const activeFrom = bootstrap.data?.employee?.activeFrom ?? '0000-00-00';
  const total = drafts.reduce((sum, entry) => sum + entry.minutes, 0);
  const options = week.data?.options ?? [];
  const store = (next: MyTimeWeek) => queryClient.setQueryData(hrmsKeys.time(api.workspaceId, date), next);

  const save = async () => {
    if (!week.data) return;
    setSaving(true);
    try {
      const next = await api.send<MyTimeWeek>(`hrms/time/weeks/${week.data.weekStart}`, 'PUT', {
        version: week.data.timesheet?.version ?? 0,
        entries: drafts.map((entry) => ({ workDate: entry.workDate, projectId: entry.projectId, stageId: entry.stageId, minutes: entry.minutes, note: entry.note })),
      });
      store(next);
      toast.success(t('Saved'));
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
    finally { setSaving(false); }
  };
  const submit = async () => {
    const sheet = week.data?.timesheet;
    if (!sheet) return;
    setSaving(true);
    try {
      await api.send(`hrms/time/${sheet.id}/submit`, 'POST', { version: sheet.version });
      await week.refetch();
      toast.success(t('Sent to your manager'));
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
    finally { setSaving(false); }
  };

  const weekStart = week.data?.weekStart ?? date;
  const footer = !editable ? null : dirty
    ? <Button label={t('Save')} variant="primary" size="lg" full loading={saving} onPress={save} />
    : week.data?.timesheet && total > 0 ? <Button label={t('Send week')} variant="primary" size="lg" full loading={saving} onPress={submit} /> : null;

  return <Screen title={t('My time')} back footer={footer} onRefresh={() => void week.refetch()} refreshing={week.isRefetching}
    below={<Row style={{ justifyContent: 'space-between' }}>
      <IconButton icon={ChevronLeft} directional label={t('Previous week')} onPress={() => setDate(addDays(weekStart, -7))} />
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text variant="label">{t('Week of {day}', { day: format.day(weekStart) })}</Text>
        <Text variant="caption" tone="secondary">{format.duration(total)}</Text>
      </View>
      <IconButton icon={ChevronRight} directional label={t('Next week')} onPress={() => setDate(addDays(weekStart, 7))} disabled={addDays(weekStart, 7) > today} />
    </Row>}>
    {week.isLoading ? <Loading count={5} /> : week.error ? <Failure message={errorMessage(week.error, t('Your week could not be loaded.'))} onRetry={() => void week.refetch()} /> : <>
      {week.data?.timesheet ? <Row gap={2}><StatusChip status={status} />{week.data.timesheet.decisionNote ? <Text variant="caption" tone="secondary" style={{ flex: 1 }} numberOfLines={2}>{week.data.timesheet.decisionNote}</Text> : null}</Row> : null}
      {status === 'returned' ? <Banner tone="warning" title={t('Sent back to you')} detail={week.data?.timesheet?.decisionNote} /> : null}
      {(week.data?.days ?? []).map((day) => {
        const entries = drafts.filter((entry) => entry.workDate === day.date);
        const open = editable && day.date <= today && day.date >= activeFrom;
        const minutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
        // A day that can't take time and has none is one quiet line, not a card.
        if (!open && !entries.length) return <Row key={day.date} style={{ justifyContent: 'space-between', paddingHorizontal: 4 }}>
          <Text variant="overline" tone="tertiary">{format.weekday(day.date)}</Text>
          <Text variant="caption" tone="tertiary">{day.leaveDays ? t('Leave') : day.date > today ? t('Not yet') : '—'}</Text>
        </Row>;
        return <Section key={day.date} title={`${format.weekday(day.date)}${minutes ? ` · ${format.duration(minutes)}` : ''}`}
          action={day.leaveDays ? <Text variant="caption" tone="secondary">{t('Leave')}</Text> : undefined}>
          {entries.map((entry, index) => <ListRow key={entry.key} first={index === 0} title={entry.projectName ?? options.find((option) => option.id === entry.projectId)?.name ?? t('Internal work')}
            detail={[entry.stageName ?? options.find((option) => option.id === entry.projectId)?.stages.find((stage) => stage.id === entry.stageId)?.name, entry.note].filter(Boolean).join(' · ')}
            trailing={<Text variant="label" style={{ fontVariant: ['tabular-nums'] }}>{format.duration(entry.minutes)}</Text>}
            onPress={open ? () => setEditing({ draft: entry, day: day.date }) : undefined} />)}
          {open ? <ListRow first={!entries.length} icon={Plus} iconTone="action" title={t('Add time')} onPress={() => setEditing({ draft: null, day: day.date })} /> : null}
        </Section>;
      })}
    </>}
    <EntrySheet state={editing} options={options} onClose={() => setEditing(null)}
      onSave={(entry) => { setDrafts((list) => { const rest = list.filter((item) => item.key !== entry.key); return [...rest, entry]; }); setDirty(true); setEditing(null); }}
      onDelete={(key) => { setDrafts((list) => list.filter((item) => item.key !== key)); setDirty(true); setEditing(null); }} />
  </Screen>;
}

function EntrySheet({ state, options, onClose, onSave, onDelete }: {
  state: { draft: Draft | null; day: string } | null; options: MyTimeWeek['options']; onClose: () => void; onSave: (entry: Draft) => void; onDelete: (key: string) => void;
}) {
  const t = useT();
  const format = useFormat();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [hours, setHours] = useState('1');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!state) return;
    setProjectId(state.draft?.projectId ?? null);
    setStageId(state.draft?.stageId ?? null);
    setHours(state.draft ? String(Math.round((state.draft.minutes / 60) * 100) / 100) : '1');
    setNote(state.draft?.note ?? '');
  }, [state]);
  const project = options.find((option) => option.id === projectId);
  const minutes = Math.round(Number(hours || 0) * 60);
  const valid = minutes >= 1 && minutes <= 1440;
  const INTERNAL = '__internal__';
  return <Sheet open={!!state} onClose={onClose} title={state ? format.weekday(state.day) : ''}
    footer={<>
      <Button label={t('Done')} variant="primary" size="lg" full disabled={!valid} onPress={() => state && onSave({
        key: state.draft?.key ?? `${Date.now()}`, workDate: state.day, projectId, stageId: projectId ? stageId : null, minutes, note: note.trim().slice(0, 500),
        projectName: project?.name ?? null, stageName: project?.stages.find((stage) => stage.id === stageId)?.name ?? null,
      })} />
      {state?.draft ? <Button label={t('Remove')} variant="ghost" full onPress={() => onDelete(state.draft!.key)} /> : null}
    </>}>
    <SelectField label={t('Project')} value={projectId ?? INTERNAL} onChange={(value) => { setProjectId(value === INTERNAL ? null : value); setStageId(null); }}
      options={[{ value: INTERNAL, label: t('Internal work') }, ...options.map((option) => ({ value: option.id, label: option.name }))]} />
    {project?.stages.length ? <SelectField label={t('Stage')} value={stageId} onChange={setStageId} allowClear placeholder={t('Optional')}
      options={project.stages.map((stage) => ({ value: stage.id, label: stage.name }))} /> : null}
    <Stepper label={t('Hours')} value={hours} onChange={setHours} step={0.5} min={0} max={24} unit={t('h')} />
    <TextField label={t('Note')} value={note} onChangeText={setNote} placeholder={t('Optional')} maxLength={500} />
  </Sheet>;
}
