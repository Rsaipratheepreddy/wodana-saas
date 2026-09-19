import assert from 'node:assert/strict';
import test from 'node:test';
import {blankEntry,entryPayload,formatCaseMoney} from '../../web/lib/pre-project/content';
import {newSiteRecord,sitePayload,visitInstant,visitWallTime} from '../../web/lib/pre-project/site';
import {convertMeasurement} from '../src/pre-project/measurements';
import {assignedDesignReviews} from '../src/pre-project/design-review';
import type {CaseDesign} from '../../web/lib/pre-project/content';

test('field entry preserves catalog IDs and several attachment IDs without posting mutable snapshots',()=>{
 const row=blankEntry('room-1');row.title='Wardrobe';row.quantity=72;row.unit='sq.ft';
 row.assets=['original','marked'].map(id=>({id,name:id,mimeType:'image/png',byteSize:1,hasPreview:true}));
 row.catalogLinks=[{role:'work',recordId:'item-1',snapshot:{id:'item-1',name:'Wardrobe',code:'00012',kind:'item',version:4,catalogId:'catalog-1'}}];
 const payload=entryPayload(row);assert.equal(payload.roomId,'room-1');assert.deepEqual(payload.assetIds,['original','marked']);assert.deepEqual(payload.catalogLinks,[{role:'work',recordId:'item-1'}]);assert.equal(payload.quantity,72);
});
test('field measurements preserve optimistic version and separate approximate/measured values',()=>{
 const row=newSiteRecord('measurement','Asia/Dubai','room-1');row.version=3;row.entryId='item-1';row.dimensions=[{id:'width',name:'Width',unit:'ft',basis:'site_opening',approximate:8,measured:7.9,source:'team',evidence:'Tape at top of opening'}];
 const payload=sitePayload(row,6);assert.equal(payload.version,3);assert.equal('specificationVersion' in payload&&payload.specificationVersion,6);assert.deepEqual('dimensions' in payload&&payload.dimensions,row.dimensions);assert.ok(!('materials' in payload));
});
test('unit changes convert both values and reject loss of an unrepresentable tiny measurement',()=>{
 assert.equal(convertMeasurement(8,'ft','mm'),2438.4);assert.equal(convertMeasurement(2438.4,'mm','ft'),8);assert.equal(convertMeasurement(null,'mm','m'),null);assert.throws(()=>convertMeasurement(.0001,'mm','m'),/cannot be represented/);
});
test('field visit time is interpreted in the workspace timezone and invalid DST times are rejected',()=>{
 const iso=visitInstant('2026-09-07T10:00','Asia/Dubai');assert.equal(iso,'2026-09-07T06:00:00.000Z');assert.equal(visitWallTime(iso,'Asia/Dubai'),'2026-09-07T10:00');assert.throws(()=>visitInstant('2026-03-08T02:30','America/New_York'));
});
test('the shared currency formatter keeps the case currency, including zero-decimal currencies',()=>{
 assert.match(formatCaseMoney('2500','JPY','en-US'),/JPY\s*2,500$/);assert.match(formatCaseMoney('1250.5','AED','en-US'),/AED\s*1,250.50$/);
});
test('native design review shows only the current revision assigned to this reviewer',()=>{
 const design=(id:string,status:string,reviewerId:string|null,archivedAt:string|null=null)=>({id,archivedAt,versions:[{id:`${id}-version`,status,reviewerId}]} as unknown as CaseDesign);
 const visible=assignedDesignReviews([
  design('mine','internal_review','reviewer'),
  design('other','internal_review','someone-else'),
  design('approved','internal_approved','reviewer'),
  design('archived','internal_review','reviewer','2026-09-18T00:00:00.000Z'),
 ],'reviewer');
 assert.deepEqual(visible.map(item=>item.id),['mine']);
});
