/**
 * Renders the browser-printed documents (main.tsx) to A4 PDFs with Chromium's print engine, as the browser's
 * "Save as PDF" does (page margins, page numbers, repeated table headers):
 *   node scripts/document-samples/render.mjs [folder]   (default: ./document-samples-out)
 */
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "../..");
const out = resolve(process.argv[2] ?? "document-samples-out");
mkdirSync(out, { recursive: true });

const stub = (name) => join(here, "stubs", name);
const server = await createServer({
  root: here, configFile: false, logLevel: "error",
  server: { port: 5199, strictPort: false, fs: { allow: [resolve(web, "../..")] } },
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${web}/$1` },
      { find: "next/image", replacement: stub("next-image.tsx") },
      { find: "next/link", replacement: stub("next-link.tsx") },
      { find: "next/navigation", replacement: stub("next-navigation.ts") },
    ],
  },
  esbuild: { jsx: "automatic" },
  define: { "process.env": "{}" },
});
await server.listen();
const base = server.resolvedUrls.local[0];

const samples = [
  ["order", "SM-PO-2026-00011 Nile Timber Trading LLC"],
  ["move", "Move 27 PRJ-0042 Villa 14 site"],
  ["materials", "Material list Villa 14 Aisha Rahman"],
  ["invoice", "SM-INV-2026-00031 Aisha Rahman"],
  ["invoice-ar", "SM-INV-2026-00031 Aisha Rahman (Arabic)"],
  ["receipt", "Receipt SM-INV-2026-00027 Aisha Rahman"],
];
const browser = await chromium.launch();
try {
  for (const [doc, name] of samples) {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.error(`${doc}: ${error.message}`));
    await page.goto(`${base}?doc=${doc}`, { waitUntil: "networkidle" });
    await page.waitForSelector("article", { timeout: 20000 });
    await page.waitForTimeout(400);
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: join(out, `${name}.pdf`), preferCSSPageSize: true, printBackground: true });
    console.log(`${name}.pdf`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
