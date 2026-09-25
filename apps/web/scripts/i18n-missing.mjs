// Lists user-facing labels that are in en.json but not yet in each language (for the translation pass).
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('../lib/i18n/', import.meta.url);
const en = JSON.parse(readFileSync(new URL('en.json', dir), 'utf8'));
for (const file of readdirSync(dir).filter(name => name.endsWith('.json') && name !== 'en.json').sort()) {
  const dictionary = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
  const missing = Object.keys(en).filter(key => !dictionary[key]);
  console.log(`${file.replace('.json', '')}: ${missing.length} of ${Object.keys(en).length} labels untranslated`);
  if (process.argv.includes('--list')) for (const key of missing) console.log(`  ${key}`);
}
