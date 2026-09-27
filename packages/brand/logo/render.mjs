// Renders the logo PNGs from wodana-mark.svg and the product font (Plus Jakarta Sans 800).
// Needs Google Chrome for the wordmark; run it after changing the mark, then `node packages/brand/sync.mjs`.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = fileURLToPath(new URL("./", import.meta.url));
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const mark = await readFile(join(here, "wodana-mark.svg"), "utf8");
const inner = mark.replace(/^<svg[^>]*>|<\/svg>\s*$/g, "");

// The lockup: mark height H, wordmark 0.87H, gap 0.164H, baseline a little above the mark's foot.
async function lockup(ink, file) {
  const dir = await mkdtemp(join(tmpdir(), "wodana-logo-"));
  const html = `<!doctype html><html><head><style>
@font-face{font-family:J;src:url("file://${join(here, "plus-jakarta-sans-latin.woff2")}") format("woff2");font-weight:200 800}
html,body{margin:0;background:transparent}
.l{display:inline-flex;align-items:flex-end;gap:80px;padding:0;font:800 424px/1 J;color:${ink};letter-spacing:-0.035em}
.l svg{height:488px;flex:none}.l span{transform:translateY(-28px)}
</style></head><body><div class="l"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 244">${inner}</svg><span>wodana</span></div></body></html>`;
  await writeFile(join(dir, "l.html"), html);
  const shot = join(dir, "l.png");
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--default-background-color=00000000",
    "--window-size=2400,560", "--virtual-time-budget=3000", `--screenshot=${shot}`, `file://${join(dir, "l.html")}`], { stdio: "ignore" });
  await sharp(shot).trim({ threshold: 1 }).resize({ height: 240 }).png({ compressionLevel: 9 }).toFile(join(here, file));
  await rm(dir, { recursive: true, force: true });
}

async function icon(file, markShare, background) {
  const size = 1024;
  const inside = Math.round(size * markShare);
  const png = await sharp(Buffer.from(mark), { density: 600 }).resize({ width: inside, height: inside, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: png, gravity: "center" }]).png({ compressionLevel: 9 }).toFile(join(here, file));
}

await lockup("#252525", "wodana-logo.png");
await lockup("#ffffff", "wodana-logo-dark.png");
// iOS icons can't be transparent; Android's adaptive foreground must keep the mark inside the 66% safe zone.
await icon("wodana-icon.png", 0.7, { r: 255, g: 255, b: 255, alpha: 1 });
await icon("wodana-adaptive-icon.png", 0.56, { r: 0, g: 0, b: 0, alpha: 0 });
console.log("Rendered the Wodana logo PNGs.");
