import { describe, expect, it } from "vitest";
import { fieldChanges } from "./change-history";

describe("change history (PLM-094)", () => {
  it("lists each changed field with its old and new value, ignoring bookkeeping", () => {
    expect(fieldChanges(
      { status: "new", version: 3, ownerMembershipId: "a", details: { budgetRange: "100k", area: "JLT" }, updatedAt: "x" },
      { status: "connected", version: 4, ownerMembershipId: "b", details: { budgetRange: "250k", area: "JLT" }, updatedAt: "y" },
    )).toEqual([
      { field: "details.budgetRange", from: "100k", to: "250k" },
      { field: "ownerMembershipId", from: "a", to: "b" },
      { field: "status", from: "new", to: "connected" },
    ]);
  });

  it("shows a newly set value and a cleared one", () => {
    expect(fieldChanges({ reason: null, note: "x" }, { reason: "Budget", note: "" })).toEqual([
      { field: "note", from: "x", to: null },
      { field: "reason", from: null, to: "Budget" },
    ]);
  });

  it("describes a creation by the values that were set", () => {
    expect(fieldChanges(null, { status: "new", title: "Villa", note: null })).toEqual([
      { field: "status", from: null, to: "new" },
      { field: "title", from: null, to: "Villa" },
    ]);
  });
});
