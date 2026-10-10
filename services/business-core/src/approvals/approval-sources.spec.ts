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

describe("Approvals → Designs", () => {
  const DESIGN = "00000000-0000-4000-8000-000000000002";
  const review = { designId: DESIGN, caseId: CASE, title: "Majlis concept", number: 2, version: 5, reviewerId: "noor", since: new Date("2026-10-09T09:00:00.000Z"),
    client: "Mariam Al Suwaidi", reference: "D-0012", caseTitle: "Majlis design" };
  const reviewer = ["pre_projects.view", "pre_projects.edit", "pre_projects.review_designs"];

  it("lists a design sent for internal review to its reviewer, approved or sent back in the row, and opens the design", async () => {
    const db = fakeDb([["FROM pre_project_designs", [review]]]);
    const { rows, count, counts } = await waitingFor(db, context(reviewer, "noor"));
    expect(rows).toEqual([expect.objectContaining({
      kind: "design_review", group: "designs", id: DESIGN, parentId: CASE, version: 5, title: "Majlis concept · V2", subject: "Mariam Al Suwaidi",
      project: { id: CASE, reference: "D-0012", name: "Majlis design" }, since: "2026-10-09T09:00:00.000Z", canDecide: true,
      href: `/workspace/pre-projects/cases/${CASE}/designs?file=${DESIGN}`, decide: { approve: "internal_approved", other: "return", approveNeedsNote: false },
    })]);
    expect(count).toBe(1);
    expect(counts.designs).toBe(1);
  });

  it("asks only the reviewer it was sent to (any reviewer when none was named), and only people who review designs", async () => {
    const db = fakeDb([["FROM pre_project_designs", [review]]]);
    expect((await waitingFor(db, context(reviewer, "sara"))).rows).toEqual([]);
    expect((await waitingFor(db, context(["pre_projects.view", "pre_projects.edit"], "noor"))).rows).toEqual([]);
    const unassigned = fakeDb([["FROM pre_project_designs", [{ ...review, reviewerId: null }]]]);
    expect((await waitingFor(unassigned, context(reviewer, "sara"))).rows).toEqual([expect.objectContaining({ kind: "design_review", canDecide: true })]);
    // A reviewer who can't change the case's records opens the design instead of deciding in the row.
    expect((await waitingFor(db, context(["pre_projects.view", "pre_projects.review_designs"], "noor"))).rows).toEqual([expect.objectContaining({ kind: "design_review", decide: null })]);
  });
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
    // The deals source's own read (the engine's request reads name 'ownerReview' too, for a Deal File's live title).
    const { rows } = await waitingFor(fakeDb([["->>'status' IN ('pending_finance', 'pending_approval')", [deal]]]), context(["commercial.finance.verify"], "layla"));
    expect(rows).toEqual([expect.objectContaining({ kind: "deal_finance", group: "deals", title: "Emirates Hills Penthouse · Q-1",
      href: `/workspace/pre-projects/cases/${CASE}/execution-release`, canDecide: true })]);
  });

  it("names the client contact who raised a warranty claim", async () => {
    const claim = { id: CASE, number: 1, description: "Drawer won't close", since: new Date("2026-09-29T09:00:00.000Z"), raisedBy: "Faris", projectId: "p", projectReference: "PRJ-1", projectName: "Villa 12" };
    const { rows } = await waitingFor(fakeDb([["FROM warranty_claims", [claim]]]), context(["projects.manage"]));
    expect(rows).toEqual([expect.objectContaining({ kind: "warranty", title: "W-1 · Drawer won't close", subject: "Faris" })]);
  });
});
