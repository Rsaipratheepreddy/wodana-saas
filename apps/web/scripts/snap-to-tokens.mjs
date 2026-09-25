#!/usr/bin/env node
// Snaps raw spacing, font sizes and radii in component CSS to the design tokens.
// Component internals use the 4px grid; exact golden-ratio values keep their φ tokens.
// Ties snap down (denser, calmer UI). Usage: node scripts/snap-to-tokens.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

export const EXCLUDED = /(tokens\.css|quotation-document|quotation-canvas|quotation-page-designer|print)/;
const SPACE = [[2, "space-0-5"], [4, "space-1"], [6, "space-1-5"], [8, "space-2"], [12, "space-3"], [16, "space-4"], [20, "space-5"], [24, "space-6"], [32, "space-8"], [40, "space-10"], [48, "space-12"], [64, "space-16"], [80, "space-20"], [96, "space-24"]];
const PHI = { 13: "phi-2", 21: "phi-3", 34: "phi-4", 55: "phi-5", 89: "phi-6" };
const TEXT = [[11, "text-2xs"], [12, "text-xs"], [13, "text-sm"], [14, "text-md"], [16, "text-lg"], [20, "text-xl"], [24, "text-2xl"], [30, "text-3xl"], [40, "text-4xl"]];
const RADIUS = [[4, "radius-2xs"], [6, "radius-xs"], [8, "radius-sm"], [12, "radius-md"], [16, "radius-lg"]];

const nearest = (scale, px) => scale.reduce((best, entry) => Math.abs(entry[0] - px) < Math.abs(best[0] - px) ? entry : best)[1];
const toPx = (n, unit) => unit === "rem" ? n * 16 : n;

function snap(kind, part) {
  const m = /^(-?)(\d*\.?\d+)(px|rem)$/.exec(part);
  if (!m) return part;
  const px = toPx(Number(m[2]), m[3]);
  if (px === 0) return part;
  let token = null;
  if (kind === "space") {
    if (px <= 1 || px > 96) return part;
    token = PHI[Math.round(px * 100) / 100] ?? nearest(SPACE, px);
  } else if (kind === "text") {
    if (px > 48) return part;
    token = px < 11 ? "text-2xs" : nearest(TEXT, px);
  } else {
    if (px > 20) return part;
    token = px <= 4 ? "radius-2xs" : nearest(RADIUS, px);
  }
  return m[1] ? `calc(var(--wd-${token}) * -1)` : `var(--wd-${token})`;
}

const PROPS = /(^|[;{\s])((?:row-|column-)?gap|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|font-size|border(?:-[a-z]+)*-radius)(\s*:\s*)([^;{}]+)/g;
const kindOf = (prop) => prop === "font-size" ? "text" : prop.endsWith("radius") ? "radius" : "space";

export function snapCss(css) {
  return css.replace(PROPS, (all, lead, prop, colon, value) => {
    if (/var\(|calc\(|clamp\(|min\(|max\(/.test(value) && !/\d(px|rem)/.test(value.replace(/(var|calc|clamp|min|max)\([^)]*\)/g, ""))) return all;
    const snapped = value.replace(/-?\d*\.?\d+(px|rem)\b/g, (part, _u, offset, whole) => {
      const before = whole.slice(0, offset);
      if ((before.match(/\(/g)?.length ?? 0) > (before.match(/\)/g)?.length ?? 0)) return part; // inside a function
      return snap(kindOf(prop), part);
    });
    return `${lead}${prop}${colon}${snapped}`;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  const files = execSync("git ls-files 'app/**/*.css' 'components/**/*.css' 'design-system/**/*.css'", { encoding: "utf8" }).split("\n").filter((f) => f && !EXCLUDED.test(f));
  let changed = 0;
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const after = snapCss(before);
    if (after !== before) { changed += 1; if (!check) writeFileSync(file, after); }
  }
  console.log(`${changed} file(s) ${check ? "need snapping" : "snapped"}`);
  if (check && changed) process.exit(1);
}
