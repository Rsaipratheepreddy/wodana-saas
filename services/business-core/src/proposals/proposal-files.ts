import { BadRequestException } from "@nestjs/common";
import type { Readable } from "node:stream";

export type UploadedFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };
/** What the proposal module needs from storage (the workspace's object store, or a fake in tests). */
export type ObjectStore = {
  put(objectKey: string, body: Buffer, contentType: string): Promise<void>;
  read(objectKey: string): Promise<{ body: Buffer | Readable | ReadableStream | Blob }>;
};

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** The file's real type from its first bytes, never from its name or the browser's claim. */
export function sniff(buffer: Buffer): "application/pdf" | "image/png" | "image/jpeg" | null {
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  return null;
}

/** A PDF (or, where pictures are allowed, a PNG or JPEG) of at most 20 MB, with a printable name. */
export function acceptFile(file: UploadedFile | undefined, allowImages: boolean) {
  if (!file?.buffer?.length) throw new BadRequestException("Choose a file.");
  if (file.buffer.length > MAX_FILE_BYTES) throw new BadRequestException("The file is larger than 20 MB.");
  const type = sniff(file.buffer);
  if (!type || (!allowImages && type !== "application/pdf")) throw new BadRequestException(allowImages ? "Upload a PDF, PNG or JPEG." : "Upload a PDF.");
  const name = (file.originalname || "document").normalize("NFC").replace(/[\\/\0-\x1f]/g, "_").slice(0, 200) || "document";
  return { buffer: file.buffer, mimeType: type, name };
}

export async function readBytes(store: ObjectStore, objectKey: string): Promise<Buffer> {
  const { body } = await store.read(objectKey);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof (body as Blob).arrayBuffer === "function") return Buffer.from(await (body as Blob).arrayBuffer());
  const chunks: Buffer[] = [];
  for await (const chunk of body as Readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}
