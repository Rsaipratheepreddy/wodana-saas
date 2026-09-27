import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { syncBrand } from '../../../packages/brand/sync.mjs';

const app = new URL('../', import.meta.url);
const web = new URL('../../web/', import.meta.url);

function declarations(block) {
  return Object.fromEntries([...block.matchAll(/(--wd-[\w-]+):\s*([^;]+);/g)]
    .map(([, name, value]) => [name, value.trim()]));
}

function blendHex(foreground, background, percent) {
  const share = Number(percent) / 100;
  const channels = [1, 3, 5].map(index => Math.round(
    Number.parseInt(foreground.slice(index, index + 2), 16) * share
    + Number.parseInt(background.slice(index, index + 2), 16) * (1 - share),
  ));
  return `#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function resolve(name, values, seen = new Set()) {
  if (seen.has(name) || !values[name]) throw new Error(`Unresolved design token: ${name}`);
  seen.add(name);
  return values[name].replace(/var\((--wd-[\w-]+)(?:,\s*([^()]+))?\)/g,
    (_, reference, fallback) => values[reference] ? resolve(reference, values, new Set(seen)) : fallback?.trim() ?? (() => { throw new Error(`Unresolved design token: ${reference}`); })())
    .replace(/rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)/g,
      (_, r, g, b, a) => `rgba(${r}, ${g}, ${b}, ${Number(a) / 100})`)
    // Native colors cannot evaluate CSS color-mix. Use the static brand fallback;
    // tenant-selected primary colors are applied separately at runtime.
    .replace(/color-mix\(in oklch,\s*(#[0-9a-f]{6})\s+(\d+)%,\s*(#[0-9a-f]{6})\)/gi,
      (_, foreground, percent, background) => blendHex(foreground, background, percent))
    // A colour mixed with transparent is the same colour at that opacity.
    .replace(/color-mix\(in (?:srgb|oklch),\s*#([0-9a-f]{6})\s+(\d+)%,\s*transparent\)/gi,
      (_, hex, percent) => `rgba(${[0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16)).join(', ')}, ${Number(percent) / 100})`);
}

export async function generateTokens() {
  const css = await readFile(new URL('styles/tokens.css', web), 'utf8');
  const root = declarations(css.match(/:root\s*\{([\s\S]*?)\}/)[1]);
  const camel = (value) => value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const theme = (mode) => {
    const match = css.match(new RegExp(`\\[data-wd-theme="${mode}"\\]\\s*\\{([\\s\\S]*?)\\}`));
    const values = { ...root, ...declarations(match?.[1] ?? '') };
    return Object.fromEntries(Object.keys(root).filter((key) => key.startsWith('--wd-color-'))
      .map((key) => [camel(key.slice(11)), resolve(key, values)]));
  };
  const scale = (prefix, excluded = []) => Object.fromEntries(Object.keys(root)
    .filter((key) => key.startsWith(prefix) && !excluded.includes(key.slice(prefix.length)))
    .map((key) => {
      const value = resolve(key, root);
      const multiplier = value.endsWith('rem') ? 16 : 1;
      const parsed = Number.parseFloat(value) * multiplier;
      if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric token: ${key}`);
      return [key.slice(prefix.length).replace('-', '.'), parsed];
    }));
  const tokens = {
    colors: { light: theme('light'), dark: theme('dark'), 'high-contrast': theme('high-contrast') },
    brand: Object.fromEntries(['lilac', 'rose', 'peach', 'ink'].map((key) => [key, resolve(`--wd-brand-${key}`, root)])),
    spacing: scale('--wd-space-'),
    radius: scale('--wd-radius-', ['round']),
    fontSize: scale('--wd-text-'),
    motion: scale('--wd-duration-'),
  };
  return `// Generated from apps/web/styles/tokens.css. Run npm run sync:design; do not edit.\nexport const tokens = ${JSON.stringify(tokens, null, 2)} as const;\n`;
}

export async function syncDesign() {
  await mkdir(new URL('src/design-system/', app), { recursive: true });
  await mkdir(new URL('assets/brand/', app), { recursive: true });
  await writeFile(new URL('src/design-system/tokens.generated.ts', app), await generateTokens());
  // The logo, role avatars and Woddy come from packages/brand (the same copy the web serves).
  await syncBrand();
  console.log('Synced web colors, type scale, spacing, radii, motion, and the brand assets.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await syncDesign();
