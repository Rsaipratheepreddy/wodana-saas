import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
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

test('mobile bundles the exact brand characters from packages/brand', async () => {
  for (const folder of ['avatars', 'woddy']) {
    const source = new URL(`../../../packages/brand/${folder}/`, import.meta.url);
    const names = (await readdir(source)).filter((name) => name.endsWith('.webp')).sort();
    assert.ok(names.length >= (folder === 'avatars' ? 32 : 7), `${folder} is missing files`);
    assert.deepEqual((await readdir(new URL(`../assets/brand/${folder}/`, import.meta.url))).filter((name) => name.endsWith('.webp')).sort(), names,
      'Run npm run sync:design after changing packages/brand.');
    for (const name of names) {
      assert.deepEqual(await readFile(new URL(name, source)), await readFile(new URL(`../assets/brand/${folder}/${name}`, import.meta.url)), name);
    }
  }
});
