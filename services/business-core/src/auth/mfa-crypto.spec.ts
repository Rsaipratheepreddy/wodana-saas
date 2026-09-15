import { describe, expect, it } from "vitest";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  parseMfaEncryptionKey,
  recoveryCodeHash,
  totpCode,
  verifyTotp,
} from "./mfa-crypto";

const key = parseMfaEncryptionKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

describe("MFA cryptography", () => {
  it("matches the RFC 6238 SHA-1 vector truncated to six digits", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totpCode(secret, 59)).toEqual({ code: "287082", step: 1 });
    expect(verifyTotp(secret, "287082", 59)).toBe(1);
  });

  it("allows one time step of clock drift", () => {
    const secret = generateTotpSecret();
    const previous = totpCode(secret, 60);
    expect(verifyTotp(secret, previous.code, 90)).toBe(previous.step);
  });

  it("encrypts the seed with authenticated encryption", () => {
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret, key);
    expect(JSON.stringify(encrypted)).not.toContain(secret);
    expect(decryptMfaSecret(encrypted, key)).toBe(secret);
  });

  it("normalizes and peppers recovery codes", () => {
    expect(normalizeRecoveryCode("abcd-2345 efgh")).toBe("ABCD2345EFGH");
    expect(recoveryCodeHash("ABCD-2345", key)).toBe(recoveryCodeHash("abcd 2345", key));
    expect(recoveryCodeHash("ABCD-2345", key)).toHaveLength(64);
    expect(generateRecoveryCodes(10)).toHaveLength(10);
    expect(new Set(generateRecoveryCodes(10)).size).toBe(10);
  });

  it("rejects malformed encryption keys", () => {
    expect(() => parseMfaEncryptionKey("short")).toThrow("MFA_ENCRYPTION_KEY");
  });
});
