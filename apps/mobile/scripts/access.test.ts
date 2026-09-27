import assert from 'node:assert/strict';
import test from 'node:test';
import { canUseInbox, captureActions, makeAccess, workAreas } from '../src/core/access';

const everything = ['crm', 'pre-project', 'projects', 'hrms', 'workspace'] as const;

test('areas and captures follow the server\'s permission codes, never role names', () => {
  const qs = makeAccess(['catalog.view', 'crm.opportunities.view', 'hrms.self', 'pre_projects.view', 'projects.report', 'projects.view'], [...everything]);
  assert.deepEqual(workAreas(qs), ['sales', 'survey', 'projects', 'people']);
  assert.deepEqual(captureActions(qs), ['photo', 'report', 'crew-day', 'snag', 'expense']);
  assert.equal(canUseInbox(qs), false);

  const sales = makeAccess(['crm.leads.view', 'crm.leads.manage', 'crm.activities.view', 'crm.activities.manage', 'crm.notifications.view', 'hrms.self'], ['workspace', 'crm', 'hrms']);
  assert.deepEqual(workAreas(sales), ['sales', 'people']);
  assert.deepEqual(captureActions(sales), ['note', 'follow-up']);
  assert.equal(canUseInbox(sales), true);

  const store = makeAccess(['stock.receive', 'stock.inspect', 'factory.report'], ['workspace', 'projects']);
  assert.deepEqual(workAreas(store), ['deliveries', 'factory']);
  assert.deepEqual(captureActions(store), ['delivery']);
});

test('a module the workspace doesn\'t have hides its areas even with the codes', () => {
  const noProjects = makeAccess(['projects.view', 'purchasing.view', 'factory.view', 'hrms.self'], ['workspace', 'hrms']);
  assert.deepEqual(workAreas(noProjects), ['people']);
  assert.deepEqual(captureActions(noProjects), []);
  assert.equal(makeAccess([], ['workspace']).can('projects.view'), false);
});
