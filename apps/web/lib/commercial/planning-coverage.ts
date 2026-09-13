import type { RoomSuggestion } from './quotation-assist';

export type ScopeReference = { id: string; name: string; kind: 'room' | 'requirement' | 'measurement' };
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 500) : '';

/** Coverage is checked against validated suggestions, never a model's completeness claim. */
export function planningCoverage(raw: unknown, rooms: RoomSuggestion[], expected: ScopeReference[], validSources: Set<string>) {
  const data = object(raw);
  const itemSources = new Set(rooms.flatMap(room => room.items.flatMap(item => item.sourceIds)));
  const roomSources = new Set([...itemSources, ...rooms.flatMap(room => room.sourceIds)]);
  const missing = expected.filter(source => !(source.kind === 'requirement' ? itemSources : roomSources).has(source.id));
  const review = missing.map(source => `${source.name}: ${source.kind === 'requirement' ? 'no verified item suggestion' : 'no verified room suggestion'}. Review this scope in Room builder.`);
  for (const value of Array.isArray(data.unmatched) ? data.unmatched : []) {
    const entry = object(value);
    if (!Array.isArray(entry.sourceIds) || !entry.sourceIds.some(id => typeof id === 'string' && validSources.has(id))) continue;
    const name = text(entry.name), reason = text(entry.reason);
    if (name && reason) review.push(`${name}: ${reason}`);
  }
  const proposed = Array.isArray(data.rooms) ? data.rooms.map(object) : [];
  if (proposed.length > rooms.length || proposed.reduce((n, r) => n + (Array.isArray(r.items) ? r.items.length : 0), 0) > rooms.reduce((n, r) => n + r.items.length, 0)) {
    review.push('Some suggestions had missing or incompatible Master Data links. They were not added; review the requirements and item links.');
  }
  return { coverage: { total: expected.length, linked: expected.length - missing.length }, review: [...new Set(review)] };
}

/** Never silently truncate a plan beyond the quotation's supported capacity. */
export function planningCapacityExceeded(raw: unknown) {
  const rooms = object(raw).rooms;
  return Array.isArray(rooms) && (rooms.length > 100 || rooms.reduce((n, room) => {
    const items = object(room).items;
    return n + (Array.isArray(items) ? items.length : 0);
  }, 0) > 300);
}
