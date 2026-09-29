#!/usr/bin/env node
/**
 * Pre-generates the landing page's responsive screenshots, so the public site never uses the runtime image optimizer.
 *
 * Reads public/landing/*.webp (desktop captures 2880 wide, phone captures `app-*` 1170 wide, each with an optional
 * `-dark` twin) and writes public/landing/opt/<name>-<width>.<hash>.avif and .webp, plus the manifest the page reads
 * (components/landing/landing-images.json). The short content hash in each file name lets the files be cached for a
 * year as immutable. Re-run after changing a capture: `npm run landing:images --workspace @wodana/web`.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const web = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = join(web, "public", "landing");
const OUT = join(SOURCE, "opt");
const MANIFEST = join(web, "components", "landing", "landing-images.json");

const DESKTOP_WIDTHS = [720, 1080, 1440];
const PHONE_WIDTHS = [360, 540, 720];
const AVIF = { quality: 50, effort: 6, chromaSubsampling: "4:4:4" };
const WEBP = { quality: 72, effort: 6, smartSubsample: true };

const hash = (buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 8);

async function variant(input, name, width, format) {
  const pipeline = sharp(input).resize({ width, withoutEnlargement: true });
  const buffer = await (format === "avif" ? pipeline.avif(AVIF) : pipeline.webp(WEBP)).toBuffer();
  const file = `${name}-${width}.${hash(buffer)}.${format}`;
  await writeFile(join(OUT, file), buffer);
  return { path: `/landing/opt/${file}`, bytes: buffer.length };
}

const files = (await readdir(SOURCE)).filter((file) => file.endsWith(".webp")).sort();
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const manifest = {};
const report = [];
for (const file of files) {
  const name = basename(file, ".webp");
  const base = name.replace(/-dark$/, "");
  const theme = name.endsWith("-dark") ? "dark" : "light";
  const input = join(SOURCE, file);
  const { width, height } = await sharp(input).metadata();
  const widths = name.startsWith("app-") ? PHONE_WIDTHS : DESKTOP_WIDTHS;
  const variants = [];
  for (const w of widths) {
    const avif = await variant(input, name, w, "avif");
    const webp = await variant(input, name, w, "webp");
    variants.push({ w, avif: avif.path, webp: webp.path });
    report.push(`${name}-${w}: avif ${(avif.bytes / 1024).toFixed(1)} KB, webp ${(webp.bytes / 1024).toFixed(1)} KB`);
  }
  manifest[base] ??= { width, height };
  manifest[base][theme] = variants;
}

// Only shots with a light capture are shown; a dark capture alone is ignored.
for (const [name, entry] of Object.entries(manifest)) if (!entry.light) delete manifest[name];
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(report.join("\n"));
console.log(`\n${Object.keys(manifest).length} screenshots → ${OUT}`);
