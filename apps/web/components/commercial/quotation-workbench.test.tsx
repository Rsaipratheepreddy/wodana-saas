import { useState } from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
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
}: {
  readOnly?: boolean;
  withRequest?: boolean;
}) {
  const [quote, setQuote] = useState(initial());
  return (
    <QuotationStudio
      quote={quote}
      onChange={(q) => {
        onChange(q);
        setQuote(q);
      }}
      state={
        { data: { revision: 1, quotes: [] } } as unknown as CommercialState
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
    expect(onChange.mock.lastCall?.[0].lines[1].room).toBe("Delivery");
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
  });
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
