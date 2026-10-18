import assert from 'node:assert/strict';
import test from 'node:test';
import { areaAndVolume, parseMeasure, toDimensions, toMetres } from '../src/features/survey/measure-model';

test('measurements parse as the server accepts them', () => {
  assert.equal(parseMeasure('2450'), 2450);
  assert.equal(parseMeasure('3,5'), 3.5);
  assert.equal(parseMeasure('1.23456'), null);
  assert.equal(parseMeasure('0'), null);
  assert.equal(parseMeasure('-4'), null);
  assert.equal(parseMeasure('abc'), null);
  assert.equal(toMetres(2450, 'mm'), 2.45);
});

test('area and volume in square and cubic metres, or feet for imperial units', () => {
  assert.deepEqual(areaAndVolume({ length: '4000', width: '3500', height: '2800' }, 'mm'), { area: 14, volume: 39.2, areaUnit: 'm²', volumeUnit: 'm³' });
  assert.deepEqual(areaAndVolume({ length: '12', width: '10' }, 'ft'), { area: 120, volume: null, areaUnit: 'ft²', volumeUnit: 'ft³' });
  assert.deepEqual(areaAndVolume({ length: '120', width: '' }, 'in').area, null);
});

test('dimension rows keep named, valid values measured by the team', () => {
  const rows = toDimensions([{ id: 'a', name: 'Length', value: '4000' }, { id: 'b', name: ' ', value: '10' }, { id: 'c', name: 'Width', value: 'x' }], 'mm', 'site_opening');
  assert.deepEqual(rows, [{ id: 'a', name: 'Length', unit: 'mm', basis: 'site_opening', approximate: null, measured: 4000, source: 'team', evidence: '' }]);
});
