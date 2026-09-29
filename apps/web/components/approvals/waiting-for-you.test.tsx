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
