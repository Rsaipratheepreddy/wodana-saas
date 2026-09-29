import assert from 'node:assert/strict';
import test from 'node:test';
import { appRouteFor, routeForDestination } from '../src/core/deep-links';
import { pushOpening } from '../src/features/shell/push-open';

const workspace = '11111111-2222-4333-8444-555555555555';
const record = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const notice = '77777777-8888-4999-8aaa-bbbbbbbbbbbb';

test('a tapped push opens its record in the signed-in workspace and is marked opened', () => {
  const opening = pushOpening({ notificationId: notice, workspaceId: workspace, deepLink: `/workspace/purchasing/orders?order=${record}` }, workspace);
  assert.deepEqual(opening, { route: `/purchasing/order/${record}`, notificationId: notice, otherWorkspace: false });
});

test('a push for another workspace opens nothing in this one', () => {
  assert.equal(pushOpening({ notificationId: notice, workspaceId: record, deepLink: `/workspace/projects/${record}` }, workspace).otherWorkspace, true);
});

test('a link the app cannot read leaves the route to the server; malformed ids are ignored', () => {
  const opening = pushOpening({ notificationId: 'not-an-id', workspaceId: workspace, deepLink: `/workspace/crm/jobs/${record}` }, workspace);
  assert.equal(opening.route, null);
  assert.equal(opening.notificationId, null);
  assert.equal(pushOpening(null, workspace).route, null);
});

test('the server destination for a job or record becomes an app screen', () => {
  assert.equal(routeForDestination({ module: 'projects', screen: 'overview', recordId: record }), `/projects/${record}`);
  assert.equal(routeForDestination({ module: 'projects', screen: 'site', recordId: record }), `/projects/${record}/reports`);
  assert.equal(routeForDestination({ module: 'projects', screen: 'snagging', recordId: record, actionId: notice }), `/projects/${record}/task/${notice}`);
  assert.equal(routeForDestination({ module: 'pre-project', screen: 'overview', recordId: record }), `/survey/${record}`);
  assert.equal(routeForDestination({ module: 'crm', screen: 'leads', recordId: record }), `/sales/${record}`);
  assert.equal(routeForDestination({ module: 'crm', screen: 'deals', recordId: record }), `/sales/opportunity/${record}`);
  assert.equal(routeForDestination({ module: 'crm', screen: 'inbox', recordId: null }), '/inbox');
  assert.equal(routeForDestination({ module: 'crm', screen: 'inbox', recordId: record }), `/chats/${record}`);
  assert.equal(routeForDestination({ module: 'crm', screen: 'calendar', recordId: record }), null);
  assert.equal(routeForDestination({ module: 'projects', screen: '../x', recordId: 'bad' }), '/projects');
  assert.equal(routeForDestination(null), null);
});

test('approvals and lead records named by `record` open in the app', () => {
  assert.equal(appRouteFor('/workspace/approvals'), '/approvals');
  assert.equal(appRouteFor(`/workspace/crm/leads?record=${record}`), `/sales/${record}`);
});
