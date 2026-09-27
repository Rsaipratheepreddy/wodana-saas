import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { generateTokens } from './sync-design.mjs';
import { BRAND_FOLDERS, brandFiles } from '../../../packages/brand/sync.mjs';

test('native design tokens match the current web source', async () => {
  const actual = await readFile(new URL('../src/design-system/tokens.generated.ts', import.meta.url), 'utf8');
  assert.equal(actual, await generateTokens(), 'Run npm run sync:design after changing web tokens.');
  assert.doesNotMatch(actual, /var\(--wd-/);
});

test('mobile bundles the exact logo and brand characters from packages/brand', async () => {
  for (const folder of BRAND_FOLDERS) {
    const source = new URL(`../../../packages/brand/${folder}/`, import.meta.url);
    const names = await brandFiles(folder);
    assert.ok(names.length >= ({ logo: 5, avatars: 32, woddy: 7 })[folder], `${folder} is missing files`);
    assert.deepEqual((await readdir(new URL(`../assets/brand/${folder}/`, import.meta.url))).filter((name) => /\.(webp|png|svg)$/.test(name)).sort(), names,
      'Run npm run sync:design after changing packages/brand.');
    for (const name of names) {
      assert.deepEqual(await readFile(new URL(name, source)), await readFile(new URL(`../assets/brand/${folder}/${name}`, import.meta.url)), name);
    }
  }
});
