import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeDiagnostics, type DeviceDiagnostic } from '../src/operational/diagnostics-model';

test('device diagnostics are bounded and contain no free-form client payload', () => {
  const rows = Array.from({ length: 20 }, (_, index): DeviceDiagnostic => ({
    at: `2026-09-18T00:00:${String(index).padStart(2, '0')}Z`, environment: 'uat', version: '1', code: 'startup_slow', durationMs: index,
  }));
  const next: DeviceDiagnostic = { at: '2026-09-18T00:01:00Z', environment: 'uat', version: '1', code: 'render_crash' };
  const merged = mergeDiagnostics(rows, next);
  assert.equal(merged.length, 20);
  assert.deepEqual(merged.at(-1), next);
  assert.equal(JSON.stringify(merged).includes('email'), false);
});
