import { appRouteFor } from '../../core/deep-links';
import { key } from '../../core/i18n';

/**
 * Woddy on the phone (W-1, W-3, W-4), without native code (node tests import it). Business Core runs the tools
 * with the person's own permissions: reads answer at once, writes come back as cards the person confirms or
 * cancels, and every answer lists the records it read so a fact opens where it came from.
 */
export type WoddySource = { key: string; type: string; id: string; label: string; href?: string | null };
export type WoddyPreviewField = { label: string; before?: string | null; after: string | null; format?: 'datetime' | 'date' };
export type WoddyPreview =
  | { kind: 'fields'; fields: WoddyPreviewField[] }
  | { kind: 'targets'; items: Array<{ type: string; id: string; label: string; href?: string | null; detail?: string | null; now?: string | null }>; selectable: boolean; fields: WoddyPreviewField[] }
  | { kind: 'text'; text: string; fields: WoddyPreviewField[] };
export type WoddyCardStatus = 'proposed' | 'confirmed' | 'executed' | 'rejected' | 'failed' | 'expired';
export type WoddyRecord = { type: string; id: string; label: string; href?: string | null };
export type WoddyCard = {
  id: string; runId: string; tool: string; status: WoddyCardStatus; title: { key: string; values?: Record<string, string | number> }; summary: string;
  preview: WoddyPreview; target: WoddyRecord | null; expiresAt: string; version: number; selection: string[] | null;
  record: WoddyRecord | null; failures: Array<{ id: string; label: string; message: string }>; error: string | null;
};
export type WoddyAnswer = {
  runId: string; answer: string; sources: WoddySource[]; cited: string[]; proposals: WoddyCard[];
  draft: { text: string; conversationId: string | null } | null; stopped: 'rounds' | 'tokens' | null;
};
export type WoddyTurn = { role: 'user' | 'assistant'; text: string };

/** The ten turns before this one, each within the server's 3,000 characters; empty assistant turns are skipped. */
export function historyFor(turns: WoddyTurn[]) {
  return turns.filter((turn) => turn.text.trim()).slice(-10).map((turn) => ({ role: turn.role, text: turn.text.trim().slice(0, 3000) }));
}

/** The records an answer cites, in the order it cites them; the first six it read when it cites none. */
export function citedSources(answer: Pick<WoddyAnswer, 'sources' | 'cited'>): WoddySource[] {
  const cited = answer.cited.map((code) => answer.sources.find((source) => source.key === code)).filter((source): source is WoddySource => Boolean(source));
  return cited.length ? cited : answer.sources.slice(0, 6);
}

/** The answer's words with each cited source ("[S1]") as its own part, so it can open the record. */
export function withCitations(text: string, sources: WoddySource[]): Array<{ text: string } | { source: WoddySource }> {
  const parts: Array<{ text: string } | { source: WoddySource }> = [];
  for (const piece of text.split(/(\[S\d+\])/g)) {
    if (!piece) continue;
    const code = /^\[(S\d+)\]$/.exec(piece)?.[1];
    const source = code ? sources.find((item) => item.key === code) : undefined;
    parts.push(source ? { source } : { text: piece });
  }
  return parts;
}

/** The app screen for a record Woddy names; null when the phone has none (it stays a plain label). */
export const recordRoute = (record: Pick<WoddyRecord, 'href'> | null | undefined) => appRouteFor(record?.href ?? null);

/** Card states in a word, with the chip colour. */
export const CARD_STATUS: Record<WoddyCardStatus, { label: string; tone: 'info' | 'success' | 'neutral' | 'danger' }> = {
  proposed: { label: key('Waiting for you'), tone: 'info' },
  confirmed: { label: key('Running'), tone: 'info' },
  executed: { label: key('Done'), tone: 'success' },
  rejected: { label: key('Cancelled'), tone: 'neutral' },
  failed: { label: key('Not done'), tone: 'danger' },
  expired: { label: key('Expired'), tone: 'neutral' },
};

/** The card's title in the person's language: Business Core's key with its values (a value that is a label is translated too). */
export function cardTitle(t: (text: string, values?: Record<string, string | number>) => string, card: Pick<WoddyCard, 'title' | 'summary'>) {
  if (!card.title?.key) return card.summary;
  const values = Object.fromEntries(Object.entries(card.title.values ?? {}).map(([name, value]) => [name, typeof value === 'string' ? t(value) : value]));
  return t(card.title.key, values);
}

/** A card still open until its time, even if nobody refreshed it. */
export const effectiveStatus = (card: Pick<WoddyCard, 'status' | 'expiresAt'>, now = Date.now()): WoddyCardStatus =>
  card.status === 'proposed' && Date.parse(card.expiresAt) <= now ? 'expired' : card.status;

export type WoddyRefusal = 'paused' | 'off' | 'no-access' | 'busy' | 'unavailable';
const PAUSES: Record<string, string> = {
  AI_CREDITS_EXHAUSTED: key('AI credits are used up. Ask your admin to top up.'),
  AI_WORKSPACE_DAILY_LIMIT: key('Today\'s AI limit for this workspace is reached. Try again tomorrow.'),
  AI_PLATFORM_DAILY_LIMIT: key('AI is paused for today. Try again tomorrow.'),
};

/** A refused ask in the person's words: a calm pause (credits, today's limit), AI off, no access, busy, or unavailable. */
export function refusalOf(status: number, code: string | null): { kind: WoddyRefusal; message: string } {
  if (code && PAUSES[code]) return { kind: 'paused', message: PAUSES[code] };
  if (status === 402) return { kind: 'paused', message: PAUSES.AI_CREDITS_EXHAUSTED };
  if (code === 'AI_OFF' || code === 'AI_NOT_CONFIGURED' || code === 'AI_NOT_AVAILABLE') return { kind: 'off', message: key('Woddy is off for this workspace. An admin can turn AI on in Settings.') };
  if (status === 403) return { kind: 'no-access', message: key('You don\'t have access to Woddy in this workspace.') };
  if (status === 429) return { kind: 'busy', message: key('Woddy is busy. Please try again in a minute.') };
  return { kind: 'unavailable', message: key('Woddy could not reply. Please try again.') };
}
