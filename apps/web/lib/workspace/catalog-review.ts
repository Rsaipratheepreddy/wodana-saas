import type { CatalogRecord } from './catalog';
import { recordPrices } from './catalog-prices';

export type CatalogIssue = { kind: 'details' | 'price'; label: string };
/** Completeness checks only; these do not approve a specification or select a quote rate. */
export function catalogIssues(record: CatalogRecord, items: CatalogRecord[]): CatalogIssue[] {
  if (record.archived) return [];
  const issues: CatalogIssue[] = [];
  const hasUnit = (source: CatalogRecord) => source.links.some(link => link.relation === 'unit' && items.some(unit => unit.id === link.targetId && unit.kind === 'unit' && !unit.archived && unit.catalogId === source.catalogId));
  if (!hasUnit(record)) issues.push({ kind: 'details', label: 'Select a unit' });
  if (record.specificationStatus !== 'workspace_verified') issues.push({ kind: 'details', label: 'Review specification' });
  const sellingPrices = recordPrices(record, items).filter(rate => rate.configuration?.priceType === 'selling');
  const complete = sellingPrices.some(rate => {
    const amount = rate.configuration?.amount;
    return amount !== undefined && String(amount).trim() !== '' && Number.isFinite(Number(amount)) && Number(amount) >= 0 && /^[A-Z]{3}$/.test(String(rate.configuration?.currency ?? '')) && hasUnit(rate);
  });
  if (!complete) issues.push({ kind: 'price', label: sellingPrices.length ? 'Complete selling price and unit' : 'Add a selling price' });
  return issues;
}
