import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CommercialState } from "@/lib/commercial/types";
import { AgreementPayments } from "./commercial-workflows";

const receipt = (source: "manual" | "provider") => ({ id: "r1", paymentId: "p1", legalEntityId: "le", currency: "AED", amount: 5250, source, status: source === "manual" ? "reported" : "provider_confirmed",
  reference: "TT-1", evidence: "Bank row 12", method: "bank", receivedOn: "2026-10-16", reportedAt: "2026-10-16T09:00:00.000Z", reportedBy: "Sam Sales", reportedById: "sam" });
const state = (source: "manual" | "provider") => ({
  workspaceId: "w", caseId: "c", currency: "AED", customerName: "Sofia", canEdit: false, canApprove: false, canVerifyFinance: true,
  data: {
    revision: 7, requests: [], audit: [], release: null, receipts: [receipt(source)], allocations: [],
    payments: [{ id: "p1", title: "Advance", amount: 5250, currency: "AED", dueDate: "2026-10-20", requiredForRelease: true, status: "proof_submitted", proof: "Bank row 12", reference: "TT-1" }],
    agreement: { status: "executed", quoteId: "q1", reference: "AGR-2026-001", terms: "", evidence: "Signed" },
    quotes: [{ id: "q1", kind: "quotation", status: "accepted", number: 1, currency: "AED", total: 5250, taxRate: 5, lines: [], paymentTerms: [] }],
  },
}) as unknown as CommercialState;
const view = (current: CommercialState, run = vi.fn().mockResolvedValue(true)) =>
  render(<DesignSystemProvider><AgreementPayments initialView="payments" state={current} run={run} busy={false} /></DesignSystemProvider>);

/** Opens the receipt's review once the client reports have loaded (the table settles first). */
async function openReview() {
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await userEvent.click(screen.getByRole("button", { name: "Finance verify" }));
}

describe("Finance sends a recorded receipt back (§0.3)", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ reports: [], items: [] }) }))); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reviews the receipt, then sends it back with a reason instead of verifying it", async () => {
    const run = vi.fn().mockResolvedValue(true);
    view(state("manual"), run);
    await openReview();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Verify receipt" })).toBeVisible();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Send back" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: /What needs to change/ }), "The bank shows 5,000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send back" }));
    expect(run).toHaveBeenCalledWith("return_payment", { paymentId: "p1", note: "The bank shows 5,000" });
    expect(run).not.toHaveBeenCalledWith("verify_payment", expect.anything());
  });

  it("offers no send-back for a provider's settlement", async () => {
    view(state("provider"));
    await openReview();
    expect(within(await screen.findByRole("dialog")).queryByRole("radio", { name: "Send back" })).not.toBeInTheDocument();
  });
});
