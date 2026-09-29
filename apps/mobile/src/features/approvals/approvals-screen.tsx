import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { CheckCircle2, ClipboardCheck, CloudOff } from 'lucide-react-native';
import { errorMessage, isOffline } from '../../core/api';
import { appRouteFor } from '../../core/deep-links';
import { useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { useOnline } from '../../core/query';
import { FilterChips, TextField } from '../../ui/fields';
import { Banner, Empty, Fact, ListRow, ListScreen, Section } from '../../ui/layout';
import { Button, Chip, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { useTheme } from '../../ui/theme';
import { useToast } from '../../ui/toast';
import { APPROVAL_GROUPS, approveLabel, GROUP_LABEL, KIND_LABEL, needsNote, otherLabel, useDecide, useWaitingForYou, type ApprovalGroup, type ApprovalRow, type Decision } from './api';

/** The client, supplier or item, unless the title already names it ("PO-0042 · Al Noor Timber"). */
const subjectOf = (row: ApprovalRow) => (row.subject && !row.title.includes(row.subject) ? row.subject : null);

/** Everything waiting for my decision across modules, oldest first; decide in the sheet or open the record. */
export function ApprovalsScreen() {
  const t = useT();
  const format = useFormat();
  const online = useOnline();
  const list = useWaitingForYou();
  const [filter, setFilter] = useState<'all' | ApprovalGroup>('all');
  const [open, setOpen] = useState<ApprovalRow | null>(null);
  const counts = list.data?.counts;
  const groups = APPROVAL_GROUPS.filter((group) => (counts?.[group] ?? 0) > 0);
  const rows = useMemo(() => (list.data?.rows ?? []).filter((row) => filter === 'all' || row.group === filter), [list.data, filter]);

  return <><ListScreen back title={t('Approvals')}
    toolbar={<>
      {!online ? <Banner tone="neutral" icon={CloudOff} title={t('No connection')} detail={t('Approvals need a connection.')} /> : null}
      {groups.length > 1 ? <FilterChips value={filter} onChange={setFilter}
        options={[{ value: 'all', label: t('All') }, ...groups.map((group) => ({ value: group, label: `${t(GROUP_LABEL[group])} · ${counts?.[group] ?? 0}` }))]} /> : null}
    </>}
    items={rows} keyExtractor={(row) => `${row.kind}:${row.id}`}
    loading={list.isLoading} error={list.error ? errorMessage(list.error, t('Could not load what’s waiting for you.')) : null} onRetry={() => void list.refetch()}
    onRefresh={() => void list.refetch()} refreshing={list.isRefetching}
    empty={<Empty icon={CheckCircle2} title={t('Nothing waiting for you')} />}
    renderItem={(row, _, first) => <ListRow first={first} icon={ClipboardCheck} iconTone={row.canDecide ? 'warning' : 'neutral'} title={row.title}
      detail={[t(KIND_LABEL[row.kind] ?? row.kind), subjectOf(row), row.project?.name].filter(Boolean).join(' · ')}
      meta={<Text variant="caption" tone="tertiary">{[row.amount !== null ? format.money(row.amount, row.currency ?? undefined) : null, format.ago(row.since)].filter(Boolean).join(' · ')}</Text>}
      trailing={row.canDecide ? undefined : <Chip label={t('Your own')} />}
      onPress={() => setOpen(row)} />} />
    <DecisionSheet row={open} onClose={() => setOpen(null)} />
  </>;
}

function DecisionSheet({ row, onClose }: { row: ApprovalRow | null; onClose: () => void }) {
  const t = useT();
  const theme = useTheme();
  const format = useFormat();
  const router = useRouter();
  const toast = useToast();
  const decide = useDecide();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<Decision | null>(null);
  const close = () => { setNote(''); onClose(); };
  const route = row ? appRouteFor(row.href) : null;
  const submit = (decision: Decision) => {
    if (!row || busy) return;
    setBusy(decision);
    decide.mutate({ row, decision, note }, {
      onSuccess: () => { toast.success(decision === 'approve' ? t(row.kind === 'receipt' ? 'Verified' : 'Approved') : decision === 'return' ? t('Returned') : t('Refused')); close(); },
      onError: (error) => toast.error(isOffline(error) ? t('Approvals need a connection.') : errorMessage(error, t('Something went wrong'))),
      onSettled: () => setBusy(null),
    });
  };
  const ready = note.trim().length >= 3;
  const other = row?.decide?.other ?? null;
  return <Sheet open={!!row} onClose={close} title={row?.title}
    footer={row?.canDecide && row.decide ? <>
      <Button label={t(approveLabel(row.kind))} variant="primary" size="lg" full loading={busy === 'approve'} disabled={!!busy || (needsNote(row, 'approve') && !ready)} onPress={() => submit('approve')} />
      {other ? <Button label={t(otherLabel(other))} variant="ghost" full loading={busy === other} disabled={!!busy || !ready} onPress={() => submit(other)} /> : null}
    </> : route ? <Button label={t('Open')} variant="primary" size="lg" full onPress={() => { close(); router.push(route as Href); }} /> : undefined}>
    {row ? <View style={{ gap: theme.space(3) }}>
      <Section>
        <Fact first label={t('Waiting for you')} value={t(KIND_LABEL[row.kind] ?? row.kind)} />
        {subjectOf(row) ? <Fact label={t('For')} value={subjectOf(row)!} /> : null}
        {row.project ? <Fact label={t('Project')} value={[row.project.reference, row.project.name].filter(Boolean).join(' · ')} /> : null}
        {row.amount !== null ? <Fact label={t('Amount')} value={format.money(row.amount, row.currency ?? undefined)} /> : null}
        <Fact label={t('Since')} value={format.ago(row.since)} />
      </Section>
      {!row.canDecide ? <Banner tone="neutral" title={t('It’s your own; someone else decides.')} /> : null}
      {row.canDecide && !row.decide ? <Banner tone="info" title={t('Open it to decide.')} /> : null}
      {row.canDecide && row.decide && route ? <Button label={t('Open')} variant="secondary" full onPress={() => { close(); router.push(route as Href); }} /> : null}
      {row.canDecide && row.decide ? <TextField label={t('Note')} value={note} onChangeText={setNote} multiline maxLength={1000} placeholder={t('A few words for them')}
        hint={other || row.decide.approveNeedsNote ? t('At least {count} characters', { count: 3 }) : undefined} /> : null}
    </View> : null}
  </Sheet>;
}
