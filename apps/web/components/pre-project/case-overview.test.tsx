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
  it("shows evidence-based preparation progress and the next safe action", () => {
    view(initial, {
      workspaceId: "workspace-1", caseId: "case-1",
      definition: { caseStatus: "active", draft: { sourceHash: "hash", readyToPublish: false, issues: [] }, current: null, history: [], confirmed: false, nextAction: "COMPLETE_DEFINITION", canPublish: false, canRecordClientDecision: false },
      readiness: { ready: false, summary: { includedItemCount: 2, readyItemCount: 1, blockerCount: 2, warningCount: 1 }, blockers: [
        { code: "measurement", label: "Verified measurement", detail: "Verify the wardrobe dimensions before pricing.", scopeItemId: "scope-1", action: { code: "VERIFY_MEASUREMENT", label: "Verify measurement", targetType: "scope_item", targetId: "scope-1" } },
        { code: "definition", label: "Client confirmation", detail: "Confirm the current scope with the client." },
      ] },
    });
    expect(screen.getByRole("heading", { name: "2 blockers before pricing" })).toBeVisible();
    expect(screen.getByText("1 of 2")).toBeVisible();
    expect(screen.getByRole("list", { name: "Pre-execution preparation path" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Verify measurement" })).toHaveAttribute("href", "/workspace/pre-projects/cases/case-1/requirements?tab=measurements");
    expect(screen.getByText("Verify the wardrobe dimensions before pricing.")).toBeVisible();
  });

  it("opens quotation work only after deterministic readiness passes", () => {
    view(initial, {
      workspaceId: "workspace-1", caseId: "case-1",
      definition: { caseStatus: "active", draft: { sourceHash: "hash", readyToPublish: true, issues: [] }, current: null, history: [], confirmed: true, nextAction: null, canPublish: false, canRecordClientDecision: false },
      readiness: { ready: true, summary: { includedItemCount: 2, readyItemCount: 2, blockerCount: 0, warningCount: 0 }, blockers: [] },
    });
    expect(screen.getByRole("heading", { name: "Ready to build the quotation" })).toBeVisible();
    expect(screen.getByText("Pricing ready")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open quotations" })).toHaveAttribute("href", "/workspace/pre-projects/cases/case-1/quotations");
  });

  it("continues the overview through agreement, change control, approvals and release", () => {
    const commercial = {
      workspaceId: "workspace-1", caseId: "case-1", title: "Villa interiors", customerName: "Palm client", currency: "AED",
      contacts: [], canEdit: true, canApprove: true, canVerifyFinance: true, canRelease: true, canManagePortal: true,
      portalSlug: "client", portalEnabled: false, testMode: true,
      data: { revision: 1, quotes: [], requests: [], agreement: null, payments: [], audit: [], release: null, ownerReview: null, dealFile: null, materialApprovals: [], credits: [] },
    } as CommercialState;
    view(initial, undefined, commercial);
    const journey = screen.getByRole("navigation", { name: "Pre-execution readiness timeline" });
    expect(within(journey).getByText("From accepted scope to execution release")).toBeVisible();
    expect(within(journey).getByText("1 of 7 release checks complete")).toBeVisible();
    expect(within(journey).getByRole("link", { name: /Agreement & payments/ })).toHaveAttribute("href", "/workspace/pre-projects/cases/case-1/contracts");
    expect(within(journey).getByRole("link", { name: /Change control/ })).toHaveAttribute("href", "/workspace/pre-projects/cases/case-1/variations");
    expect(within(journey).getByRole("link", { name: /Approvals & release/ })).toHaveAttribute("href", "/workspace/pre-projects/cases/case-1/execution-release");
  });

  it("does not offer a lifecycle action that a viewer cannot perform", () => {
    view({ ...initial, status: "on_hold", canManageLifecycle: false }, {
      workspaceId: "workspace-1", caseId: "case-1",
      definition: { caseStatus: "on_hold", draft: { sourceHash: "hash", readyToPublish: false, issues: [] }, current: null, history: [], confirmed: false, nextAction: "RESUME_ENGAGEMENT", canPublish: false, canRecordClientDecision: false },
      readiness: { ready: false, summary: { includedItemCount: 1, readyItemCount: 0, blockerCount: 1, warningCount: 0 }, blockers: [
        { code: "engagement", label: "Active engagement", detail: "Resume this pre-execution before pricing.", action: { code: "RESUME_ENGAGEMENT", label: "Resume engagement", targetType: "engagement", targetId: "case-1" } },
      ] },
    });
    expect(screen.queryByRole("link", { name: "Resume engagement" })).not.toBeInTheDocument();
    expect(screen.getByText("Ask a case manager to resume engagement.")).toBeVisible();
  });

  it("saves operational ownership and risk with the current version", async () => {
    caseRequest.mockResolvedValue({ ...initial, version: 4, ownerMembershipId: "owner-2", engagementOwnerName: "Designer", priority: "high", riskLevel: "medium" });
    const updated = view();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit case" }));
    await user.click(screen.getByRole("button", { name: /Case owner/ }));
    await user.click(screen.getByRole("option", { name: "Designer" }));
    await user.click(screen.getByRole("button", { name: /Priority/ }));
    await user.click(screen.getByRole("option", { name: "High" }));
    await user.click(screen.getByRole("button", { name: /Risk/ }));
    await user.click(screen.getByRole("option", { name: "Medium" }));
    await user.click(screen.getByRole("button", { name: "Save case" }));
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
    await user.click(screen.getByRole("button", { name: "Put on hold" }));
    const dialog = screen.getByRole("dialog", { name: "Put on hold" });
    await user.type(within(dialog).getByLabelText("Reason *"), "Waiting for client");
    await user.click(within(dialog).getByRole("button", { name: "Put on hold" }));
    await user.click(await screen.findByRole("button", { name: "Resume" }));
    await user.click(within(screen.getByRole("dialog", { name: "Resume" })).getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(caseRequest).toHaveBeenCalledTimes(2));
    expect(caseRequest.mock.calls[0][4]).toMatchObject({ version: 3, action: "hold", reason: "Waiting for client" });
    expect(caseRequest.mock.calls[1][4]).toMatchObject({ version: 4, action: "resume" });
  });

  it("keeps viewers read-only", () => {
    view({ ...initial, canManageLifecycle: false });
    expect(screen.queryByRole("button", { name: "Edit case" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Put on hold" })).not.toBeInTheDocument();
    expect(screen.getByText("Villa interiors")).toBeVisible();
  });

  it("shows the frozen CRM decision and linked source records", () => {
    view({
      ...initial,
      conversionOrigin: "lead_qualification",
      qualificationEvidenceHash: "frozen-hash",
      qualificationEvidence: {
        version: 1,
        leadId: "lead-1",
        serviceType: "interiors",
        selection: "service_specific",
        evaluatedAt: "2026-09-17T08:00:00.000Z",
        form: {
          id: "form-1",
          code: "palm",
          name: "Palm enquiry",
          version: 4,
          questions: [{ key: "property_type", label: "Property type", dataType: "select", required: true }],
        },
        answers: [{ questionKey: "property_type", value: "Villa" }],
      },
    });

    expect(screen.getByText("CRM handoff preserved")).toBeVisible();
    expect(screen.getByText("Palm enquiry")).toBeVisible();
    expect(screen.getByText("Property type")).toBeVisible();
    expect(screen.getByText("Villa")).toBeVisible();
    expect(screen.getByRole("link", { name: "Original enquiry" })).toHaveAttribute("href", "/workspace/crm/leads?lead=lead-1");
    expect(screen.getByRole("link", { name: "CRM opportunity" })).toHaveAttribute("href", "/workspace/crm/opportunities?record=opportunity-1");
  });
});
