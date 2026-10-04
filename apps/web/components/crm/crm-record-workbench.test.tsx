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
    // A payment Finance verified in Planning is the proof (PLM-122), so Won asks only for the reason.
    const record = { id: "opportunity-3", title: "Villa renovation", version: 4, status: "open", pipelineId: "pipeline-1", stageId: "proposal", partyName: "Client", ownerName: "Sales owner", flow: { toWon: [], steps: [], missing: [], proofs: [], done: 0, total: 0, next: null } };
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
    const dialog = await screen.findByRole("dialog", { name: "Mark opportunity Won" });
    expect(within(dialog).queryByText("Outcome")).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Win evidence and reference" }), "Signed agreement");
    await user.click(within(dialog).getByRole("button", { name: "Confirm win" }));

    await waitFor(() => expect(crmRequest).toHaveBeenCalledWith("workspace-1", `opportunities/${record.id}/transition`, "POST", {
      version: 4, stageId: "won", reason: "Signed agreement", status: "won",
    }));
  });
  it("asks for the payment proof when Won still needs one", async () => {
    const record = { id: "opportunity-5", title: "Sofa", version: 2, status: "open", pipelineId: "pipeline-1", stageId: "proposal", partyName: "Client", ownerName: "Sales owner",
      flow: { flow: "furniture", toWon: [{ key: "paymentProof", label: "Payment proof attached" }], missing: [{ key: "paymentProof", label: "Payment proof attached" }], steps: [], proofs: [], done: 2, total: 5,
        next: { stageId: "won", name: "Won", step: "won" }, furniture: { path: "take_home_now", feasibility: null, materialsChange: false }, clientApproval: null, negotiationOptional: true } };
    vi.mocked(crmRequest).mockImplementation(async (_workspace, path) => path === `opportunities/${record.id}` ? record : { data: [] });
    const user = userEvent.setup();
    render(<DesignSystemProvider><CrmRecordWorkbench id="opportunities" workspaceId="workspace-1" onChanged={vi.fn()} row={record} /></DesignSystemProvider>);
    const card = await screen.findByRole("region", { name: "Next step" });
    await user.click(within(card).getByRole("button", { name: "Attach payment proof" }));
    expect(await screen.findByRole("dialog", { name: "Attach payment proof" })).toBeInTheDocument();
  });

  it("edits the value, owner and expected close in place with the opportunity's version", async () => {
    const record = { id: "opportunity-4", title: "Villa renovation", version: 7, status: "open", amount: "250000.00", currencyCode: "AED", ownerMembershipId: "m1", ownerName: "Dana", partyName: "Client" };
    vi.mocked(crmRequest).mockImplementation(async (_workspace, path, method) => {
      if (method === "PATCH") return { ...record, version: 8 };
      if (path === "sales-owners") return { data: [{ id: "m1", displayName: "Dana" }, { id: "m2", displayName: "Omar" }] };
      if (path === `opportunities/${record.id}`) return record;
      return { data: [] };
    });
    const user = userEvent.setup();
    render(<DesignSystemProvider><CrmRecordWorkbench id="opportunities" workspaceId="workspace-1" onChanged={vi.fn()} row={record} /></DesignSystemProvider>);
    await user.click(await screen.findByRole("button", { name: "Edit Value" }));
    const value = screen.getByRole("textbox", { name: "Value" });
    await user.clear(value);
    await user.type(value, "275000{Enter}");
    await waitFor(() => expect(crmRequest).toHaveBeenCalledWith("workspace-1", `opportunities/${record.id}`, "PATCH", { version: 7, amount: 275000, currencyCode: "AED" }));
    await user.click(await screen.findByRole("button", { name: "Edit Sales owner" }));
    await user.click(await screen.findByRole("option", { name: "Omar" }));
    // The next change carries the version the last save returned.
    await waitFor(() => expect(crmRequest).toHaveBeenCalledWith("workspace-1", `opportunities/${record.id}`, "PATCH", { version: 8, ownerMembershipId: "m2" }));
  });
});
