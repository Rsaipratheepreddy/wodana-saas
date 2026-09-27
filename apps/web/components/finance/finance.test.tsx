import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { Bill, BillState, PayablesState, PaymentRun, RunState, SupplierState } from "@/lib/payables/types";
import type { ClientInvoice, InvoiceState } from "@/lib/receivables/types";
import type { FinanceSection } from "@/lib/payables/sections";
import type { PurchasingSettings } from "@/lib/purchasing/types";
import { PurchasingSettingsPage } from "../purchasing/purchasing-settings";
import type { PettyCashClaim } from "@/lib/petty-cash/types";
import { FinancePage } from "./finance-page";

const nav = vi.hoisted(() => ({ replace: vi.fn(), query: "" }));
vi.spyOn(window.history, "replaceState");
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }), usePathname: () => "/workspace/finance", useSearchParams: () => new URLSearchParams(nav.query) }));

const bill = (patch: Partial<Bill> = {}): Bill => ({
  id: "b1", vendorId: "v1", supplierName: "Nile Marble", legalEntityId: "e1", companyName: "Studio Furniture", number: "INV-1", invoiceDate: "2026-09-20", dueDate: "2099-10-20",
  currency: "AED", net: "540.0000", tax: "27.0000", total: "567.0000", statedTotal: null, status: "approved", holdReasons: "", approvedByName: null, approvedAt: "2026-09-21T10:00:00Z",
  approvalNote: "", cancelReason: null, fileName: null, createdBy: "u2", createdByName: "Dana Designer", createdAt: "2026-09-21T09:00:00Z", version: 2, paid: "200.0000", balance: "367.0000",
  orders: ["FAC-PO-2026-00001"], retention: "0.0000", retentionHeld: "0.0000", reserved: "0.0000", payable: "367.0000", ...patch,
});
const held = bill({ id: "b2", number: "INV-2", status: "held", holdReasons: "Oak veneer: invoiced 11 sheets, received 6 sheets\nOak veneer: tax 0%, ordered at 5%", paid: "0.0000", balance: "475.0000",
  total: "475.0000", payable: "0.0000" });
const paid = bill({ id: "b3", number: "INV-3", paid: "52.5000", balance: "0.0000", total: "52.5000", payable: "0.0000" });
const late = bill({ id: "b4", number: "INV-4", dueDate: "2020-01-01", paid: "0.0000", balance: "100.0000", total: "100.0000", payable: "100.0000" });
const vendors = [{ id: "v1", name: "Nile Marble", currency: "AED" }];
const companies = [{ id: "e1", name: "Studio Furniture", currency: "AED" }];
const overview = (patch: Partial<PayablesState> = {}): PayablesState => ({
  bills: [bill(), held, paid, late], payments: [], runs: [], runsRequired: false, vendors, companies, canManage: true, canApprove: true,
  suppliers: [{ vendorId: "v1", supplierName: "Nile Marble", legalEntityId: "e1", companyName: "Studio Furniture", currency: "AED", invoiced: "719.5000", paid: "252.5000",
    debited: "189.0000", owed: "278.0000", overdue: "100.0000", held: "475.0000", retention: "0.0000" }], ...patch,
});
const detail = (value: Bill, extra: Partial<BillState> = {}): BillState => ({
  bill: value, lines: [{ id: "l1", position: 0, orderLineId: "ol1", orderId: "o1", orderNumber: "FAC-PO-2026-00001", projectId: "p1", projectReference: "PRJ-0007", description: "Oak veneer",
    unit: "sheets", quantity: "6.0000", unitPrice: "90.0000", taxRate: "5.0000", net: "540.0000", tax: "27.0000", total: "567.0000", retentionPercent: "0.00" }],
  payments: [], retentions: [], canManage: true, canApprove: true, canEdit: ["draft", "held"].includes(value.status), canApproveThis: value.status === "held", canCancel: value.paid === "0.0000",
  canPay: value.status === "approved" && value.payable !== "0.0000", canRelease: false, ...extra,
});
const supplier = (patch: Partial<SupplierState["supplier"]> = {}): SupplierState => ({
  supplier: { id: "v1", name: "Nile Marble", creditDays: 30, paymentTerms: "credit", bank: null, bankChangePending: false, ...patch },
  orders: [{ id: "o1", number: "FAC-PO-2026-00001", legalEntityId: "e1", currency: "AED", status: "sent", total: "945.0000" }],
  balances: overview().suppliers, bills: [bill(), late], payments: [], debitNotes: [], runsRequired: false, canManage: true, canApprove: true,
});
const runRow = (patch: Partial<PaymentRun> = {}): PaymentRun => ({
  id: "r1", number: 1, note: "", status: "draft", createdBy: "u2", preparedBy: "u2", preparedByName: "Dana Designer", submittedAt: null, approvedBy: null, approvedByName: null, approvedAt: null,
  returnNote: null, paidByName: null, paidAt: null, paidOn: null, cancelReason: null, createdAt: "2026-09-27T09:00:00Z", version: 1, invoices: 1, suppliers: 1, dueFrom: "2020-01-01",
  totals: [{ currency: "AED", amount: "100.0000" }], ...patch,
});
const runState = (patch: Partial<PaymentRun> = {}, rights: Partial<RunState> = {}): RunState => ({
  run: runRow(patch),
  items: [{ id: "i1", invoiceId: "b4", amount: "100.0000", number: "INV-4", vendorId: "v1", supplierName: "Nile Marble", legalEntityId: "e1", companyName: "Studio Furniture", currency: "AED",
    invoiceDate: "2026-09-20", dueDate: "2020-01-01", status: "approved", payable: "0.0000", available: "100.0000" }],
  payments: [{ key: "v1|e1|AED", vendorId: "v1", supplierName: "Nile Marble", legalEntityId: "e1", companyName: "Studio Furniture", currency: "AED", amount: "100.00",
    invoices: [{ invoiceId: "b4", number: "INV-4", amount: "100.0000" }], reference: "Run 1: INV-4", paymentId: null, bank: { bankName: "Emirates NBD", last4: "4321" },
    bankChangePending: false, bankChanged: false }],
  canManage: true, canApprove: true, canEdit: false, canApproveThis: false, canReturn: false, canPay: false, canDownload: false, canCancel: false, ...rights,
});
const claimToPay = (patch: Partial<PettyCashClaim> = {}): PettyCashClaim => ({
  id: "c1", number: 1, reference: "PC-0001", projectId: "p1", projectReference: "PRJ-0007", projectName: "Villa 12", packageId: null, packageName: null, spentOn: "2026-09-25",
  amount: "45.5000", currency: "AED", description: "Taxi to the tile supplier", category: "transport", receiptName: "taxi.png", noReceiptReason: "", status: "approved", claimedBy: "u2",
  claimedByName: "Dana Designer", submittedAt: "2026-09-25T10:00:00Z", decidedByName: "Omar Manager", decidedAt: "2026-09-25T12:00:00Z", decisionNote: "", reimbursedByName: null,
  reimbursedAt: null, reimbursementReference: "", version: 3, ...patch,
});
const paidBack = claimToPay({ id: "c2", number: 2, reference: "PC-0002", description: "Site parking", status: "reimbursed", reimbursedByName: "Fatima Finance",
  reimbursedAt: "2026-09-26T10:00:00Z", reimbursementReference: "Cash box 11" });
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    if (value instanceof Blob) return { ok: true, status: 200, headers: new Headers({ "content-disposition": 'attachment; filename="payment-run-1.csv"' }), blob: async () => value };
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method && init.method !== "GET").map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) }));
const page = (section: FinanceSection = "bills", supplierId: string | null = null) =>
  render(<DesignSystemProvider><FinancePage workspaceId="w" section={section} supplierId={supplierId} /></DesignSystemProvider>);
const grid = (name: string) => screen.findByRole("grid", { name }).catch(() => screen.findByRole("table", { name }));

describe("finance", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(window.history.replaceState).mockClear(); nav.query = ""; });

  it("lists the invoices still to act on with where each stands, and shows why one is held", async () => {
    mount(() => overview());
    page();
    const table = await grid("Supplier invoices");
    expect(table).toHaveTextContent("INV-1 · FAC-PO-2026-00001");
    expect(table).toHaveTextContent("Part paid");
    expect(table).toHaveTextContent("Held");
    expect(table).toHaveTextContent("Oak veneer: invoiced 11 sheets, received 6 sheets");
    expect(table).toHaveTextContent("Overdue");
    expect(table).not.toHaveTextContent("INV-3");
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Show" })).getByRole("radio", { name: "All" }));
    expect(await grid("Supplier invoices")).toHaveTextContent("INV-3");
    expect(screen.getByRole("tab", { name: "Supplier invoices (1)" })).toBeInTheDocument();
  });

  it("approves a held invoice with why, and says who can't", async () => {
    nav.query = "bill=b2";
    let current = detail(held);
    const fetcher = mount((url, body) => {
      if (body?.action === "approve") current = detail({ ...held, status: "approved", approvedByName: "Omar Manager", approvalNote: String(body.note), version: 3 });
      return url.includes("/bills/b2") || body ? current : overview();
    });
    page();
    const sheet = await screen.findByRole("dialog", { name: "Nile Marble · INV-2" });
    expect(within(sheet).getByText("Oak veneer: tax 0%, ordered at 5%")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog", { name: "Approve invoice" });
    expect(within(dialog).getByRole("button", { name: "Approve" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why it's approved/ }), "Supplier agreed the extra");
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "approve", id: "b2", version: 2, note: "Supplier agreed the extra" }));
    expect(await within(sheet).findByText("Omar Manager · Supplier agreed the extra")).toBeInTheDocument();
  });

  it("enters an invoice from an order's lines, flags a total that doesn't add up, and submits it", async () => {
    const fetcher = mount((url, body) => {
      if (url.includes("/suppliers/v1")) return supplier();
      if (url.includes("/orders/o1")) return { order: { id: "o1", number: "FAC-PO-2026-00001", vendorId: "v1", legalEntityId: "e1", currency: "AED", status: "sent", creditDays: 30 },
        lines: [{ orderLineId: "ol1", orderId: "o1", orderNumber: "FAC-PO-2026-00001", projectId: "p1", projectReference: "PRJ-0007", description: "Oak veneer", unit: "sheets",
          ordered: "10.0000", taxRate: "5.0000", accepted: "6.0000", credited: "0.0000", billed: "0.0000", left: "6", netUnitPrice: "90" }] };
      if (body?.action === "save") return detail(bill({ id: String(body.id), status: "draft", version: 1 }));
      if (body?.action === "submit") return detail(bill({ id: String(body.id), status: "approved", version: 2 }));
      return overview({ bills: [] });
    });
    page();
    await userEvent.click(await screen.findByRole("button", { name: "Enter invoice" }));
    const dialog = await screen.findByRole("dialog", { name: "Enter invoice" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Supplier/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Nile Marble" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Invoice number" }), "INV-9");
    await userEvent.click(await within(dialog).findByRole("button", { name: /Add lines from an order/ }));
    await userEvent.click(await screen.findByRole("option", { name: /FAC-PO-2026-00001/ }));
    expect(await within(dialog).findByRole("textbox", { name: "Quantity for Oak veneer" })).toHaveValue("6");
    expect(within(dialog).getByRole("textbox", { name: "Price for Oak veneer" })).toHaveValue("90");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Total on the invoice" }), "570");
    expect(within(dialog).getByText(/The invoice says/)).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Total on the invoice" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Total on the invoice" }), "567");
    expect(within(dialog).queryByText(/The invoice says/)).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(posts(fetcher).map((post) => post.body.action)).toEqual(["save", "submit"]));
    expect(posts(fetcher)[0].body).toMatchObject({ vendorId: "v1", legalEntityId: "e1", currency: "AED", number: "INV-9", statedTotal: "567",
      lines: [{ orderLineId: "ol1", quantity: "6", unitPrice: "90", taxRate: "5" }] });
    expect(posts(fetcher)[0].body.commandId).not.toBe(posts(fetcher)[1].body.commandId);
  });

  it("records a payment against an invoice: by bank only into an approved account", async () => {
    nav.query = "bill=b1";
    const fetcher = mount((url, body) => {
      if (url.includes("/suppliers/v1")) return supplier();
      if (body?.action === "pay") return { payment: { id: body.id }, canManage: true, canApprove: true };
      return url.includes("/bills/b1") ? detail(bill()) : overview();
    });
    page();
    const sheet = await screen.findByRole("dialog", { name: "Nile Marble · INV-1" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Record payment" }));
    const dialog = await screen.findByRole("dialog", { name: /Record payment/ });
    expect(await within(dialog).findByText(/no approved bank account/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Record payment" })).toBeDisabled();
    expect(within(dialog).getByRole("textbox", { name: "Amount" })).toHaveValue("367");
    await userEvent.click(within(dialog).getByRole("button", { name: /How/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Cheque" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reference" }), "CHQ-7");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "pay", vendorId: "v1", legalEntityId: "e1", currency: "AED", amount: "367", method: "cheque",
      reference: "CHQ-7", allocations: [{ invoiceId: "b1", amount: "367" }] }));
  });

  it("issues a client's tax invoice for a milestone from what it will say, then credits it with why", async () => {
    const invoice: ClientInvoice = { id: "i1", legalEntityId: "e1", projectId: "p1", projectReference: "PRJ-0007", caseId: "c1", paymentId: "p2", number: "FAC-INV-2026-00002", issueDate: "2026-09-27",
      dueDate: "2026-10-10", currency: "AED", net: "3738.1000", tax: "186.9000", total: "3925.0000", milestoneTitle: "Before production", customerName: "Maya Client", customerAddress: "",
      customerTaxNumber: "100200300400003", companyName: "Studio Furniture LLC", companyAddress: "", companyTaxNumber: "100999", note: "", status: "issued", issuedByName: "Omar",
      issuedAt: "2026-09-27T10:00:00Z", version: 1, creditNoteId: null, creditNoteNumber: null, creditReason: null, creditedOn: null, paid: "0.0000", balance: "3925.0000", overdue: false };
    const milestone = { projectId: "p1", projectReference: "PRJ-0007", projectName: "Villa 12", caseId: "c1", paymentId: "p2", title: "Before production", amount: "3925.0000", currency: "AED",
      dueDate: "2099-10-10", clientName: "Maya Client", paid: "0.0000" };
    let current: InvoiceState = { invoice, lines: [{ id: "l1", position: 0, description: "Before production", taxRate: "5.0000", net: "3738.1000", tax: "186.9000", total: "3925.0000" }], canManage: true, canCredit: true };
    const fetcher = mount((url, body) => {
      if (url.includes("/api/receivables/milestones/c1/p2")) return { milestone, currency: "AED", net: "3738.1000", tax: "186.9000", total: "3925.0000", pricesIncludeTax: false,
        lines: [{ description: "Before production", rate: "5", net: "3738.1000", tax: "186.9000", total: "3925.0000" }], customer: { name: "Maya Client", address: "" },
        company: { name: "Studio Furniture LLC", address: "", taxNumber: "100999" } };
      if (url.includes("/api/receivables/invoices/i1")) return current;
      if (url.includes("/api/receivables/state")) {
        if (body?.action === "credit") current = { ...current, invoice: { ...invoice, status: "credited", version: 2, creditNoteNumber: "FAC-CN-2026-00001", creditReason: String(body.reason),
          creditedOn: "2026-09-27", balance: "0.0000" }, canCredit: false };
        if (body) return current;
        return { invoices: [invoice], toInvoice: [milestone], canManage: true };
      }
      return overview();
    });
    const view = page("client-invoices");
    const table = await grid("Milestones to invoice");
    expect(table).toHaveTextContent("Maya Client · PRJ-0007 · Villa 12");
    await userEvent.click(within(table).getByRole("button", { name: "Issue invoice" }));
    const dialog = await screen.findByRole("dialog", { name: /Issue invoice/ });
    expect(await within(dialog).findByText(/tax .*186.90 at 5%/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Client tax number" }), "100200300400003");
    await userEvent.click(within(dialog).getByRole("button", { name: "Issue invoice" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "issue", caseId: "c1", paymentId: "p2", customerTaxNumber: "100200300400003", dueDate: "2099-10-10" }));
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/workspace/finance/client-invoices?invoice=i1");
    view.unmount();

    nav.query = "invoice=i1";
    page("client-invoices");
    const sheet = await screen.findByRole("dialog", { name: "FAC-INV-2026-00002 · Maya Client" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Credit invoice" }));
    const credit = await screen.findByRole("dialog", { name: "Credit invoice" });
    await userEvent.type(within(credit).getByRole("textbox", { name: /Why it's credited/ }), "Wrong client name");
    await userEvent.click(within(credit).getByRole("button", { name: "Credit invoice" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "credit", id: "i1", version: 1, reason: "Wrong client name" }));
    expect(await within(sheet).findByText(/Credited by FAC-CN-2026-00001 on .*: Wrong client name/)).toBeInTheDocument();
  });

  it("shows what each supplier is owed, overdue first, with debit notes on their account", async () => {
    mount((url) => (url.includes("/suppliers/v1") ? { ...supplier({ bank: { id: "a1", bankName: "Emirates NBD", last4: "4321", currency: "AED" } }),
      debitNotes: [{ orderLineId: "ol1", orderId: "o1", orderNumber: "FAC-PO-2026-00001", description: "Oak veneer", unit: "sheets", legalEntityId: "e1", currency: "AED", quantity: "2", amount: "189.0000" }] }
      : overview()));
    const view = page("suppliers");
    const table = await grid("Owed to suppliers");
    expect(table).toHaveTextContent("Nile Marble");
    expect(table).toHaveTextContent(/278/);
    expect(table).toHaveTextContent(/475.*held/);
    await userEvent.click(within(table).getByText("Nile Marble"));
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/workspace/finance/suppliers/v1");
    view.unmount();
    page("suppliers", "v1");
    const sheet = await screen.findByRole("dialog", { name: "Nile Marble" });
    expect(await within(sheet).findByText("Emirates NBD ending 4321")).toBeInTheDocument();
    expect(within(within(sheet).getByRole("region", { name: "Debit notes" })).getByText(/189/)).toBeInTheDocument();
    expect(within(sheet).getByText(/189.*in debit notes/)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "INV-4" })).toBeInTheDocument();
  });

  it("shows retention held back until handover apart from what's payable, and releases it per project with why", async () => {
    const kept = bill({ id: "b5", number: "INV-5", paid: "0.0000", balance: "567.0000", retention: "56.7000", retentionHeld: "56.7000", payable: "510.3000" });
    const retentions = [
      { id: "k1", projectId: "p1", projectReference: "PRJ-0007", amount: "54.0000", released: "0.0000", held: "54.0000", releases: [] },
      { id: "k2", projectId: "p2", projectReference: "PRJ-0008", amount: "2.7000", released: "0.0000", held: "2.7000", releases: [] },
    ];
    let current = detail(kept, { retentions, canRelease: true, lines: [{ ...detail(kept).lines[0], retentionPercent: "10.00" }] });
    const fetcher = mount((url, body) => {
      if (body?.action === "release") current = detail({ ...kept, retentionHeld: "54.0000", payable: "513.0000", version: 3 }, { canRelease: true, retentions: [retentions[0],
        { ...retentions[1], released: "2.7000", held: "0.0000", releases: [{ id: "x1", amount: "2.7000", automatic: false, reason: String(body.reason), releasedByName: "Omar Manager",
          releasedAt: "2026-09-27T10:00:00Z" }] }] });
      if (url.includes("/suppliers/v1")) return supplier();
      return url.includes("/bills/b5") || body ? current : overview({ bills: [kept, bill({ id: "b6", number: "INV-6", balance: "20.0000", retentionHeld: "20.0000", payable: "0.0000" })] });
    });
    // Only retention left: it says so, and it's never overdue.
    const view = page();
    expect(within(await grid("Supplier invoices")).getAllByText("Retention")).toHaveLength(1);
    view.unmount();
    nav.query = "bill=b5";
    page();
    const sheet = await screen.findByRole("dialog", { name: "Nile Marble · INV-5" });
    expect(within(sheet).getByText("Retention held").nextSibling).toHaveTextContent(/56\.70/);
    expect(within(sheet).getByText(/10% retention/)).toBeInTheDocument();
    const region = within(sheet).getByRole("region", { name: "Retention" });
    expect(region).toHaveTextContent(/PRJ-0007.*54\.00 held/);
    expect(region).toHaveTextContent(/PRJ-0008.*2\.70 held/);
    // What's paid now leaves the retention out.
    await userEvent.click(within(sheet).getByRole("button", { name: "Record payment" }));
    const payment = await screen.findByRole("dialog", { name: /Record payment/ });
    expect(within(payment).getByRole("textbox", { name: "Amount" })).toHaveValue("510.3");
    await userEvent.click(within(payment).getByRole("button", { name: "Cancel" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "More" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Release retention" }));
    const dialog = await screen.findByRole("dialog", { name: "Release retention" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Project/ }));
    await userEvent.click(await screen.findByRole("option", { name: "PRJ-0008" }));
    expect(within(dialog).getByRole("textbox", { name: "Amount" })).toHaveValue("2.7");
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Amount" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Amount" }), "3");
    expect(within(dialog).getByRole("button", { name: "Release" })).toBeDisabled();
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Amount" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Amount" }), "2.7");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why it's released/ }), "Their snags closed early");
    await userEvent.click(within(dialog).getByRole("button", { name: "Release" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "release", id: "b5", version: 2, projectId: "p2", amount: "2.7", reason: "Their snags closed early" }));
    expect(await within(sheet).findByText(/2\.70 released by Omar Manager: Their snags closed early/)).toBeInTheDocument();
  });

  it("builds a run from approved invoices with what each can be paid now, adds everything due, and submits it", async () => {
    const fetcher = mount((url, body) => {
      if (body?.action === "save") return runState({ id: String(body.id), version: 1 }, { canEdit: true, canCancel: true });
      if (body?.action === "submit") return runState({ id: String(body.id), status: "submitted", version: 2 }, { canCancel: true });
      return overview({ runs: [runRow({ id: "r0", number: 7, status: "submitted", preparedByName: "Omar Manager" })] });
    });
    page("runs");
    const table = await grid("Payment runs");
    expect(table).toHaveTextContent("Run 7");
    expect(table).toHaveTextContent("Submitted");
    expect(screen.getByRole("tab", { name: "Payment runs (1)" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New run" }));
    const sheet = await screen.findByRole("dialog", { name: "New run" });
    // Approved invoices with something to pay now, earliest due first; held and paid ones don't show.
    const choices = within(sheet).getAllByRole("checkbox").map((box) => box.closest("label")?.textContent ?? "");
    expect(choices).toEqual([expect.stringContaining("INV-4"), expect.stringContaining("INV-1")]);
    expect(within(sheet).getByRole("button", { name: "Submit" })).toBeDisabled();
    await userEvent.click(within(sheet).getByRole("button", { name: "Add all due" }));
    expect(within(sheet).getByRole("checkbox", { name: /INV-4/ })).toBeChecked();
    expect(within(sheet).getByRole("checkbox", { name: /INV-1/ })).not.toBeChecked();
    expect(within(sheet).getByRole("textbox", { name: "Amount for INV-4" })).toHaveValue("100");
    await userEvent.click(within(sheet).getByRole("checkbox", { name: /INV-1/ }));
    const amount = within(sheet).getByRole("textbox", { name: "Amount for INV-1" });
    expect(amount).toHaveValue("367");
    await userEvent.clear(amount);
    await userEvent.type(amount, "367.01");
    expect(within(sheet).getByRole("button", { name: "Submit" })).toBeDisabled();
    await userEvent.clear(amount);
    await userEvent.type(amount, "300");
    expect(within(sheet).getByText(/400\.00/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(posts(fetcher).map((post) => post.body.action)).toEqual(["save", "submit"]));
    const [save, submit] = posts(fetcher);
    expect(save.body).toMatchObject({ items: [{ invoiceId: "b4", amount: "100" }, { invoiceId: "b1", amount: "300" }] });
    expect(submit.body).toMatchObject({ id: save.body.id, version: 1 });
    expect(save.body.commandId).not.toBe(submit.body.commandId);
    await waitFor(() => expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", `/workspace/finance/runs?run=${save.body.id}`));
  });

  it("approves a run someone else prepared, downloads it for the bank, and marks it paid with the bank's reference", async () => {
    nav.query = "run=r1";
    let current = runState({ status: "submitted", version: 2 }, { canApproveThis: true, canReturn: true, canCancel: true });
    const fetcher = mount((url, body) => {
      if (body?.action === "approve") current = runState({ status: "approved", approvedByName: "Omar Manager", version: 3 }, { canPay: true, canDownload: true, canReturn: true, canCancel: true });
      if (body?.action === "paid") current = runState({ status: "paid", paidOn: String(body.paidOn), paidByName: "Dana Designer", version: 4 });
      if (url.includes("/runs/r1/file")) return new Blob(["Supplier,Account name\r\n"], { type: "text/csv" });
      return url.includes("/runs/r1") || body ? current : overview({ runs: [current.run] });
    });
    const created = vi.fn(() => "blob:run");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: () => undefined }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    page("runs");
    const sheet = await screen.findByRole("dialog", { name: "Run 1" });
    expect(within(sheet).getByRole("region", { name: "Payments" })).toHaveTextContent(/Nile Marble · Studio Furniture.*INV-4.*Emirates NBD ending 4321/);
    await userEvent.click(within(sheet).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "approve", id: "r1", version: 2 }));
    await userEvent.click(await within(sheet).findByRole("button", { name: "Download file" }));
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(click).toHaveBeenCalled();
    await userEvent.click(within(sheet).getByRole("button", { name: "Mark paid" }));
    const dialog = await screen.findByRole("dialog", { name: "Mark paid" });
    const reference = within(dialog).getByRole("textbox", { name: "Reference for Nile Marble" });
    expect(reference).toHaveValue("Run 1: INV-4");
    await userEvent.clear(reference);
    expect(within(dialog).getByRole("button", { name: "Mark paid" })).toBeDisabled();
    await userEvent.type(reference, "TT-100");
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark paid" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "paid", id: "r1", version: 3,
      references: [{ vendorId: "v1", legalEntityId: "e1", currency: "AED", reference: "TT-100" }] }));
    expect(posts(fetcher).at(-1)!.body.paidOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    click.mockRestore();
  });

  it("sends a submitted run back with what to change, and says why a bank change stops it", async () => {
    nav.query = "run=r1";
    const waiting = runState({ status: "submitted", version: 2 }, { canApproveThis: true, canReturn: true, canCancel: true });
    waiting.payments[0] = { ...waiting.payments[0], bankChangePending: true };
    let current = waiting;
    const fetcher = mount((url, body) => {
      if (body?.action === "approve") return new Error("New bank details for Nile Marble are waiting for approval; decide them first.");
      if (body?.action === "return") current = runState({ status: "draft", returnNote: String(body.note), version: 3 }, { canEdit: false, canCancel: true });
      return url.includes("/runs/r1") || body ? current : overview({ runs: [current.run] });
    });
    page("runs");
    const sheet = await screen.findByRole("dialog", { name: "Run 1" });
    expect(within(sheet).getByText("New bank details for Nile Marble are waiting for approval.")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Approve" }));
    expect(await within(sheet).findByText(/decide them first/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "More" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Send back" }));
    const dialog = await screen.findByRole("dialog", { name: "Send back run" });
    expect(within(dialog).getByRole("button", { name: "Send back" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /What to change/ }), "Pay INV-4 next week");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "return", id: "r1", version: 2, note: "Pay INV-4 next week" }));
    expect(await within(sheet).findByText("Sent back: Pay INV-4 next week")).toBeInTheDocument();
  });

  it("records only advances where invoices are paid through runs, and shows retention on what each supplier is owed", async () => {
    mount((url, body) => (url.includes("/suppliers/v1") ? { ...supplier({ bank: { id: "a1", bankName: "Emirates NBD", last4: "4321", currency: "AED" } }), runsRequired: true,
      balances: [{ ...overview().suppliers[0], retention: "56.7000" }] } : body ? { payment: { id: body.id }, canManage: true, canApprove: true }
      : overview({ runsRequired: true, suppliers: [{ ...overview().suppliers[0], retention: "56.7000" }] })));
    const view = page("suppliers");
    expect(await grid("Owed to suppliers")).toHaveTextContent(/56\.70 retention/);
    view.unmount();
    page("suppliers", "v1");
    const sheet = await screen.findByRole("dialog", { name: "Nile Marble" });
    expect(await within(sheet).findByText(/56\.70 retention held/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Record payment" }));
    const dialog = await screen.findByRole("dialog", { name: /Record payment/ });
    expect(await within(dialog).findByText(/Invoices are paid through payment runs/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("region", { name: "Invoices it pays" })).toBeNull();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Amount" }), "50");
    expect(within(dialog).getByRole("button", { name: "Record payment" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: /Advance on an order/ }));
    await userEvent.click(await screen.findByRole("option", { name: "FAC-PO-2026-00001" }));
    expect(within(dialog).getByRole("button", { name: "Record payment" })).toBeEnabled();
  });

  it("turns on paying invoices only through approved runs in the purchasing settings", async () => {
    const settings: PurchasingSettings = { approvalThreshold: null, requireMaterialSignoff: true, requireApprovedSupplier: true, requireInspection: true, receiveTolerancePercent: "0.00",
      requireSitePhoto: true, stockAdjustApprovalValue: null, orderAheadDays: 14, invoiceTolerancePercent: "1.00", spendingGuard: "off", paymentRunsRequired: false, version: 4 };
    const fetcher = mount((_url, body) => (body ? { ...settings, paymentRunsRequired: body.paymentRunsRequired === true, version: 5 } : { settings, canManage: true, currency: "AED" }));
    render(<DesignSystemProvider><PurchasingSettingsPage workspaceId="w" /></DesignSystemProvider>);
    const toggle = await screen.findByRole("switch", { name: "Pay through approved runs" });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ version: 4, paymentRunsRequired: true, invoiceTolerancePercent: "1" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Pay through approved runs" })).toBeChecked());
  });

  it("lists approved petty cash to reimburse across projects, oldest decision first, and everything with All", async () => {
    mount((url) => (url.includes("/api/petty-cash/state") ? { claims: [claimToPay({ id: "c3", reference: "PC-0003", description: "Parking", decidedAt: "2026-09-26T09:00:00Z" }), claimToPay(), paidBack],
      canReimburse: true } : overview()));
    page("petty-cash");
    const table = await grid("Petty cash");
    expect(within(table).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([expect.stringMatching(/Taxi to the tile supplier.*PC-0001.*PRJ-0007 · Villa 12.*Dana Designer/),
      expect.stringContaining("PC-0003")]);
    expect(table).not.toHaveTextContent("PC-0002");
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Show" })).getByRole("radio", { name: "All" }));
    expect(await grid("Petty cash")).toHaveTextContent(/PC-0002.*Reimbursed/);
    await userEvent.click(within(await grid("Petty cash")).getByText("Taxi to the tile supplier"));
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/workspace/finance/petty-cash?claim=c1");
  });

  it("reimburses an approved claim once, with the payment's reference", async () => {
    nav.query = "claim=c1";
    let claims = [claimToPay(), paidBack];
    const fetcher = mount((url, body) => {
      if (!url.includes("/api/petty-cash/state")) return overview();
      if (body) claims = claims.map((row) => (row.id === body.claimId ? { ...row, status: "reimbursed" as const, reimbursedByName: "Fatima Finance", reimbursedAt: "2026-09-27T12:00:00Z",
        reimbursementReference: String(body.reference), version: 4 } : row));
      return { claims, canReimburse: true };
    });
    page("petty-cash");
    const sheet = await screen.findByRole("dialog", { name: "PC-0001 · Dana Designer" });
    expect(within(sheet).getByRole("link", { name: "taxi.png" })).toHaveAttribute("href", expect.stringContaining("/api/petty-cash/claims/c1/receipt"));
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Reference" }), "Cash box 12");
    await userEvent.click(within(sheet).getByRole("button", { name: "Reimburse" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ url: expect.stringContaining("/api/petty-cash/state"),
      body: { claimId: "c1", version: 3, reference: "Cash box 12", commandId: expect.any(String) } }));
    expect(await within(sheet).findByText(/Fatima Finance · Cash box 12/)).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Reimburse" })).toBeNull();
  });
});
