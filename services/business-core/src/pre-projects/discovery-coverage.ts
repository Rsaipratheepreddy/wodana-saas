export type DiscoveryCoverageRoom = { id: string; name: string };

export type DiscoveryCoverageEntry = {
  id: string;
  kind: string;
  roomId: string | null;
  source: string;
  reviewStatus: string;
  scopeStatus: string;
  archivedAt: string | null;
};

export type DiscoveryCoverageMeasurement = {
  entryId: string;
  status: string;
};

export type DiscoveryCoverage = {
  roomCount: number;
  coveredRoomCount: number;
  uncoveredRooms: DiscoveryCoverageRoom[];
  wholeProjectRequirementCount: number;
  undecidedItemIds: string[];
  clientDraftItemIds: string[];
  missingMeasurementItemIds: string[];
  verifiedMeasurementItemIds: string[];
};

/**
 * A compact operational view of discovery completeness. This is derived from
 * the current records; it never becomes a second editable source of truth.
 */
export function discoveryCoverage(
  rooms: DiscoveryCoverageRoom[],
  entries: DiscoveryCoverageEntry[],
  measurements: DiscoveryCoverageMeasurement[],
): DiscoveryCoverage {
  const active = entries.filter((entry) => entry.kind === "requirement" && !entry.archivedAt);
  const coveredRoomIds = new Set(active.flatMap((entry) => entry.roomId ? [entry.roomId] : []));
  const verifiedMeasurementItemIds = new Set(
    measurements.filter((measurement) => measurement.status === "verified").map((measurement) => measurement.entryId),
  );
  const included = active.filter((entry) => entry.scopeStatus === "included");

  return {
    roomCount: rooms.length,
    coveredRoomCount: rooms.filter((room) => coveredRoomIds.has(room.id)).length,
    uncoveredRooms: rooms.filter((room) => !coveredRoomIds.has(room.id)),
    wholeProjectRequirementCount: active.filter((entry) => !entry.roomId).length,
    undecidedItemIds: active.filter((entry) => entry.scopeStatus === "undecided").map((entry) => entry.id),
    clientDraftItemIds: active.filter((entry) => entry.source === "client" && entry.reviewStatus !== "reviewed").map((entry) => entry.id),
    missingMeasurementItemIds: included.filter((entry) => !verifiedMeasurementItemIds.has(entry.id)).map((entry) => entry.id),
    verifiedMeasurementItemIds: included.filter((entry) => verifiedMeasurementItemIds.has(entry.id)).map((entry) => entry.id),
  };
}
