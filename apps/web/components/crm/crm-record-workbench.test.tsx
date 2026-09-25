import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { CrmRecordWorkbench } from "./crm-record-workbench";

vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));

vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => vi.mocked(crmRequest).mockReset());

describe("CRM opportunity workbench", () => {
  it("shows the immutable enquiry decision without replacing it with current form data", async () => {
    vi.mocked(crmRequest).mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    render(<DesignSystemProvider><CrmRecordWorkbench
      id="opportunities"
      workspaceId="workspace-1"
      onChanged={vi.fn()}
      row={{
        id: "opportunity-1",
        title: "Villa renovation",
        leadId: "lead-1",
        status: "open",
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
      }}
    /></DesignSystemProvider>);

    await user.click(screen.getByRole("tab", { name: "Qualification" }));
    expect(screen.getByText("This is the enquiry information captured when this opportunity was created. Later enquiry edits do not change this snapshot.")).toBeVisible();
    expect(screen.getByText("Palm enquiry")).toBeVisible();
    expect(screen.getByText("Property type")).toBeVisible();
    expect(screen.getByText("Villa")).toBeVisible();
  });

  it("does not invent qualification history for a direct opportunity", async () => {
    vi.mocked(crmRequest).mockResolvedValue({ data: [] });
    render(<DesignSystemProvider><CrmRecordWorkbench id="opportunities" workspaceId="workspace-1" onChanged={vi.fn()} row={{ id: "opportunity-2", title: "Direct opportunity", status: "open" }} /></DesignSystemProvider>);
    expect(screen.getByRole("tab", { name: "Details" })).toBeVisible();
    expect(screen.getByText("Opportunity value").parentElement).toHaveAttribute("data-empty", "true");
    for (const name of ["Edit details", "Change stage", "Mark Won", "Mark Lost"]) {
      expect(screen.getByRole("button", { name }).querySelector("svg")).toBeInTheDocument();
    }
    expect(screen.queryByRole("tab", { name: "Qualification" })).not.toBeInTheDocument();
    expect(screen.queryByText("No linked enquiry snapshot")).not.toBeInTheDocument();
  });

  it("links an approved Deal File back to its source opportunity", () => {
    vi.mocked(crmRequest).mockResolvedValue({ data: [] });
    render(<DesignSystemProvider><CrmRecordWorkbench id="opportunities" workspaceId="workspace-1" onChanged={vi.fn()} row={{
      id: "opportunity-4", title: "Villa renovation", status: "won", preProjectCaseId: "case-4", dealFileReference: "DF-2026-004",
    }} /></DesignSystemProvider>);
    expect(screen.getByRole("link", { name: "Open Deal File DF-2026-004" })).toHaveAttribute("href", "/workspace/pre-projects/cases/case-4/approvals");
  });

  it("derives the Won outcome from the selected stage instead of letting them disagree", async () => {
    const record = { id: "opportunity-3", title: "Villa renovation", version: 4, status: "open", pipelineId: "pipeline-1", stageId: "proposal", partyName: "Client", ownerName: "Sales owner" };
    vi.mocked(crmRequest).mockImplementation(async (_workspace, path, method) => {
      if (method === "POST") return { ...record, version: 5, status: "won", stageId: "won" };
      if (path === "pipelines") return { data: [{ id: "pipeline-1", name: "Sales", stages: [
        { id: "proposal", name: "Proposal", code: "proposal", status: "active" },
        { id: "won", name: "Won", code: "won", status: "active" },
      ] }] };
      if (path === `opportunities/${record.id}`) return record;
      return { data: [] };
    });
    const user = userEvent.setup();
    render(<DesignSystemProvider><CrmRecordWorkbench id="opportunities" workspaceId="workspace-1" onChanged={vi.fn()} row={record} /></DesignSystemProvider>);
    await screen.findByRole("button", { name: "Mark Won" });
    await user.click(screen.getByRole("button", { name: "Mark Won" }));
    const dialog = screen.getByRole("dialog", { name: "Mark opportunity Won" });
    expect(within(dialog).queryByText("Outcome")).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Win evidence and reference" }), "Signed agreement");
    await user.click(within(dialog).getByRole("button", { name: "Confirm win" }));

    await waitFor(() => expect(crmRequest).toHaveBeenCalledWith("workspace-1", `opportunities/${record.id}/transition`, "POST", {
      version: 4, stageId: "won", reason: "Signed agreement", status: "won",
    }));
  });
});
