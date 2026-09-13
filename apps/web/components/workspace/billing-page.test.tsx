import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WorkspaceBillingData } from "@/lib/internal/types";
import { BillingPage } from "./billing-page";

const billing: WorkspaceBillingData = {
  subscription: {
    amount: "999.00",
    billingCycle: "monthly",
    currency: "INR",
    planCode: "starter",
    projectLimit: 25,
    renewsAt: "2026-09-21T00:00:00.000Z",
    seatLimit: 5,
    startedAt: "2026-09-01T00:00:00.000Z",
    status: "trial",
    updatedAt: "2026-09-07T00:00:00.000Z",
    version: 1,
  },
  usage: { members: 4, projects: 2 },
  workspace: { defaultCurrency: "INR", id: "workspace-1", name: "Iglo Architects", status: "active" },
};

describe("BillingPage", () => {
  it("shows the assigned Wodana plan and its real usage", () => {
    render(<BillingPage data={billing} />);

    expect(screen.getByRole("heading", { name: "Starter" })).toBeVisible();
    expect(screen.getByText("Trial")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Team seats: 4 of 5" })).toHaveAttribute("aria-valuenow", "4");
    expect(screen.getByRole("progressbar", { name: "Active projects: 2 of 25" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByText(/QuickBooks or Zoho Books/)).toBeVisible();
  });
});
