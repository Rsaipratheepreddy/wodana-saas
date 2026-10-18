import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { parseAddressList, parseMessageIds, type EmailAddress } from "./email-content";

/** How old a signed webhook may be (Mailgun retries a failed delivery for up to 8 hours). */
export const DEFAULT_WEBHOOK_MAX_AGE_SECONDS = 8 * 60 * 60;
/** How far ahead of our clock a timestamp may be. */
const FUTURE_SKEW_SECONDS = 5 * 60;
/** The most attachments one email keeps; the rest are listed as not kept. */
export const MAX_EMAIL_ATTACHMENTS = 10;

const LOCAL_PART = /^[a-z0-9][a-z0-9-]{5,62}$/;
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * A workspace's inbound local part: a short prefix from its sign-in slug and ten random characters (about 50 bits),
 * so the address can't be guessed: `plm-7f3k2q9xma`.
 */
export function generateLocalPart(slug: string | null | undefined): string {
  const prefix = String(slug ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "inbox";
  const random = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${prefix}-${random}`;
}

/** The inbound domain from INBOUND_EMAIL_DOMAIN (a bare domain name), or null when inbound email is not set up. */
export function inboundDomain(value: string | null | undefined): string | null {
  const domain = String(value ?? "").trim().toLowerCase().replace(/^@/, "");
  return /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) ? domain : null;
}

/** The local parts of the recipients on our inbound domain (Mailgun's `recipient` may list several). */
export function inboundLocalParts(recipient: string | null | undefined, domain: string): string[] {
  return parseAddressList(recipient).flatMap(({ address }) => {
    const at = address.lastIndexOf("@");
    const local = address.slice(0, at).split("+")[0];
    return address.slice(at + 1) === domain && LOCAL_PART.test(local) ? [local] : [];
  });
}

export type SignatureCheck = "valid" | "invalid" | "stale";

/**
 * Mailgun's webhook signature: HMAC-SHA256 of timestamp + token with the webhook signing key, compared in
 * constant time; a timestamp outside the window is stale. (Replays inside the window are stopped by the token store.)
 */
export function verifyMailgunSignature(input: { timestamp?: unknown; token?: unknown; signature?: unknown }, signingKey: string, nowSeconds: number, maxAgeSeconds = DEFAULT_WEBHOOK_MAX_AGE_SECONDS): SignatureCheck {
  const timestamp = String(input.timestamp ?? ""), token = String(input.token ?? ""), signature = String(input.signature ?? "").toLowerCase();
  if (!signingKey || !/^\d{9,11}$/.test(timestamp) || !/^[A-Za-z0-9]{20,200}$/.test(token) || !/^[0-9a-f]{64}$/.test(signature)) return "invalid";
  const expected = createHmac("sha256", signingKey).update(timestamp + token).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return "invalid";
  const age = nowSeconds - Number(timestamp);
  return age > maxAgeSeconds || age < -FUTURE_SKEW_SECONDS ? "stale" : "valid";
}

export type InboundFile = { fileName: string; contentType: string; buffer: Buffer };

export type InboundEmail = {
  recipient: string;
  from: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  text: string;
  /** Mailgun's own cut of the new text (without quotes and signature), when it sent one. */
  strippedText: string | null;
  html: string | null;
  messageId: string | null;
  inReplyTo: string[];
  references: string[];
  date: Date | null;
  headers: Map<string, string>;
  attachments: InboundFile[];
  signature: { timestamp?: unknown; token?: unknown; signature?: unknown };
};

type UploadedFile = { fieldname?: string; originalname?: string; mimetype?: string; buffer?: Buffer };

const field = (body: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) {
    const value = body[name];
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return "";
};

/** Mailgun's `message-headers`: a JSON list of [name, value] pairs. The first value of each name wins. */
function headerMap(raw: unknown): Map<string, string> {
  const headers = new Map<string, string>();
  let pairs: unknown = raw;
  if (typeof raw === "string") { try { pairs = JSON.parse(raw); } catch { pairs = []; } }
  if (!Array.isArray(pairs)) return headers;
  for (const pair of pairs.slice(0, 500)) {
    if (!Array.isArray(pair) || typeof pair[0] !== "string" || typeof pair[1] !== "string") continue;
    const name = pair[0].toLowerCase();
    if (!headers.has(name)) headers.set(name, pair[1].slice(0, 20_000));
  }
  return headers;
}

/**
 * A Mailgun Route "forward" post (form fields, files as attachment-1…n) read into one email. The signature may come
 * as top-level fields (Routes) or as a `signature` object (event webhooks).
 */
export function readMailgunInbound(body: Record<string, unknown>, files: UploadedFile[] = []): InboundEmail {
  const headers = headerMap(body["message-headers"]);
  const header = (name: string, ...fields: string[]) => headers.get(name) ?? field(body, ...fields);
  const nested = body.signature && typeof body.signature === "object" && !Array.isArray(body.signature) ? body.signature as Record<string, unknown> : null;
  const from = parseAddressList(field(body, "from", "From") || headers.get("from"))[0] ?? parseAddressList(field(body, "sender"))[0] ?? null;
  const date = Date.parse(header("date", "Date"));
  return {
    recipient: field(body, "recipient"),
    from,
    to: parseAddressList(header("to", "To")).slice(0, 50),
    cc: parseAddressList(header("cc", "Cc")).slice(0, 50),
    subject: field(body, "subject", "Subject").replace(/[\r\n]+/g, " ").trim().slice(0, 900),
    text: field(body, "body-plain").slice(0, 100_000),
    strippedText: field(body, "stripped-text").trim() ? field(body, "stripped-text").slice(0, 100_000) : null,
    html: field(body, "body-html") || null,
    messageId: parseMessageIds(header("message-id", "Message-Id", "Message-ID"))[0] ?? null,
    inReplyTo: parseMessageIds(header("in-reply-to", "In-Reply-To")),
    references: parseMessageIds(header("references", "References")),
    date: Number.isFinite(date) ? new Date(date) : null,
    headers,
    attachments: files.filter((file) => /^attachment(-\d+)?$/.test(file.fieldname ?? "") && file.buffer?.length).map((file) => ({
      fileName: String(file.originalname ?? "attachment"), contentType: String(file.mimetype ?? "application/octet-stream"), buffer: file.buffer!,
    })),
    signature: nested ?? { timestamp: field(body, "timestamp"), token: field(body, "token"), signature: field(body, "signature") },
  };
}
