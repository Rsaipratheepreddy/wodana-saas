import { describe, expect, it, vi } from "vitest";
import { assertClientIdentityChange, CLIENT_IDENTITY_LOCKED, nameChanged, phoneChanged } from "./client-identity-lock";

describe("the client's identity lock", () => {
  it("treats a name as changed only when another name replaces a stored one", () => {
    expect(nameChanged("Maya Haddad", " maya  HADDAD ")).toBe(false);
    expect(nameChanged("Maya Haddad", "Maya H.")).toBe(true);
    expect(nameChanged("", "Maya")).toBe(false);
    expect(nameChanged("Maya", undefined)).toBe(false);
  });

  it("treats a phone as changed when another number replaces or clears a stored one", () => {
    expect(phoneChanged("+971501234567", "050 123 4567")).toBe(false);
    expect(phoneChanged("+971501234567", "+971 50 123 4567")).toBe(false);
    expect(phoneChanged("+971501234567", "+971550000000")).toBe(true);
    expect(phoneChanged("+971501234567", "")).toBe(true);
    expect(phoneChanged(null, "+971550000000")).toBe(false);
  });

  it("asks for the permission only when the identity changes", async () => {
    const access = { hasPermission: vi.fn(async () => false) };
    await expect(assertClientIdentityChange(access, {} as never, "w", "u", false)).resolves.toBeUndefined();
    expect(access.hasPermission).not.toHaveBeenCalled();
    await expect(assertClientIdentityChange(access, {} as never, "w", "u", true)).rejects.toThrow(CLIENT_IDENTITY_LOCKED);
    expect(access.hasPermission).toHaveBeenCalledWith({}, "w", "u", "crm.parties.identity");
    access.hasPermission.mockResolvedValue(true);
    await expect(assertClientIdentityChange(access, {} as never, "w", "u", true)).resolves.toBeUndefined();
  });
});
