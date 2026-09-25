import { useState } from "react";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { QuotationStudio } from "./quotation-studio";
import type {
  ChangeRequest,
  Quote,
  CommercialState,
} from "@/lib/commercial/types";
const initial = (): Quote => ({
  id: "q",
  number: 1,
  kind: "quotation",
  status: "draft",
  title: "Villa proposal",
  currency: "AED",
  validUntil: "2099-01-01",
  discount: 0,
  taxRate: 0,
  terms: "Terms",
  exclusions: "",
  createdAt: "2026-09-08",
  requestIds: [],
  total: 100,
  rooms: [{ id: "room1", name: "Living room" }],
  lines: [
    {
      id: "item1",
      room: "Living room",
      title: "Wardrobe",
      quantity: 2,
      unit: "nos",
      rate: 100,
      unitCost: 60,
      material: "Oak",
      finish: "Matte",
      specification: "Soft close",
    },
  ],
  paymentTerms: [],
});
const onChange = vi.fn();
const request: ChangeRequest = {
  id: "cr1",
  number: 7,
  title: "Add reception display",
  detail: "Client requested an additional display.",
  status: "open",
  owner: "",
  dueDate: "",
  resolution: "",
  comments: [],
  createdAt: "2026-09-09",
};
function Harness({
  readOnly = false,
  withRequest = false,
  catalogPriced = false,
}: {
  readOnly?: boolean;
  withRequest?: boolean;
  catalogPriced?: boolean;
}) {
  const [quote, setQuote] = useState(() => {
    const value = initial();
    if (catalogPriced) value.lines[0].catalogLinks = [{ role: "work", recordId: "work-1", version: 2, snapshot: { id: "work-1", name: "Wardrobe", code: "W", kind: "work", version: 2, catalogId: "catalog-1", commerce: { pricingMode: "fixed" } } }];
    return value;
  });
  return (
    <QuotationStudio
      quote={quote}
      onChange={(q) => {
        onChange(q);
        setQuote(q);
      }}
      state={
        { data: { revision: 1, quotes: [] }, canOverridePrice: true } as unknown as CommercialState
      }
      workspaceId="w"
      caseId="c"
      readOnly={readOnly}
      costing={false}
      requests={withRequest ? [request] : []}
      customerName="Client"
      onSave={async () => true}
      onImportScope={() => {}}
    />
  );
}
beforeEach(() => {
  onChange.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [], templates: [] }), {
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});
describe("quotation spreadsheet workspace", () => {
  it("uses backend catalogue pricing in the builder instead of an editable rate", async () => {
    const snapshot = { status: "resolved", source: "catalog", mode: "fixed", catalogId: "catalog-1", work: { id: "work-1", version: 2 }, unitLabel: "nos", quantity: 2, currency: "AED", pricingDate: "2026-09-17", taxRate: 0, resolvedAt: "2026-09-17T00:00:00Z", rateCard: { appliedUnitRate: 275 } };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes("/catalog-price") ? { status: "resolved", code: "resolved", message: "Price resolved", snapshot } : { items: [], templates: [] }), { headers: { "content-type": "application/json" } })));
    render(<Harness catalogPriced />);
    expect(screen.queryByRole("textbox", { name: "Rate for Wardrobe" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review price for Wardrobe" }));
    await userEvent.click(screen.getByRole("button", { name: "Check price" }));
    await waitFor(() => expect(onChange.mock.lastCall?.[0].lines[0]).toMatchObject({ rate: 275, catalogPriceRequest: { action: "resolve" }, catalogPrice: snapshot }));
  });
  it("shows a table and compact toolbar with preview behind one button", async () => {
    render(<Harness />);
    expect(
      screen.getByRole("heading", { name: "Quotation builder" }),
    ).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Photo" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Item" })).toBeVisible();
    expect(
      screen.queryByRole("article", { name: "Living room room" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Preview quotation" }),
    );
    expect(
      screen.getByRole("article", { name: "Quotation document" }),
    ).toBeVisible();
  });
  it("collapses each area without losing its items", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(
      screen.getByRole("button", { name: "Collapse Living room" }),
    );
    expect(screen.queryByLabelText("Item name item1")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Expand Living room" }),
    );
    expect(screen.getByLabelText("Item name item1")).toHaveValue("Wardrobe");
  });
  it("links an open change request directly from the builder", async () => {
    const user = userEvent.setup();
    render(<Harness withRequest />);
    await user.click(
      screen.getByRole("button", { name: "Link change requests" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: /CR-007 · Add reception display/ }),
    );
    expect(onChange.mock.lastCall?.[0].requestIds).toEqual(["cr1"]);
  });
  it("updates names while typing, groups undo per edit, and supports Escape and redo", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const name = screen.getByLabelText("Item name item1");
    await user.clear(name);
    await user.type(name, "Cabinet");
    expect(onChange.mock.lastCall?.[0].lines[0].title).toBe("Cabinet");
    await user.tab();
    expect(onChange.mock.lastCall?.[0].lines[0].title).toBe("Cabinet");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(name).toHaveValue("Wardrobe");
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(name).toHaveValue("Cabinet");
    await user.clear(name);
    await user.type(name, "Cancelled");
    await user.keyboard("{Escape}");
    await user.tab();
    expect(name).toHaveValue("Cabinet");
  });
  it("stages material edits and only changes prices when applied", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(
      screen.getByRole("button", { name: "Materials for Wardrobe" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Materials" });
    await user.click(
      within(dialog).getByRole("button", { name: "Add material to Wardrobe" }),
    );
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Rate for material New material"), {
      target: { value: "25" },
    });
    await user.click(
      screen.getByRole("button", { name: /Pricing method for Wardrobe/ }),
    );
    await user.click(
      screen.getByRole("option", { name: "Calculate from materials" }),
    );
    await user.click(
      within(
        screen.getByLabelText("Rate for material New material").closest("tr")!,
      ).getByRole("checkbox"),
    );
    await user.click(screen.getByRole("button", { name: "Apply materials" }));
    expect(onChange.mock.lastCall?.[0].lines[0]).toMatchObject({
      rate: 0,
      unitCost: 60,
      pricingMode: "materials",
    });
    await user.click(
      screen.getByRole("button", { name: "Materials for Wardrobe" }),
    );
    await user.click(
      within(
        screen.getByLabelText("Rate for material New material").closest("tr")!,
      ).getByRole("checkbox"),
    );
    await user.click(screen.getByRole("button", { name: "Apply materials" }));
    expect(onChange.mock.lastCall?.[0].lines[0].rate).toBe(25);
    const rate = screen.getByLabelText("Rate for Wardrobe");
    await user.clear(rate);
    await user.type(rate, "250");
    await user.keyboard("{Escape}");
    await user.tab();
    expect(onChange.mock.lastCall?.[0].lines[0]).toMatchObject({
      rate: 25,
      pricingMode: "materials",
    });
    fireEvent.change(rate, { target: { value: "150" } });
    expect(onChange.mock.lastCall?.[0].lines[0]).toMatchObject({
      rate: 150,
      pricingMode: "item",
    });
  }, 15000);
  it("adds editable sections and prevents duplicate names", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(
      screen.getByRole("button", { name: "Add room / section" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Area / room name"),
      "living room",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save section" }),
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent("unique");
    expect(onChange).not.toHaveBeenCalled();
    await user.clear(within(dialog).getByLabelText("Area / room name"));
    await user.type(
      within(dialog).getByLabelText("Area / room name"),
      "Delivery",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save section" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Add item to Delivery" }),
    );
    const authorizationDialog = await screen.findByRole("dialog", {
      name: "Authorize manual item",
    });
    await user.type(
      within(authorizationDialog).getByRole("textbox", {
        name: /Authorization reason/,
      }),
      "Client-requested delivery allowance",
    );
    await user.click(
      within(authorizationDialog).getByRole("button", {
        name: "Add manual item",
      }),
    );
    expect(onChange.mock.lastCall?.[0].lines[1].room).toBe("Delivery");
    expect(onChange.mock.lastCall?.[0].lines[1].manualReason).toBe("Client-requested delivery allowance");
  });

  it("prices an option separately from the base total", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: "Price Wardrobe as option" }));
    expect(onChange.mock.lastCall?.[0].lines[0].optional).toBe(true);
    expect(screen.getByText("Priced options · not included")).toBeVisible();
    expect(screen.getAllByText("AED 0.00").length).toBeGreaterThan(0);
  });
  it("protects read-only versions and still shows all prices and materials", () => {
    render(<Harness readOnly />);
    expect(
      screen.queryByRole("button", { name: "Add room / section" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Upload photo for Wardrobe"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Item name item1")).toHaveAttribute(
      "readonly",
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
  it("edits the variant and displays it in the clean preview", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(
      screen.getByRole("button", { name: "Choose variant for Wardrobe" }),
    );
    await user.type(screen.getByLabelText("Custom variant"), "Premium");
    await user.click(screen.getByRole("button", { name: "Apply variant" }));
    await user.click(screen.getByRole("button", { name: "Preview quotation" }));
    expect(
      within(
        screen.getByRole("article", { name: "Quotation document" }),
      ).getByText("Premium"),
    ).toBeVisible();
  });
  it("adds finished-item size once and shows it in the client quotation", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Materials for Wardrobe" }));
    const dialog = screen.getByRole("dialog", { name: "Materials" });
    await user.type(within(dialog).getByRole("textbox", { name: "Length" }), "220");
    await user.click(within(dialog).getByRole("button", { name: "Apply materials" }));
    expect(onChange.mock.lastCall?.[0].lines[0].dimensions).toEqual({ length: 220, unit: "cm" });
    await user.click(screen.getByRole("button", { name: "Preview quotation" }));
    expect(within(screen.getByRole("article", { name: "Quotation document" })).getByText("L 220 cm")).toBeVisible();
  });
  it("keeps the header editable and the AI assistant available without changing existing scope", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(
      screen.getByRole("button", { name: "AI assistant" }),
    ).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "AI assistant" }));
    expect(
      screen.getByRole("complementary", { name: "AI quotation assistant" }),
    ).toBeVisible();
    await user.clear(screen.getByLabelText("Quotation title"));
    await user.type(
      screen.getByLabelText("Quotation title"),
      "Office proposal",
    );
    expect(onChange.mock.lastCall?.[0].title).toBe("Office proposal");
    expect(onChange.mock.lastCall?.[0].lines[0].rate).toBe(100);
    await user.type(screen.getByLabelText("Quotation location"), "Dubai");
    expect(onChange.mock.lastCall?.[0].cover.location).toBe("Dubai");
  });
  it("opens a Materials column modal, cancels safely and updates the separate description on Apply", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(
      screen.getByRole("columnheader", { name: "Materials" }),
    ).toBeVisible();
    expect(
      within(
        screen.getByLabelText("Item name item1").closest("td")!,
      ).queryByRole("button"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Item name item1").tagName).toBe("INPUT");
    await user.click(
      screen.getByRole("button", { name: "Materials for Wardrobe" }),
    );
    expect(screen.getByRole("dialog", { name: "Materials" })).toBeVisible();
    await user.clear(screen.getByLabelText("Material name item1-1"));
    await user.type(
      screen.getByLabelText("Material name item1-1"),
      "Cancelled",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Description for Wardrobe")).toHaveTextContent(
      "Oak · Matte · Soft close",
    );
    await user.click(
      screen.getByRole("button", { name: "Materials for Wardrobe" }),
    );
    await user.clear(screen.getByLabelText("Material name item1-1"));
    await user.type(screen.getByLabelText("Material name item1-1"), "Walnut");
    await user.type(screen.getByLabelText("Specification for Walnut"), "18 mm");
    await user.click(
      screen.getByRole("button", { name: "Remove material Matte" }),
    );
    await user.click(screen.getByRole("button", { name: "Apply materials" }));
    expect(screen.getByLabelText("Description for Wardrobe")).toHaveTextContent(
      "Walnut · 18 mm · Soft close",
    );
    expect(onChange.mock.lastCall?.[0].lines[0].rate).toBe(100);
    await user.click(screen.getByRole("button", { name: "Preview quotation" }));
    expect(
      within(
        screen.getByRole("article", { name: "Quotation document" }),
      ).getByText("Walnut · 18 mm · Soft close"),
    ).toBeVisible();
  }, 15_000);
  it("uses the design-system unit menu and supports custom units", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Unit for Wardrobe/ }));
    await user.click(screen.getByRole("option", { name: "m²" }));
    expect(onChange.mock.lastCall?.[0].lines[0].unit).toBe("m²");
    await user.click(screen.getByRole("button", { name: /Unit for Wardrobe/ }));
    await user.click(screen.getByRole("option", { name: "Custom unit…" }));
    await user.clear(screen.getByLabelText("Unit name"));
    await user.type(screen.getByLabelText("Unit name"), "panel");
    await user.click(screen.getByRole("button", { name: "Apply unit" }));
    expect(onChange.mock.lastCall?.[0].lines[0].unit).toBe("panel");
  });
});
