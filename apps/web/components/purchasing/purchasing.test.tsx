import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type {
  DeliveriesState, Need, OrdersState, OrderState, PriceRequestState, ReceiptState, ReceivingForm, Supplier, SupplierControlsState, SupplierImportPlan, SupplierReturnState, SupplierState, UnmatchedState,
} from "@/lib/purchasing/types";
import { PurchasingPage, type PurchasingSection } from "./purchasing-page";

const nav = vi.hoisted(() => ({ replace: vi.fn(), query: "" }));
vi.spyOn(window.history, "replaceState");
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }), usePathname: () => "/workspace/purchasing", useSearchParams: () => new URLSearchParams(nav.query) }));

const supplier = (patch: Partial<Supplier>): Supplier => ({
  id: "s1", code: "NILE", name: "Nile Marble & Granite", legalName: null, categories: ["Marble", "Travertine"], approval: "approved", preferredFor: ["Marble"], approvalNote: "",
  approvalAt: "2026-09-20T10:00:00Z", approvalByName: "Dara Director", paymentTerms: "split", advancePercent: "50.00", creditDays: null, termsNote: "", retentionPercent: "0.00", deal: "discount", dealPercent: "10.00",
  dealNote: "", contactName: "Mohamed", phone: "+971503175797", email: "sales@nile.example", locality: "Al Quoz", entityIds: ["f"], taxRegistrationNumber: null, currency: null, notes: "",
  status: "active", archivedReason: null, version: 3, ...patch,
});
const state = (patch: Partial<SupplierState> = {}): SupplierState => ({
  suppliers: [supplier({}), supplier({ id: "s2", code: "RITVER", name: "Ritver Paints", categories: ["Paint"], approval: "pending", preferredFor: [], approvalByName: null, approvalAt: null,
    paymentTerms: "credit", advancePercent: null, creditDays: 30, deal: "on_request", dealPercent: null, contactName: null, phone: null, entityIds: ["f", "i"] }),
    supplier({ id: "s3", code: "OLD", name: "Old Glass Co", categories: ["Glass"], status: "archived", archivedReason: "Closed" })],
  categories: ["Glass", "Marble", "Paint", "Travertine"], entities: [{ id: "f", code: "FAC", name: "Studio Furniture Manufacturing" }, { id: "i", code: "INT", name: "Studio Interiors Trading" }],
  canManage: true, canApprove: true, ...patch,
});
const controls = (patch: Partial<SupplierControlsState> = {}): SupplierControlsState => ({
  supplier: supplier({ id: "s2", name: "Ritver Paints" }), documents: [], bankAccounts: [],
  scorecard: { orders: [], deliveredLines: 0, onTimePercent: null, received: "0", rejected: "0", rejectPercent: null, returns: 0, priceRequests: 0, replyPercent: null, replyDays: null },
  openOrders: [], contracts: [], catalogItems: [{ id: "c1", name: "Wood glue", unit: "pcs" }], canManage: true, canApprove: true, me: "u2", ...patch,
});
/** Supplier detail (documents, bank, performance) answers for /suppliers/<id>; everything else as given. */
const withControls = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown, detail: () => unknown = () => controls()) =>
  (url: string, body: Record<string, unknown> | undefined) => (/\/suppliers\/s\d\?/.test(url) && !body ? detail() : respond(url, body));
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return value instanceof Error ? { ok: false, status: (value as Error & { status?: number }).status ?? 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST" && typeof init.body === "string")
  .map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) }));
const uploads = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST" && init.body instanceof FormData).map(([url, init]) => ({ url: String(url), file: (init!.body as FormData).get("file") as File }));
const page = (section: PurchasingSection = "suppliers") => render(<DesignSystemProvider><PurchasingPage workspaceId="w" section={section} /></DesignSystemProvider>);

describe("access", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tells someone without purchasing access so, instead of an error with a retry that can't help", async () => {
    mount(() => Object.assign(new Error("Permissions required: purchasing.view"), { status: 403 }));
    page("to-order");
    expect(await screen.findByText("You don't have access to this")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("still offers a retry when Purchasing fails to load", async () => {
    mount(() => Object.assign(new Error("Something broke"), { status: 500 }));
    page("orders");
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("suppliers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists suppliers in use with approval, terms, deal and companies, and filters them", async () => {
    mount(withControls(() => state()));
    page();
    const grid = await screen.findByRole("grid", { name: "Suppliers" }).catch(() => screen.findByRole("table", { name: "Suppliers" }));
    await within(grid).findByText("Nile Marble & Granite");
    expect(grid).toHaveTextContent("Preferred for Marble");
    expect(grid).toHaveTextContent("50% advance, rest on delivery");
    expect(grid).toHaveTextContent("10% discount");
    expect(grid).toHaveTextContent("30 days credit");
    expect(grid).toHaveTextContent("FAC, INT");
    expect(grid).not.toHaveTextContent("Old Glass Co");
    await userEvent.click(screen.getByRole("button", { name: "Any approval" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Not reviewed" }));
    await waitFor(() => expect(grid).not.toHaveTextContent("Nile Marble & Granite"));
    expect(grid).toHaveTextContent("Ritver Paints");
    await userEvent.click(screen.getByRole("radio", { name: "Archived" }));
    await userEvent.click(screen.getByRole("button", { name: "Not reviewed" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Any approval" }));
    expect(await screen.findByText("Old Glass Co")).toBeInTheDocument();
  });

  it("adds a supplier with its terms, deal, companies and full phone number", async () => {
    const fetcher = mount(withControls(() => state()));
    page();
    await userEvent.click(await screen.findByRole("button", { name: "Add supplier" }));
    const sheet = await screen.findByRole("dialog", { name: "New supplier" });
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Name" }), "Casabella");
    await userEvent.type(within(sheet).getByRole("combobox", { name: "Categories" }), "Curtains{Enter}");
    await userEvent.click(within(sheet).getByRole("button", { name: /Payment terms/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Advance, rest on delivery" }));
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Advance" }), "40");
    await userEvent.click(within(sheet).getByRole("button", { name: /Discount or commission/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Commission" }));
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Percent" }), "5");
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Contact" }), "Antony");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher)).toHaveLength(1));
    const [{ url, body }] = posts(fetcher);
    expect(url).toContain("/api/purchasing/suppliers?");
    expect(body).toMatchObject({ version: 0, name: "Casabella", categories: ["Curtains"], paymentTerms: "split", advancePercent: "40", deal: "commission", dealPercent: "5", contactName: "Antony", entityIds: [] });
  });

  it("approves a supplier as the preferred one for a category, and asks why when putting one on hold", async () => {
    const fetcher = mount(withControls(() => state()));
    page();
    await userEvent.click(await screen.findByText("Ritver Paints"));
    const sheet = await screen.findByRole("dialog", { name: "Ritver Paints" });
    expect(sheet).toHaveTextContent("Not reviewed");
    await userEvent.click(within(sheet).getByRole("button", { name: "Change approval" }));
    const dialog = await screen.findByRole("dialog", { name: "Approval" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "On hold" }));
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Approved" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ url: expect.stringContaining("/suppliers/s2/approval"), body: { version: 3, approval: "approved", preferredFor: [], note: "" } }));
  });

  it("checks new bank details: a call-back by someone else first, then approval; documents show their expiry", async () => {
    const pending = { id: "b1", accountName: "Ritver LLC", bankName: "Emirates NBD", accountNumber: "AE07 0331 2345 6789 0123 456", swift: "", currency: null, source: "email" as const,
      status: "pending" as const, requestedBy: "u1", requestedByName: "Bina Buyer", requestedAt: "2026-09-27T09:00:00Z", callbackByName: null, callbackAt: null, callbackNote: "",
      decidedByName: null, decidedAt: null, rejectReason: null };
    let detail = controls({ bankAccounts: [pending], documents: [{ id: "d1", kind: "trade_licence", label: "", number: "DED-1", expiresOn: "2020-01-01", required: true, hasFile: true,
      fileName: "licence.pdf", createdByName: "Bina", createdAt: "2026-09-01T09:00:00Z", replacedAt: null }] });
    const fetcher = mount(withControls((url, body) => {
      if (url.includes("/bank-accounts/b1")) detail = controls({ ...detail, bankAccounts: [{ ...pending, callbackByName: "Omar", callbackAt: "2026-09-27T10:00:00Z", callbackNote: String(body?.note ?? "") }] });
      return url.includes("/bank-accounts/b1") ? detail : state();
    }, () => detail));
    page();
    await userEvent.click(await screen.findByText("Ritver Paints"));
    const sheet = await screen.findByRole("dialog", { name: "Ritver Paints" });
    expect(await within(sheet).findByText(/Expired/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("tab", { name: "Bank details" }));
    expect(await within(sheet).findByText("Waiting for checks")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Approve" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: "Record the call-back" }));
    const dialog = await screen.findByRole("dialog", { name: "Record the call-back" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Who you called/ }), "Called Ahmed on the number from the 2024 contract");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ url: expect.stringContaining("/suppliers/s2/bank-accounts/b1"),
      body: { action: "callback", note: "Called Ahmed on the number from the 2024 contract" } }));
    expect(await within(sheet).findByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("adds a rate contract with its prices and period", async () => {
    let detail = controls();
    const fetcher = mount(withControls((url, body) => {
      if (url.includes("/contracts")) detail = controls({ contracts: [{ id: "k1", reference: String(body?.reference ?? ""), currency: "AED", validFrom: "2026-01-01", validTo: "2026-12-31", note: "",
        status: "active", cancelReason: null, state: "valid", createdByName: "Bina", lines: [{ id: "kl1", catalogItemId: "c1", itemName: "Wood glue", unit: "pcs", unitPrice: "25.0000", minimum: null, packSize: "6.0000", leadDays: null }] }] });
      return url.includes("/contracts") ? detail : state();
    }, () => detail));
    page();
    await userEvent.click(await screen.findByText("Ritver Paints"));
    const sheet = await screen.findByRole("dialog", { name: "Ritver Paints" });
    await userEvent.click(await within(sheet).findByRole("tab", { name: "Rate contracts" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Add rate contract" }));
    const dialog = await screen.findByRole("dialog", { name: "Add rate contract" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Reference/ }), "RC-2026");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Currency/ }), "aed");
    for (const [name, value] of [["Valid from", ["1", "1", "2026"]], ["Valid to", ["12", "31", "2026"]]] as const) {
      const group = within(dialog).getByRole("group", { name: new RegExp(name) });
      const [month, day, year] = within(group).getAllByRole("spinbutton");
      await userEvent.type(month, value[0]); await userEvent.type(day, value[1]); await userEvent.type(year, value[2]);
    }
    await userEvent.click(within(dialog).getByRole("button", { name: /Item, line 1/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Wood glue (pcs)" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Price, line 1" }), "25");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Pack size, line 1" }), "6");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ reference: "RC-2026", currency: "AED", validFrom: "2026-01-01", validTo: "2026-12-31",
      lines: [{ catalogItemId: "c1", unitPrice: "25", packSize: "6", minimum: null }] }));
    expect(await within(sheet).findByText(/Wood glue: .*25\.00 \/ pcs · packs of 6/)).toBeInTheDocument();
  });

  it("imports a supplier list: reads the columns, shows what will be added, then imports", async () => {
    const plan: SupplierImportPlan = { canApprove: false, plan: [
      { name: "SIOM Marble", rows: ["list.csv:2"], existingId: null, action: "create", categories: ["Marble"], approval: "pending", preferredFor: [], approvalSkipped: true,
        paymentTerms: "upfront", advancePercent: null, creditDays: null, deal: "on_request", dealPercent: null, entityIds: ["f"] },
      { name: "Nile Marble & Granite", rows: ["list.csv:3"], existingId: "s1", action: "merge", categories: ["Marble"], approval: "pending", preferredFor: [], approvalSkipped: false,
        paymentTerms: "statement", advancePercent: null, creditDays: null, deal: "none", dealPercent: null, entityIds: ["f"] }] };
    const fetcher = mount((url, body) => (url.includes("/suppliers/import") ? (body?.commit ? state({ imported: { created: 1, merged: 1 } }) : plan) : state()));
    page();
    await userEvent.click(await screen.findByRole("button", { name: "Import" }));
    const dialog = await screen.findByRole("dialog", { name: "Import suppliers" });
    const csv = "Supplier Type,Company Name,Directors Approved,Discount / Commission,Payment Terms,Contact Person / Number\nMarble,SIOM Marble,APPROVED MARBLE SUPPLIER,Discount as requested,Payment Upfront,Ramiz - +971 52 846 6806\nMarble,Nile Marble & Granite,,,SOA end of month,Mohamed\n";
    // jsdom's File has no text(); browsers do.
    const file = Object.defineProperty(new File([csv], "list.csv", { type: "text/csv" }), "text", { value: async () => csv });
    await userEvent.upload(within(dialog).getByLabelText("Choose an Excel or CSV file"), file);
    expect(await screen.findByText("list.csv")).toBeInTheDocument();
    const current = () => screen.getByRole("dialog", { name: "Import suppliers" });
    expect(current()).toHaveTextContent("2 rows");
    await userEvent.click(within(current()).getByRole("button", { name: /Company for list.csv/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Studio Furniture Manufacturing" }));
    await userEvent.click(within(current()).getByRole("button", { name: "Review" }));
    expect(await screen.findByText("1 new, 1 already in the register (they gain the new companies and categories).")).toBeInTheDocument();
    expect(current()).toHaveTextContent("1 approvals in the file need someone who approves suppliers");
    await userEvent.click(within(current()).getByRole("button", { name: "Import 2 suppliers" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body.commit).toBe(true));
    const rows = posts(fetcher).at(-1)!.body.rows;
    expect(rows[0]).toMatchObject({ name: "SIOM Marble", categories: "Marble", approval: "APPROVED MARBLE SUPPLIER", terms: "Payment Upfront", contactName: "Ramiz", phone: "+971 52 846 6806", entityId: "f" });
  });
});

describe("ordering", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(window.history.replaceState).mockClear(); nav.query = ""; });
  const need = (patch: Partial<Need>): Need => ({ key: "material:m1", source: "material", sourceId: "m1", projectId: "p1", projectReference: "PRJ-0007", projectName: "Villa 12",
    title: "Calacatta slab", detail: "CAL-20", unit: "m²", required: "12.0000", placed: "0", drafted: "0", received: "0", remaining: "12.0000", catalogItemId: null, supplierHint: "Nile", packageName: null,
    supply: null, clientChoice: true, blocked: null, neededBy: null, leadDays: 14, orderBy: null, fromStock: "0", packageIds: [], scopeLines: [], ...patch });
  const needs = { needs: [need({ scopeLines: ["Kitchen worktop"] }), need({ key: "line:l1", source: "line", sourceId: "l1", title: "Under-cabinet lights", detail: "", unit: "nos", required: "1.0000", remaining: "1.0000",
    supplierHint: "", packageName: "Lights" }), need({ key: "material:m9", sourceId: "m9", projectId: "p2", projectReference: "PRJ-0008", projectName: "Marina", title: "Oak veneer", blocked: "material_signoff" })],
    settings: { approvalThreshold: "0", requireMaterialSignoff: true, requireApprovedSupplier: true, requireInspection: true, receiveTolerancePercent: "0.00", requireSitePhoto: true, version: 1 }, canBuy: true, canApprove: true };
  const orderState = (patch: Partial<OrderState["order"]> = {}, rights: Partial<OrderState> = {}): OrderState => ({
    order: { id: "o1", number: "FAC-PO-2026-00001", status: "draft", vendorId: "s1", supplierName: "Nile Marble & Granite", legalEntityId: "f", companyCode: "FAC", currency: "AED",
      total: "3780.0000", expectedDate: "2099-10-20", promisedDate: null, createdAt: "2026-09-27T09:00:00Z", createdByName: "Bina Buyer", projects: [{ id: "p1", reference: "PRJ-0007" }], lines: 2,
      revision: 0, version: 1, paymentTerms: "split", advancePercent: "50.00", creditDays: null, termsNote: "", retentionPercent: "0.00", deliverTo: "site", deliveryAddress: "Villa 12, Palm", supplierReference: "", notes: "",
      subtotal: "4000.0000", discountTotal: "400.0000", taxTotal: "180.0000", createdBy: "u1", submittedBy: null, approvedByName: null, approvedAt: null, sentAt: null, sentTo: null,
      confirmedAt: null, cancelledAt: null, cancelReason: null, closedAt: null, closeReason: null, overReason: null, continuedAt: null, continuedNote: null, continuedByName: null, fundsOverrideAt: null, fundsOverrideReason: null, fundsOverrideByName: null, companyName: "Studio Furniture", ...patch },
    lines: [
      { id: "a", position: 0, projectId: "p1", projectReference: "PRJ-0007", source: "material", materialItemId: "m1", boqLineId: null, description: "Calacatta slab", specification: "CAL-20",
        quantity: "10.0000", unit: "m²", unitPrice: "350.0000", discountPercent: "10.00", taxRate: "5.0000", net: "3150.0000", tax: "157.5000", total: "3307.5000",
        accepted: "0.0000", rejected: "0.0000", pending: "0.0000", credited: "0.0000", returned: "0.0000",
        promisedDate: null, confirmedQuantity: null, due: null, cancelled: "0.0000", cancelReason: null, replacesLineId: null, replacesOrderNumber: null,
        alternateStatus: null, alternateDescription: null, alternateSpecification: "", alternateUnitPrice: null, alternateNote: "", alternateOfferedBy: null, originalDescription: null, originalSpecification: null },
      { id: "b", position: 1, projectId: "p1", projectReference: "PRJ-0007", source: "line", materialItemId: null, boqLineId: "l1", description: "Under-cabinet lights", specification: "",
        quantity: "1.0000", unit: "nos", unitPrice: "500.0000", discountPercent: "10.00", taxRate: "5.0000", net: "450.0000", tax: "22.5000", total: "472.5000",
        accepted: "0.0000", rejected: "0.0000", pending: "0.0000", credited: "0.0000", returned: "0.0000",
        promisedDate: null, confirmedQuantity: null, due: null, cancelled: "0.0000", cancelReason: null, replacesLineId: null, replacesOrderNumber: null,
        alternateStatus: null, alternateDescription: null, alternateSpecification: "", alternateUnitPrice: null, alternateNote: "", alternateOfferedBy: null, originalDescription: null, originalSpecification: null }],
    events: [{ id: "e1", kind: "created", detail: {}, byName: "Bina Buyer", at: "2026-09-27T09:00:00Z" }], revisions: [],
    supplier: { id: "s1", name: "Nile Marble & Granite", email: "orders@nile.example", phone: null, contactName: "Mohamed", approval: "approved", deal: "discount", dealPercent: "10.00" },
    receipts: [], returns: [], canBuy: true, canApprove: true, canApproveThis: false, canReceive: true, overOrdered: [], packs: [], contracts: [], neededBy: {}, spendingGuard: "off", fundsShort: [], canOverrideFunds: false, me: "u2", supplierHold: null, ...rights,
  });
  const ordersList = { orders: [orderState().order], settings: needs.settings, canBuy: true, canApprove: true };

  it("lists what projects need, keeps unsigned lists apart, and orders the chosen lines from one supplier", async () => {
    const fetcher = mount((url, body) => (url.includes("/needs") ? needs : url.includes("/suppliers") ? state() : body ? orderState() : ordersList));
    page("to-order");
    const table = await screen.findByRole("table", { name: "To order" }).catch(() => screen.findByRole("grid", { name: "To order" }));
    expect(table).toHaveTextContent("PRJ-0007 · Villa 12");
    // A material is one line to buy, linked to the scope line it's for.
    expect(table).toHaveTextContent("For Kitchen worktop");
    expect(table).not.toHaveTextContent("Oak veneer");
    // What waits for the client's sign-off is its own queue, with a way to the project's scope.
    await userEvent.click(screen.getByRole("button", { name: /^Client sign-off\s*1$/ }));
    const waiting = await screen.findByRole("grid", { name: "To order" }).catch(() => screen.findByRole("table", { name: "To order" }));
    expect(waiting).toHaveTextContent("Oak veneer");
    expect(within(waiting).getByRole("link", { name: "Get sign-off" })).toHaveAttribute("href", "/workspace/projects/p2/scope");
    await userEvent.click(screen.getByRole("button", { name: /^To order\s*2$/ }));
    await userEvent.click(within(await screen.findByRole("grid", { name: "To order" }).catch(() => screen.findByRole("table", { name: "To order" })))
      .getByRole("checkbox", { name: "Select PRJ-0007 Calacatta slab" }));
    const table2 = await screen.findByRole("grid", { name: "To order" }).catch(() => screen.findByRole("table", { name: "To order" }));
    await userEvent.click(within(table2).getByRole("checkbox", { name: "Select PRJ-0007 Under-cabinet lights" }));
    await userEvent.click(screen.getByRole("button", { name: "Create order" }));
    const dialog = await screen.findByRole("dialog", { name: "New order" });
    // The material names its supplier, so it's chosen; quantities start at what's left.
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Supplier/ })).toHaveTextContent("Nile Marble & Granite"));
    expect(within(dialog).getByRole("textbox", { name: "Quantity for Calacatta slab" })).toHaveValue("12");
    // Nile only supplies the furniture company, so it buys.
    expect(within(dialog).queryByRole("button", { name: /Buying company/ })).toBeNull();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Price for Calacatta slab" }), "350");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create order" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.url).toContain("/api/purchasing/orders?"));
    expect(posts(fetcher).at(-1)!.body).toMatchObject({ vendorId: "s1", legalEntityId: "f", lines: [
      { source: "material", materialItemId: "m1", quantity: "12", unitPrice: "350" }, { source: "line", boqLineId: "l1", quantity: "1" }] });
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/workspace/purchasing/orders?order=o1");
  });

  it("keeps a project on hold apart: ordering it asks why, and the reason goes with the order (D-8)", async () => {
    const fetcher = mount((url, body) => (url.includes("/needs") ? { ...needs, needs: [need({ projectStatus: "on_hold", clientChoice: false })] }
      : url.includes("/suppliers") ? state() : body ? orderState() : ordersList));
    page("to-order");
    expect(await screen.findByText("Nothing left to order")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^On hold\s*1$/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Order Calacatta slab anyway" }));
    const dialog = await screen.findByRole("dialog", { name: "New order" });
    expect(within(dialog).getByText("PRJ-0007 is on hold: the order is drafted, and placing it asks why it goes ahead.")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Supplier/ })).toHaveTextContent("Nile Marble & Granite"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create order" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ lines: [{ source: "material", materialItemId: "m1" }] }));
  });

  it("asks why a draft for a project on hold goes ahead before it's placed (D-8)", async () => {
    nav.query = "order=o1";
    const held = orderState({}, { holdProjects: [{ id: "p1", reference: "PRJ-0007" }] });
    const fetcher = mount((url, body) => (url.includes("/orders/o1") ? (body ? orderState({ status: "approved", version: 2 }) : held) : ordersList));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "FAC-PO-2026-00001" });
    expect(await within(sheet).findByText("PRJ-0007 is on hold. Say why this order goes ahead anyway.")).toBeInTheDocument();
    const send = within(sheet).getByRole("button", { name: "Send for approval" });
    expect(send).toBeDisabled();
    await userEvent.type(within(sheet).getByRole("textbox", { name: /Why it goes ahead/ }), "Client paid for the slab");
    await userEvent.click(send);
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "submit", holdReason: "Client paid for the slab" }));
  });

  it("restocks low stock from To order: the line names its stock item and goes to the warehouse", async () => {
    const low = { id: "rp1", itemId: "i1", itemName: "Wood glue", itemCode: "", unit: "nos", locationId: "w1", locationName: "Main store", reorderAt: "6.0000", reorderQuantity: "24.0000",
      vendorId: "s1", vendorName: "Nile Marble & Granite", free: "5.0000", onOrder: "0.0000", low: true, short: true, lowSince: "2026-09-28T10:00:00Z", version: 1 };
    const fetcher = mount((url, body) => (url.includes("/api/inventory/stock") ? { rows: [], locations: [], projects: [], inTransit: 0, canManage: true, canAdjust: true, canReceive: true,
      pendingAdjustments: [], me: "u2", currency: "AED", reorderPoints: [low] } : url.includes("/needs") ? needs : url.includes("/suppliers") ? state() : body ? orderState() : ordersList));
    page("to-order");
    await userEvent.click(await screen.findByRole("button", { name: /^Low stock\s*1$/ }));
    const table = await screen.findByRole("grid", { name: "Low stock" }).catch(() => screen.findByRole("table", { name: "Low stock" }));
    expect(table).toHaveTextContent("Wood glue");
    expect(table).toHaveTextContent("Reorder at 6 nos");
    await userEvent.click(within(table).getByRole("button", { name: "Restock Wood glue" }));
    const dialog = await screen.findByRole("dialog", { name: "New order" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Supplier/ })).toHaveTextContent("Nile Marble & Granite"));
    expect(within(dialog).getByRole("textbox", { name: "Quantity for Wood glue" })).toHaveValue("24");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create order" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ vendorId: "s1", deliverTo: "warehouse", lines: [{ source: "free", stockItemId: "i1", quantity: "24" }] }));
  });

  it("edits a draft with live exact totals and sends it for approval", async () => {
    nav.query = "order=o1";
    let current = orderState();
    const fetcher = mount((url, body) => {
      if (body?.action === "save") current = orderState({ version: 2, total: "4441.5000" });
      if (body?.action === "submit") current = orderState({ version: 3, status: "pending_approval" });
      return url.includes("/orders/o1") ? current : ordersList;
    });
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "FAC-PO-2026-00001" });
    const quantity = await within(sheet).findByRole("textbox", { name: "Quantity for Calacatta slab" });
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "12");
    // 12 × 350 less 10% = 3,780 + 5% tax = 3,969; plus the lights 472.50 = 4,441.50
    expect(within(sheet).getByText(/4,441\.50/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Send for approval" }));
    await waitFor(() => expect(posts(fetcher).map((post) => [post.body.action, post.body.version])).toEqual([["save", 1], ["submit", 2]]));
    expect(posts(fetcher)[0].body.lines[0]).toMatchObject({ id: "a", source: "material", materialItemId: "m1", quantity: "12", unitPrice: "350", discountPercent: "10", taxRate: "5" });
  });

  it("lets the buyer call off an order still waiting for someone else's approval", async () => {
    nav.query = "order=o1";
    let current = orderState({ status: "pending_approval", submittedBy: "u2", version: 3 });
    const fetcher = mount((url, body) => {
      if (body?.action === "cancel") current = orderState({ status: "cancelled", version: 4, cancelReason: "Client changed the finish" });
      return url.includes("/orders/o1") ? current : ordersList;
    });
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "FAC-PO-2026-00001" });
    expect(within(sheet).getByText("Waiting for someone who approves orders.")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel order" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Why it's cancelled" }), "Client changed the finish");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "cancel", version: 3, reason: "Client changed the finish" }));
  });

  it("asks why when an order takes a project past what it needs, and shows over-ordered items in To order", async () => {
    nav.query = "order=o1";
    const over = orderState({}, { overOrdered: [{ lineId: "a", description: "Calacatta slab", unit: "m²", over: "2.0000" }] });
    const fetcher = mount((url, body) => (url.includes("/orders/o1") ? (body ? orderState({ status: "pending_approval", version: 2, overReason: "Cutting waste" }) : over) : ordersList));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "FAC-PO-2026-00001" });
    expect(await within(sheet).findByText("More than the project needs: Calacatta slab +2 m²")).toBeInTheDocument();
    const send = within(sheet).getByRole("button", { name: "Send for approval" });
    expect(send).toBeDisabled();
    await userEvent.type(within(sheet).getByRole("textbox", { name: /Why order more than needed/ }), "Cutting waste");
    await userEvent.click(send);
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "submit", overReason: "Cutting waste" }));
  });

  it("keeps over-ordered items in To order with how much too many", async () => {
    mount((url) => (url.includes("/needs") ? { ...needs, needs: [need({ placed: "14.0000", remaining: "-2.0000", changedBy: "VO-2" })] } : ordersList));
    page("to-order");
    await userEvent.click(await screen.findByRole("button", { name: /^Over-ordered\s*1$/ }));
    expect(await screen.findByText("Ordered 2 m² more than needed")).toBeInTheDocument();
    // The variation that changed it, and the way to the orders to cancel the rest.
    expect(screen.getByText(/Changed by VO-2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open orders" })).toBeInTheDocument();
  });

  it("shows when each need is needed and when it should be ordered by, late ones marked and in their own queue", async () => {
    mount((url) => (url.includes("/needs") ? { ...needs, needs: [need({ neededBy: "2026-10-05", orderBy: "2020-09-21" }), need({ key: "material:m2", sourceId: "m2", title: "Brass handles", neededBy: "2099-11-02", orderBy: "2099-10-19" })] } : ordersList));
    page("to-order");
    const late = await screen.findByText("Order by Sep 21, 2020");
    expect(late.className).toMatch(/lateText/);
    expect(screen.getByText("Nov 2, 2099")).toBeInTheDocument();
    expect(screen.getByText("Order by Oct 19, 2099").className).not.toMatch(/lateText/);
    await userEvent.click(screen.getByRole("button", { name: /^Late to order\s*1$/ }));
    const table = await screen.findByRole("grid", { name: "To order" }).catch(() => screen.findByRole("table", { name: "To order" }));
    expect(table).toHaveTextContent("Calacatta slab");
    expect(table).not.toHaveTextContent("Brass handles");
  });

  it("counts free stock given to the project before what's left to order", async () => {
    mount((url) => (url.includes("/needs") ? { ...needs, needs: [need({ fromStock: "8", remaining: "4.0000" })] } : ordersList));
    page("to-order");
    expect(await screen.findByText("8 m² from stock")).toBeInTheDocument();
    expect(screen.getByText("4 m²")).toBeInTheDocument();
  });

  it("says when an order line arrives after its project needs it", async () => {
    nav.query = "order=o1";
    const sent = orderState({ status: "sent", sentAt: "2026-09-27T10:00:00Z", approvedAt: "2026-09-27T10:00:00Z", expectedDate: "2099-10-20" }, { neededBy: { a: "2099-10-12", b: "2099-11-01" } });
    // Both lines are due on the 20th: the slab is needed before then, the lights after.
    const due = { ...sent, lines: sent.lines.map((line) => ({ ...line, due: "2099-10-20" })) };
    mount((url) => (url.includes("/orders/o1") ? due : url.includes("/suppliers") ? state() : ordersList));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: /FAC-PO-2026-00001/ });
    expect(await within(sheet).findByText("Arrives after it's needed on Oct 12, 2099")).toBeInTheDocument();
    expect(within(sheet).getByText("Needed Nov 1, 2099")).toBeInTheDocument();
  });

  it("needs a photo for a delivery at the project's site, and uploads it with the delivery", async () => {
    const sent = orderState({ status: "confirmed", sentAt: "2026-09-27T11:00:00Z" });
    const form: ReceivingForm = { order: sent.order, lines: sent.lines.map((line) => ({ ...line, outstanding: line.quantity, receivable: line.quantity })),
      places: [{ key: "site:p1", kind: "site", name: null, projectReference: "PRJ-0007" }], defaultPlace: "site:p1", requireInspection: true, receiveTolerancePercent: "0.00", requireSitePhoto: true };
    const deliveries: DeliveriesState = { expected: [{ ...sent.order, deliverTo: "site", linesLeft: 2, due: null }], inspection: [], received: [], locations: [], canReceive: true, canInspect: true,
      userId: "u2", unmatched: [], requireSitePhoto: true };
    const fetcher = mount((url) => (url.includes("/receiving") ? form : url.includes("/returns") ? { returns: [], canBuy: true, canReceive: true } : url.includes("/receipts") ? receipt() : deliveries));
    page("deliveries");
    const grid = await screen.findByRole("grid", { name: "Expected deliveries" }).catch(() => screen.findByRole("table", { name: "Expected deliveries" }));
    await userEvent.click(await within(grid).findByRole("button", { name: "Receive FAC-PO-2026-00001" }));
    const dialog = await screen.findByRole("dialog", { name: "Receive FAC-PO-2026-00001" });
    // Everything left is filled in; only the slab came today.
    expect(await within(dialog).findByRole("textbox", { name: "Received of Calacatta slab" })).toHaveValue("10");
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Received of Under-cabinet lights" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Handed over by" }), "Ravi");
    expect(within(dialog).getByRole("button", { name: "Receive" })).toBeDisabled();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:photo", revokeObjectURL: () => undefined }));
    await userEvent.upload(within(dialog).getByLabelText("Add a photo of the delivery"), new File(["x"], "site.jpg", { type: "image/jpeg" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Receive" }));
    await waitFor(() => expect(uploads(fetcher)).toHaveLength(1));
    expect(posts(fetcher).at(-1)!.body).toMatchObject({ place: "site:p1", handedOverBy: "Ravi", lines: [{ orderLineId: "a", received: "10" }] });
    expect(uploads(fetcher)[0]).toMatchObject({ url: expect.stringMatching(/\/api\/purchasing\/receipts\/g1\/photos\/[0-9a-f-]{36}\?/), file: expect.objectContaining({ name: "site.jpg" }) });
  });

  it("records goods that came without an order and matches them to an order line", async () => {
    nav.query = "unmatched=u1";
    const open: UnmatchedState = {
      delivery: { id: "u1", number: 1, vendorId: "s1", supplierName: "Nile Marble & Granite", locationId: "w1", locationName: "Warehouse", locationKind: "warehouse", receivedOn: "2026-09-27",
        receivedBy: "u9", receivedByName: "Sam Store", handedOverBy: "", deliveryNote: "DN-4410", notes: "", status: "open", receiptId: null, receiptNumber: null, resolvedByName: null, resolvedAt: null,
        resolutionNote: "", createdAt: "2026-09-27T10:00:00Z", lines: 1, photos: 0 },
      lines: [{ id: "ul1", description: "Calacatta 20mm", quantity: "2.0000", unit: "m²" }], photos: [],
      candidates: [{ id: "o1", number: "FAC-PO-2026-00001", supplierName: "Nile Marble & Granite", lines: [{ id: "a", description: "Calacatta slab", unit: "m²", projectReference: "PRJ-0007", outstanding: "2" }] }],
      canBuy: true, canReceive: true, canInspect: true,
    };
    const fetcher = mount((url, body) => (url.includes("/unmatched/u1") ? (body ? { ...open, delivery: { ...open.delivery, status: "matched", receiptId: "g5", receiptNumber: 5, resolvedByName: "Omar" }, candidates: [] } : open)
      : url.includes("/returns") ? { returns: [], canBuy: true, canReceive: true } : { expected: [], inspection: [], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2", unmatched: [open.delivery], requireSitePhoto: true }));
    page("deliveries");
    const sheet = await screen.findByRole("dialog", { name: "Without an order 1" });
    expect(await within(sheet).findByText("Calacatta 20mm")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Match to an order" }));
    const dialog = await screen.findByRole("dialog", { name: "Match to an order" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Calacatta 20mm \(2 m²\) is/ }));
    await userEvent.click(await screen.findByRole("option", { name: /Calacatta slab · PRJ-0007/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Match" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "match", orderId: "o1", note: "", lines: [{ unmatchedLineId: "ul1", orderLineId: "a" }] }));
    expect(await within(sheet).findByText("Matched by Omar; now delivery 5.")).toBeInTheDocument();
  });

  it("records the supplier's confirmation per line: less than ordered, and each line's date", async () => {
    nav.query = "order=o1";
    const sent = orderState({ status: "sent", sentAt: "2026-09-27T11:00:00Z", version: 4 });
    const fetcher = mount((url, body) => (url.includes("/orders/o1") ? (body ? orderState({ status: "confirmed", version: 5 }) : sent) : ordersList));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "FAC-PO-2026-00001" });
    await userEvent.click(await within(sheet).findByRole("button", { name: "Record confirmation" }));
    const dialog = await screen.findByRole("dialog", { name: "Supplier's confirmation" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Confirmed of Calacatta slab" }), "12");
    expect(within(dialog).getByText("The supplier can't confirm more of Calacatta slab than was ordered.")).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Confirmed of Calacatta slab" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Confirmed of Calacatta slab" }), "8");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Their reference" }), "SO-77");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "confirm", supplierReference: "SO-77",
      lines: [{ lineId: "a", confirmedQuantity: "8", promisedDate: null }, { lineId: "b", confirmedQuantity: null, promisedDate: null }] }));
  });

  it("chases a late order and cancels the rest of a line, ordering it from another supplier", async () => {
    nav.query = "order=o1";
    const late = orderState({ status: "confirmed", sentAt: "2026-09-01T11:00:00Z", confirmedAt: "2026-09-02T11:00:00Z", promisedDate: "2020-01-10", version: 6 });
    late.lines = late.lines.map((line) => ({ ...line, due: "2020-01-10" }));
    const fetcher = mount((url, body) => (url.includes("/orders/o1") ? (body?.action === "cancel_line" ? { ...late, reordered: "o2" } : late)
      : url.includes("/suppliers") ? state() : ordersList));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "FAC-PO-2026-00001" });
    await userEvent.click(await within(sheet).findByRole("button", { name: "Chase" }));
    const chase = await screen.findByRole("dialog", { name: "Chase" });
    expect(within(chase).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(within(chase).getByRole("textbox", { name: /What the supplier said/ }), "Container held at port");
    await userEvent.click(within(chase).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "chase", note: "Container held at port", promisedDate: null }));

    await userEvent.click(within(sheet).getByRole("button", { name: "Cancel the rest of Calacatta slab" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel the rest of Calacatta slab" });
    expect(within(dialog).getByRole("textbox", { name: "Quantity" })).toHaveValue("10");
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Quantity" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Quantity" }), "2");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why it won't come/ }), "Only 8 m² in the block");
    await userEvent.click(within(dialog).getByRole("button", { name: /Order it from/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Ritver Paints" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel the rest" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "cancel_line", lineId: "a", quantity: "2", reason: "Only 8 m² in the block", reorderVendorId: "s2" }));
    await waitFor(() => expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/workspace/purchasing/orders?order=o2"));
  });

  it("records the supplier's alternative for a line, and someone else takes it", async () => {
    nav.query = "order=o1";
    const sent = orderState({ status: "confirmed", sentAt: "2026-09-27T11:00:00Z", confirmedAt: "2026-09-27T12:00:00Z", version: 7 });
    const offered = orderState({ status: "confirmed", sentAt: "2026-09-27T11:00:00Z", confirmedAt: "2026-09-27T12:00:00Z", version: 8 });
    offered.lines[0] = { ...offered.lines[0], alternateStatus: "offered", alternateDescription: "Calacatta Oro", alternateSpecification: "Honed", alternateUnitPrice: "340.0000",
      alternateNote: "Polished is discontinued", alternateOfferedBy: "u1" };
    let current = sent;
    const fetcher = mount((url, body) => {
      if (body?.action === "offer_alternate") current = offered;
      return url.includes("/orders/o1") ? current : ordersList;
    });
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "FAC-PO-2026-00001" });
    await userEvent.click(await within(sheet).findByRole("button", { name: "The supplier offers an alternative for Calacatta slab" }));
    const dialog = await screen.findByRole("dialog", { name: "The supplier offers an alternative" });
    await userEvent.clear(within(dialog).getByRole("textbox", { name: /What they offer/ }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: /What they offer/ }), "Calacatta Oro");
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Finish or size" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Finish or size" }), "Honed");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why they offer it/ }), "Polished is discontinued");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "offer_alternate", lineId: "a", description: "Calacatta Oro", specification: "Honed", unitPrice: "350",
      note: "Polished is discontinued" }));
    expect(await within(sheet).findByText(/The supplier offers Calacatta Oro, Honed at .*340\.00: Polished is discontinued/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Take it" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "decide_alternate", lineId: "a", decision: "accept" }));
  });

  it("holds an open order whose supplier is on hold until someone who approves orders continues it", async () => {
    nav.query = "order=o1";
    const held = orderState({ status: "approved", approvedAt: "2026-09-27T10:00:00Z", version: 3 }, { supplierHold: { approval: "on_hold", note: "Its trade licence expired on 2026-09-01." } });
    const fetcher = mount((url, body) => (url.includes("/orders/o1") ? (body ? orderState({ status: "approved", version: 4, continuedAt: "2026-09-27T11:00:00Z", continuedNote: "Renewal filed",
      continuedByName: "Dara" }, { supplierHold: { approval: "on_hold", note: "Its trade licence expired on 2026-09-01." } }) : held) : ordersList));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "FAC-PO-2026-00001" });
    expect(await within(sheet).findByText(/Nile Marble & Granite is on hold: Its trade licence expired on 2026-09-01/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Continue this order" }));
    const dialog = await screen.findByRole("dialog", { name: "Continue this order" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why it continues/ }), "Renewal filed");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue this order" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "continue_on_hold", note: "Renewal filed" }));
    expect(await within(sheet).findByText("Continued while the supplier is on hold, by Dara: Renewal filed")).toBeInTheDocument();
  });

  it("stops an order beyond its project's money in hand until someone who may override lets it go ahead, and lets a buyer ask", async () => {
    nav.query = "order=o1";
    const short = [{ projectId: "p1", reference: "PRJ-0007", currency: "AED", needed: "3600.0000", available: "1000.0000" }];
    const blocked = orderState({}, { spendingGuard: "strict", fundsShort: short, canOverrideFunds: true });
    const fetcher = mount((url, body) => (url.includes("/orders/o1") ? (body?.action === "override_funds" ? orderState({ version: 2, fundsOverrideAt: "2026-09-27T11:00:00Z",
      fundsOverrideReason: "Payment due Monday", fundsOverrideByName: "Omar" }, { spendingGuard: "strict", fundsShort: short, canOverrideFunds: true }) : blocked) : ordersList));
    const view = page("orders");
    const sheet = await screen.findByRole("dialog", { name: "FAC-PO-2026-00001" });
    expect(await within(sheet).findByText(/Beyond the money in hand: PRJ-0007 has .*1,000.00, this order needs .*3,600.00/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Let it go ahead" }));
    const dialog = await screen.findByRole("dialog", { name: "Let it go ahead" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why it goes ahead/ }), "Payment due Monday");
    await userEvent.click(within(dialog).getByRole("button", { name: "Let it go ahead" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "override_funds", reason: "Payment due Monday" }));
    expect(await within(sheet).findByText("Let go ahead beyond the money in hand by Omar: Payment due Monday")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Let it go ahead" })).toBeNull();
    view.unmount();

    const asking = mount((url, body) => (url.includes("/orders/o1") ? orderState(body ? { version: 2 } : {}, { spendingGuard: "strict", fundsShort: short, canOverrideFunds: false }) : ordersList));
    page("orders");
    const again = await screen.findByRole("dialog", { name: "FAC-PO-2026-00001" });
    await userEvent.click(await within(again).findByRole("button", { name: "Ask to go ahead" }));
    await waitFor(() => expect(posts(asking).at(-1)!.body).toMatchObject({ action: "ask_funds" }));
  });

  it("offers the supplier's pack size on a draft line", async () => {
    nav.query = "order=o1";
    mount((url) => (url.includes("/orders/o1") ? orderState({}, { packs: [{ lineId: "a", packSize: "4", minimum: "8", suggested: "12" }] }) : ordersList));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "FAC-PO-2026-00001" });
    expect(await within(sheet).findByText(/Sold in packs of 4, at least 8/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Order 12" }));
    expect(within(sheet).getByRole("textbox", { name: "Quantity for Calacatta slab" })).toHaveValue("12");
  });

  it("lets someone else approve, then sends it to the supplier and says if the email couldn't go", async () => {
    nav.query = "order=o1";
    let current = orderState({ status: "pending_approval", submittedBy: "u1" }, { canApproveThis: true });
    const fetcher = mount((url, body) => {
      if (body?.action === "approve") current = orderState({ status: "approved", version: 2, approvedByName: "Dara Director", approvedAt: "2026-09-27T10:00:00Z" });
      if (body?.action === "send") current = { ...orderState({ status: "sent", version: 3, sentTo: body.to as string, sentAt: "2026-09-27T11:00:00Z" }), delivery: "not_configured" };
      return url.includes("/orders/o1") ? current : ordersList;
    });
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "FAC-PO-2026-00001" });
    await userEvent.click(await within(sheet).findByRole("button", { name: "Approve" }));
    await userEvent.click(await within(sheet).findByRole("button", { name: "Send to supplier" }));
    const send = await screen.findByRole("dialog", { name: "Send to supplier" });
    expect(within(send).getByRole("textbox", { name: "Email" })).toHaveValue("orders@nile.example");
    await userEvent.click(within(send).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(posts(fetcher).map((post) => post.body.action)).toEqual(["approve", "send"]));
    expect(await within(sheet).findByText("Email isn't set up here. Send the order to the supplier yourself.")).toBeInTheDocument();
  });

  const receipt = (patch: Partial<ReceiptState["receipt"]> = {}, rights: Partial<ReceiptState> = {}): ReceiptState => ({
    receipt: { id: "g1", number: 4, orderId: "o1", orderNumber: "FAC-PO-2026-00001", supplierName: "Nile Marble & Granite", locationId: "loc", locationName: "PRJ-0007 · Villa 12",
      locationKind: "site", receivedOn: "2026-09-27", receivedBy: "u1", receivedByName: "Sam Store", deliveryNote: "DN-88", notes: "", inspectedByName: null, inspectedAt: null,
      received: "6.0000", accepted: "0.0000", rejected: "0.0000", pending: "6.0000", createdAt: "2026-09-27T10:00:00Z", missing: "0.0000", reversedAt: null, reversedByName: null,
      reverseReason: null, handedOverBy: "", photos: 0, ...patch },
    lines: [{ id: "gl1", orderLineId: "a", description: "Calacatta slab", specification: "CAL-20", unit: "m²", projectReference: "PRJ-0007", boqLineId: null, projectId: "p1",
      received: "6.0000", accepted: "0.0000", rejected: "0.0000", pending: "6.0000", rejectReason: "", rejectKind: null, noted: null, inspectedByName: null,
      returnedRejected: "0.0000", returnedAccepted: "0.0000" }],
    canBuy: true, canReceive: true, canInspect: true, canInspectThis: true, canReturnThis: false, canReverseThis: false, photos: [], needsPhoto: false, ...rights,
  });

  it("lists expected deliveries, late ones marked, and receives what arrived at the project's site", async () => {
    const sent = orderState({ status: "confirmed", promisedDate: "2020-01-10", sentAt: "2026-09-27T11:00:00Z" });
    const deliveries: DeliveriesState = { expected: [{ ...sent.order, deliverTo: "site", linesLeft: 2, due: "2020-01-10" }], inspection: [receipt().receipt], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2", unmatched: [], requireSitePhoto: true };
    const form: ReceivingForm = { order: sent.order, lines: sent.lines.map((line) => ({ ...line, outstanding: line.quantity, receivable: line.quantity })),
      places: [{ key: "site:p1", kind: "site", name: null, projectReference: "PRJ-0007" }, { key: "warehouse", kind: "warehouse", name: null, projectReference: null }],
      defaultPlace: "site:p1", requireInspection: true, receiveTolerancePercent: "0.00", requireSitePhoto: false };
    const fetcher = mount((url) => (url.includes("/receiving") ? form : url.includes("/receipts") ? receipt() : url.includes("/deliveries") ? deliveries : ordersList));
    page("deliveries");
    const grid = await screen.findByRole("grid", { name: "Expected deliveries" }).catch(() => screen.findByRole("table", { name: "Expected deliveries" }));
    await within(grid).findByText("FAC-PO-2026-00001");
    expect(grid).toHaveTextContent(/days late/);
    expect(grid).toHaveTextContent("2 lines to come");
    expect(screen.getByRole("button", { name: /^To inspect\s*1$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Late\s*1$/ })).toBeInTheDocument();
    await userEvent.click(within(grid).getByRole("button", { name: "Receive FAC-PO-2026-00001" }));
    const dialog = await screen.findByRole("dialog", { name: "Receive FAC-PO-2026-00001" });
    // It arrives where the order goes, and everything left is filled in.
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Arrived at/ })).toHaveTextContent("PRJ-0007 site"));
    // Inspection is on: nothing is accepted or rejected at receipt.
    expect(within(dialog).queryByRole("textbox", { name: "Rejected of Calacatta slab" })).toBeNull();
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Received of Calacatta slab" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Received of Calacatta slab" }), "11");
    expect(within(dialog).getByText("At most 10 m² of Calacatta slab can arrive.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Receive" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Everything left" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Delivery note" }), "DN-88");
    await userEvent.click(within(dialog).getByRole("button", { name: "Receive" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.url).toContain("/api/purchasing/receipts?"));
    expect(posts(fetcher).at(-1)!.body).toMatchObject({ orderId: "o1", place: "site:p1", deliveryNote: "DN-88", lines: [{ orderLineId: "a", received: "10" }, { orderLineId: "b", received: "1" }] });
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/workspace/purchasing/deliveries?receipt=g1");
  });

  it("inspects a delivery someone else received: accepted by default, a rejection needs its reason", async () => {
    nav.query = "receipt=g1";
    const fetcher = mount((url, body) => (url.includes("/receipts/g1") ? (body ? receipt({ accepted: "5.0000", rejected: "1.0000", pending: "0.0000", inspectedByName: "Dara Director",
      inspectedAt: "2026-09-27T12:00:00Z" }, { canInspectThis: false }) : receipt()) : { expected: [], inspection: [], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2", unmatched: [], requireSitePhoto: true }));
    page("deliveries");
    const sheet = await screen.findByRole("dialog", { name: "Delivery 4" });
    await within(sheet).findByText("Calacatta slab");
    expect(sheet).toHaveTextContent("Sam Store");
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Rejected of Calacatta slab" }), "1");
    expect(sheet).toHaveTextContent("5 m²");
    const save = within(sheet).getByRole("button", { name: "Save inspection" });
    expect(save).toBeDisabled();
    await userEvent.type(within(sheet).getByRole("textbox", { name: /Why it was rejected/ }), "Chipped edge");
    expect(save).toBeDisabled();
    await userEvent.click(within(sheet).getByRole("button", { name: /What was wrong with Calacatta slab/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Damaged" }));
    await userEvent.click(save);
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ url: expect.stringContaining("/receipts/g1/inspection"),
      body: { lines: [{ id: "gl1", accepted: "5", rejected: "1", rejectKind: "damaged", rejectReason: "Chipped edge" }] } }));
    expect(await within(sheet).findByText("Some rejected")).toBeInTheDocument();
  });

  it("flags goods missing against the supplier's note when receiving", async () => {
    const sent = orderState({ status: "confirmed", sentAt: "2026-09-27T11:00:00Z" });
    const form: ReceivingForm = { order: sent.order, lines: sent.lines.map((line) => ({ ...line, outstanding: line.quantity, receivable: line.quantity })),
      places: [{ key: "warehouse", kind: "warehouse", name: null, projectReference: null }], defaultPlace: "warehouse", requireInspection: true, receiveTolerancePercent: "0.00", requireSitePhoto: true };
    const deliveries: DeliveriesState = { expected: [{ ...sent.order, deliverTo: "site", linesLeft: 2, due: null }], inspection: [], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2", unmatched: [], requireSitePhoto: true };
    const fetcher = mount((url) => (url.includes("/receiving") ? form : url.includes("/returns") ? { returns: [], canBuy: true, canReceive: true } : url.includes("/receipts") ? receipt() : deliveries));
    page("deliveries");
    const grid = await screen.findByRole("grid", { name: "Expected deliveries" }).catch(() => screen.findByRole("table", { name: "Expected deliveries" }));
    await userEvent.click(await within(grid).findByRole("button", { name: "Receive FAC-PO-2026-00001" }));
    const dialog = await screen.findByRole("dialog", { name: "Receive FAC-PO-2026-00001" });
    await userEvent.type(await within(dialog).findByRole("textbox", { name: "On the note of Calacatta slab" }), "12");
    // Only the slab came.
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Received of Under-cabinet lights" }));
    expect(within(dialog).getByText("2 m² missing against the note")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Receive" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body.lines).toEqual([{ orderLineId: "a", received: "10", noted: "12" }]));
  });

  it("inspects a delivery line by line: a line left out keeps waiting", async () => {
    nav.query = "receipt=g1";
    const two = receipt();
    two.lines.push({ ...two.lines[0], id: "gl2", orderLineId: "b", description: "Under-cabinet lights", unit: "nos", received: "1.0000", pending: "1.0000", specification: "" });
    const fetcher = mount((url, body) => (url.includes("/receipts/g1") ? (body ? receipt({ pending: "1.0000", accepted: "6.0000" }, { canInspectThis: true }) : two)
      : url.includes("/returns") ? { returns: [], canBuy: true, canReceive: true } : { expected: [], inspection: [], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2", unmatched: [], requireSitePhoto: true }));
    page("deliveries");
    const sheet = await screen.findByRole("dialog", { name: "Delivery 4" });
    const later = (await within(sheet).findAllByRole("checkbox", { name: "Inspect now" }))[1];
    await userEvent.click(later);
    await userEvent.click(within(sheet).getByRole("button", { name: "Save inspection" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ lines: [{ id: "gl1", accepted: "6", rejected: "0", rejectKind: null, rejectReason: "" }] }));
  });

  it("sends rejected goods back to be replaced, keeping the reason, and records the pickup", async () => {
    nav.query = "receipt=g1";
    const inspected = receipt({ accepted: "5.0000", rejected: "1.0000", pending: "0.0000" }, { canInspectThis: false, canReturnThis: true, canReverseThis: false });
    inspected.lines[0] = { ...inspected.lines[0], accepted: "5.0000", rejected: "1.0000", pending: "0.0000", rejectKind: "wrong_spec", rejectReason: "Veins don't match" };
    const created: SupplierReturnState = { return: { id: "r1", number: 2, orderId: "o1", orderNumber: "FAC-PO-2026-00001", supplierName: "Nile Marble & Granite", locationName: "Warehouse",
      outcome: "replace", status: "open", note: "", createdByName: "Omar", createdAt: "2026-09-27T12:00:00Z", sentOn: null, sentByName: null, cancelReason: null, version: 1, lines: 1, credit: null, currency: "AED" },
      lines: [{ id: "rl1", receiptLineId: "gl1", receiptNumber: 4, description: "Calacatta slab", unit: "m²", source: "rejected", quantity: "1.0000", reasonKind: "wrong_spec", reason: "Veins don't match",
        creditAmount: null, creditTax: null, projectReference: "PRJ-0007" }], canBuy: true, canReceive: true, canSendThis: true, canCancelThis: true };
    const fetcher = mount((url, body) => (url.includes("/returns/r1") ? (body ? { ...created, return: { ...created.return, status: "sent", sentOn: "2026-09-28", version: 2 }, canSendThis: false, canCancelThis: false } : created)
      : url.includes("/returns") ? (body ? created : { returns: [created.return], canBuy: true, canReceive: true })
      : url.includes("/receipts/g1") ? inspected : url.includes("/orders/o1") ? orderState({ status: "partly_received" }) : { expected: [], inspection: [], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2", unmatched: [], requireSitePhoto: true }));
    page("deliveries");
    const sheet = await screen.findByRole("dialog", { name: "Delivery 4" });
    expect(await within(sheet).findByText("Not to spec (colour, finish, size): Veins don't match")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Return to supplier" }));
    const dialog = await screen.findByRole("dialog", { name: "Return to supplier" });
    expect(within(dialog).getByRole("textbox", { name: "Goes back of Calacatta slab rejected" })).toHaveValue("1");
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Email" })).toHaveValue("orders@nile.example"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Raise return" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ receiptId: "g1", outcome: "replace", send: true, to: "orders@nile.example",
      lines: [{ receiptLineId: "gl1", source: "rejected", quantity: "1", reasonKind: "wrong_spec", reason: "Veins don't match" }] }));
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/workspace/purchasing/deliveries?return=r1");
  });

  it("records the supplier collecting a credited return, with the credit due", async () => {
    nav.query = "return=r1";
    const credited: SupplierReturnState = { return: { id: "r1", number: 3, orderId: "o1", orderNumber: "FAC-PO-2026-00001", supplierName: "Nile Marble & Granite", locationName: "Warehouse",
      outcome: "credit", status: "open", note: "", createdByName: "Omar", createdAt: "2026-09-27T12:00:00Z", sentOn: null, sentByName: null, cancelReason: null, version: 1, lines: 1, credit: "367.5000", currency: "AED" },
      lines: [{ id: "rl1", receiptLineId: "gl1", receiptNumber: 4, description: "Calacatta slab", unit: "m²", source: "accepted", quantity: "1.0000", reasonKind: "defective", reason: "Hairline crack",
        creditAmount: "350.0000", creditTax: "17.5000", projectReference: "PRJ-0007" }], canBuy: true, canReceive: true, canSendThis: true, canCancelThis: true };
    const fetcher = mount((url, body) => (url.includes("/returns/r1") ? (body ? { ...credited, return: { ...credited.return, status: "sent", sentOn: "2026-09-28", version: 2 }, canSendThis: false, canCancelThis: false } : credited)
      : url.includes("/returns") ? { returns: [credited.return], canBuy: true, canReceive: true } : { expected: [], inspection: [], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2", unmatched: [], requireSitePhoto: true }));
    page("deliveries");
    const sheet = await screen.findByRole("dialog", { name: "Return 3" });
    expect(await within(sheet).findByText("Defective: Hairline crack")).toBeInTheDocument();
    // The credit carries its tax: 350.00 + 17.50.
    expect(sheet).toHaveTextContent(/367\.50/);
    await userEvent.click(within(sheet).getByRole("button", { name: "Collected by the supplier" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "sent", version: 1, commandId: expect.any(String) }));
    expect(await within(sheet).findByText("Gone back")).toBeInTheDocument();
  });

  it("reverses a delivery entered by mistake, saying what was wrong", async () => {
    nav.query = "receipt=g1";
    const fetcher = mount((url, body) => (url.includes("/receipts/g1") ? (body ? receipt({ reversedAt: "2026-09-27T12:00:00Z", reversedByName: "Sam Store", reverseReason: "Wrong order" }, { canReverseThis: false, canInspectThis: false })
      : receipt({}, { canReverseThis: true, canInspectThis: false })) : url.includes("/returns") ? { returns: [], canBuy: true, canReceive: true }
      : { expected: [], inspection: [], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2", unmatched: [], requireSitePhoto: true }));
    page("deliveries");
    const sheet = await screen.findByRole("dialog", { name: "Delivery 4" });
    await userEvent.click(await within(sheet).findByRole("button", { name: "Reverse" }));
    const dialog = await screen.findByRole("dialog", { name: "Reverse this delivery" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /What was wrong with it/ }), "Wrong order");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reverse" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ url: expect.stringContaining("/receipts/g1/reversal"), body: { reason: "Wrong order" } }));
    expect(await within(sheet).findByText("Reversed by Sam Store: Wrong order")).toBeInTheDocument();
  });

  it("shows what arrived on each line and asks why when closing an order short", async () => {
    nav.query = "order=o1";
    const partly = orderState({ status: "partly_received", sentAt: "2026-09-27T11:00:00Z", version: 6 }, {
      receipts: [receipt({ accepted: "5.0000", rejected: "1.0000", pending: "0.0000" }).receipt] });
    partly.lines[0] = { ...partly.lines[0], accepted: "5.0000", rejected: "1.0000" };
    const fetcher = mount((url) => (url.includes("/orders/o1") ? partly : ordersList));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "FAC-PO-2026-00001" });
    expect(await within(sheet).findByText("5 accepted · 1 rejected")).toBeInTheDocument();
    // Deliveries (and shipments) are the order's own tab.
    await userEvent.click(within(sheet).getByRole("tab", { name: /Deliveries/ }));
    expect(within(sheet).getByRole("button", { name: "Delivery 4" })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Close order" }));
    const close = await screen.findByRole("dialog", { name: "Close order" });
    expect(within(close).getByRole("button", { name: "Close order" })).toBeDisabled();
    await userEvent.type(within(close).getByRole("textbox", { name: /Why the rest won't come/ }), "Supplier out of stock");
    await userEvent.click(within(close).getByRole("button", { name: "Close order" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "close", version: 6, reason: "Supplier out of stock", commandId: expect.any(String) }));
  });

  it("opens on what needs me: approves others' orders in one go, never one I raised, and marks late ones first (D-22, D-44)", async () => {
    const row = (patch: Partial<OrdersState["orders"][number]>) => ({ ...orderState().order, ...patch });
    const list = { ...ordersList, me: "u2", canReceive: true, orders: [
      row({ id: "o1", number: "PO-1", status: "pending_approval", createdBy: "u1", submittedBy: "u1", version: 3 }),
      row({ id: "o2", number: "PO-2", status: "pending_approval", createdBy: "u2", submittedBy: "u2", version: 4 }),
      row({ id: "o3", number: "PO-3", status: "confirmed", createdBy: "u1", linesLeft: 1, due: "2020-01-10", version: 5 }),
      row({ id: "o4", number: "PO-4", status: "approved", createdBy: "u1", version: 6 }),
    ] };
    const fetcher = mount((url, body) => (body ? orderState() : url.includes("/orders?") ? list : ordersList));
    page("orders");
    // Needs me: PO-1 to approve, PO-3 to chase (late, first), PO-4 to send; not PO-2, which I raised.
    const grid = await screen.findByRole("grid", { name: "Orders" }).catch(() => screen.findByRole("table", { name: "Orders" }));
    await within(grid).findByText("PO-1");
    expect(screen.getByRole("button", { name: /^Needs me\s*3$/ })).toHaveAttribute("aria-pressed", "true");
    expect(grid).not.toHaveTextContent("PO-2");
    const rows = within(grid).getAllByRole("row").map((item) => item.textContent ?? "");
    expect(rows.findIndex((text) => text.includes("PO-3"))).toBeLessThan(rows.findIndex((text) => text.includes("PO-1")));
    expect(within(grid).getByRole("button", { name: "Chase PO-3" })).toBeInTheDocument();
    expect(within(grid).getByText(/days late/)).toBeInTheDocument();
    await userEvent.click(within(grid).getByRole("button", { name: "Approve PO-1" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "approve", version: 3 }));
    expect(await screen.findByText("Approved 1.")).toBeInTheDocument();
    // Waiting for approval shows both; only one of them is mine to approve.
    await userEvent.click(screen.getByRole("button", { name: /^Waiting for approval\s*2$/ }));
    expect(within(grid).queryByRole("button", { name: "Approve PO-2" })).not.toBeInTheDocument();
  });

  it("follows a shipment inside the order: carrier, tracking and when it arrives (the list shows it)", async () => {
    nav.query = "order=o1";
    const sent = orderState({ status: "confirmed", sentAt: "2026-09-27T11:00:00Z", version: 7 }, { shipments: [] });
    const tracked = orderState({ status: "confirmed", version: 8 }, { shipments: [{ id: "sh1", carrier: "Aramex", trackingRef: "AX-77", trackingUrl: "https://aramex.example/AX-77",
      status: "in_transit", shippedOn: "2026-09-28", eta: "2099-10-10", note: "", updatedAt: "2026-09-28T10:00:00Z", updatedByName: "Bina Buyer", version: 1 }] });
    const fetcher = mount((url, body) => (url.includes("/orders/o1") ? (body ? tracked : sent) : ordersList));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "FAC-PO-2026-00001" });
    expect(await within(sheet).findByRole("list", { name: "Where the order is" }).catch(() => within(sheet).getByLabelText("Where the order is"))).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("tab", { name: /Deliveries/ }));
    expect(within(sheet).getByText("No shipment followed yet.")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Add shipment" }));
    const dialog = await screen.findByRole("dialog", { name: "Add shipment" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Carrier" }), "Aramex");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Tracking link" }), "aramex.example");
    expect(within(dialog).getByText("The tracking link starts with https://.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Tracking link" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Tracking reference" }), "AX-77");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "track", version: 7, carrier: "Aramex", trackingRef: "AX-77", status: "booked", shipmentId: expect.any(String) }));
    expect(await within(sheet).findByText("Aramex · AX-77")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Track" })).toHaveAttribute("href", "https://aramex.example/AX-77");
  });
});

describe("price requests", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(window.history.replaceState).mockClear(); nav.query = ""; });
  const request = (patch: Partial<PriceRequestState> = {}): PriceRequestState => ({
    request: { id: "r1", number: 3, status: "open", neededBy: "2099-10-15", notes: "", currency: "AED", legalEntityId: "f", companyName: "Studio Furniture", createdByName: "Bina Buyer",
      createdAt: "2026-09-27T09:00:00Z", awardedAt: null, cancelReason: null, version: 4 },
    suppliers: [
      { vendorId: "a", name: "Siom Marble", approval: "approved", email: null, status: "replied", askedTo: null, leadTimeDays: 7, validUntil: null, note: "", repliedAt: "2026-09-27T10:00:00Z" },
      { vendorId: "b", name: "Nile Marble", approval: "approved", email: null, status: "replied", askedTo: null, leadTimeDays: 14, validUntil: "2099-10-30", note: "", repliedAt: "2026-09-27T10:00:00Z" },
      { vendorId: "c", name: "Lilacs Marble", approval: "pending", email: null, status: "asked", askedTo: null, leadTimeDays: null, validUntil: null, note: "", repliedAt: null }],
    lines: [{ id: "l1", position: 0, projectId: "p1", projectReference: "PRJ-0007", source: "material", materialItemId: "m1", boqLineId: null, description: "Calacatta slab", specification: "",
      quantity: "12.0000", unit: "m²", awardedVendorId: null, awardReason: "", orderId: null }],
    quotes: [{ vendorId: "a", lineId: "l1", unitPrice: "360.0000", discountPercent: "0.00", net: "4320.00" }, { vendorId: "b", lineId: "l1", unitPrice: "380.0000", discountPercent: "10.00", net: "4104.00" }],
    cheapest: { l1: "b" }, totals: { a: { net: "4320.00", priced: 1 }, b: { net: "4104.00", priced: 1 }, c: { net: "0.00", priced: 0 } }, orders: [], canBuy: true, ...patch,
  });

  it("compares suppliers, marks the cheapest after discount, and asks why when awarding a dearer one", async () => {
    nav.query = "request=r1";
    const fetcher = mount((url, body) => (url.includes("/price-requests/r1") ? (body ? request({ orders: [{ id: "o9", number: "FAC-PO-2026-00009", vendorId: "a" }],
      request: { ...request().request, status: "awarded", version: 5 } }) : request()) : { requests: [], canBuy: true }));
    page("price-requests");
    const sheet = await screen.findByRole("dialog", { name: "Price request 3" });
    const nile = await within(sheet).findByRole("button", { name: "Award Calacatta slab to Nile Marble" });
    expect(nile).toHaveAttribute("aria-pressed", "true");
    expect(nile).toHaveTextContent("Cheapest");
    await userEvent.click(within(sheet).getByRole("button", { name: "Award Calacatta slab to Siom Marble" }));
    const award = within(sheet).getByRole("button", { name: "Award and create orders" });
    expect(award).toBeDisabled();
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Why Calacatta slab isn't going to the cheapest" }), "Nile can't deliver in time");
    await userEvent.click(award);
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "award", version: 4, awards: [{ lineId: "l1", vendorId: "a", reason: "Nile can't deliver in time" }] }));
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/workspace/purchasing/orders?order=o9");
  });

  it("records a supplier's reply with a price, a discount and a delivery time", async () => {
    nav.query = "request=r1";
    const fetcher = mount((url) => (url.includes("/price-requests/r1") ? request() : { requests: [], canBuy: true }));
    page("price-requests");
    const sheet = await screen.findByRole("dialog", { name: "Price request 3" });
    const lilacs = await within(sheet).findByRole("columnheader", { name: /Lilacs Marble/ });
    await userEvent.click(within(lilacs).getByRole("button", { name: "Record reply" }));
    const reply = await screen.findByRole("dialog", { name: "Lilacs Marble" });
    await userEvent.type(within(reply).getByRole("textbox", { name: "Price for Calacatta slab" }), "340");
    await userEvent.type(within(reply).getByRole("textbox", { name: "Discount for Calacatta slab" }), "5");
    await userEvent.type(within(reply).getByRole("textbox", { name: "Delivery in days" }), "10");
    await userEvent.click(within(reply).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "record_reply", vendorId: "c", version: 4, leadTimeDays: "10",
      prices: [{ lineId: "l1", unitPrice: "340", discountPercent: "5" }] }));
  });
});
