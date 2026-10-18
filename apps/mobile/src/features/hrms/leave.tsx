import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { CalendarPlus, Plane } from 'lucide-react-native';
import type { LeaveRequest } from '../../../../../packages/contracts/src/hrms';
import { errorMessage } from '../../core/api';
import { useFormat } from '../../core/format';
import { key, useT } from '../../core/i18n';
import { DateField } from '../../ui/date-field';
import { ReasonSheet } from '../../ui/dialogs';
import { SegmentedControl, SelectField, TextField } from '../../ui/fields';
import { Banner, Empty, Failure, Fact, ListRow, Loading, Screen, Section } from '../../ui/layout';
import { Button, Stack, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { useBalances, useBootstrap, useHrmsCommand, useLeaveRequests, useLeaveTypes, type CommandReceipt } from './api';
import { canHalfDay, leaveDays } from './model';

const PART_LABEL = { full: key('Full day'), first_half: key('First half'), second_half: key('Second half') } as const;

export function leaveRange(request: Pick<LeaveRequest, 'startDate' | 'endDate' | 'dayPart'>, format: ReturnType<typeof useFormat>, t: (key: string) => string) {
  const range = request.startDate === request.endDate ? format.day(request.startDate) : `${format.day(request.startDate)} – ${format.day(request.endDate)}`;
  return request.dayPart === 'full' ? range : `${range} · ${t(PART_LABEL[request.dayPart])}`;
}

/** My leave: what's left this year, what's booked, and a new request. */
export function LeaveScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const { request: openId } = useLocalSearchParams<{ request?: string }>();
  const year = Number(format.today().slice(0, 4));
  const balances = useBalances(year);
  const requests = useLeaveRequests('self');
  const [selected, setSelected] = useState<LeaveRequest | null>(null);
  useEffect(() => {
    if (openId && requests.data) setSelected(requests.data.find((item) => item.id === openId) ?? null);
  }, [openId, requests.data]);
  const today = format.today();
  const sorted = useMemo(() => [...(requests.data ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate)), [requests.data]);
  const upcoming = sorted.filter((item) => item.endDate >= today && !['withdrawn', 'cancelled', 'rejected'].includes(item.status)).reverse();
  const past = sorted.filter((item) => !upcoming.includes(item));

  return <Screen title={t('Leave')} back onRefresh={() => { void balances.refetch(); void requests.refetch(); }} refreshing={requests.isRefetching}
    footer={<Button label={t('Request leave')} icon={CalendarPlus} variant="primary" size="lg" full onPress={() => router.push('/hrms/leave/new')} />}>
    {balances.isLoading ? <Loading shape="cards" count={1} /> : balances.error ? <Failure message={errorMessage(balances.error, t('Balances could not be loaded.'))} onRetry={() => void balances.refetch()} />
      : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space(2) }} style={{ marginHorizontal: -theme.space(4) }}>
        <View style={{ width: theme.space(2) }} />
        {(balances.data ?? []).map((balance) => <View key={balance.leaveTypeId} style={{ width: 156, padding: theme.space(4), gap: theme.space(1), borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceMuted }}>
          <Text variant="caption" tone="secondary" numberOfLines={1}>{balance.leaveTypeName}</Text>
          <Text variant="title" style={{ fontVariant: ['tabular-nums'] }}>{balance.limited ? format.number(balance.available ?? 0, 1) : format.number(balance.used, 1)}</Text>
          <Text variant="caption" tone="tertiary">{!balance.limited ? t('days taken') : Number(balance.allowance ?? 0) === 1 ? t('of 1 day left') : t('of {total} days left', { total: format.number(balance.allowance ?? 0, 1) })}</Text>
        </View>)}
        <View style={{ width: theme.space(2) }} />
      </ScrollView>}

    {requests.isLoading ? <Loading count={3} /> : requests.error ? <Failure message={errorMessage(requests.error, t('Requests could not be loaded.'))} onRetry={() => void requests.refetch()} />
      : !sorted.length ? <Empty icon={Plane} title={t('No leave booked')} />
      : <>
        {upcoming.length ? <Section title={t('Coming up')}>
          {upcoming.map((item, index) => <ListRow key={item.id} first={index === 0} title={item.leaveTypeName} detail={`${leaveRange(item, format, t)} · ${Number(item.days) === 1 ? t('1 day') : t('{count} days', { count: format.number(item.days, 1) })}`}
            trailing={<StatusChip status={item.status} />} onPress={() => setSelected(item)} />)}
        </Section> : null}
        {past.length ? <Section title={t('Earlier')}>
          {past.slice(0, 30).map((item, index) => <ListRow key={item.id} first={index === 0} title={item.leaveTypeName} detail={leaveRange(item, format, t)}
            trailing={<StatusChip status={item.status} />} onPress={() => setSelected(item)} />)}
        </Section> : null}
      </>}
    <LeaveDetailSheet request={selected} onClose={() => setSelected(null)} />
  </Screen>;
}

function LeaveDetailSheet({ request, onClose }: { request: LeaveRequest | null; onClose: () => void }) {
  const t = useT();
  const format = useFormat();
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const cancel = useHrmsCommand((api, input: { id: string; reason: string }) => api.send<CommandReceipt>(`hrms/leave/requests/${input.id}/cancel`, 'POST', { reason: input.reason }));
  const cancellable = !!request && ['pending', 'approved'].includes(request.status) && request.endDate >= format.today();
  return <>
    <Sheet open={!!request && !cancelling} onClose={onClose} title={request?.leaveTypeName}
      footer={cancellable ? <Button label={request?.status === 'pending' ? t('Withdraw') : t('Ask to cancel')} variant="secondary" full onPress={() => setCancelling(true)} /> : undefined}>
      {request ? <Stack gap={3}>
        <StatusChip status={request.status} />
        <Section>
          <Fact first label={t('When')} value={leaveRange(request, format, t)} />
          <Fact label={t('Days')} value={format.number(request.days, 1)} />
          <Fact label={t('Reason')} value={request.reason} />
          {request.decisionReason ? <Fact label={t('Decision note')} value={request.decisionReason} /> : null}
          {request.cancellationReason ? <Fact label={t('Cancellation')} value={request.cancellationReason} /> : null}
        </Section>
      </Stack> : null}
    </Sheet>
    <ReasonSheet open={cancelling} onClose={() => setCancelling(false)} title={request?.status === 'pending' ? t('Withdraw this request?') : t('Ask to cancel this leave?')}
      label={t('Reason')} action={request?.status === 'pending' ? t('Withdraw') : t('Ask to cancel')} danger
      onSubmit={async (reason) => {
        if (!request) return;
        try { await cancel.mutateAsync({ id: request.id, reason }); toast.success(request.status === 'pending' ? t('Request withdrawn') : t('Cancellation sent for approval')); onClose(); }
        catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); throw error; }
      }} />
  </>;
}

/** A leave request: the type, the days (half days when allowed), and why. */
export function NewLeaveScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const toast = useToast();
  const bootstrap = useBootstrap();
  const types = useLeaveTypes();
  const year = Number(format.today().slice(0, 4));
  const balances = useBalances(year);
  const active = (types.data ?? []).filter((type) => type.active);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [start, setStart] = useState(format.today());
  const [end, setEnd] = useState(format.today());
  const [part, setPart] = useState<'full' | 'first_half' | 'second_half'>('full');
  const [reason, setReason] = useState('');
  const actionId = useRef(Crypto.randomUUID()).current;
  const submit = useHrmsCommand((api, body: Record<string, unknown>) => api.send<CommandReceipt>('hrms/leave/requests', 'POST', body));
  useEffect(() => { if (!typeId && active[0]) setTypeId(active[0].id); }, [active, typeId]);
  const type = active.find((item) => item.id === typeId);
  const half = canHalfDay(type, start, end);
  useEffect(() => { if (!half && part !== 'full') setPart('full'); }, [half, part]);
  const days = leaveDays(start, end, part, bootstrap.data?.employee?.calendar);
  const balance = (balances.data ?? []).find((item) => item.leaveTypeId === typeId);
  const short = !!balance?.limited && balance.available !== null && days > balance.available;
  const ready = !!typeId && !!start && !!end && end >= start && days > 0 && reason.trim().length >= 3;
  const send = async () => {
    try {
      await submit.mutateAsync({ actionId, leaveTypeId: typeId, startDate: start, endDate: end, dayPart: part, reason: reason.trim() });
      toast.success(t('Leave requested'));
      router.back();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  if (types.isLoading) return <Screen title={t('Request leave')} back><Loading shape="form" count={4} /></Screen>;
  return <Screen title={t('Request leave')} back keyboard
    footer={<Button label={t('Send request')} variant="primary" size="lg" full disabled={!ready} loading={submit.isPending} onPress={send} />}>
    <SelectField label={t('Type')} value={typeId} onChange={setTypeId} options={active.map((item) => ({ value: item.id, label: item.name, detail: item.limited ? undefined : t('Unlimited') }))} />
    <DateField label={t('From')} value={start} onChange={(value) => { setStart(value); if (end < value) setEnd(value); }} />
    <DateField label={t('To')} value={end} onChange={setEnd} min={start} />
    {half ? <SegmentedControl value={part} onChange={setPart} options={(['full', 'first_half', 'second_half'] as const).map((value) => ({ value, label: t(PART_LABEL[value]) }))} /> : null}
    <Section>
      <Fact first label={t('Working days')} value={days ? format.number(days, 1) : '—'} />
      {balance?.limited ? <Fact label={t('Left after this')} value={format.number((balance.available ?? 0) - days, 1)} /> : null}
    </Section>
    {short ? <Banner tone="warning" title={t('More than you have left')} /> : null}
    {start && end && !days ? <Banner tone="neutral" title={t('No working days in these dates')} /> : null}
    <TextField label={t('Reason')} value={reason} onChangeText={setReason} multiline maxLength={2000} placeholder={t('A few words for your approver')} />
  </Screen>;
}
