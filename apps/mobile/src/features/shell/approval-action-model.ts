import { ApiError, AuthError } from '../../auth/client';

/**
 * Approve from the lock screen (X-2), without native code (node tests import it). The server sends an approval
 * notice that needs no note with a category (its buttons: Approve and Open) and the "Waiting for you" row to decide.
 * Approve runs `approvals/decide` as the person; anything the server won't do from a tap (a note needed, decided
 * elsewhere) opens the app instead. Approvals never wait for a connection (plan §6.29): without one, the person is
 * asked to open it. The tap is held on the phone for a few minutes only, so a send the phone paused part-way is
 * finished when the app next runs; an older one asks the person to decide again.
 */
export const APPROVE_ACTION = 'approve';
export const OPEN_ACTION = 'open';
export type ApprovalCategory = 'approval' | 'approval_send';
export const APPROVAL_CATEGORIES: readonly ApprovalCategory[] = ['approval', 'approval_send'];
/** The kinds a push may carry (the server's lock-screen list); anything else opens the app. */
const KINDS: ReadonlySet<string> = new Set(['order', 'payment_run', 'petty_cash', 'quote_review', 'site_report']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PushApproval = { workspaceId: string; kind: string; id: string; title: string; deepLink: string | null };
export type PendingApproval = PushApproval & { at: number; tries: number };
export const PENDING_TTL_MS = 10 * 60 * 1000;
export const MAX_TRIES = 3;

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null);

/** The data a push carries, whether the platform hands it over as an object or as a JSON string. */
function pushData(data: unknown): Record<string, unknown> | null {
  const object = record(data);
  if (!object) return null;
  if (typeof object.dataString === 'string') {
    try { return record(JSON.parse(object.dataString)) ?? object; } catch { return object; }
  }
  return object;
}

/** The row a tapped Approve decides, or null when this push can't be approved from the lock screen. */
export function pushApproval(content: { title?: string | null; body?: string | null; data?: unknown }): PushApproval | null {
  const data = pushData(content.data);
  const approval = record(data?.approval);
  const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : '';
  const kind = typeof approval?.kind === 'string' ? approval.kind : '';
  const id = typeof approval?.id === 'string' ? approval.id : '';
  if (!UUID.test(workspaceId) || !KINDS.has(kind) || !UUID.test(id)) return null;
  return { workspaceId, kind, id, title: (content.title || content.body || '').slice(0, 200), deepLink: typeof data?.deepLink === 'string' ? data.deepLink : null };
}

export const approvalKey = (item: Pick<PushApproval, 'workspaceId' | 'kind' | 'id'>) => `${item.workspaceId}:${item.kind}:${item.id}`;

/** Saved decisions: one per row (a second tap replaces it), at most twenty. */
export function enqueue(list: PendingApproval[], item: PushApproval, now: number): PendingApproval[] {
  return [...list.filter((entry) => approvalKey(entry) !== approvalKey(item)), { ...item, at: now, tries: 0 }].slice(-20);
}

/** Held taps still worth sending (a few minutes old), and older ones the person must decide again. */
export const partitionDue = (list: PendingApproval[], now: number) => ({
  due: list.filter((entry) => now - entry.at < PENDING_TTL_MS),
  stale: list.filter((entry) => now - entry.at >= PENDING_TTL_MS),
});

/** Read back what the phone saved, dropping anything malformed. */
export function parsePending(raw: string | null): PendingApproval[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((entry): entry is PendingApproval => {
      const item = record(entry);
      return !!item && UUID.test(String(item.workspaceId)) && KINDS.has(String(item.kind)) && UUID.test(String(item.id)) && Number.isFinite(item.at) && Number.isFinite(item.tries);
    }) : [];
  } catch { return []; }
}

/**
 * What became of a decision: approved; gone (no longer waiting: someone decided it, or it changed); open (the server
 * wants more than a tap — a note, a look, another sign-in); offline (no connection: approvals don't wait, open it
 * later); or retry (the server was busy; tried again within the few minutes a tap is held).
 */
export type ApprovalOutcome = 'approved' | 'gone' | 'open' | 'offline' | 'retry';
export function outcomeOf(error: unknown): Exclude<ApprovalOutcome, 'approved'> {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'gone';
    if (error.status >= 500 || error.status === 429) return 'retry';
    return 'open';
  }
  if (error instanceof AuthError) return error.code === 'network' ? 'offline' : error.code === 'server' ? 'retry' : 'open';
  return 'open';
}

/** After the last try, a decision the phone couldn't send asks the person to open it. */
export const afterRetry = (entry: PendingApproval): PendingApproval | 'open' => (entry.tries + 1 >= MAX_TRIES ? 'open' : { ...entry, tries: entry.tries + 1 });
