import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter, type Href } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Camera, ClipboardList, FolderKanban, ImagePlus, Ruler, TriangleAlert } from 'lucide-react-native';
import { errorMessage } from '../../core/api';
import { key, useT } from '../../core/i18n';
import { choosePhotos, MediaPermissionError, openSettings, takePhoto, type LocalPhoto } from '../../core/media';
import { useOutbox } from '../../core/outbox';
import { useSession } from '../../core/session';
import { OptionSheet, SegmentedControl, SelectField, TextField } from '../../ui/fields';
import { Empty, ListRow, ListScreen, Screen, Section } from '../../ui/layout';
import { PhotoGrid } from '../../ui/photos';
import { Button, Row, Text } from '../../ui/primitives';
import { StatusChip } from '../../ui/status';
import { afterTransition } from '../../ui/sequence';
import { useToast } from '../../ui/toast';
import { useProjects } from '../projects/api';
import type { ReportPhotosPayload } from '../projects/outbox';
import { useCases } from '../survey/api';
import { useCaseRooms } from '../survey/rooms';
import { itemsIn, photoNoteCapture } from './capture-model';
import { photoHandoff } from './handoff';
import { useMarkup } from './use-markup';

type Destination = 'report' | 'snag' | 'survey';
const DESTINATION: Record<Destination, { label: string; icon: typeof Camera }> = {
  report: { label: key('Today’s report'), icon: ClipboardList }, snag: { label: key('New snag'), icon: TriangleAlert }, survey: { label: key('Site survey'), icon: Ruler },
};

/**
 * A site photo in under a minute: the camera opens straight away, draw on it if needed, then say where it
 * goes (today's report, a new snag, or a planning case's survey, by room and item). Saved on the phone first and
 * sent when there is a connection; the rooms known on the phone can be chosen offline.
 */
export function PhotoCaptureScreen() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const navigation = useNavigation();
  const outbox = useOutbox();
  const markup = useMarkup();
  const session = useSession();
  const params = useLocalSearchParams<{ caseId?: string; projectId?: string }>();
  const projectsOn = session.has('projects') && session.can('projects.view', 'projects.manage');
  const surveyOn = session.has('pre-project') && session.can('pre_projects.edit');
  const options = ([projectsOn ? 'report' : null, projectsOn ? 'snag' : null, surveyOn ? 'survey' : null].filter(Boolean) as Destination[]);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [destination, setDestination] = useState<Destination>(params.caseId ? 'survey' : options[0] ?? 'report');
  const [target, setTarget] = useState<string | null>(params.caseId ?? params.projectId ?? null);
  const [picking, setPicking] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const rooms = useCaseRooms(destination === 'survey' ? target : null);
  const roomItems = itemsIn(rooms.snapshot, roomId);
  useEffect(() => { setRoomId(null); setEntryId(null); }, [target, destination]);
  const projects = useProjects();
  const cases = useCases('');
  const shoot = async () => {
    try { const photo = await takePhoto(); if (photo) setPhotos((list) => [...list, photo].slice(0, 10)); }
    catch (error) {
      if (error instanceof MediaPermissionError) toast.show(t('Allow camera access in Settings to take photos.'), 'error', { label: t('Settings'), onPress: openSettings });
      else toast.error(t('The photo could not be added. Try again.'));
    }
  };
  const library = async () => {
    try { const picked = await choosePhotos(10 - photos.length); setPhotos((list) => [...list, ...picked].slice(0, 10)); }
    catch (error) { if (error instanceof MediaPermissionError) toast.show(t('Allow photo access in Settings to choose photos.'), 'error', { label: t('Settings'), onPress: openSettings }); }
  };
  // The camera opens by itself, but only once this screen's push has finished: presented mid-transition (or on the
  // closing capture sheet) the camera is torn down with it and iOS stops taking taps.
  useEffect(() => afterTransition(navigation, () => { void shoot(); }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeProjects = (projects.data?.projects ?? []).filter((project) => project.status === 'active' || project.status === 'on_hold');
  const openCases = (cases.data?.items ?? []).filter((item) => item.status !== 'qualified' && !['cancelled', 'archived'].includes(item.status));
  const targets = destination === 'survey' ? openCases.map((item) => ({ value: item.id, label: item.customerName ?? item.title, detail: item.title }))
    : activeProjects.map((project) => ({ value: project.id, label: project.name, detail: `${project.reference} · ${project.clientName}` }));
  useEffect(() => { if (!target && targets.length === 1) setTarget(targets[0].value); }, [targets.length, target]); // eslint-disable-line react-hooks/exhaustive-deps
  const targetLabel = targets.find((item) => item.value === target)?.label;

  const save = async () => {
    if (!target || !photos.length) return;
    const files = photos.map((photo) => ({ key: photo.id, uri: photo.uri, name: photo.name, type: photo.type }));
    try {
      if (destination === 'snag') {
        photoHandoff.give(photos);
        router.replace(`/projects/${target}/snag-new`);
        return;
      }
      if (destination === 'report') {
        const payload: ReportPhotosPayload = { projectId: target, newReportId: Crypto.randomUUID(), photoIds: photos.map((photo) => photo.id) };
        await outbox.enqueue({ id: Crypto.randomUUID(), kind: 'site.report-photos', title: t('Site photos · {name}', { name: targetLabel ?? '' }), scope: `project:${target}`, payload }, files);
      } else {
        const room = rooms.snapshot?.rooms.find((entry) => entry.id === roomId);
        const item = roomItems.find((entry) => entry.id === entryId);
        const capture = photoNoteCapture({
          operationId: Crypto.randomUUID(), recordId: Crypto.randomUUID(), caseId: target, photos: photos.map((photo) => ({ id: photo.id, uri: photo.uri, name: photo.name, type: photo.type })),
          title: title.trim() || [room?.name, item?.title].filter(Boolean).join(' · ') || t('Site photo'), note, roomId, entryId,
          listTitle: t('Photo note · {name}', { name: [targetLabel, room?.name].filter(Boolean).join(' · ') }),
        });
        await outbox.enqueue(capture.item, capture.files);
      }
      toast.success(t('Photos saved'));
      router.back();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };

  if (!options.length) return <Screen back title={t('Site photo')}><Empty title={t('Nowhere to file photos yet')} detail={t('Ask your administrator for access to projects or site surveys.')} /></Screen>;
  return <Screen back title={t('Site photo')} keyboard
    footer={<Button label={destination === 'snag' ? t('Continue') : t('Save')} variant="primary" size="lg" full disabled={!photos.length || !target} onPress={save} />}>
    <PhotoGrid photos={photos.map((photo) => ({ key: photo.id, uri: photo.uri }))} onRemove={(id) => setPhotos((list) => list.filter((photo) => photo.id !== id))}
      onDraw={(item) => { const photo = photos.find((entry) => entry.id === item.key); if (photo) markup(photo, (drawn) => setPhotos((list) => list.map((entry) => (entry.id === photo.id ? drawn : entry)))); }} />
    <Row gap={2}>
      <View style={{ flex: 1 }}><Button label={t('Take photo')} icon={Camera} full onPress={shoot} /></View>
      <View style={{ flex: 1 }}><Button label={t('Library')} icon={ImagePlus} full onPress={library} /></View>
    </Row>
    {photos.length ? <Text variant="caption" tone="secondary">{t('Tap a photo to draw on it.')}</Text> : null}
    {options.length > 1 ? <SegmentedControl label={t('Where does it go?')} value={destination} onChange={(value) => { setDestination(value); setTarget(null); }}
      options={options.map((value) => ({ value, label: t(DESTINATION[value].label) }))} /> : null}
    <Section>
      <ListRow first icon={destination === 'survey' ? Ruler : FolderKanban} title={targetLabel ?? (destination === 'survey' ? t('Choose a case') : t('Choose a project'))} onPress={() => setPicking(true)} />
    </Section>
    {destination === 'survey' && target ? <>
      <SelectField label={t('Room')} value={roomId} onChange={(value) => { setRoomId(value); setEntryId(null); }} allowClear placeholder={rooms.snapshot?.rooms.length ? t('Choose a room') : t('No room')}
        options={(rooms.snapshot?.rooms ?? []).map((room) => ({ value: room.id, label: room.name }))} disabled={!rooms.snapshot?.rooms.length} />
      {roomItems.length ? <SelectField label={t('Item')} value={entryId} onChange={setEntryId} allowClear placeholder={t('The whole room')}
        options={roomItems.map((item) => ({ value: item.id, label: item.title }))} /> : null}
    </> : null}
    {destination === 'survey' ? <>
      <TextField label={t('What it shows')} value={title} onChangeText={setTitle} maxLength={240} placeholder={t('e.g. Damp patch by the window')} />
      <TextField label={t('Note')} value={note} onChangeText={setNote} multiline maxLength={6000} placeholder={t('Optional')} />
    </> : null}
    <OptionSheet open={picking} onClose={() => setPicking(false)} title={destination === 'survey' ? t('Case') : t('Project')} options={targets} value={target}
      onChange={(value) => { setTarget(value); setPicking(false); }} />
  </Screen>;
}

const PICK: Record<string, { title: string; href: (projectId: string) => Href }> = {
  report: { title: key('Daily report'), href: (id) => `/projects/${id}/report` },
  'crew-day': { title: key('Crew day'), href: (id) => ({ pathname: '/crew-day/[id]', params: { id: 'new', projectId: id } }) },
  snag: { title: key('Raise snag'), href: (id) => `/projects/${id}/snag-new` },
  expense: { title: key('Expense'), href: (id) => `/projects/${id}/expenses` },
};

/** Which project a quick capture is for; with one running project it goes straight there. */
export function PickProjectScreen() {
  const t = useT();
  const router = useRouter();
  const { action } = useLocalSearchParams<{ action: string }>();
  const projects = useProjects();
  const pick = PICK[action] ?? PICK.report;
  const running = (projects.data?.projects ?? []).filter((project) => project.status === 'active' || (action === 'report' && project.status === 'on_hold'));
  useEffect(() => { if (projects.data && running.length === 1) router.replace(pick.href(running[0].id)); }, [projects.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return <ListScreen title={t(pick.title)} subtitle={t('Which project?')} back items={running} keyExtractor={(project) => project.id}
    loading={projects.isLoading} error={projects.error ? errorMessage(projects.error, t('Projects could not be loaded.')) : null} onRetry={() => void projects.refetch()}
    onRefresh={() => void projects.refetch()} refreshing={projects.isRefetching}
    empty={<Empty icon={FolderKanban} title={t('No running projects')} />}
    renderItem={(project, _, first) => <ListRow first={first} title={project.name} detail={`${project.reference} · ${project.clientName}`} trailing={<StatusChip status={project.health} />}
      onPress={() => router.replace(pick.href(project.id))} />} />;
}
