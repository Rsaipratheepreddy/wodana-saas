import assert from 'node:assert/strict';
import test from 'node:test';
import { addPoint, arrowHead, decimate, fit, normalise, penPath, toServerStrokes, type Mark } from '../src/features/capture/markup-model';

test('marks live in the photo\'s own coordinates and draw at any size', () => {
  assert.deepEqual(normalise(50, 25, 100, 50), { x: 0.5, y: 0.5 });
  assert.deepEqual(normalise(-10, 80, 100, 50), { x: 0, y: 1 });
  assert.equal(penPath([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }], 200, 100), 'M 0.0 0.0 Q 100.0 50.0 150.0 75.0 L 200.0 100.0');
  assert.match(penPath([{ x: 0.1, y: 0.1 }], 100, 100), /^M 10\.0 10\.0 L/);
  assert.deepEqual(fit(4000, 3000, 400, 600), { width: 400, height: 300 });
  assert.deepEqual(fit(3000, 4000, 400, 400), { width: 300, height: 400 });
});

test('strokes stay light: close points are skipped and long strokes thinned evenly', () => {
  const one = addPoint([], { x: 0, y: 0 });
  assert.equal(addPoint(one, { x: 0.001, y: 0.001 }).length, 1);
  assert.equal(addPoint(one, { x: 0.01, y: 0 }).length, 2);
  const long = Array.from({ length: 101 }, (_, index) => ({ x: index / 100, y: 0 }));
  const thin = decimate(long, 11);
  assert.equal(thin.length, 11);
  assert.deepEqual([thin[0], thin[10]], [long[0], long[100]]);
});

test('the server gets polylines within its limits; arrows become lines and text stays on the photo', () => {
  const [left, right] = arrowHead({ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, 100, 100);
  assert.ok(left.x < 1 && right.x < 1 && left.y !== right.y);
  const marks: Mark[] = [
    { kind: 'pen', color: '#FF3B30', width: 0.5, points: Array.from({ length: 3000 }, (_, index) => ({ x: (index % 100) / 100, y: 0.5 })) },
    { kind: 'arrow', color: '#FFCC00', width: 0.006, from: { x: 0.1, y: 0.1 }, to: { x: 0.9, y: 0.9 } },
    { kind: 'text', color: '#FFFFFF', text: 'Move socket', at: { x: 0.2, y: 0.2 }, size: 0.05 },
  ];
  const strokes = toServerStrokes(marks);
  assert.equal(strokes.length, 3);
  assert.equal(strokes[0].width, 0.03);
  assert.ok(strokes[0].points.length <= 1500);
  assert.ok(strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) <= 4000);
  assert.equal(toServerStrokes(Array.from({ length: 150 }, () => marks[0])).length, 100);
});
