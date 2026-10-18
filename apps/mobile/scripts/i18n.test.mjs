import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { appKeys, missingKeys } from './i18n-keys.mjs';
import { generated } from './sync-i18n.mjs';

test('every label in the app is an English key in the shared dictionary', async () => {
  const keys = await appKeys();
  assert.ok(keys.size > 200, 'labels are found');
  const missing = await missingKeys();
  assert.deepEqual(missing.map(([text, file]) => `${file}: ${text}`), [], 'Add these keys to apps/web/lib/i18n/en.json');
});

test('labels keep their placeholders simple: {name} only', async () => {
  for (const text of (await appKeys()).keys()) assert.doesNotMatch(text, /\$\{|%s|\{\{/, text);
});

test('the phone ships the web translations of its own labels (npm run sync:i18n)', async () => {
  const current = await readFile(new URL('../src/core/i18n.generated.ts', import.meta.url), 'utf8');
  assert.equal(current, await generated(), 'Run npm run sync:i18n');
});
