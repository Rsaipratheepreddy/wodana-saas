#!/usr/bin/env node
// Load a firm's proposal kit (words, contact block, pictures) into its workspace during onboarding.
// Usage: MIGRATION_DATABASE_URL=postgresql://… node scripts/import-proposal-kit.mjs <workspace-slug> <kit.json>
// The kit file uses the same fields as Settings → Quotations → Proposal; missing fields are left empty.
import { readFileSync } from "node:fs";
import pg from "pg";

const [slug, file] = process.argv.slice(2);
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!slug || !file || !url) {
  console.error("Usage: MIGRATION_DATABASE_URL=… node scripts/import-proposal-kit.mjs <workspace-slug> <kit.json>");
  process.exit(2);
}
const kit = JSON.parse(readFileSync(file, "utf8"));
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const picture = (value, label) => {
  if (!value) return null;
  if (!IMAGE.test(value)) throw new Error(`${label} must be a PNG, JPEG or WebP data URI.`);
  if (value.length > 400_000) throw new Error(`${label} is over 300 KB; shrink it first.`);
  return value;
};
const words = (value, max) => String(value ?? "").trim().slice(0, max);
const termsImages = (kit.termsImages ?? []).slice(0, 3).map((image, index) => picture(image, `Terms picture ${index + 1}`)).filter(Boolean);
const row = {
  introduction: words(kit.introduction, 2000), letterNote: words(kit.letterNote, 1000), defaultTerms: words(kit.defaultTerms, 20000),
  defaultExclusions: words(kit.defaultExclusions, 8000), contactDetails: words(kit.contactDetails, 1000), website: words(kit.website, 200),
  introductionImage: picture(kit.introductionImage, "Introduction picture"), closingImage: picture(kit.closingImage, "Closing picture"),
  monogramImage: picture(kit.monogramImage, "Monogram"), termsImages,
};
const total = [row.introductionImage, row.closingImage, row.monogramImage, ...termsImages].reduce((sum, image) => sum + (image?.length ?? 0), 0);
if (total > 1_300_000) throw new Error("The pictures together are over about 1 MB; shrink them first.");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  const workspace = (await client.query("SELECT id FROM workspaces WHERE slug = $1", [slug])).rows[0];
  if (!workspace) throw new Error(`No workspace with slug "${slug}".`);
  // Forced RLS: run as the tenant.
  await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspace.id]);
  await client.query(
    `INSERT INTO workspace_proposal_kits (workspace_id, introduction, letter_note, default_terms, default_exclusions, contact_details, website,
       introduction_image, closing_image, monogram_image, terms_images, version, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, now())
     ON CONFLICT (workspace_id) DO UPDATE SET introduction = excluded.introduction, letter_note = excluded.letter_note,
       default_terms = excluded.default_terms, default_exclusions = excluded.default_exclusions, contact_details = excluded.contact_details,
       website = excluded.website, introduction_image = excluded.introduction_image, closing_image = excluded.closing_image,
       monogram_image = excluded.monogram_image, terms_images = excluded.terms_images,
       version = workspace_proposal_kits.version + 1, updated_at = now()`,
    [workspace.id, row.introduction, row.letterNote, row.defaultTerms, row.defaultExclusions, row.contactDetails, row.website,
      row.introductionImage, row.closingImage, row.monogramImage, row.termsImages]);
  await client.query("COMMIT");
  console.log(`Proposal kit loaded for ${slug} (${termsImages.length} terms pictures, ${Math.round(total / 1024)} KB of pictures).`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
