import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PortalApi } from "@/lib/client-portal/client";
import type { PortalBudget, PortalChange, PortalDesignChoices, PortalDigest, PortalFeedCard, PortalProject } from "@/lib/client-portal/types";
import { ChangeSheet } from "./decisions/change-sheet";
import type { PortalFormat } from "./portal-format";
import { DesignChoices } from "./sections/design-choices";
import { DocumentsSection } from "./sections/documents-section";
import { BudgetTracker, FeedList, WhatChanged } from "./sections/portal-home";
import type { SectionProps } from "./sections/section-types";

const format = { date: (value: string) => value.slice(0, 10), money: (value: unknown, currency?: string | null) => `${currency} ${value}`, number: (value: unknown) => String(value) } as unknown as PortalFormat;
const portalApi = () => ({
  command: vi.fn(async () => ({ ok: true })),
  challenge: vi.fn(async () => ({ challengeId: "ch1", channel: "whatsapp", expiresIn: 300, resendAfter: 30 })),
  file: (kind: string, id: string, preview?: boolean) => `/files/${kind}/${id}${preview ? "?preview=1" : ""}`,
}) as unknown as PortalApi & { command: ReturnType<typeof vi.fn>; challenge: ReturnType<typeof vi.fn> };

const change = (overrides: Partial<PortalChange> = {}): PortalChange => ({
  id: "cr1", reference: "CR-001", title: "Extra shelf", description: "One more shelf in the pantry.", status: "waiting", raisedByClient: false, mine: false, createdAt: "2031-04-01T10:00:00Z",
  sharedAt: "2031-04-02T10:00:00Z", currency: "AED", priceImpact: "6551.00", timeImpactDays: 4, handoverBefore: "2031-10-15", handoverAfter: "2031-10-21", designImpact: "Elevation C",
  lines: [{ id: "l1", action: "add", title: "Shelf", room: "Kitchen", quantity: "2", unit: "nos", unitPrice: "450.50", amount: "901.00" },
    { id: "l2", action: "omit", title: "Worktop", room: null, quantity: "0.25", unit: "m²", unitPrice: "800.00", amount: "-200.00" }],
  decidedAt: null, decidedBy: null, method: null, declineNote: null, version: 3, signed: false, canDecide: true, ...overrides,
});

describe("the portal home (P4 batch 2)", () => {
  it("says what changed since the last visit, in words from the record, and nothing on a first visit", () => {
    const digest: PortalDigest = { since: "2031-04-01T00:00:00Z", items: [{ kind: "day", count: 2, titles: ["2031-04-02", "2031-04-03"] }, { kind: "change", count: 1, titles: ["CR-001 · Extra shelf"] }] };
    const { rerender } = render(<WhatChanged digest={digest} format={format} />);
    const region = screen.getByRole("region", { name: "Since you last looked" });
    expect(within(region).getByText("2 days on site")).toBeInTheDocument();
    expect(within(region).getByText("1 change request")).toBeInTheDocument();
    expect(within(region).getByText("CR-001 · Extra shelf")).toHaveAttribute("dir", "auto");
    rerender(<WhatChanged digest={null} format={format} />);
    expect(screen.queryByRole("region", { name: "Since you last looked" })).not.toBeInTheDocument();
  });

  it("lists typed cards in the order given (newest first) and opens each one", () => {
    const cards: PortalFeedCard[] = [
      { kind: "change", id: "cr1", at: "2031-04-03T10:00:00Z", title: "CR-001 · Extra shelf", note: null, status: "waiting" },
      { kind: "document", id: "design:v2", at: "2031-04-02T10:00:00Z", title: "Kitchen render", note: "V2", status: "changed" },
      { kind: "payment", id: "r1", at: "2031-04-01T00:00:00Z", title: "Advance", note: "5000.00", status: null },
    ];
    const opened = vi.fn();
    render(<FeedList cards={cards} format={format} onOpen={opened} thumb={(card) => (card.kind === "document" ? "/thumb.png" : null)} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([expect.stringContaining("Change request"), expect.stringContaining("Document"), expect.stringContaining("Payment received")]);
    expect(within(items[1]).getByText("Changed")).toBeInTheDocument();
    // An amount isn't repeated as a note.
    expect(within(items[2]).queryByText("5000.00")).not.toBeInTheDocument();
    fireEvent.click(within(items[0]).getByRole("button"));
    expect(opened).toHaveBeenCalledWith(cards[0]);
  });

  it("R1: shows agreed + approved changes (each linked to its decision) + allowance overrun = forecast, and what still waits", () => {
    const budget: PortalBudget = {
      currency: "AED", agreed: "120000.50", changesTotal: "951.00", forecast: "121551.50", pendingTotal: "900.00",
      changes: [{ kind: "change_request", id: "cr1", reference: "CR-001", title: "Smoked oak", amount: "951.00", decidedAt: "2031-04-03T10:00:00Z", method: "signed_link" },
        { kind: "variation", id: "q2", reference: null, title: "Extra lights", amount: "-300.00", decidedAt: "2031-04-04T10:00:00Z", method: "quote" }],
      allowances: [{ lineId: "a1", title: "Lighting allowance", included: "5000.00", spent: "5600.00", over: "600.00", left: "0.00" }],
      allowanceIncluded: "5000.00", allowanceSpent: "5600.00", allowanceOverrun: "600.00",
      pending: [{ id: "cr2", reference: "CR-002", title: "Wallpaper", amount: "900.00", status: "with_client" }],
    };
    const opened = vi.fn();
    render(<BudgetTracker budget={budget} format={format} onOpen={opened} />);
    const region = screen.getByRole("region", { name: "Your budget" });
    expect(within(region).getByText("AED 120000.50")).toBeInTheDocument();
    expect(within(region).getByText("AED 121551.50")).toBeInTheDocument();
    expect(within(region).getByText("1 change waiting for your decision")).toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "CR-001 · Smoked oak" }));
    expect(opened).toHaveBeenCalledWith({ kind: "change", id: "cr1" });
    fireEvent.click(within(region).getByRole("button", { name: "Extra lights" }));
    expect(opened).toHaveBeenCalledWith({ kind: "quote", id: "q2" });
    // Amounts read left to right inside right-to-left text; no cost or margin is ever shown.
    expect(within(region).getByText("AED 121551.50").closest("bdi")).toHaveAttribute("dir", "ltr");
    expect(region.textContent).not.toMatch(/cost|margin|markup/i);
  });
});

describe("change requests in the portal (R11)", () => {
  it("shows the lines, the price and the new handover date, approves with a code bound to the change", async () => {
    const api = portalApi();
    const decided = vi.fn();
    render(<DesignSystemProvider><ChangeSheet change={change()} caseId="case1" api={api} format={format} channels={["whatsapp"]} onDecided={decided} /></DesignSystemProvider>);
    expect(screen.getByText("Add: Shelf")).toBeInTheDocument();
    expect(screen.getByText("Remove: Worktop")).toBeInTheDocument();
    expect(screen.getByText("+AED 6551.00")).toBeInTheDocument();
    expect(screen.getByText("2031-10-15 → 2031-10-21 (+4 working days)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve change" }));
    await waitFor(() => expect(api.challenge).toHaveBeenCalledWith({ purpose: "change:case1:cr1:accept", channel: "whatsapp" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /Code/ }), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve change" }));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.any(String), { action: "change_decision", caseId: "case1", changeId: "cr1", decision: "accept", version: 3, challengeId: "ch1", code: "123456" }));
    expect(decided).toHaveBeenCalled();
  });

  it("shows a project change as priced (before tax, tax, total), the stages it moves and the new handover, and approves it with a code", async () => {
    const api = portalApi();
    const decided = vi.fn();
    render(<DesignSystemProvider><ChangeSheet caseId="case1" api={api} format={format} channels={["email"]} onDecided={decided} change={change({ lines: [], designImpact: "", priceImpact: "5251.05", timeImpactDays: 3,
      price: { net: "5001.00", tax: "250.05", total: "5251.05", lines: [
        { id: "w", op: "add", title: "Oak wardrobe", area: "Study", quantity: "1", unit: "nos", total: "4200.00" },
        { id: "t", op: "omit", title: "Worktop", area: "Kitchen", quantity: "1", unit: "m²", total: "-840.00" }] },
      time: { handoverBefore: "2031-11-06", handoverAfter: "2031-11-11", stages: [{ name: "Production", delay: 3 }] } })} /></DesignSystemProvider>);
    expect(screen.getByText("Add: Oak wardrobe")).toBeInTheDocument();
    expect(screen.getByText("Remove: Worktop")).toBeInTheDocument();
    expect(screen.getByText("AED -840.00")).toBeInTheDocument();
    expect(screen.getByText("+AED 5001.00")).toBeInTheDocument();
    expect(screen.getByText("+AED 5251.05")).toBeInTheDocument();
    expect(screen.getByText("2031-11-06 → 2031-11-11 (+3 working days)")).toBeInTheDocument();
    expect(screen.getByText("Production +3 days")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve change" }));
    await waitFor(() => expect(api.challenge).toHaveBeenCalledWith({ purpose: "change:case1:cr1:accept", channel: "email" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /Code/ }), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve change" }));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: "change_decision", changeId: "cr1", decision: "accept", version: 3 })));
    expect(decided).toHaveBeenCalled();
  });

  it("declines only with a reason; a viewer reads it but can't decide; the client's own request waits for the team", async () => {
    const api = portalApi();
    const { unmount } = render(<DesignSystemProvider><ChangeSheet change={change()} caseId="case1" api={api} format={format} channels={["whatsapp"]} onDecided={vi.fn()} /></DesignSystemProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.getByRole("button", { name: "Decline change" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /Why are you declining it/ }), { target: { value: "Too dear" } });
    fireEvent.click(screen.getByRole("button", { name: "Decline change" }));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: "change_decision", decision: "decline", note: "Too dear" })));
    unmount();
    const viewer = render(<DesignSystemProvider><ChangeSheet change={change({ canDecide: false })} caseId="case1" api={api} format={format} channels={["whatsapp"]} onDecided={vi.fn()} /></DesignSystemProvider>);
    expect(screen.queryByRole("button", { name: "Approve change" })).not.toBeInTheDocument();
    viewer.unmount();
    render(<DesignSystemProvider><ChangeSheet change={change({ status: "with_team", raisedByClient: true, lines: [], priceImpact: null, currency: null, canDecide: false })} caseId="case1" api={api}
      format={format} channels={["whatsapp"]} onDecided={vi.fn()} /></DesignSystemProvider>);
    expect(screen.getByText("Your project team is working out what this changes. You'll decide once they send it.")).toBeInTheDocument();
  });
});

describe("document cards (E5-4)", () => {
  it("shows a preview, the type, version and date, a changed marker, and View and Download — never a bare link", () => {
    const project = { documents: [
      { id: "v2", kind: "design", title: "Kitchen render", group: "Kitchen", date: "2031-04-02", mimeType: "image/png", version: 2, changed: true, hasPreview: true, at: "2031-04-02T10:00:00Z" },
      { id: "cr1", kind: "change", title: "CR-001 · Smoked oak", group: "", date: "2031-04-03", mimeType: "application/pdf", version: 2, changed: false, hasPreview: false, at: "2031-04-03T10:00:00Z" },
    ] } as unknown as PortalProject;
    const { container } = render(<DocumentsSection {...({ project, api: portalApi(), format } as unknown as SectionProps)} />);
    const cards = screen.getAllByRole("listitem");
    expect(within(cards[0]).getByText("CR-001 · Smoked oak")).toBeInTheDocument();
    expect(within(cards[0]).getByText("Signed change")).toBeInTheDocument();
    expect(within(cards[1]).getByText("V2")).toBeInTheDocument();
    expect(within(cards[1]).getByText("Changed")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", "/files/design/v2?preview=1");
    expect(within(cards[1]).getByRole("link", { name: "View" })).toHaveAttribute("href", "/files/design/v2");
    expect(within(cards[1]).getByRole("link", { name: "Download" })).toHaveAttribute("download");
  });
});

describe("alternatives after a declined choice (R2)", () => {
  it("offers up to three alternatives with stock and budget, and the pick goes to the ledger", async () => {
    const api = portalApi();
    const changed = vi.fn(async () => undefined);
    const choices: PortalDesignChoices = { locked: true, currency: "AED", presentations: [], choices: [{ entryId: "e1", kind: "material", room: "Kitchen", versionId: "lv1", number: 1,
      title: "Oak veneer", specification: "", quantity: "10", unit: "sqm", unitPrice: "80.00", currency: "AED", priceImpact: "800.00", timeImpactDays: 0, afterLock: true, status: "declined",
      confirmedAt: "2031-04-01T10:00:00Z", confirmedByName: "Maya", changed: false, canDecide: false, alternatives: [
        { id: "a1", title: "Walnut veneer", unit: "sqm", unitPrice: "120.00", currency: "AED", lineTotal: "1200.00", inStock: true, inBudget: false, fromPastJobs: false, canChoose: true },
        { id: "a2", title: "Ash veneer", unit: "sqm", unitPrice: "70.00", currency: "AED", lineTotal: "700.00", inStock: false, inBudget: true, fromPastJobs: true, canChoose: true }] }] };
    render(<DesignSystemProvider><DesignChoices caseId="case1" choices={choices} api={api} format={format} onChanged={changed} /></DesignSystemProvider>);
    expect(screen.getByText("Alternatives you could choose instead")).toBeInTheDocument();
    expect(screen.getByText("In stock")).toBeInTheDocument();
    expect(screen.getByText("Within budget")).toBeInTheDocument();
    expect(screen.getByText("Used before")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Choose this" })[1]);
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.any(String), { action: "ledger_alternative", caseId: "case1", alternativeId: "a2" }));
    expect(changed).toHaveBeenCalled();
  });
});

describe("right to left", () => {
  it("keeps amounts and references readable inside Arabic text", () => {
    const budget = { currency: "AED", agreed: "100.00", changesTotal: "0.00", forecast: "100.00", pendingTotal: "0.00", changes: [], allowances: [], allowanceIncluded: "0.00",
      allowanceSpent: "0.00", allowanceOverrun: "0.00", pending: [] } as PortalBudget;
    render(<div dir="rtl"><BudgetTracker budget={budget} format={format} onOpen={vi.fn()} /></div>);
    for (const amount of screen.getAllByText("AED 100.00")) expect(amount.closest("bdi")).toHaveAttribute("dir", "ltr");
  });
});
