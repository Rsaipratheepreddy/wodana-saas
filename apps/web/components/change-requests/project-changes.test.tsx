import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ChangeRecord as Record_, ProjectChangesView } from "@/lib/change-requests/project";
import { ChangeRecord } from "./change-record";
import { ProjectChanges } from "./project-changes";

const navigation = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useRouter: () => navigation, useSearchParams: () => search, usePathname: () => "/workspace/projects/p1/changes/c1" }));

const ID = "11111111-1111-4111-8111-111111111111";
const view = (overrides: Partial<ProjectChangesView> = {}): ProjectChangesView => ({
  changes: [
    { id: ID, reference: "CR-001", title: "Study wardrobe", reason: "client_request", status: "pricing", currency: "AED", value: "5251.05", days: 3, handoverBefore: "2031-11-06",
      handoverAfter: "2031-11-11", raisedByName: "Sam Site", raisedByClient: false, updatedAt: "2031-10-01T10:00:00Z", next: "submit", applyProblem: null },
    { id: "22222222-2222-4222-8222-222222222222", reference: "CR-002", title: "Less worktop", reason: "design_change", status: "applied", currency: "AED", value: "-840.00", days: 0,
      handoverBefore: null, handoverAfter: null, raisedByName: "Pia PM", raisedByClient: false, updatedAt: "2031-10-01T10:00:00Z", next: null, applyProblem: null },
  ],
  money: { currency: "AED", sealed: { label: "R1", net: "7200.00", tax: "360.00", total: "7560.00" }, variations: [], variationsTotal: "-840.00", variationsNet: "-800.00", agreed: "6720.00" },
  canRaise: true, projectOpen: true, ...overrides,
});

function mount(respond: (url: string, init?: RequestInit) => unknown) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => respond(url, init) }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => { vi.unstubAllGlobals(); navigation.push.mockReset(); search = new URLSearchParams(); });

describe("a project's changes (§6.20)", () => {
  it("lists each change with its status, value, days and next step, beside the sealed value and the variations", async () => {
    mount(() => view());
    render(<DesignSystemProvider><ProjectChanges workspaceId="w" projectId="p1" /></DesignSystemProvider>);
    const table = await screen.findByRole("grid", { name: "Changes" }).catch(() => screen.findByRole("table", { name: "Changes" }));
    expect(within(table).getByText("CR-001 · Study wardrobe")).toBeInTheDocument();
    expect(within(table).getByText("Client request · Sam Site")).toBeInTheDocument();
    expect(within(table).getByText("Pricing")).toBeInTheDocument();
    expect(within(table).getByText("+3 days")).toBeInTheDocument();
    expect(within(table).getByText("Send for approval")).toBeInTheDocument();
    expect(within(table).getByText("Applied")).toBeInTheDocument();
    expect(screen.getByText("Sealed R1")).toBeInTheDocument();
    expect(screen.getByText("Agreed value")).toBeInTheDocument();
    fireEvent.click(within(table).getByText("CR-001 · Study wardrobe"));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/workspace/projects/p1/changes/${ID}`));
  });

  it("QA-010: lists the changes without their value or the agreed value for someone who doesn't see them", async () => {
    mount(() => view({ canSeeValue: false, changes: view().changes.map((change) => ({ ...change, value: null })),
      money: { currency: "AED", sealed: null, variations: [], variationsTotal: null, variationsNet: null, agreed: null } }));
    render(<DesignSystemProvider><ProjectChanges workspaceId="w" projectId="p1" /></DesignSystemProvider>);
    const table = await screen.findByRole("grid", { name: "Changes" }).catch(() => screen.findByRole("table", { name: "Changes" }));
    expect(within(table).getByText("CR-001 · Study wardrobe")).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Value" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Agreed value|Not priced|AED/)).not.toBeInTheDocument();
  });

  it("offers one next action when there are none: raise a change (what, why, lines) and open it", async () => {
    const fetcher = mount((url, init) => (init?.method === "POST" ? { change: { id: ID } } : url.includes("/sources")
      ? { stages: [], rooms: [{ id: "r1", name: "Study" }], scope: [], catalog: [] } : view({ changes: [], money: { ...view().money, variationsTotal: "0.00", agreed: "7560.00" } })));
    render(<DesignSystemProvider><ProjectChanges workspaceId="w" projectId="p1" /></DesignSystemProvider>);
    expect(await screen.findByText("No changes yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Raise a change" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Name/ }), { target: { value: "Extra shelf" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add a line" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Line/ }), { target: { value: "Shelf" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Quantity/ }), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Raise" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body).toMatchObject({ title: "Extra shelf", reason: "client_request", lines: [{ source: "custom", action: "add", title: "Shelf", quantity: "2" }] });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/workspace/projects/p1/changes/${ID}`));
  });
});

const record = (overrides: Partial<Record_> = {}): Record_ => ({
  change: { id: ID, reference: "CR-001", title: "Study wardrobe", reason: "client_request", description: "Client asked on site.", status: "pricing", kind: "addition", currency: "AED", version: 4,
    raisedByName: "Sam Site", raisedByClient: false, createdAt: "2031-10-01T10:00:00Z", updatedAt: "2031-10-02T10:00:00Z", decidedAt: null, decidedByName: null, decisionMethod: null,
    declineNote: null, withdrawReason: null, appliedAt: null, applyProblem: null, quoteId: "q9", timeImpactDays: 3, handoverBefore: "2031-11-06", handoverAfter: "2031-11-11",
    lines: [{ id: "l1", source: "catalog", action: "add", title: "Oak wardrobe", quantity: "1", unit: "nos", unitPrice: null, roomId: "r1", roomName: "Study", catalogItemId: "i1", boqLineId: null }] },
  project: { id: "p1", reference: "PRJ-0007", name: "Villa 12", status: "active" },
  price: { quoteId: "q9", number: 3, status: "draft", hash: null, validUntil: "2031-11-30", currency: "AED", decimals: 2, pricesIncludeTax: false,
    lines: [{ id: "l1", op: "add", title: "Oak wardrobe", area: "Study", fromArea: null, quantity: "1", unit: "nos", rate: "4000", net: "4000.00", total: "4200.00", boqLineId: null },
      { id: "l2", op: "omit", title: "Worktop", area: "Kitchen", fromArea: null, quantity: "1", unit: "m²", rate: "800", net: "-800.00", total: "-840.00", boqLineId: "b1" }],
    subtotal: "3200.00", discounts: "0.00", net: "3200.00", tax: "160.00", taxes: [], total: "3360.00", credit: "-840.00",
    paymentTerms: [{ id: "t1", title: "Before the work starts", percent: 100, requiredForRelease: true }], value: "+3360.00", paymentRule: "before_work", holdsWork: true },
  qs: "not_needed",
  timeline: { impacts: [{ stageId: "s2", days: 3 }], stages: [{ id: "s1", position: 0, name: "Kickoff", status: "done" }, { id: "s2", position: 1, name: "Production", status: "current" }],
    preview: { planned: true, finishDelay: 3, handoverBefore: "2031-11-06", handoverAfter: "2031-11-11", totalDays: 3, items: [],
      stages: [{ id: "s2", name: "Production", position: 1, status: "current", days: 3, fromStart: "2031-10-19", fromEnd: "2031-10-23", toStart: "2031-10-19", toEnd: "2031-10-28", delay: 3 }] },
    sent: null, applied: null },
  approval: null, signing: null, files: [], events: [{ event: "raised", at: "2031-10-01T10:00:00Z", note: null, actorName: "Sam Site", byClient: false },
    { event: "priced", at: "2031-10-02T10:00:00Z", note: null, actorName: "Quinn QS", byClient: false }],
  purchaseOrders: [], actions: ["edit", "upload", "submit", "withdraw"], next: "submit", ...overrides,
});

describe("one change's record", () => {
  it("has one title, one status, the five tabs, and its next step as the one primary action", async () => {
    const fetcher = mount((url) => (url.includes("/submit") ? record({ change: { ...record().change, status: "pending_approval", version: 5 }, next: null, actions: [] }) : record()));
    render(<DesignSystemProvider><ChangeRecord workspaceId="w" projectId="p1" changeId={ID} initial={record()} /></DesignSystemProvider>);
    expect(screen.getByRole("heading", { level: 1, name: "CR-001 · Study wardrobe" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Scope", "Price", "Timeline impact", "Approvals", "History"]);
    // Scope: what and why, the raised lines.
    expect(screen.getByText("Client asked on site.")).toBeInTheDocument();
    expect(screen.getByText("Add: Oak wardrobe")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => String(url).includes(`/p1/${ID}/submit`) && JSON.parse(String(init?.body)).version === 4)).toBe(true));
    expect(await screen.findByText("Sent for approval.")).toBeInTheDocument();
    expect(screen.getByText("In approval")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send for approval" })).not.toBeInTheDocument();
  });

  it("shows the price (credits, tax, total, payment) and the timeline impact (stages that move, the new handover)", async () => {
    mount((url) => (url.includes("/preview") ? record().timeline.preview : record()));
    search = new URLSearchParams("tab=price");
    render(<DesignSystemProvider><ChangeRecord workspaceId="w" projectId="p1" changeId={ID} initial={record()} /></DesignSystemProvider>);
    expect(await screen.findByText("Of which credits")).toBeInTheDocument();
    expect(screen.getByText("Before the work starts · 100% · work waits for it")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the price" })).toHaveAttribute("href", `/workspace/projects/p1/changes/${ID}/price`);
    fireEvent.click(screen.getByRole("tab", { name: "Timeline impact" }));
    expect(await screen.findByText("Handover", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Production/ })).toHaveValue("3");
    expect(screen.queryByRole("textbox", { name: /Kickoff/ })).not.toBeInTheDocument();
    expect(screen.getByText("+3 days")).toBeInTheDocument();
  });

  it("asks for the QS first where the firm's rules name the change, and the approver approves", async () => {
    const fetcher = mount(() => record());
    const { unmount } = render(<DesignSystemProvider><ChangeRecord workspaceId="w" projectId="p1" changeId={ID}
      initial={record({ qs: "needed", next: "send_to_qs", actions: ["edit", "send_to_qs", "withdraw"] })} /></DesignSystemProvider>);
    expect(screen.getByRole("link", { name: "Send to QS" })).toHaveAttribute("href", `/workspace/projects/p1/changes/${ID}/price`);
    unmount();
    render(<DesignSystemProvider><ChangeRecord workspaceId="w" projectId="p1" changeId={ID} initial={record({ change: { ...record().change, status: "pending_approval" }, next: "approve",
      actions: ["approve", "return"], approval: { id: "a1", status: "pending", version: 2, amount: "3360.00", currency: "AED", waitingFor: ["Ada Approver"],
        steps: [{ position: 1, label: "Change approver", state: "current", decidedBy: null, decidedAt: null }] } })} /></DesignSystemProvider>);
    // Approving opens the review (the reason, its photos); nothing is decided until it's confirmed there.
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const review = await screen.findByRole("dialog");
    expect(within(review).getByText("Client asked on site.")).toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes(`/${ID}/decide`))).toBe(false);
    fireEvent.click(within(review).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => String(url).includes(`/${ID}/decide`) && JSON.parse(String(init?.body)).decision === "approve"
      && JSON.parse(String(init?.body)).approvalVersion === 2)).toBe(true));
  });

  it("QA-007: the QS a change waits for prices it from the change, without a way into the project", () => {
    mount(() => record());
    render(<DesignSystemProvider><ChangeRecord workspaceId="w" projectId="p1" changeId={ID}
      initial={record({ qs: "with_qs", next: null, actions: [], qsPricing: true, canOpenProject: false })} /></DesignSystemProvider>);
    expect(screen.getByRole("link", { name: "Price it" })).toHaveAttribute("href", `/workspace/projects/p1/changes/${ID}/price`);
    expect(screen.queryByRole("link", { name: record().project.reference })).not.toBeInTheDocument();
    expect(screen.getByText(record().project.reference)).toBeInTheDocument();
  });
});
