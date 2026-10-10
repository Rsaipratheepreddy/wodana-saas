import { describe, expect, it } from "vitest";
import { APPROVAL_FILTERS, KIND_LABEL, approvalTitle, approveLabel, filterRows, waitingSince, type ApprovalRow } from "./approvals";

const row = (kind: ApprovalRow["kind"], group: ApprovalRow["group"]): ApprovalRow => ({
  kind, group, id: `${kind}-1`, title: kind, subject: null, project: null, amount: null, currency: null, since: "2026-09-28T08:00:00.000Z",
  href: "/workspace", canDecide: true, reason: null, decide: null, version: null, parentId: null,
});

describe("waiting for you", () => {
  it("filters by the chip, with All showing everything", () => {
    const rows = [row("order", "orders"), row("receipt", "payments"), row("bill", "finance")];
    expect(filterRows(rows, "all")).toHaveLength(3);
    expect(filterRows(rows, "payments").map((item) => item.kind)).toEqual(["receipt"]);
    expect(APPROVAL_FILTERS.map((item) => item.id)).toEqual(["all", "designs", "quotes", "payments", "deals", "orders", "factory", "site", "stock", "finance", "ai"]);
  });

  it("names every kind, and verifies money rather than approving it", () => {
    for (const kind of Object.keys(KIND_LABEL)) expect(KIND_LABEL[kind as ApprovalRow["kind"]]).toBeTruthy();
    expect(approveLabel("receipt")).toBe("Verify");
    expect(approveLabel("order")).toBe("Approve");
  });

  it("says how long something has waited in its largest whole unit", () => {
    const now = new Date("2026-09-28T12:00:00.000Z");
    expect(waitingSince("2026-09-28T11:59:40.000Z", now, "en")).toBe("1 minute");
    expect(waitingSince("2026-09-28T08:00:00.000Z", now, "en")).toBe("4 hours");
    expect(waitingSince("2026-09-25T12:00:00.000Z", now, "en")).toBe("3 days");
  });
  it("names a site report by its day, not the stored date", () => {
    expect(approvalTitle({ kind: "site_report", title: "2026-09-28" }, "en-GB")).toBe("28 Sept 2026");
    expect(approvalTitle({ kind: "order", title: "PO-0042" }, "en-GB")).toBe("PO-0042");
  });
});
