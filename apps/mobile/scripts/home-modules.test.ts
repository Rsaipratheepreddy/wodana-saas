import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleHomeModuleIds } from '../src/components/module-access';
import { homeModules, visibleHomeModules } from '../src/components/home-modules';

test('native module cards follow the selected workspace role summary', () => {
  assert.deepEqual(visibleHomeModuleIds(['workspace', 'crm']), ['crm']);
  assert.deepEqual(visibleHomeModuleIds(['workspace', 'hrms']), ['hrms']);
  assert.deepEqual(visibleHomeModuleIds(['workspace', 'projects']), ['projects']);
  assert.deepEqual(visibleHomeModuleIds(['workspace', 'crm', 'projects']), ['crm', 'projects']);
  assert.deepEqual(visibleHomeModuleIds(undefined), []);
});

test('module destinations explain the work and preserve permission order', () => {
  assert.deepEqual(homeModules.map(({ id, label }) => ({ id, label })), [
    { id: 'crm', label: 'CRM' },
    { id: 'pre-project', label: 'Pre-execution' },
    { id: 'projects', label: 'Projects' },
    { id: 'hrms', label: 'People' },
  ]);
  assert.ok(homeModules.every(module => module.group && module.description));
  assert.deepEqual(visibleHomeModules(['workspace', 'projects', 'hrms', 'crm']).map(module => module.id), ['crm', 'projects', 'hrms']);
});
