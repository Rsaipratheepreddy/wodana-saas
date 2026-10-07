import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { crmScreenFixture } from "@/lib/crm/screens";
import { crmRequest } from "@/lib/crm/client";
import { CrmOpportunities } from "./crm-opportunities";

vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));

describe("CrmOpportunities", () => {
  it("starts an empty workspace from enquiries without pipeline setup", async () => {
    const data = structuredClone(crmScreenFixture("opportunities"));
    data.items = [];
    data.supporting.pipelines = [];
    render(<CrmOpportunities initialData={data} />);
    expect(screen.getByText("Your pipeline starts with an enquiry")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pipeline settings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New deal" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Convert enquiry" }));
    expect(push).toHaveBeenCalledWith("/workspace/crm/leads");
    await userEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("searchbox", { name: "Search opportunities" })).toHaveLength(1);
  });

  it("persists a dropped opportunity with the latest version and leaves it in place on failure", async () => {
    const data = structuredClone(crmScreenFixture("opportunities"));
    const record = data.items[0];
    const pipeline = (data.supporting.pipelines as {id:string; stages:{id:string;name:string}[]}[])[0];
    const target = pipeline.stages.find(stage => stage.id !== record.stageId)!;
    const api = vi.mocked(crmRequest);
    api.mockImplementation(async (_workspace, path, method) => {
      if (method === "POST") throw new Error("Stage requirement not met");
      return { ...record, version: 7 };
    });
    render(<CrmOpportunities initialData={data} />);
    const card = screen.getByRole("button", { name: /Emirates Hills villa interior renovation/ });
    const transfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.dragOver(screen.getByRole("region", { name: target.name }), { dataTransfer: transfer });
    fireEvent.drop(screen.getByRole("region", { name: target.name }), { dataTransfer: transfer });
    await screen.findByText("Stage requirement not met");
    expect(api).toHaveBeenCalledWith(data.workspaceId, `opportunities/${record.id}/transition`, "POST", { version: 7, stageId: target.id, status: "open" });
    expect(within(screen.getByRole("region", { name: String(record.stageName) })).getByRole("button", { name: /Emirates Hills villa interior renovation/ })).toBeInTheDocument();
    api.mockImplementation(async () => ({ ...record, version: 8, stageId: target.id }));
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.drop(screen.getByRole("region", { name: target.name }), { dataTransfer: transfer });
    await screen.findByText(`${record.title} moved to ${target.name}.`);
    expect(within(screen.getByRole("region", { name: target.name })).getByRole("button", { name: /Emirates Hills villa interior renovation/ })).toBeInTheDocument();
  });

  it("shows every opportunity with its backend pipeline and stage", async () => {
    render(<CrmOpportunities initialData={structuredClone(crmScreenFixture("opportunities"))} />);

    expect(screen.getByLabelText("Sales pipeline board")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New deal" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Convert enquiry" }));
    expect(push).toHaveBeenCalledWith("/workspace/crm/leads");
    await userEvent.click(screen.getByRole("button", { name: "List" }));
    const table = screen.getByRole("table", { name: "Opportunities" });
    expect(table).toBeInTheDocument();
    // The reference is on the muted line under the opportunity, not a column of its own.
    expect(within(table).queryByRole("columnheader", { name: "Opportunity ID" })).not.toBeInTheDocument();
    expect(within(table).getByText(/D-0001/)).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Emirates Hills villa interior renovation/ })).getByText("Proposal")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /DIFC executive office fit-out/ })).getByText("Negotiation")).toBeInTheDocument();
  });

  it("does not hide an opportunity when its stage is missing or inactive", async () => {
    const data = structuredClone(crmScreenFixture("opportunities"));
    data.items.push({ id: "orphan", title: "New commercial brief", partyName: "Layla Omar", pipelineName: "Design & build sales", stageId: "inactive-stage", status: "open" });
    render(<CrmOpportunities initialData={data} />);

    expect(screen.getByText("Needs a stage")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("row", { name: /New commercial brief/ }).querySelector('[data-column="stage"]')).toHaveTextContent("Not set");
  });

  it("flags a legacy opportunity whose Won stage still has an open status", () => {
    const data = structuredClone(crmScreenFixture("opportunities"));
    const pipeline = (data.supporting.pipelines as { stages: { id: string; name: string; code?: string; status: string; position: number }[] }[])[0];
    pipeline.stages.push({ id: "won-stage", name: "Won", code: "won", status: "active", position: 3 });
    data.items[0].stageId = "won-stage";
    data.items[0].stageName = "Won";
    render(<CrmOpportunities initialData={data} />);

    expect(within(screen.getByRole("region", { name: "Won" })).getByText("Status is open. Review the outcome.")).toBeInTheDocument();
  });

  it("loads additional backend cursor pages", async () => {
    const user = userEvent.setup();
    const data = structuredClone(crmScreenFixture("opportunities"));
    data.nextCursor = "page-2";
    vi.mocked(crmRequest).mockImplementation(async (_workspaceId, path) => path === "pipelines"
      ? { data: data.supporting.pipelines }
      : { data: [{ id: "new-opportunity", title: "Marina renovation", partyName: "Layla Omar", pipelineName: "Design & build sales", status: "open" }], nextCursor: null });
    render(<CrmOpportunities initialData={data} />);

    await user.click(screen.getByRole("button", { name: "Load more opportunities" }));
    await waitFor(() => expect(screen.getByText("Marina renovation")).toBeInTheDocument());
    expect(crmRequest).toHaveBeenCalledWith(data.workspaceId, "opportunities?limit=100&cursor=page-2");
    expect(screen.queryByRole("button", { name: "Load more opportunities" })).not.toBeInTheDocument();
  });
  it("opens card details in a modal and starts the exact opportunity case", async () => {
    const data = structuredClone(crmScreenFixture("opportunities"));
    const record = data.items[0];
    vi.mocked(crmRequest).mockImplementation(async (_workspace, path) => path === `opportunities/${record.id}` ? { ...record, version: 1, funnel: [{ key: "enquiry", state: "done", detail: "E-1", at: null }, { key: "discovery", state: "current", detail: null, at: null }, { key: "intro", state: "upcoming", detail: null, at: null }, { key: "design", state: "upcoming", detail: null, at: null }, { key: "quote", state: "upcoming", detail: null, at: null }, { key: "deal", state: "upcoming", detail: null, at: null }] } : path === "pipelines" ? data.supporting.pipelines : { data: [] });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "exact-case" }) });
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<CrmOpportunities initialData={data} />);
    await user.click(screen.getByRole("button", { name: /Emirates Hills villa interior renovation/ }));
    const dialog = await screen.findByRole("dialog", { name: "Opportunity details" });
    expect(dialog.closest(".wd-modal")?.className).toContain("opportunityModal");
    expect(within(dialog).queryByRole("heading", { name: "Opportunity details" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
    expect(await within(dialog).findByRole("heading", { name: String(record.title) })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Details" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Start Planning" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining("/cases/exact-case/overview")));
    const start = fetcher.mock.calls.find(([url, init]) => String(url).includes("/api/workspace/pre-projects") && init?.method === "POST");
    expect(JSON.parse(start![1].body)).toEqual({ opportunityId: record.id });
    vi.unstubAllGlobals();
  });

  it("asks for the payment proof when a card is dropped on Won without one (PLM-122)", async () => {
    const data = structuredClone(crmScreenFixture("opportunities"));
    const record = data.items[0];
    const pipeline = (data.supporting.pipelines as { id: string; stages: { id: string; name: string; code?: string; status: string; position: number }[] }[])[0];
    pipeline.stages.push({ id: "won-stage", name: "Won", code: "won", status: "active", position: 3 });
    const api = vi.mocked(crmRequest);
    api.mockImplementation(async () => ({ ...record, version: 7, flow: { toWon: [{ key: "furniturePath", label: "Furniture sub-path chosen" }, { key: "paymentProof", label: "Payment proof attached" }] } }));
    api.mockClear();
    render(<CrmOpportunities initialData={data} />);
    const card = within(screen.getByRole("region", { name: "Proposal" })).getByRole("button", { name: /Amira Al Mansoori/ });
    const transfer = { setData: vi.fn(), getData: () => record.id, effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.dragOver(screen.getByRole("region", { name: "Won" }), { dataTransfer: transfer });
    fireEvent.drop(screen.getByRole("region", { name: "Won" }), { dataTransfer: transfer });
    // Everything else Won needs comes first, each with its action; the card stays where it was.
    const dialog = await screen.findByRole("dialog", { name: "To move to Won" });
    expect(within(dialog).getByText("Choose how it's supplied")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Choose sub-path" })).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith(data.workspaceId, `opportunities/${record.id}/transition`, "POST", expect.anything());
    await userEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(screen.getByRole("region", { name: "Proposal" })).getByRole("button", { name: /Amira Al Mansoori/ })).toBeInTheDocument();
  });

  it("shows the client once and requires a reason before a Won drop", async () => {
    const data = structuredClone(crmScreenFixture("opportunities"));
    const record = data.items[0];
    record.title = String(record.reference);
    const pipeline = (data.supporting.pipelines as { id: string; stages: { id: string; name: string; code?: string; status: string; position: number }[] }[])[0];
    pipeline.stages.push({ id: "won-stage", name: "Won", code: "won", status: "active", position: 3 });
    const api = vi.mocked(crmRequest);
    api.mockImplementation(async (_workspace, _path, method) => method === "POST"
      ? { ...record, status: "won", stageId: "won-stage", version: 8 }
      : { ...record, version: 7, flow: { toWon: [] } });
    api.mockClear();
    render(<CrmOpportunities initialData={data} />);

    const card = within(screen.getByRole("region", { name: "Proposal" })).getByRole("button", { name: /Amira Al Mansoori/ });
    expect(within(card).getAllByText("Amira Al Mansoori")).toHaveLength(1);
    const transfer = { setData: vi.fn(), getData: () => record.id, effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.dragOver(screen.getByRole("region", { name: "Won" }), { dataTransfer: transfer });
    fireEvent.drop(screen.getByRole("region", { name: "Won" }), { dataTransfer: transfer });
    // A payment Finance already verified is the proof: only the reason is asked.
    const dialog = await screen.findByRole("dialog", { name: "Mark opportunity Won" });
    expect(within(dialog).getByRole("button", { name: "Confirm win" })).toBeDisabled();
    expect(api).not.toHaveBeenCalledWith(data.workspaceId, `opportunities/${record.id}/transition`, "POST", expect.anything());
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Signed agreement and deposit received");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm win" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(data.workspaceId, `opportunities/${record.id}/transition`, "POST", {
      version: 7, stageId: "won-stage", status: "won", reason: "Signed agreement and deposit received",
    }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Won" })).getByRole("button", { name: /Amira Al Mansoori/ })).toBeInTheDocument());
  });

  it("shows each open card's step now, its owner's avatar and its follow-up", async () => {
    const data = structuredClone(crmScreenFixture("opportunities"));
    const record = data.items[0];
    record.nextActionAt = "2020-01-02T09:00:00.000Z";
    vi.mocked(crmRequest).mockImplementation(async (_workspace, path) => path === `opportunities/${record.id}`
      ? { ...record, flow: { flow: "design", next: { stageId: "x", name: "Qualified", step: "qualified" }, missing: [{ key: "introMeeting", label: "Intro meeting completed" }], toWon: [], steps: [] } }
      : { ...record, id: String(path), flow: null });
    render(<CrmOpportunities initialData={data} />);
    const card = within(screen.getByRole("region", { name: "Proposal" })).getByRole("button", { name: /Amira Al Mansoori/ }).closest("article")!;
    expect(await within(card).findByText("Book intro")).toBeInTheDocument();
    expect(within(card).getByText(/Overdue/)).toBeInTheDocument();
    expect(within(card).getByText(String(record.ownerName))).toBeInTheDocument();
    expect(card.querySelector(".wd-avatar")).toHaveAttribute("aria-label", String(record.ownerName));
  });
});

it("has one title, one primary action, status tabs and the assignee as a removable chip", async () => {
  vi.mocked(crmRequest).mockReset().mockResolvedValue({ data: [] });
  const user = userEvent.setup();
  render(<CrmOpportunities initialData={structuredClone(crmScreenFixture("opportunities"))} />);
  expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Pipeline"]);
  expect(screen.getAllByRole("button", { name: "Convert enquiry" })).toHaveLength(1);
  expect(within(screen.getByRole("group", { name: "Opportunity status" })).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("group", { name: "Filters in use" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Filter" }));
  await user.click(screen.getByRole("menuitem", { name: "Unassigned" }));
  const chips = screen.getByRole("group", { name: "Filters in use" });
  expect(within(chips).getByText("Unassigned")).toBeVisible();
  await user.click(within(chips).getByRole("button", { name: "Remove filter Unassigned" }));
  expect(screen.queryByRole("group", { name: "Filters in use" })).not.toBeInTheDocument();
});
