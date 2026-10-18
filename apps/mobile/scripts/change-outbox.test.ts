import assert from 'node:assert/strict';
import test from 'node:test';
import type { Api } from '../src/core/api';
import { createItem } from '../src/core/outbox-model';
import { sendItem } from '../src/core/outbox-send';
import { sendChange, type ChangePayload } from '../src/features/projects/change-outbox';

const payload: ChangePayload = { projectId: 'p1', photoIds: ['ph1', 'ph2'], change: { id: 'cr1', title: 'Column behind the wall', reason: 'site_condition', description: '' } };
const item = (step = 0) => ({ ...createItem<Record<string, unknown>>({ id: 'cr1', kind: 'project.change', title: 'Change', workspaceId: 'ws-1', payload: payload as never,
  files: [{ key: 'ph1', uri: 'file:///a.bin', name: 'a.jpg', type: 'image/jpeg', encrypted: true }, { key: 'ph2', uri: 'file:///b.bin', name: 'b.jpg', type: 'image/jpeg', encrypted: true }] }), step });

function recorder() {
  const calls: string[] = [];
  const api = { workspaceId: 'ws-1',
    send: async (path: string, method: string, body: unknown) => { calls.push(`${method} ${path} ${JSON.stringify(body)}`); return {}; },
    upload: async (path: string, method: string, field: string) => { calls.push(`${method} ${path} ${field}`); return {}; } } as unknown as Api;
  const open = async (_id: string, file: { key: string; name: string; type: string }) => ({ file: { uri: `file:///plain/${file.key}`, name: file.name, type: file.type }, cleanup: () => undefined });
  return { calls, api, open };
}

test('a change raised on site is created once on the project, then each photo goes to it', async () => {
  const { calls, api, open } = recorder();
  const steps: number[] = [];
  const outcome = await sendItem(item(), sendChange, { api, open, step: (done) => { steps.push(done); } });
  assert.deepEqual(outcome, { kind: 'sent', keys: [['projects', 'ws-1', 'p1', 'work']] });
  assert.deepEqual(calls, [
    `POST project-changes/p1 ${JSON.stringify(payload.change)}`,
    'POST project-changes/p1/cr1/files/ph1 file',
    'POST project-changes/p1/cr1/files/ph2 file',
  ]);
  assert.deepEqual(steps, [1, 2, 3]);
});

test('a retry after the change and its first photo went sends only the rest', async () => {
  const { calls, api, open } = recorder();
  await sendItem(item(2), sendChange, { api, open, step: () => {} });
  assert.deepEqual(calls, ['POST project-changes/p1/cr1/files/ph2 file']);
});
