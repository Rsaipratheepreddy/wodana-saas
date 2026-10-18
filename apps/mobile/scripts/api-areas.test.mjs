import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { usedAreas } from './api-areas.mjs';
import { APP_AREAS, allowedWorkspaceRoute } from './auth-proxy.cjs';

const MODULES = new Set(['workspace', 'crm', 'pre-project', 'projects', 'hrms']);
const declared = async () => JSON.parse(await readFile(new URL('../src/auth/api-areas.json', import.meta.url), 'utf8'));

test('the browser preview proxy forwards every workspace API area the app calls, and nothing stale', async () => {
  const table = await declared();
  const used = await usedAreas();
  assert.ok(used.size >= 10, 'areas are found in the source');
  const missing = [...used].filter(([area]) => !(area in table)).map(([area, places]) => `${area}  ←  ${[...places][0]}`);
  assert.deepEqual(missing, [], 'Add these areas to apps/mobile/src/auth/api-areas.json: the browser preview answers "Not found" for them');
  const stale = Object.keys(table).filter((area) => !used.has(area));
  assert.deepEqual(stale, [], 'The app no longer calls these areas: remove them from apps/mobile/src/auth/api-areas.json');
  assert.deepEqual(Object.keys(table), [...Object.keys(table)].sort(), 'api-areas.json stays sorted');
  for (const [area, module] of Object.entries(table)) assert.ok(MODULES.has(module), `${area}: "${module}" is not a module`);
  assert.deepEqual([...APP_AREAS].sort(), Object.keys(table), 'the proxy reads the same table');
});

test('the proxy accepts each app area and refuses other workspace endpoints', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  for (const area of Object.keys(await declared())) {
    assert.ok(allowedWorkspaceRoute(`/workspaces/${id}/${area}`, 'GET'), area);
    assert.ok(allowedWorkspaceRoute(`/workspaces/${id}/${area}/${id}/photos/${id}`, 'POST'), `${area} with a resource`);
  }
  for (const other of ['settings', 'billing', 'invitations', 'home-overview']) assert.equal(allowedWorkspaceRoute(`/workspaces/${id}/${other}`, 'GET'), false, other);
  assert.equal(allowedWorkspaceRoute(`/workspaces/${id}/home/../settings`, 'GET'), false);
  assert.equal(allowedWorkspaceRoute(`/workspaces/not-a-workspace/home`, 'GET'), false);
});
