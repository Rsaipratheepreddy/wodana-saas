import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PortalApi } from "@/lib/client-portal/client";
import type { PortalChange, PortalDesignChoices, PortalDesignThread } from "@/lib/client-portal/types";
import { DesignComments } from "./decisions/design-comments";
import { DesignChoices } from "./sections/design-choices";
import type { PortalFormat } from "./portal-format";

const format = { date: (value: string) => value.slice(0, 10), money: (value: unknown, currency?: string | null) => `${currency} ${value}`, number: (value: string) => String(Number(value)) } as unknown as PortalFormat;
const portalApi = () => ({ command: vi.fn(async () => ({ ok: true })), file: (kind: string, id: string) => `/files/${kind}/${id}` }) as unknown as PortalApi & { command: ReturnType<typeof vi.fn> };
const choices: PortalDesignChoices = {
  locked: false, currency: "AED",
  presentations: [{ id: "p1", stage: "concepts", label: "Concepts", round: 2, status: "presented", version: 3, presentedAt: "2031-04-01T10:00:00Z", chosenOptionId: null, decidedAt: null, decidedByName: null, decisionNote: null, canDecide: true,
    options: [{ id: "o1", title: "Warm minimal", note: "Oak and linen", linkUrl: "https://www.canva.com/design/warm", versionId: null, versionNumber: null, mimeType: null, hasPreview: false },
      { id: "o2", title: "Coastal", note: "", linkUrl: null, versionId: "v9", versionNumber: 1, mimeType: "image/png", hasPreview: true }] }],
  choices: [{ entryId: "e1", kind: "material", room: "Living", versionId: "lv2", number: 2, title: "Smoked oak", specification: "Matt", quantity: "12.5000", unit: "sqm", unitPrice: "100.00", currency: "AED",
    priceImpact: "250.00", timeImpactDays: 4, afterLock: true, status: "proposed", confirmedAt: null, confirmedByName: null, changed: true, canDecide: true },
  { entryId: "e2", kind: "design", room: null, versionId: "lv3", number: 1, title: "Arched doorway", specification: "", quantity: null, unit: "", unitPrice: null, currency: null,
    priceImpact: "0.00", timeImpactDays: 0, afterLock: false, status: "confirmed", confirmedAt: "2031-04-02T10:00:00Z", confirmedByName: "Maya", changed: false, canDecide: false }],
};

describe("the client's design choices in the portal (plan §6.7a)", () => {
  it("picks one concept, or asks for changes with what to change", async () => {
    const api = portalApi();
    const reload = vi.fn();
    render(<DesignSystemProvider><DesignChoices caseId="c1" choices={choices} api={api} format={format} onChanged={reload} /></DesignSystemProvider>);
    expect(screen.getByText("Concepts · revision 1")).toBeInTheDocument();
    // A material's quantity reads as a number, not the stored decimal (12.5, not 12.5000).
    expect(screen.getByText(/Living · 12\.5 sqm/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open link/ })).toHaveAttribute("href", "https://www.canva.com/design/warm");
    const choose = screen.getByRole("button", { name: "Choose this one" });
    expect(choose).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Coastal/ }));
    fireEvent.click(choose);
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.any(String), { action: "presentation_choice", caseId: "c1", presentationId: "p1", version: 3, decision: "choose", optionId: "o2" }));
    expect(reload).toHaveBeenCalled();
  });

  it("says further changes are paid once the free revisions are used, and lists the extra revision's change once sent", async () => {
    const extra: PortalChange = { id: "cr4", reference: "CR-004", title: "Extra revision: Concepts", description: "Lighter floors", status: "waiting", raisedByClient: false, mine: false,
      createdAt: "2031-04-03T10:00:00Z", sharedAt: "2031-04-04T10:00:00Z", currency: "AED", priceImpact: "1500.00", timeImpactDays: 0, handoverBefore: null, handoverAfter: null, designImpact: "",
      lines: [], decidedAt: null, decidedBy: null, method: null, declineNote: null, version: 2, signed: false, canDecide: true };
    const opened = vi.fn();
    const { rerender } = render(<DesignSystemProvider><DesignChoices caseId="c1" choices={choices} api={portalApi()} format={format} onChanged={vi.fn()} /></DesignSystemProvider>);
    expect(screen.queryByText("Further changes are a paid change.")).not.toBeInTheDocument();
    const paid: PortalDesignChoices = { ...choices, presentations: [{ ...choices.presentations[0], paidChanges: true }], extraRevisions: [{ stage: "concepts", label: "Concepts", changeId: "cr4" }] };
    rerender(<DesignSystemProvider><DesignChoices caseId="c1" choices={paid} api={portalApi()} format={format} onChanged={vi.fn()} changes={[extra]} onOpenChange={opened} /></DesignSystemProvider>);
    expect(screen.getByText("Further changes are a paid change.")).toBeInTheDocument();
    const row = within(screen.getByRole("list", { name: "Extra revisions" })).getByRole("button", { name: /CR-004 · Extra revision: Concepts/ });
    expect(row).toHaveTextContent("+AED 1500.00");
    fireEvent.click(row);
    expect(opened).toHaveBeenCalledWith("cr4");
    // A change not sent to the client isn't in their list, so nothing is shown for it.
    rerender(<DesignSystemProvider><DesignChoices caseId="c1" choices={paid} api={portalApi()} format={format} onChanged={vi.fn()} changes={[]} onOpenChange={opened} /></DesignSystemProvider>);
    expect(screen.queryByRole("list", { name: "Extra revisions" })).not.toBeInTheDocument();
  });

  it("confirms a changed choice, and declines one only with what the client wants instead", async () => {
    const api = portalApi();
    render(<DesignSystemProvider><DesignChoices caseId="c1" choices={choices} api={api} format={format} onChanged={vi.fn()} /></DesignSystemProvider>);
    const card = screen.getByRole("heading", { name: "Your choices" }).closest("section")!;
    expect(within(card).getByText("1 to confirm")).toBeInTheDocument();
    expect(within(card).getByText("Changed")).toBeInTheDocument();
    expect(within(card).getByText("Confirmed by Maya on 2031-04-02")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Not this" }));
    expect(within(card).getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.change(within(card).getByRole("textbox", { name: /What would you like instead/ }), { target: { value: "Keep the natural oak" } });
    fireEvent.click(within(card).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.any(String), { action: "ledger_decision", caseId: "c1", entryId: "e1", versionId: "lv2", decision: "decline", note: "Keep the natural oak" }));
  });
});

describe("design comments both ways in the portal", () => {
  const threads: PortalDesignThread[] = [
    { id: "t1", anchor: { x: 0.2, y: 0.3 }, status: "open", version: 1, fromClient: false, mine: false, at: "2031-04-01T10:00:00Z", resolvedAt: null, canResolve: false,
      messages: [{ id: "m1", text: "We moved the island", at: "2031-04-01T10:00:00Z", fromClient: false, mine: false, author: null }] },
    { id: "t2", anchor: null, status: "open", version: 4, fromClient: true, mine: true, at: "2031-04-02T10:00:00Z", resolvedAt: null, canResolve: true,
      messages: [{ id: "m2", text: "Darker sofa?", at: "2031-04-02T10:00:00Z", fromClient: true, mine: true, author: "Maya" }] },
  ];

  it("shows the team as 'your design team', pins a new comment where the client tapped, and resolves the client's own thread", async () => {
    const api = portalApi();
    render(<DesignSystemProvider><DesignComments caseId="c1" versionId="v1" image="/files/design/v1" threads={threads} canComment api={api} format={format} onChanged={vi.fn()} /></DesignSystemProvider>);
    expect(screen.getByText("Your design team · 2031-04-01")).toBeInTheDocument();
    expect(screen.getByText("Maya · 2031-04-02")).toBeInTheDocument();
    const picture = screen.getByRole("button", { name: "Tap the picture to pin a comment" });
    picture.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(picture, { clientX: 50, clientY: 75 });
    fireEvent.change(screen.getByRole("textbox", { name: /Your comment on this spot/ }), { target: { value: "Lower this shelf" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.any(String), { action: "design_comment", caseId: "c1", versionId: "v1", text: "Lower this shelf", anchor: { x: 0.25, y: 0.75 } }));
    // Only the client's own thread can be resolved by them.
    expect(screen.getAllByRole("button", { name: "Resolve" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.any(String), { action: "design_resolve", caseId: "c1", threadId: "t2", version: 4, status: "resolved" }));
  });
});
