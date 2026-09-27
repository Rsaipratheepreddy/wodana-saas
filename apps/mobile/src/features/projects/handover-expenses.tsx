import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { CloudOff, FileText, Plus, ReceiptText, ShieldCheck } from 'lucide-react-native';
import { useAuth } from '../../auth/provider';
import { errorMessage, useApi } from '../../core/api';
import { openWorkspaceFile } from '../../core/files';
import { useFormat } from '../../core/format';
import { key, useT } from '../../core/i18n';
import type { LocalPhoto } from '../../core/media';
import { useOnline } from '../../core/query';
import { DateField } from '../../ui/date-field';
import { ReasonSheet } from '../../ui/dialogs';
import { SelectField, TextField, cleanDecimal } from '../../ui/fields';
import { Banner, Empty, Failure, Fact, ListRow, ListScreen, Loading, Screen, Section } from '../../ui/layout';
import { PhotoGrid } from '../../ui/photos';
import { Button, Row, Stack, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { MoneyText } from '../../ui/money';
import { useToast } from '../../ui/toast';
import { useHandover } from './api';

const DOC_KIND: Record<string, string> = { drawing: key('Drawing'), warranty: key('Warranty'), manual: key('Manual'), care_guide: key('Care guide'), photo: key('Photo'), other: key('Document') };

/** What the client receives at handover, pack by pack; documents open on the phone. */
export function HandoverScreen() {
  const t = useT();
  const format = useFormat();
  const toast = useToast();
  const api = useApi();
  const { client } = useAuth();
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const handover = useHandover(projectId);
  const state = handover.data;
  const areaNames = (ids: string[]) => ids.map((id) => state?.areas.find((area) => area.id === id)?.name).filter(Boolean).join(', ');
  const open = async (documentId: string, name: string) => {
    try { await openWorkspaceFile(client, api.url(`site/projects/${projectId}/handover/documents/${documentId}`), name); }
    catch (error) { toast.error(errorMessage(error, t('The file could not be opened.'))); }
  };
  if (handover.isLoading) return <Screen back title={t('Handover')}><Loading count={3} /></Screen>;
  if (handover.error || !state) return <Screen back title={t('Handover')}><Failure message={errorMessage(handover.error, t('The handover could not be loaded.'))} onRetry={() => void handover.refetch()} /></Screen>;
  return <Screen back title={t('Handover')} onRefresh={() => void handover.refetch()} refreshing={handover.isRefetching}>
    {state.covered ? <Banner tone="success" title={t('The client accepted the handover')} /> : null}
    {!state.packs.length ? <Empty icon={ShieldCheck} title={t('No handover pack yet')} /> : state.packs.map((pack) => <Section key={pack.id} title={`${pack.title} · R${pack.revision}`}>
      <ListRow first title={pack.areaIds.length ? areaNames(pack.areaIds) : t('Whole project')} trailing={<StatusChip status={pack.status} />}
        detail={pack.decidedOn ? t('{method} · {name} · {day}', { method: pack.decisionMethod ?? '', name: pack.decidedByName ?? '', day: format.day(pack.decidedOn) }) : pack.issuedAt ? t('Issued {day}', { day: format.day(pack.issuedAt.slice(0, 10)) }) : undefined} />
      {pack.documents.map((document) => <ListRow key={document.id} icon={FileText} title={document.title || document.name} detail={t(DOC_KIND[document.kind] ?? 'Document')}
        onPress={() => void open(document.id, document.name)} />)}
      {pack.decisionNote ? <Fact label={t('Note')} value={pack.decisionNote} /> : null}
    </Section>)}
  </Screen>;
}

type Claim = {
  id: string; reference: string; spentOn: string; amount: string; currency: string; description: string; category: string; receiptName: string | null; noReceiptReason: string;
  status: string; claimedBy: string; claimedByName: string; decisionNote: string; version: number; packageName: string | null;
};
type ClaimsState = { claims: Claim[]; packages: Array<{ id: string; name: string }>; currency: string; today: string; me: string; canClaim: boolean; canApprove: boolean };
const CATEGORY: Record<string, string> = { transport: key('Transport'), food: key('Food'), materials: key('Materials'), tools: key('Tools'), fees: key('Fees'), other: key('Other') };

/** Petty cash on a project: my claims (everyone's for its managers), a new claim with its receipt, and decisions. Needs a connection. */
export function ExpensesScreen() {
  const t = useT();
  const format = useFormat();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const key_ = ['petty-cash', api.workspaceId, projectId];
  const claims = useQuery({ queryKey: key_, queryFn: () => api.get<ClaimsState>(`petty-cash/projects/${projectId}`) });
  const command = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.send<ClaimsState>(`petty-cash/projects/${projectId}`, 'POST', { commandId: Crypto.randomUUID(), ...body }),
    onSuccess: (state) => queryClient.setQueryData(key_, state),
  });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Claim | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const state = claims.data;
  const decide = async (claim: Claim, action: 'approve' | 'reject', note = '') => {
    try { await command.mutateAsync({ action, claimId: claim.id, version: claim.version, note }); toast.success(action === 'approve' ? t('Approved') : t('Not approved')); setOpen(null); }
    catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); throw error; }
  };
  const canDecide = !!open && !!state?.canApprove && open.status === 'submitted' && open.claimedBy !== state.me;
  return <>
    <ListScreen title={t('Expenses')} back items={state?.claims} keyExtractor={(claim) => claim.id}
      loading={claims.isLoading} error={claims.error ? errorMessage(claims.error, t('Expenses could not be loaded.')) : null} onRetry={() => void claims.refetch()}
      onRefresh={() => void claims.refetch()} refreshing={claims.isRefetching}
      empty={<Empty icon={ReceiptText} title={t('No expenses yet')} />}
      renderItem={(claim, _, first) => <ListRow first={first} title={claim.description} onPress={() => setOpen(claim)}
        detail={[claim.reference, format.day(claim.spentOn), t(CATEGORY[claim.category] ?? claim.category), claim.claimedBy !== state?.me ? claim.claimedByName : null].filter(Boolean).join(' · ')}
        trailing={<View style={{ alignItems: 'flex-end', gap: 4 }}><MoneyText amount={claim.amount} currency={claim.currency} /><StatusChip status={claim.status} /></View>} />}
      footer={state?.canClaim ? <Button label={t('New expense')} icon={Plus} variant="primary" size="lg" full onPress={() => setCreating(true)} /> : undefined} />
    <NewClaimSheet open={creating} onClose={() => setCreating(false)} projectId={projectId} state={state}
      onDone={(next) => { queryClient.setQueryData(key_, next); setCreating(false); }} />
    <Sheet open={!!open && !rejecting} onClose={() => setOpen(null)} title={open?.description} subtitle={open?.reference}
      footer={canDecide && open ? <Row gap={2}>
        <Button label={t('Reject')} variant="secondary" size="lg" onPress={() => setRejecting(true)} />
        <View style={{ flex: 1 }}><Button label={t('Approve')} variant="primary" size="lg" full loading={command.isPending} onPress={() => void decide(open, 'approve').catch(() => undefined)} /></View>
      </Row> : undefined}>
      {open ? <Stack gap={3}>
        <StatusChip status={open.status} />
        <Section>
          <Fact first label={t('Amount')} value={<MoneyText amount={open.amount} currency={open.currency} />} />
          <Fact label={t('Spent on')} value={format.day(open.spentOn)} />
          <Fact label={t('Category')} value={t(CATEGORY[open.category] ?? open.category)} />
          {open.packageName ? <Fact label={t('Package')} value={open.packageName} /> : null}
          <Fact label={t('Claimed by')} value={open.claimedByName} />
          <Fact label={t('Receipt')} value={open.receiptName ?? open.noReceiptReason ?? '—'} />
          {open.decisionNote ? <Fact label={t('Decision note')} value={open.decisionNote} /> : null}
        </Section>
      </Stack> : null}
    </Sheet>
    <ReasonSheet open={rejecting} onClose={() => setRejecting(false)} title={t('Reject this expense?')} label={t('Why')} action={t('Reject')} danger
      onSubmit={(note) => (open ? decide(open, 'reject', note) : undefined)} />
  </>;
}

function NewClaimSheet({ open, onClose, projectId, state, onDone }: { open: boolean; onClose: () => void; projectId: string; state: ClaimsState | undefined; onDone: (state: ClaimsState) => void }) {
  const t = useT();
  const format = useFormat();
  const toast = useToast();
  const api = useApi();
  const online = useOnline();
  const [amount, setAmount] = useState('');
  const [spentOn, setSpentOn] = useState(format.today());
  const [category, setCategory] = useState<string | null>('transport');
  const [description, setDescription] = useState('');
  const [packageId, setPackageId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<LocalPhoto | null>(null);
  const [noReceipt, setNoReceipt] = useState('');
  const [busy, setBusy] = useState(false);
  const claimId = useRef(Crypto.randomUUID());
  const currency = state?.currency ?? format.currency;
  const places = format.moneyPlaces(currency);
  const ready = Number(amount) > 0 && description.trim().length > 0 && !!category && (receipt || noReceipt.trim());
  const send = async () => {
    setBusy(true);
    try {
      let next = await api.send<ClaimsState>(`petty-cash/projects/${projectId}`, 'POST', {
        action: 'save', commandId: Crypto.randomUUID(), id: claimId.current, spentOn, amount: cleanDecimal(amount, places), description: description.trim().slice(0, 500), category,
        ...(packageId ? { packageId } : {}), ...(!receipt ? { noReceiptReason: noReceipt.trim().slice(0, 300) } : {}),
      });
      if (receipt) {
        await api.upload(`petty-cash/projects/${projectId}/claims/${claimId.current}/receipt`, 'POST', 'file', { uri: receipt.uri, name: receipt.name, type: receipt.type });
        next = await api.get<ClaimsState>(`petty-cash/projects/${projectId}`);
      }
      const claim = next.claims.find((item) => item.id === claimId.current);
      if (claim) next = await api.send<ClaimsState>(`petty-cash/projects/${projectId}`, 'POST', { action: 'submit', commandId: Crypto.randomUUID(), claimId: claim.id, version: claim.version });
      toast.success(t('Expense sent for approval'));
      claimId.current = Crypto.randomUUID();
      setAmount(''); setDescription(''); setReceipt(null); setNoReceipt('');
      onDone(next);
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
    finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title={t('New expense')} full
    footer={<Button label={t('Send for approval')} variant="primary" size="lg" full loading={busy} disabled={!ready || !online} onPress={send} />}>
    {!online ? <Banner tone="neutral" icon={CloudOff} title={t('Expenses need a connection')} /> : null}
    <TextField label={t('Amount')} value={amount} onChangeText={(value) => setAmount(cleanDecimal(value, places))} keyboardType="decimal-pad" placeholder={format.money(0, currency)}
      trailing={<Text variant="caption" tone="secondary">{currency}</Text>} />
    <TextField label={t('What for')} value={description} onChangeText={setDescription} maxLength={500} />
    <SelectField label={t('Category')} value={category} onChange={setCategory} options={Object.entries(CATEGORY).map(([value, label]) => ({ value, label: t(label) }))} />
    <DateField label={t('Spent on')} value={spentOn} onChange={setSpentOn} max={format.today()} />
    {state?.packages.length ? <SelectField label={t('Package')} value={packageId} onChange={setPackageId} allowClear placeholder={t('Optional')} options={state.packages.map((pack) => ({ value: pack.id, label: pack.name }))} /> : null}
    <Section flat title={t('Receipt')}>
      <PhotoGrid photos={receipt ? [{ key: receipt.id, uri: receipt.uri }] : []} onAdd={(photos) => setReceipt(photos[0] ?? null)} onRemove={() => setReceipt(null)} max={1} columns={2} addLabel={t('Photo of receipt')} />
    </Section>
    {!receipt ? <TextField label={t('No receipt? Say why')} value={noReceipt} onChangeText={setNoReceipt} maxLength={300} placeholder={t('Optional')} /> : null}
  </Sheet>;
}
