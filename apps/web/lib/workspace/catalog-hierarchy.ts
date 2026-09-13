import type { CatalogRecord } from './catalog';

export function catalogAttribute(record: CatalogRecord, name: string) {
  return record.attributes.find(a => a.name.toLowerCase().replaceAll(' ', '_') === name.toLowerCase().replaceAll(' ', '_'))?.value;
}

export function catalogRecordName(record: CatalogRecord) {
  if (record.kind === 'variant') return String(record.configuration?.specificationTier || catalogAttribute(record, 'tier') || record.name);
  if (record.kind === 'construction' && record.configuration?.recordRole === 'component') return String(record.configuration.componentType || catalogAttribute(record, 'role') || record.name);
  if (isMaterialRequirement(record)) return catalogAttribute(record, 'Required specification') || record.name;
  const element = catalogAttribute(record, 'element_name');
  const room = catalogAttribute(record, 'room_name');
  return element && record.kind === 'work' && record.name === `${element} · ${room}` ? element : record.name;
}

export function catalogDescription(record: CatalogRecord) {
  const importNote = 'Workbook prices are preserved in specifications. Tax, inclusions and effective dates require review before creating price-book entries.';
  if (record.description === importNote) return catalogAttribute(record, 'typical_application') || catalogAttribute(record, 'application') || '';
  if (record.description === 'Default configuration. Price has not been set.') return '';
  return record.description.replace(/ Workbook cost is an estimate; no quotation or pricing rule is activated\.$/, '');
}

export const materialKinds = ['material', 'sku', 'hardware', 'consumable'];
export function isMaterialRequirement(record: CatalogRecord) {
  return Boolean(catalogAttribute(record, 'Import role')) || catalogAttribute(record, 'Catalog role') === 'component specification';
}
export function isMaterialEntry(record: CatalogRecord) {
  return materialKinds.includes(record.kind) && !isMaterialRequirement(record) && catalogAttribute(record, 'Catalog role') !== 'family';
}

export function withCatalogAttribute(record: CatalogRecord, name: string, value: string): CatalogRecord {
  const key = (value: string) => value.toLowerCase().replaceAll(' ', '_');
  const existing = record.attributes.find(a => key(a.name) === key(name));
  if (!value.trim()) return {...record, attributes: record.attributes.filter(a => a !== existing)};
  return {...record, attributes: existing ? record.attributes.map(a => a === existing ? {...a, value} : a) : [...record.attributes, {name, value}]};
}

export function defaultCatalog(items: CatalogRecord[]) {
  const catalogs = items.filter(r => r.kind === 'catalog_group' && !r.archived);
  return catalogs.find(r => catalogAttribute(r, 'Default catalog') === 'true') ?? catalogs[0];
}

export function catalogHierarchy(items: CatalogRecord[], archived = false) {
  const active = items.filter(r => r.archived === archived);
  const byId = new Map(items.map(r => [r.id, r]));
  const linked = new Map<string, CatalogRecord[]>();
  const referrers = new Map<string, CatalogRecord[]>();
  for (const record of active) {
    for (const link of record.links) {
      const incoming = referrers.get(link.targetId) ?? [];
      incoming.push(record); referrers.set(link.targetId, incoming);
      const key = `${record.kind}:${link.relation}:${link.targetId}`;
      const list = linked.get(key) ?? [];
      list.push(record); linked.set(key, list);
    }
  }
  const related = (kind: string, relation: string, id: string) => linked.get(`${kind}:${relation}:${id}`) ?? [];
  const names = (record: CatalogRecord, relation: string) => record.links.filter(l => l.relation === relation).map(l => byId.get(l.targetId)?.name).filter(Boolean).join(', ');
  const targets = (record: CatalogRecord, relations: string[]) => record.links.filter(l => relations.includes(l.relation)).map(l => byId.get(l.targetId)).filter((r): r is CatalogRecord => Boolean(r));
  const specification = (record: CatalogRecord) => targets(record, materialKinds).filter(isMaterialRequirement).map(catalogRecordName).join(', ') || String(record.configuration?.selectionSource ?? catalogAttribute(record, 'material_sub_type') ?? '');
  const components = (itemId: string, variantId?: string) => {
    const templates = related('construction', 'work', itemId).filter(r => r.configuration?.recordRole === 'template');
    const all = new Map(related('construction', 'work', itemId).filter(r => r.configuration?.recordRole === 'component').map(r => [r.id, r]));
    for (const template of templates) for (const record of related('construction', 'parent', template.id)) if (record.configuration?.recordRole === 'component') all.set(record.id, record);
    return [...all.values()].filter(r => {
      const variant = r.links.find(l => l.relation === 'variant');
      return variant ? variant.targetId === variantId : true;
    });
  };
  const materials = (itemId: string, variantId?: string) => {
    const rows = components(itemId, variantId);
    const covered = new Set(rows.flatMap(r => targets(r, materialKinds).map(r => r.id)));
    const owner = byId.get(itemId), option = variantId ? byId.get(variantId) : undefined;
    const direct = [owner, option].flatMap(r => r ? targets(r, materialKinds).filter(r => !r.archived && !covered.has(r.id)) : []);
    return [...new Map([...rows, ...direct].map(r => [r.id, r])).values()];
  };
  const usage = (materialId: string) => {
    const matches = [...new Map((referrers.get(materialId) ?? []).filter(r => ['work', 'variant', 'construction'].includes(r.kind) && r.links.some(l => materialKinds.includes(l.relation) && l.targetId === materialId)).map(r=>[r.id,r])).values()];
    return matches.flatMap(record => {
      const parent = targets(record, ['parent'])[0];
      const owners = record.kind === 'work' ? [record] : targets(record, ['work']).length ? targets(record, ['work']) : parent ? targets(parent, ['work']) : [];
      const variant = record.kind === 'variant' ? record : targets(record, ['variant'])[0];
      return owners.map(item => ({record, item, variant, rooms: targets(item, ['room'])}));
    });
  };
  return { byId, active, related, names, targets, specification, components, materials, usage };
}
