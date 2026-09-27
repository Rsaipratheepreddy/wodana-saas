import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { Bill, BillState, PayablesState, SupplierState } from "@/lib/payables/types";
import type { FinanceSection } from "@/lib/payables/sections";
import { FinancePage } from "./finance-page";

const nav = vi.hoisted(() => ({ replace: vi.fn(), query: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }), usePathname: () => "/workspace/finance", useSearchParams: () => new URLSearchParams(nav.query) }));

const bill = (patch: Partial<Bill> = {}): Bill => ({
  id: "b1", vendorId: "v1", supplierName: "Nile Marble", legalEntityId: "e1", companyName: "Studio Furniture", number: "INV-1", invoiceDate: "2026-09-20", dueDate: "2099-10-20",
  currency: "AED", net: "540.0000", tax: "27.0000", total: "567.0000", statedTotal: null, status: "approved", holdReasons: "", approvedByName: null, approvedAt: "2026-09-21T10:00:00Z",
  approvalNote: "", cancelReason: null, fileName: null, createdBy: "u2", createdByName: "Dana Designer", createdAt: "2026-09-21T09:00:00Z", version: 2, paid: "200.0000", balance: "367.0000",
  orders: ["FAC-PO-2026-00001"], ...patch,
});
const held = bill({ id: "b2", number: "INV-2", status: "held", holdReasons: "Oak veneer: invoiced 11 sheets, received 6 sheets\nOak veneer: tax 0%, ordered at 5%", paid: "0.0000", balance: "475.0000", total: "475.0000" });
const paid = bill({ id: "b3", number: "INV-3", paid: "52.5000", balance: "0.0000", total: "52.5000" });
const late = bill({ id: "b4", number: "INV-4", dueDate: "2020-01-01", paid: "0.0000", balance: "100.0000", total: "100.0000" });
const vendors = [{ id: "v1", name: "Nile Marble", currency: "AED" }];
const companies = [{ id: "e1", name: "Studio Furniture", currency: "AED" }];
const overview = (patch: Partial<PayablesState> = {}): PayablesState => ({
  bills: [bill(), held, paid, late], payments: [], vendors, companies, canManage: true, canApprove: true,
  suppliers: [{ vendorId: "v1", supplierName: "Nile Marble", legalEntityId: "e1", companyName: "Studio Furniture", currency: "AED", invoiced: "719.5000", paid: "252.5000",
    debited: "189.0000", owed: "278.0000", overdue: "100.0000", held: "475.0000" }], ...patch,
});
const detail = (value: Bill, extra: Partial<BillState> = {}): BillState => ({
  bill: value, lines: [{ id: "l1", position: 0, orderLineId: "ol1", orderId: "o1", orderNumber: "FAC-PO-2026-00001", projectId: "p1", projectReference: "PRJ-0007", description: "Oak veneer",
    unit: "sheets", quantity: "6.0000", unitPrice: "90.0000", taxRate: "5.0000", net: "540.0000", tax: "27.0000", total: "567.0000" }],
  payments: [], canManage: true, canApprove: true, canEdit: ["draft", "held"].includes(value.status), canApproveThis: value.status === "held", canCancel: value.paid === "0.0000",
  canPay: value.status === "approved" && value.balance !== "0.0000", ...extra,
});
const supplier = (patch: Partial<SupplierState["supplier"]> = {}): SupplierState => ({
  supplier: { id: "v1", name: "Nile Marble", creditDays: 30, paymentTerms: "credit", bank: null, bankChangePending: false, ...patch },
  orders: [{ id: "o1", number: "FAC-PO-2026-00001", legalEntityId: "e1", currency: "AED", status: "sent", total: "945.0000" }],
  balances: overview().suppliers, bills: [bill(), late], payments: [], debitNotes: [], canManage: true, canApprove: true,
});
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
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
  afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); nav.query = ""; });

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
    const invoice = { id: "i1", legalEntityId: "e1", projectId: "p1", projectReference: "PRJ-0007", caseId: "c1", paymentId: "p2", number: "FAC-INV-2026-00002", issueDate: "2026-09-27",
      dueDate: "2026-10-10", currency: "AED", net: "3738.1000", tax: "186.9000", total: "3925.0000", milestoneTitle: "Before production", customerName: "Maya Client", customerAddress: "",
      customerTaxNumber: "100200300400003", companyName: "Studio Furniture LLC", companyAddress: "", companyTaxNumber: "100999", note: "", status: "issued" as const, issuedByName: "Omar",
      issuedAt: "2026-09-27T10:00:00Z", version: 1, creditNoteId: null, creditNoteNumber: null, creditReason: null, creditedOn: null, paid: "0.0000", balance: "3925.0000", overdue: false };
    const milestone = { projectId: "p1", projectReference: "PRJ-0007", projectName: "Villa 12", caseId: "c1", paymentId: "p2", title: "Before production", amount: "3925.0000", currency: "AED",
      dueDate: "2099-10-10", clientName: "Maya Client", paid: "0.0000" };
    let current = { invoice, lines: [{ id: "l1", position: 0, description: "Before production", taxRate: "5.0000", net: "3738.1000", tax: "186.9000", total: "3925.0000" }], canManage: true, canCredit: true };
    const fetcher = mount((url, body) => {
      if (url.includes("/api/receivables/milestones/c1/p2")) return { milestone, currency: "AED", net: "3738.1000", tax: "186.9000", total: "3925.0000", pricesIncludeTax: false,
        lines: [{ description: "Before production", rate: "5", net: "3738.1000", tax: "186.9000", total: "3925.0000" }], customer: { name: "Maya Client", address: "" },
        company: { name: "Studio Furniture LLC", address: "", taxNumber: "100999" } };
      if (url.includes("/api/receivables/invoices/i1")) return current;
      if (url.includes("/api/receivables/state")) {
        if (body?.action === "credit") current = { ...current, invoice: { ...invoice, status: "credited" as never, version: 2, creditNoteNumber: "FAC-CN-2026-00001", creditReason: String(body.reason),
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
    expect(nav.replace).toHaveBeenLastCalledWith("/workspace/finance/client-invoices?invoice=i1", { scroll: false });
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
    expect(nav.replace).toHaveBeenLastCalledWith("/workspace/finance/suppliers/v1", { scroll: false });
    view.unmount();
    page("suppliers", "v1");
    const sheet = await screen.findByRole("dialog", { name: "Nile Marble" });
    expect(await within(sheet).findByText("Emirates NBD ending 4321")).toBeInTheDocument();
    expect(within(within(sheet).getByRole("region", { name: "Debit notes" })).getByText(/189/)).toBeInTheDocument();
    expect(within(sheet).getByText(/189.*in debit notes/)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "INV-4" })).toBeInTheDocument();
  });
});
