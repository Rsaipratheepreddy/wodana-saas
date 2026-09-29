import { describe, expect, it } from "vitest";
import { leadsPageFixture } from "./leads";
import { defaultFollowUp, quickConversion } from "./quick-convert";

const now = new Date("2026-09-29T14:00:00.000Z");

describe("one-click Convert (S-39)", () => {
  it("follows up at the enquiry's own time when it's ahead, else tomorrow at 10:00 in the workspace's zone", () => {
    expect(defaultFollowUp("2026-10-02T09:00:00.000Z", "Asia/Kolkata", now)).toBe("2026-10-02T09:00:00.000Z");
    expect(defaultFollowUp("2026-09-01T09:00:00.000Z", "Asia/Kolkata", now)).toBe("2026-09-30T04:30:00.000Z");
    expect(defaultFollowUp(null, "UTC", now)).toBe("2026-09-30T10:00:00.000Z");
  });

  it("uses the enquiry's title, its owner (or the person converting) and the default pipeline", () => {
    const data = structuredClone(leadsPageFixture);
    const lead = { ...data.items[0], serviceType: data.items[0].serviceType ?? "fit_out" };
    expect(quickConversion(lead, data, "UTC", now)).toMatchObject({ partyId: lead.partyId, leadVersion: lead.version, title: lead.title, pipelineId: data.pipelines[0].id,
      ownerMembershipId: lead.ownerMembershipId ?? data.currentMembershipId });
  });

  it("opens the full dialog when something is missing", () => {
    const data = structuredClone(leadsPageFixture);
    expect(quickConversion({ ...data.items[0], serviceType: null } as never, data, "UTC", now)).toBeNull();
    expect(quickConversion({ ...data.items[0], ownerMembershipId: null } as never, { ...data, currentMembershipId: undefined }, "UTC", now)).toBeNull();
    expect(quickConversion(data.items[0], { ...data, pipelines: [] }, "UTC", now)).toBeNull();
  });
});
