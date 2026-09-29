import type { HomeFocusItem, HomeFocusSource, HomeFunnelStage, HomeMetrics, HomeSummary } from '../../../../../packages/contracts/src/home';
import { isoDay } from '../../core/format-core';
import { key } from '../../core/i18n';

/**
 * Today on the phone mirrors the web's Home (`GET home/summary` and `GET home/metrics`), without native code (node
 * tests import it). Every section follows what the server sent for this person; nothing is guessed from a role name.
 */
export type Label = { key: string; values?: Record<string, string | number> };

/** What each Today item is about, in the web's words. */
export const SOURCE_REASON: Record<HomeFocusSource, string> = {
  follow_up: key('Follow-up'), response: key('First response'), unowned: key('No owner yet'), confirm_client: key('Confirm the client'), reply: key('Client reply'),
  work: key('Task'), delivery: key('Delivery'), invoice: key('Invoice'), production: key('Production'), quote_review: key('Quote review'),
  receipt: key('Payment to verify'), order_approval: key('Order approval'), design_review: key('Design review'), design_client: key('Client decision'),
  design_present: key('Ready to present'), design_revise: key('Changes requested'), petty_cash: key('Petty cash'), leave: key('Leave request'),
};

/** Items the approvals rows above already count ("N waiting for you", leave and time to approve): not listed twice. */
const COUNTED_ABOVE: ReadonlySet<HomeFocusSource> = new Set(['quote_review', 'receipt', 'order_approval', 'petty_cash', 'leave']);
export const focusItems = (summary: Pick<HomeSummary, 'focus'> | null | undefined) => (summary?.focus.items ?? []).filter((item) => !COUNTED_ABOVE.has(item.source));

const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * When an item is due, the web's way: "3 days late", "Due 09:30" (earlier today), "Today 16:00", "Today", or
 * "Since 12 Sep" for what waits on the person. `time` and `date` format an instant or a calendar day.
 */
export function dueLabel(item: Pick<HomeFocusItem, 'due' | 'urgency'>, today: string, timeZone: string, format: { time: (value: string) => string; date: (value: string) => string }): Label | null {
  if (!item.due) return null;
  const day = isDateOnly(item.due) ? item.due : isoDay(item.due, timeZone);
  if (item.urgency === 'waiting') return { key: key('Since {date}'), values: { date: format.date(day) } };
  const late = dayDiff(day, today);
  if (late === 1) return { key: key('1 day late') };
  if (late > 1) return { key: key('{count} days late'), values: { count: late } };
  if (isDateOnly(item.due)) return { key: key('Today') };
  return item.urgency === 'overdue' ? { key: key('Due {time}'), values: { time: format.time(item.due) } } : { key: key('Today {time}'), values: { time: format.time(item.due) } };
}

export const STAGE_LABEL: Record<HomeFunnelStage['id'], string> = {
  enquiries: key('Enquiries'), planning: key('Planning'), quotes: key('Quotes'), projects: key('Projects'), handover: key('Handover'),
};
/** The pipeline shows for people who see the front of the business (enquiries or planning); site people have their sites. */
export const showsPipeline = (funnel: HomeFunnelStage[]) => funnel.some((stage) => stage.id === 'enquiries' || stage.id === 'planning');

/** Which figures a person sees, from what they may do: the business for those who run it, their own area otherwise. */
export type NumbersLens = 'business' | 'finance' | 'sales' | 'estimating' | 'purchasing' | 'projects';
export function lensFor(can: (...codes: string[]) => boolean): NumbersLens {
  return can('workspace.settings.manage') ? 'business' : can('receivables.view') ? 'finance' : can('crm.leads.view') ? 'sales'
    : can('commercial.estimate') ? 'estimating' : can('purchasing.view') ? 'purchasing' : 'projects';
}

export type Change = { direction: 'up' | 'down' | 'flat' | 'new'; percent: number };
/** This month so far against the same span of last month. */
export function changeBetween(current: string | number, previous: string | number): Change {
  const now = Number(current); const before = Number(previous);
  if (!Number.isFinite(now) || !Number.isFinite(before)) return { direction: 'flat', percent: 0 };
  if (before === 0) return now > 0 ? { direction: 'new', percent: 0 } : { direction: 'flat', percent: 0 };
  const percent = Math.round(((now - before) / Math.abs(before)) * 100);
  return { direction: percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat', percent: Math.abs(percent) };
}

export type FigureValue = { kind: 'money'; amount: string; currency: string } | { kind: 'count'; value: number } | { kind: 'share'; count: number; total: number };
export type Figure = { id: string; label: string; value: FigureValue; route: string; note?: Label & { tone: 'success' | 'warning' | 'danger' | 'neutral' } };

function change(current: string | number, previous: string | number, upIsGood = true): Figure['note'] {
  const delta = changeBetween(current, previous);
  if (delta.direction === 'flat') return { key: key('Same as last month'), tone: 'neutral' };
  if (delta.direction === 'new') return { key: key('None last month'), tone: 'neutral' };
  const good = (delta.direction === 'up') === upIsGood;
  return { key: delta.direction === 'up' ? key('{percent}% up on last month') : key('{percent}% down on last month'), values: { percent: delta.percent }, tone: good ? 'success' : 'warning' };
}

/** One or two figures that matter for the person's role, each opening its list on the phone. */
export function figuresFor(data: HomeMetrics, lens: NumbersLens): Figure[] {
  const money = (amount: string): FigureValue => ({ kind: 'money', amount, currency: data.currency });
  const all: Record<string, Figure | null> = {
    moneyIn: data.payments ? { id: 'money-in', label: key('Money in this month'), value: money(data.payments.received), route: '/finance', note: change(data.payments.received, data.payments.previousReceived) } : null,
    due: data.payments ? { id: 'due', label: key('Still due this month'), value: money(data.payments.due), route: '/finance' } : null,
    projects: data.projects ? { id: 'projects', label: key('Projects on track'), value: { kind: 'share', count: data.projects.onTrack, total: data.projects.active }, route: '/projects',
      note: data.projects.late ? { key: key('{count} late'), values: { count: data.projects.late }, tone: 'danger' }
        : data.projects.atRisk ? { key: key('{count} at risk'), values: { count: data.projects.atRisk }, tone: 'warning' } : { key: key('All on track'), tone: 'success' } } : null,
    overdue: data.projects ? { id: 'overdue', label: key('Overdue tasks'), value: { kind: 'count', value: data.projects.overdueTasks }, route: '/projects/tasks',
      note: data.projects.overdueTasks ? { key: key('On your projects'), tone: 'warning' } : { key: key('Nothing overdue'), tone: 'success' } } : null,
    enquiries: data.enquiries ? { id: 'enquiries', label: key('New enquiries this month'), value: { kind: 'count', value: data.enquiries.current }, route: '/sales', note: change(data.enquiries.current, data.enquiries.previous) } : null,
    quoted: data.quotes ? { id: 'quoted', label: key('Quoted this month'), value: money(data.quotes.issuedValue), route: '/survey', note: change(data.quotes.issuedValue, data.quotes.previousIssuedValue) } : null,
    awaiting: data.quotes ? { id: 'awaiting', label: key('Quotes with clients'), value: { kind: 'count', value: data.quotes.awaiting }, route: '/survey' } : null,
    orders: data.orders ? { id: 'orders', label: key('Orders to receive'), value: { kind: 'count', value: data.orders.toReceive }, route: '/purchasing/orders' } : null,
  };
  const order: Record<NumbersLens, string[]> = {
    business: ['moneyIn', 'projects', 'enquiries', 'quoted'],
    finance: ['moneyIn', 'due', 'projects'],
    sales: ['enquiries', 'quoted', 'awaiting', 'projects'],
    estimating: ['quoted', 'awaiting', 'projects'],
    purchasing: ['orders', 'projects', 'overdue'],
    projects: ['projects', 'overdue', 'orders'],
  };
  return order[lens].map((id) => all[id]).filter((figure): figure is Figure => Boolean(figure)).slice(0, 2);
}

/** Whether a person is expected to see figures at all (the web's rule); otherwise the section never shows. */
export const expectsNumbers = (can: (...codes: string[]) => boolean) => can('receivables.view', 'projects.view', 'crm.leads.view', 'pre_projects.view', 'purchasing.view');
