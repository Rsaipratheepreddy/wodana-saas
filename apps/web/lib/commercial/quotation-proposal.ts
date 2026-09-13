import type { Quote } from './types';
import type { RoomSuggestion } from './quotation-assist';
import { addSuggestedRoom } from './quotation-assist';
import { applyRoom, roomNames } from './room-builder';

export const roomKey = (name: string) => name.trim().toLocaleLowerCase();
export const scopeFingerprint = (quote: Quote) => JSON.stringify([quote.rooms, quote.lines, quote.direction]);

/** Proposals add to the current draft; AI never removes or reprices existing items. */
export function buildQuotationProposal(quote: Quote, suggestions: RoomSuggestion[]): Quote {
  let draft = structuredClone(quote);
  for (const suggestion of suggestions) {
    const existing = roomNames(draft).find(name => roomKey(name) === roomKey(suggestion.name));
    const proposed = addSuggestedRoom({ ...draft, rooms: [], lines: [] }, suggestion);
    const oldLines = draft.lines.filter(line => line.room === existing);
    const identity = (line: Quote['lines'][number]) => [line.catalogLinks?.find(l => l.role === 'work')?.recordId ?? line.title, line.catalogLinks?.find(l => l.role === 'variant')?.recordId ?? ''].join(':');
    const included = new Set(oldLines.map(identity));
    const additions = proposed.lines.filter(line => !included.has(identity(line)));
    if ((!existing && roomNames(draft).length >= 100) || draft.lines.length + additions.length > 300) throw new Error('This proposal exceeds 100 rooms or 300 items. Ask Woody for fewer rooms.');
    draft = applyRoom(draft, existing ?? null, existing ?? suggestion.name, draft.rooms?.find(room => room.name === existing)?.catalog?.snapshot ?? suggestion.room, [...oldLines, ...additions]);
  }
  return draft;
}

export function confirmProposalRooms(quote: Quote, proposed: Quote, selected: string[]): Quote {
  let next = quote;
  for (const name of selected) {
    const room = proposed.rooms?.find(room => room.name === name);
    if (!room) continue;
    const existing = roomNames(next).find(value => roomKey(value) === roomKey(name));
    next = applyRoom(next, existing ?? null, room.name, room.catalog?.snapshot ?? null, proposed.lines.filter(line => line.room === name));
  }
  return next;
}

export function previousQuotation(quote: Quote, quotes: Quote[]): Quote | undefined {
  const family = quote.familyId ?? quote.id;
  return quotes.filter(candidate => candidate.id !== quote.id && (candidate.familyId ?? candidate.id) === family && candidate.number < quote.number).sort((a, b) => b.number - a.number)[0]
    ?? quotes.find(candidate => candidate.id === quote.baselineId);
}

export function roomRevision(quote: Quote, baseline: Quote | undefined, name: string) {
  if (!baseline) return { added: false, addedItems: 0 };
  const room = quote.rooms?.find(room => room.name === name);
  const oldRoom = baseline.rooms?.find(old => old.id === room?.id || roomKey(old.name) === roomKey(name));
  const added = !oldRoom && !baseline.lines.some(line => roomKey(line.room) === roomKey(name));
  const ids = new Set(baseline.lines.map(line => line.id));
  return { added, addedItems: quote.lines.filter(line => line.room === name && !ids.has(line.id)).length };
}
