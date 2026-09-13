import {describe,it,expect} from 'vitest';
import {blankCatalogRecord} from './catalog';
import {attributeLabel,attributeValue,displayAttributes} from './catalog-display';
import {draftFromImportedPrice,importedPrices} from './catalog-prices';

describe('catalog source data and price entry',()=>{
 it('formats room properties without deleting identity or source evidence',()=>{
  const room={...blankCatalogRecord('room'),name:'Balcony',description:'Open balcony',attributes:[{name:'room_id',value:'RM015'},{name:'room_name',value:'Balcony'},{name:'description',value:'Open balcony'},{name:'min_sqft',value:'40'},{name:'max_sqft',value:'120'},{name:'Source row',value:'16'}]};
  const original=structuredClone(room);
  const result=displayAttributes(room,[room]);
  expect(result.specifications.map(a=>attributeLabel(a.name))).toEqual(['Minimum area (sq.ft)','Maximum area (sq.ft)']);
  expect(result.importDetails).toHaveLength(4);
  expect(attributeValue('is_modular','false')).toBe('No');
  expect(attributeValue('product_id','000123')).toBe('000123');
  expect(room).toEqual(original);
 });
 it('copies a selling price but requires confirmation of missing commercial details',()=>{
  const unit={...blankCatalogRecord('unit'),id:'sqft',catalogId:'catalog',name:'Square foot'};
  const material={...blankCatalogRecord('material'),catalogId:'catalog',links:[{relation:'unit',targetId:unit.id}],attributes:[{name:'selling_price_inr',value:'897'}]};
  const blank={...blankCatalogRecord('rate_card'),links:[{relation:'material',targetId:material.id},{relation:'unit',targetId:unit.id}],configuration:{priceType:'cost',effectiveFrom:'2026-09-07',taxIncluded:'yes',costIncludes:'supply_only'}};
  const draft=draftFromImportedPrice(material,importedPrices(material)[0],[unit],blank);
  expect(draft.configuration).toMatchObject({amount:897,currency:'INR',priceType:'selling'});
  expect(draft.configuration).not.toHaveProperty('taxIncluded');
  expect(draft.configuration).not.toHaveProperty('costIncludes');
  expect(draft.configuration).not.toHaveProperty('effectiveFrom');
  expect(draft.links).toEqual(blank.links);
 });
 it('does not treat a pack price as a per-litre price or resolve units from another catalog',()=>{
  const litre={...blankCatalogRecord('unit'),id:'litre',catalogId:'catalog',name:'Litre'};
  const material={...blankCatalogRecord('sku'),catalogId:'catalog',links:[{relation:'unit',targetId:litre.id}],attributes:[{name:'price_per_pack_inr',value:'2400'}]};
  const blank={...blankCatalogRecord('rate_card'),links:[{relation:'sku',targetId:material.id},{relation:'unit',targetId:litre.id}]};
  const draft=draftFromImportedPrice(material,importedPrices(material)[0],[litre],blank);
  expect(draft.links).toEqual([{relation:'sku',targetId:material.id}]);
  expect(draft.configuration).not.toHaveProperty('priceType');
  material.attributes=[{name:'price_per_sqft_inr',value:'120'}];
  const foreign={...litre,id:'foreign',catalogId:'other',name:'Square foot'};
  expect(draftFromImportedPrice(material,importedPrices(material)[0],[litre,foreign],blank).links).toEqual([{relation:'sku',targetId:material.id}]);
  material.attributes=[{name:'base_price_inr',value:'120'},{name:'unit',value:'sqft'}];
  const originalUnit={...foreign,id:'sqft',catalogId:'catalog'};
  expect(draftFromImportedPrice(material,importedPrices(material)[0],[litre,originalUnit],blank).links).toContainEqual({relation:'unit',targetId:'sqft'});
 });
});
