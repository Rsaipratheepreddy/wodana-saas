import { describe, expect, it } from 'vitest';
import { blankCatalogRecord } from './catalog';
import { catalogIssues } from './catalog-review';
const material = { ...blankCatalogRecord('sku'), id: 'material', catalogId: 'catalog', specificationStatus: 'workspace_verified', links: [{ relation: 'unit', targetId: 'unit' }] };
const unit = { ...blankCatalogRecord('unit'), id: 'unit', catalogId: 'catalog' };
const rate = { ...blankCatalogRecord('rate_card'), id: 'rate', catalogId: 'catalog', configuration: { amount: 0, currency: 'AED', priceType: 'selling' }, links: [{ relation: 'sku', targetId: 'material' }, { relation: 'unit', targetId: 'unit' }] };
describe('material review', () => {
  it('accepts an explicit zero but never substitutes a missing price', () => {
    expect(catalogIssues(material, [unit, rate])).toEqual([]);
    expect(catalogIssues(material, [unit, { ...rate, configuration: { ...rate.configuration, amount: '' } }])).toEqual([{ kind: 'price', label: 'Complete selling price and unit' }]);
  });
  it('does not treat imported source amounts or cost rates as selling prices', () => {
    expect(catalogIssues({ ...material, attributes: [{ name: 'selling_price_aed', value: '500' }] }, [unit, { ...rate, configuration: { ...rate.configuration, priceType: 'cost' } }])).toEqual([{ kind: 'price', label: 'Add a selling price' }]);
  });
  it('rejects archived or foreign-catalog units and prices', () => {
    expect(catalogIssues(material, [{ ...unit, catalogId: 'other' }, { ...rate, catalogId: 'other' }]).map(issue => issue.kind)).toEqual(['details', 'price']);
    expect(catalogIssues(material, [{ ...unit, archived: true }, rate]).map(issue => issue.kind)).toEqual(['details', 'price']);
  });
  it('keeps specification review explicit and excludes archived materials', () => {
    expect(catalogIssues({ ...material, specificationStatus: 'reference' }, [unit, rate])).toEqual([{ kind: 'details', label: 'Review specification' }]);
    expect(catalogIssues({ ...material, archived: true }, [])).toEqual([]);
  });
});
