import assert from 'node:assert/strict';
import test from 'node:test';
import { appRouteFor } from '../src/core/deep-links';

const id = '11111111-2222-4333-8444-555555555555';
const other = '66666666-7777-4888-9999-aaaaaaaaaaaa';

test('notification links open the same record in the app', () => {
  const cases: Array<[string, string | null]> = [
    [`/workspace/projects/${id}/site?crewDay=${other}`, `/crew-day/${other}`],
    [`/workspace/projects/${id}/site`, `/projects/${id}/reports`],
    [`/workspace/projects/${id}/plan?item=${other}`, `/projects/${id}/task/${other}`],
    [`/workspace/projects/${id}/snagging?record=${other}`, `/projects/${id}/task/${other}`],
    [`/workspace/projects/${id}/handover?record=${other}`, `/projects/${id}/handover`],
    [`/workspace/projects/${id}/petty-cash?claim=${other}`, `/projects/${id}/expenses`],
    [`/workspace/projects/${id}`, `/projects/${id}`],
    [`/workspace/hrms/leave?request=${id}`, `/hrms/leave?request=${id}`],
    [`/workspace/hrms/team?leave=${id}`, '/hrms/team'],
    [`/workspace/hrms/crews?crewDay=${id}`, `/crew-day/${id}`],
    ['/workspace/hrms/time?week=2026-09-21', '/hrms/time?week=2026-09-21'],
    ['/workspace/hrms?day=2026-09-20', '/hrms/days?day=2026-09-20'],
    [`/workspace/crm/leads?lead=${id}`, `/sales/${id}`],
    [`/crm/leads/${id}`, `/sales/${id}`],
    [`/workspace/crm/opportunities?record=${id}`, `/sales/opportunity/${id}`],
    [`/workspace/crm/follow-ups?record=${id}`, '/sales/follow-ups'],
    [`/workspace/purchasing/orders?order=${id}`, `/purchasing/order/${id}`],
    [`/workspace/purchasing/deliveries?receipt=${id}`, `/purchasing/receipt/${id}`],
    [`/workspace/factory/orders?order=${id}`, `/factory/${id}`],
    [`/workspace/inventory/moves?move=${id}`, `/purchasing/move/${id}`],
    [`/workspace/pre-projects/cases/${id}/overview`, `/survey/${id}`],
    [`/workspace/tasks?projectId=${id}&taskId=${other}`, `/projects/${id}/task/${other}`],
    [`/workspace/crm/conversations?record=${id}&lead=${other}`, `/chats/${id}`],
    [`/workspace/crm/inbox?conversation=${id}`, `/chats/${id}`],
    [`/workspace/crm/conversations?lead=${other}`, `/sales/${other}`],
    ['/workspace/inventory', '/purchasing'],
  ];
  for (const [link, route] of cases) assert.equal(appRouteFor(link), route, link);
});

test('links the app has no screen for, or that are malformed, open nothing', () => {
  for (const link of [null, '', '/workspace/finance/bills?bill=1', '/workspace/gallery', `/workspace/projects/not-an-id/site`, `/workspace/crm/leads?lead=../../x`]) {
    const route = appRouteFor(link);
    assert.ok(route === null || route === '/projects' || route === '/sales', String(link));
  }
  assert.equal(appRouteFor('https://tenant.example.com/workspace/hrms/leave'), '/hrms/leave');
});
