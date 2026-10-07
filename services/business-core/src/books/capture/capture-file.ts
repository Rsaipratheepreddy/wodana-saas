import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

/** A bill photo or PDF up to 6 MB. */
export const CAPTURE_MAX_BYTES = 6 * 1024 * 1024;
/** The pages of a PDF the AI reads: a bill's header, lines and totals fit in the first few. */
export const CAPTURE_PDF_PAGES = 3;
const LONG_EDGE = 2400;

export type CaptureUpload = { buffer: Buffer; originalname: string; mimetype: string; size: number };
export type PreparedCapture = {
  name: string;
  /** What is stored and shown beside the draft: the PDF as sent, a photo upright as JPEG. */
  stored: { body: Buffer; mimeType: string };
  /** What the AI reads: the first pages of a PDF, the photo as stored. */
  readable: { body: Buffer; mimeType: string };
  /** Of the file as sent, so the same file is captured once. */
  sha256: string;
  byteSize: number;
};

const HEIC_BRANDS = /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/;

/** HEIC/HEIF from a phone camera, by its container brand (never the file name or browser type). */
export function isHeic(body: Buffer) {
  return body.length >= 12 && body.toString("ascii", 4, 8) === "ftyp" && HEIC_BRANDS.test(body.toString("ascii", 8, 12));
}

/**
 * Checks and normalises a captured bill: a PDF is kept as sent and its first pages are what the AI reads; a photo
 * (JPEG, PNG, WebP, HEIC) is turned upright, scaled to a readable size and kept as JPEG. A HEIC this server
 * cannot decode is kept as it is: the AI reads HEIC itself. Anything else is refused.
 */
export async function prepareCapture(file?: CaptureUpload): Promise<PreparedCapture> {
  if (!file?.buffer?.length) throw new BadRequestException("Choose a photo or PDF of the bill.");
  if (file.buffer.length > CAPTURE_MAX_BYTES) throw new BadRequestException("Choose a photo or PDF up to 6 MB.");
  const name = (file.originalname ?? "").replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 240) || "Bill";
  const sha256 = createHash("sha256").update(file.buffer).digest("hex");
  const byteSize = file.buffer.length;
  if (file.buffer.subarray(0, 5).toString() === "%PDF-") {
    const stored = { body: file.buffer, mimeType: "application/pdf" };
    return { name, stored, readable: { body: await firstPages(file.buffer), mimeType: "application/pdf" }, sha256, byteSize };
  }
  const image = sharp(file.buffer, { limitInputPixels: 60_000_000, animated: false });
  const meta = await image.metadata().catch(() => null);
  if (!meta?.format || !["jpeg", "png", "webp", "heif"].includes(meta.format) || !meta.width || !meta.height) {
    if (isHeic(file.buffer)) {
      const kept = { body: file.buffer, mimeType: "image/heic" };
      return { name, stored: kept, readable: kept, sha256, byteSize };
    }
    throw new BadRequestException("Choose a JPEG, PNG or HEIC photo, or a PDF.");
  }
  const body = await image.rotate().resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer()
    .catch(() => { throw new BadRequestException("This photo could not be processed. Take it again or export it as JPEG."); });
  const stored = { body, mimeType: "image/jpeg" };
  return { name, stored, readable: stored, sha256, byteSize };
}

/** The first pages of a PDF as their own PDF; a PDF that can't be split (encrypted, damaged) is read whole. */
async function firstPages(body: Buffer) {
  try {
    const source = await PDFDocument.load(body, { ignoreEncryption: false, updateMetadata: false });
    if (source.getPageCount() <= CAPTURE_PDF_PAGES) return body;
    const target = await PDFDocument.create();
    const pages = await target.copyPages(source, Array.from({ length: CAPTURE_PDF_PAGES }, (_, index) => index));
    for (const page of pages) target.addPage(page);
    return Buffer.from(await target.save());
  } catch {
    return body;
  }
}
