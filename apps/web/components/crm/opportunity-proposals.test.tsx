import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { OpportunityProposals, proofMatch, visibleKinds, type ProposalsView } from "./opportunity-proposals";

vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));

const WORKSPACE = "00000000-0000-4000-8000-000000000001";
const OPPORTUNITY = "00000000-0000-4000-8000-0000000000a1";
const view = (over: Partial<ProposalsView> = {}): ProposalsView => ({
  proposals: [
    { id: "p1", kind: "design", amount: "15000", currencyCode: "AED", valueStatus: "approved", enteredBy: "Sara", verifiedBy: "Fatima", approvedAt: "2026-10-02T00:00:00.000Z", approvedBy: "Cece",
      wonAt: "2026-10-01T00:00:00.000Z", version: 4, approval: { id: "r", version: 1, step: 1, steps: 2, label: "Finance verifies", fromAmount: "15000", toAmount: "18000", currency: "AED", waitingFor: ["Fatima"], canDecide: true, via: "direct", reason: null } },
    { id: "p2", kind: "main", amount: null, currencyCode: null, valueStatus: "empty", enteredBy: null, verifiedBy: null, approvedAt: null, approvedBy: null, wonAt: null, version: 1, approval: null },
  ],
  events: [], valueHidden: false, can: { enter: true, fulfil: true }, closing: null, fulfilment: [], ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("opportunity proposals (PLM-101 / PLM-103)", () => {
  it("compares the proof's reading with the value exactly, per currency", () => {
    expect(proofMatch({ amount: "12500.00", currency: "AED" }, { amount: "12500", currencyCode: "AED" })).toBe("match");
    expect(proofMatch({ amount: "12500", currency: "EUR" }, { amount: "12500", currencyCode: "AED" })).toBe("mismatch");
    expect(proofMatch({ amount: null, currency: null }, { amount: "1", currencyCode: "AED" })).toBe("unknown");
    expect(visibleKinds({ flow: "furniture" } as never, [])).toEqual(["main"]);
    expect(visibleKinds({ flow: "design" } as never, [])).toEqual(["design", "main"]);
    // An enquiry type's own flow shows Proposal 1 when its steps hold a design package round, whatever its code.
    const none = { intro: false, designPackage: false, furniturePath: false, clientApprovalOnSpot: false, siteVisit: false, qsPricing: false };
    expect(visibleKinds({ flow: "interior_design_furniture", capabilities: { ...none, intro: true, designPackage: true } }, [])).toEqual(["design", "main"]);
    expect(visibleKinds({ flow: "full_fit_out", capabilities: { ...none, intro: true, siteVisit: true, qsPricing: true } }, [])).toEqual(["main"]);
  });

  it("shows the locked value, the change waiting with old → new, and lets the step's approver verify it", async () => {
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => view(), url }));
    vi.stubGlobal("fetch", fetch);
    render(<DesignSystemProvider locale="en-US"><OpportunityProposals workspaceId={WORKSPACE} opportunityId={OPPORTUNITY} flow={{ flow: "design", proofs: [] } as never}
      closed={false} won open onToggle={() => undefined} onSecondProof={() => undefined} /></DesignSystemProvider>);
    expect(await screen.findByText("Approved · locked")).toBeInTheDocument();
    expect(screen.getByText("Change to approve: AED 15,000.00 → AED 18,000.00")).toBeInTheDocument();
    expect(screen.getByText("Finance verifies · waiting for Fatima")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach Proposal 2 payment proof" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    const decide = fetch.mock.calls.find(([url]) => String(url).includes("/proposals/design/decide"));
    expect(decide).toBeDefined();
    expect(JSON.parse(String(decide![1]?.body))).toMatchObject({ decision: "approve", version: 1 });
  });
});
