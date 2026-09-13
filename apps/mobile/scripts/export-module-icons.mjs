import { mkdir, writeFile } from 'node:fs/promises';
import { moduleIconArt, moduleIconNames } from '../src/components/module-icon-art.ts';
import { tokens } from '../src/design-system/tokens.generated.ts';

const output = new URL('../assets/icons/modules/', import.meta.url);
await mkdir(output, { recursive: true });
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const ink = tokens.brand.ink;
const attrs = (values) => Object.entries(values).map(([key, value]) => `${key}="${escape(value)}"`).join(' ');

function artwork(name, variant) {
  const id = `${name}-${variant}`;
  const definition = moduleIconArt[name];
  const gradient = variant === 'brand' ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${tokens.brand.lilac}"/><stop offset="0.48" stop-color="${tokens.brand.rose}"/><stop offset="1" stop-color="${tokens.brand.peach}"/></linearGradient></defs>` : '';
  const shapes = definition.shapes.map((shape) => {
    const fill = shape.fill === 'ink' ? ink : variant === 'brand' && shape.fill ? `url(#${id})` : 'none';
    return `<${shape.tag} ${attrs(shape.attributes)} fill="${fill}" fill-opacity="${shape.fill === 'soft' ? 0.32 : 1}"/>`;
  }).join('');
  return `${gradient}<g fill="none" stroke="${ink}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${shapes}</g>`;
}

for (const name of moduleIconNames) {
  for (const variant of ['brand', 'outline']) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" role="img" aria-label="${moduleIconArt[name].label}"><title>${moduleIconArt[name].label}</title>${artwork(name, variant)}</svg>\n`;
    await writeFile(new URL(`${name}-${variant}.svg`, output), svg);
  }
}

const icon = (name, variant, x, y, size) => `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24">${artwork(name, variant)}</svg>`;
const text = (value, x, y, size = 16, more = '') => `<text x="${x}" y="${y}" font-size="${size}" ${more}>${escape(value)}</text>`;
const statuses = { workspace: 'Workspace foundation', crm: 'API-backed web flows', 'pre-project': 'Case foundation', projects: 'Demo', hrms: 'Planned' };
const modules = moduleIconNames.filter((name) => moduleIconArt[name].group === 'module');
const shortcuts = moduleIconNames.filter((name) => moduleIconArt[name].group === 'shortcut');
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="828" viewBox="0 0 1200 828" role="img" aria-label="Wodana mobile module icon set"><rect width="1200" height="828" fill="#fcfafc"/><g font-family="Inter, Arial, sans-serif" fill="${ink}">`;
sheet += text('WODANA  /  MOBILE', 56, 58, 13, 'letter-spacing="2" fill="#735a78"');
sheet += text('Module icons', 56, 108, 34, 'font-weight="600"');
sheet += text('11 icons · Brand and outline variants · Native SVG', 56, 140, 15, 'fill="#7d717c"');
sheet += text('BUSINESS MODULES', 56, 191, 12, 'letter-spacing="1.5" fill="#7d717c"');
modules.forEach((name, index) => {
  const x = 56 + index * 221.6;
  const center = x + 100.8;
  sheet += `<rect x="${x}" y="210" width="201.6" height="192" rx="18" fill="#ffffff" stroke="#ebe5ec"/>`;
  sheet += icon(name, 'brand', center - 30, 238, 60);
  sheet += text(moduleIconArt[name].label, center, 338, 17, 'text-anchor="middle" font-weight="600"');
  sheet += text(statuses[name], center, 366, 12, 'text-anchor="middle" fill="#7d717c"');
});
sheet += text('SHARED SHORTCUTS', 56, 460, 12, 'letter-spacing="1.5" fill="#7d717c"');
shortcuts.forEach((name, index) => {
  const x = 56 + index * (1108 / 6);
  const center = x + (1088 - 100) / 12;
  sheet += `<rect x="${x}" y="480" width="${(1088 - 100) / 6}" height="142" rx="16" fill="#ffffff" stroke="#ebe5ec"/>`;
  sheet += icon(name, 'brand', center - 22, 503, 44);
  sheet += text(moduleIconArt[name].label, center, 587, 14, 'text-anchor="middle"');
});
sheet += '<path d="M56 668h1088" stroke="#e9e1eb"/>';
sheet += text('OUTLINE VARIANTS', 56, 702, 12, 'letter-spacing="1.5" fill="#7d717c"');
moduleIconNames.forEach((name, index) => {
  const center = 56 + (index + 0.5) * (1088 / 11);
  sheet += icon(name, 'outline', center - 14, 729, 28);
  sheet += text(moduleIconArt[name].label, center, 787, 11, 'text-anchor="middle" fill="#7d717c"');
});
sheet += '</g></svg>\n';
await writeFile(new URL('icon-sheet.svg', output), sheet);
console.log(`Exported ${moduleIconNames.length * 2} SVG icons and the preview sheet.`);
