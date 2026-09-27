import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ProposalKit } from "../commercial/commercial.types";

export type { ProposalKit };

export const EMPTY_PROPOSAL_KIT: ProposalKit = {
  introduction: "", letterNote: "", defaultTerms: "", defaultExclusions: "", contactDetails: "", website: "",
  introductionImage: null, closingImage: null, monogramImage: null, termsImages: [], version: 0,
};

const LIMITS = { introduction: 2000, letterNote: 1000, defaultTerms: 20000, defaultExclusions: 8000, contactDetails: 1000, website: 200 } as const;
/**
 * Pictures are embedded in each issued proposal (the client portal shows the exact snapshot), and a
 * proposal is saved as one request, so each picture stays near 300 KB and the kit near 1 MB. The
 * settings screen shrinks uploads to fit before sending.
 */
const MAX_IMAGE_CHARS = 400_000;
const MAX_KIT_IMAGE_CHARS = 1_300_000;
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const WEBSITE = /^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/[^\s<>"']*)?$/i;

export async function readProposalKit(db: Pick<PoolClient, "query">, workspaceId: string): Promise<ProposalKit> {
  const row = (await db.query<ProposalKit>(
    `SELECT introduction, letter_note AS "letterNote", default_terms AS "defaultTerms", default_exclusions AS "defaultExclusions",
            contact_details AS "contactDetails", website, introduction_image AS "introductionImage", closing_image AS "closingImage",
            monogram_image AS "monogramImage", terms_images AS "termsImages", version
     FROM workspace_proposal_kits WHERE workspace_id = $1`, [workspaceId])).rows[0];
  return row ? { ...row, termsImages: row.termsImages ?? [] } : { ...EMPTY_PROPOSAL_KIT };
}

function words(value: unknown, label: string, max: number): string {
  if (value === null) return "";
  if (typeof value !== "string") throw new BadRequestException(`${label} must be text.`);
  const trimmed = value.replace(/\r\n/g, "\n").trim();
  if (trimmed.length > max) throw new BadRequestException(`${label} is too long (${max} characters at most).`);
  return trimmed;
}

function picture(value: unknown, label: string): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !IMAGE.test(value)) throw new BadRequestException(`${label} must be a PNG, JPEG or WebP picture.`);
  if (value.length > MAX_IMAGE_CHARS) throw new BadRequestException(`${label} is too large. Use a picture under 300 KB.`);
  return value;
}

/** Applies a partial change to the current kit; unknown keys are ignored, every value is validated. */
export function changeProposalKit(current: ProposalKit, input: Record<string, unknown>): ProposalKit {
  const next = { ...current, termsImages: [...current.termsImages] };
  if (input.introduction !== undefined) next.introduction = words(input.introduction, "Introduction", LIMITS.introduction);
  if (input.letterNote !== undefined) next.letterNote = words(input.letterNote, "Letter note", LIMITS.letterNote);
  if (input.defaultTerms !== undefined) next.defaultTerms = words(input.defaultTerms, "Terms and conditions", LIMITS.defaultTerms);
  if (input.defaultExclusions !== undefined) next.defaultExclusions = words(input.defaultExclusions, "Exclusions", LIMITS.defaultExclusions);
  if (input.contactDetails !== undefined) next.contactDetails = words(input.contactDetails, "Contact details", LIMITS.contactDetails);
  if (input.website !== undefined) {
    const website = words(input.website, "Website", LIMITS.website);
    if (website && !WEBSITE.test(website)) throw new BadRequestException("Enter a website like example.com.");
    next.website = website;
  }
  if (input.introductionImage !== undefined) next.introductionImage = picture(input.introductionImage, "Introduction picture");
  if (input.closingImage !== undefined) next.closingImage = picture(input.closingImage, "Closing picture");
  if (input.monogramImage !== undefined) next.monogramImage = picture(input.monogramImage, "Monogram");
  if (input.termsImages !== undefined) {
    if (!Array.isArray(input.termsImages) || input.termsImages.length > 3) throw new BadRequestException("Add up to three terms pictures.");
    next.termsImages = input.termsImages.map((image, index) => picture(image, `Terms picture ${index + 1}`)).filter((image): image is string => Boolean(image));
  }
  const total = [next.introductionImage, next.closingImage, next.monogramImage, ...next.termsImages].reduce((sum, image) => sum + (image?.length ?? 0), 0);
  if (total > MAX_KIT_IMAGE_CHARS) throw new BadRequestException("The pictures together are too large. Use smaller pictures or remove one.");
  return next;
}

/** What the audit log keeps: the words, and only the size of each picture. */
export function auditableKit(kit: ProposalKit) {
  const size = (image: string | null) => (image ? image.length : 0);
  return {
    ...kit, introductionImage: size(kit.introductionImage), closingImage: size(kit.closingImage),
    monogramImage: size(kit.monogramImage), termsImages: kit.termsImages.map(size),
  };
}

export async function writeProposalKit(db: Pick<PoolClient, "query">, workspaceId: string, kit: ProposalKit, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO workspace_proposal_kits (workspace_id, introduction, letter_note, default_terms, default_exclusions, contact_details, website,
       introduction_image, closing_image, monogram_image, terms_images, version, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12, now())
     ON CONFLICT (workspace_id) DO UPDATE SET introduction = excluded.introduction, letter_note = excluded.letter_note,
       default_terms = excluded.default_terms, default_exclusions = excluded.default_exclusions, contact_details = excluded.contact_details,
       website = excluded.website, introduction_image = excluded.introduction_image, closing_image = excluded.closing_image,
       monogram_image = excluded.monogram_image, terms_images = excluded.terms_images,
       version = workspace_proposal_kits.version + 1, updated_by = excluded.updated_by, updated_at = now()`,
    [workspaceId, kit.introduction, kit.letterNote, kit.defaultTerms, kit.defaultExclusions, kit.contactDetails, kit.website,
      kit.introductionImage, kit.closingImage, kit.monogramImage, kit.termsImages, userId]);
}
