import assert from 'node:assert/strict';
import test from 'node:test';
import { cardTitle, citedSources, effectiveStatus, historyFor, recordRoute, refusalOf, withCitations, type WoddySource } from '../src/features/woddy/model';

const lead = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const sources: WoddySource[] = [
  { key: 'S1', type: 'enquiry', id: lead, label: 'E-104 · Maya', href: `/workspace/crm/leads?lead=${lead}` },
  { key: 'S2', type: 'project', id: project, label: 'P-7 · Villa 4', href: `/workspace/projects/${project}/overview` },
  { key: 'S3', type: 'customer', id: 'c', label: 'Maya K', href: '/workspace/crm/customers?record=c' },
];

test('a cited record opens its screen in the app; one the phone has no screen for stays a label', () => {
  assert.equal(recordRoute(sources[0]), `/sales/${lead}`);
  assert.equal(recordRoute(sources[1]), `/projects/${project}`);
  assert.equal(recordRoute(sources[2]), null);
  assert.equal(recordRoute({ href: null }), null);
});

test('the answer keeps its words and turns each [S1] into its record', () => {
  const parts = withCitations('Maya is waiting [S1], and the villa is late [S2]. [S9]', sources);
  assert.deepEqual(parts.map((part) => ('source' in part ? `<${part.source.key}>` : part.text)), ['Maya is waiting ', '<S1>', ', and the villa is late ', '<S2>', '. ', '[S9]']);
  assert.deepEqual(citedSources({ sources, cited: ['S2', 'S1'] }).map((source) => source.key), ['S2', 'S1']);
  assert.deepEqual(citedSources({ sources, cited: [] }).map((source) => source.key), ['S1', 'S2', 'S3']);
});

test('only the last ten turns go back, trimmed to the server\'s limit', () => {
  const turns = Array.from({ length: 14 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, text: index === 13 ? 'x'.repeat(4000) : `turn ${index}` }));
  const history = historyFor([...turns, { role: 'assistant', text: '  ' }]);
  assert.equal(history.length, 10);
  assert.equal(history[0].text, 'turn 4');
  assert.equal(history[9].text.length, 3000);
});

test('a card reads in the person\'s language and expires at its time', () => {
  const t = (text: string, values?: Record<string, string | number>) => (text === 'Call' ? 'اتصال' : text.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? '')));
  assert.equal(cardTitle(t, { title: { key: 'Plan a {kind} with {name}', values: { kind: 'Call', name: 'Maya' } }, summary: 'Plan a call' }), 'Plan a اتصال with Maya');
  assert.equal(cardTitle(t, { title: { key: '' }, summary: 'Plan a call' }), 'Plan a call');
  const card = { status: 'proposed' as const, expiresAt: '2026-09-29T10:15:00Z' };
  assert.equal(effectiveStatus(card, Date.parse('2026-09-29T10:14:00Z')), 'proposed');
  assert.equal(effectiveStatus(card, Date.parse('2026-09-29T10:15:00Z')), 'expired');
  assert.equal(effectiveStatus({ ...card, status: 'executed' }, Date.parse('2026-09-30T00:00:00Z')), 'executed');
});

test('a refused question says calmly why: paused, off, no access, busy or unavailable', () => {
  assert.equal(refusalOf(402, null).kind, 'paused');
  assert.equal(refusalOf(429, 'AI_WORKSPACE_DAILY_LIMIT').kind, 'paused');
  assert.equal(refusalOf(503, 'AI_OFF').kind, 'off');
  assert.equal(refusalOf(403, null).kind, 'no-access');
  assert.equal(refusalOf(429, null).kind, 'busy');
  assert.equal(refusalOf(500, null).kind, 'unavailable');
});
