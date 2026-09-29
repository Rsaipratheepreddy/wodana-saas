import { describe, expect, it } from "vitest";
import { holdsAllowedRole, normaliseRoleCodes } from "./role-vocabulary";

describe("one role vocabulary", () => {
  it("stores role limits lower-case, trimmed, unique and sorted", () => {
    expect(normaliseRoleCodes(["SALES", " sales_admin ", "OPS_ADMIN", "sales", ""])).toEqual(["ops_admin", "sales", "sales_admin"]);
    expect(normaliseRoleCodes(undefined)).toEqual([]);
  });

  it("matches a member's roles and teams whatever the case, with owners and administrators always in", () => {
    expect(holdsAllowedRole(["sales"], ["SALES"])).toBe(true);
    expect(holdsAllowedRole(["team_sales"], ["sales"])).toBe(true);
    expect(holdsAllowedRole(["sales"], ["team_sales"])).toBe(true);
    expect(holdsAllowedRole(["Administrator"], ["sales"])).toBe(true);
    expect(holdsAllowedRole(["viewer", "team_finance"], ["sales", "ops_admin"])).toBe(false);
    // No limit: everyone.
    expect(holdsAllowedRole([], [])).toBe(true);
    expect(holdsAllowedRole([], null)).toBe(true);
  });
});
