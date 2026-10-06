import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ApprovalRow, WaitingForYou } from "@/lib/approvals/approvals";
import { WaitingForYouList } from "./waiting-for-you";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));

const CALL = "00000000-0000-4000-8000-0000000000c1";
const aiRow: ApprovalRow = {
  kind: "ai_action", group: "ai", id: CALL, title: "Plain summary of the change", phrase: { key: "Update {record}", values: { record: "ENQ-118" } }, subject: "Claude",
  project: null, amount: null, currency: null, since: new Date(Date.now() - 5 * 60_000).toISOString(), href: `/workspace/ai-actions/${CALL}`,
  canDecide: true, reason: null, decide: null, version: null, parentId: null,
};
const waiting: WaitingForYou = { rows: [aiRow], count: 1, counts: { quotes: 0, payments: 0, deals: 0, orders: 0, factory: 0, site: 0, stock: 0, finance: 0, ai: 1 } };

describe("Waiting for you: changes AI apps prepared", () => {
  it("lists the change in the person's words under AI apps, and opens it", async () => {
    render(<DesignSystemProvider><WaitingForYouList workspaceId="00000000-0000-4000-8000-000000000001" initial={waiting} /></DesignSystemProvider>);
    expect(screen.getByRole("radio", { name: /AI apps/ })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Waiting for you" });
    expect(within(table).getByText("AI app change")).toBeInTheDocument();
    // The phrase (translated), not the plain summary.
    expect(within(table).getByText("Update ENQ-118")).toBeInTheDocument();
    expect(within(table).queryByText("Plain summary of the change")).not.toBeInTheDocument();
    expect(within(table).getByText("Claude")).toBeInTheDocument();
    await userEvent.click(within(table).getByRole("button", { name: "Open" }));
    expect(push).toHaveBeenCalledWith(`/workspace/ai-actions/${CALL}`);
  });
});

describe("Waiting for you: what a decision says (m25)", () => {
  it("says a payment was verified, the same word as its button", async () => {
    const receipt: ApprovalRow = { ...aiRow, kind: "receipt", group: "payments", id: "pay-1", title: "Advance on signing", phrase: null, subject: "Sofia Bennett", href: "/x",
      decide: { approve: "verify_payment", other: null, approveNeedsNote: false }, version: 3, parentId: "case-1" };
    const empty: WaitingForYou = { rows: [], count: 0, counts: { ...waiting.counts, ai: 0 } };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 201, json: async () => empty })));
    render(<DesignSystemProvider><WaitingForYouList workspaceId="00000000-0000-4000-8000-000000000001" initial={{ rows: [receipt], count: 1, counts: { ...waiting.counts, ai: 0, payments: 1 } }} /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("button", { name: /^Verify/ }));
    expect(await screen.findByText("Advance on signing verified.")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe("Waiting for you: E3 rows", () => {
  it("shows a quotation With QS to its QS (opened on the quotation) and a value change with old → new, decided in the row", async () => {
    const qs: ApprovalRow = { ...aiRow, kind: "qs_review", group: "quotes", id: "qs-1", title: "Q-7 · Amira", phrase: null, subject: "Sara Sales", amount: "185000.5", currency: "AED",
      href: "/workspace/pre-projects/cases/c/quotations?quote=q", decide: null };
    const value: ApprovalRow = { ...aiRow, kind: "approval", group: "deals", id: "r-1", title: "O-0042 · Amira · Proposal 1 · Design fee", phrase: null, subject: "Sara Sales",
      amount: "52000", currency: "AED", href: "/x", decide: { approve: "approve", other: "return", approveNeedsNote: false }, version: 1, change: { from: "45000", to: "52000" }, cover: { via: "delegate", for: null } };
    render(<DesignSystemProvider locale="en-US"><WaitingForYouList workspaceId="00000000-0000-4000-8000-000000000001"
      initial={{ rows: [qs, value], count: 2, counts: { ...waiting.counts, ai: 0, quotes: 1, deals: 1 } }} /></DesignSystemProvider>);
    const table = screen.getByRole("table", { name: "Waiting for you" });
    expect(within(table).getByText("QS to confirm")).toBeInTheDocument();
    expect(within(table).getByText("Q-7 · Amira")).toBeInTheDocument();
    expect(within(table).getByText("Changed from AED 45,000.00 to AED 52,000.00")).toBeInTheDocument();
    expect(within(table).getByText("Covering for someone away")).toBeInTheDocument();
    await userEvent.click(within(table).getAllByRole("button", { name: "Open" })[0]);
    expect(push).toHaveBeenCalledWith("/workspace/pre-projects/cases/c/quotations?quote=q");
    expect(within(table).getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});
