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
const discovery = { version: 2, facts: { area: null, areaUnit: null, spaces: null, propertyLocation: "Marina", clientEmail: "aisha@example.com", floorPlanAssetId: "f1", designPackageId: null },
  designFee: null, package: null, enquiryType: "full_home", clientType: "homeowner", questions: [], answers: {}, files: [{ id: "f1", name: "plan.pdf", mimeType: "application/pdf" }], missing: [] };
const pipelines = { data: [{ id: "pipeline-1", name: "Sales", stages: [
  { id: "new", name: "New Opportunity", code: "qualified", status: "active" }, { id: "qualified", name: "Qualified", code: "qualification", status: "active" },
  { id: "proposal", name: "Proposal", code: "proposal", status: "active" }, { id: "won", name: "Won", code: "won", status: "active" }, { id: "lost", name: "Lost", code: "lost", status: "active" },
] }] };

describe("CRM opportunity workbench", () => {
  it("shows the header, the progress line and everything the next column needs, with Overview · Details · Files in the sidebar", async () => {
    const record = { id: "opportunity-1", title: "Villa renovation", status: "open", version: 3, pipelineId: "pipeline-1", stageId: "qualified", stageName: "Qualified", leadId: "lead-1", partyId: "party-1", partyName: "Aisha", ownerMembershipId: "m1", ownerName: "Dana",
      funnel: [{ key: "enquiry", state: "done", detail: "E-0042", at: null }],
      flow: { flow: "design", steps, done: 1, total: 4, next: { stageId: "proposal", name: "Proposal", step: "proposal" }, missing: [{ key: "discovery:area", label: "Area" }], toWon: [{ key: "discovery:area", label: "Area" }, { key: "paymentProof", label: "Payment proof attached" }], proofs: [], furniture: null, clientApproval: null, negotiationOptional: false } };
    vi.mocked(crmRequest).mockImplementation(async (_w, path) => path === "opportunities/opportunity-1" ? record : path === "pipelines" ? pipelines
      : path === "opportunities/opportunity-1/discovery" ? discovery : path === "parties/party-1" ? { id: "party-1", contacts: [{ type: "phone", value: "+971501234567", isPrimary: true }, { type: "email", value: "aisha@example.com", isPrimary: true }] } : { data: [] });
    const user = userEvent.setup();
    render(<DesignSystemProvider><CrmRecordWorkbench id="opportunities" workspaceId="workspace-1" onChanged={vi.fn()} row={record} /></DesignSystemProvider>);
    const next = await screen.findByRole("region", { name: "To move to Proposal" });
    expect(within(next).getByText("Proposal means we have everything to price the work.")).toBeInTheDocument();
    expect(within(next).getByRole("button", { name: "Add · Area" })).toHaveAttribute("data-variant", "primary");
    // One title: the page owns the h1, the record's own title is its only h2.
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Villa renovation"]);
    expect(screen.getAllByRole("link", { name: "Aisha" })[0]).toHaveAttribute("href", "/workspace/crm/customers?record=party-1");
    expect(within(screen.getByRole("list", { name: "Progress" })).getAllByRole("listitem").map((item) => item.getAttribute("data-state"))).toEqual(["done", "current", "upcoming", "upcoming"]);
    for (const name of ["Change stage", "Progress"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    // "Won" is only a dot on the progress line, never a button of its own.
    expect(screen.getAllByRole("button", { name: /^Won$/ }).every((button) => button.closest("ol")?.getAttribute("aria-label") === "Progress")).toBe(true);
    expect(screen.getByText("Then: Attach payment proof")).toBeInTheDocument();
    // Beside the work: the sidebar's tabs; Overview has the key facts, the client's contact (call, WhatsApp, email) and the links.
    const side = screen.getByRole("complementary", { name: "Key facts" });
    expect(within(side).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Overview", "Details", "Files"]);
    expect(within(next).queryByRole("tab")).not.toBeInTheDocument();
    expect(await within(side).findByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/971501234567");
    expect(within(side).getByRole("link", { name: "Email" })).toHaveAttribute("href", "mailto:aisha@example.com");
    expect(within(side).getByRole("link", { name: "E-0042" })).toHaveAttribute("href", "/workspace/crm/leads?lead=lead-1");
    // Details: the group the next column needs is unfolded; the others fold away with how complete they are.
    await user.click(within(side).getByRole("tab", { name: "Details" }));
    expect(await within(side).findByRole("button", { name: /Property.*3 of 4/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(side).getByRole("button", { name: /Client.*2 of 2/ })).toHaveAttribute("aria-expanded", "false");
    // Add opens the property details in a side sheet; Save closes it.
    await user.click(within(next).getByRole("button", { name: "Add · Area" }));
    const sheet = await screen.findByRole("dialog", { name: "Property details" });
    await user.type(within(sheet).getByRole("textbox", { name: "Area" }), "1200");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(crmRequest).toHaveBeenCalledWith("workspace-1", "opportunities/opportunity-1/discovery", "PUT", expect.objectContaining({ version: 2, area: "1200", clientEmail: "aisha@example.com" })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Property details" })).not.toBeInTheDocument());
    // Edit on a Details card opens the same sheet.
    await user.click(within(within(side).getByRole("region", { name: "Property" })).getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("dialog", { name: "Property details" })).toBeInTheDocument();
  });

  it("leads the action card with the pending follow-up and keeps the activity in the sidebar", async () => {
    const record = { id: "opportunity-3", title: "Penthouse", status: "open", version: 4, pipelineId: "pipeline-1", stageId: "qualified", stageName: "Qualified", partyId: "party-3", partyName: "Yusuf Haddad", ownerMembershipId: "m1", ownerName: "Amal Staff",
      nextActionAt: "2020-09-30T09:00:00.000Z",
      flow: { flow: "design", steps, done: 1, total: 4, next: { stageId: "proposal", name: "Proposal", step: "proposal" }, missing: [{ key: "discovery:area", label: "Area" }], toWon: [], proofs: [], furniture: null, clientApproval: null, negotiationOptional: false } };
    const activities = [
      { id: "a1", type: "meeting", title: "Site visit", status: "completed", completedAt: "2020-09-20T09:00:00.000Z", version: 2 },
      { id: "a2", type: "task", title: "Follow up on opportunity", status: "pending", dueAt: "2020-09-30T09:00:00.000Z", isNextAction: true, version: 1 },
      ...Array.from({ length: 6 }, (_, index) => ({ id: `n${index}`, type: "note", title: `Note ${index + 1}`, status: "completed", completedAt: `2020-09-0${index + 1}T09:00:00.000Z`, version: 1 })),
    ];
    vi.mocked(crmRequest).mockImplementation(async (_w, path) => path === `opportunities/${record.id}` ? record : path === "pipelines" ? pipelines
      : String(path).startsWith("activities?") ? { data: activities } : { data: [] });
    const user = userEvent.setup();
    render(<DesignSystemProvider><CrmRecordWorkbench id="opportunities" workspaceId="workspace-1" onChanged={vi.fn()} row={record} /></DesignSystemProvider>);
    const next = await screen.findByRole("region", { name: "To move to Proposal" });
    // The follow-up is a row of its own above the checklist, never a chip beside the owner.
    // It names the client (the opportunity's party), never the sales owner.
    expect(await within(next).findByText("Follow up with Yusuf")).toBeInTheDocument();
    expect(within(next).queryByText("Follow up with Amal")).not.toBeInTheDocument();
    expect(within(next).getAllByText(/^Overdue · /)).toHaveLength(1);
    const side = screen.getByRole("complementary", { name: "Key facts" });
    expect(within(side).queryByText("Next follow-up")).not.toBeInTheDocument();
    expect(within(side).queryByText("Latest activity")).not.toBeInTheDocument();
    // The sidebar's Activity: pending first, then newest first; six rows until Show all.
    const timeline = within(side).getByRole("region", { name: "Activity" });
    const shown = () => within(timeline).getAllByRole("listitem").map((item) => item.textContent);
    expect(shown()).toHaveLength(6);
    expect(shown()[0]).toMatch(/^Follow up on opportunity/);
    expect(shown()[1]).toMatch(/^Site visit/);
    await user.click(within(timeline).getByRole("button", { name: "Show all" }));
    expect(shown()).toHaveLength(8);
    // The row's actions are buttons with their icons at the row's end: Reschedule (quiet), then Complete, its clear action.
    const reschedule = within(next).getByRole("button", { name: "Reschedule" });
    const done = within(next).getByRole("button", { name: "Complete" });
    expect(reschedule).toHaveAttribute("data-variant", "quiet");
    expect(reschedule.querySelector("svg")).not.toBeNull();
    expect(done).toHaveAttribute("data-variant", "secondary");
    expect(reschedule.parentElement).toBe(done.parentElement);
    expect(reschedule.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Key facts: label and value on one row; a missing value reads muted, the owner as a person chip.
    const facts = within(side).getByRole("region", { name: "Key facts" }).querySelector("dl")!;
    expect(facts).not.toHaveAttribute("data-layout", "stacked");
    expect(within(facts).getByText("Amal Staff")).toBeInTheDocument();
    expect(within(facts).getAllByText("Not set").every((item) => item.classList.contains("wd-editable-empty"))).toBe(true);
    // Complete in the card opens the same dialog as the timeline's.
    await user.click(done);
    expect(await screen.findByRole("dialog", { name: "Complete activity" })).toBeInTheDocument();
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
    const now = await screen.findByRole("region", { name: "To move to Won" });
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
    const card = await screen.findByRole("region", { name: "To move to Won" });
    await user.click(within(card).getByRole("button", { name: "Attach · Payment proof attached" }));
    expect(await screen.findByRole("dialog", { name: "Attach payment proof" })).toBeInTheDocument();
    // The A–E sub-path stays reachable from its Supply card.
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    await user.click(screen.getByRole("tab", { name: "Details" }));
    await user.click(await screen.findByRole("button", { name: /Supply/ }));
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
    // The owner is a chip on the card's title row; it opens Reassign.
    await user.click(await screen.findByRole("button", { name: /^Dana\s*· Reassign$/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Reassign" })).getByRole("button", { name: /Omar/ }));
    // The next change carries the version the last save returned.
    await waitFor(() => expect(crmRequest).toHaveBeenCalledWith("workspace-1", `opportunities/${record.id}`, "PATCH", { version: 8, ownerMembershipId: "m2" }));
  });
});
