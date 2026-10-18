import {describe,it,expect} from 'vitest';
import {parseScopePaste,formatCaseMoney,entryPayload,blankEntry,updateItemMaterial,chooseItemMaterial,blankSpecification,specificationPayload} from './content';
import {allowedCasePath} from './api-path';
import {translatorFor} from '@/lib/i18n/keys';
const id='e56299c6-3da3-402a-a9ac-3995bb37b9d4';
describe('pre-project entry boundaries',()=>{
 it('preserves quantity and notes from Excel without matching names automatically',()=>{const rows=parseScopePaste('Wardrobe\t72\tsq.ft\t8 × 9 ft\nDesk\t1\tnos','room');expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({roomId:'room',quantity:72,unit:'sq.ft',scopeStatus:'undecided',catalogLinks:[],note:'8 × 9 ft'});expect(rows[0].id).not.toBe(rows[1].id);});
 it.each(['Item\t-1','Item\t1,200','Item\tNaN','Item\t0','Item\t1.12345'])('rejects ambiguous or invalid quantities: %s',text=>expect(()=>parseScopePaste(text,null)).toThrow('Row 1'));
 it('limits bulk entry before sending',()=>expect(()=>parseScopePaste(Array(101).fill('Item').join('\n'),null)).toThrow('100'));
 it('sends IDs instead of trusting a client-supplied catalog snapshot',()=>{const entry=blankEntry();entry.catalogLinks=[{role:'work',recordId:id,snapshot:{id,name:'Editable label',kind:'work',code:'X',version:2,catalogId:id}}];const result=entryPayload(entry);expect(result.catalogLinks).toEqual([{role:'work',recordId:id}]);expect(result).not.toHaveProperty('archivedAt');});
 it('formats actual case currencies and preserves zero',()=>{const t=translatorFor({});expect(formatCaseMoney('1200','AED','en',t)).toContain('AED');expect(formatCaseMoney('0','INR','en',t)).toContain('0.00');expect(formatCaseMoney('','AED','en',t)).toBe('Not set');expect(formatCaseMoney('500','JPY','en',t)).not.toContain('.00');});
 it('allows only scoped, supported API operations',()=>{expect(allowedCasePath([id,'entries','bulk'],'POST')).toBe(true);expect(allowedCasePath([id,'designs',id,'versions'],'POST')).toBe(true);expect(allowedCasePath([id,'assets',id],'GET')).toBe(true);expect(allowedCasePath([id,'designs',id,'delete'],'POST')).toBe(false);expect(allowedCasePath(['..','brief'],'GET')).toBe(false);expect(allowedCasePath([id,'rooms'],'DELETE')).toBe(false);});
});

describe('project material selection revisions',()=>{
 it('returns changed selections to proposed and removes the old confirmation from the draft',()=>{const old={id:'a',application:'Shutter',materialId:null,brandId:null,finishId:null,productName:'Laminate',productCode:'00012',finishCode:'001-M',stockSize:'1 mm',status:'selected',selectedBy:'Client',selectedAt:'2026-09-07',evidence:'Meeting 01',assetIds:['photo']};const next=updateItemMaterial(old,{finishCode:'002-M'});expect(next).toMatchObject({status:'proposed',selectedBy:'',selectedAt:null,evidence:'',assetIds:[]});expect(old).toMatchObject({status:'selected',finishCode:'001-M'});});
 it('does not send approval, verification or snapshot metadata from the browser',()=>{const spec=blankSpecification();spec.designRefs=[{versionId:id,usage:'2d',sheet:'001',currentStatus:'approved'}];spec.dimensions=[{id,name:'Width',unit:'ft',basis:'finished_item',approximate:8,measured:8.1,source:'client',evidence:'Sketch',verification:'verified'}];const payload=specificationPayload(spec);expect(payload.designRefs[0]).not.toHaveProperty('currentStatus');expect(payload.dimensions[0]).not.toHaveProperty('verification');});
});

it('loads the chosen catalog product without keeping a different product code or brand',()=>{
 const old={id:'a',application:'Shutter',materialId:'old',brandId:'old-brand',finishId:'old-finish',productName:'Old product',productCode:'OLD',finishCode:'OLD-F',stockSize:'Old format',status:'proposed',selectedBy:'',selectedAt:null,evidence:'',assetIds:[]};
 const chosen={id,name:'New product',code:'INTERNAL-001',kind:'sku',version:3,catalogId:id,configuration:{manufacturerCode:'000042',finishCode:'001-M',format:'8 × 4 ft'}};
 const result=chooseItemMaterial(old,chosen);expect(result).toMatchObject({productCode:'000042',finishCode:'001-M',stockSize:'8 × 4 ft',productName:'New product',brandId:null,finishId:null});expect(result.productCode).not.toBe(chosen.code);
});
