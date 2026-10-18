import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Check, CircleDot, Send } from 'lucide-react-native';
import type { WorkDetail, WorkStatus } from '../../../../web/lib/project-core/types';
import { errorMessage } from '../../core/api';
import { useFormat } from '../../core/format';
import { key, useT } from '../../core/i18n';
import { useOutbox, usePending } from '../../core/outbox';
import { useSession } from '../../core/session';
import { ActionSheet, ReasonSheet } from '../../ui/dialogs';
import { TextField } from '../../ui/fields';
import { Banner, Failure, Fact, ListRow, Loading, Screen, Section } from '../../ui/layout';
import { PhotoGrid } from '../../ui/photos';
import { Avatar, Button, IconButton, Row, Text } from '../../ui/primitives';
import { StatusChip, statusLabel } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { useWorkBoard, useWorkCommand, useWorkItem, workPhotoPath } from './api';
import type { WorkPhotosPayload } from './outbox';
import { TYPE_LABEL } from './plan-screen';

const EVENT: Record<string, string> = {
  created: key('created it'), status: key('changed the status'), assignee: key('changed who has it'), dates: key('changed the dates'), priority: key('changed the priority'),
  photo: key('added a photo'), reopened: key('reopened it'), severity: key('changed the severity'), title: key('renamed it'),
};

/** The next step a person usually takes from each status. */
function nextStatus(item: WorkDetail): { status: WorkStatus; label: string } | null {
  if (item.status === 'todo') return { status: 'in_progress', label: key('Start') };
  if (item.status === 'in_progress') return item.type === 'snag' ? { status: 'in_review', label: key('Ready for review') } : { status: 'done', label: key('Mark done') };
  if (item.status === 'in_review') return { status: 'done', label: item.type === 'snag' ? key('Close snag') : key('Mark done') };
  return null;
}

/** A task or snag: move it on, see its steps, photos and conversation, and add to them. */
export function TaskScreen() {
  const t = useT();
  const theme = useTheme();
  const format = useFormat();
  const toast = useToast();
  const router = useRouter();
  const session = useSession();
  const outbox = useOutbox();
  const { id: projectId, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  const item = useWorkItem(projectId, taskId);
  const board = useWorkBoard(projectId);
  const command = useWorkCommand(projectId);
  const pending = usePending(`work:${taskId}`);
  const [comment, setComment] = useState('');
  const [statusMenu, setStatusMenu] = useState(false);
  const [reopening, setReopening] = useState<WorkStatus | null>(null);
  const commentId = useRef(Crypto.randomUUID());

  if (item.isLoading) return <Screen back><Loading shape="record" count={3} /></Screen>;
  if (item.error || !item.data) return <Screen back><Failure message={errorMessage(item.error, t('This task could not be loaded.'))} onRetry={() => void item.refetch()} /></Screen>;
  const work = item.data;
  const editable = !!board.data?.canEdit || (!!board.data?.aftercare && work.type === 'snag');
  const next = nextStatus(work);
  const snag = work.type === 'snag';
  const afterPhotos = work.photos.filter((photo) => photo.kind === 'after');
  const iFixed = !!work.fixedBy && work.fixedBy === session.userId;
  const closeBlocked = snag && next?.status === 'done' && (iFixed || work.assigneeId === session.membershipId || (!afterPhotos.length && !pending.some((entry) => (entry.payload as { kind?: string }).kind === 'after')));
  const subtasks = (board.data?.items ?? []).filter((entry) => entry.parentId === work.id);

  const move = async (status: WorkStatus, reason?: string) => {
    try {
      await command.mutateAsync({ action: 'update', itemId: work.id, version: work.version, status, ...(reason ? { reason } : {}) });
      toast.success(t(statusLabel(status)));
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); throw error; }
  };
  const choose = (status: WorkStatus) => {
    if (snag && work.status === 'done' && status !== 'done') { setReopening(status); return; }
    void move(status).catch(() => undefined);
  };
  const send = async () => {
    const body = comment.trim();
    if (!body) return;
    try {
      await command.mutateAsync({ action: 'comment', itemId: work.id, id: commentId.current, body });
      commentId.current = Crypto.randomUUID();
      setComment('');
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  const addPhotos = (kind: 'before' | 'after') => async (photos: Array<{ id: string; uri: string; name: string; type: string }>) => {
    const payload: WorkPhotosPayload = { projectId, itemId: work.id, kind, photoIds: photos.map((photo) => photo.id) };
    await outbox.enqueue({ id: Crypto.randomUUID(), kind: 'project.work-photos', title: kind === 'after' ? t('Photo after') : t('Photo before'), detail: work.title, scope: `work:${work.id}`, payload },
      photos.map((photo) => ({ key: photo.id, uri: photo.uri, name: photo.name, type: photo.type })));
  };
  const pendingPhotos = (kind: 'before' | 'after') => pending.filter((entry) => (entry.payload as { kind?: string }).kind === kind)
    .flatMap((entry) => entry.files.map((file) => ({ key: file.key, uri: file.encrypted ? undefined : file.uri, pending: true })));

  const footer = editable && next ? <>
    {closeBlocked ? <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
      {!afterPhotos.length ? t('Add a photo after the fix to close it.') : t('Someone other than who fixed it closes it.')}
    </Text> : null}
    <Row gap={2}>
      <View style={{ flex: 1 }}><Button label={t(next.label)} icon={next.status === 'done' ? Check : CircleDot} variant="primary" size="lg" full loading={command.isPending} disabled={closeBlocked} onPress={() => choose(next.status)} /></View>
      <Button label={t('Status')} variant="secondary" size="lg" onPress={() => setStatusMenu(true)} />
    </Row>
  </> : editable ? <Button label={t('Change status')} variant="secondary" size="lg" full onPress={() => setStatusMenu(true)} /> : undefined;

  return <Screen back title={work.title} subtitle={`#${work.number} · ${t(TYPE_LABEL[work.type])}`} footer={footer} onRefresh={() => { void item.refetch(); void board.refetch(); }} refreshing={item.isRefetching}>
    <Row gap={2} wrap>
      <StatusChip status={work.status} />
      {work.priority !== 'normal' && work.priority !== 'low' ? <StatusChip status={work.priority} /> : null}
      {work.severity ? <StatusChip status={work.severity} /> : null}
    </Row>
    {work.blockedBy.filter((ref) => ref.status !== 'done' && ref.status !== 'cancelled').length ? <Banner tone="warning" title={t('Waiting on')}
      detail={work.blockedBy.filter((ref) => ref.status !== 'done' && ref.status !== 'cancelled').map((ref) => `#${ref.number} ${ref.title}`).join(' · ')} /> : null}
    {work.assigneeAway?.length ? <Banner tone="neutral" title={t('{name} is away', { name: work.assigneeName ?? '' })} detail={work.assigneeAway.map((away) => `${format.day(away.startDate)} – ${format.day(away.endDate)}`).join(' · ')} /> : null}

    <Section>
      <Fact first label={t('Who')} value={work.assigneeName ?? t('Nobody yet')} />
      {work.startDate || work.dueDate ? <Fact label={t('When')} value={[work.startDate ? format.day(work.startDate) : null, work.dueDate ? format.day(work.dueDate) : null].filter(Boolean).join(' – ')} /> : null}
      {work.stageId ? <Fact label={t('Stage')} value={board.data?.stages.find((stage) => stage.id === work.stageId)?.name ?? '—'} /> : null}
      {work.packageId ? <Fact label={t('Package')} value={board.data?.packages.find((pack) => pack.id === work.packageId)?.name ?? '—'} /> : null}
      {work.areaId ? <Fact label={t('Area')} value={board.data?.areas.find((area) => area.id === work.areaId)?.name ?? '—'} /> : null}
      {work.boqLineId ? <Fact label={t('Scope line')} value={board.data?.lines.find((line) => line.id === work.boqLineId)?.title ?? '—'} /> : null}
    </Section>
    {work.description ? <Text tone="secondary">{work.description}</Text> : null}

    {subtasks.length ? <Section title={t('Steps · {done} of {total}', { done: subtasks.filter((entry) => entry.status === 'done').length, total: subtasks.length })}>
      {subtasks.map((entry, index) => <ListRow key={entry.id} first={index === 0} title={entry.title} detail={entry.assigneeName ?? undefined}
        accessibilityLabel={`${entry.title}, ${entry.status === 'done' ? t('Done') : t('To do')}`}
        leading={<View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: entry.status === 'done' ? 0 : 2,
          borderColor: theme.colors.borderStrong, backgroundColor: entry.status === 'done' ? theme.colors.success : 'transparent' }}>
          {entry.status === 'done' ? <Check color={theme.colors.textInverse} size={16} strokeWidth={3} /> : null}
        </View>}
        onPress={editable ? () => command.mutate({ action: 'update', itemId: entry.id, version: entry.version, status: entry.status === 'done' ? 'todo' : 'done' }, { onError: (error) => toast.error(errorMessage(error, t('Something went wrong'))) }) : undefined}
        onLongPress={() => router.push(`/projects/${projectId}/task/${entry.id}`)} />)}
    </Section> : null}

    {snag ? <>
      <Section flat title={t('Before')}>
        <PhotoGrid photos={[...work.photos.filter((photo) => photo.kind === 'before').map((photo) => ({ key: photo.id, path: workPhotoPath(projectId, photo.id) })), ...pendingPhotos('before')]}
          onAdd={editable ? addPhotos('before') : undefined} max={10} />
      </Section>
      <Section flat title={t('After')}>
        <PhotoGrid photos={[...afterPhotos.map((photo) => ({ key: photo.id, path: workPhotoPath(projectId, photo.id) })), ...pendingPhotos('after')]}
          onAdd={editable ? addPhotos('after') : undefined} max={10} addLabel={t('Photo after')} />
      </Section>
    </> : null}

    <Section title={t('Activity')}>
      {work.activity.slice(-30).map((entry, index) => entry.kind === 'comment'
        ? <ListRow key={entry.id} first={index === 0} leading={<Avatar name={entry.by} size={32} person={{ id: entry.by }} />} title={entry.by} detail={(entry as { body: string }).body}
          meta={<Text variant="caption" tone="tertiary">{format.ago(entry.at)}</Text>} />
        : <ListRow key={entry.id} first={index === 0} title={`${entry.by} ${t(EVENT[entry.kind] ?? entry.kind)}`} meta={<Text variant="caption" tone="tertiary">{format.ago(entry.at)}</Text>} />)}
      {editable || board.data?.aftercare ? <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space(2), padding: theme.space(3), borderTopWidth: work.activity.length ? 1 : 0, borderTopColor: theme.colors.structuralDivider }}>
        <View style={{ flex: 1 }}><TextField value={comment} onChangeText={setComment} placeholder={t('Write a comment')} multiline={comment.length > 40} maxLength={4000} accessibilityLabel={t('Comment')} /></View>
        <IconButton icon={Send} label={t('Send')} tone="action" filled onPress={send} disabled={!comment.trim() || command.isPending} directional />
      </View> : null}
    </Section>

    <ActionSheet open={statusMenu} onClose={() => setStatusMenu(false)} title={t('Status')}
      actions={(['todo', 'in_progress', 'in_review', 'done', 'cancelled'] as WorkStatus[]).filter((status) => status !== work.status && (status !== 'in_review' || snag))
        .map((status) => ({ label: t(statusLabel(status)), onPress: () => choose(status) }))} />
    <ReasonSheet open={!!reopening} onClose={() => setReopening(null)} title={t('Reopen this snag?')} label={t('Why')} action={t('Reopen')}
      onSubmit={(reason) => (reopening ? move(reopening, reason) : undefined)} />
  </Screen>;
}

