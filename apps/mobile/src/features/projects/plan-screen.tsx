import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Ban, ListChecks, Plus, TriangleAlert } from 'lucide-react-native';
import type { OpenWorkItem, WorkItem, WorkStatus, WorkType } from '../../../../web/lib/project-core/types';
import { errorMessage } from '../../core/api';
import { useFormat } from '../../core/format';
import { key, useT } from '../../core/i18n';
import { DateField } from '../../ui/date-field';
import { FilterChips, SegmentedControl, SelectField, TextField } from '../../ui/fields';
import { Empty, ListRow, ListScreen } from '../../ui/layout';
import { Button, Chip, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { statusLabel } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { useOpenWork, useWorkBoard, useWorkCommand } from './api';
import { inPlanFilter, planFilterOf, type PlanFilter } from './overview-model';

const ORDER: WorkStatus[] = ['in_progress', 'todo', 'in_review', 'done', 'cancelled'];
export const TYPE_LABEL: Record<WorkType, string> = { task: key('Task'), blocker: key('Blocker'), client_request: key('Client request'), snag: key('Snag') };

/** One line of detail for a piece of work: its number, due date and who has it. */
export function useWorkDetail() {
  const t = useT();
  const format = useFormat();
  return (item: WorkItem, withProject?: string) => [withProject, `#${item.number}`, item.dueDate ? t('due {day}', { day: format.day(item.dueDate) }) : null, item.assigneeName]
    .filter(Boolean).join(' · ');
}

export function WorkTrailing({ item }: { item: WorkItem }) {
  const t = useT();
  const format = useFormat();
  const open = item.status !== 'done' && item.status !== 'cancelled';
  if (open && item.dueDate && item.dueDate < format.today()) return <Chip label={t('Late')} tone="danger" />;
  if (item.type === 'snag' && item.severity && item.severity !== 'minor') return <Chip label={t(statusLabel(item.severity))} tone={item.severity === 'critical' ? 'danger' : 'warning'} icon={TriangleAlert} />;
  if (item.type === 'blocker') return <Chip label={t('Blocker')} tone="danger" icon={Ban} />;
  if (item.blockedBy.some((ref) => ref.status !== 'done' && ref.status !== 'cancelled')) return <Chip label={t('Waiting')} tone="warning" />;
  return <View />;
}

/** The plan: my work or everyone's on this project, by status; a task opens to update it. Late, blocked and snags are one tap. */
export function PlanScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const { id, filter: linked } = useLocalSearchParams<{ id: string; filter?: string }>();
  const board = useWorkBoard(id);
  // A link from the overview ("3 tasks late") opens that list for everyone.
  const initial = planFilterOf(linked);
  const [who, setWho] = useState<'mine' | 'all'>(initial && initial !== 'open' ? 'all' : 'mine');
  const [state, setState] = useState<PlanFilter>(initial ?? 'open');
  const today = format.today();
  const [creating, setCreating] = useState(false);
  const detail = useWorkDetail();
  const items = useMemo(() => (board.data?.items ?? [])
    .filter((item) => !item.parentId)
    .filter((item) => who === 'all' || item.assigneeId === board.data?.me)
    .filter((item) => inPlanFilter(item, state, today))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.number - b.number), [board.data, who, state, today]);
  return <>
    <ListScreen title={t('Plan')} back items={items} keyExtractor={(item) => item.id} groupBy={(item) => t(statusLabel(item.status))}
      toolbar={<View style={{ gap: theme.space(3) }}>
        <SegmentedControl value={who} onChange={setWho} options={[{ value: 'mine', label: t('Mine') }, { value: 'all', label: t('Everyone') }]} />
        <FilterChips value={state} onChange={setState} options={[
          { value: 'open', label: t('Open') }, { value: 'late', label: t('Late') }, { value: 'blocked', label: t('Blocked') }, { value: 'snags', label: t('Snags') }, { value: 'done', label: t('Done') },
        ]} />
      </View>}
      loading={board.isLoading} error={board.error ? errorMessage(board.error, t('The plan could not be loaded.')) : null} onRetry={() => void board.refetch()}
      onRefresh={() => void board.refetch()} refreshing={board.isRefetching}
      empty={<Empty icon={ListChecks} title={who === 'mine' ? t('Nothing assigned to you') : t('Nothing here')} action={who === 'mine' ? { label: t('See everyone’s'), onPress: () => setWho('all') } : undefined} />}
      renderItem={(item, _, first) => <ListRow first={first} title={item.title} detail={detail(item)} onPress={() => router.push(`/projects/${id}/task/${item.id}`)}
        meta={item.subtasks ? <Text variant="caption" tone="tertiary">{item.subtasks === 1 ? t('{done} of 1 step', { done: item.subtasksDone }) : t('{done} of {total} steps', { done: item.subtasksDone, total: item.subtasks })}</Text> : undefined}
        trailing={<WorkTrailing item={item} />} />}
      footer={board.data?.canEdit ? <Button label={t('Add task')} icon={Plus} variant="primary" size="lg" full onPress={() => setCreating(true)} /> : undefined} />
    <NewTaskSheet projectId={id} open={creating} onClose={() => setCreating(false)} />
  </>;
}

/** A new task (or blocker) on the plan, with a due date and who does it. */
function NewTaskSheet({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const board = useWorkBoard(projectId);
  const command = useWorkCommand(projectId);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'task' | 'blocker'>('task');
  const [due, setDue] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(board.data?.me ?? null);
  const id = useRef(Crypto.randomUUID());
  const create = async () => {
    try {
      const result = await command.mutateAsync({ action: 'create', id: id.current, title: title.trim(), type, ...(due ? { dueDate: due } : {}), ...(assigneeId ? { assigneeId } : {}) });
      toast.success(t('Added'));
      const created = id.current;
      id.current = Crypto.randomUUID();
      setTitle(''); setDue('');
      onClose();
      if (result.item?.id === created) router.push(`/projects/${projectId}/task/${created}`);
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  return <Sheet open={open} onClose={onClose} title={t('Add task')}
    footer={<Button label={t('Add')} variant="primary" size="lg" full disabled={!title.trim()} loading={command.isPending} onPress={create} />}>
    <TextField label={t('What needs doing')} value={title} onChangeText={setTitle} maxLength={300} autoFocus />
    <SegmentedControl value={type} onChange={setType} options={[{ value: 'task', label: t('Task') }, { value: 'blocker', label: t('Blocker') }]} />
    <DateField label={t('Due')} value={due} onChange={setDue} placeholder={t('Optional')} />
    {board.data?.people.length ? <SelectField label={t('Who')} value={assigneeId} onChange={setAssigneeId} allowClear placeholder={t('Nobody yet')}
      options={board.data.people.map((person) => ({ value: person.membershipId, label: person.membershipId === board.data?.me ? t('Me') : person.name }))} /> : null}
  </Sheet>;
}

/** My open work across projects (or my team's, for people who can see it), soonest due first. */
export function MyTasksScreen() {
  const t = useT();
  const router = useRouter();
  const [view, setView] = useState<'mine' | 'all'>('mine');
  const work = useOpenWork(view);
  const detail = useWorkDetail();
  const format = useFormat();
  const today = format.today();
  const group = (item: OpenWorkItem) => (!item.dueDate ? t('No date') : item.dueDate < today ? t('Late') : item.dueDate === today ? t('Today') : item.dueDate <= format.dayOf(new Date(Date.now() + 6 * 86400000)) ? t('This week') : t('Later'));
  return <ListScreen title={t('My tasks')} back items={work.data?.items} keyExtractor={(item) => item.id} groupBy={group}
    toolbar={work.data?.canSeeTeam ? <SegmentedControl value={view} onChange={setView} options={[{ value: 'mine', label: t('Mine') }, { value: 'all', label: t('Everyone') }]} /> : undefined}
    loading={work.isLoading} error={work.error ? errorMessage(work.error, t('Tasks could not be loaded.')) : null} onRetry={() => void work.refetch()}
    onRefresh={() => void work.refetch()} refreshing={work.isRefetching}
    empty={<Empty icon={ListChecks} title={t('Nothing open')} />}
    renderItem={(item, _, first) => <ListRow first={first} title={item.title} detail={detail(item, item.projectReference)} trailing={<WorkTrailing item={item} />}
      onPress={() => router.push(`/projects/${item.projectId}/task/${item.id}`)} />} />;
}

