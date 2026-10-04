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

const steps = [
  { stageId: "new", name: "New Opportunity", step: "new", state: "done", optional: false },
  { stageId: "qualified", name: "Qualified", step: "qualified", state: "current", optional: false },
  { stageId: "proposal", name: "Proposal", step: "proposal", state: "upcoming", optional: false },
  { stageId: "won", name: "Won", step: "won", state: "upcoming", optional: false },
];
const pipelines = { data: [{ id: "pipeline-1", name: "Sales", stages: [
  { id: "new", name: "New Opportunity", code: "qualified", status: "active" }, { id: "qualified", name: "Qualified", code: "qualification", status: "active" },
  { id: "proposal", name: "Proposal", code: "proposal", status: "active" }, { id: "won", name: "Won", code: "won", status: "active" }, { id: "lost", name: "Lost", code: "lost", status: "active" },
] }] };

describe("CRM opportunity workbench", () => {
  it("shows one header, one Now card, one progress line and three tabs — no Won button", async () => {
    const record = { id: "opportunity-1", title: "Villa renovation", status: "open", version: 3, pipelineId: "pipeline-1", stageId: "qualified", stageName: "Qualified", leadId: "lead-1", partyId: "party-1", partyName: "Aisha", ownerMembershipId: "m1", ownerName: "Dana",
      flow: { flow: "design", steps, done: 1, total: 4, next: { stageId: "proposal", name: "Proposal", step: "proposal" }, missing: [{ key: "discovery:area", label: "Area" }], toWon: [{ key: "discovery:area", label: "Area" }, { key: "paymentProof", label: "Payment proof attached" }], proofs: [], furniture: null, clientApproval: null, negotiationOptional: false } };
    vi.mocked(crmRequest).mockImplementation(async (_w, path) => path === "opportunities/opportunity-1" ? record : path === "pipelines" ? pipelines : { data: [] });
    render(<DesignSystemProvider><CrmRecordWorkbench id="opportunities" workspaceId="workspace-1" onChanged={vi.fn()} row={record} /></DesignSystemProvider>);
    const now = await screen.findByRole("region", { name: "Fill in the property details" });
    expect(within(now).getByText("Needed to move to Proposal")).toBeInTheDocument();
    expect(within(now).getByRole("button", { name: "Fill in details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Villa renovation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aisha" })).toHaveAttribute("href", "/workspace/crm/customers?record=party-1");
    expect(within(screen.getByRole("list", { name: "Progress" })).getAllByRole("listitem").map((item) => item.getAttribute("data-state"))).toEqual(["done", "current", "upcoming", "upcoming"]);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Details", "Activity", "Files"]);
    for (const name of ["Change stage", "Progress"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    // "Won" is only a dot on the progress line, never a button of its own.
    expect(screen.getAllByRole("button", { name: /^Won$/ }).every((button) => button.closest("ol")?.getAttribute("aria-label") === "Progress")).toBe(true);
    expect(screen.queryByRole("list", { name: "Where this opportunity is" })).not.toBeInTheDocument();
    expect(screen.getByText("Then: Move to Proposal · Attach payment proof")).toBeInTheDocument();
  });

  it("keeps Lost, backward stage changes and history in the ⋯ menu", async () => {
    const record = { id: "opportunity-2", title: "Office", status: "open", version: 2, pipelineId: "pipeline-1", stageId: "qualified", stageName: "Qualified", partyName: "Client",
      stageHistory: [{ id: "h1", fromStageId: "new", fromStageName: "New Opportunity", toStageId: "qualified", toStageName: "Qualified", toStatus: "open", reason: "Brief agreed", changedAt: "2026-10-01T08:00:00.000Z" }] };
    vi.mocked(crmRequest).mockImplementation(async (_w, path) => path === `opportunities/${record.id}` ? record : path === "pipelines" ? pipelines : { data: [] });
    const user = userEvent.setup();
    render(<DesignSystemProvider><CrmRecordWorkbench id="opportunities" workspaceId="workspace-1" onChanged={vi.fn()} row={record} /></DesignSystemProvider>);
    await waitFor(() => expect(crmRequest).toHaveBeenCalledWith("workspace-1", "pipelines", "GET", undefined, expect.anything()));
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["Mark as lost", "Change stage", "History"]);
    await user.click(screen.getByRole("menuitem", { name: "Change stage" }));
    const dialog = await screen.findByRole("dialog", { name: "Change stage" });
    await user.click(within(dialog).getByRole("button", { name: /Stage/ }));
    // Only the stages behind the current one.
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["New Opportunity"]);
  });

  it("marks Won from the Now card once a verified payment stands for the proof", async () => {
    const record = { id: "opportunity-3", title: "Villa renovation", version: 4, status: "open", pipelineId: "pipeline-1", stageId: "proposal", partyName: "Client", ownerName: "Sales owner",
      flow: { flow: "design", toWon: [], steps, missing: [], proofs: [], done: 2, total: 4, next: { stageId: "won", name: "Won", step: "won" } } };
    vi.mocked(crmRequest).mockImplementation(async (_workspace, path, method) => {
      if (method === "POST") return { ...record, version: 5, status: "won", stageId: "won" };
      if (path === "pipelines") return pipelines;
      if (path === `opportunities/${record.id}`) return record;
      return { data: [] };
    });
    const user = userEvent.setup();
    render(<DesignSystemProvider><CrmRecordWorkbench id="opportunities" workspaceId="workspace-1" onChanged={vi.fn()} row={record} /></DesignSystemProvider>);
    const now = await screen.findByRole("region", { name: "Mark it Won" });
    await waitFor(() => expect(crmRequest).toHaveBeenCalledWith("workspace-1", "pipelines", "GET", undefined, expect.anything()));
    await user.click(within(now).getByRole("button", { name: "Mark Won" }));
    const dialog = await screen.findByRole("dialog", { name: "Mark opportunity Won" });
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
    const card = await screen.findByRole("region", { name: "Attach payment proof" });
    await user.click(within(card).getByRole("button", { name: "Attach proof" }));
    expect(await screen.findByRole("dialog", { name: "Attach payment proof" })).toBeInTheDocument();
    // The A–E sub-path stays reachable from Details.
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    await user.click(await screen.findByRole("button", { name: "Change" }));
    expect(await screen.findByRole("dialog", { name: "Furniture sub-path" })).toBeInTheDocument();
  });

  it("edits the value in place and reassigns the owner with the opportunity's version", async () => {
    const record = { id: "opportunity-4", title: "Villa renovation", version: 7, status: "open", amount: "250000.00", currencyCode: "AED", ownerMembershipId: "m1", ownerName: "Dana", partyName: "Client",
      flow: { flow: "basic", toWon: [{ key: "paymentProof", label: "Payment proof attached" }], missing: [{ key: "paymentProof", label: "Payment proof attached" }], steps: [], proofs: [], done: 0, total: 2, next: { stageId: "won", name: "Won", step: "won" } } };
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
    await user.click(await screen.findByRole("button", { name: "Reassign" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Reassign" })).getByRole("button", { name: /Omar/ }));
    // The next change carries the version the last save returned.
    await waitFor(() => expect(crmRequest).toHaveBeenCalledWith("workspace-1", `opportunities/${record.id}`, "PATCH", { version: 8, ownerMembershipId: "m2" }));
  });
});
