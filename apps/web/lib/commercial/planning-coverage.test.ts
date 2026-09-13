import { describe, expect, it } from 'vitest';
import { planningCoverage, planningCapacityExceeded } from './planning-coverage';
import { planningCatalog, decodePlanningSuggestions } from './planning-catalog';
import { resolveRoomSuggestions, type AssistCatalogRecord } from './quotation-assist';

const record = (id: string, kind: string): AssistCatalogRecord => ({ id, kind, name: id, code: id, catalogId: 'master', version: 1 });
const records = [record('Bedroom', 'room'), ...Array.from({length: 30}, (_, i) => record(`Item ${i}`, 'work'))];
const links = records.slice(1).map(work => ({ recordId: work.id, targetId: 'Bedroom', relation: 'room' }));
const sources = new Set(['brief', 'requirement-1', 'requirement-2']);
const plan = { rooms: [{ roomId: 'Bedroom', name: 'Bedroom 1', sourceIds: ['brief', 'requirement-1'], items: [{workId: 'Item 0', sourceIds: ['requirement-1']}]}] };

describe('complete quotation scope planning', () => {
  it('preserves distinct room instances and more than the former room/item limits', () => {
    const raw = { rooms: Array.from({length: 24}, (_, i) => ({ roomId: 'Bedroom', name: `Bedroom ${i + 1}`, sourceIds: ['brief'], items: records.slice(1, i === 0 ? undefined : 2).map(work => ({workId: work.id})) })) };
    const result = resolveRoomSuggestions(raw, records, links, sources);
    expect(result.rooms).toHaveLength(24);
    expect(result.rooms[0].items).toHaveLength(30);
    expect(new Set(result.rooms.map(room => room.id)).size).toBe(24);
    expect(result.rooms[23].name).toBe('Bedroom 24');
    expect(resolveRoomSuggestions({rooms:[{...raw.rooms[0],name:'Bedroom '.repeat(30)}]},records,links,sources).rooms[0].name.length).toBeLessThanOrEqual(120);
  });
  it('flags requirements omitted from verified items even if the room cites them', () => {
    const raw = {...plan, rooms: [{...plan.rooms[0], sourceIds: ['brief', 'requirement-1', 'requirement-2']}], unmatched: [{name: 'Sauna', reason: 'Add a suitable room to Master Data.', sourceIds: ['requirement-2']}, {name: 'Foreign scope', reason: 'Ignore', sourceIds: ['foreign-case']}]};
    const rooms = resolveRoomSuggestions(raw, records, links, sources).rooms;
    const result = planningCoverage(raw, rooms, [{id: 'requirement-1', name: 'Bed', kind: 'requirement'}, {id: 'requirement-2', name: 'Sauna heater', kind: 'requirement'}], sources);
    expect(result.coverage).toEqual({total: 2, linked: 1});
    expect(result.review.join(' ')).toContain('Sauna heater: no verified item suggestion');
    expect(result.review.join(' ')).toContain('Sauna: Add a suitable room');
    expect(result.review.join(' ')).not.toContain('Foreign scope');
  });
  it('surfaces incompatible item links instead of claiming complete coverage', () => {
    const raw = {rooms: [{...plan.rooms[0], items: [{workId: 'missing-item', sourceIds: ['requirement-1']}]}]};
    const rooms = resolveRoomSuggestions(raw, records, links, sources).rooms;
    const result = planningCoverage(raw, rooms, [{id:'requirement-1',name:'Required item',kind:'requirement'}], sources);
    expect(result.coverage.linked).toBe(0);
    expect(result.review.join(' ')).toContain('incompatible Master Data links');
  });
  it('uses fresh room/item names, aliases and links on each analysis', () => {
    const before = planningCatalog(records, links);
    const added = {...record('Wellness suite', 'room'),content:{aliases:['Spa','Recovery room']}};
    const after = planningCatalog([...records, added, record('Sauna heater','work')], [...links,{recordId:'Sauna heater',targetId:added.id,relation:'room'}]);
    expect(before.records.some(row => row.name === added.name)).toBe(false);
    const room = after.records.find(row => row.name === added.name)!;
    const item = after.records.find(row => row.name === 'Sauna heater')!;
    expect(room.aliases).toEqual(['Spa','Recovery room']);
    expect(after.links).toContainEqual({recordId:item.id,targetId:room.id,relation:'room'});
    const decoded = decodePlanningSuggestions({rooms:[{roomId:room.id,sourceIds:['brief'],items:[{workId:item.id}]}]}, after.references);
    expect(decoded.rooms[0].roomId).toBe(added.id);
    expect(decoded.rooms[0].items[0].workId).toBe('Sauna heater');
  });
  it('rejects plans beyond quotation capacity without silently dropping the tail', () => {
    expect(planningCapacityExceeded({rooms:Array.from({length:101},()=>({items:[]}))})).toBe(true);
    expect(planningCapacityExceeded({rooms:[{items:Array.from({length:301},()=>({}))}]})).toBe(true);
    expect(planningCapacityExceeded({rooms:[{items:Array.from({length:300},()=>({}))}]})).toBe(false);
  });
});
