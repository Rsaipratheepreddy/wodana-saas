import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { compare as compareBcrypt } from "bcryptjs";

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;
// Used only by a verified legacy import. New passwords always use scrypt.
export const LEGACY_BCRYPT_SALT = "legacy-bcrypt";

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return { hash: derived.toString("hex"), salt };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string) {
  if (salt === LEGACY_BCRYPT_SALT) {
    // Accept the old application's bounded bcrypt format, never arbitrary encodings.
    const match = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/.exec(expectedHash);
    if (!match || Number(match[1]) < 4 || Number(match[1]) > 16) return false;
    return compareBcrypt(password, expectedHash);
  }
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  const expected = Buffer.from(expectedHash, "hex");
  return expected.length === derived.length && timingSafeEqual(derived, expected);
}

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
