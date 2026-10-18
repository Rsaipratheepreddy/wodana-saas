import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { financeRequestsApi } from "@/lib/finance-requests/client";
import { netOfTax } from "@/lib/finance-requests/amounts";
import type { FinanceRequest, FinanceRequestDetail, FinanceRequestsBoard, RequestContext } from "@/lib/finance-requests/types";
import { FinanceRequests } from "./finance-requests";
import { RequestForm } from "./request-form";
import { RequestSheet } from "./request-sheet";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/finance/requests", useSearchParams: () => new URLSearchParams() }));

const request = (patch: Partial<FinanceRequest> = {}): FinanceRequest => ({
  id: "r1", number: 1, reference: "FR-0001", kind: "invoice", status: "new", source: "manual", requestedBy: "u2", requesterName: "Sara Sales", createdAt: "2026-10-05T08:00:00Z",
  updatedAt: "2026-10-05T08:00:00Z", version: 1, partyId: "c1", clientName: "Mohamed Vora", clientType: "person", opportunityId: "o1", opportunityReference: "O-0012",
  opportunityTitle: "Villa 12", projectId: null, projectReference: null, projectName: null, vendorId: null, supplierName: null, salespersonId: "u2", salespersonName: "Sara Sales",
  legalEntityId: "e1", companyName: "Studio Interiors", currency: "AED", clientEmail: "mohamed@example.com", clientTaxNumber: "", invoiceKind: "standard", caseId: null, quoteId: null,
  paymentStageId: null, paymentStageTitle: "", paymentTerms: "50% deposit", contractReference: "", orderNumber: "", orderGross: null, paymentMethodId: null, paymentMethod: "",
  taxCode: "sr", taxLabel: "VAT", taxRate: "5.0000", net: "10000.0000", tax: "500.0000", total: "10500.0000", invoiceNumber: "", reason: "", bankDetails: null, hasBankDetails: false,
  supplierReference: "", payNow: null, balance: null, authorisedBy: null, authorisedByName: null, materialLocation: null, supplierTaxNumber: "", paidOnStatement: false,
  statementAmount: null, statementCheckedAt: null, statementCheckedByName: null, remarks: "", financeReference: "", internalNote: null, handledBy: null, handledByName: null,
  closedByName: null, closedAt: null, closeNote: "", invoicePending: false, approvalStatus: null, approvedAt: null, expectedRefundOn: null, ...patch,
});
const detail = (patch: Partial<FinanceRequestDetail> = {}, row: Partial<FinanceRequest> = {}): FinanceRequestDetail => ({
  request: request(row), lines: [{ id: "l1", position: 0, description: "Kitchen joinery", quantity: "1.0000", unitPrice: "10000.0000", amount: "10000.0000" }], files: [],
  events: [{ id: "e1", kind: "submitted", fromStatus: null, toStatus: "new", note: "", actorName: "Sara Sales", occurredAt: "2026-10-05T08:00:00Z" }], approval: null, canDecide: false,
  guidance: "", canManage: false, canResubmit: false, canAttach: true, ...patch,
});
const context = (patch: Partial<RequestContext> = {}): RequestContext => ({
  client: { id: "c1", name: "Mohamed Vora", type: "person", email: "mohamed@example.com" },
  deal: { id: "o1", reference: "O-0012", title: "Villa 12", legalEntityId: "e1", salespersonName: "Sara Sales", currency: "AED" }, project: null, caseId: "k1",
  stages: [{ id: "deposit", title: "Deposit 50%", trigger: "", dueDate: "2026-10-01", currency: "AED", amount: "10500.0000", legalEntityId: null }], quotes: [],
  companies: [{ id: "e1", name: "Studio Interiors", currency: "AED", taxLabel: "VAT", rates: [{ code: "sr", label: "Standard", rate: "5", isDefault: true }] }], defaultCompanyId: "e1",
  methods: [], people: [{ id: "u1", name: "Fatima Finance" }], currency: "AED", taxNumberLabel: "TRN", me: "u2", ...patch,
});
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(String(url), typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) }));

describe("finance requests", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("takes the tax out of a payment stage exactly, as the server does", () => {
    expect(netOfTax("10500", "5", 2)).toBe("10000.00");
    expect(netOfTax("100", "5", 2)).toBe("95.24");
    expect(netOfTax("1000", "0", 3)).toBe("1000.000");
  });

  it("lists the requester's requests with where each stands, and shows them as a board by status", async () => {
    const board: FinanceRequestsBoard = { requests: [request(), request({ id: "r2", reference: "FR-0002", kind: "refund", status: "needs_info", total: "3200.0000", approvalStatus: "pending" })],
      canManage: false, canRaise: true, me: "u2", settings: { financeInboxSet: true } };
    mount(() => board);
    render(<DesignSystemProvider><FinanceRequests workspaceId="w" openId={null} onOpen={vi.fn()} raising={false} onRaised={vi.fn()} /></DesignSystemProvider>);
    expect(await screen.findAllByText("Mohamed Vora")).toHaveLength(2);
    expect(screen.getByText("Waiting for approval")).toBeInTheDocument();
    expect(screen.getByText("Needs info")).toBeInTheDocument();
    // Only Finance has the settings.
    expect(screen.queryByRole("button", { name: "Request actions" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Board" }));
    const columns = within(await screen.findByRole("region", { name: "Finance requests" }));
    expect(columns.getByRole("region", { name: "New" })).toHaveTextContent("FR-0001");
    expect(columns.getByRole("region", { name: "Needs info" })).toHaveTextContent("FR-0002");
  });

  it("raises an invoice from the deal: the client filled, tax-exclusive totals at the company's rate, sent once", async () => {
    const fetcher = mount((url, body) => (url.includes("/context") ? context() : body?.action === "submit" ? detail() : []));
    const onSaved = vi.fn();
    render(<DesignSystemProvider><RequestForm api={financeRequestsApi("w")} origin={{ opportunityId: "o1" }} onClose={vi.fn()} onSaved={onSaved} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "New request to Finance" });
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Client" })).toHaveValue("Mohamed Vora"));
    expect(within(dialog).getByRole("textbox", { name: /Client email/ })).toHaveValue("mohamed@example.com");
    expect(within(dialog).getByRole("textbox", { name: "Salesperson" })).toHaveValue("Sara Sales");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Description" }), "Kitchen joinery");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Amount before tax" }), "10000");
    expect(within(dialog).getByText("VAT 5%")).toBeInTheDocument();
    expect(within(dialog).getByText(/10,500\.00/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Send to Finance" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [sent] = posts(fetcher);
    expect(sent.body).toMatchObject({ action: "submit", kind: "invoice", opportunityId: "o1", partyId: "c1", legalEntityId: "e1", taxCode: "sr", currency: "AED",
      clientEmail: "mohamed@example.com", lines: [{ description: "Kitchen joinery", quantity: "1", unitPrice: "10000" }] });
    expect(sent.body.commandId).toEqual(expect.any(String));
    expect(await screen.findByText("FR-0001 is with Finance.")).toBeInTheDocument();
  });

  it("asks for the refund method and shows that method's guidance and timeline (PLM-109)", async () => {
    const methods = [
      { id: "m1", label: "Bank transfer / card", refundGuidance: "Beneficiary is added within 24 hours.", needsBankDetails: true, refundDays: 15, position: 1, version: 1 },
      { id: "m2", label: "Stripe", refundGuidance: "", needsBankDetails: false, refundDays: 7, position: 2, version: 1 },
      { id: "m3", label: "Tabby", refundGuidance: "", needsBankDetails: false, refundDays: null, position: 3, version: 1 },
    ];
    mount((url) => (url.includes("/context") ? context({ methods }) : []));
    render(<DesignSystemProvider><RequestForm api={financeRequestsApi("w")} origin={{ opportunityId: "o1" }} onClose={vi.fn()} onSaved={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "New request to Finance" });
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Client" })).toHaveValue("Mohamed Vora"));
    await userEvent.click(within(dialog).getByRole("radio", { name: "Refund" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /Refund method/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Stripe" }));
    expect(within(dialog).getByText("Expected about 7 days after approval.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: /Client bank details/ })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /Refund method/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Bank transfer / card" }));
    expect(within(dialog).getByText("Expected about 15 days after approval.")).toBeInTheDocument();
    expect(within(dialog).getByText("Beneficiary is added within 24 hours.")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: /Client bank details/ })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /Refund method/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Tabby" }));
    expect(within(dialog).queryByText(/Expected about/)).not.toBeInTheDocument();
  });

  it("fills a payment stage's line before tax, and asks a company client for its tax number", async () => {
    mount((url) => (url.includes("/context") ? context({ client: { id: "c9", name: "Gulf Towers LLC", type: "organization", email: "ap@gulf.example" } }) : []));
    render(<DesignSystemProvider><RequestForm api={financeRequestsApi("w")} origin={{ opportunityId: "o1" }} onClose={vi.fn()} onSaved={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "New request to Finance" });
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Client" })).toHaveValue("Gulf Towers LLC"));
    expect(within(dialog).getByText("Required for a company client.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /Payment stage/ }));
    await userEvent.click(await screen.findByRole("option", { name: /Deposit 50%/ }));
    expect(within(dialog).getByRole("textbox", { name: "Description" })).toHaveValue("Deposit 50%");
    expect(within(dialog).getByRole("textbox", { name: "Amount before tax" })).toHaveValue("10,000.00");
    expect(within(dialog).getByRole("button", { name: "Send to Finance" })).toBeDisabled();
  });

  it("lets Finance work it and keeps the requester to answering", async () => {
    const fetcher = mount((url, body) => (body?.action === "start" ? detail({ canManage: true }, { status: "in_progress", version: 2 }) : detail({ canManage: true })));
    const { unmount } = render(<DesignSystemProvider><RequestSheet api={financeRequestsApi("w")} id="r1" onChanged={vi.fn()} onClose={vi.fn()} /></DesignSystemProvider>);
    const sheet = await screen.findByRole("dialog", { name: "FR-0001 · Invoice" });
    expect(within(sheet).getByRole("button", { name: "Mark done" })).toBeInTheDocument();
    // Asking the requester needs what's missing.
    await userEvent.click(within(sheet).getByRole("button", { name: "Ask for info" }));
    expect(await within(sheet).findByText("Say what's missing.")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(posts(fetcher).map((post) => post.body.action)).toEqual(["start"]));
    expect(posts(fetcher)[0].body).toMatchObject({ id: "r1", version: 1 });
    unmount();
    mount(() => detail({ canResubmit: true, events: [{ id: "e2", kind: "needs_info", fromStatus: "new", toStatus: "needs_info", note: "Which stage is this?", actorName: "Fatima", occurredAt: "2026-10-05T09:00:00Z" }] },
      { status: "needs_info", kind: "refund", hasBankDetails: true, bankDetails: null }));
    render(<DesignSystemProvider><RequestSheet api={financeRequestsApi("w")} id="r1" onChanged={vi.fn()} onClose={vi.fn()} /></DesignSystemProvider>);
    const mine = await screen.findByRole("dialog", { name: "FR-0001 · Refund" });
    expect(within(mine).getAllByText("Which stage is this?").length).toBeGreaterThan(0);
    expect(within(mine).getByText("Given (Finance only)")).toBeInTheDocument();
    expect(within(mine).queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
    expect(within(mine).getByRole("button", { name: "Answer Finance" })).toBeInTheDocument();
  });
});
