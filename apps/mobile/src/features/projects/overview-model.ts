import type { BlockerKey, WorkItem } from '../../../../web/lib/project-core/types';
import { key } from '../../core/i18n';

/**
 * A project at a glance on the phone, without native code (node tests import it): what holds it up in the web's
 * words, how late its current stage runs, and the plan's quick filters (late, blocked, snags).
 */
const BLOCKERS: Record<BlockerKey, [string, string]> = {
  late_work: [key('task late'), key('tasks late')],
  blocked_work: [key('task blocked'), key('tasks blocked')],
  materials_not_in: [key('task waiting for materials'), key('tasks waiting for materials')],
  late_to_order: [key('to order, late'), key('to order, late')],
  late_orders: [key('order late'), key('orders late')],
  work_orders_waiting: [key('work order waiting'), key('work orders waiting')],
  reports_missing: [key('site report missing'), key('site reports missing')],
  client_decisions: [key('waiting on the client'), key('waiting on the client')],
  critical_snags: [key('critical snag'), key('critical snags')],
  funds_short: [key('spent beyond what the client paid'), key('spent beyond what the client paid')],
};

/** The words after a blocker's count ("3 tasks late"), as a label key. */
export const blockerLabel = (blocker: BlockerKey, count: number) => BLOCKERS[blocker]?.[count === 1 ? 0 : 1] ?? blocker;

/** Whole days the current stage runs past its planned end while work is still open; 0 when it isn't late. */
export function stageLateBy(plan: { end: string | null; open: number } | undefined, today: string) {
  if (!plan?.end || plan.open <= 0 || plan.end >= today) return 0;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${plan.end}T00:00:00Z`)) / 86_400_000);
}

export type PlanFilter = 'open' | 'late' | 'blocked' | 'snags' | 'done';
export const PLAN_FILTERS: PlanFilter[] = ['open', 'late', 'blocked', 'snags', 'done'];
/** A plan link's filter (`?filter=late`), when the phone has it. */
export const planFilterOf = (value: string | null | undefined): PlanFilter | null => (PLAN_FILTERS.includes(value as PlanFilter) ? value as PlanFilter : value === 'materials' ? 'blocked' : null);

type WorkLike = Pick<WorkItem, 'dueDate'> & { status: string; type: string; blockedBy: ReadonlyArray<{ status: string }> };
const isOpen = (item: Pick<WorkLike, 'status'>) => item.status !== 'done' && item.status !== 'cancelled';
/** Whether a piece of work belongs in the plan's filter. */
export function inPlanFilter(item: WorkLike, filter: PlanFilter, today: string) {
  if (filter === 'done') return !isOpen(item);
  if (!isOpen(item)) return false;
  if (filter === 'late') return !!item.dueDate && item.dueDate < today;
  if (filter === 'blocked') return item.type === 'blocker' || item.blockedBy.some((ref) => ref.status !== 'done' && ref.status !== 'cancelled');
  if (filter === 'snags') return item.type === 'snag';
  return true;
}
