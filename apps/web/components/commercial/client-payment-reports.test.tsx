import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { StaffPaymentReport } from "@/lib/client-portal/types";
import type { CommercialState } from "@/lib/commercial/types";
import { AgreementPayments } from "./commercial-workflows";

const WS = "5d1f7a52-8f4e-4c1b-9d2a-1b2c3d4e5f60";
const CASE = "8a0e6d7c-3b2a-4f1e-8d9c-0a1b2c3d4e5f";
const report = (patch: Partial<StaffPaymentReport> = {}): StaffPaymentReport => ({
  id: "r1", caseId: CASE, paymentId: "advance", milestone: "Advance", status: "submitted", paidOn: "2026-09-20", reference: "TRX-5521", amount: "4000.00", currency: "AED",
  note: "Paid from my business account", reason: "", at: "2026-09-21T08:00:00.000Z", grantName: "Aisha Al Mansoori", decidedBy: null, decidedAt: null, version: 2,
  files: [{ id: "f1", name: "transfer.jpg", mimeType: "image/jpeg", hasPreview: true }, { id: "f2", name: "bank-slip.pdf", mimeType: "application/pdf", hasPreview: false }],
  ...patch,
});
const state = (patch: Partial<CommercialState["data"]> = {}) => ({
  workspaceId: WS, caseId: CASE, currency: "AED", customerName: "Aisha", canEdit: true, canApprove: true, canVerifyFinance: true,
  data: {
    revision: 1, requests: [], audit: [], release: null, agreement: { status: "executed", reference: "AGR-1", terms: "", evidence: "Signed" },
    quotes: [{ id: "q1", kind: "quotation", status: "accepted", number: 1, currency: "AED", total: 10000, lines: [], paymentTerms: [] }],
    payments: [{ id: "advance", title: "Advance", amount: 4000, dueDate: "2026-09-30", requiredForRelease: true, status: "pending", reference: "", proof: "" }],
    receipts: [],
    ...patch,
  },
}) as unknown as CommercialState;

const mount = (reports: () => StaffPaymentReport[]) => {
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async (url) => {
    if (url.includes("/payment-reports")) return { ok: true, status: 200, json: async () => ({ reports: reports(), canDecide: true }) };
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const decisions = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([url, init]) => init?.method === "POST" && String(url).includes("/payment-reports/"))
  .map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) }));
const view = (current: CommercialState, openPaymentId?: string) => render(<DesignSystemProvider><AgreementPayments initialView="payments" state={current} run={vi.fn().mockResolvedValue(true)} busy={false} openPaymentId={openPaymentId} /></DesignSystemProvider>);

describe("client payment reports", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows the client's report on its milestone with who, when, how much, the reference, the note and the proof", async () => {
    mount(() => [report()]);
    view(state());
    const table = await screen.findByRole("table", { name: "Payment milestones" });
    expect(await within(table).findByText("Reported paid")).toBeInTheDocument();
    await userEvent.click(within(table).getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog", { name: "Advance" });
    const entry = within(dialog).getByRole("listitem", { name: "Reported by Aisha Al Mansoori" });
    expect(entry).toHaveTextContent("Sep 20, 2026");
    expect(entry).toHaveTextContent("TRX-5521");
    expect(entry).toHaveTextContent("Paid from my business account");
    expect(entry).toHaveTextContent(/4,000\.00/);
    // Proof: a photo preview and the PDF by name, both served privately for the team.
    expect(within(entry).getByRole("link", { name: "Open transfer.jpg" }).querySelector("img")).toHaveAttribute("src", `/api/client-portal-admin/cases/${CASE}/files/f1?workspaceId=${WS}&preview=1`);
    expect(within(entry).getByRole("link", { name: "Open bank-slip.pdf" })).toHaveAttribute("href", `/api/client-portal-admin/cases/${CASE}/files/f2?workspaceId=${WS}`);
    // Recorded needs the receipt in the ledger first.
    expect(within(dialog).getByRole("button", { name: "Mark recorded" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Record receipt" })).toBeEnabled();
  });

  it("marks it not received with the reason the client reads", async () => {
    const fetcher = mount(() => [report()]);
    view(state(), "advance");
    // The notice's link opens the milestone's report.
    const dialog = await screen.findByRole("dialog", { name: "Advance" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Not received" }));
    const reason = await screen.findByRole("dialog", { name: "Payment not received" });
    expect(within(reason).getByRole("button", { name: "Not received" })).toBeDisabled();
    await userEvent.type(within(reason).getByRole("textbox", { name: /What couldn't be found/ }), "No transfer with this reference yet");
    await userEvent.click(within(reason).getByRole("button", { name: "Not received" }));
    await waitFor(() => expect(decisions(fetcher)).toHaveLength(1));
    expect(decisions(fetcher)[0].url).toBe(`/api/client-portal-admin/payment-reports/r1?workspaceId=${WS}`);
    expect(decisions(fetcher)[0].body).toEqual({ decision: "not_received", note: "No transfer with this reference yet", version: 2 });
  });

  it("marks it recorded once the milestone has its receipt", async () => {
    let current = [report()];
    const fetcher = mount(() => current);
    view(state({ receipts: [{ id: "rc1", paymentId: "advance", status: "reported" }] as never }), "advance");
    const dialog = await screen.findByRole("dialog", { name: "Advance" });
    expect(within(dialog).queryByRole("button", { name: "Record receipt" })).not.toBeInTheDocument();
    current = [report({ status: "recorded", decidedBy: "Farah Finance", decidedAt: "2026-09-22T09:00:00.000Z", version: 3 })];
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark recorded" }));
    await waitFor(() => expect(decisions(fetcher).map((call) => call.body)).toEqual([{ decision: "recorded", note: "", version: 2 }]));
    expect(await within(dialog).findByText("Recorded")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Mark recorded" })).not.toBeInTheDocument();
  });

  it("leaves the milestones as they were when the client hasn't reported anything", async () => {
    mount(() => []);
    view(state());
    const table = await screen.findByRole("table", { name: "Payment milestones" });
    await waitFor(() => expect(within(table).queryByRole("columnheader", { name: /Client report/ })).not.toBeInTheDocument());
  });
});
