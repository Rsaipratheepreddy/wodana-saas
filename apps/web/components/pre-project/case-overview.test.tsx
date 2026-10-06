import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PreProjectCase } from "@/lib/pre-project/types";
import type { CommercialState } from "@/lib/commercial/types";
import type { JourneyView } from "@/lib/pre-project/design-workspace";
import { CaseOverview } from "./case-overview";

const { caseRequest, commands } = vi.hoisted(() => ({ caseRequest: vi.fn(), commands: [] as unknown[] }));
vi.mock("@/lib/pre-project/content", () => ({ caseRequest, caseApi: (_w: string, caseId: string, path: string) => `/api/workspace/pre-projects/${caseId}/${path}` }));
vi.mock("./design-journey", () => ({ DesignJourney: () => null }));

const initial: PreProjectCase = {
  id: "case-1", title: "Villa interiors", description: null, status: "active",
  customerId: "customer-1", customerName: "Palm client", opportunityId: "opportunity-1",
  opportunityStatus: "open", leadId: "lead-1", leadManagerName: "Manager", amount: null,
  currencyCode: "AED", createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z",
  phase: "define", version: 3, ownerMembershipId: "owner-1", engagementOwnerName: "Owner",
  targetDate: null, priority: "normal", riskLevel: "low", activatedAt: "2026-09-17T00:00:00Z",
  holdReason: null, cancellationReason: null, releasedAt: null, canManageLifecycle: true,
  reference: "D-0007", enquiryTypeName: "Fit-out", salesMembershipId: "owner-2",
};
const journey: JourneyView = { journey: null, stages: [], canStart: false, timezone: "Asia/Dubai" };

const members = [{ id: "owner-1", displayName: "Owner", email: "owner@example.test" }, { id: "owner-2", displayName: "Designer", email: "designer@example.test" }];
function view(record = initial, commercial?: CommercialState) {
  const onUpdated = vi.fn();
  render(<DesignSystemProvider><CaseOverview record={record} workspaceId="workspace-1" members={members} commercial={commercial} onUpdated={onUpdated} /></DesignSystemProvider>);
  return onUpdated;
}
/** The journey read answers by itself; every other request takes the next queued answer. */
function answer(...values: unknown[]) {
  const queue = [...values];
  caseRequest.mockImplementation(async (_w: string, _c: string, path: string, _m?: string, body?: unknown) => {
    if (path === "design-journey") return journey;
    commands.push(body);
    return queue.shift();
  });
}
const commandsSent = () => caseRequest.mock.calls.filter(([, , path]) => path !== "design-journey");
afterEach(() => { caseRequest.mockReset(); commands.length = 0; });

describe("planning case overview", () => {
  it("shows the case as a record: one title, where it stands, the next step and the stages", async () => {
    answer();
    view();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "Villa interiors" })).toBeVisible();
    const header = screen.getByRole("heading", { level: 2 }).closest("header")!;
    expect(header).toHaveTextContent("Palm client");
    expect(header).toHaveTextContent("D-0007");
    expect(header).toHaveTextContent("Fit-out");
    const strip = screen.getByLabelText("Where the case stands");
    expect(strip).toHaveTextContent("Scope confirmation · 2 of 6");
    // Defining the scope is next; it opens where it's done.
    expect(await screen.findByRole("heading", { level: 3, name: "Confirm the scope" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open the scope" })).toHaveAttribute("href", "/workspace/pre-projects/cases/case-1/definition");
    expect(within(screen.getByRole("list", { name: "Stages" })).getAllByRole("listitem")).toHaveLength(6);
    // Team: the sales owner and the case owner, each with email.
    expect(screen.getByRole("link", { name: "Email Designer" })).toHaveAttribute("href", "mailto:designer@example.test");
  });

  it("changes ownership and risk in place from Details, each with the current version", async () => {
    answer(
      { ...initial, version: 4, ownerMembershipId: "owner-2", engagementOwnerName: "Designer" },
      { ...initial, version: 5, ownerMembershipId: "owner-2", engagementOwnerName: "Designer", riskLevel: "medium" },
    );
    const updated = view();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Details" }));
    await user.click(await screen.findByRole("button", { name: "Edit Owner" }));
    await user.click(await screen.findByRole("option", { name: "Designer" }));
    await waitFor(() => expect(caseRequest).toHaveBeenCalledWith("workspace-1", "case-1", "profile", "PATCH", expect.objectContaining({ version: 3, ownerMembershipId: "owner-2", priority: "normal", riskLevel: "low", requestId: expect.any(String) })));
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ version: 4, canManageLifecycle: true }));
    await user.click(await screen.findByRole("button", { name: "Edit Risk" }));
    await user.click(await screen.findByRole("option", { name: "Medium" }));
    await waitFor(() => expect(caseRequest).toHaveBeenLastCalledWith("workspace-1", "case-1", "profile", "PATCH", expect.objectContaining({ version: 4, riskLevel: "medium" })));
  });

  it("requires a reason for hold and resumes from the next step against the new version", async () => {
    answer(
      { ...initial, status: "on_hold", version: 4, holdReason: "Waiting for client" },
      { ...initial, status: "active", version: 5, holdReason: null },
    );
    view();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Project actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Put on hold" }));
    const dialog = screen.getByRole("dialog", { name: "Put on hold" });
    await user.type(within(dialog).getByLabelText("Reason"), "Waiting for client");
    await user.click(within(dialog).getByRole("button", { name: "Put on hold" }));
    // On hold, the next step says why and offers Resume.
    expect(await screen.findByRole("heading", { level: 3, name: "On hold" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    await user.click(within(screen.getByRole("dialog", { name: "Resume" })).getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(commandsSent()).toHaveLength(2));
    expect(commandsSent()[0][4]).toMatchObject({ version: 3, action: "hold", reason: "Waiting for client" });
    expect(commandsSent()[1][4]).toMatchObject({ version: 4, action: "resume" });
  });

  it("keeps viewers read-only", async () => {
    answer();
    view({ ...initial, canManageLifecycle: false });
    expect(screen.queryByRole("button", { name: "Project actions" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.queryByRole("button", { name: "Edit Owner" })).not.toBeInTheDocument();
  });

  it("lets the case owner change its details without the case-management permission", async () => {
    answer();
    view({ ...initial, canManageLifecycle: false, canEditDetails: true });
    expect(screen.queryByRole("button", { name: "Project actions" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(await screen.findByRole("button", { name: "Edit Owner" })).toBeInTheDocument();
  });
});
