import { rgb, type PDFDocument, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import type { PoolClient } from "pg";
import { letterheadImageKey, letterheadLines, readLetterhead } from "../workspaces/entity-letterhead";
import type { PdfText } from "./pdf-text";
import { readBytes, type ObjectStore } from "./proposal-files";

type Db = Pick<PoolClient, "query">;

/**
 * The issuing business's letterhead as a server-made PDF draws it (PLM-112): a header image across the top
 * (else its logo), its legal name and the licence, tax number, address and contact lines, and its footer text
 * at the foot of every page. Without one, documents keep the workspace brand.
 */
export type PdfLetterhead = { name: string; lines: string[]; footer: string | null; header: Uint8Array | null; logo: Uint8Array | null };

const MUTED = rgb(0.42, 0.44, 0.48);

export async function pdfLetterhead(db: Db, store: ObjectStore, workspaceId: string, entityId: string | null | undefined): Promise<PdfLetterhead | null> {
  const letterhead = await readLetterhead(db, workspaceId, entityId);
  if (!letterhead) return null;
  const bytes = async (assetId: string | null) => {
    const key = await letterheadImageKey(db, workspaceId, assetId);
    // A missing image file prints the document without it rather than failing it.
    return key ? readBytes(store, key).catch(() => null) : null;
  };
  return {
    name: letterhead.legalName, lines: letterheadLines(letterhead, { licence: "Licence", tax: "Tax no." }), footer: letterhead.footer,
    header: await bytes(letterhead.headerAssetId), logo: letterhead.headerAssetId ? null : await bytes(letterhead.logoAssetId),
  };
}

const embedded = new WeakMap<PDFDocument, Map<Uint8Array, PDFImage>>();
async function image(document: PDFDocument, bytes: Uint8Array) {
  let images = embedded.get(document);
  if (!images) { images = new Map(); embedded.set(document, images); }
  if (!images.has(bytes)) images.set(bytes, await document.embedPng(bytes));
  return images.get(bytes)!;
}

/**
 * Draws the letterhead's top from `y` down within [x, x + width] and returns the baseline below it: the header
 * image (which carries the business's own name and details), or the logo, name and detail lines.
 */
export async function drawLetterheadTop(document: PDFDocument, page: PDFPage, t: PdfText, letterhead: PdfLetterhead, box: { x: number; y: number; width: number; accent: RGB }) {
  let y = box.y;
  if (letterhead.header) {
    const header = await image(document, letterhead.header);
    const scale = Math.min(box.width / header.width, 90 / header.height);
    const height = header.height * scale;
    page.drawImage(header, { x: box.x, y: y - height + 10, width: header.width * scale, height });
    return y - height - 6;
  }
  if (letterhead.logo) {
    const logo = await image(document, letterhead.logo);
    const scale = Math.min(140 / logo.width, 48 / logo.height);
    const height = logo.height * scale;
    page.drawImage(logo, { x: box.x, y: y - height + 10, width: logo.width * scale, height });
    y -= height + 6;
  }
  t.draw(page, letterhead.name, { x: box.x, y, size: 13, weight: "bold", color: box.accent, width: box.width });
  y -= 14;
  for (const line of letterhead.lines) y = t.paragraph(page, line, { x: box.x, y, width: box.width, size: 8, color: MUTED, lineHeight: 11, hug: true });
  return y - 4;
}

/** The letterhead's footer text at the foot of a page. */
export function drawLetterheadFooter(page: PDFPage, t: PdfText, letterhead: PdfLetterhead | null, box: { x: number; width: number }) {
  if (!letterhead?.footer) return;
  const lines = t.lines(letterhead.footer, 7, box.width).slice(0, 3);
  lines.forEach((line, index) => t.draw(page, line, { x: box.x, y: 16 + (lines.length - 1 - index) * 9, width: box.width, color: MUTED }));
}
