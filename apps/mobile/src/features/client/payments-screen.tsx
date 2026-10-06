import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { ExternalLink, Wallet } from 'lucide-react-native';
import { useT } from '../../core/i18n';
import { reportPayment } from '../../portal/flows';
import { milestoneAmount, paymentProblem, sortMilestones } from '../../portal/model';
import { usePortal, usePortalFormat, useProject, useRefreshPortal } from '../../portal/provider';
import type { PortalMilestone, PortalProject } from '../../portal/types';
import { DateField } from '../../ui/date-field';
import { TextField } from '../../ui/fields';
import { Banner, Card, Empty, Failure, Loading, Screen } from '../../ui/layout';
import { Button, Row, Text } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { useToast } from '../../ui/toast';
import { BudgetCard } from './home-screen';
import { AttachPhotos, FileStrip, ProjectSwitcher, StateChip } from './parts';

/**
 * Payments (the web portal's Payments): the budget, then one card per payment — what it's for, when it's due, the
 * amount or what's left, its invoice, what was received — with Pay (when the invoice has a pay link) and "I've paid"
 * with a photo of the receipt while the team checks it.
 */
export function ClientPaymentsScreen() {
  const t = useT();
  const { project, query } = useProject();
  const refresh = useRefreshPortal();
  if (query.isLoading) return <Screen title={t('Payments')} large><Loading shape="cards" count={3} /></Screen>;
  if (query.error && !query.data) return <Screen title={t('Payments')} large><Failure message={query.error.message} onRetry={() => void query.refetch()} /></Screen>;
  const payments = project?.payments;
  return <Screen title={t('Payments')} large below={<ProjectSwitcher />} onRefresh={() => void refresh()} refreshing={query.isRefetching}>
    {!project || !payments || !payments.milestones.length
      ? <Empty icon={Wallet} title={t('No payments yet')} detail={t('Your payment schedule will appear here.')} />
      : <PaymentsContent project={project} />}
  </Screen>;
}

function PaymentsContent({ project }: { project: PortalProject }) {
  const t = useT();
  const theme = useTheme();
  const format = usePortalFormat();
  const router = useRouter();
  const payments = project.payments!;
  const money = (value: string | null) => format.money(value, payments.currency ?? undefined);
  const reportLine = (milestone: PortalMilestone) => {
    const report = milestone.report;
    if (!report || report.status === 'recorded') return null;
    return report.status === 'submitted' ? t('You told us you paid on {date}. We\'re checking it.', { date: format.day(report.paidOn) })
      : t('We couldn\'t find your payment of {date}: {reason}', { date: format.day(report.paidOn), reason: report.reason });
  };
  return <>
    {project.budget ? <BudgetCard budget={project.budget} full /> : null}
    {payments.totals ? <Row gap={3}>
      <Card style={{ flex: 1 }}><Text variant="caption" tone="secondary">{t('Paid')}</Text><Text variant="number" numberOfLines={1} adjustsFontSizeToFit>{money(payments.totals.paid)}</Text></Card>
      <Card style={{ flex: 1 }}><Text variant="caption" tone="secondary">{t('Left to pay')}</Text><Text variant="number" numberOfLines={1} adjustsFontSizeToFit>{money(payments.totals.left)}</Text></Card>
    </Row> : null}
    {sortMilestones(payments.milestones).map((milestone) => {
      const shown = milestoneAmount(milestone);
      const line = reportLine(milestone);
      return <Card key={milestone.id}>
        <Row style={{ justifyContent: 'space-between' }} align="flex-start">
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label">{milestone.title}</Text>
            <Text variant="caption" tone="secondary">{[milestone.dueDate && milestone.status !== 'paid' ? t('due {date}', { date: format.day(milestone.dueDate) }) : '',
              milestone.invoice ? t('Invoice {number}', { number: milestone.invoice.number }) : ''].filter(Boolean).join(' · ')}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: theme.space(1) }}>
            {shown.amount ? <Text variant="subheading" style={{ writingDirection: 'ltr' }}>{shown.left ? t('{amount} left', { amount: money(shown.amount) }) : money(shown.amount)}</Text> : null}
            <StateChip state={milestone.status} />
          </View>
        </Row>
        {milestone.receipts.map((receipt) => <Text key={receipt.id} variant="caption" tone="secondary">{receipt.amount
          ? t('Received {amount} on {date}', { amount: money(receipt.amount), date: format.day(receipt.receivedOn) }) : t('Received on {date}', { date: format.day(receipt.receivedOn) })}</Text>)}
        {line ? <Text variant="caption" tone={milestone.report?.status === 'not_received' ? 'danger' : 'secondary'}>{line}</Text> : null}
        {milestone.report && milestone.report.status !== 'recorded' ? <FileStrip files={milestone.report.files} /> : null}
        {milestone.payUrl || milestone.canReport ? <Row gap={2} style={{ justifyContent: 'flex-end' }}>
          {milestone.canReport ? <Button size="sm" variant={milestone.payUrl ? 'ghost' : 'secondary'} label={t('I\'ve paid')} testID={`paid-${milestone.id}`}
            onPress={() => router.push({ pathname: '/portal/paid/[id]', params: { id: milestone.id } } as Href)} />  : null}
          {milestone.payUrl ? <Button size="sm" variant="primary" icon={ExternalLink} label={t('Pay')} onPress={() => { void Linking.openURL(milestone.payUrl!).catch(() => undefined); }} /> : null}
        </Row> : null}
      </Card>;
    })}
  </>;
}

/** "I've paid": when, how much, the bank reference and a photo of the receipt (camera or library), so the team can match it. */
export function ClientPaidScreen({ milestoneId }: { milestoneId: string }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const format = usePortalFormat();
  const { client } = usePortal();
  const refresh = useRefreshPortal();
  const { project, view } = useProject();
  const milestone = project?.payments?.milestones.find((item) => item.id === milestoneId) ?? null;
  const today = view?.today ?? format.today();
  const [paidOn, setPaidOn] = useState(today);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [id] = useState(() => client.newId());
  if (!project || !milestone) return <Screen title={t('I\'ve paid')} back><Empty icon={Wallet} title={t('This payment isn\'t there any more.')} /></Screen>;
  const problem = paymentProblem({ paidOn, amount, reference, photos: uploads.length, uploading }, today);
  const send = async () => {
    if (problem) { setError(t(problem)); return; }
    setBusy(true); setError('');
    try {
      await reportPayment(client, { commandId: id, caseId: project.id, paymentId: milestone.id, paidOn, amount, reference, note, uploadIds: uploads });
      toast.success(t('Thank you. We\'ll check your payment and let you know.'), 'send');
      await refresh();
      router.back();
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <Screen title={t('I\'ve paid')} subtitle={milestone.title} back keyboard
    footer={<Button label={t('Send')} variant="primary" size="lg" full loading={busy} disabled={uploading} onPress={() => void send()} testID="paid-send" />}>
    {error ? <Banner tone="danger" title={error} /> : null}
    {milestone.left ? <Text tone="secondary">{t('{amount} left', { amount: format.money(milestone.left, project.payments?.currency ?? undefined) })}</Text> : null}
    <View style={{ gap: theme.space(4) }}>
      <DateField label={t('Paid on')} value={paidOn} max={today} onChange={setPaidOn} />
      <TextField label={t('Amount paid')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" hint={project.payments?.currency ?? undefined} />
      <TextField label={t('Bank reference')} value={reference} onChangeText={setReference} maxLength={120} autoCapitalize="characters" />
      <View style={{ gap: theme.space(2) }}>
        <Text variant="label">{t('Add the receipt')}</Text>
        <AttachPhotos caseId={project.id} onChange={setUploads} onBusy={setUploading} max={5} />
      </View>
      <TextField label={t('Note')} value={note} onChangeText={setNote} maxLength={1000} multiline />
    </View>
  </Screen>;
}
