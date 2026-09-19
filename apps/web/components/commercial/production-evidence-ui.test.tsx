import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { CommercialState } from "@/lib/commercial/types";
import { ApprovalRelease } from "./commercial-workflows";

vi.mock("@/design-system", async (original) => ({
  ...(await original<typeof import("@/design-system")>()),
  ControlledModalDialog: () => null,
}));

it("shows the exact production evidence frozen in the Deal File", () => {
  const state = {
    canEdit: true,
    canApprove: true,
    canRelease: true,
    contacts: [],
    releaseReadiness: { designsRequired: 1, designsApproved: 1 },
    data: {
      revision: 1,
      quotes: [{
        id: "quote", number: 1, kind: "quotation", status: "accepted",
        title: "Villa", currency: "AED", validUntil: "2099-01-01",
        discount: 0, taxRate: 0, terms: "", exclusions: "", requestIds: [],
        paymentTerms: [], createdAt: "2026-09-18", total: 100, lines: [],
      }],
      requests: [], agreement: null, payments: [], audit: [], release: null,
      materialApprovals: [], ownerReview: null,
      dealFile: {
        id: "deal", reference: "DF-2026-001", revision: 1,
        ownerReviewId: "review", quoteId: "quote", quoteNumber: 1,
        quoteHash: "hash", agreementReference: "AGR-1", paymentIds: [],
        value: 100, cost: 50, margin: 50, commission: 0, status: "active",
        approvedAt: "2026-09-18T10:00:00.000Z", approvedBy: "Owner",
        designEvidence: { capturedAt: "2026-09-18T09:00:00.000Z", links: [{}, {}] },
        materialEvidence: [{}, {}, {}],
      },
    },
  } as unknown as CommercialState;
  render(<ApprovalRelease state={state} run={vi.fn()} busy={false} root="/workspace/pre-projects/cases/case" />);
  expect(screen.getByText("DF-2026-001")).toBeVisible();
  expect(screen.getByText("2 files · 3 materials")).toBeVisible();
});
