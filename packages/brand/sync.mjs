// Copies the logo and the brand characters (role avatars and Woddy) from this package into the apps.
// Web serves them from public/brand/…; mobile bundles them from assets/brand/…. Commit the copies.
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = new URL("./", import.meta.url);
const targets = [new URL("../../apps/web/public/brand/", import.meta.url), new URL("../../apps/mobile/assets/brand/", import.meta.url)];

export const BRAND_FOLDERS = ["logo", "avatars", "woddy"];

/** The files a folder ships to the apps (the logo's render script and font stay here). */
export async function brandFiles(folder) {
  return (await readdir(new URL(`${folder}/`, here))).filter((name) => /\.(webp|png|svg)$/.test(name)).sort();
}

export async function syncBrand() {
  for (const folder of BRAND_FOLDERS) {
    const files = await brandFiles(folder);
    for (const target of targets) {
      const out = new URL(`${folder}/`, target);
      await rm(out, { recursive: true, force: true });
      await mkdir(out, { recursive: true });
      for (const name of files) await copyFile(new URL(`${folder}/${name}`, here), new URL(name, out));
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await syncBrand();
  console.log("Synced the logo, role avatars and Woddy to apps/web/public/brand and apps/mobile/assets/brand.");
}
