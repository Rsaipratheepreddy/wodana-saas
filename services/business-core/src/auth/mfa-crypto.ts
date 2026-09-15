import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

export type EncryptedMfaSecret = {
  ciphertext: string;
  nonce: string;
  authTag: string;
};

export function parseMfaEncryptionKey(value: string | undefined): Buffer {
  const configured = value?.trim() ?? "";
  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(configured)) {
    key = Buffer.from(configured, "hex");
  } else {
    key = Buffer.from(configured, "base64url");
  }
  if (key.length !== 32) {
    throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters or base64url");
  }
  return key;
}

export function encodeBase32(bytes: Buffer): string {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let encoded = "";
  for (let offset = 0; offset < bits.length; offset += 5) {
    encoded += BASE32_ALPHABET[Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, "0"), 2)];
  }
  return encoded;
}

export function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  if (!normalized || [...normalized].some((character) => !BASE32_ALPHABET.includes(character))) {
    throw new Error("TOTP secret is not valid base32");
  }
  let bits = "";
  for (const character of normalized) {
    bits += BASE32_ALPHABET.indexOf(character).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function totpCode(secret: string, atSeconds = Date.now() / 1000) {
  const step = Math.floor(atSeconds / TOTP_PERIOD_SECONDS);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** TOTP_DIGITS);
  return { code: String(binary).padStart(TOTP_DIGITS, "0"), step };
}

export function verifyTotp(secret: string, suppliedCode: string, atSeconds = Date.now() / 1000) {
  const normalized = suppliedCode.trim();
  if (!/^\d{6}$/.test(normalized)) return null;
  const supplied = Buffer.from(normalized);
  for (const drift of [-1, 0, 1]) {
    const candidate = totpCode(secret, atSeconds + drift * TOTP_PERIOD_SECONDS);
    const expected = Buffer.from(candidate.code);
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return candidate.step;
  }
  return null;
}

export function encryptMfaSecret(secret: string, key: Buffer): EncryptedMfaSecret {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    nonce: nonce.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptMfaSecret(encrypted: EncryptedMfaSecret, key: Buffer): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(encrypted.nonce, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function recoveryCodeHash(code: string, key: Buffer): string {
  return createHmac("sha256", key).update(`recovery:${normalizeRecoveryCode(code)}`).digest("hex");
}

export function generateRecoveryCodes(count: number): string[] {
  return Array.from({ length: count }, () => {
    const raw = encodeBase32(randomBytes(10));
    return raw.match(/.{1,4}/g)?.join("-") ?? raw;
  });
}
