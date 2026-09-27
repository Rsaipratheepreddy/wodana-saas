import assert from 'node:assert/strict';
import test from 'node:test';
import { appKeys, missingKeys } from './i18n-keys.mjs';

test('every label in the app is an English key in the shared dictionary', async () => {
  const keys = await appKeys();
  assert.ok(keys.size > 200, 'labels are found');
  const missing = await missingKeys();
  assert.deepEqual(missing.map(([text, file]) => `${file}: ${text}`), [], 'Add these keys to apps/web/lib/i18n/en.json');
});

test('labels keep their placeholders simple: {name} only', async () => {
  for (const text of (await appKeys()).keys()) assert.doesNotMatch(text, /\$\{|%s|\{\{/, text);
});
