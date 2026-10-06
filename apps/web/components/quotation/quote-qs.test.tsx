import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { QsState } from "@/lib/proposals/client";
import { ClientPriceBreakdown } from "./client-price-breakdown";
import { QsActions, qsBlocks } from "./quote-qs";

const base: QsState = { required: true, stage: "to_send", reference: null, canSend: true, canDecide: false, review: null, people: [{ userId: "u-qs", name: "Quinn QS" }] };
const review = { id: "r1", status: "with_qs" as const, assigneeUserId: "u-qs", assigneeName: "Quinn QS", requestedBy: "u-sales", requestedByName: "Sara", requestedAt: "2026-10-06T09:00:00Z",
  note: "", decidedBy: null, decidedByName: null, decidedAt: null, decisionNote: "", version: 1 };

afterEach(() => vi.unstubAllGlobals());

describe("the QS hand-off in the quote header (PLM-082/084)", () => {
  it("holds sending until the QS has confirmed the current pricing", () => {
    expect(qsBlocks(base)).toBe(true);
    expect(qsBlocks({ ...base, stage: "stale" })).toBe(true);
    expect(qsBlocks({ ...base, stage: "confirmed" })).toBe(false);
    expect(qsBlocks({ ...base, required: false, stage: "not_required" })).toBe(false);
    expect(qsBlocks(null)).toBe(false);
  });

  it("lets Sales send it to a named QS", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ...base, stage: "with_qs", review }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const onChanged = vi.fn();
    render(<DesignSystemProvider><QsActions workspaceId="w" caseId="c" quoteId="q" qs={base} onChanged={onChanged} onError={vi.fn()} /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Send to QS" }));
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ assigneeUserId: "u-qs", note: "" });
  });

  it("shows who holds it, and lets the QS confirm or return it", () => {
    const { rerender } = render(<DesignSystemProvider><QsActions workspaceId="w" caseId="c" quoteId="q" qs={{ ...base, stage: "with_qs", review }} onChanged={vi.fn()} onError={vi.fn()} /></DesignSystemProvider>);
    expect(screen.getByText("With QS · Quinn QS")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm pricing" })).not.toBeInTheDocument();
    rerender(<DesignSystemProvider><QsActions workspaceId="w" caseId="c" quoteId="q" qs={{ ...base, stage: "with_qs", review, canDecide: true }} onChanged={vi.fn()} onError={vi.fn()} /></DesignSystemProvider>);
    expect(screen.getByRole("button", { name: "Confirm pricing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return" })).toBeInTheDocument();
  });
});

describe("the price as the client reads it (R3)", () => {
  it("shows items at cost and the fee once, with the same total", () => {
    render(<DesignSystemProvider><ClientPriceBreakdown currency="AED" decimals={2} presentation={{ mode: "fee_based",
      lines: [{ id: "a", title: "Cabinets", quantity: "4.5", unit: "m", rate: "1000.00", amount: "4500.00", optional: false, cost: null, markupPercent: null, markupAmount: null }],
      summary: [{ key: "Items at cost", amount: "4500.00" }, { key: "Our fee", amount: "900.00" }, { key: "Subtotal", amount: "5400.00" }, { key: "Total", amount: "5400.00" }] }} /></DesignSystemProvider>);
    expect(screen.getByRole("table", { name: "Price breakdown" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Cost" })).toBeInTheDocument();
    expect(screen.getByText("Our fee")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Markup" })).not.toBeInTheDocument();
  });
});
