import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Camera, ListChecks, Plus, Ruler, Trash2 } from 'lucide-react-native';
import { errorMessage, useApi } from '../../core/api';
import { useFormat } from '../../core/format';
import { key, useT } from '../../core/i18n';
import type { LocalPhoto } from '../../core/media';
import { useOutbox, usePending } from '../../core/outbox';
import { useSession } from '../../core/session';
import { OptionSheet, SearchField, SegmentedControl, SelectField, TextField, cleanDecimal } from '../../ui/fields';
import { Banner, Card, Empty, Failure, ListRow, ListScreen, Loading, Screen, Section } from '../../ui/layout';
import { PhotoGrid } from '../../ui/photos';
import { Button, Chip, IconButton, Row, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { useMarkup } from '../capture/use-markup';
import { assetPath, surveyKeys, useBrief, useCase, useCases, useDesignJourney, useSurvey } from './api';
import { askedGroups, draftsFrom, isAnswered, requiredLeft } from './questions-model';
import { areaAndVolume, parseMeasure, toDimensions, UNITS, type Basis, type Unit } from './measure-model';
import type { MeasurementPayload } from './outbox';

const BASIS: Array<{ value: Basis; label: string }> = [{ value: 'site_opening', label: key('Opening') }, { value: 'finished_item', label: key('Finished item') }, { value: 'fabrication', label: key('Fabrication') }];
const SITE_STATUS: Record<string, string> = { incomplete: 'draft', measured: 'submitted', verified: 'approved', recheck: 'returned', open: 'open', resolved: 'done', planned: 'planned', completed: 'completed', cancelled: 'cancelled' };
const UNIT_KEY = 'wodana.measure-unit.v1';

/** Cases to survey: the planning cases I can see, searchable. */
export function CasesScreen({ pickFor }: { pickFor?: 'measure' | 'photo' }) {
  const t = useT();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const cases = useCases(debounced);
  const rows = (cases.data?.items ?? []).filter((item) => item.status !== 'qualified' && !['cancelled', 'archived'].includes(item.status));
  return <ListScreen title={pickFor === 'measure' ? t('Measurement') : t('Site survey')} back items={rows} keyExtractor={(item) => item.id}
    toolbar={<SearchField value={search} onChange={setSearch} placeholder={t('Client or case')} />}
    loading={cases.isLoading} error={cases.error ? errorMessage(cases.error, t('Cases could not be loaded.')) : null} onRetry={() => void cases.refetch()}
    onRefresh={() => void cases.refetch()} refreshing={cases.isRefetching}
    empty={<Empty icon={Ruler} title={t('No cases here')} />}
    renderItem={(item, _, first) => <ListRow first={first} title={item.customerName ?? item.title} detail={[item.reference, item.title].filter(Boolean).join(' · ')}
      trailing={<StatusChip status={item.status} />}
      onPress={() => (pickFor === 'measure' ? router.replace(`/survey/${item.id}/measure`) : router.push(`/survey/${item.id}`))} />} />;
}

/** A case's site survey: measurements by room, photo notes, and adding either from the phone. */
export function SurveyScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const { caseId } = useLocalSearchParams<{ caseId: string }>();
  const session = useSession();
  const canEdit = session.can('pre_projects.edit');
  const detail = useCase(caseId);
  const site = useSurvey(caseId);
  const pending = usePending(`case:${caseId}`);
  const records = site.data?.items ?? [];
  const measurements = records.filter((record) => record.kind === 'measurement');
  const notes = records.filter((record) => record.kind === 'observation');
  const visits = records.filter((record) => record.kind === 'visit' && record.status === 'planned');
  // The firm's site questions as this job carries them: how many are answered, and how many required are left.
  const journey = useDesignJourney(caseId);
  const questionGroups = journey.data ? askedGroups(journey.data) : [];
  const asked = questionGroups.flatMap((group) => group.questions);
  const saved = draftsFrom(journey.data?.checklist ?? []);
  const requiredOpen = requiredLeft(questionGroups, saved);
  if (detail.isLoading || site.isLoading) return <Screen back><Loading shape="record" count={4} /></Screen>;
  if (detail.error || site.error) return <Screen back><Failure message={errorMessage(detail.error ?? site.error, t('This case could not be loaded.'))} onRetry={() => { void detail.refetch(); void site.refetch(); }} /></Screen>;
  return <Screen back title={detail.data?.customerName ?? detail.data?.title ?? t('Site survey')} subtitle={detail.data?.title}
    onRefresh={() => void site.refetch()} refreshing={site.isRefetching}
    footer={canEdit ? <Row gap={2}>
      <Button label={t('Add photo')} icon={Camera} variant="secondary" size="lg" onPress={() => router.push({ pathname: '/capture/photo', params: { caseId } })} />
      <View style={{ flex: 1 }}><Button label={t('Measure')} icon={Ruler} variant="primary" size="lg" full onPress={() => router.push(`/survey/${caseId}/measure`)} /></View>
    </Row> : undefined}>
    {pending.length ? <Banner tone="info" title={t('{count} waiting to send', { count: pending.length })} action={{ label: t('View'), onPress: () => router.push('/outbox') }} /> : null}
    {visits.length ? <Section title={t('Visits')}>
      {visits.map((visit, index) => <ListRow key={visit.id} first={index === 0} title={visit.title} detail={[visit.scheduledAt ? format.when(visit.scheduledAt) : null, visit.assigneeName, visit.location].filter(Boolean).join(' · ')} />)}
    </Section> : null}
    {asked.length ? <Section>
      <ListRow first icon={ListChecks} title={t('Questions')}
        detail={t('{answered} of {total} answered', { answered: asked.filter((item) => isAnswered(item, saved[item.key])).length, total: asked.length })}
        trailing={requiredOpen ? <Chip tone="warning" label={t('{count} required', { count: requiredOpen })} /> : undefined}
        onPress={() => router.push(`/survey/${caseId}/questions`)} />
    </Section> : null}
    <Section title={t('Measurements')}>
      {measurements.length ? measurements.map((record, index) => <ListRow key={record.id} first={index === 0} icon={Ruler} title={record.title || record.roomName || t('Measurement')}
        detail={[record.roomName, record.entryTitle, (record.dimensions ?? []).map((dimension) => `${dimension.name} ${dimension.measured ?? dimension.approximate ?? '—'} ${dimension.unit}`).join(', ')].filter(Boolean).join(' · ')}
        trailing={<StatusChip status={SITE_STATUS[record.status] ?? record.status} label={record.status === 'measured' ? t('To verify') : record.status === 'recheck' ? t('Recheck') : undefined} />}
        onPress={() => router.push({ pathname: '/survey/[caseId]/measure', params: { caseId, record: record.id } })} />)
        : <ListRow first title={t('No measurements yet')} />}
    </Section>
    {notes.length ? <Section title={t('Photo notes')}>
      {notes.map((record, index) => <View key={record.id}>
        <ListRow first={index === 0} title={record.title} detail={[record.roomName, record.note].filter(Boolean).join(' · ')} trailing={<StatusChip status={record.status} />} />
        {record.assets.length ? <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}><PhotoGrid columns={4} photos={record.assets.filter((asset) => asset.hasPreview).map((asset) => ({ key: asset.id, path: assetPath(caseId, asset.id) }))} /></View> : null}
      </View>)}
    </Section> : null}
  </Screen>;
}

type DimensionRow = { id: string; name: string; value: string };
const defaultRows = (t: (text: string) => string): DimensionRow[] => [
  { id: Crypto.randomUUID(), name: t('Length'), value: '' }, { id: Crypto.randomUUID(), name: t('Width'), value: '' }, { id: Crypto.randomUUID(), name: t('Height'), value: '' },
];

/** Measure a room or an item: length, width and height (and any other dimension), with photos. Works offline. */
export function MeasureScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const api = useApi();
  const outbox = useOutbox();
  const markup = useMarkup();
  const session = useSession();
  const queryClient = useQueryClient();
  const { caseId, record: recordId } = useLocalSearchParams<{ caseId: string; record?: string }>();
  const brief = useBrief(caseId);
  const site = useSurvey(caseId);
  const existing = site.data?.items.find((item) => item.id === recordId);
  const id = useRef(recordId ?? Crypto.randomUUID()).current;
  const [roomId, setRoomId] = useState<string | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [unit, setUnit] = useState<Unit>('mm');
  const [basis, setBasis] = useState<Basis>('site_opening');
  const [rows, setRows] = useState<DimensionRow[]>(() => defaultRows(t));
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [addingRoom, setAddingRoom] = useState(false);
  const [unitMenu, setUnitMenu] = useState(false);
  const loaded = useRef(false);
  useEffect(() => { void AsyncStorage.getItem(UNIT_KEY).then((saved) => { if (saved && (UNITS as string[]).includes(saved) && !existing) setUnit(saved as Unit); }).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!existing || loaded.current) return;
    loaded.current = true;
    setRoomId(existing.roomId); setEntryId(existing.entryId); setTitle(existing.title); setNote(existing.note);
    const dimensions = existing.dimensions ?? [];
    if (dimensions.length) {
      setUnit((dimensions[0].unit as Unit) ?? 'mm'); setBasis((dimensions[0].basis as Basis) ?? 'site_opening');
      setRows(dimensions.map((dimension) => ({ id: dimension.id, name: dimension.name, value: String(dimension.measured ?? dimension.approximate ?? '') })));
    }
  }, [existing]);
  const rooms = brief.data?.rooms ?? [];
  const entries = (brief.data?.entries ?? []).filter((entry) => entry.kind === 'requirement' && !entry.archivedAt && (!roomId || entry.roomId === roomId));
  const byName = (name: string) => rows.find((row) => row.name.toLowerCase() === name.toLowerCase())?.value;
  const totals = areaAndVolume({ length: byName(t('Length')), width: byName(t('Width')), height: byName(t('Height')) }, unit);
  const dimensions = toDimensions(rows, unit, basis);
  const invalid = rows.some((row) => row.value && parseMeasure(row.value) === null);
  const lockedPlace = !!existing;
  const ready = dimensions.length > 0 && !invalid && (!!roomId || !!entryId);
  const save = async () => {
    const room = rooms.find((item) => item.id === roomId);
    const payload: MeasurementPayload = {
      caseId, photoIds: photos.map((photo) => photo.id),
      record: { id, title: (title.trim() || [room?.name, entries.find((entry) => entry.id === entryId)?.title].filter(Boolean).join(' · ') || t('Measurement')).slice(0, 240), note: note.slice(0, 6000), roomId, entryId, dimensions },
    };
    try {
      void AsyncStorage.setItem(UNIT_KEY, unit).catch(() => undefined);
      await outbox.enqueue({ id: Crypto.randomUUID(), kind: 'survey.measurement', title: t('Measurement · {title}', { title: payload.record.title }), scope: `case:${caseId}`, payload },
        photos.map((photo) => ({ key: photo.id, uri: photo.uri, name: photo.name, type: photo.type })));
      toast.success(t('Measurement saved'));
      router.back();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  const addRoom = async (name: string) => {
    try {
      const roomIdNew = Crypto.randomUUID();
      await api.send(`pre-projects/${caseId}/rooms`, 'PUT', { id: roomIdNew, version: 0, name: name.slice(0, 120) });
      await queryClient.invalidateQueries({ queryKey: surveyKeys.brief(api.workspaceId, caseId) });
      setRoomId(roomIdNew); setAddingRoom(false);
    } catch (error) { toast.error(errorMessage(error, t('Rooms need a connection. Try again.'))); }
  };
  if (brief.isLoading || site.isLoading) return <Screen back title={t('Measurement')}><Loading shape="form" count={5} /></Screen>;
  if (brief.error) return <Screen back title={t('Measurement')}><Failure message={errorMessage(brief.error, t('This case could not be loaded.'))} onRetry={() => void brief.refetch()} /></Screen>;
  const canEdit = brief.data?.canEdit !== false && session.can('pre_projects.edit');
  return <Screen back title={existing ? existing.title || t('Measurement') : t('Measurement')} keyboard
    footer={canEdit ? <Button label={t('Save measurement')} variant="primary" size="lg" full disabled={!ready} onPress={save} /> : undefined}>
    {existing?.status === 'recheck' && existing.reviewNote ? <Banner tone="warning" title={t('Recheck needed')} detail={existing.reviewNote} /> : null}
    <SelectField label={t('Room')} value={roomId} onChange={(value) => { setRoomId(value); setEntryId(null); }} disabled={lockedPlace} placeholder={t('Choose a room')}
      options={rooms.map((room) => ({ value: room.id, label: room.name }))} />
    {!lockedPlace && canEdit ? <Button size="sm" variant="ghost" icon={Plus} label={t('New room')} onPress={() => setAddingRoom(true)} /> : null}
    {entries.length ? <SelectField label={t('Item')} value={entryId} onChange={setEntryId} allowClear placeholder={t('The whole room')} disabled={lockedPlace}
      options={entries.map((entry) => ({ value: entry.id, label: entry.title, detail: entry.roomName ?? undefined }))} /> : null}
    <SegmentedControl label={t('Measuring')} value={basis} onChange={setBasis} options={BASIS.map((option) => ({ value: option.value, label: t(option.label) }))} />
    <Section title={t('Dimensions')} action={<Button size="sm" variant="ghost" label={unit} onPress={() => setUnitMenu(true)} />}>
      {rows.map((row, index) => <View key={row.id} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(2), paddingStart: theme.space(4), paddingEnd: theme.space(2), paddingVertical: theme.space(2), borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.structuralDivider }}>
        <View style={{ flex: 1 }}><TextField value={row.name} onChangeText={(name) => setRows((list) => list.map((item) => (item.id === row.id ? { ...item, name } : item)))} maxLength={120} accessibilityLabel={t('Name')} /></View>
        <View style={{ width: 120 }}><TextField value={row.value} onChangeText={(value) => setRows((list) => list.map((item) => (item.id === row.id ? { ...item, value: cleanDecimal(value, 4) } : item)))}
          keyboardType="decimal-pad" placeholder="0" accessibilityLabel={row.name} error={row.value && parseMeasure(row.value) === null ? ' ' : undefined} trailing={<Text variant="caption" tone="secondary">{unit}</Text>} /></View>
        <IconButton icon={Trash2} label={t('Remove')} size={40} onPress={() => setRows((list) => list.filter((item) => item.id !== row.id))} />
      </View>)}
      <ListRow icon={Plus} iconTone="action" title={t('Add a dimension')} onPress={() => setRows((list) => [...list, { id: Crypto.randomUUID(), name: '', value: '' }].slice(0, 40))} />
    </Section>
    {totals.area !== null ? <Card tone="muted" style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
      <View style={{ alignItems: 'center' }}><Text variant="number">{totals.area}</Text><Text variant="caption" tone="secondary">{totals.areaUnit}</Text></View>
      {totals.volume !== null ? <View style={{ alignItems: 'center' }}><Text variant="number">{totals.volume}</Text><Text variant="caption" tone="secondary">{totals.volumeUnit}</Text></View> : null}
    </Card> : null}
    <TextField label={t('Title')} value={title} onChangeText={setTitle} maxLength={240} placeholder={t('Optional')} />
    <Section flat title={t('Photos')}>
      <PhotoGrid photos={[...(existing?.assets ?? []).filter((asset) => asset.hasPreview).map((asset) => ({ key: asset.id, path: assetPath(caseId, asset.id) })), ...photos.map((photo) => ({ key: photo.id, uri: photo.uri }))]}
        onAdd={canEdit ? (next) => setPhotos((list) => [...list, ...next].slice(0, 20)) : undefined} onRemove={(key) => setPhotos((list) => list.filter((photo) => photo.id !== key))}
        onDraw={(item) => { const photo = photos.find((entry) => entry.id === item.key); if (photo) markup(photo, (drawn) => setPhotos((list) => list.map((entry) => (entry.id === photo.id ? drawn : entry)))); }} />
    </Section>
    <TextField label={t('Note')} value={note} onChangeText={setNote} multiline maxLength={6000} placeholder={t('Optional')} />
    <OptionSheet open={unitMenu} onClose={() => setUnitMenu(false)} title={t('Unit')} value={unit} options={UNITS.map((value) => ({ value, label: value }))}
      onChange={(value) => { if (value) setUnit(value); setUnitMenu(false); }} />
    <NewRoomSheet open={addingRoom} onClose={() => setAddingRoom(false)} onAdd={addRoom} />
  </Screen>;
}

function NewRoomSheet({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (name: string) => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setName(''); }, [open]);
  return <Sheet open={open} onClose={onClose} title={t('New room')}
    footer={<Button label={t('Add')} variant="primary" size="lg" full loading={busy} disabled={!name.trim()} onPress={async () => { setBusy(true); try { await onAdd(name.trim()); } finally { setBusy(false); } }} />}>
    <TextField label={t('Name')} value={name} onChangeText={setName} autoFocus maxLength={120} placeholder={t('e.g. Master bedroom')} />
  </Sheet>;
}

