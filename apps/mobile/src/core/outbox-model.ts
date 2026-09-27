/**
 * The outbox: field captures (photos, reports, attendance) saved on the phone first and sent when there's
 * a connection. Each item keeps one stable operation id, so a send that is repeated after a lost answer
 * is recognised by the server instead of being done twice. Approvals and money never go through here.
 *
 * Pure state changes only; storage and sending live in `outbox.tsx`.
 */
export type OutboxStatus = 'pending' | 'sending' | 'blocked';
export type OutboxFile = { key: string; uri: string; name: string; type: string; encrypted?: boolean };
export type OutboxItem<P = Record<string, unknown>> = {
  /** The stable operation id (also the record or action id the server deduplicates on). */
  id: string;
  /** Which sender handles it, e.g. `hrms.attendance`. */
  kind: string;
  /** What the person sees in the list: "Check in", "Site photo · PRJ-0042". */
  title: string;
  detail?: string;
  workspaceId: string;
  /** Screens show pending work next to the record it belongs to (e.g. `project:<id>`). */
  scope?: string;
  payload: P;
  files: OutboxFile[];
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: OutboxStatus;
  /** How far a several-step send got (e.g. 1 = photo uploaded), so a retry picks up there. */
  step: number;
  /** Why the server refused it; the person fixes it (e.g. gives a reason) or discards it. */
  error?: string;
  issues?: string[];
};

export const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BASE_DELAY_MS = 15_000;
const MAX_DELAY_MS = 30 * 60_000;

/** Wait before the next try: 15s, 30s, 1m, 2m … up to 30 minutes, with a little spread so phones don't sync in step. */
export function backoff(attempts: number, random = Math.random) {
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(exponential * (0.85 + random() * 0.3));
}

export function createItem<P>(input: Pick<OutboxItem<P>, 'id' | 'kind' | 'title' | 'workspaceId' | 'payload'> & Partial<Pick<OutboxItem<P>, 'detail' | 'scope' | 'files'>>, now = Date.now()): OutboxItem<P> {
  return { files: [], ...input, createdAt: now, attempts: 0, nextAttemptAt: now, status: 'pending', step: 0 };
}

/** Add an item; the same operation id is never queued twice. */
export function enqueue<P>(items: OutboxItem<P>[], item: OutboxItem<P>) {
  return items.some((existing) => existing.id === item.id) ? items : [...items, item];
}

/** Items ready to send now for this workspace, oldest first. */
export function due<P>(items: OutboxItem<P>[], workspaceId: string, now = Date.now()) {
  return items.filter((item) => item.workspaceId === workspaceId && item.status === 'pending' && item.nextAttemptAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** When the next pending item becomes due (for a timer), or null. */
export function nextWake<P>(items: OutboxItem<P>[], workspaceId: string) {
  const times = items.filter((item) => item.workspaceId === workspaceId && item.status === 'pending').map((item) => item.nextAttemptAt);
  return times.length ? Math.min(...times) : null;
}

const update = <P>(items: OutboxItem<P>[], id: string, change: (item: OutboxItem<P>) => OutboxItem<P>) =>
  items.map((item) => (item.id === id ? change(item) : item));

export const markSending = <P>(items: OutboxItem<P>[], id: string) => update(items, id, (item) => ({ ...item, status: 'sending' as const }));

export const markStep = <P>(items: OutboxItem<P>[], id: string, step: number) => update(items, id, (item) => ({ ...item, step: Math.max(item.step, step) }));

/** A connection problem or a server hiccup: try again later. */
export function markRetry<P>(items: OutboxItem<P>[], id: string, error: string, now = Date.now(), random = Math.random) {
  return update(items, id, (item) => {
    const attempts = item.attempts + 1;
    return { ...item, status: 'pending' as const, attempts, nextAttemptAt: now + backoff(attempts, random), error };
  });
}

/** The server said no: keep it for the person to fix or discard; never retried by itself. */
export function markBlocked<P>(items: OutboxItem<P>[], id: string, error: string, issues: string[] = []) {
  return update(items, id, (item) => ({ ...item, status: 'blocked' as const, error, issues }));
}

/** Change what will be sent (e.g. add the reason the server asked for) and send it again now. */
export function amend<P>(items: OutboxItem<P>[], id: string, patch: Partial<P>, now = Date.now()) {
  return update(items, id, (item) => ({ ...item, payload: { ...item.payload, ...patch }, status: 'pending' as const, nextAttemptAt: now, error: undefined, issues: undefined }));
}

/** Try now (the person pressed "Send now"). */
export const retryNow = <P>(items: OutboxItem<P>[], id: string, now = Date.now()) =>
  update(items, id, (item) => ({ ...item, status: 'pending' as const, nextAttemptAt: now }));

export const remove = <P>(items: OutboxItem<P>[], id: string) => items.filter((item) => item.id !== id);

/** After a restart, anything caught mid-send goes back to waiting. */
export const recover = <P>(items: OutboxItem<P>[]) => items.map((item) => (item.status === 'sending' ? { ...item, status: 'pending' as const } : item));

export const expired = <P>(item: OutboxItem<P>, now = Date.now()) => now - item.createdAt > OUTBOX_TTL_MS;

/**
 * What a failed send means. Refusals the person can act on (400, 403, 404, 409, 413, 422) block the item;
 * connection failures, timeouts, rate limits and server errors are retried.
 */
export function classify(status: number | null): 'retry' | 'blocked' {
  if (status === null || status === 0) return 'retry';
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  return 'blocked';
}
