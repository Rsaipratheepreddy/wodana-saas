import { describe, expect, it } from "vitest";
import { resolveApprovalOrganizationLimit } from "./customer-accounts.service";

describe("customer account organization limits", () => {
  it("allows an approval when an approved slot is available", () => {
    expect(resolveApprovalOrganizationLimit(3, 1)).toBe(3);
  });

  it("requires an explicit limit increase when the account is full", () => {
    expect(() => resolveApprovalOrganizationLimit(1, 1)).toThrow(
      "Customer account organization limit reached",
    );
    expect(resolveApprovalOrganizationLimit(1, 1, 2)).toBe(2);
  });

  it("does not accept a limit that still cannot hold the approved organization", () => {
    expect(() => resolveApprovalOrganizationLimit(2, 2, 2)).toThrow(
      "Organization limit must be at least 3",
    );
  });

  it("does not reduce an existing contractual limit during approval", () => {
    expect(() => resolveApprovalOrganizationLimit(5, 1, 2)).toThrow(
      "Approval cannot reduce the existing organization limit",
    );
  });
});
