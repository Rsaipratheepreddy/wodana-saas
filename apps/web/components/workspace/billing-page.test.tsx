import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WorkspaceBillingData } from "@/lib/internal/types";
import { BillingPage } from "./billing-page";

const billing: WorkspaceBillingData = {
  account: { id: "account-1", displayName: "Iglo Architects" },
  contract: {
    version: 2,
    status: "contracted",
    recurringAmount: "999.00",
    billingCycle: "monthly",
    currency: "INR",
    planCode: "starter",
    planVersion: 1,
    projectLimit: 25,
    renewsAt: "2026-09-21T00:00:00.000Z",
    seatLimit: 5,
    trialEndsAt: null,
    termStartsAt: "2026-09-01T00:00:00.000Z",
    endsAt: null,
    taxValidationState: "unverified",
    effectiveFrom: "2026-09-01T00:00:00.000Z",
    effectiveUntil: null,
  },
  organizationAllocation: { version: 2, status: "active", allocatedAmount: "999.00", seatLimit: 5,
    projectLimit: 25, effectiveFrom: "2026-09-01T00:00:00.000Z", effectiveUntil: null },
  collection: { version: 2, status: "grace", overdueAmount: "999.00", currency: "INR",
    effectiveAt: "2026-09-18T00:00:00.000Z", nextReviewAt: "2026-09-20T00:00:00.000Z" },
  accessPolicy: { state: "grace", effect: "unchanged", warning: true,
    actionDueAt: "2026-09-20T00:00:00.000Z", affectedModules: [],
    message: "The account is in a dated payment grace period. Workspace access remains unchanged." },
  usage: { seatLimit: 5, members: 4, invitedMembers: 0, pendingInvitations: 1, reservedSeats: 5, projects: 2 },
  accountUsageSnapshot: { periodStart: "2026-08-18T00:00:00.000Z", periodEnd: "2026-09-18T00:00:00.000Z",
    capturedAt: "2026-09-18T00:00:00.000Z", source: "computed",
    totals: { members: 7, pendingInvitations: 1, projects: 8, knownFileBytes: 100, knownFileCount: 2 } },
  documents: [{ id: "invoice-1", documentType: "invoice", documentNumber: "INV-1001", status: "issued",
    currency: "INR", totalAmount: "999.00", balanceAmount: "999.00", issuedAt: "2026-09-01T00:00:00.000Z",
    dueAt: "2026-09-15T00:00:00.000Z", settledAt: null, taxValidationState: "unverified",
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }],
  workspace: { defaultCurrency: "INR", id: "workspace-1", name: "Iglo Architects", status: "active" },
  authority: "account_contract",
  taxCompliance: "unverified",
  observedAt: "2026-09-18T00:00:00.000Z",
};

describe("BillingPage", () => {
  it("shows the assigned Wodana plan and its real usage", () => {
    render(<BillingPage data={billing} />);

    expect(screen.getByText("Starter")).toBeVisible();
    expect(screen.getAllByText("Grace").length).toBeGreaterThan(0);
    expect(screen.getByRole("progressbar", { name: "Reserved seats: 5 of 5" })).toHaveAttribute("aria-valuenow", "5");
    expect(screen.getByRole("progressbar", { name: "Active projects: 2 of 25" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByText("INV-1001")).toBeVisible();
    expect(screen.getByText(/Workspace access remains unchanged/)).toBeVisible();
  });
});
