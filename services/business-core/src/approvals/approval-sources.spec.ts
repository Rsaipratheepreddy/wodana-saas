import { describe, expect, it } from "vitest";
import { waitingFor, type ApprovalContext } from "./approval-sources";

const CASE = "00000000-0000-4000-8000-000000000001";

/** A database that answers only the reads a test names (by a phrase of their SQL); every other source is empty. */
function fakeDb(answers: Array<[phrase: string, rows: Record<string, unknown>[]]>) {
  return { query: async (sql: string) => ({ rows: answers.find(([phrase]) => sql.includes(phrase))?.[1] ?? [], rowCount: 0 }) } as never;
}
const context = (permissions: string[], userId = "olivia"): ApprovalContext => ({
  workspaceId: "w", userId, displayName: "Olivia", membershipId: null, managedProjects: new Set(), currency: "AED",
  can: async (permission) => permissions.includes(permission),
});

describe("Approvals → Deals", () => {
  it("opens the Deal File for a deal to check or approve, not the case's Approvals table (M4)", async () => {
    const deal = { caseId: CASE, status: "pending_finance", submittedById: "sara", financeReviewedById: null, since: "2026-09-29T10:00:00.000Z", amount: "77960.00",
      currency: "AED", quoteNumber: 1, client: "Sofia Bennett", title: "Emirates Hills Penthouse" };
    const { rows } = await waitingFor(fakeDb([["'ownerReview'", [deal]]]), context(["commercial.finance.verify"], "layla"));
    expect(rows).toEqual([expect.objectContaining({ kind: "deal_finance", group: "deals", title: "Emirates Hills Penthouse · Q-1",
      href: `/workspace/pre-projects/cases/${CASE}/execution-release`, canDecide: true })]);
  });
});
