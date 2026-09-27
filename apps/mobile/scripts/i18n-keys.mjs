// Every label the app shows is English text used as a key (t('…') or key('…')); this lists them and
// the ones apps/web/lib/i18n/en.json doesn't have yet. `node scripts/i18n-keys.mjs` prints the missing keys.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../src/', import.meta.url);
const pattern = /\b(?:t|key)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
    return entry.isDirectory() ? files(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

export async function appKeys() {
  const keys = new Map();
  for (const file of await files(root)) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      const text = match[2].replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');
      if (!keys.has(text)) keys.set(text, fileURLToPath(file).split('/src/')[1]);
    }
  }
  return keys;
}

export async function missingKeys() {
  const dictionary = JSON.parse(await readFile(new URL('../../web/lib/i18n/en.json', import.meta.url), 'utf8'));
  return [...(await appKeys()).entries()].filter(([text]) => !(text in dictionary));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const missing = await missingKeys();
  if (process.argv.includes('--json')) console.log(JSON.stringify(Object.fromEntries(missing.map(([text]) => [text, text])), null, 2));
  else for (const [text, file] of missing) console.log(`${file}\t${text}`);
  console.error(`${missing.length} missing`);
}
