import { referenceVideoType } from "../../../workspaces/reference-upload";

/** What a chat file is, as WhatsApp names its media types. Stickers only ever arrive. */
export type AttachmentKind = "image" | "document" | "audio" | "video" | "sticker";
export type SendableKind = Exclude<AttachmentKind, "sticker">;

const MB = 1024 * 1024;
/** The most Wodana keeps of one chat file, either way (WhatsApp allows documents up to 100 MB; we keep 20 MB). */
export const ATTACHMENT_MAX_BYTES = 20 * MB;

/**
 * WhatsApp Cloud API media rules for what we send: the types it accepts for each kind and its size limit
 * (capped at what we keep). Audio carries no caption.
 */
export const WHATSAPP_MEDIA: Record<SendableKind, { types: readonly string[]; maxBytes: number; caption: boolean }> = {
  image: { types: ["image/jpeg", "image/png"], maxBytes: 5 * MB, caption: true },
  video: { types: ["video/mp4", "video/3gpp"], maxBytes: 16 * MB, caption: true },
  audio: { types: ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"], maxBytes: 16 * MB, caption: false },
  document: {
    types: [
      "application/pdf", "text/plain", "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    maxBytes: ATTACHMENT_MAX_BYTES,
    caption: true,
  },
};

const OFFICE_BY_EXTENSION: Record<string, { ole: string; zip: string }> = {
  doc: { ole: "application/msword", zip: "" }, docx: { ole: "", zip: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  xls: { ole: "application/vnd.ms-excel", zip: "" }, xlsx: { ole: "", zip: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  ppt: { ole: "application/vnd.ms-powerpoint", zip: "" }, pptx: { ole: "", zip: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
};

/** A file name that is safe to store and show: no path, no control characters. */
export function safeFileName(name: string | null | undefined, fallback = "File") {
  const clean = String(name ?? "").split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 240);
  return clean || fallback;
}

const extensionOf = (name: string) => /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
const starts = (body: Buffer, bytes: number[]) => bytes.every((byte, index) => body[index] === byte);

/**
 * The media type of a file we are asked to send, read from its bytes (never the browser's claim or the name alone;
 * the name only tells Word from Excel inside the same container). Null when WhatsApp would not take it.
 */
export function sniffSendable(body: Buffer, fileName: string): { mimeType: string; kind: SendableKind } | null {
  if (body.length < 4) return null;
  const extension = extensionOf(fileName);
  if (starts(body, [0xff, 0xd8, 0xff])) return { mimeType: "image/jpeg", kind: "image" };
  if (starts(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mimeType: "image/png", kind: "image" };
  if (body.subarray(0, 5).toString("latin1") === "%PDF-") return { mimeType: "application/pdf", kind: "document" };
  if (starts(body, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const type = OFFICE_BY_EXTENSION[extension]?.ole;
    return type ? { mimeType: type, kind: "document" } : null;
  }
  if (starts(body, [0x50, 0x4b, 0x03, 0x04])) {
    const type = OFFICE_BY_EXTENSION[extension]?.zip;
    return type ? { mimeType: type, kind: "document" } : null;
  }
  if (body.subarray(0, 4).toString("latin1") === "OggS") return { mimeType: "audio/ogg", kind: "audio" };
  if (body.subarray(0, 6).toString("latin1") === "#!AMR\n") return { mimeType: "audio/amr", kind: "audio" };
  if (body.subarray(0, 3).toString("latin1") === "ID3") return { mimeType: "audio/mpeg", kind: "audio" };
  if (body[0] === 0xff && (body[1] & 0xf6) === 0xf0) return { mimeType: "audio/aac", kind: "audio" };
  if (body[0] === 0xff && (body[1] & 0xe0) === 0xe0 && (body[1] & 0x06) !== 0) return { mimeType: "audio/mpeg", kind: "audio" };
  if (body.length >= 12 && body.toString("latin1", 4, 8) === "ftyp") {
    const brand = body.toString("latin1", 8, 12);
    if (brand.startsWith("3gp") || brand.startsWith("3g2")) return { mimeType: "video/3gpp", kind: "video" };
    if (brand === "M4A " || brand === "M4B ") return { mimeType: "audio/mp4", kind: "audio" };
    if (referenceVideoType(body) === "video/mp4") return { mimeType: "video/mp4", kind: "video" };
    return null;
  }
  if (extension === "txt" && !body.includes(0) && isUtf8(body)) return { mimeType: "text/plain", kind: "document" };
  return null;
}

function isUtf8(body: Buffer) {
  try { new TextDecoder("utf-8", { fatal: true }).decode(body.subarray(0, Math.min(body.length, 256 * 1024))); return true; } catch { return false; }
}

/** Why WhatsApp would refuse this file, in words for the person; null when it can go. */
export function sendableProblem(kind: SendableKind, byteSize: number): string | null {
  const limit = WHATSAPP_MEDIA[kind].maxBytes;
  if (byteSize > limit) return `WhatsApp takes ${kind === "document" ? "files" : `${kind}s`} up to ${Math.round(limit / MB)} MB`;
  return null;
}

/** The kind a provider's media type is shown as (a WhatsApp inbound message says its own type). */
export function kindOf(messageType: unknown): AttachmentKind | null {
  return typeof messageType === "string" && ["image", "document", "audio", "video", "sticker"].includes(messageType) ? messageType as AttachmentKind : null;
}

/**
 * The type a stored file is served with. Only images, audio and video show inline; anything else downloads,
 * under a sandbox, so a file a client sent can never run in the workspace.
 */
export function servedAs(mimeType: string | null | undefined) {
  const type = (mimeType ?? "").toLowerCase().split(";")[0].trim();
  const safe = /^(image\/(jpeg|png|webp|gif)|audio\/(aac|amr|mpeg|mp4|ogg)|video\/(mp4|3gpp))$/.test(type);
  return { contentType: safe ? type : type && /^[a-z]+\/[a-z0-9.+-]+$/.test(type) ? type : "application/octet-stream", inline: safe };
}

/** Retry after a failed fetch of a client's file: 1, 5, 15, 60 minutes, then give up. */
export function fetchRetryDelayMinutes(attempts: number): number | null {
  return [1, 5, 15, 60][attempts - 1] ?? null;
}

/**
 * The media type of a file that came with a client's email, read from its bytes: what a chat can send, plus GIF
 * and WebP images and CSV text. Null for anything else (archives, programs, unknown formats), which isn't kept.
 */
export function sniffEmailAttachment(body: Buffer, fileName: string): { mimeType: string; kind: SendableKind } | null {
  const sendable = sniffSendable(body, fileName);
  if (sendable) return sendable;
  if (body.length >= 6 && ["GIF87a", "GIF89a"].includes(body.subarray(0, 6).toString("latin1"))) return { mimeType: "image/gif", kind: "image" };
  if (body.length >= 12 && body.toString("latin1", 0, 4) === "RIFF" && body.toString("latin1", 8, 12) === "WEBP") return { mimeType: "image/webp", kind: "image" };
  if (extensionOf(fileName) === "csv" && !body.includes(0) && isUtf8(body)) return { mimeType: "text/csv", kind: "document" };
  return null;
}
