import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { Supplier, SupplierImportPlan, SupplierState } from "@/lib/purchasing/types";
import { PurchasingPage } from "./purchasing-page";

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
const page = () => render(<DesignSystemProvider><PurchasingPage workspaceId="w" /></DesignSystemProvider>);

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
