import { describe, expect, it, vi } from "vitest";
import { ClientPortalService } from "./client-portal.service";

function setup() {
  const content = {
    clientSections: { handover: false },
    // Even known successful request IDs must not bypass revoked visibility.
    handovers: [{ id: "handover", status: "accepted", decisionChallengeId: "challenge" }],
    snags: [{ id: "claim", warrantyClaimChallengeId: "challenge" }],
  };
  const query = vi.fn().mockResolvedValue({ rows: [{ content }], rowCount: 1 });
  const consume = vi.fn();
  const service = Object.assign(Object.create(ClientPortalService.prototype), {
    db: { tenantTransaction: async (_workspace: string, _actor: string, work: (client: { query: typeof query }) => unknown) => work({ query }) },
    branding: vi.fn().mockResolvedValue({ workspaceId: "workspace" }),
    session: vi.fn().mockResolvedValue({ grants: [{ id: "grant", caseId: "case", role: "approver" }], phone: "+10000000000" }),
    commercial: { caseRecord: vi.fn() }, consume,
  }) as ClientPortalService;
  return { service, query, consume };
}

describe("hidden client handover mutations", () => {
  it.each(["handover-decision", "warranty-claim"])("rejects stale %s requests before OTP consumption or writes", async action => {
    const { service, query, consume } = setup();
    await expect(service.command("portal", "session", {
      action, caseId: "case", projectId: "project", handoverId: "handover", decision: "accept", challengeId: "challenge", code: "123456",
    })).rejects.toThrow(/not available/);
    expect(consume).not.toHaveBeenCalled();
    // Reads and locks only: nothing is written before visibility is confirmed.
    expect(query.mock.calls.map(([sql]) => String(sql)).filter((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/.test(sql))).toEqual([]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("project.workspace_id=$1 AND project.case_id=$2 AND project.id=$3"), ["workspace", "case", "project"]);
  });
});
