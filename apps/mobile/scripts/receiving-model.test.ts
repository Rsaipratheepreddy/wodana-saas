import assert from 'node:assert/strict';
import test from 'node:test';
import { translate } from '../src/core/i18n';
import type { Place } from '../src/features/purchasing/api';
import { placeOption } from '../src/features/purchasing/receiving-model';

const t = (key: string, vars?: Record<string, string | number>) => translate({}, key, vars);
const projectId = '7b1c3d2e-0f4a-4b5c-8d6e-9f0a1b2c3d4e';
const newSite: Place = { key: `site:${projectId}`, kind: 'site', name: null, projectReference: 'PRJ-0015', projectName: 'Saadiyat Island Penthouse 1541' };
const places: Place[] = [
  newSite,
  { key: 'loc-site', kind: 'site', name: 'PRJ-0003 · Arabian Ranches Townhouse 7', projectReference: 'PRJ-0003', projectName: 'Arabian Ranches Townhouse 7' },
  { key: 'warehouse', kind: 'warehouse', name: null, projectReference: null, projectName: null },
  { key: 'loc-wh', kind: 'warehouse', name: 'Main warehouse', projectReference: null, projectName: null },
  { key: 'factory', kind: 'factory', name: null, projectReference: null, projectName: null },
  { key: 'loc-other', kind: 'other', name: 'Yard', projectReference: null, projectName: null },
];

test('a project site made on first use reads "Site · <project name>" with its reference, and keeps the key the server resolves', () => {
  assert.deepEqual(placeOption(newSite, t), { value: `site:${projectId}`, label: 'Site · Saadiyat Island Penthouse 1541', detail: 'PRJ-0015' });
  assert.equal(placeOption({ ...newSite, projectName: null }, t).label, 'Site · PRJ-0015', 'the reference stands in for a missing name');
});

test('a site that exists keeps its own name and does not repeat the reference under it', () => {
  assert.deepEqual(placeOption(places[1], t), { value: 'loc-site', label: 'PRJ-0003 · Arabian Ranches Townhouse 7' });
  assert.deepEqual(placeOption({ ...places[1], name: 'Villa site' }, t), { value: 'loc-site', label: 'Villa site', detail: 'PRJ-0003' });
});

test('stores made on first use read their kind; named ones keep their name', () => {
  assert.deepEqual(places.slice(2).map((place) => placeOption(place, t)), [
    { value: 'warehouse', label: 'Warehouse' }, { value: 'loc-wh', label: 'Main warehouse' }, { value: 'factory', label: 'Factory' }, { value: 'loc-other', label: 'Yard' },
  ]);
});

test('every place has a readable label and is found again by its key once chosen', () => {
  const options = places.map((place) => placeOption(place, t));
  for (const option of options) assert.ok(option.label.trim().length > 0, `${option.value} has a label`);
  const chosen = options.find((option) => option.value === newSite.key);
  assert.equal(chosen?.label, 'Site · Saadiyat Island Penthouse 1541');
});
