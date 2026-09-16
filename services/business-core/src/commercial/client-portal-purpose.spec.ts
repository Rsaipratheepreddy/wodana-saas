import { describe, expect, it } from "vitest";
import { parsePortalChallengePurpose } from "./client-portal-purpose";

describe("client portal verification purposes", () => {
  it("accepts the project-scoped handover decision shape", () => {
    expect(parsePortalChallengePurpose("handover-decision:case:project:handover:accept"))
      .toEqual({ kind: "handover-decision", caseId: "case", projectId: "project", handoverId: "handover", decision: "accept" });
  });

  it("accepts the scoped warranty report and rejects malformed approval purposes", () => {
    expect(parsePortalChallengePurpose("warranty-claim:case:project:handover"))
      .toEqual({ kind: "warranty-claim", caseId: "case", projectId: "project", handoverId: "handover" });
    expect(parsePortalChallengePurpose("handover-decision:case:project:handover:decline")).toBeNull();
    expect(parsePortalChallengePurpose("warranty-claim:case:project")).toBeNull();
  });
});
