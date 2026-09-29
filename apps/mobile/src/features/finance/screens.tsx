import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { ClipboardCheck, FileText, Receipt, Wallet } from 'lucide-react-native';
import { errorMessage } from '../../core/api';
import { useFormat } from '../../core/format';
import { key, useT } from '../../core/i18n';
import { Empty, Fact, Failure, ListRow, Loading, Screen, Section } from '../../ui/layout';
import { Button, Chip, Text } from '../../ui/primitives';
import { useBill, useClientInvoice, useFinanceOverview, usePaymentRun, useSupplier, useSupplierAccount, type Bill, type ClientInvoice } from './api';

/** One record's loading, failure and not-found states, the same on every finance screen. */
function useStates(query: { isLoading: boolean; error: unknown; refetch: () => unknown }, fallback: ReturnType<typeof key>) {
  const t = useT();
  if (query.isLoading) return <Screen back><Loading shape="record" /></Screen>;
  if (query.error) return <Screen back><Failure message={errorMessage(query.error, t(fallback))} onRetry={() => void query.refetch()} /></Screen>;
  return null;
}

/** Approving happens in Approvals, for the person whose turn it is. */
function ApprovalsFooter({ show }: { show: boolean }) {
  const t = useT();
  const router = useRouter();
  return show ? <Button label={t('Open in Approvals')} icon={ClipboardCheck} variant="primary" size="lg" full onPress={() => router.push('/approvals' as Href)} /> : null;
}

function invoiceState(invoice: ClientInvoice) {
  if (invoice.status === 'credited') return { label: key('Credited'), tone: 'neutral' as const };
  if (Number(invoice.balance) <= 0) return { label: key('Paid'), tone: 'success' as const };
  return invoice.overdue ? { label: key('Overdue'), tone: 'danger' as const } : { label: key('Open'), tone: 'info' as const };
}

function billState(bill: Bill) {
  if (bill.status === 'held') return { label: key('Held'), tone: 'warning' as const };
  if (bill.status === 'cancelled') return { label: key('Cancelled'), tone: 'neutral' as const };
  if (bill.status === 'draft') return { label: key('Draft'), tone: 'neutral' as const };
  return Number(bill.balance) <= 0 ? { label: key('Paid'), tone: 'success' as const } : { label: key('Approved'), tone: 'info' as const };
}

/** A client's tax invoice: who owes what, and by when. */
export function ClientInvoiceScreen() {
  const t = useT();
  const format = useFormat();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useClientInvoice(id);
  const states = useStates(query, key('Could not load the invoice.'));
  if (states) return states;
  const invoice = query.data?.invoice;
  if (!invoice) return <Screen back><Empty icon={Receipt} title={t('Invoice not found')} /></Screen>;
  const state = invoiceState(invoice);
  return <Screen back title={invoice.number} subtitle={invoice.customerName} onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
    <Chip label={t(state.label)} tone={state.tone} />
    <Section>
      <Fact first label={t('Balance')} value={format.money(invoice.balance, invoice.currency)} />
      <Fact label={t('Total')} value={format.money(invoice.total, invoice.currency)} />
      <Fact label={t('Paid')} value={format.money(invoice.paid, invoice.currency)} />
      <Fact label={t('Due')} value={format.day(invoice.dueDate)} />
      <Fact label={t('Milestone')} value={invoice.milestoneTitle} />
      {invoice.creditNoteNumber ? <Fact label={t('Credit note')} value={invoice.creditNoteNumber} /> : null}
    </Section>
    <Section>
      <ListRow first icon={FileText} title={invoice.projectReference} detail={t('Project')} onPress={() => router.push(`/projects/${invoice.projectId}` as Href)} />
    </Section>
  </Screen>;
}

/** A supplier's invoice: what's owed, and why it's held. */
export function BillScreen() {
  const t = useT();
  const format = useFormat();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useBill(id);
  const states = useStates(query, key('Could not load the supplier invoice.'));
  if (states) return states;
  const bill = query.data?.bill;
  if (!bill) return <Screen back><Empty icon={Receipt} title={t('Supplier invoice not found')} /></Screen>;
  const state = billState(bill);
  return <Screen back title={bill.number} subtitle={bill.supplierName} onRefresh={() => void query.refetch()} refreshing={query.isRefetching}
    footer={query.data?.canApproveThis ? <ApprovalsFooter show /> : undefined}>
    <Chip label={t(state.label)} tone={state.tone} />
    <Section>
      <Fact first label={t('Balance')} value={format.money(bill.balance, bill.currency)} />
      <Fact label={t('Total')} value={format.money(bill.total, bill.currency)} />
      <Fact label={t('Paid')} value={format.money(bill.paid, bill.currency)} />
      {bill.dueDate ? <Fact label={t('Due')} value={format.day(bill.dueDate)} /> : null}
      {Number(bill.retentionHeld) > 0 ? <Fact label={t('Retention held')} value={format.money(bill.retentionHeld, bill.currency)} /> : null}
      <Fact label={t('Company')} value={bill.companyName} />
      {bill.status === 'held' && bill.holdReasons ? <Fact label={t('Why it is held')} value={bill.holdReasons} /> : null}
    </Section>
    <Section>
      <ListRow first icon={Wallet} title={bill.supplierName} detail={t('Supplier account')} onPress={() => router.push(`/finance/supplier/${bill.vendorId}` as Href)} />
    </Section>
  </Screen>;
}

/** A payment run: how much goes out, to how many suppliers, and whose turn it is. */
export function PaymentRunScreen() {
  const t = useT();
  const format = useFormat();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = usePaymentRun(id);
  const states = useStates(query, key('Could not load the payment run.'));
  if (states) return states;
  const run = query.data?.run;
  if (!run) return <Screen back><Empty icon={Wallet} title={t('Payment run not found')} /></Screen>;
  const status: Record<typeof run.status, { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' }> = {
    draft: { label: key('Draft'), tone: 'neutral' }, submitted: { label: key('Waiting for approval'), tone: 'warning' }, approved: { label: key('Approved'), tone: 'info' },
    paid: { label: key('Paid'), tone: 'success' }, cancelled: { label: key('Cancelled'), tone: 'neutral' },
  };
  return <Screen back title={t('Payment run {number}', { number: run.number })} onRefresh={() => void query.refetch()} refreshing={query.isRefetching}
    footer={query.data?.canApproveThis ? <ApprovalsFooter show /> : undefined}>
    <Chip label={t(status[run.status].label)} tone={status[run.status].tone} />
    <Section>
      {run.totals.map((total, index) => <Fact key={total.currency} first={index === 0} label={t('Total')} value={format.money(total.amount, total.currency)} />)}
      <Fact first={!run.totals.length} label={t('Invoices')} value={format.number(run.invoices, 0)} />
      <Fact label={t('Suppliers')} value={format.number(run.suppliers, 0)} />
      <Fact label={t('Prepared by')} value={run.preparedByName} />
      {run.approvedByName ? <Fact label={t('Approved by')} value={run.approvedByName} /> : null}
      {run.paidOn ? <Fact label={t('Paid on')} value={format.day(run.paidOn)} /> : null}
    </Section>
  </Screen>;
}

/** What a supplier is owed, per company and currency, and their invoices still to pay. */
export function SupplierAccountScreen() {
  const t = useT();
  const format = useFormat();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useSupplierAccount(id);
  const states = useStates(query, key('Could not load the supplier account.'));
  if (states) return states;
  if (!query.data) return <Screen back><Empty icon={Wallet} title={t('Supplier not found')} /></Screen>;
  const { supplier, balances, bills } = query.data;
  const open = bills.filter((bill) => ['held', 'approved'].includes(bill.status) && Number(bill.balance) > 0);
  return <Screen back title={supplier.name} onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
    {balances.map((balance) => <Section key={`${balance.companyName}:${balance.currency}`} title={`${balance.companyName} · ${balance.currency}`}>
      <Fact first label={t('Owed')} value={format.money(balance.owed, balance.currency)} />
      {Number(balance.overdue) > 0 ? <Fact label={t('Overdue')} value={format.money(balance.overdue, balance.currency)} /> : null}
      {Number(balance.held) > 0 ? <Fact label={t('Held')} value={format.money(balance.held, balance.currency)} /> : null}
      {Number(balance.retention) > 0 ? <Fact label={t('Retention held')} value={format.money(balance.retention, balance.currency)} /> : null}
    </Section>)}
    <Section title={t('To pay')}>
      {open.length ? open.map((bill, index) => <ListRow key={bill.id} first={index === 0} icon={Receipt} title={bill.number}
        detail={[t(billState(bill).label), bill.dueDate ? t('Due {date}', { date: format.day(bill.dueDate) }) : null].filter(Boolean).join(' · ')}
        meta={<Text variant="caption" tone="secondary">{format.money(bill.balance, bill.currency)}</Text>} onPress={() => router.push(`/finance/bill/${bill.id}` as Href)} />)
        : <Empty title={t('Nothing to pay')} />}
    </Section>
  </Screen>;
}

/** A supplier's record for buyers: whether they're approved, their documents and open orders. */
export function SupplierScreen() {
  const t = useT();
  const format = useFormat();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useSupplier(id);
  const states = useStates(query, key('Could not load the supplier.'));
  if (states) return states;
  if (!query.data) return <Screen back><Empty icon={Wallet} title={t('Supplier not found')} /></Screen>;
  const { supplier, documents, openOrders } = query.data;
  const approval: Record<typeof supplier.approval, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
    pending: { label: key('Waiting for approval'), tone: 'warning' }, approved: { label: key('Approved'), tone: 'success' },
    not_approved: { label: key('Not approved'), tone: 'danger' }, on_hold: { label: key('On hold'), tone: 'danger' },
  };
  const current = documents.filter((document) => !document.replacedAt);
  const today = format.today();
  return <Screen back title={supplier.name} subtitle={supplier.contactName ?? undefined} onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
    <Chip label={t(approval[supplier.approval].label)} tone={approval[supplier.approval].tone} />
    {supplier.approvalNote ? <Section><Fact first label={t('Note')} value={supplier.approvalNote} /></Section> : null}
    <Section title={t('Documents')}>
      {current.length ? current.map((document, index) => <Fact key={document.id} first={index === 0} label={document.label || t('Document')}
        value={document.expiresOn ? (document.expiresOn < today ? t('Expired {date}', { date: format.day(document.expiresOn) }) : t('Until {date}', { date: format.day(document.expiresOn) })) : '—'} />)
        : <Empty title={t('No documents')} />}
    </Section>
    <Section title={t('Open orders')}>
      {openOrders.length ? openOrders.map((order, index) => <ListRow key={order.id} first={index === 0} icon={FileText} title={order.number}
        meta={<Text variant="caption" tone="secondary">{format.money(order.total, order.currency)}</Text>} onPress={() => router.push(`/purchasing/order/${order.id}` as Href)} />)
        : <Empty title={t('No open orders')} />}
    </Section>
  </Screen>;
}

/** Money still due in and out: client invoices unpaid and supplier invoices to pay, each to its record. */
export function FinanceScreen() {
  const t = useT();
  const format = useFormat();
  const router = useRouter();
  const query = useFinanceOverview();
  if (query.isLoading) return <Screen back title={t('Finance')}><Loading /></Screen>;
  if (query.error) return <Screen back title={t('Finance')}><Failure message={errorMessage(query.error, t('Could not load finance.'))} onRetry={() => void query.refetch()} /></Screen>;
  const { invoices, bills } = query.data ?? { invoices: null, bills: null };
  if (!invoices && !bills) return <Screen back title={t('Finance')}><Empty icon={Wallet} title={t('Finance isn’t on for you')} /></Screen>;
  return <Screen back title={t('Finance')} onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
    {invoices ? <Section title={t('Client invoices due')}>
      {invoices.length ? invoices.slice(0, 50).map((invoice, index) => <ListRow key={invoice.id} first={index === 0} icon={Receipt} title={`${invoice.number} · ${invoice.customerName}`}
        detail={[t(invoiceState(invoice).label), t('Due {date}', { date: format.day(invoice.dueDate) })].join(' · ')}
        meta={<Text variant="caption" tone="secondary">{format.money(invoice.balance, invoice.currency)}</Text>} onPress={() => router.push(`/finance/invoice/${invoice.id}` as Href)} />)
        : <Empty title={t('Nothing due from clients')} />}
    </Section> : null}
    {bills ? <Section title={t('Supplier invoices to pay')}>
      {bills.length ? bills.slice(0, 50).map((bill, index) => <ListRow key={bill.id} first={index === 0} icon={Receipt} title={`${bill.number} · ${bill.supplierName}`}
        detail={[t(billState(bill).label), bill.dueDate ? t('Due {date}', { date: format.day(bill.dueDate) }) : null].filter(Boolean).join(' · ')}
        meta={<Text variant="caption" tone="secondary">{format.money(bill.balance, bill.currency)}</Text>} onPress={() => router.push(`/finance/bill/${bill.id}` as Href)} />)
        : <Empty title={t('Nothing to pay')} />}
    </Section> : null}
  </Screen>;
}
