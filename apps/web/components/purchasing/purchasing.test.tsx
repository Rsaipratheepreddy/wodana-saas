import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { DeliveriesState, Need, OrderState, PriceRequestState, ReceiptState, ReceivingForm, Supplier, SupplierImportPlan, SupplierReturnState, SupplierState } from "@/lib/purchasing/types";
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
    title: "Calacatta slab", detail: "CAL-20", unit: "m²", required: "12.0000", placed: "0", drafted: "0", received: "0", remaining: "12.0000", catalogItemId: null, supplierHint: "Nile", packageName: null,
    supply: null, clientChoice: true, blocked: null, ...patch });
  const needs = { needs: [need({}), need({ key: "line:l1", source: "line", sourceId: "l1", title: "Under-cabinet lights", detail: "", unit: "nos", required: "1.0000", remaining: "1.0000",
    supplierHint: "", packageName: "Lights" }), need({ key: "material:m9", sourceId: "m9", projectId: "p2", projectReference: "PRJ-0008", projectName: "Marina", title: "Oak veneer", blocked: "material_signoff" })],
    settings: { approvalThreshold: "0", requireMaterialSignoff: true, requireApprovedSupplier: true, requireInspection: true, receiveTolerancePercent: "0.00", version: 1 }, canBuy: true, canApprove: true };
  const orderState = (patch: Partial<OrderState["order"]> = {}, rights: Partial<OrderState> = {}): OrderState => ({
    order: { id: "o1", number: "FAC-PO-2026-00001", status: "draft", vendorId: "s1", supplierName: "Nile Marble & Granite", legalEntityId: "f", companyCode: "FAC", currency: "AED",
      total: "3780.0000", expectedDate: "2099-10-20", promisedDate: null, createdAt: "2026-09-27T09:00:00Z", createdByName: "Bina Buyer", projects: [{ id: "p1", reference: "PRJ-0007" }], lines: 2,
      revision: 0, version: 1, paymentTerms: "split", advancePercent: "50.00", creditDays: null, termsNote: "", deliverTo: "site", deliveryAddress: "Villa 12, Palm", supplierReference: "", notes: "",
      subtotal: "4000.0000", discountTotal: "400.0000", taxTotal: "180.0000", createdBy: "u1", submittedBy: null, approvedByName: null, approvedAt: null, sentAt: null, sentTo: null,
      confirmedAt: null, cancelledAt: null, cancelReason: null, closedAt: null, closeReason: null, overReason: null, companyName: "Studio Furniture", ...patch },
    lines: [
      { id: "a", position: 0, projectId: "p1", projectReference: "PRJ-0007", source: "material", materialItemId: "m1", boqLineId: null, description: "Calacatta slab", specification: "CAL-20",
        quantity: "10.0000", unit: "m²", unitPrice: "350.0000", discountPercent: "10.00", taxRate: "5.0000", net: "3150.0000", tax: "157.5000", total: "3307.5000",
        accepted: "0.0000", rejected: "0.0000", pending: "0.0000", credited: "0.0000", returned: "0.0000",
        promisedDate: null, confirmedQuantity: null, due: null, cancelled: "0.0000", cancelReason: null, replacesLineId: null, replacesOrderNumber: null },
      { id: "b", position: 1, projectId: "p1", projectReference: "PRJ-0007", source: "line", materialItemId: null, boqLineId: "l1", description: "Under-cabinet lights", specification: "",
        quantity: "1.0000", unit: "nos", unitPrice: "500.0000", discountPercent: "10.00", taxRate: "5.0000", net: "450.0000", tax: "22.5000", total: "472.5000",
        accepted: "0.0000", rejected: "0.0000", pending: "0.0000", credited: "0.0000", returned: "0.0000",
        promisedDate: null, confirmedQuantity: null, due: null, cancelled: "0.0000", cancelReason: null, replacesLineId: null, replacesOrderNumber: null }],
    events: [{ id: "e1", kind: "created", detail: {}, byName: "Bina Buyer", at: "2026-09-27T09:00:00Z" }], revisions: [],
    supplier: { id: "s1", name: "Nile Marble & Granite", email: "orders@nile.example", phone: null, contactName: "Mohamed", approval: "approved", deal: "discount", dealPercent: "10.00" },
    receipts: [], returns: [], canBuy: true, canApprove: true, canApproveThis: false, canReceive: true, overOrdered: [], packs: [], ...rights,
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
    mount((url) => (url.includes("/needs") ? { ...needs, needs: [need({ placed: "14.0000", remaining: "-2.0000" })] } : ordersList));
    page("to-order");
    expect(await screen.findByText("Ordered 2 m² more than needed")).toBeInTheDocument();
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
    await waitFor(() => expect(nav.replace).toHaveBeenLastCalledWith("/workspace/purchasing/orders?order=o2", { scroll: false }));
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
      reverseReason: null, ...patch },
    lines: [{ id: "gl1", orderLineId: "a", description: "Calacatta slab", specification: "CAL-20", unit: "m²", projectReference: "PRJ-0007", boqLineId: null, projectId: "p1",
      received: "6.0000", accepted: "0.0000", rejected: "0.0000", pending: "6.0000", rejectReason: "", rejectKind: null, noted: null, inspectedByName: null,
      returnedRejected: "0.0000", returnedAccepted: "0.0000" }],
    canBuy: true, canReceive: true, canInspect: true, canInspectThis: true, canReturnThis: false, canReverseThis: false, ...rights,
  });

  it("lists expected deliveries, late ones marked, and receives what arrived at the project's site", async () => {
    const sent = orderState({ status: "confirmed", promisedDate: "2020-01-10", sentAt: "2026-09-27T11:00:00Z" });
    const deliveries: DeliveriesState = { expected: [{ ...sent.order, deliverTo: "site", linesLeft: 2, due: "2020-01-10" }], inspection: [receipt().receipt], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2" };
    const form: ReceivingForm = { order: sent.order, lines: sent.lines.map((line) => ({ ...line, outstanding: line.quantity, receivable: line.quantity })),
      places: [{ key: "site:p1", kind: "site", name: null, projectReference: "PRJ-0007" }, { key: "warehouse", kind: "warehouse", name: null, projectReference: null }],
      defaultPlace: "site:p1", requireInspection: true, receiveTolerancePercent: "0.00" };
    const fetcher = mount((url) => (url.includes("/receiving") ? form : url.includes("/receipts") ? receipt() : url.includes("/deliveries") ? deliveries : ordersList));
    page("deliveries");
    const grid = await screen.findByRole("grid", { name: "Expected deliveries" }).catch(() => screen.findByRole("table", { name: "Expected deliveries" }));
    await within(grid).findByText("FAC-PO-2026-00001");
    expect(grid).toHaveTextContent(/days late/);
    expect(grid).toHaveTextContent("2 lines to come");
    expect(screen.getByRole("radio", { name: "To inspect (1)" })).toBeInTheDocument();
    await userEvent.click(within(grid).getByRole("button", { name: "Receive" }));
    const dialog = await screen.findByRole("dialog", { name: "Receive FAC-PO-2026-00001" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Arrived at/ })).toHaveTextContent("PRJ-0007 site"));
    // Inspection is on: nothing is accepted or rejected at receipt.
    expect(within(dialog).queryByRole("textbox", { name: "Rejected of Calacatta slab" })).toBeNull();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Received of Calacatta slab" }), "11");
    expect(within(dialog).getByText("At most 10 m² of Calacatta slab can arrive.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Receive" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Everything left" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Delivery note" }), "DN-88");
    await userEvent.click(within(dialog).getByRole("button", { name: "Receive" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.url).toContain("/api/purchasing/receipts?"));
    expect(posts(fetcher).at(-1)!.body).toMatchObject({ orderId: "o1", place: "site:p1", deliveryNote: "DN-88", lines: [{ orderLineId: "a", received: "10" }, { orderLineId: "b", received: "1" }] });
    expect(nav.replace).toHaveBeenLastCalledWith("/workspace/purchasing/deliveries?receipt=g1", { scroll: false });
  });

  it("inspects a delivery someone else received: accepted by default, a rejection needs its reason", async () => {
    nav.query = "receipt=g1";
    const fetcher = mount((url, body) => (url.includes("/receipts/g1") ? (body ? receipt({ accepted: "5.0000", rejected: "1.0000", pending: "0.0000", inspectedByName: "Dara Director",
      inspectedAt: "2026-09-27T12:00:00Z" }, { canInspectThis: false }) : receipt()) : { expected: [], inspection: [], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2" }));
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
      places: [{ key: "warehouse", kind: "warehouse", name: null, projectReference: null }], defaultPlace: "warehouse", requireInspection: true, receiveTolerancePercent: "0.00" };
    const deliveries: DeliveriesState = { expected: [{ ...sent.order, deliverTo: "site", linesLeft: 2, due: null }], inspection: [], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2" };
    const fetcher = mount((url) => (url.includes("/receiving") ? form : url.includes("/returns") ? { returns: [], canBuy: true, canReceive: true } : url.includes("/receipts") ? receipt() : deliveries));
    page("deliveries");
    const grid = await screen.findByRole("grid", { name: "Expected deliveries" }).catch(() => screen.findByRole("table", { name: "Expected deliveries" }));
    await userEvent.click(await within(grid).findByRole("button", { name: "Receive" }));
    const dialog = await screen.findByRole("dialog", { name: "Receive FAC-PO-2026-00001" });
    await userEvent.type(await within(dialog).findByRole("textbox", { name: "On the note of Calacatta slab" }), "12");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Received of Calacatta slab" }), "10");
    expect(within(dialog).getByText("2 m² missing against the note")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Receive" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body.lines).toEqual([{ orderLineId: "a", received: "10", noted: "12" }]));
  });

  it("inspects a delivery line by line: a line left out keeps waiting", async () => {
    nav.query = "receipt=g1";
    const two = receipt();
    two.lines.push({ ...two.lines[0], id: "gl2", orderLineId: "b", description: "Under-cabinet lights", unit: "nos", received: "1.0000", pending: "1.0000", specification: "" });
    const fetcher = mount((url, body) => (url.includes("/receipts/g1") ? (body ? receipt({ pending: "1.0000", accepted: "6.0000" }, { canInspectThis: true }) : two)
      : url.includes("/returns") ? { returns: [], canBuy: true, canReceive: true } : { expected: [], inspection: [], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2" }));
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
      : url.includes("/receipts/g1") ? inspected : url.includes("/orders/o1") ? orderState({ status: "partly_received" }) : { expected: [], inspection: [], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2" }));
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
    expect(nav.replace).toHaveBeenLastCalledWith("/workspace/purchasing/deliveries?return=r1", { scroll: false });
  });

  it("records the supplier collecting a credited return, with the credit due", async () => {
    nav.query = "return=r1";
    const credited: SupplierReturnState = { return: { id: "r1", number: 3, orderId: "o1", orderNumber: "FAC-PO-2026-00001", supplierName: "Nile Marble & Granite", locationName: "Warehouse",
      outcome: "credit", status: "open", note: "", createdByName: "Omar", createdAt: "2026-09-27T12:00:00Z", sentOn: null, sentByName: null, cancelReason: null, version: 1, lines: 1, credit: "367.5000", currency: "AED" },
      lines: [{ id: "rl1", receiptLineId: "gl1", receiptNumber: 4, description: "Calacatta slab", unit: "m²", source: "accepted", quantity: "1.0000", reasonKind: "defective", reason: "Hairline crack",
        creditAmount: "350.0000", creditTax: "17.5000", projectReference: "PRJ-0007" }], canBuy: true, canReceive: true, canSendThis: true, canCancelThis: true };
    const fetcher = mount((url, body) => (url.includes("/returns/r1") ? (body ? { ...credited, return: { ...credited.return, status: "sent", sentOn: "2026-09-28", version: 2 }, canSendThis: false, canCancelThis: false } : credited)
      : url.includes("/returns") ? { returns: [credited.return], canBuy: true, canReceive: true } : { expected: [], inspection: [], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2" }));
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
      : { expected: [], inspection: [], received: [], locations: [], canReceive: true, canInspect: true, userId: "u2" }));
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
    expect(within(sheet).getByRole("button", { name: "Delivery 4" })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Close order" }));
    const close = await screen.findByRole("dialog", { name: "Close order" });
    expect(within(close).getByRole("button", { name: "Close order" })).toBeDisabled();
    await userEvent.type(within(close).getByRole("textbox", { name: /Why the rest won't come/ }), "Supplier out of stock");
    await userEvent.click(within(close).getByRole("button", { name: "Close order" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "close", version: 6, reason: "Supplier out of stock", commandId: expect.any(String) }));
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
