import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { generateTokens } from './sync-design.mjs';

test('native design tokens match the current web source', async () => {
  const actual = await readFile(new URL('../src/design-system/tokens.generated.ts', import.meta.url), 'utf8');
  assert.equal(actual, await generateTokens(), 'Run npm run sync:design after changing web tokens.');
  assert.doesNotMatch(actual, /var\(--wd-/);
});

test('mobile uses the exact current web logo and mascot', async () => {
  for (const name of ['wodana-logo-v4.png', 'woddy-mark-v4.png']) {
    const mobile = await readFile(new URL(`../assets/brand/${name}`, import.meta.url));
    const web = await readFile(new URL(`../../web/public/brand/wodana/${name}`, import.meta.url));
    assert.deepEqual(mobile, web);
  }
});
