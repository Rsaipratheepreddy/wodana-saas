import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { CheckCircle2, ClipboardCheck, CloudOff, FileText } from 'lucide-react-native';
import { useAuth } from '../../auth/provider';
import { errorMessage, isOffline, useApi } from '../../core/api';
import { openWorkspaceFile } from '../../core/files';
import { appRouteFor } from '../../core/deep-links';
import { useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { useOnline } from '../../core/query';
import { FilterChips, TextField } from '../../ui/fields';
import { Banner, Empty, Fact, ListRow, ListScreen, Loading, Section } from '../../ui/layout';
import { AuthImage } from '../../ui/photos';
import { Button, Chip, Text } from '../../ui/primitives';
import { sitePhotoPath } from '../projects/api';
import { Sheet } from '../../ui/sheet';
import { useTheme } from '../../ui/theme';
import { useToast } from '../../ui/toast';
import { assetPath } from '../survey/api';
import {
  APPROVAL_GROUPS, approveLabel, GROUP_LABEL, KIND_LABEL, otherLabel, useDecide, usePaymentEvidence, useReturnPaymentReport, useWaitingForYou,
  type ApprovalGroup, type ApprovalRow,
} from './api';
import { confirmProblem, isPicture, METHOD_LABEL, MIN_REASON, returnPath, returnProblem, type Evidence, type ReviewStep } from './review-model';

/** The client, supplier or item, unless the title already names it ("PO-0042 · Al Noor Timber"). */
const subjectOf = (row: ApprovalRow) => (row.subject && !row.title.includes(row.subject) ? row.subject : null);

/** Everything waiting for my decision across modules, oldest first. A row opens its review (the evidence, then Confirm or Return); never a one-tap decision. */
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
    <ReviewSheet row={open} onClose={() => setOpen(null)} />
  </>;
}

/** The evidence of a payment: the client's proof (pictures shown, documents opened), then how much, how and by whom. */
function PaymentEvidence({ evidence, caseId }: { evidence: Evidence; caseId: string }) {
  const t = useT();
  const theme = useTheme();
  const format = useFormat();
  const toast = useToast();
  const api = useApi();
  const { client } = useAuth();
  const pictures = evidence.files.filter(isPicture);
  const documents = evidence.files.filter((file) => !isPicture(file));
  const open = (file: Evidence['files'][number]) => openWorkspaceFile(client, api.url(assetPath(caseId, file.id, false)), file.name)
    .catch((error) => toast.error(errorMessage(error, t('Something went wrong'))));
  return <View style={{ gap: theme.space(3) }}>
    {pictures.map((file) => <AuthImage key={file.id} path={assetPath(caseId, file.id)} contentFit="contain" accessibilityLabel={t('Payment proof')}
      style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: theme.radius.md }} />)}
    {documents.length ? <Section>
      {documents.map((file, index) => <ListRow key={file.id} first={index === 0} icon={FileText} title={file.name} onPress={() => void open(file)} />)}
    </Section> : null}
    <Section>
      {[
        evidence.amount !== null ? { label: t('Amount'), value: format.money(evidence.amount, evidence.currency ?? undefined) } : null,
        evidence.method || evidence.provider ? { label: t('Payment method'), value: evidence.method ? t(METHOD_LABEL[evidence.method]) : evidence.provider ?? '' } : null,
        evidence.paidOn ? { label: t('Received on'), value: format.day(evidence.paidOn) } : null,
        evidence.reference ? { label: t('Reference'), value: evidence.reference } : null,
        evidence.submittedBy ? { label: t('Submitted by'), value: [evidence.submittedBy, evidence.submittedAt ? format.ago(evidence.submittedAt) : null].filter(Boolean).join(' · ') } : null,
        evidence.note ? { label: t('Evidence'), value: evidence.note } : null,
      ].filter((fact): fact is { label: string; value: string } => !!fact).map((fact, index) => <Fact key={fact.label} first={index === 0} label={fact.label} value={fact.value} />)}
    </Section>
  </View>;
}

/**
 * A review that fits a phone: the evidence first (a payment's proof, amount, method and who submitted it; a daily
 * report's lead photo and words; otherwise what the row says), then Confirm, or Return, which asks for the reason
 * before it can be sent. Something decided elsewhere opens its record.
 */
function ReviewSheet({ row, onClose }: { row: ApprovalRow | null; onClose: () => void }) {
  const t = useT();
  const theme = useTheme();
  const format = useFormat();
  const router = useRouter();
  const toast = useToast();
  const decide = useDecide();
  const returnReport = useReturnPaymentReport();
  const payment = usePaymentEvidence(row);
  const [step, setStep] = useState<ReviewStep>('evidence');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'confirm' | 'return' | null>(null);
  useEffect(() => { setStep('evidence'); setNote(''); setReason(''); }, [row?.kind, row?.id]);
  const close = () => { setStep('evidence'); setNote(''); setReason(''); onClose(); };
  const route = row ? appRouteFor(row.href) : null;
  const back = row ? returnPath(row, payment.evidence) : null;
  const failed = (error: unknown) => toast.error(isOffline(error) ? t('Approvals need a connection.') : errorMessage(error, t('Something went wrong')));
  const confirm = () => {
    if (!row || busy || confirmProblem(row, note)) return;
    setBusy('confirm');
    decide.mutate({ row, decision: 'approve', note }, {
      onSuccess: () => { toast.success(t(row.kind === 'receipt' ? 'Verified' : 'Approved'), 'approve'); close(); },
      onError: failed, onSettled: () => setBusy(null),
    });
  };
  const sendBack = async () => {
    if (!row || !back || busy || returnProblem(reason)) return;
    setBusy('return');
    try {
      if (back.kind === 'decide') await decide.mutateAsync({ row, decision: back.decision, note: reason });
      else await returnReport.mutateAsync({ reportId: back.reportId, version: back.version, reason });
      toast.success(back.kind === 'decide' && back.decision === 'reject' ? t('Refused') : t('Returned'));
      close();
    } catch (error) { failed(error); } finally { setBusy(null); }
  };
  const decidable = !!row?.canDecide && !!row.decide;
  const backLabel = back?.kind === 'decide' ? t(otherLabel(back.decision)) : t('Return');
  const footer = !row ? undefined : step === 'return' ? <>
    <Button label={backLabel} variant="danger" size="lg" full loading={busy === 'return'} disabled={!!busy || !!returnProblem(reason)} onPress={() => void sendBack()} />
    <Button label={t('Back')} variant="ghost" full disabled={!!busy} onPress={() => setStep('evidence')} />
  </> : decidable ? <>
    <Button label={t(approveLabel(row.kind))} variant="primary" size="lg" full loading={busy === 'confirm'} disabled={!!busy || payment.loading || !!confirmProblem(row, note)} onPress={confirm} />
    {back ? <Button label={backLabel} variant="secondary" full disabled={!!busy || payment.loading} onPress={() => setStep('return')} /> : null}
  </> : route ? <Button label={t('Open')} variant="primary" size="lg" full onPress={() => { close(); router.push(route as Href); }} /> : undefined;
  return <Sheet open={!!row} onClose={close} title={row?.title} subtitle={row ? t(KIND_LABEL[row.kind] ?? row.kind) : undefined} footer={footer}>
    {row && step === 'return' ? <TextField label={t('Reason')} value={reason} onChangeText={setReason} multiline autoFocus maxLength={1000}
      placeholder={t('What to change')} hint={returnProblem(reason) ? t('At least {count} characters', { count: MIN_REASON }) : undefined} /> : null}
    {row && step === 'evidence' ? <View style={{ gap: theme.space(3) }}>
      {/* The evidence first: a payment's proof and facts, a daily report's photo and words. */}
      {payment.caseId ? payment.loading ? <Loading shape="record" count={2} /> : payment.evidence ? <PaymentEvidence evidence={payment.evidence} caseId={payment.caseId} /> : null : null}
      {row.preview ? <View style={{ gap: theme.space(2) }}>
        {row.preview.photoId && row.parentId ? <AuthImage path={sitePhotoPath(row.parentId, row.preview.photoId)} accessibilityLabel={t('Lead photo')}
          style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: theme.radius.md }} /> : null}
        {row.preview.text ? <Text variant="body">{row.preview.text}</Text> : null}
      </View> : null}
      <Section>
        {[
          subjectOf(row) ? { label: t('For'), value: subjectOf(row)! } : null,
          row.project ? { label: t('Project'), value: [row.project.reference, row.project.name].filter(Boolean).join(' · ') } : null,
          // A payment's amount is part of its evidence above.
          row.amount !== null && !payment.caseId ? { label: t('Amount'), value: format.money(row.amount, row.currency ?? undefined) } : null,
          { label: t('Since'), value: format.ago(row.since) },
        ].filter((fact): fact is { label: string; value: string } => !!fact).map((fact, index) => <Fact key={fact.label} first={index === 0} label={fact.label} value={fact.value} />)}
      </Section>
      {!row.canDecide ? <Banner tone="neutral" title={t('It’s your own; someone else decides.')} /> : null}
      {row.canDecide && !row.decide ? <Banner tone="info" title={t('Open it to decide.')} /> : null}
      {decidable && route ? <Button label={t('Open')} variant="ghost" full onPress={() => { close(); router.push(route as Href); }} /> : null}
      {decidable && row.decide?.approveNeedsNote ? <TextField label={t('Note')} value={note} onChangeText={setNote} multiline maxLength={1000} placeholder={t('A few words for them')}
        hint={t('At least {count} characters', { count: MIN_REASON })} /> : null}
    </View> : null}
  </Sheet>;
}
