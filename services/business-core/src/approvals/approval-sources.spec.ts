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
  it("lists a signed agreement waiting to be verified under Deals, for whoever verifies agreements (M6)", async () => {
    const agreement = { caseId: CASE, reference: "AGR-2026-001", since: new Date("2026-09-29T09:00:00.000Z"), revision: 7, amount: "77960.00", currency: "AED",
      quoteNumber: 1, client: "Sofia Bennett", title: "Emirates Hills Penthouse" };
    const db = fakeDb([["content->'agreement'", [agreement]]]);
    const { rows, counts } = await waitingFor(db, context(["commercial.approve"]));
    expect(rows).toEqual([expect.objectContaining({ kind: "agreement", group: "deals", title: "Emirates Hills Penthouse · AGR-2026-001", subject: "Sofia Bennett",
      href: `/workspace/pre-projects/cases/${CASE}/contracts`, decide: null, canDecide: true, version: 7, parentId: CASE })]);
    expect(counts.deals).toBe(1);
    // Someone who doesn't verify agreements isn't asked.
    expect((await waitingFor(db, context(["commercial.finance.verify"]))).rows.filter((row) => row.kind === "agreement")).toEqual([]);
  });

  it("opens the Deal File for a deal to check or approve, not the case's Approvals table (M4)", async () => {
    const deal = { caseId: CASE, status: "pending_finance", submittedById: "sara", financeReviewedById: null, since: "2026-09-29T10:00:00.000Z", amount: "77960.00",
      currency: "AED", quoteNumber: 1, client: "Sofia Bennett", title: "Emirates Hills Penthouse" };
    const { rows } = await waitingFor(fakeDb([["'ownerReview'", [deal]]]), context(["commercial.finance.verify"], "layla"));
    expect(rows).toEqual([expect.objectContaining({ kind: "deal_finance", group: "deals", title: "Emirates Hills Penthouse · Q-1",
      href: `/workspace/pre-projects/cases/${CASE}/execution-release`, canDecide: true })]);
  });

  it("names the client contact who raised a warranty claim", async () => {
    const claim = { id: CASE, number: 1, description: "Drawer won't close", since: new Date("2026-09-29T09:00:00.000Z"), raisedBy: "Faris", projectId: "p", projectReference: "PRJ-1", projectName: "Villa 12" };
    const { rows } = await waitingFor(fakeDb([["FROM warranty_claims", [claim]]]), context(["projects.manage"]));
    expect(rows).toEqual([expect.objectContaining({ kind: "warranty", title: "W-1 · Drawer won't close", subject: "Faris" })]);
  });
});
