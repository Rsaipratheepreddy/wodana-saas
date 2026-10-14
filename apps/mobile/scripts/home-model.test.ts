import assert from 'node:assert/strict';
import test from 'node:test';
import type { HomeMetrics } from '../../../packages/contracts/src/home';
import { changeBetween, dueLabel, expectsNumbers, figuresFor, lensFor, reportIsLate, showsPipeline } from '../src/features/today/home-model';

const item = (overrides: Partial<{ due: string | null; urgency: string }>) => ({ due: null, urgency: 'today', ...overrides });
const format = { time: (value: string) => value.slice(11, 16), date: (value: string) => `<${value}>` };

test('due reads the web\'s way, on the workspace\'s calendar', () => {
  const today = '2026-09-29';
  assert.deepEqual(dueLabel(item({ due: '2026-09-26', urgency: 'overdue' }), today, 'Asia/Dubai', format), { key: '{count} days late', values: { count: 3 } });
  assert.deepEqual(dueLabel(item({ due: '2026-09-28T20:30:00Z', urgency: 'overdue' }), today, 'Asia/Dubai', format), { key: 'Due {time}', values: { time: '20:30' } }, 'already the 29th in Dubai');
  assert.deepEqual(dueLabel(item({ due: '2026-09-28T19:00:00Z', urgency: 'overdue' }), today, 'Asia/Dubai', format), { key: '1 day late' });
  assert.deepEqual(dueLabel(item({ due: '2026-09-29T12:00:00Z' }), today, 'Asia/Dubai', format), { key: 'Today {time}', values: { time: '12:00' } });
  assert.deepEqual(dueLabel(item({ due: '2026-09-29' }), today, 'Asia/Dubai', format), { key: 'Today' });
  assert.deepEqual(dueLabel(item({ due: '2026-09-12T08:00:00Z', urgency: 'waiting' }), today, 'Asia/Dubai', format), { key: 'Since {date}', values: { date: '<2026-09-12>' } });
  assert.equal(dueLabel(item({ due: null }), today, 'Asia/Dubai', format), null);
});

test('the pipeline is for people who see the front of the business', () => {
  assert.equal(showsPipeline([{ id: 'projects', count: 4, stuck: 1, href: '' }, { id: 'handover', count: 1, stuck: 0, href: '' }]), false);
  assert.equal(showsPipeline([{ id: 'enquiries', count: 11, stuck: 5, href: '' }]), true);
});

const metrics: HomeMetrics = {
  generatedAt: '', timeZone: 'Asia/Dubai', weekStartsOn: 1, currency: 'AED',
  enquiries: { current: 12, previous: 8, weekly: [] },
  payments: { received: '42000.00', previousReceived: '60000.00', due: '15000.00', weekly: [] },
  projects: { active: 6, overdueTasks: 3, onTrack: 4, atRisk: 1, late: 1, weekly: [] },
  quotes: { issuedValue: '90000', previousIssuedValue: '0', issuedCount: 2, accepted: 1, previousAccepted: 0, awaiting: 3, weekly: [] },
};

test('owners see money and projects; sales see enquiries and quotes; figures follow what the server sent', () => {
  const can = (...granted: string[]) => (...codes: string[]) => codes.some((code) => granted.includes(code));
  assert.equal(lensFor(can('workspace.settings.manage', 'crm.leads.view')), 'business');
  assert.equal(lensFor(can('receivables.view')), 'finance');
  assert.equal(lensFor(can('crm.leads.view')), 'sales');
  assert.equal(lensFor(can('projects.view')), 'projects');
  assert.equal(expectsNumbers(can('hrms.self')), false);
  const business = figuresFor(metrics, 'business');
  assert.deepEqual(business.map((figure) => figure.id), ['money-in', 'projects']);
  assert.deepEqual(business[0].value, { kind: 'money', amount: '42000.00', currency: 'AED' });
  assert.deepEqual(business[0].note, { key: '{percent}% down on last month', values: { percent: 30 }, tone: 'warning' });
  assert.deepEqual(business[1].note, { key: '{count} late', values: { count: 1 }, tone: 'danger' });
  const sales = figuresFor(metrics, 'sales');
  assert.deepEqual(sales.map((figure) => figure.id), ['enquiries', 'quoted']);
  assert.deepEqual(sales[1].note, { key: 'None last month', tone: 'neutral' });
  // Without money on the answer (no permission), the business lens falls back to what is there.
  assert.deepEqual(figuresFor({ ...metrics, payments: undefined }, 'business').map((figure) => figure.id), ['projects', 'enquiries']);
  assert.deepEqual(changeBetween('10', '10'), { direction: 'flat', percent: 0 });
});

test('a missing site report turns late at the workspace\'s "Daily report due" time, 18:00 when unset', () => {
  assert.equal(reportIsLate(17, '18:00'), false);
  assert.equal(reportIsLate(18, '18:00'), true);
  assert.equal(reportIsLate(19, '19:00'), true, 'a firm whose reports are due at 19:00');
  assert.equal(reportIsLate(18, '19:00'), false);
  assert.equal(reportIsLate(18, '18:30'), false, 'half past: the hour is all the server sends, so it counts from 19:00');
  assert.equal(reportIsLate(19, '18:30'), true);
  assert.equal(reportIsLate(18, null), true, 'no setting: 18:00');
  assert.equal(reportIsLate(17, undefined), false);
  assert.equal(reportIsLate(null, '18:00'), false, 'no clock from the server: never amber');
});
