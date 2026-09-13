import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const REFERENCE_MAX_BYTES = 20 * 1024 * 1024;
export type ReferenceUpload = { buffer: Buffer; originalname: string; mimetype: string; size: number };
export async function prepareReferenceUpload(file?: ReferenceUpload, options: { allowVideo?: boolean } = {}) {
  if (!file?.buffer?.length || file.buffer.length > REFERENCE_MAX_BYTES) throw new BadRequestException(`Choose an image, ${options.allowVideo ? 'MP4/WebM video or ' : ''}PDF up to 20 MB.`);
      const name = file.originalname.replace(/[\x00-\x1f\x7f/\\]/g,"_").slice(0,240) || "Reference";
      let mimeType: string;
      let preview: Buffer | undefined;
      const video = options.allowVideo ? referenceVideoType(file.buffer) : null;
      if (video) mimeType = video;
      else if (file.buffer.subarray(0,5).toString() === "%PDF-") mimeType = "application/pdf";
      else {
        const image = sharp(file.buffer,{ limitInputPixels: 40_000_000, animated: false });
        const meta = await image.metadata().catch(() => null);
        const mimes: Record<string,string> = { jpeg:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif",avif:"image/avif",heif:"image/heic" };
        if (!meta?.format || !mimes[meta.format] || !meta.width || !meta.height) throw new BadRequestException(options.allowVideo ? 'Choose a supported image, PDF, MP4 or WebM video.' : "This file is not a supported image or PDF. Try JPEG, PNG, WebP, GIF, AVIF or a supported HEIC image.");
        mimeType = mimes[meta.format];
        preview = await image.rotate().resize({ width:1400,height:1400,fit:"inside",withoutEnlargement:true }).webp({ quality:82 }).toBuffer().catch(() => { throw new BadRequestException("This image could not be processed. Export it as JPEG or PNG and retry."); });
      }
  return { name, mimeType, preview, digest: createHash('sha256').update(file.buffer).digest('hex'), body: file.buffer };
}

/** Inspect the container, never trust a filename or browser-supplied MIME type. */
export function referenceVideoType(body: Buffer): string | null {
  if (body.length < 32) return null;
  if (body.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && body.subarray(4, 512).includes(Buffer.from('webm'))) return 'video/webm';
  if (body.toString('ascii', 4, 8) !== 'ftyp') return null;
  const ftypEnd = body.readUInt32BE(0);
  if (ftypEnd < 16 || ftypEnd > Math.min(body.length, 4096)) return null;
  const brands = [body.toString('ascii', 8, 12)];
  for (let i = 16; i + 4 <= ftypEnd; i += 4) brands.push(body.toString('ascii', i, i + 4));
  if (!brands.some(brand => /^(isom|iso[2-9]|mp4[12]|avc1|M4V )$/.test(brand))) return null;
  const hasVideo = (start: number, end: number, depth = 0): boolean => {
    if (depth > 4) return false;
    for (let pos = start; pos + 8 <= end;) {
      let size = body.readUInt32BE(pos), header = 8;
      if (size === 1) { if (pos + 16 > end) return false; const extended = body.readBigUInt64BE(pos + 8); if (extended > BigInt(body.length)) return false; size = Number(extended); header = 16; }
      if (size === 0) size = end - pos;
      if (size < header || pos + size > end) return false;
      const type = body.toString('ascii', pos + 4, pos + 8);
      if (type === 'hdlr' && size >= header + 12 && body.toString('ascii', pos + header + 8, pos + header + 12) === 'vide') return true;
      if (['moov', 'trak', 'mdia'].includes(type) && hasVideo(pos + header, pos + size, depth + 1)) return true;
      pos += size;
    }
    return false;
  };
  return hasVideo(ftypEnd, body.length) ? 'video/mp4' : null;
}
