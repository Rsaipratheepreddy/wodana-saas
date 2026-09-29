import { render, screen } from "@testing-library/react";
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

  it("verifies once the signed document is attached, with no written description", async () => {
    const run = vi.fn().mockResolvedValue(true);
    view(state({ files: [file] }), run);
    const verify = screen.getByRole("button", { name: "Verify signed agreement" });
    expect(verify).toBeEnabled();
    await userEvent.click(verify);
    expect(run).toHaveBeenCalledWith("execute_agreement");
  });

  it("says why it can't be verified before anything signed is on record", () => {
    view(state({ files: [] }));
    expect(screen.getByRole("button", { name: "Verify signed agreement" })).toBeDisabled();
    expect(screen.getByText("Attach the signed agreement first.")).toBeVisible();
  });

  it("still accepts a written description of the signed document", () => {
    view(state({ evidence: "Signed by both parties on 28 Sep" }));
    expect(screen.getByRole("button", { name: "Verify signed agreement" })).toBeEnabled();
  });
});
