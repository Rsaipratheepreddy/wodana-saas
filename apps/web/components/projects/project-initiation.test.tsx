import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectInitiation } from "./project-initiation";
import type { ProjectData, ProjectState } from "@/lib/projects/execution";

function fixture(): ProjectState {
  return {
    workspaceId: "workspace",
    id: "project",
    caseId: "case",
    name: "Villa",
    customer: "Customer",
    memberId: "manager",
    canManage: true,
    members: [{ id: "manager", name: "Manager" }, { id: "designer", name: "Designer" }],
    sites: [{ id: "site", name: "Villa site", address: "Dubai" }],
    data: {
      initiation: {
        status: "not_started",
        commercial: {
          quoteId: "quote", quoteHash: "hash", quoteNumber: 1,
          dealFileId: "deal", dealFileReference: "DF-001",
          agreementReference: "AGR-001", currency: "AED", value: 1000,
          paymentMilestones: [],
        },
        baseline: null, confirmedAt: "", confirmedById: "", confirmedByName: "", revisions: [],
      },
      roleAssignments: [], tasks: [], reports: [], materials: [], orders: [], workPackages: [],
    } as unknown as ProjectData,
  } as ProjectState;
}

describe("project initiation", () => {
  it("sends an operational charter with an assigned owner, role holders and linked site", async () => {
    const run = vi.fn().mockResolvedValue(true);
    render(<ProjectInitiation state={fixture()} busy={false} run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Set up project" }));
    fireEvent.change(screen.getByLabelText("Project owner"), { target: { value: "manager" } });
    fireEvent.click(screen.getByLabelText("Designer"));
    fireEvent.change(screen.getByLabelText("Site readiness"), { target: { value: "confirmed" } });
    fireEvent.click(screen.getByLabelText("Villa site"));
    fireEvent.change(screen.getByLabelText("Operational start"), { target: { value: "2026-09-18" } });
    fireEvent.change(screen.getByLabelText("Target completion"), { target: { value: "2026-10-18" } });
    fireEvent.change(screen.getByLabelText("Project objective"), { target: { value: "Complete the villa joinery" } });
    fireEvent.change(screen.getByLabelText("Client promise"), { target: { value: "Hand over the joinery by October" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm project setup" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("project_initiation", expect.objectContaining({
      initiation: expect.objectContaining({
        projectOwnerId: "manager",
        teamMemberIds: expect.arrayContaining(["manager", "designer"]),
        siteIds: ["site"],
        roleAssignments: [{ role: "project_manager", memberId: "manager" }],
      }),
    })));
  });

  it("requires a reason for a pre-planning revision and hides editing once planning starts", async () => {
    const state = fixture();
    state.data.initiation!.status = "confirmed";
    state.data.initiation!.baseline = {
      projectOwnerId: "manager", teamMemberIds: ["manager"], siteReadiness: "to_confirm", siteIds: [],
      objective: "Build the villa", clientPromise: "October handover", clientContactName: "",
      clientContactPhone: "", clientContactEmail: "", accessNotes: "",
      operationalStart: "2026-09-18", targetCompletion: "2026-10-18", handoverDate: "",
    };
    const run = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<ProjectInitiation state={state} busy={false} run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Revise setup" }));
    fireEvent.change(screen.getByLabelText("Reason for revision"), { target: { value: "Client changed access date" } });
    fireEvent.click(screen.getByRole("button", { name: "Save revised setup" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("revise_project_initiation", expect.objectContaining({ note: "Client changed access date" })));
    state.data.tasks.push({ id: "task" } as ProjectData["tasks"][number]);
    rerender(<ProjectInitiation state={state} busy={false} run={run} />);
    expect(screen.queryByRole("button", { name: "Revise setup" })).toBeNull();
    expect(screen.getByText(/Change the delivery plan through project change control/)).toBeTruthy();
  });

  it("does not expose mutation controls to a project viewer", () => {
    const state = fixture();
    state.canManage = false;
    render(<ProjectInitiation state={state} busy={false} run={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Set up project" })).toBeNull();
  });
});
