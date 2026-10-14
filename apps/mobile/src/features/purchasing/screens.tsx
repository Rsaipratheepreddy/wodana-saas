import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Mail, PackageCheck, Phone, ScanLine, ShoppingCart, Truck } from 'lucide-react-native';
import { errorMessage, useApi } from '../../core/api';
import { appRouteFor } from '../../core/deep-links';
import { useFormat } from '../../core/format';
import { haptic } from '../../core/haptics';
import { key, useT } from '../../core/i18n';
import type { LocalPhoto } from '../../core/media';
import { useOutbox, usePending } from '../../core/outbox';
import { DateField } from '../../ui/date-field';
import { FilterChips, SearchField, SegmentedControl, SelectField, Stepper, TextField, cleanDecimal } from '../../ui/fields';
import { Banner, Empty, Failure, Fact, ListRow, ListScreen, Loading, Progress, Screen, Section } from '../../ui/layout';
import { PhotoGrid } from '../../ui/photos';
import { Button, Row, Stack, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { purchasingKeys, receiptPhotoPath, useDeliveries, useOrder, useOrders, useReceipt, useReceivingForm, useTransfer, type ExpectedOrder, type OrderRow, type Receipt, type ReceiptLine } from './api';
import type { ReceiptPayload } from './outbox';
import { placeOption } from './receiving-model';

const REJECT_KIND: Array<{ value: string; label: string }> = [
  { value: 'damaged', label: key('Damaged') }, { value: 'defective', label: key('Defective') }, { value: 'wrong_item', label: key('Wrong item') },
  { value: 'wrong_spec', label: key('Wrong spec') }, { value: 'other', label: key('Other') },
];
const num = (value: string | number | null | undefined) => Number(value ?? 0) || 0;

/** Deliveries: what's expected (receive it), what waits for inspection, and what came in lately. */
export function DeliveriesScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const deliveries = useDeliveries();
  const [view, setView] = useState<'expected' | 'inspect' | 'received'>('expected');
  const data = deliveries.data;
  const today = format.today();
  const receiptRow = (receipt: Receipt, first: boolean) => <ListRow first={first} icon={PackageCheck} title={receipt.supplierName} onPress={() => router.push(`/purchasing/receipt/${receipt.id}`)}
    detail={[receipt.orderNumber, receipt.locationName, format.day(receipt.receivedOn)].filter(Boolean).join(' · ')}
    trailing={num(receipt.pending) ? <StatusChip status="needs_review" label={t('To inspect')} /> : num(receipt.rejected) ? <StatusChip status="rejected" label={t('Part rejected')} /> : <StatusChip status="received" />} />;
  const items: Array<{ id: string; order?: ExpectedOrder; receipt?: Receipt }> = view === 'expected'
    ? (data?.expected ?? []).map((order) => ({ id: order.id, order }))
    : (view === 'inspect' ? data?.inspection ?? [] : data?.received ?? []).map((receipt) => ({ id: receipt.id, receipt }));
  return <ListScreen title={t('Deliveries')} back items={items} keyExtractor={(item) => item.id}
    toolbar={<SegmentedControl value={view} onChange={setView} options={[
      { value: 'expected', label: t('Expected') }, { value: 'inspect', label: data?.inspection.length ? t('Inspect · {count}', { count: data.inspection.length }) : t('Inspect') }, { value: 'received', label: t('Received') },
    ]} />}
    loading={deliveries.isLoading} error={deliveries.error ? errorMessage(deliveries.error, t('Deliveries could not be loaded.')) : null} onRetry={() => void deliveries.refetch()}
    onRefresh={() => void deliveries.refetch()} refreshing={deliveries.isRefetching}
    // Camera first (D-46): the code on the printed order or move opens what arrived.
    footer={data?.canReceive ? <Button label={t('Scan to receive')} icon={ScanLine} variant="primary" size="lg" full onPress={() => router.push('/purchasing/scan')} /> : undefined}
    empty={<Empty icon={Truck} title={view === 'expected' ? t('Nothing expected') : view === 'inspect' ? t('Nothing to inspect') : t('Nothing received yet')} />}
    renderItem={(item, _, first) => item.order
      ? <ListRow first={first} icon={Truck} title={item.order.supplierName}
        detail={[item.order.number, item.order.projects.map((project) => project.reference).join(', '), t('{count} lines', { count: item.order.linesLeft })].filter(Boolean).join(' · ')}
        meta={item.order.due ? <Text variant="caption" tone={item.order.due < today ? 'danger' : 'tertiary'}>{t('Due {day}', { day: format.day(item.order.due) })}</Text> : undefined}
        trailing={item.order.due && item.order.due <= today ? <StatusChip status={item.order.due < today ? 'overdue' : 'pending'} label={item.order.due < today ? t('Late') : t('Today')} /> : undefined}
        onPress={() => router.push(data?.canReceive ? `/purchasing/receive/${item.order!.id}` : `/purchasing/order/${item.order!.id}`)} />
      : receiptRow(item.receipt!, first)} />;
}

const OPEN: OrderRow['status'][] = ['approved', 'sent', 'confirmed', 'partly_received'];

/** Purchase orders: open ones first, searchable by supplier, number or project. */
export function OrdersScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const orders = useOrders();
  const [filter, setFilter] = useState<'open' | 'waiting' | 'done'>('open');
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (orders.data?.orders ?? [])
      .filter((order) => (filter === 'open' ? OPEN.includes(order.status) : filter === 'waiting' ? ['draft', 'pending_approval'].includes(order.status) : ['received', 'closed', 'cancelled'].includes(order.status)))
      .filter((order) => !needle || `${order.number} ${order.supplierName} ${order.projects.map((project) => project.reference).join(' ')}`.toLowerCase().includes(needle));
  }, [orders.data, filter, query]);
  return <ListScreen title={t('Orders')} back items={rows} keyExtractor={(order) => order.id}
    toolbar={<View style={{ gap: theme.space(3) }}>
      <SearchField value={query} onChange={setQuery} placeholder={t('Supplier, number or project')} />
      <FilterChips value={filter} onChange={setFilter} options={[{ value: 'open', label: t('Open') }, { value: 'waiting', label: t('Not sent') }, { value: 'done', label: t('Done') }]} />
    </View>}
    loading={orders.isLoading} error={orders.error ? errorMessage(orders.error, t('Orders could not be loaded.')) : null} onRetry={() => void orders.refetch()}
    onRefresh={() => void orders.refetch()} refreshing={orders.isRefetching}
    empty={<Empty icon={ShoppingCart} title={query ? t('Nothing matches') : t('No orders here')} />}
    renderItem={(order, _, first) => <ListRow first={first} title={order.supplierName} onPress={() => router.push(`/purchasing/order/${order.id}`)}
      detail={[order.number, order.projects.map((project) => project.reference).join(', '), order.promisedDate || order.expectedDate ? t('Due {day}', { day: format.day(order.promisedDate ?? order.expectedDate) }) : null].filter(Boolean).join(' · ')}
      trailing={<StatusChip status={order.status} />} />} />;
}

/** One order: its supplier (call or email), what's still to come per line, and what has arrived. */
export function OrderScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  if (order.isLoading) return <Screen back><Loading shape="record" count={4} /></Screen>;
  if (order.error || !order.data) return <Screen back><Failure message={errorMessage(order.error, t('This order could not be loaded.'))} onRetry={() => void order.refetch()} /></Screen>;
  const { order: head, lines, receipts, supplier, canReceive } = order.data;
  const receivable = canReceive && ['sent', 'confirmed', 'partly_received'].includes(head.status);
  return <Screen back title={head.supplierName} subtitle={`${head.number} · ${head.projects.map((project) => project.reference).join(', ')}`} onRefresh={() => void order.refetch()} refreshing={order.isRefetching}
    footer={receivable ? <Button label={t('Receive delivery')} icon={PackageCheck} variant="primary" size="lg" full onPress={() => router.push(`/purchasing/receive/${head.id}`)} /> : undefined}>
    <Row gap={2}><StatusChip status={head.status} />{head.promisedDate || head.expectedDate ? <Text variant="caption" tone="secondary">{t('Due {day}', { day: format.day(head.promisedDate ?? head.expectedDate) })}</Text> : null}</Row>
    {supplier && (supplier.phone || supplier.email) ? <Row gap={2}>
      {supplier.phone ? <Button label={t('Call')} icon={Phone} onPress={() => void Linking.openURL(`tel:${supplier.phone}`)} /> : null}
      {supplier.email ? <Button label={t('Email')} icon={Mail} onPress={() => void Linking.openURL(`mailto:${supplier.email}?subject=${encodeURIComponent(head.number)}`)} /> : null}
    </Row> : null}
    <Section title={t('Lines')}>
      {lines.map((line, index) => {
        const ordered = num(line.quantity) - num(line.cancelled);
        const done = num(line.accepted);
        return <View key={line.id}>
          <ListRow first={index === 0} title={line.description} detail={[line.specification, line.projectReference].filter(Boolean).join(' · ')}
            meta={<View style={{ gap: 6, marginTop: 6 }}>
              <Progress value={ordered ? done / ordered : 0} tone={done >= ordered ? 'success' : 'action'} />
              <Text variant="caption" tone="secondary">{t('{done} of {total} {unit} arrived', { done: format.number(done, 2), total: format.number(ordered, 2), unit: line.unit })}{num(line.pending) ? ` · ${t('{count} to inspect', { count: format.number(line.pending, 2) })}` : ''}{num(line.rejected) ? ` · ${t('{count} rejected', { count: format.number(line.rejected, 2) })}` : ''}</Text>
            </View>} />
        </View>;
      })}
    </Section>
    {receipts.length ? <Section title={t('Deliveries')}>
      {receipts.map((receipt, index) => <ListRow key={receipt.id} first={index === 0} icon={PackageCheck} title={format.day(receipt.receivedOn)} detail={[receipt.locationName, receipt.receivedByName, receipt.deliveryNote].filter(Boolean).join(' · ')}
        onPress={() => router.push(`/purchasing/receipt/${receipt.id}`)} />)}
    </Section> : null}
  </Screen>;
}

type LineDraft = { received: string; noted: string; rejected: string; rejectKind: string | null; rejectReason: string };

/** Receive a delivery: where it came, the quantities per line (and any rejected with why), the delivery note and photos. Works offline. */
export function ReceiveScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const toast = useToast();
  const outbox = useOutbox();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const form = useReceivingForm(orderId);
  const pending = usePending(`order:${orderId}`);
  const receiptId = useRef(Crypto.randomUUID()).current;
  const [place, setPlace] = useState<string | null>(null);
  const [receivedOn, setReceivedOn] = useState(format.today());
  const [deliveryNote, setDeliveryNote] = useState('');
  const [handedOverBy, setHandedOverBy] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [lines, setLines] = useState<Record<string, LineDraft>>({});
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  useEffect(() => { if (form.data && !place) setPlace(form.data.defaultPlace ?? form.data.places[0]?.key ?? null); }, [form.data, place]);
  if (form.isLoading) return <Screen back title={t('Receive delivery')}><Loading shape="form" count={4} /></Screen>;
  if (form.error || !form.data) return <Screen back title={t('Receive delivery')}><Failure message={errorMessage(form.error, t('This order could not be loaded.'))} onRetry={() => void form.refetch()} /></Screen>;
  const data = form.data;
  const open = data.lines.filter((line) => num(line.receivable) > 0);
  const get = (id: string): LineDraft => lines[id] ?? { received: '', noted: '', rejected: '', rejectKind: null, rejectReason: '' };
  const set = (id: string, patch: Partial<LineDraft>) => setLines((current) => ({ ...current, [id]: { ...get(id), ...patch } }));
  const any = open.some((line) => num(get(line.id).received) > 0);
  const siteDelivery = (data.places.find((item) => item.key === place)?.kind ?? '') === 'site';
  const needPhoto = data.requireSitePhoto && siteDelivery && !photos.length;
  const invalid = open.some((line) => {
    const draft = get(line.id);
    return num(draft.rejected) > num(draft.received) || (num(draft.rejected) > 0 && (!draft.rejectKind || !draft.rejectReason.trim()));
  });
  const send = async () => {
    const payload: ReceiptPayload = {
      orderId, photoIds: photos.map((photo) => photo.id),
      receipt: {
        orderId, place, receivedOn, deliveryNote: deliveryNote.trim().slice(0, 120), notes: notes.trim().slice(0, 2000), handedOverBy: handedOverBy.trim().slice(0, 200),
        lines: open.filter((line) => num(get(line.id).received) > 0).map((line) => {
          const draft = get(line.id);
          const rejected = data.requireInspection ? 0 : num(draft.rejected);
          return {
            orderLineId: line.id, received: cleanDecimal(draft.received, 4), ...(draft.noted ? { noted: cleanDecimal(draft.noted, 4) } : {}),
            ...(data.requireInspection ? {} : { rejected: String(rejected), accepted: String(Math.round((num(draft.received) - rejected) * 10000) / 10000) }),
            ...(rejected > 0 ? { rejectKind: draft.rejectKind, rejectReason: draft.rejectReason.trim().slice(0, 500) } : {}),
          };
        }),
      },
    };
    try {
      await outbox.enqueue({ id: receiptId, kind: 'purchasing.receipt', title: t('Delivery · {supplier}', { supplier: data.order.supplierName }), detail: data.order.number, scope: `order:${orderId}`, payload },
        photos.map((photo) => ({ key: photo.id, uri: photo.uri, name: photo.name, type: photo.type })));
      toast.success(t('Delivery recorded'));
      router.back();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  return <Screen back title={t('Receive delivery')} subtitle={`${data.order.supplierName} · ${data.order.number}`} keyboard
    footer={<Button label={t('Record delivery')} variant="primary" size="lg" full disabled={!any || invalid || needPhoto || !place || !!pending.length} onPress={send} />}>
    {pending.length ? <Banner tone="info" title={t('A delivery for this order is waiting to send')} /> : null}
    {data.requireInspection ? <Banner tone="neutral" title={t('Goods wait for inspection after receiving')} /> : null}
    <SelectField label={t('Delivered to')} value={place} onChange={setPlace} options={data.places.map((item) => placeOption(item, t))} />
    <DateField label={t('Received on')} value={receivedOn} onChange={setReceivedOn} max={format.today()} />
    <Row style={{ justifyContent: 'space-between' }}>
      <Text variant="overline" tone="secondary">{t('What arrived')}</Text>
      <Button size="sm" variant="ghost" label={t('All arrived')} onPress={() => setLines(Object.fromEntries(open.map((line) => [line.id, { ...get(line.id), received: String(num(line.outstanding) || num(line.receivable)) }])))} />
    </Row>
    {open.length ? open.map((line) => {
      const draft = get(line.id);
      return <View key={line.id} style={{ gap: theme.space(2), padding: theme.space(4), borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.structuralDivider, backgroundColor: theme.colors.surface }}>
        <Text variant="label">{line.description}</Text>
        <Text variant="caption" tone="secondary">{[line.specification, line.projectReference, t('{count} {unit} to come', { count: format.number(line.outstanding, 2), unit: line.unit })].filter(Boolean).join(' · ')}</Text>
        <Stepper value={draft.received} onChange={(value) => set(line.id, { received: value })} unit={line.unit} places={4} max={num(line.receivable)}
          error={num(draft.received) > num(line.receivable) ? t('More than this order allows') : undefined} />
        {!data.requireInspection && num(draft.received) > 0 ? <Button size="sm" variant="ghost" label={num(draft.rejected) ? t('{count} rejected · change', { count: draft.rejected }) : t('Reject some')} onPress={() => setRejectFor(line.id)} /> : null}
      </View>;
    }) : <Empty icon={PackageCheck} title={t('Nothing left to receive')} />}
    <TextField label={t('Delivery note number')} value={deliveryNote} onChangeText={setDeliveryNote} maxLength={120} placeholder={t('Optional')} />
    <TextField label={t('Handed over by')} value={handedOverBy} onChangeText={setHandedOverBy} maxLength={200} placeholder={t('Driver or supplier name')} />
    <Section flat title={t('Photos')}>
      <PhotoGrid photos={photos.map((photo) => ({ key: photo.id, uri: photo.uri }))} onAdd={(next) => setPhotos((list) => [...list, ...next].slice(0, 10))}
        onRemove={(key) => setPhotos((list) => list.filter((photo) => photo.id !== key))} />
      {needPhoto ? <Text variant="caption" tone="warning">{t('A photo is needed for deliveries to site.')}</Text> : null}
    </Section>
    <TextField label={t('Notes')} value={notes} onChangeText={setNotes} multiline maxLength={2000} placeholder={t('Optional')} />
    <RejectSheet open={!!rejectFor} draft={rejectFor ? get(rejectFor) : null} unit={data.lines.find((line) => line.id === rejectFor)?.unit ?? ''} onClose={() => setRejectFor(null)}
      onSave={(patch) => { if (rejectFor) set(rejectFor, patch); setRejectFor(null); }} />
  </Screen>;
}

function RejectSheet({ open, draft, unit, onClose, onSave }: { open: boolean; draft: LineDraft | null; unit: string; onClose: () => void; onSave: (patch: Partial<LineDraft>) => void }) {
  const t = useT();
  const [quantity, setQuantity] = useState('');
  const [kind, setKind] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => { if (open && draft) { setQuantity(draft.rejected); setKind(draft.rejectKind); setReason(draft.rejectReason); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const over = num(quantity) > num(draft?.received);
  return <Sheet open={open} onClose={onClose} title={t('Reject some')}
    footer={<Button label={t('Done')} variant="primary" size="lg" full disabled={over || (num(quantity) > 0 && (!kind || !reason.trim()))} onPress={() => onSave({ rejected: quantity, rejectKind: kind, rejectReason: reason })} />}>
    <Stepper label={t('Rejected')} value={quantity} onChange={setQuantity} unit={unit} places={4} max={num(draft?.received)} error={over ? t('More than arrived') : undefined} />
    <SelectField label={t('Why')} value={kind} onChange={setKind} options={REJECT_KIND.map((option) => ({ value: option.value, label: t(option.label) }))} />
    <TextField label={t('What’s wrong')} value={reason} onChangeText={setReason} maxLength={500} multiline />
  </Sheet>;
}

/** A delivery received: lines, photos, and the inspection when goods wait for it. */
export function ReceiptScreen() {
  const t = useT();
  const format = useFormat();
  const toast = useToast();
  const api = useApi();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const receipt = useReceipt(id);
  const [inspecting, setInspecting] = useState(false);
  const addPhoto = useMutation({
    mutationFn: async (photos: LocalPhoto[]) => { for (const photo of photos) await api.upload(`purchasing/receipts/${id}/photos/${photo.id}`, 'POST', 'file', photo); },
    onSettled: () => queryClient.invalidateQueries({ queryKey: purchasingKeys.receipt(api.workspaceId, id) }),
    onError: (error) => toast.error(errorMessage(error, t('The photo could not be added. Try again.'))),
  });
  if (receipt.isLoading) return <Screen back><Loading shape="record" count={3} /></Screen>;
  if (receipt.error || !receipt.data) return <Screen back><Failure message={errorMessage(receipt.error, t('This delivery could not be loaded.'))} onRetry={() => void receipt.refetch()} /></Screen>;
  const { receipt: head, lines, photos } = receipt.data;
  const toInspect = receipt.data.canInspectThis && lines.some((line) => num(line.pending) > 0);
  return <Screen back title={head.supplierName} subtitle={[head.orderNumber, format.day(head.receivedOn)].filter(Boolean).join(' · ')} onRefresh={() => void receipt.refetch()} refreshing={receipt.isRefetching}
    footer={toInspect ? <Button label={t('Inspect')} variant="primary" size="lg" full onPress={() => setInspecting(true)} /> : undefined}>
    {head.reversedAt ? <Banner tone="warning" title={t('Reversed')} /> : null}
    {receipt.data.needsPhoto ? <Banner tone="warning" title={t('A photo is needed for deliveries to site.')} /> : null}
    <Section>
      <Fact first label={t('Delivered to')} value={head.locationName} />
      <Fact label={t('Received by')} value={head.receivedByName} />
      {head.deliveryNote ? <Fact label={t('Delivery note')} value={head.deliveryNote} /> : null}
      {head.inspectedByName ? <Fact label={t('Inspected by')} value={head.inspectedByName} /> : null}
      {head.notes ? <Fact label={t('Notes')} value={head.notes} /> : null}
    </Section>
    <Section title={t('Lines')}>
      {lines.map((line, index) => <ListRow key={line.id} first={index === 0} title={line.description}
        detail={[`${format.number(line.received, 2)} ${line.unit}`, num(line.accepted) ? t('{count} accepted', { count: format.number(line.accepted, 2) }) : null,
          num(line.rejected) ? t('{count} rejected', { count: format.number(line.rejected, 2) }) : null, num(line.pending) ? t('{count} to inspect', { count: format.number(line.pending, 2) }) : null, line.rejectReason].filter(Boolean).join(' · ')} />)}
    </Section>
    <Section flat title={t('Photos')}>
      <PhotoGrid photos={photos.map((photo) => ({ key: photo.id, path: receiptPhotoPath(photo.id) }))} onAdd={receipt.data.canReceive ? (next) => addPhoto.mutate(next) : undefined} />
    </Section>
    <InspectSheet open={inspecting} onClose={() => setInspecting(false)} lines={lines.filter((line) => num(line.pending) > 0)}
      onDone={() => { setInspecting(false); void queryClient.invalidateQueries({ queryKey: purchasingKeys.all(api.workspaceId) }); }} receiptId={id} />
  </Screen>;
}

/** Inspection: split what's waiting on each line into accepted and rejected (with why). Needs a connection. */
function InspectSheet({ open, onClose, lines, onDone, receiptId }: { open: boolean; onClose: () => void; lines: ReceiptLine[]; onDone: () => void; receiptId: string }) {
  const t = useT();
  const toast = useToast();
  const api = useApi();
  const [rejected, setRejected] = useState<Record<string, { quantity: string; kind: string | null; reason: string }>>({});
  const [busy, setBusy] = useState(false);
  const entry = (id: string) => rejected[id] ?? { quantity: '0', kind: null, reason: '' };
  const invalid = lines.some((line) => { const draft = entry(line.id); return num(draft.quantity) > num(line.pending) || (num(draft.quantity) > 0 && (!draft.kind || !draft.reason.trim())); });
  const save = async () => {
    setBusy(true);
    try {
      await api.send(`purchasing/receipts/${receiptId}/inspection`, 'POST', { lines: lines.map((line) => {
        const draft = entry(line.id);
        const reject = num(draft.quantity);
        return { id: line.id, accepted: String(Math.round((num(line.pending) - reject) * 10000) / 10000), rejected: String(reject), ...(reject ? { rejectKind: draft.kind, rejectReason: draft.reason.trim() } : {}) };
      }) });
      toast.success(t('Inspection saved'));
      onDone();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
    finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title={t('Inspect')} full footer={<Button label={t('Save inspection')} variant="primary" size="lg" full loading={busy} disabled={invalid} onPress={save} />}>
    <Text variant="caption" tone="secondary">{t('Everything is accepted unless you reject some.')}</Text>
    {lines.map((line) => {
      const draft = entry(line.id);
      return <Stack key={line.id} gap={2}>
        <Text variant="label">{line.description} · {line.pending} {line.unit}</Text>
        <Stepper label={t('Rejected')} value={draft.quantity} onChange={(value) => setRejected((current) => ({ ...current, [line.id]: { ...draft, quantity: value } }))} unit={line.unit} places={4} max={num(line.pending)} compact />
        {num(draft.quantity) > 0 ? <>
          <SelectField label={t('Why')} value={draft.kind} onChange={(value) => setRejected((current) => ({ ...current, [line.id]: { ...draft, kind: value } }))} options={REJECT_KIND.map((option) => ({ value: option.value, label: t(option.label) }))} />
          <TextField label={t('What’s wrong')} value={draft.reason} onChangeText={(value) => setRejected((current) => ({ ...current, [line.id]: { ...draft, reason: value } }))} maxLength={500} />
        </> : null}
      </Stack>;
    })}
  </Sheet>;
}

/** Goods moved to this site (from the factory or a store): confirm what arrived; anything short needs why. Needs a connection. */
export function MoveScreen() {
  const t = useT();
  const toast = useToast();
  const api = useApi();
  const router = useRouter();
  const format = useFormat();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const move = useTransfer(id);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [loss, setLoss] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (move.isLoading) return <Screen back><Loading shape="form" count={3} /></Screen>;
  if (move.error || !move.data) return <Screen back><Failure message={errorMessage(move.error, t('This move could not be loaded.'))} onRetry={() => void move.refetch()} /></Screen>;
  const data = move.data;
  const editable = data.transfer.status === 'in_transit' && data.canReceiveThis;
  const value = (lineId: string, quantity: string) => received[lineId] ?? quantity;
  const short = data.lines.filter((line) => num(value(line.id, line.quantity)) < num(line.quantity));
  const receive = async () => {
    setBusy(true);
    try {
      await api.send(`inventory/transfers/${id}`, 'POST', { action: 'receive', receivedOn: format.today(), lines: data.lines.map((line) => ({ id: line.id, received: cleanDecimal(value(line.id, line.quantity), 4), lossReason: (loss[line.id] ?? '').trim() })) });
      void queryClient.invalidateQueries({ queryKey: purchasingKeys.all(api.workspaceId) });
      toast.success(t('Received'));
      router.back();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
    finally { setBusy(false); }
  };
  return <Screen back title={t('Move #{number}', { number: data.transfer.number })} subtitle={[data.transfer.fromLocationName, data.transfer.toLocationName].filter(Boolean).join(' → ')} keyboard
    footer={editable ? <Button label={t('Confirm arrival')} variant="primary" size="lg" full loading={busy} disabled={short.some((line) => !(loss[line.id] ?? '').trim())} onPress={receive} /> : undefined}>
    <StatusChip status={data.transfer.status} />
    {data.lines.map((line) => <Stack key={line.id} gap={2}>
      <Text variant="label">{line.itemName}{line.projectReference ? ` · ${line.projectReference}` : ''}</Text>
      {editable ? <>
        <Stepper value={value(line.id, line.quantity)} onChange={(next) => setReceived((current) => ({ ...current, [line.id]: next }))} unit={line.unit} places={4} max={num(line.quantity)} />
        {num(value(line.id, line.quantity)) < num(line.quantity) ? <TextField label={t('Why is it short?')} value={loss[line.id] ?? ''} onChangeText={(next) => setLoss((current) => ({ ...current, [line.id]: next }))} maxLength={500} /> : null}
      </> : <Text variant="caption" tone="secondary">{`${format.number(line.received ?? line.quantity, 2)} / ${format.number(line.quantity, 2)} ${line.unit}`}{line.lossReason ? ` · ${line.lossReason}` : ''}</Text>}
    </Stack>)}
  </Screen>;
}

/**
 * Scan to receive (D-46), camera first: the code printed on an order or a move opens its receive screen. Codes that
 * aren't one of ours are ignored with a word; without the camera, the phone's settings are one tap away.
 */
export function ScanScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [unknown, setUnknown] = useState(false);
  const handled = useRef(false);
  const scanned = ({ data }: { data: string }) => {
    if (handled.current) return;
    const route = appRouteFor(data);
    if (!route || !/^\/purchasing\/(receive|move)\/[0-9a-fA-F-]{36}$/.test(route)) { setUnknown(true); return; }
    handled.current = true;
    haptic.success();
    router.replace(route as never);
  };
  if (!permission) return <Screen back title={t('Scan to receive')}><Loading shape="record" count={2} /></Screen>;
  if (!permission.granted) return <Screen back title={t('Scan to receive')}>
    <Empty icon={ScanLine} title={t('Allow the camera to scan')} detail={t('Scan the code on a printed order or move to receive it.')}
      action={permission.canAskAgain ? { label: t('Allow camera'), onPress: () => void requestPermission() } : { label: t('Open settings'), onPress: () => void Linking.openSettings() }} />
  </Screen>;
  return <Screen back title={t('Scan to receive')} scroll={false}>
    <View style={{ flex: 1, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surface }}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned} accessibilityLabel={t('Camera')} />
    </View>
    <Text variant="caption" tone={unknown ? 'danger' : 'secondary'} accessibilityLiveRegion="polite">
      {unknown ? t("That code isn't an order or a move. Scan the code on the printed order or move.") : t('Point the camera at the code on the printed order or move.')}
    </Text>
  </Screen>;
}
