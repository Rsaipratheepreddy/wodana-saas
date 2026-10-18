import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roomBuilderUnit, roomBuilderUnits } from './room-builder-units.mjs';

test('every supplied unit ID has one reviewed mapping', () => {
  assert.deepEqual(Object.keys(roomBuilderUnits), Array.from({length: 40}, (_, index) => `U${String(index + 1).padStart(3, '0')}`));
  assert.throws(() => roomBuilderUnit({unit_id: 'U041'}), /Unreviewed/);
});

test('physical conversions use the same base within each dimension', () => {
  assert.ok(Math.abs(roomBuilderUnits.U012.baseFactor - 12 * roomBuilderUnits.U011.baseFactor) < 1e-12);
  assert.equal(roomBuilderUnits.U017.baseFactor, 1000 * roomBuilderUnits.U018.baseFactor);
  assert.equal(roomBuilderUnits.U019.baseFactor, 1000 * roomBuilderUnits.U020.baseFactor);
  assert.ok(Math.abs(roomBuilderUnits.U032.baseFactor - 9 * roomBuilderUnits.U001.baseFactor) < 1e-12);
});

test('packs and technical ratings cannot become automatic quantity conversions', () => {
  for (const unit of Object.values(roomBuilderUnits)) {
    if (unit.dimension === 'pack' || unit.dimension === 'reference') assert.equal(unit.baseFactor, undefined);
    else assert.ok(Number.isFinite(unit.baseFactor) && unit.baseFactor > 0);
  }
  assert.equal(roomBuilderUnits.U015.dimension, 'pack');
  assert.equal(roomBuilderUnits.U038.dimension, 'reference');
  assert.equal(roomBuilderUnits.U040.dimension, 'reference');
});
