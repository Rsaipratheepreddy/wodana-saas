import { BadRequestException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";

/** A signing link's secret: 32 random bytes, URL-safe. Only its SHA-256 is stored. */
export function newSigningToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: signingTokenHash(token) };
}

export const signingTokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export const SIGNING_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type LinkState = "open" | "signed" | "revoked" | "expired";

/** What a link can still do: an open link signs once; a signed one shows its signed copy; others are closed. */
export function linkState(request: { status: "pending" | "signed" | "revoked"; expiresAt: Date | string }, now = new Date()): LinkState {
  if (request.status === "signed") return "signed";
  if (request.status === "revoked") return "revoked";
  return new Date(request.expiresAt).getTime() <= now.getTime() ? "expired" : "open";
}

export type SignatureInput = { kind: "typed"; text: string } | { kind: "drawn"; png: Buffer };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A drawn signature is a small PNG from the signing pad. */
const MAX_DRAWN_BYTES = 200_000;

/** Validates the signature the signer gave: a typed name, or a drawn PNG (data URL or base64). */
export function signatureInput(value: unknown): SignatureInput {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (raw.kind === "typed") {
    const text = typeof raw.text === "string" ? raw.text.trim().replace(/\s+/g, " ") : "";
    if (text.length < 2 || text.length > 160) throw new BadRequestException("Type your full name to sign.");
    return { kind: "typed", text };
  }
  if (raw.kind === "drawn") {
    const data = typeof raw.png === "string" ? raw.png.replace(/^data:image\/png;base64,/, "") : "";
    if (!data || data.length > MAX_DRAWN_BYTES * 1.4 || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new BadRequestException("Draw your signature again.");
    const png = Buffer.from(data, "base64");
    if (png.length < 100 || png.length > MAX_DRAWN_BYTES || !png.subarray(0, 8).equals(PNG)) throw new BadRequestException("Draw your signature again.");
    return { kind: "drawn", png };
  }
  throw new BadRequestException("Type or draw your signature.");
}

/** The signer confirms who they are; the name is required, email and phone as the link asked for them. */
export function signerIdentity(value: Record<string, unknown>, expected: { name: string; email: string | null; phone: string | null }) {
  const name = typeof value.name === "string" ? value.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 160) throw new BadRequestException("Enter your full name.");
  const email = typeof value.email === "string" && value.email.trim() ? value.email.trim().toLowerCase() : expected.email;
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new BadRequestException("Enter a valid email.");
  const phone = typeof value.phone === "string" && value.phone.trim() ? value.phone.replace(/[\s().-]/g, "") : expected.phone;
  if (phone && !/^\+?[0-9]{6,20}$/.test(phone)) throw new BadRequestException("Enter a valid phone number.");
  if (value.consent !== true) throw new BadRequestException("Confirm that you agree to sign electronically.");
  return { name, email: email ?? null, phone: phone ?? null };
}

/** The caller's address and browser as the web passed them on; kept short and printable. */
export function clientNetwork(ip: unknown, userAgent: unknown) {
  const address = typeof ip === "string" ? ip.split(",")[0].trim().slice(0, 64) : "";
  const agent = typeof userAgent === "string" ? userAgent.replace(/[^\x20-\x7e]/g, "").slice(0, 500) : "";
  return { ip: address || "unknown", userAgent: agent || "unknown" };
}
