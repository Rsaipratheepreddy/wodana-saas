import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PreProjectCase } from "@/lib/pre-project/types";
import type { DefinitionPageData } from "@/lib/pre-project/definition";
import type { CommercialState } from "@/lib/commercial/types";
import { CaseOverview } from "./case-overview";

const { caseRequest } = vi.hoisted(() => ({ caseRequest: vi.fn() }));
vi.mock("@/lib/pre-project/content", () => ({ caseRequest }));
vi.mock("./design-journey", () => ({ DesignJourney: () => null }));

const initial: PreProjectCase = {
  id: "case-1", title: "Villa interiors", description: null, status: "active",
  customerId: "customer-1", customerName: "Palm client", opportunityId: "opportunity-1",
  opportunityStatus: "open", leadId: "lead-1", leadManagerName: "Manager", amount: null,
  currencyCode: "AED", createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z",
  phase: "define", version: 3, ownerMembershipId: "owner-1", engagementOwnerName: "Owner",
  targetDate: null, priority: "normal", riskLevel: "low", activatedAt: "2026-09-17T00:00:00Z",
  holdReason: null, cancellationReason: null, releasedAt: null, canManageLifecycle: true,
};

const members = [{ id: "owner-1", displayName: "Owner" }, { id: "owner-2", displayName: "Designer" }];
function view(record = initial, progress?: DefinitionPageData, commercial?: CommercialState) {
  const onUpdated = vi.fn();
  render(<DesignSystemProvider><CaseOverview record={record} workspaceId="workspace-1" members={members} progress={progress} commercial={commercial} onUpdated={onUpdated} /></DesignSystemProvider>);
  return onUpdated;
}
afterEach(() => caseRequest.mockReset());

describe("pre-execution case overview", () => {
  it("keeps the overview limited to client and essential project details", () => {
    view({ ...initial, status: "released" });
    expect(screen.getByText("Palm client")).toBeVisible();
    expect(screen.getByText("Owner", { selector: "dd bdi" })).toBeVisible();
    expect(screen.queryByText("Client decisions & release")).not.toBeInTheDocument();
    expect(screen.queryByText("Project notes")).not.toBeInTheDocument();
  });









  it("saves operational ownership and risk with the current version", async () => {
    caseRequest.mockResolvedValue({ ...initial, version: 4, ownerMembershipId: "owner-2", engagementOwnerName: "Designer", priority: "high", riskLevel: "medium" });
    const updated = view();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit details" }));
    await user.click(screen.getByRole("button", { name: /Project owner/ }));
    await user.click(screen.getByRole("option", { name: "Designer" }));
    await user.click(screen.getByRole("button", { name: /Priority/ }));
    await user.click(screen.getByRole("option", { name: "High" }));
    await user.click(screen.getByRole("button", { name: /Risk/ }));
    await user.click(screen.getByRole("option", { name: "Medium" }));
    await user.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(caseRequest).toHaveBeenCalledWith("workspace-1", "case-1", "profile", "PATCH", expect.objectContaining({ version: 3, ownerMembershipId: "owner-2", priority: "high", riskLevel: "medium", requestId: expect.any(String) })));
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ version: 4, canManageLifecycle: true }));
    expect(screen.getByText("Designer")).toBeVisible();
  });

  it("requires a reason for hold and resumes against the new version", async () => {
    caseRequest
      .mockResolvedValueOnce({ ...initial, status: "on_hold", version: 4, holdReason: "Waiting for client" })
      .mockResolvedValueOnce({ ...initial, status: "active", version: 5, holdReason: null });
    view();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Project actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Put on hold" }));
    const dialog = screen.getByRole("dialog", { name: "Put on hold" });
    await user.type(within(dialog).getByLabelText("Reason *"), "Waiting for client");
    await user.click(within(dialog).getByRole("button", { name: "Put on hold" }));
    await user.click(await screen.findByRole("button", { name: "Project actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Resume" }));
    await user.click(within(screen.getByRole("dialog", { name: "Resume" })).getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(caseRequest).toHaveBeenCalledTimes(2));
    expect(caseRequest.mock.calls[0][4]).toMatchObject({ version: 3, action: "hold", reason: "Waiting for client" });
    expect(caseRequest.mock.calls[1][4]).toMatchObject({ version: 4, action: "resume" });
  });

  it("keeps viewers read-only", () => {
    view({ ...initial, canManageLifecycle: false });
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Project actions" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Client details" })).toBeVisible();
    expect(screen.getByText(/View only/)).toBeVisible();
  });


});
