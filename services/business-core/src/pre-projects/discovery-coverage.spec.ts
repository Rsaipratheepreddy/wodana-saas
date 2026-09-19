import { describe, expect, it } from "vitest";
import { discoveryCoverage, type DiscoveryCoverageEntry } from "./discovery-coverage";

const rooms = [{ id: "living", name: "Living room" }, { id: "bedroom", name: "Bedroom" }];
const entry = (value: Partial<DiscoveryCoverageEntry> & Pick<DiscoveryCoverageEntry, "id">): DiscoveryCoverageEntry => ({
  kind: "requirement",
  roomId: null,
  source: "team",
  reviewStatus: "captured",
  scopeStatus: "undecided",
  archivedAt: null,
  ...value,
});

describe("discoveryCoverage", () => {
  it("reports room coverage and keeps whole-project requirements separate", () => {
    const result = discoveryCoverage(rooms, [entry({ id: "whole" }), entry({ id: "sofa", roomId: "living" })], []);
    expect(result).toMatchObject({ roomCount: 2, coveredRoomCount: 1, wholeProjectRequirementCount: 1 });
    expect(result.uncoveredRooms).toEqual([{ id: "bedroom", name: "Bedroom" }]);
  });

  it("finds client drafts, open scope decisions, and included items without verified measurements", () => {
    const result = discoveryCoverage(rooms, [
      entry({ id: "draft", source: "client", roomId: "living" }),
      entry({ id: "verified", scopeStatus: "included", reviewStatus: "reviewed", roomId: "living" }),
      entry({ id: "missing", scopeStatus: "included", roomId: "bedroom" }),
    ], [{ entryId: "verified", status: "verified" }, { entryId: "missing", status: "measured" }]);
    expect(result.clientDraftItemIds).toEqual(["draft"]);
    expect(result.undecidedItemIds).toEqual(["draft"]);
    expect(result.verifiedMeasurementItemIds).toEqual(["verified"]);
    expect(result.missingMeasurementItemIds).toEqual(["missing"]);
  });

  it("ignores archived and non-requirement records", () => {
    const result = discoveryCoverage(rooms, [
      entry({ id: "archived", roomId: "living", archivedAt: "2026-09-18" }),
      entry({ id: "photo", kind: "inspiration", roomId: "bedroom", source: "client" }),
    ], []);
    expect(result.coveredRoomCount).toBe(0);
    expect(result.clientDraftItemIds).toEqual([]);
    expect(result.undecidedItemIds).toEqual([]);
  });
});
