import type { AssistCatalogRecord, AssistLink } from './quotation-assist';

/** Short, request-local keys distinguish Master Data from IDs in case evidence. */
export function planningCatalog(records: AssistCatalogRecord[], links: AssistLink[]) {
  const counts = new Map<string, number>();
  const keys = new Map<string, string>();
  const references = new Map<string, string>();
  for (const record of records) {
    const kind = record.kind === 'work' ? 'item' : record.kind;
    const ordinal = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, ordinal);
    const key = `${kind}_${ordinal}`;
    keys.set(record.id, key);
    references.set(key, record.id);
  }
  return {
    references,
    records: records.map(record => ({
      id: keys.get(record.id)!, kind: record.kind, name: record.name,
      code: record.code, aliases: record.content?.aliases,
      description: record.content?.description?.slice(0, 300),
    })),
    links: links.flatMap(link => {
      const recordId = keys.get(link.recordId), targetId = keys.get(link.targetId);
      return recordId && targetId ? [{ recordId, targetId, relation: link.relation }] : [];
    }),
  };
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Only keys actually supplied in this analysis can become catalog references. */
export function decodePlanningSuggestions(raw: unknown, references: Map<string, string>) {
  const data = object(raw);
  const id = (value: unknown) => typeof value === 'string' ? references.get(value) ?? '' : '';
  return {
    ...data,
    summary: data.summary,
    rooms: (Array.isArray(data.rooms) ? data.rooms : []).map(value => {
      const room = object(value);
      return {
        ...room, roomId: id(room.roomId),
        items: (Array.isArray(room.items) ? room.items : []).map(value => {
          const item = object(value);
          return { ...item, workId: id(item.workId), variantId: id(item.variantId),
            materialIds: (Array.isArray(item.materialIds) ? item.materialIds : []).map(id).filter(Boolean) };
        }),
      };
    }),
  };
}
