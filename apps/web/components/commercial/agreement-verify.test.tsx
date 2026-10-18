import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CommercialState } from "@/lib/commercial/types";
import { AgreementPayments } from "./commercial-workflows";

const file = { id: "f1", name: "signed-agreement.png", mimeType: "image/png", byteSize: 2048, hasPreview: true, addedAt: "2026-09-29T09:00:00.000Z", addedBy: "sara" };
const state = (agreement: Record<string, unknown>) => ({
  workspaceId: "w", caseId: "c", currency: "AED", customerName: "Sofia", canEdit: false, canApprove: true, canVerifyFinance: false,
  data: {
    revision: 3, requests: [], audit: [], release: null, receipts: [], payments: [],
    agreement: { status: "draft", quoteId: "q1", reference: "AGR-2026-001", terms: "", evidence: "", ...agreement },
    quotes: [{ id: "q1", kind: "quotation", status: "accepted", number: 1, currency: "AED", total: 10000, lines: [], paymentTerms: [] }],
  },
}) as unknown as CommercialState;
const view = (current: CommercialState, run = vi.fn().mockResolvedValue(true)) =>
  render(<DesignSystemProvider><AgreementPayments initialView="agreement" state={current} run={run} busy={false} /></DesignSystemProvider>);

describe("verifying the signed agreement (M6)", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("verifies once the signed document is attached, with no written description, in a review of what was signed (§0.3 P0)", async () => {
    const run = vi.fn().mockResolvedValue(true);
    view(state({ files: [file] }), run);
    const review = screen.getByRole("button", { name: "Review signed agreement" });
    expect(review).toBeEnabled();
    await userEvent.click(review);
    // Nothing is verified until the review's own action.
    expect(run).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("signed-agreement.png")).toBeVisible();
    expect(within(dialog).getByText(/Accepted quotation V1/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Verify signed agreement" }));
    expect(run).toHaveBeenCalledWith("execute_agreement");
  });

  it("says why it can't be verified before anything signed is on record", () => {
    view(state({ files: [] }));
    expect(screen.getByRole("button", { name: "Review signed agreement" })).toBeDisabled();
    expect(screen.getByText("Attach the signed agreement first.")).toBeVisible();
  });

  it("dates the verification on the workspace's calendar, as a date people read", () => {
    // 22:30 UTC on 13 Oct is already 14 Oct in a UTC+4 workspace.
    render(<DesignSystemProvider locale="en-GB" timeZone="Asia/Dubai"><AgreementPayments initialView="agreement" busy={false} run={vi.fn()}
      state={state({ status: "executed", executedBy: "Max Manager", executedAt: "2026-10-13T22:30:00.000Z", files: [file] })} /></DesignSystemProvider>);
    expect(screen.getByText("14 Oct 2026")).toBeVisible();
    expect(screen.queryByText(/2026-10-13/)).not.toBeInTheDocument();
  });

  it("still accepts a written description of the signed document", () => {
    view(state({ evidence: "Signed by both parties on 28 Sep" }));
    expect(screen.getByRole("button", { name: "Review signed agreement" })).toBeEnabled();
  });
});
