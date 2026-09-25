// Adds every t("…") label used in the web app to lib/i18n/en.json (English text is the key).
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const catalogPath = join(root, 'lib/i18n/en.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const found = new Set();
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'test-results'].includes(name) || name.startsWith('.next')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(tsx|ts)$/.test(name) && !/\.(test|spec)\./.test(name)) {
      for (const match of readFileSync(path, 'utf8').matchAll(/\bt\(\s*"((?:[^"\\]|\\.)+)"/g)) found.add(JSON.parse(`"${match[1]}"`));
    }
  }
}
for (const dir of ['app', 'components', 'lib']) walk(join(root, dir));
const added = [...found].filter((key) => !(key in catalog));
for (const key of added) catalog[key] = key;
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`${added.length} new label(s) added to en.json`);
