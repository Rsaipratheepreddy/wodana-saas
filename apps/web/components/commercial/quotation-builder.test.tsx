import { useState } from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuotationEditor } from "./quotation-editor";
import { PaymentScheduleEditor } from "./payment-schedule-editor";
import { ClientQuotation } from "./client-quotation";
import type { Quote } from "@/lib/commercial/types";
vi.mock("@/components/pre-project/case-controls", () => ({
  CatalogChoiceField: ({ label }: { label: string }) => <span>{label}</span>,
}));
const initial = (): Quote => ({
  id: "q1",
  number: 1,
  kind: "quotation",
  status: "draft",
  title: "Villa proposal",
  currency: "AED",
  validUntil: "2099-01-01",
  cover: {
    preparedFor: "Demo customer",
    location: "Dubai",
    subtitle: "Interiors",
  },
  discount: 0,
  taxRate: 0,
  terms: "Payment on milestones",
  exclusions: "",
  inclusions: "Delivery included",
  createdAt: "2026-09-07",
  requestIds: [],
  total: 100,
  lines: [
    {
      id: "line1",
      room: "Bedroom",
      title: "Wardrobe",
      material: "Oak veneer",
      finish: "Matte lacquer",
      specification: "Soft-close doors",
      quantity: 1,
      unit: "nos",
      rate: 100,
      unitCost: 61,
    },
  ],
  paymentTerms: [
    {
      id: "m1",
      title: "Advance",
      percent: 50,
      trigger: "On agreement",
      requiredForRelease: true,
    },
    {
      id: "m2",
      title: "Handover",
      percent: 50,
      trigger: "On handover",
      requiredForRelease: false,
    },
  ],
});
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }),
  ),
);
function Editor({
  catalogPriced = false,
  costing = false,
  canEditCosts = false,
}: {
  catalogPriced?: boolean;
  costing?: boolean;
  canEditCosts?: boolean;
}) {
  const [quote, setQuote] = useState(() => {
    const value = initial();
    if (catalogPriced) value.lines[0].catalogLinks = [{ role: "work", recordId: "work-1", version: 2, snapshot: { id: "work-1", name: "Wardrobe", code: "W", kind: "work", version: 2, catalogId: "catalog-1", commerce: { pricingMode: "fixed" } } }];
    return value;
  });
  return (
    <QuotationEditor
      quote={quote}
      onChange={setQuote}
      workspaceId="workspace"
      caseId="case"
      readOnly={false}
      costing={costing}
      canEditCosts={canEditCosts}
      requests={[]}
      itemsOnly
    />
  );
}
describe("Quotation builder interactions", () => {
  it("keeps internal cost and margin absent without cost-view capability", () => {
    render(<Editor />);
    expect(
      screen.queryByRole("columnheader", { name: "Unit cost" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Gross margin")).not.toBeInTheDocument();
    expect(screen.queryByText(/61\.00/)).not.toBeInTheDocument();
  });

  it("shows read-only cost evidence separately from cost-edit permission", () => {
    const { unmount } = render(<Editor costing />);
    expect(
      screen.getByRole("columnheader", { name: "Unit cost" }),
    ).toBeVisible();
    expect(screen.getByRole("table")).toHaveTextContent("61.00");
    expect(screen.queryByLabelText("Cost for Wardrobe")).not.toBeInTheDocument();
    unmount();

    render(<Editor costing canEditCosts />);
    expect(screen.getByLabelText("Cost for Wardrobe")).toHaveValue("61.00");
  });

  it("keeps the BOQ rate consistent with backend catalogue pricing", async () => {
    const snapshot = { status: "resolved", source: "catalog", mode: "fixed", catalogId: "catalog-1", work: { id: "work-1", version: 2 }, unitLabel: "nos", quantity: 1, currency: "AED", pricingDate: "2026-09-17", taxRate: 0, resolvedAt: "2026-09-17T00:00:00Z", rateCard: { appliedUnitRate: 275 } };
    vi.mocked(fetch).mockImplementation(async (url) => ({ ok: true, json: async () => String(url).includes("/catalog-price") ? { status: "resolved", code: "resolved", message: "Price resolved", snapshot } : { items: [] } }) as Response);
    render(<Editor catalogPriced />);
    expect(screen.queryByRole("textbox", { name: "Rate for Wardrobe" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review price for Wardrobe" }));
    await userEvent.click(screen.getByRole("button", { name: "Check price" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByRole("table", { name: "Quotation items · Bedroom" })).toHaveTextContent("275.00"));
  });
  it("shows material in a dedicated column and applies edited material to the correct item", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    expect(
      screen.getByRole("columnheader", { name: "Materials & finishes" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Edit material for Wardrobe" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.clear(
      within(dialog).getByLabelText("Material specification / notes", { exact: true }),
    );
    await user.type(
      within(dialog).getByLabelText("Material specification / notes", { exact: true }),
      "Walnut veneer",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Apply to quotation" }),
    );
    expect(
      screen.getByRole("table"),
    ).toHaveTextContent("Walnut veneer");
    expect(screen.getByText("Soft-close doors")).toBeVisible();
  });
  it("opens a focused material editor and discards unconfirmed changes", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.click(screen.getByRole("button", { name: "Edit material for Wardrobe" }));
    const dialog = screen.getByRole("dialog", { name: "Materials & finishes" });
    expect(within(dialog).queryByLabelText("Selling rate")).not.toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("Material specification / notes", { exact: true }));
    await user.type(within(dialog).getByLabelText("Material specification / notes", { exact: true }), "Unconfirmed finish");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("table")).toHaveTextContent("Oak veneer");
  });
  it("keeps an empty room and adds its first item only after applying the details", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.click(screen.getByRole("button", { name: "Add room" }));
    await user.type(screen.getByLabelText("Room name"), "Kitchen");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add room" }));
    expect(screen.getByRole("region",{name:"Quotation items · Kitchen"})).toHaveTextContent("No records found");
    expect(screen.getByRole("button",{name:"Add item to Kitchen"})).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add item to Kitchen" }));
    expect(screen.queryByRole("table", { hidden: true })).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Item", { exact: true }));
    await user.type(
      within(dialog).getByLabelText("Item", { exact: true }),
      "Base cabinet",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Apply to quotation" }),
    );
    expect(
      screen.getByRole("button", { name: "Edit details for Base cabinet" }),
    ).toBeVisible();
    expect(screen.getByRole("table",{name:"Quotation items · Kitchen"})).toHaveTextContent("Base cabinet");
  });
  it("adds multiple catalog products, keeps notes separate and removes the correct link", async () => {
    const user = userEvent.setup();
    const choices = [{ id: "ply", name: "BWP plywood", code: "PLY-18", kind: "material", catalogId: "cat", catalogName: "Joinery", version: 3 }, { id: "hinge", name: "Soft-close hinge", code: "HG-110", kind: "hardware", catalogId: "cat", catalogName: "Joinery", version: 2 }];
    vi.mocked(fetch).mockImplementation(async (url) => ({ ok: true, json: async () => ({ items: String(url).includes("kind=material") ? choices : [] }) }) as Response);
    render(<Editor />);
    await user.click(screen.getByRole("button", { name: "Edit material for Wardrobe" }));
    const dialog = screen.getByRole("dialog");
    const choose = async (name: string) => {
      const field = within(dialog).getByRole("combobox", { name: "Material / SKU from catalog" });
      await user.click(field);
      await user.type(field, name);
      await user.click(await screen.findByRole("option", { name: `${name} · Joinery` }));
    };
    await choose("BWP plywood");
    expect(within(dialog).getByText("Catalog linked · v3")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Add material or hardware" }));
    await choose("Soft-close hinge");
    const notes = within(dialog).getByLabelText("Material specification / notes");
    expect(notes).toHaveValue("Oak veneer");
    await user.clear(notes);
    await user.type(notes, "18 mm carcass");
    await user.click(within(dialog).getByRole("button", { name: "Apply to quotation" }));
    expect(screen.getByRole("table")).toHaveTextContent("2 catalog materials");
    expect(screen.getByRole("table")).toHaveTextContent("PLY-18");
    expect(screen.getByRole("table")).toHaveTextContent("HG-110");
    expect(screen.getByRole("table")).toHaveTextContent("18 mm carcass");
    await user.click(screen.getByRole("button", { name: "Edit material for Wardrobe" }));
    await user.click(screen.getByRole("button", { name: "Remove BWP plywood" }));
    await user.click(screen.getByRole("button", { name: "Apply to quotation" }));
    expect(screen.getByRole("table")).not.toHaveTextContent("PLY-18");
    expect(screen.getByRole("table")).toHaveTextContent("HG-110");
    expect(screen.getByRole("table")).toHaveTextContent("18 mm carcass");
    expect(screen.getByLabelText("Rate for Wardrobe")).toHaveValue("100.00");
  });
  it("retains the existing amount for an empty, negative or nonnumeric edit", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    const rate = screen.getByLabelText("Rate for Wardrobe");
    await user.clear(rate);
    await user.tab();
    expect(rate).toHaveValue("100.00");
    await user.clear(rate);
    await user.type(rate, "-12");
    await user.tab();
    expect(rate).toHaveValue("100.00");
    await user.clear(rate);
    await user.type(rate, "1450.25");
    await user.tab();
    expect(rate).toHaveValue("1450.25");
    const quantity = screen.getByLabelText("Quantity for Wardrobe");
    await user.clear(quantity);
    await user.type(quantity, "16");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("table")).toHaveTextContent("23,204.00");
  });
  it("reorders payment milestones with accessible buttons while preserving amounts", async () => {
    const user = userEvent.setup();
    function Payments() {
      const [quote, setQuote] = useState(initial);
      return (
        <PaymentScheduleEditor
          quote={quote}
          onChange={setQuote}
          workspaceId="workspace"
          readOnly={false}
        />
      );
    }
    render(<Payments />);
    await user.click(screen.getByRole("button", { name: "Move Handover up" }));
    expect(screen.getByLabelText("Milestone 1 title")).toHaveValue("Handover");
    expect(screen.getByLabelText("Milestone 2 title")).toHaveValue("Advance");
    expect(screen.getAllByText(/50\.00/).length).toBe(2);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });
  it("client document shows cover, materials and included scope without internal cost analysis", () => {
    const quote = initial();
    render(<ClientQuotation quote={{ ...quote, canDecide: false, expired: false }} />);
    expect(screen.getByText("Oak veneer · Matte lacquer · Soft-close doors")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Reference image" })).toBeVisible();
    expect(screen.getByText("Delivery included")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Quotation cover" })).getByText("Demo customer")).toBeVisible();
    expect(screen.queryByText(/61\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText("Gross margin")).not.toBeInTheDocument();
  });
});
