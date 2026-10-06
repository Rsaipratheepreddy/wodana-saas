import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ChangeRequest, ChangeRequestsView } from "@/lib/change-requests/types";
import { ChangeRequestsPanel } from "./change-requests-panel";

const change = (overrides: Partial<ChangeRequest> = {}): ChangeRequest => ({
  id: "11111111-1111-4111-8111-111111111111", caseId: "c1", number: 1, reference: "CR-001", kind: "replacement", title: "Smoked oak and a shelf", description: "Darker veneer.",
  designImpact: "Elevation C", status: "pending_approval", currency: "AED", priceImpact: "6551.00", allowanceDraw: "5600.00", timeImpactDays: 4, handoverBefore: "2031-10-15",
  handoverAfter: "2031-10-21", raisedByClient: true, raisedByName: "Maya Client", submittedAt: "2031-04-02T10:00:00Z", sentAt: null, decidedAt: null, decidedByName: null, decisionMethod: null,
  declineNote: null, lockNumber: null, withdrawnAt: null, withdrawReason: null, version: 3, createdAt: "2031-04-01T10:00:00Z", updatedAt: "2031-04-02T10:00:00Z",
  lines: [{ id: "l1", position: 0, source: "custom", action: "add", quoteId: null, quoteLineId: null, ledgerEntryId: null, ledgerVersionId: null, roomId: null, roomName: "Kitchen", title: "Shelf",
    quantity: "2.0000", unit: "nos", unitPrice: "450.50", amount: "901.00" }],
  approval: { id: "a1", status: "pending", version: 1, currentStep: 1, waitingFor: ["Ada Approver"], steps: [{ position: 1, label: "Change approver", state: "current", decidedBy: null, decidedAt: null }] },
  events: [{ event: "raised", at: "2031-04-01T10:00:00Z", note: "A shelf please", actorName: "Maya Client", byClient: true }, { event: "submitted", at: "2031-04-02T10:00:00Z", note: null, actorName: "Omar", byClient: false }],
  purchaseOrders: [], signing: null, ...overrides,
});
const view = (changes: ChangeRequest[]): ChangeRequestsView => ({ changes, sources: { quoteLines: [{ quoteId: "q1", id: "w1", title: "Worktop", room: "Kitchen", quantity: "2.25", unit: "m²", rate: "800", kind: "item" }],
  ledgerChanges: [] }, canEdit: true });

function mount(respond: (url: string, init?: RequestInit) => unknown) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => respond(url, init) }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());

describe("change requests for the team (§6.20, R11)", () => {
  it("lists changes with their impact and who the approval waits for, and approves on E3 from the change", async () => {
    const fetcher = mount((url) => (url.includes("/decide") ? view([change({ status: "with_client", approval: { ...change().approval!, status: "approved", waitingFor: [] } })]) : view([change()])));
    render(<DesignSystemProvider><ChangeRequestsPanel workspaceId="w" caseId="c1" /></DesignSystemProvider>);
    expect(await screen.findByText("CR-001 · Smoked oak and a shelf")).toBeInTheDocument();
    expect(screen.getAllByText("Waiting for Ada Approver").length).toBeGreaterThan(0);
    expect(screen.getByText("Asked by Maya Client", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByText("CR-001 · Smoked oak and a shelf"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Add: Shelf")).toBeInTheDocument();
    // Returning needs a note; approving doesn't.
    expect(within(sheet).getByRole("button", { name: "Return" })).toBeDisabled();
    fireEvent.click(within(sheet).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => String(url).includes("/change-requests/11111111-1111-4111-8111-111111111111/decide") && JSON.parse(String(init?.body)).decision === "approve"
      && JSON.parse(String(init?.body)).approvalVersion === 1)).toBe(true));
    expect(await screen.findByText("Approved. It now waits for the client.")).toBeInTheDocument();
  });

  it("creates a change with priced lines from the accepted quotation", async () => {
    const fetcher = mount((_url, init) => (init?.method === "POST" ? view([change({ status: "draft", approval: null })]) : view([])));
    render(<DesignSystemProvider><ChangeRequestsPanel workspaceId="w" caseId="c1" /></DesignSystemProvider>);
    fireEvent.click((await screen.findAllByRole("button", { name: "New change" }))[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Name/ }), { target: { value: "Extra shelf" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add line" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Line/ }), { target: { value: "Shelf" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Quantity/ }), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body).toMatchObject({ title: "Extra shelf", kind: "addition", timeImpactDays: 0, lines: [{ source: "custom", action: "add", title: "Shelf", quantity: "2" }] });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
