import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import type { CommercialData } from "./commercial.types";
import { CommercialService } from "./commercial.service";

function reviewData(status: "pending_finance" | "pending_approval" | "approved"): CommercialData {
  return {
    revision: 7,
    ownerReview: {
      id: "review-id", quoteId: "quote-id", quoteHash: "hash", status,
      commission: 10, checklist: { agreement: true, boq: true, documents: true, margin: true, materials: true, payment: true },
      submissionNote: "Submitted", submittedAt: "2026-09-24T00:00:00Z", submittedBy: "Sales", submittedById: "sales-user",
    },
  } as CommercialData;
}

describe("Deal File review notifications", () => {
  it("routes a Sales submission to Finance and Finance confirmation to an Owner", async () => {
    const query = vi.fn().mockImplementation(async (sql: string) =>
      sql.includes("SELECT DISTINCT membership.user_id") ? { rows: [{ userId: "reviewer-user" }] } :
      sql.includes("SELECT enabled FROM notification_preferences") ? { rows: [] } : { rows: [] });
    const service = Object.create(CommercialService.prototype) as CommercialService;
    await service["notifyDealReview"]({ query } as unknown as PoolClient, "workspace", "case", reviewData("pending_finance"), "submit_owner_review", "sales-user");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("permission.code=$2"), ["workspace", "commercial.finance.verify", "sales-user", null]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO notifications"), expect.arrayContaining(["commercial.deal.pending_finance", "Deal File needs Finance review", "/workspace/pre-projects/cases/case/approvals"]));

    query.mockClear();
    await service["notifyDealReview"]({ query } as unknown as PoolClient, "workspace", "case", {
      ...reviewData("pending_approval"),
      servicePath: { scope: { design: true } },
    } as CommercialData, "review_deal_finance", "finance-user");
    // Every holder of the approval permission hears it (by permission, never by role name), except the submitter.
    const recipients = query.mock.calls.find(([sql]) => String(sql).includes("SELECT DISTINCT membership.user_id"));
    expect(recipients?.[1]).toEqual(["workspace", "commercial.deal.approve", "finance-user", "sales-user"]);
    expect(String(recipients?.[0])).not.toMatch(/role\.code|owner_role/);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO notifications"), expect.arrayContaining(["commercial.deal.pending_approval", "Deal File needs approval"]));
  });

  it("notifies the submitting Account Manager of the Owner decision", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = Object.create(CommercialService.prototype) as CommercialService;
    await service["notifyDealReview"]({ query } as unknown as PoolClient, "workspace", "case", reviewData("approved"), "decide_owner_review", "ops-user");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("SELECT DISTINCT membership.user_id"))).toBe(false);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO notifications"), expect.arrayContaining(["sales-user", "commercial.deal.decision", "Deal File approved"]));
  });
});
