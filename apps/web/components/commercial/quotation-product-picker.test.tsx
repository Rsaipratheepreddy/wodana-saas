import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { QuotationProductPicker, QuotationVariantChoices } from "./quotation-product-picker";

const { options } = vi.hoisted(() => ({ options: vi.fn() }));
vi.mock("./catalog-options-cache", () => ({ useCatalogOptions: options }));

const work = { id: "work", name: "Wardrobe", code: "WRD", kind: "work", version: 2, catalogId: "catalog", catalogName: "Joinery", description: "Built-in storage", commerce: { pricingMode: "fixed" as const } };
const variants = [
  { id: "v1", name: "Oak", code: "OAK", kind: "variant", version: 1, catalogId: "catalog", configuration: { qualityGrade: "Premium" }, commerce: { pricingMode: "fixed" as const } },
  { id: "v2", name: "Walnut", code: "WAL", kind: "variant", version: 1, catalogId: "catalog", configuration: { qualityGrade: "Standard" }, commerce: { pricingMode: "on_request" as const } },
];

describe("quotation catalogue selection", () => {
  it("uses the shared bordered DataGrid for searchable item selection", async () => {
    options.mockImplementation((_w: string, _c: string, kind: string) => ({ items: kind === "work" ? [work] : variants, loading: false, error: "", refresh: vi.fn() }));
    const add = vi.fn();
    render(<DesignSystemProvider><QuotationProductPicker workspaceId="workspace" caseId="case" room={null} lines={[]} atLimit={false} onAdd={add} onCustom={vi.fn()} onEdit={vi.fn()} onQuantity={vi.fn()} /></DesignSystemProvider>);
    expect(screen.getByRole("table", { name: "Catalog items" })).toBeInTheDocument();
    expect(screen.getByText("Built-in storage", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Fixed price")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add Wardrobe" }));
    expect(add).toHaveBeenCalledWith(work, variants[0]);
  });

  it("compares active variants and selects one from the comparison grid", async () => {
    options.mockReturnValue({ items: variants, loading: false, error: "", refresh: vi.fn() });
    const change = vi.fn();
    render(<DesignSystemProvider><QuotationVariantChoices workspaceId="workspace" caseId="case" work={work} value={null} onChange={change} /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Compare variants" }));
    expect(screen.getByRole("table", { name: "Compare variants for Wardrobe" })).toBeInTheDocument();
    expect(screen.getByText("Premium")).toBeInTheDocument();
    expect(screen.getByText("Quote required")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Select Walnut" }));
    expect(change).toHaveBeenCalledWith(variants[1]);
  });
});
