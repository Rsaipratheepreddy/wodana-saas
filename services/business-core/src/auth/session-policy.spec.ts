import { describe, expect, it } from "vitest";
import { sessionDeviceLimit } from "./session-policy";
import { validateRuntimeConfig } from "../config/runtime-config";

const user = "81000000-0000-4000-8000-000000000001";
describe("test account device policy", () => {
  it("defaults to two devices and only exempts exact configured identities", () => {
    expect(sessionDeviceLimit(user)).toBe(2);
    expect(sessionDeviceLimit(user, "*")).toBe(2);
    expect(sessionDeviceLimit(user, ` ${user}, 81000000-0000-4000-8000-000000000002 `)).toBeNull();
    expect(sessionDeviceLimit("another-user", user)).toBe(2);
  });
  it("rejects broad or malformed runtime exemptions", () => {
    const base = { DATABASE_URL: "postgresql://local", AUTH_MODE: "development" };
    for (const ids of ["*", "iglo", "admin@igloarchitects.com", `${user},all`]) {
      expect(() => validateRuntimeConfig({ ...base, AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS: ids })).toThrow("explicit user UUIDs");
    }
    expect(validateRuntimeConfig({ ...base, AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS: user })).toBeTruthy();
  });
});
