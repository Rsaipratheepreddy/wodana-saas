import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { Need, OrderState, PriceRequestState, Supplier, SupplierImportPlan, SupplierState } from "@/lib/purchasing/types";
import { PurchasingPage, type PurchasingSection } from "./purchasing-page";

const nav = vi.hoisted(() => ({ replace: vi.fn(), query: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }), usePathname: () => "/workspace/purchasing", useSearchParams: () => new URLSearchParams(nav.query) }));

const supplier = (patch: Partial<Supplier>): Supplier => ({
  id: "s1", code: "NILE", name: "Nile Marble & Granite", legalName: null, categories: ["Marble", "Travertine"], approval: "approved", preferredFor: ["Marble"], approvalNote: "",
  approvalAt: "2026-09-20T10:00:00Z", approvalByName: "Dara Director", paymentTerms: "split", advancePercent: "50.00", creditDays: null, termsNote: "", deal: "discount", dealPercent: "10.00",
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
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) }));
const page = (section: PurchasingSection = "suppliers") => render(<DesignSystemProvider><PurchasingPage workspaceId="w" section={section} /></DesignSystemProvider>);

describe("suppliers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists suppliers in use with approval, terms, deal and companies, and filters them", async () => {
    mount(() => state());
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
    const fetcher = mount(() => state());
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
    const fetcher = mount(() => state());
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
  afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); nav.query = ""; });
  const need = (patch: Partial<Need>): Need => ({ key: "material:m1", source: "material", sourceId: "m1", projectId: "p1", projectReference: "PRJ-0007", projectName: "Villa 12",
    title: "Calacatta slab", detail: "CAL-20", unit: "m²", required: "12.0000", placed: "0", drafted: "0", remaining: "12.0000", catalogItemId: null, supplierHint: "Nile", packageName: null,
    supply: null, blocked: null, ...patch });
  const needs = { needs: [need({}), need({ key: "line:l1", source: "line", sourceId: "l1", title: "Under-cabinet lights", detail: "", unit: "nos", required: "1.0000", remaining: "1.0000",
    supplierHint: "", packageName: "Lights" }), need({ key: "material:m9", sourceId: "m9", projectId: "p2", projectReference: "PRJ-0008", projectName: "Marina", title: "Oak veneer", blocked: "material_signoff" })],
    settings: { approvalThreshold: "0", requireMaterialSignoff: true, requireApprovedSupplier: true, version: 1 }, canBuy: true, canApprove: true };
  const orderState = (patch: Partial<OrderState["order"]> = {}, rights: Partial<OrderState> = {}): OrderState => ({
    order: { id: "o1", number: "FAC-PO-2026-00001", status: "draft", vendorId: "s1", supplierName: "Nile Marble & Granite", legalEntityId: "f", companyCode: "FAC", currency: "AED",
      total: "3780.0000", expectedDate: "2099-10-20", promisedDate: null, createdAt: "2026-09-27T09:00:00Z", createdByName: "Bina Buyer", projects: [{ id: "p1", reference: "PRJ-0007" }], lines: 2,
      revision: 0, version: 1, paymentTerms: "split", advancePercent: "50.00", creditDays: null, termsNote: "", deliverTo: "site", deliveryAddress: "Villa 12, Palm", supplierReference: "", notes: "",
      subtotal: "4000.0000", discountTotal: "400.0000", taxTotal: "180.0000", createdBy: "u1", submittedBy: null, approvedByName: null, approvedAt: null, sentAt: null, sentTo: null,
      confirmedAt: null, cancelledAt: null, cancelReason: null, companyName: "Studio Furniture", ...patch },
    lines: [
      { id: "a", position: 0, projectId: "p1", projectReference: "PRJ-0007", source: "material", materialItemId: "m1", boqLineId: null, description: "Calacatta slab", specification: "CAL-20",
        quantity: "10.0000", unit: "m²", unitPrice: "350.0000", discountPercent: "10.00", taxRate: "5.0000", net: "3150.0000", tax: "157.5000", total: "3307.5000" },
      { id: "b", position: 1, projectId: "p1", projectReference: "PRJ-0007", source: "line", materialItemId: null, boqLineId: "l1", description: "Under-cabinet lights", specification: "",
        quantity: "1.0000", unit: "nos", unitPrice: "500.0000", discountPercent: "10.00", taxRate: "5.0000", net: "450.0000", tax: "22.5000", total: "472.5000" }],
    events: [{ id: "e1", kind: "created", detail: {}, byName: "Bina Buyer", at: "2026-09-27T09:00:00Z" }], revisions: [],
    supplier: { id: "s1", name: "Nile Marble & Granite", email: "orders@nile.example", phone: null, contactName: "Mohamed", approval: "approved", deal: "discount", dealPercent: "10.00" },
    canBuy: true, canApprove: true, canApproveThis: false, ...rights,
  });
  const ordersList = { orders: [orderState().order], settings: needs.settings, canBuy: true, canApprove: true };

  it("lists what projects need, keeps unsigned lists apart, and orders the chosen lines from one supplier", async () => {
    const fetcher = mount((url, body) => (url.includes("/needs") ? needs : url.includes("/suppliers") ? state() : body ? orderState() : ordersList));
    page("to-order");
    const table = await screen.findByRole("table", { name: "To order" }).catch(() => screen.findByRole("grid", { name: "To order" }));
    expect(table).toHaveTextContent("PRJ-0007 · Villa 12");
    expect(table).not.toHaveTextContent("Oak veneer");
    expect(screen.getByRole("region", { name: "Waiting for the client's sign-off" })).toHaveTextContent("Oak veneer");
    await userEvent.click(within(table).getByRole("checkbox", { name: "Select PRJ-0007 Calacatta slab" }));
    await userEvent.click(within(table).getByRole("checkbox", { name: "Select PRJ-0007 Under-cabinet lights" }));
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
    expect(nav.replace).toHaveBeenLastCalledWith("/workspace/purchasing/orders?order=o1", { scroll: false });
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
});

describe("price requests", () => {
  afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); nav.query = ""; });
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
    expect(nav.replace).toHaveBeenLastCalledWith("/workspace/purchasing/orders?order=o9", { scroll: false });
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
