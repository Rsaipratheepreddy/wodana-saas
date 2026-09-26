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
  it("shows where the opportunity really is and offers the next step, with only working tabs", async () => {
    vi.mocked(crmRequest).mockImplementation(async (_w, path) => path === "opportunities/opportunity-1" ? { id: "opportunity-1", title: "Villa renovation", status: "open", leadId: "lead-1", partyId: "party-1", partyName: "Aisha", funnel: [
  { key: "enquiry", state: "done", detail: "E-7", at: null }, { key: "discovery", state: "done", detail: "Complete", at: null },
  { key: "intro", state: "current", detail: "Scheduled · Dana", at: null }, { key: "design", state: "upcoming", detail: null, at: null },
  { key: "quote", state: "upcoming", detail: null, at: null }, { key: "deal", state: "upcoming", detail: null, at: null },
] } : { data: [] });
    const user = userEvent.setup();
    render(<DesignSystemProvider><CrmRecordWorkbench id="opportunities" workspaceId="workspace-1" onChanged={vi.fn()} row={{ id: "opportunity-1", title: "Villa renovation", status: "open", leadId: "lead-1", partyId: "party-1", partyName: "Aisha" }} /></DesignSystemProvider>);
    const funnel = await screen.findByRole("list", { name: "Where this opportunity is" });
    expect(within(funnel).getAllByRole("listitem").map((item) => item.getAttribute("data-state"))).toEqual(["done", "done", "current", "upcoming", "upcoming", "upcoming"]);
    expect(within(funnel).getByText("Scheduled · Dana")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aisha" })).toHaveAttribute("href", "/workspace/crm/customers?record=party-1");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Progress", "Activity", "Files"]);
    expect(within(funnel).getByRole("button", { name: /Intro meeting/ })).toHaveAttribute("aria-current", "step");
    await user.click(within(funnel).getByRole("button", { name: /Quote/ }));
    expect(await screen.findByText("Planning hasn't started")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Planning" })).toBeInTheDocument();
  });

  it("shows a direct opportunity's enquiry step as done, not as work to do", async () => {
    const steps = [{ key: "enquiry", state: "done", detail: "Direct", at: null }, { key: "discovery", state: "current", detail: "6 to fill", at: null }, { key: "intro", state: "upcoming", detail: null, at: null }, { key: "design", state: "active", detail: "Inspiration", at: null }, { key: "quote", state: "upcoming", detail: null, at: null }, { key: "deal", state: "upcoming", detail: null, at: null }];
    vi.mocked(crmRequest).mockImplementation(async (_w, path) => path === "opportunities/opportunity-2" ? { id: "opportunity-2", title: "Direct", status: "open", funnel: steps } : { data: [] });
    const user = userEvent.setup();
    render(<DesignSystemProvider><CrmRecordWorkbench id="opportunities" workspaceId="workspace-1" onChanged={vi.fn()} row={{ id: "opportunity-2", title: "Direct", status: "open" }} /></DesignSystemProvider>);
    const funnel = await screen.findByRole("list", { name: "Where this opportunity is" });
    expect(within(funnel).getByRole("button", { name: /Discovery/ })).toHaveAttribute("aria-current", "step");
    expect(within(funnel).getAllByRole("listitem")[3]).toHaveAttribute("data-state", "active");
    await user.click(within(funnel).getByRole("button", { name: /Enquiry/ }));
    expect(screen.getByText("Opened directly")).toBeInTheDocument();
    expect(screen.getByText("Value").parentElement).toHaveAttribute("data-empty", "true");
    for (const name of ["Edit", "Won", "Lost"]) expect(screen.getByRole("button", { name }).querySelector("svg")).toBeInTheDocument();
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
    await screen.findByRole("button", { name: "Won" });
    await user.click(screen.getByRole("button", { name: "Won" }));
    const dialog = screen.getByRole("dialog", { name: "Mark opportunity Won" });
    expect(within(dialog).queryByText("Outcome")).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Win evidence and reference" }), "Signed agreement");
    await user.click(within(dialog).getByRole("button", { name: "Confirm win" }));

    await waitFor(() => expect(crmRequest).toHaveBeenCalledWith("workspace-1", `opportunities/${record.id}/transition`, "POST", {
      version: 4, stageId: "won", reason: "Signed agreement", status: "won",
    }));
  });
});
