/**
 * Writes the sample server-made PDFs (src/documents/document-samples.ts) to a folder for review by eye:
 *   npx tsx scripts/render-document-samples.ts [folder]   (default: ./document-samples)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderSampleDocuments } from "../src/documents/document-samples";

async function main() {
  const folder = resolve(process.argv[2] ?? "document-samples");
  mkdirSync(folder, { recursive: true });
  for (const sample of await renderSampleDocuments()) {
    writeFileSync(join(folder, `${sample.name}.pdf`), sample.bytes);
    console.log(`${sample.name}.pdf`);
  }
}

void main().catch((error) => { console.error(error); process.exit(1); });
