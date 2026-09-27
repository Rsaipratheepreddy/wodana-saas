import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { ClipboardCheck, Factory, Hammer, Play, Truck } from 'lucide-react-native';
import { errorMessage, useApi } from '../../core/api';
import { useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { useSession } from '../../core/session';
import { FilterChips, SearchField, Stepper, TextField, cleanDecimal } from '../../ui/fields';
import { Banner, Card, Empty, Failure, Fact, ListRow, ListScreen, Loading, Progress, Screen, Section } from '../../ui/layout';
import { Button, Row, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';

type OrderStatus = 'planned' | 'released' | 'in_production' | 'ready' | 'on_hold' | 'cancelled' | 'short_closed';
type WorkOrderRow = {
  id: string; number: number; projectId: string | null; projectReference: string | null; projectName: string | null; packageName: string | null; title: string; specification: string;
  quantity: string; unit: string; status: OrderStatus; workcenterName: string | null; plannedStart: string | null; plannedEnd: string | null; notes: string; version: number;
  made: string; pending: string; passed: string; toCheck: string; left: string; scrapped: string; plannedHours: string | null;
};
type FactoryState = { orders: WorkOrderRow[]; canManage: boolean; canReport: boolean; canApprove: boolean; canIssue: boolean };
type OrderDetail = {
  order: WorkOrderRow & { drawingRef: string | null; drawingApprovedAt: string | null; holdReason: string | null };
  reports: Array<{ id: string; good: string; scrap: string; scrapReason: string; note: string; hours: string | null; status: 'pending' | 'approved' | 'refused'; reportedBy: string; reportedByName: string; reportedAt: string; decidedByName: string | null; decisionNote: string }>;
  checks: Array<{ id: string; passed: string; failed: string; failReason: string; checkedByName: string; checkedAt: string }>;
  settings: { requireCheck: boolean };
  dispatches: Array<{ id: string; number: number; status: string; sentOn: string | null; quantity: string; received: string | null; short: string | null }>;
  atFactory: string;
  canManage: boolean; canReport: boolean; canApprove: boolean; canIssue: boolean;
};

const num = (value: string | number | null | undefined) => Number(value ?? 0) || 0;
export const workOrderNumber = (number: number) => `WO-${String(number).padStart(4, '0')}`;
const factoryKeys = { state: (ws: string) => ['factory', ws, 'state'] as const, order: (ws: string, id: string) => ['factory', ws, 'order', id] as const };

/** Work orders: in production first; each opens to report output, check quality or send to site. */
export function WorkOrdersScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const api = useApi();
  const session = useSession();
  const state = useQuery({ queryKey: factoryKeys.state(api.workspaceId), queryFn: () => api.get<FactoryState>('factory/state'), enabled: session.has('projects') });
  const [filter, setFilter] = useState<'making' | 'ready' | 'planned' | 'all'>('making');
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (state.data?.orders ?? []).filter((order) => filter === 'all' ? true : filter === 'making' ? ['released', 'in_production', 'on_hold'].includes(order.status) : filter === 'ready' ? order.status === 'ready' : order.status === 'planned')
      .filter((order) => !needle || `${workOrderNumber(order.number)} ${order.title} ${order.projectReference ?? ''} ${order.workcenterName ?? ''}`.toLowerCase().includes(needle));
  }, [state.data, filter, query]);
  return <ListScreen title={t('Work orders')} back items={rows} keyExtractor={(order) => order.id}
    toolbar={<View style={{ gap: theme.space(3) }}>
      <SearchField value={query} onChange={setQuery} placeholder={t('Number, item or project')} />
      <FilterChips value={filter} onChange={setFilter} options={[{ value: 'making', label: t('Making') }, { value: 'ready', label: t('Ready') }, { value: 'planned', label: t('Planned') }, { value: 'all', label: t('All') }]} />
    </View>}
    loading={state.isLoading} error={state.error ? errorMessage(state.error, t('Work orders could not be loaded.')) : null} onRetry={() => void state.refetch()}
    onRefresh={() => void state.refetch()} refreshing={state.isRefetching}
    empty={<Empty icon={Factory} title={t('No work orders here')} />}
    renderItem={(order, _, first) => <ListRow first={first} title={order.title} onPress={() => router.push(`/factory/${order.id}`)}
      detail={[workOrderNumber(order.number), order.projectReference, order.workcenterName].filter(Boolean).join(' · ')}
      meta={<View style={{ gap: 4, marginTop: 6 }}>
        <Progress value={num(order.quantity) ? num(order.passed || order.made) / num(order.quantity) : 0} tone={order.status === 'ready' ? 'success' : 'action'} />
        <Text variant="caption" tone="tertiary">{t('{done} of {total} {unit}', { done: order.passed || order.made, total: order.quantity, unit: order.unit })}</Text>
      </View>}
      trailing={<StatusChip status={order.status} />} />} />;
}

type Dialog = 'report' | 'check' | 'dispatch' | { decide: string } | null;

/** One work order: what's made, checked and left; report output, check quality, approve reports and send to site. */
export function WorkOrderScreen() {
  const t = useT();
  const format = useFormat();
  const toast = useToast();
  const api = useApi();
  const session = useSession();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useQuery({ queryKey: factoryKeys.order(api.workspaceId, id), queryFn: () => api.get<OrderDetail>(`factory/orders/${id}`) });
  const command = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.send<OrderDetail>(`factory/orders/${id}`, 'POST', body),
    onSuccess: (next) => {
      if (next && typeof next === 'object' && 'order' in next) queryClient.setQueryData(factoryKeys.order(api.workspaceId, id), next);
      else void detail.refetch();
      void queryClient.invalidateQueries({ queryKey: factoryKeys.state(api.workspaceId) });
    },
  });
  const [dialog, setDialog] = useState<Dialog>(null);
  if (detail.isLoading) return <Screen back><Loading shape="record" count={3} /></Screen>;
  if (detail.error || !detail.data) return <Screen back><Failure message={errorMessage(detail.error, t('This work order could not be loaded.'))} onRetry={() => void detail.refetch()} /></Screen>;
  const data = detail.data;
  const order = data.order;
  const run = async (body: Record<string, unknown>, done: string) => {
    try { await command.mutateAsync(body); toast.success(done); setDialog(null); }
    catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  const canReport = data.canReport && order.status === 'in_production' && num(order.left) > 0;
  const canCheck = data.canApprove && data.settings.requireCheck && num(order.toCheck) > 0 && ['in_production', 'ready'].includes(order.status);
  const canDispatch = (data.canManage || data.canIssue) && num(data.atFactory) > 0 && !!order.projectId;
  const pendingReports = data.reports.filter((report) => report.status === 'pending');
  const primary = order.status === 'released' && data.canManage
    ? <Button label={t('Start')} icon={Play} variant="primary" size="lg" full loading={command.isPending} onPress={() => run({ action: 'start', version: order.version }, t('Started'))} />
    : canReport ? <Button label={t('Report output')} icon={Hammer} variant="primary" size="lg" full onPress={() => setDialog('report')} />
    : canCheck ? <Button label={t('Check quality')} icon={ClipboardCheck} variant="primary" size="lg" full onPress={() => setDialog('check')} />
    : canDispatch ? <Button label={t('Send to site')} icon={Truck} variant="primary" size="lg" full onPress={() => setDialog('dispatch')} /> : undefined;
  return <Screen back title={order.title} subtitle={[workOrderNumber(order.number), order.projectReference].filter(Boolean).join(' · ')} footer={primary}
    onRefresh={() => void detail.refetch()} refreshing={detail.isRefetching}>
    <Row gap={2}><StatusChip status={order.status} />{order.workcenterName ? <Text variant="caption" tone="secondary">{order.workcenterName}</Text> : null}</Row>
    {order.status === 'on_hold' && order.holdReason ? <Banner tone="warning" title={t('On hold')} detail={order.holdReason} /> : null}
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        {[[t('Made'), order.made], [t('Checked'), order.passed], [t('To check'), order.toCheck], [t('Left'), order.left]].map(([label, value]) => <View key={label} style={{ alignItems: 'center', gap: 2 }}>
          <Text variant="number">{format.number(value, 2)}</Text><Text variant="caption" tone="secondary">{label}</Text>
        </View>)}
      </Row>
      <Progress value={num(order.quantity) ? num(order.passed || order.made) / num(order.quantity) : 0} />
      <Text variant="caption" tone="secondary">{t('{total} {unit} ordered', { total: format.number(order.quantity, 2), unit: order.unit })}{num(order.scrapped) ? ` · ${t('{count} scrapped', { count: format.number(order.scrapped, 2) })}` : ''}</Text>
    </Card>
    {secondaryActions({ canReport, canCheck, canDispatch, primary: order.status === 'released' ? 'start' : canReport ? 'report' : canCheck ? 'check' : 'dispatch', setDialog, t })}
    <Section>
      {order.specification ? <Fact first label={t('Specification')} value={order.specification} /> : null}
      {order.packageName ? <Fact first={!order.specification} label={t('Package')} value={order.packageName} /> : null}
      {order.plannedStart || order.plannedEnd ? <Fact label={t('Planned')} value={[format.day(order.plannedStart), format.day(order.plannedEnd)].filter(Boolean).join(' – ')} /> : null}
      {order.drawingRef ? <Fact label={t('Drawing')} value={order.drawingRef} /> : null}
      {num(data.atFactory) ? <Fact label={t('At the factory')} value={`${format.number(data.atFactory, 2)} ${order.unit}`} /> : null}
    </Section>
    {data.reports.length ? <Section title={t('Output')}>
      {data.reports.map((report, index) => <ListRow key={report.id} first={index === 0} title={t('{good} good · {scrap} scrap', { good: format.number(report.good, 2), scrap: format.number(report.scrap, 2) })}
        detail={[report.reportedByName, format.when(report.reportedAt), report.hours ? t('{hours} h', { hours: report.hours }) : null, report.note].filter(Boolean).join(' · ')}
        trailing={report.status === 'pending' && data.canApprove && report.reportedBy !== session.userId
          ? <Button size="sm" label={t('Decide')} onPress={() => setDialog({ decide: report.id })} /> : <StatusChip status={report.status === 'refused' ? 'rejected' : report.status} />} />)}
    </Section> : null}
    {data.checks.length ? <Section title={t('Quality checks')}>
      {data.checks.map((check, index) => <ListRow key={check.id} first={index === 0} title={t('{passed} passed · {failed} failed', { passed: format.number(check.passed, 2), failed: format.number(check.failed, 2) })}
        detail={[check.checkedByName, format.when(check.checkedAt), check.failReason].filter(Boolean).join(' · ')} />)}
    </Section> : null}
    {data.dispatches.length ? <Section title={t('Sent to site')}>
      {data.dispatches.map((move, index) => <ListRow key={move.id} first={index === 0} icon={Truck} title={t('Move #{number}', { number: move.number })} detail={[`${format.number(move.quantity, 2)} ${order.unit}`, move.sentOn ? format.day(move.sentOn) : null].filter(Boolean).join(' · ')}
        trailing={<StatusChip status={move.status} />} />)}
    </Section> : null}
    {pendingReports.length && !data.canApprove ? <Banner tone="info" title={t('{count} reports wait for approval', { count: pendingReports.length })} /> : null}

    <ReportSheet open={dialog === 'report'} onClose={() => setDialog(null)} left={num(order.left)} unit={order.unit} busy={command.isPending}
      onSubmit={(body) => run({ action: 'report', ...body }, t('Output reported'))} />
    <CheckSheet open={dialog === 'check'} onClose={() => setDialog(null)} toCheck={num(order.toCheck)} unit={order.unit} busy={command.isPending}
      onSubmit={(body) => run({ action: 'check', ...body }, t('Check saved'))} />
    <DispatchSheet open={dialog === 'dispatch'} onClose={() => setDialog(null)} available={num(data.atFactory)} unit={order.unit} busy={command.isPending}
      onSubmit={(body) => run({ action: 'dispatch', ...body }, t('Sent to site'))} />
    <DecideSheet open={typeof dialog === 'object' && !!dialog} onClose={() => setDialog(null)} busy={command.isPending}
      onSubmit={(decision, note) => run({ action: 'decide_report', version: order.version, reportId: (dialog as { decide: string }).decide, decision, note }, decision === 'approve' ? t('Approved') : t('Refused'))} />
  </Screen>;
}

function secondaryActions({ canReport, canCheck, canDispatch, primary, setDialog, t }: { canReport: boolean; canCheck: boolean; canDispatch: boolean; primary: string; setDialog: (dialog: Dialog) => void; t: (key: string) => string }) {
  const actions = [
    canReport && primary !== 'report' ? <Button key="report" size="sm" label={t('Report output')} icon={Hammer} onPress={() => setDialog('report')} /> : null,
    canCheck && primary !== 'check' ? <Button key="check" size="sm" label={t('Check quality')} icon={ClipboardCheck} onPress={() => setDialog('check')} /> : null,
    canDispatch && primary !== 'dispatch' ? <Button key="dispatch" size="sm" label={t('Send to site')} icon={Truck} onPress={() => setDialog('dispatch')} /> : null,
  ].filter(Boolean);
  return actions.length ? <Row gap={2} wrap>{actions}</Row> : null;
}

function ReportSheet({ open, onClose, left, unit, busy, onSubmit }: { open: boolean; onClose: () => void; left: number; unit: string; busy: boolean; onSubmit: (body: Record<string, unknown>) => void }) {
  const t = useT();
  const [good, setGood] = useState('');
  const [scrap, setScrap] = useState('');
  const [scrapReason, setScrapReason] = useState('');
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const id = useRef(Crypto.randomUUID());
  const invalid = num(good) > left || (num(good) <= 0 && num(scrap) <= 0) || (num(scrap) > 0 && !scrapReason.trim()) || (!!hours && (num(hours) <= 0 || num(hours) > 1000));
  return <Sheet open={open} onClose={onClose} title={t('Report output')}
    footer={<Button label={t('Report')} variant="primary" size="lg" full loading={busy} disabled={invalid} onPress={() => {
      onSubmit({ id: id.current, good: cleanDecimal(good || '0', 4), scrap: cleanDecimal(scrap || '0', 4), ...(num(scrap) ? { scrapReason: scrapReason.trim() } : {}), ...(hours ? { hours: cleanDecimal(hours, 2) } : {}), note: note.trim() });
      id.current = Crypto.randomUUID();
    }} />}>
    <Stepper label={t('Good')} value={good} onChange={setGood} unit={unit} places={4} max={left} hint={t('{count} left to make', { count: left })} error={num(good) > left ? t('More than is left') : undefined} />
    <Stepper label={t('Scrap')} value={scrap} onChange={setScrap} unit={unit} places={4} />
    {num(scrap) > 0 ? <TextField label={t('Why scrapped')} value={scrapReason} onChangeText={setScrapReason} maxLength={500} /> : null}
    <Stepper label={t('Hours')} value={hours} onChange={setHours} step={0.5} places={2} unit={t('h')} />
    <TextField label={t('Note')} value={note} onChangeText={setNote} maxLength={2000} placeholder={t('Optional')} />
  </Sheet>;
}

function CheckSheet({ open, onClose, toCheck, unit, busy, onSubmit }: { open: boolean; onClose: () => void; toCheck: number; unit: string; busy: boolean; onSubmit: (body: Record<string, unknown>) => void }) {
  const t = useT();
  const [passed, setPassed] = useState(String(toCheck));
  const [failed, setFailed] = useState('0');
  const [reason, setReason] = useState('');
  const id = useRef(Crypto.randomUUID());
  const invalid = num(passed) + num(failed) > toCheck || num(passed) + num(failed) <= 0 || (num(failed) > 0 && !reason.trim());
  return <Sheet open={open} onClose={onClose} title={t('Check quality')}
    footer={<Button label={t('Save check')} variant="primary" size="lg" full loading={busy} disabled={invalid} onPress={() => {
      onSubmit({ id: id.current, passed: cleanDecimal(passed || '0', 4), failed: cleanDecimal(failed || '0', 4), failReason: num(failed) ? reason.trim() : '' });
      id.current = Crypto.randomUUID();
    }} />}>
    <Stepper label={t('Passed')} value={passed} onChange={setPassed} unit={unit} places={4} max={toCheck} hint={t('{count} waiting to check', { count: toCheck })} />
    <Stepper label={t('Failed')} value={failed} onChange={setFailed} unit={unit} places={4} max={toCheck} />
    {num(failed) > 0 ? <TextField label={t('What failed')} value={reason} onChangeText={setReason} maxLength={1000} multiline /> : null}
  </Sheet>;
}

function DispatchSheet({ open, onClose, available, unit, busy, onSubmit }: { open: boolean; onClose: () => void; available: number; unit: string; busy: boolean; onSubmit: (body: Record<string, unknown>) => void }) {
  const t = useT();
  const [quantity, setQuantity] = useState(String(available));
  const [note, setNote] = useState('');
  const id = useRef(Crypto.randomUUID());
  return <Sheet open={open} onClose={onClose} title={t('Send to site')}
    footer={<Button label={t('Send')} variant="primary" size="lg" full loading={busy} disabled={num(quantity) <= 0 || num(quantity) > available} onPress={() => {
      onSubmit({ id: id.current, quantity: cleanDecimal(quantity, 4), note: note.trim() });
      id.current = Crypto.randomUUID();
    }} />}>
    <Stepper label={t('Quantity')} value={quantity} onChange={setQuantity} unit={unit} places={4} max={available} hint={t('{count} ready at the factory', { count: available })} />
    <TextField label={t('Note')} value={note} onChangeText={setNote} maxLength={1000} placeholder={t('Vehicle, driver…')} />
  </Sheet>;
}

function DecideSheet({ open, onClose, busy, onSubmit }: { open: boolean; onClose: () => void; busy: boolean; onSubmit: (decision: 'approve' | 'refuse', note: string) => void }) {
  const t = useT();
  const [note, setNote] = useState('');
  return <Sheet open={open} onClose={onClose} title={t('Output report')}
    footer={<Row gap={2}>
      <Button label={t('Refuse')} variant="secondary" size="lg" disabled={!note.trim() || busy} onPress={() => onSubmit('refuse', note.trim())} />
      <View style={{ flex: 1 }}><Button label={t('Approve')} variant="primary" size="lg" full loading={busy} onPress={() => onSubmit('approve', note.trim())} /></View>
    </Row>}>
    <TextField label={t('Note')} value={note} onChangeText={setNote} maxLength={500} placeholder={t('Needed to refuse')} />
  </Sheet>;
}
