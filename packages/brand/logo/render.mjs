// Renders the logo PNGs (mobile splash, app icons) from the SVG masters in this folder.
// Run it after changing an SVG, then `node packages/brand/sync.mjs`.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = fileURLToPath(new URL("./", import.meta.url));
const svg = (name) => readFile(join(here, name));

async function lockup(source, file) {
  await sharp(await svg(source), { density: 300 }).resize({ height: 240 }).png({ compressionLevel: 9 }).toFile(join(here, file));
}

async function icon(file, markShare, background) {
  const size = 1024;
  const inside = Math.round(size * markShare);
  const mark = await sharp(await svg("wodana-mark.svg"), { density: 600 })
    .resize({ width: inside, height: inside, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: "center" }]).png({ compressionLevel: 9 }).toFile(join(here, file));
}

await lockup("wodana-logo.svg", "wodana-logo.png");
await lockup("wodana-logo-dark.svg", "wodana-logo-dark.png");
// iOS icons can't be transparent; Android's adaptive foreground must keep the mark inside the 66% safe zone.
await icon("wodana-icon.png", 0.7, { r: 255, g: 255, b: 255, alpha: 1 });
await icon("wodana-adaptive-icon.png", 0.56, { r: 0, g: 0, b: 0, alpha: 0 });
console.log("Rendered the Wodana logo PNGs.");
