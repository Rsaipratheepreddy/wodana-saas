import assert from 'node:assert/strict';
import test from 'node:test';
import type { Api } from '../src/core/api';
import { createItem } from '../src/core/outbox-model';
import { sendItem } from '../src/core/outbox-send';
import { feedItems, openIssues, reportToOpen, workLines } from '../src/features/projects/day-card-model';
import { sendSiteReport, type ReportPayload } from '../src/features/projects/report-outbox';
import type { DayCard, DayReport, SiteState } from '../../web/lib/site/types';

const dayReport = (patch: Partial<DayReport> = {}): DayReport => ({
  id: 'r1', authorId: 'u2', authorName: 'Sara', status: 'submitted', version: 2, submittedAt: null, decidedAt: null, decidedByName: null, decisionNote: '', late: false, backdated: false,
  delivery: 'pending', sentAt: null, hidden: false, noWorkReason: '', notes: '', clientSummary: '', safety: 'none', safetyNote: '', forecast: 'none', impact: '', recoveryOwnerName: null,
  recoveryOn: null, waitingFor: [], reactions: { like: 0, love: 0 }, ...patch,
});
const card = (date: string, patch: Partial<DayCard> = {}): DayCard => ({
  date, status: 'submitted', clientVisible: false, reports: [dayReport()], crew: [], people: 0, photos: [], materials: [], next: [], stageIds: [], trades: [],
  work: [{ id: 'w1', reportId: 'r1', kind: 'task', title: 'Fit carcasses', workItemId: 't1', number: 4, progress: 60, previous: 20, stageId: 's1', stageName: 'Carpentry', packageName: null,
    area: null, quantity: null, unit: '', note: '', hidden: false },
  { id: 'w2', reportId: 'r1', kind: 'installed', title: 'Worktop', workItemId: null, number: null, progress: null, previous: null, stageId: null, stageName: null, packageName: null,
    area: 'Kitchen', quantity: '2.2500', unit: 'm²', note: '', hidden: false }],
  issues: [{ id: 'i1', reportId: 'r1', severity: 'major', description: 'Socket', internal: true, status: 'open', ownerId: null, ownerName: null, dueOn: null, overdue: false, resolvedAt: null,
    resolvedByName: null, resolution: '', raised: null, workItemId: null, workItemNumber: null, changeRequestId: null, changeRequestReference: null, version: 1 },
  { id: 'i2', reportId: 'r1', severity: 'minor', description: 'Tile', internal: true, status: 'resolved', ownerId: null, ownerName: null, dueOn: null, overdue: false, resolvedAt: null,
    resolvedByName: null, resolution: '', raised: null, workItemId: null, workItemNumber: null, changeRequestId: null, changeRequestReference: null, version: 1 }],
  ...patch,
});

test('the phone lists a card per day and a marker for each missed working day, newest first', () => {
  const items = feedItems({ from: '2026-10-01', to: '2026-10-12', today: '2026-10-12', cards: [card('2026-10-12'), card('2026-10-08')], missing: ['2026-10-11', '2026-10-06'], stages: [], trades: [] });
  assert.deepEqual(items.map((item) => [item.date, item.card ? 'card' : 'missing']), [['2026-10-12', 'card'], ['2026-10-11', 'missing'], ['2026-10-08', 'card'], ['2026-10-06', 'missing']]);
  assert.deepEqual(feedItems(undefined), []);
});

test('a card reads as its work done, open issues and the report to open', () => {
  const day = card('2026-10-12', { reports: [dayReport({ id: 'r1', authorId: 'u2' }), dayReport({ id: 'r2', authorId: 'u1', status: 'draft' })] });
  assert.deepEqual(workLines(day).map((line) => [line.title, line.done, line.progress, line.stage]), [['Fit carcasses', false, 60, 'Carpentry'], ['Worktop', true, null, null]]);
  assert.deepEqual(openIssues(day).map((issue) => issue.id), ['i1']);
  assert.equal(reportToOpen(day, 'u1')?.id, 'r2');
  assert.equal(reportToOpen(day, 'u9')?.id, 'r1');
});

const siteState = (reports: Array<{ id: string; authorId: string; reportDate: string; status: string; version: number; photos?: Array<{ id: string }> }>): SiteState =>
  ({ me: 'u1', today: '2026-10-12', reports: reports.map((report) => ({ photos: [], ...report })) }) as unknown as SiteState;

function recorder(state: SiteState) {
  const calls: string[] = [];
  const api = { workspaceId: 'ws-1',
    get: async () => state,
    send: async (path: string, method: string, body: Record<string, unknown>) => { calls.push(`${method} ${path} ${JSON.stringify(body)}`); return state; },
    upload: async (path: string, method: string, field: string) => { calls.push(`${method} ${path} ${field}`); return state; } } as unknown as Api;
  const open = async (_id: string, file: { key: string; name: string; type: string }) => ({ file: { uri: `file:///plain/${file.key}`, name: file.name, type: file.type }, cleanup: () => undefined });
  return { calls, api, open };
}
const payload: ReportPayload = { projectId: 'p1', reportId: 'new-id', report: { reportDate: '2026-10-11', noWorkReason: '' }, photoIds: ['ph1'], submit: true,
  raise: [{ issueId: 'i1', kind: 'change_request' }] };
const item = () => createItem<Record<string, unknown>>({ id: 'q1', kind: 'site.report', title: 'Daily report', workspaceId: 'ws-1', payload: payload as never,
  files: [{ key: 'ph1', uri: 'file:///a.bin', name: 'a.jpg', type: 'image/jpeg', encrypted: true }] });

test('a report written offline for a day I already reported on (another phone, the web) goes into that report', async () => {
  const { calls, api, open } = recorder(siteState([{ id: 'web-id', authorId: 'u1', reportDate: '2026-10-11', status: 'draft', version: 4 }]));
  const outcome = await sendItem(item(), sendSiteReport, { api, open, step: () => {} });
  assert.deepEqual(outcome, { kind: 'sent', keys: [['projects', 'ws-1', 'p1', 'site']] });
  assert.deepEqual(calls, [
    `POST site/projects/p1 ${JSON.stringify({ action: 'save_report', reportDate: '2026-10-11', noWorkReason: '', id: 'web-id', version: 4 })}`,
    'POST site/projects/p1/reports/web-id/photos/ph1 file',
    `POST site/projects/p1 ${JSON.stringify({ action: 'raise_issue', issueId: 'i1', kind: 'change_request' })}`,
    `POST site/projects/p1 ${JSON.stringify({ action: 'submit', reportId: 'web-id', version: 4 })}`,
  ]);
});

test('a report already submitted elsewhere is left alone; a new day is saved under its own id', async () => {
  const done = recorder(siteState([{ id: 'web-id', authorId: 'u1', reportDate: '2026-10-11', status: 'submitted', version: 5 }]));
  await sendItem(item(), sendSiteReport, { api: done.api, open: done.open, step: () => {} });
  assert.deepEqual(done.calls, []);
  // Someone else's report that day doesn't count as mine.
  const fresh = recorder(siteState([{ id: 'their-id', authorId: 'u2', reportDate: '2026-10-11', status: 'draft', version: 1 }]));
  await sendItem(item(), sendSiteReport, { api: fresh.api, open: fresh.open, step: () => {} });
  assert.match(fresh.calls[0], /"id":"new-id"/);
});
