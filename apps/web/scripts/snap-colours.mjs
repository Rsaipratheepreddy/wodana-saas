#!/usr/bin/env node
// Replaces raw neutral and status hex colours in component CSS with semantic tokens, by role:
// backgrounds -> surfaces, text -> text tones, borders -> border tones, status hues -> status
// tokens. Chromatic brand-like colours are left for module rebuilds. Themes (dark, tenant brand)
// then apply everywhere. Usage: node scripts/snap-colours.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { EXCLUDED } from "./snap-to-tokens.mjs";

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function oklch(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length === 8 && h.slice(6) !== "ff") return null; // translucent: leave
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function status(H) {
  if (H < 45 || H >= 345) return "danger";
  if (H < 100) return "warning";
  if (H < 170) return "success";
  if (H < 260) return "info";
  return null;
}

export function tokenFor(role, hex) {
  const c = oklch(hex.toLowerCase());
  if (!c) return null;
  const neutral = c.C < 0.035;
  if (role === "background") {
    const tint = c.C >= 0.01 && c.L >= 0.9 ? status(c.H) : null;
    if (tint && c.C < 0.08) return `--wd-color-${tint}-subtle`;
    if (neutral) {
      if (c.L >= 0.995) return "--wd-color-surface";
      if (c.L >= 0.975) return "--wd-color-surface-subtle";
      if (c.L >= 0.94) return "--wd-color-surface-muted";
      return null;
    }
    const tone = status(c.H);
    if (tone && c.L >= 0.9 && c.C < 0.08) return `--wd-color-${tone}-subtle`;
    return null;
  }
  if (role === "text") {
    if (neutral) {
      if (c.L >= 0.97) return "--wd-color-text-inverse";
      if (c.L < 0.36) return "--wd-color-text";
      if (c.L < 0.55) return "--wd-color-text-secondary";
      if (c.L < 0.7) return "--wd-color-text-tertiary";
      return null;
    }
    const tone = status(c.H);
    if (tone && c.L < 0.62 && c.C >= 0.05) return `--wd-color-${tone}`;
    return null;
  }
  if (role === "border") {
    if (!neutral) return null;
    if (c.L >= 0.9) return "--wd-color-structural-divider";
    if (c.L >= 0.8) return "--wd-color-border";
    if (c.L >= 0.7) return "--wd-color-border-strong";
    return null;
  }
  return null;
}

const ROLE = (prop) =>
  /^background(-color)?$/.test(prop) ? "background"
  : /^(color|fill|caret-color)$/.test(prop) ? "text"
  : /^(border(-[a-z]+)*|outline(-color)?|column-rule(-color)?|stroke)$/.test(prop) && !/radius|width|style/.test(prop) ? "border"
  : null;

export function snapColours(css) {
  return css.replace(/(^|[;{\s])([a-z-]+)(\s*:\s*)([^;{}]+)/g, (all, lead, prop, colon, value) => {
    const role = ROLE(prop);
    if (!role || prop.startsWith("--")) return all;
    const next = value.replace(/#[0-9a-fA-F]{3,8}\b/g, (hex, offset, whole) => {
      if (/var\([^)]*$/.test(whole.slice(0, offset))) return hex; // a var() fallback
      if (/gradient\(/.test(whole)) return hex;
      const token = tokenFor(role, hex);
      return token ? `var(${token})` : hex;
    });
    return `${lead}${prop}${colon}${next}`;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = execSync("git ls-files 'app/**/*.css' 'components/**/*.css' 'design-system/**/*.css'", { encoding: "utf8" })
    .split("\n").filter((f) => f && !EXCLUDED.test(f) && !/landing/.test(f));
  let changed = 0;
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const after = snapColours(before);
    if (after !== before) { changed += 1; writeFileSync(file, after); }
  }
  console.log(`${changed} file(s) updated`);
}
