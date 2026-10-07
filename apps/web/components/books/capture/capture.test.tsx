import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { BillCoding, CaptureState } from "@/lib/books/capture-client";
import type { Bill, BillState, PayablesState, SupplierState } from "@/lib/payables/types";
import { payablesApi } from "@/lib/payables/client";
import { BillEditor } from "../../finance/bill-editor";
import { FinancePage } from "../../finance/finance-page";

const nav = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/finance", useSearchParams: () => new URLSearchParams(nav.query) }));

const vendors = [{ id: "v1", name: "Al Noor Joinery Workshop", currency: "AED" }, { id: "v2", name: "Ritver Paints", currency: "AED" }];
const companies = [{ id: "e1", name: "Studio Interiors", currency: "AED" }];
const overview: PayablesState = { bills: [], payments: [], runs: [], runsRequired: false, vendors, companies, canManage: true, canApprove: true, suppliers: [] };
const bill = (patch: Partial<Bill> = {}): Bill => ({
  id: "b9", vendorId: "v1", supplierName: "Al Noor Joinery Workshop", legalEntityId: "e1", companyName: "Studio Interiors", number: "INV-2026-0418", invoiceDate: "2026-10-04",
  dueDate: "2026-11-03", currency: "AED", net: "25350.0000", tax: "1267.5000", total: "26617.5000", statedTotal: "26617.5000", status: "draft", holdReasons: "", approvedByName: null,
  approvedAt: null, approvalNote: "", cancelReason: null, fileName: null, createdBy: "u1", createdByName: "Fatima Finance", createdAt: "2026-10-05T08:00:00Z", version: 1, paid: "0.0000",
  balance: "26617.5000", orders: ["PO-0042"], retention: "0.0000", retentionHeld: "0.0000", reserved: "0.0000", payable: "0.0000", ...patch,
});
const draft = (patch: Partial<Bill> = {}): BillState => ({
  bill: bill(patch), payments: [], retentions: [], canManage: true, canApprove: true, canEdit: true, canApproveThis: false, canCancel: true, canPay: false, canRelease: false,
  lines: [
    { id: "l1", position: 0, orderLineId: "ol1", orderId: "o1", orderNumber: "PO-0042", projectId: "p1", projectReference: "PRJ-0012", description: "Oak veneer MDF 18mm", unit: "sheets",
      quantity: "20.0000", unitPrice: "1250.0000", taxRate: "5.0000", net: "25000.0000", tax: "1250.0000", total: "26250.0000", retentionPercent: "0.00", taxCode: "SR", booksAccountId: null },
    { id: "l2", position: 1, orderLineId: null, orderId: null, orderNumber: null, projectId: null, projectReference: null, description: "Delivery to site", unit: null,
      quantity: "1.0000", unitPrice: "350.0000", taxRate: "5.0000", net: "350.0000", tax: "17.5000", total: "367.5000", retentionPercent: "0.00", taxCode: "SR", booksAccountId: null },
  ],
});
const supplier = { supplier: { id: "v1", name: "Al Noor Joinery Workshop", creditDays: 30, paymentTerms: "credit", bank: null, bankChangePending: false }, orders: [], balances: [], bills: [],
  payments: [], debitNotes: [], runsRequired: false, canManage: true, canApprove: true } as unknown as SupplierState;
const coding: BillCoding = { enabled: true, ledgerOn: true,
  taxCodes: [{ code: "RC", name: "Reverse charge", rate: "5.0000", treatment: "reverse_charge" }, { code: "SR", name: "Standard rated", rate: "5.0000", treatment: "standard" },
    { code: "ZR", name: "Zero rated", rate: "0.0000", treatment: "zero" }],
  accounts: [{ id: "a5400", code: "5400", name: "Site expenses", type: "expense" }, { id: "a6100", code: "6100", name: "General expenses", type: "expense" }] };
const capture = (patch: Partial<CaptureState["capture"]> = {}, rest: Partial<CaptureState> = {}): CaptureState => ({
  capture: { id: "c1", status: "drafted", fileName: "bill.jpg", contentType: "image/jpeg", byteSize: 1200, model: "gemini:gemini-3-flash", confidence: "0.9100", error: null, billId: "b9",
    legalEntityId: "e1", matchedVendorId: "v1", matchedOrderId: "o1", confirmedBy: null, confirmedAt: null, createdByName: "Fatima Finance", createdAt: "2026-10-05T08:00:00Z", version: 3, ...patch },
  reading: { supplierName: "Al Noor Joinery Workshop L.L.C", supplierNameAlt: "ورشة النور للنجارة ذ.م.م", supplierTaxNumber: "100234567890003", invoiceNumber: "INV-2026-0418", total: "26617.50",
    currency: "AED", confidence: 0.91 },
  proposal: { vendorId: "v1", vendorName: "Al Noor Joinery Workshop", vendorMatch: "tax_number", legalEntityId: "e1", currency: "AED", orderId: "o1", orderNumber: "PO-0042",
    number: "INV-2026-0418", invoiceDate: "2026-10-04", dueDate: "2026-11-03", statedTotal: "26617.50", lines: [], warnings: [], hints: { dueDate: "check" }, ready: true },
  ...rest,
});

type Call = { url: string; method: string; body: unknown };
const mount = (respond: (url: string, method: string, body: unknown) => unknown) => {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ url: String(url), method, body });
    const value = respond(String(url), method, body);
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  }));
  return calls;
};
const posts = (calls: Call[]) => calls.filter((call) => call.method === "POST");
const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "bill.jpg", { type: "image/jpeg" });

describe("bill capture: From photo", () => {
  afterEach(() => { vi.unstubAllGlobals(); nav.query = ""; });

  it("reads a photographed bill into its draft, shows the original beside it with what to check, and links the photo when the person saves", async () => {
    const calls = mount((url, method, body) => {
      if (url.includes("/api/books/capture/captures?") && method === "POST") return capture();
      if (url.includes("/api/books/capture/captures/c1") && method === "POST") return capture({ confirmedBy: "u1", confirmedAt: "2026-10-05T08:05:00Z", version: 4 });
      if (url.includes("/bill-coding/e1")) return coding;
      if (url.includes("/suppliers/v1")) return supplier;
      if (url.includes("/bills/b9")) return draft({ version: (body as { action?: string } | undefined)?.action ? 2 : 1 });
      if ((body as { action?: string } | undefined)?.action === "save") return draft({ version: 2 });
      return overview;
    });
    render(<DesignSystemProvider><FinancePage workspaceId="w" section="bills" supplierId={null} /></DesignSystemProvider>);
    await screen.findByRole("button", { name: "From photo" });
    await userEvent.upload(screen.getByLabelText("Photo or PDF of the bill"), photo());

    const dialog = await screen.findByRole("dialog", { name: "Edit invoice" });
    const original = within(dialog).getByRole("complementary", { name: "The original bill" });
    expect(within(original).getByRole("img", { name: "Photo of the bill" })).toHaveAttribute("src", expect.stringContaining("/api/books/capture/captures/c1/file?workspaceId=w"));
    expect(within(original).getByText("Read by Woddy, 91% sure. Check it before saving.")).toBeInTheDocument();
    expect(within(dialog).getByText("Woddy wasn't sure. Check it.")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Invoice number" })).toHaveValue("INV-2026-0418");
    // Each line names its tax treatment and account from the company's Ledger.
    expect(await within(dialog).findByRole("button", { name: /Tax treatment for Oak veneer MDF 18mm/ })).toHaveTextContent("SR · Standard rated");
    await userEvent.click(within(dialog).getByRole("button", { name: /Account for Delivery to site/ }));
    await userEvent.click(await screen.findByRole("option", { name: "5400 · Site expenses" }));

    await userEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(posts(calls).map((call) => (call.body as { action?: string })?.action ?? "upload")).toEqual(["upload", "save", "confirm"]));
    const [upload, save, confirm] = posts(calls);
    expect(upload.body).toBeInstanceOf(FormData);
    expect(save.body).toMatchObject({ action: "save", id: "b9", version: 1, vendorId: "v1", number: "INV-2026-0418",
      lines: [{ orderLineId: "ol1", taxCode: "SR", booksAccountId: null }, { description: "Delivery to site", taxCode: "SR", booksAccountId: "a5400" }] });
    expect(confirm).toMatchObject({ url: expect.stringContaining("/api/books/capture/captures/c1?workspaceId=w"), body: { action: "confirm", version: 3, billId: "b9" } });
  });

  it("fills a new invoice from what Woddy read when it couldn't enter it, and says why", async () => {
    mount((url, method) => {
      if (url.includes("/api/books/capture/captures?") && method === "POST") return capture({ status: "read", billId: null, matchedVendorId: null }, { proposal: { ...capture().proposal!,
        vendorId: null, vendorName: null, vendorMatch: null, ready: false, hints: { invoiceNumber: "check" },
        lines: [{ orderLineId: null, orderNumber: null, projectId: null, projectReference: null, description: "Glass partition", unit: "", quantity: "2", unitPrice: "1500", taxRate: "5", taxCode: "SR" }],
        warnings: [{ code: "supplier_not_found", name: "Unknown Glass FZE", taxNumber: null }, { code: "total_mismatch", stated: "3200.00", computed: "3150.00" }] },
        reading: { ...capture().reading!, supplierName: "Unknown Glass FZE" } });
      if (url.includes("/bill-coding/e1")) return coding;
      return overview;
    });
    render(<DesignSystemProvider><FinancePage workspaceId="w" section="bills" supplierId={null} /></DesignSystemProvider>);
    await screen.findByRole("button", { name: "From photo" });
    await userEvent.upload(screen.getByLabelText("Photo or PDF of the bill"), photo());
    const dialog = await screen.findByRole("dialog", { name: "Enter invoice" });
    expect(within(dialog).getByText("Unknown Glass FZE isn't one of your suppliers yet. Choose the supplier.")).toBeInTheDocument();
    expect(within(dialog).getByText(/The bill says .*3,200\.00.*; its lines add up to .*3,150\.00/)).toBeInTheDocument();
    expect(within(dialog).getByText("Woddy read Unknown Glass FZE. Choose the supplier.")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "What" })).toHaveValue("Glass partition");
    expect(within(dialog).getByText("Woddy wasn't sure. Check it.")).toBeInTheDocument();
    // Once the person changes what Woddy read, the hint goes.
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Invoice number" }), "A");
    expect(within(dialog).queryByText("Woddy wasn't sure. Check it.")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Submit" })).toBeDisabled();
  });

  it("says when a photo was already captured, and shows why an upload failed", async () => {
    let refuse = true;
    mount((url, method) => {
      if (url.includes("/api/books/capture/captures?") && method === "POST") {
        if (refuse) { refuse = false; return new Error("Choose a JPEG, PNG or HEIC photo, or a PDF."); }
        return capture({}, { duplicate: true });
      }
      if (url.includes("/bills/b9")) return draft();
      if (url.includes("/bill-coding/e1")) return coding;
      if (url.includes("/suppliers/v1")) return supplier;
      return overview;
    });
    render(<DesignSystemProvider><FinancePage workspaceId="w" section="bills" supplierId={null} /></DesignSystemProvider>);
    await screen.findByRole("button", { name: "From photo" });
    await userEvent.upload(screen.getByLabelText("Photo or PDF of the bill"), photo());
    expect(await screen.findByText("Choose a JPEG, PNG or HEIC photo, or a PDF.")).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText("Photo or PDF of the bill"), photo());
    const dialog = await screen.findByRole("dialog", { name: "Edit invoice" });
    expect(within(dialog).getByText("This bill was already captured.")).toBeInTheDocument();
  });

  it("opens the bill a reading notice links to", async () => {
    nav.query = "capture=7f2c1d34-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    mount((url) => {
      if (url.includes("/api/books/capture/captures/7f2c1d34")) return capture({ id: "7f2c1d34-1a2b-4c3d-8e9f-0a1b2c3d4e5f" });
      if (url.includes("/bills/b9")) return draft();
      if (url.includes("/bill-coding/e1")) return coding;
      if (url.includes("/suppliers/v1")) return supplier;
      return overview;
    });
    render(<DesignSystemProvider><FinancePage workspaceId="w" section="bills" supplierId={null} /></DesignSystemProvider>);
    expect(await screen.findByRole("dialog", { name: "Edit invoice" })).toBeInTheDocument();
  });
});

describe("bill lines: tax treatment and account", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("takes the standard code at the line's rate until the person picks one, and sends both with the line", async () => {
    const calls = mount((url, _method, body) => {
      if (url.includes("/bill-coding/e1")) return coding;
      if ((body as { action?: string } | undefined)?.action === "save") return draft({ version: 2 });
      return supplier;
    });
    const existing = draft();
    existing.lines = [{ ...existing.lines[1], taxCode: null }];
    render(<DesignSystemProvider><BillEditor api={payablesApi("w")} vendors={vendors} companies={companies} existing={existing} onClose={vi.fn()} onSaved={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Edit invoice" });
    const treatment = () => within(dialog).getByRole("button", { name: /Tax treatment for Delivery to site/ });
    await waitFor(() => expect(treatment()).toHaveTextContent("SR · Standard rated"));
    // No tax: zero, exempt or out of scope is the person's call.
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Tax for Delivery to site" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Tax for Delivery to site" }), "0");
    expect(treatment()).toHaveTextContent("No tax code");
    await userEvent.click(treatment());
    await userEvent.click(await screen.findByRole("option", { name: "RC · Reverse charge" }));
    // Picked by hand, the code stays when the rate changes.
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Tax for Delivery to site" }), "5");
    expect(treatment()).toHaveTextContent("RC · Reverse charge");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toMatchObject({ action: "save", lines: [{ description: "Delivery to site", taxRate: "05", taxCode: "RC", booksAccountId: null }] });
  });

  it("shows no pickers when the company doesn't keep its books in Wodana", async () => {
    mount((url) => (url.includes("/bill-coding/") ? { enabled: false, ledgerOn: false, taxCodes: [], accounts: [] } : supplier));
    render(<DesignSystemProvider><BillEditor api={payablesApi("w")} vendors={vendors} companies={companies} existing={draft()} onClose={vi.fn()} onSaved={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Edit invoice" });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/bill-coding/e1"), expect.anything()));
    expect(within(dialog).queryByRole("button", { name: /Tax treatment for/ })).toBeNull();
  });
});
