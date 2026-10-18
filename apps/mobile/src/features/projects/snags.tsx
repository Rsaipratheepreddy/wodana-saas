import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Plus, TriangleAlert } from 'lucide-react-native';
import type { Severity } from '../../../../web/lib/project-core/types';
import { errorMessage } from '../../core/api';
import { useFormat } from '../../core/format';
import { key, useT } from '../../core/i18n';
import type { LocalPhoto } from '../../core/media';
import { useOutbox } from '../../core/outbox';
import { DateField } from '../../ui/date-field';
import { FilterChips, SegmentedControl, SelectField, TextField } from '../../ui/fields';
import { Empty, ListRow, ListScreen, Loading, Screen, Section } from '../../ui/layout';
import { PhotoGrid } from '../../ui/photos';
import { Button } from '../../ui/primitives';
import { useToast } from '../../ui/toast';
import { photoHandoff } from '../capture/handoff';
import { useMarkup } from '../capture/use-markup';
import { useWorkBoard } from './api';
import type { SnagPayload } from './outbox';
import { useWorkDetail, WorkTrailing } from './plan-screen';

const SEVERITY: Array<{ value: Severity; label: string }> = [{ value: 'minor', label: key('Minor') }, { value: 'major', label: key('Major') }, { value: 'critical', label: key('Critical') }];

/** The project's snags: open ones first, by how serious they are. */
export function SnagsScreen() {
  const t = useT();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const board = useWorkBoard(id);
  const detail = useWorkDetail();
  const [state, setState] = useState<'open' | 'review' | 'closed'>('open');
  const rank = { critical: 0, major: 1, minor: 2 } as const;
  const snags = useMemo(() => (board.data?.items ?? []).filter((item) => item.type === 'snag')
    .filter((item) => (state === 'open' ? item.status === 'todo' || item.status === 'in_progress' : state === 'review' ? item.status === 'in_review' : item.status === 'done' || item.status === 'cancelled'))
    .sort((a, b) => rank[a.severity ?? 'minor'] - rank[b.severity ?? 'minor'] || a.number - b.number), [board.data, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = (areaId: string | null) => board.data?.areas.find((item) => item.id === areaId)?.name;
  return <ListScreen title={t('Snags')} back items={snags} keyExtractor={(item) => item.id}
    toolbar={<FilterChips value={state} onChange={setState} options={[{ value: 'open', label: t('Open') }, { value: 'review', label: t('In review') }, { value: 'closed', label: t('Closed') }]} />}
    loading={board.isLoading} error={board.error ? errorMessage(board.error, t('Snags could not be loaded.')) : null} onRetry={() => void board.refetch()}
    onRefresh={() => void board.refetch()} refreshing={board.isRefetching}
    empty={<Empty icon={TriangleAlert} title={state === 'open' ? t('No open snags') : t('Nothing here')} />}
    renderItem={(item, _, first) => <ListRow first={first} title={item.title} detail={[area(item.areaId), detail(item)].filter(Boolean).join(' · ')}
      trailing={<WorkTrailing item={item} />} onPress={() => router.push(`/projects/${id}/task/${item.id}`)} />}
    footer={board.data?.canEdit ? <Button label={t('Raise snag')} icon={Plus} variant="primary" size="lg" full onPress={() => router.push(`/projects/${id}/snag-new`)} /> : undefined} />;
}

/** Raise a snag from site: photos first, then what's wrong, how serious, where and who fixes it. Works offline. */
export function NewSnagScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const toast = useToast();
  const outbox = useOutbox();
  const markup = useMarkup();
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const board = useWorkBoard(projectId);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<Severity>('minor');
  const [areaId, setAreaId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [lineId, setLineId] = useState<string | null>(null);
  const snagId = useRef(Crypto.randomUUID()).current;
  useEffect(() => { const handed = photoHandoff.take(); if (handed.length) setPhotos(handed); }, []);
  if (board.isLoading) return <Screen back title={t('Raise snag')}><Loading shape="form" count={4} /></Screen>;
  const send = async () => {
    const payload: SnagPayload = {
      projectId, photoIds: photos.map((photo) => photo.id),
      create: { id: snagId, type: 'snag', title: title.trim(), severity, source: 'internal', ...(areaId ? { areaId } : {}), ...(assigneeId ? { assigneeId } : {}), ...(due ? { dueDate: due } : {}), ...(lineId ? { boqLineId: lineId } : {}) },
    };
    try {
      await outbox.enqueue({ id: snagId, kind: 'project.snag', title: t('Snag · {title}', { title: title.trim() }), scope: `project:${projectId}`, payload },
        photos.map((photo) => ({ key: photo.id, uri: photo.uri, name: photo.name, type: photo.type })));
      toast.success(t('Snag raised'));
      router.back();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  return <Screen back title={t('Raise snag')} keyboard
    footer={<Button label={t('Raise snag')} variant="primary" size="lg" full disabled={!title.trim()} onPress={send} />}>
    <Section flat title={t('Photos')}>
      <PhotoGrid photos={photos.map((photo) => ({ key: photo.id, uri: photo.uri }))} onAdd={(next) => setPhotos((list) => [...list, ...next].slice(0, 10))}
        onRemove={(key) => setPhotos((list) => list.filter((photo) => photo.id !== key))}
        onDraw={(item) => { const photo = photos.find((entry) => entry.id === item.key); if (photo) markup(photo, (drawn) => setPhotos((list) => list.map((entry) => (entry.id === photo.id ? drawn : entry)))); }} />
    </Section>
    <TextField label={t('What’s wrong')} value={title} onChangeText={setTitle} maxLength={300} placeholder={t('e.g. Chipped edge on kitchen island')} />
    <SegmentedControl label={t('How serious')} value={severity} onChange={setSeverity} options={SEVERITY.map((option) => ({ value: option.value, label: t(option.label) }))} />
    {board.data?.areas.length ? <SelectField label={t('Area')} value={areaId} onChange={setAreaId} allowClear placeholder={t('Optional')} options={board.data.areas.map((area) => ({ value: area.id, label: area.name }))} /> : null}
    {board.data?.people.length ? <SelectField label={t('Who fixes it')} value={assigneeId} onChange={setAssigneeId} allowClear placeholder={t('Nobody yet')}
      options={board.data.people.map((person) => ({ value: person.membershipId, label: person.name }))} /> : null}
    <DateField label={t('Fix by')} value={due} onChange={setDue} min={format.today()} placeholder={t('Optional')} />
    {board.data?.lines.length ? <SelectField label={t('Scope line')} value={lineId} onChange={setLineId} allowClear placeholder={t('Optional')}
      options={board.data.lines.map((line) => ({ value: line.id, label: line.title, detail: line.areaName ?? undefined }))} /> : null}
  </Screen>;
}
