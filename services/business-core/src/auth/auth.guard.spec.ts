import { describe, expect, it } from "vitest";
import { hasVerifiedOidcIdentity } from "./auth.guard";

describe("hasVerifiedOidcIdentity", () => {
  it("requires subject, email, and an explicitly verified email", () => {
    expect(hasVerifiedOidcIdentity({ sub: "user-1", email: "owner@example.com" })).toBe(false);
    expect(hasVerifiedOidcIdentity({
      sub: "user-1",
      email: "owner@example.com",
      email_verified: false,
    })).toBe(false);
    expect(hasVerifiedOidcIdentity({
      sub: "user-1",
      email: "owner@example.com",
      email_verified: true,
    })).toBe(true);
  });
});
