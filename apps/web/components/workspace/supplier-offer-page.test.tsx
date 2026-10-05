import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { SupplierOfferPage } from "./supplier-offer-page";

const offer = {
  id: "offer", vendorName: "Oak Supply", vendorSiteName: "Dubai", legalEntityName: "Palm Living LLC", legalEntityBaseCurrency: "AED",
  catalogRecordName: "Oak veneer", catalogRecordCode: "OAK-01", unitName: "Square metre", unitCode: "m²", supplierSku: "OS-10",
  amount: 125, currency: "AED", quantityFrom: 10, minimumOrderQuantity: 10, leadTimeDays: 7, effectiveFrom: "2026-01-01", effectiveTo: null,
  sourceType: "vendor_quote", sourceReference: "Q-104", taxTreatment: "exclusive", currencyBoundary: "base", status: "active", version: 2,
};

describe("supplier-offer comparison", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows comparable price, source, entity, lead time and validity in the shared grid", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [offer] }) });
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><SupplierOfferPage workspaceId="d004d45c-7140-4b0c-a68d-e87d012c2390" /></DesignSystemProvider>);
    expect(await screen.findByRole("table", { name: "Supplier offers" })).toBeInTheDocument();
    expect(screen.getByText("AED 125")).toBeInTheDocument();
    expect(screen.getByText("vendor quote · Q-104")).toBeInTheDocument();
    expect(screen.getByText(/7d lead/)).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("status=active"), expect.any(Object));
  });

  it("sends status and debounced search to the permissioned gateway", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><SupplierOfferPage workspaceId="d004d45c-7140-4b0c-a68d-e87d012c2390" /></DesignSystemProvider>);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    await userEvent.type(screen.getByRole("searchbox", { name: "Search item, supplier, SKU or source" }), "walnut");
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining("search=walnut"), expect.any(Object)));
  });
  it("has one title with the offer status as tabs, no eyebrow or description", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><SupplierOfferPage workspaceId="d004d45c-7140-4b0c-a68d-e87d012c2390" /></DesignSystemProvider>);
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Supplier offers"]);
    await userEvent.click(screen.getByRole("button", { name: "Drafts" }));
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining("status=draft"), expect.any(Object)));
    expect(screen.getByRole("button", { name: "Drafts" })).toHaveAttribute("aria-pressed", "true");
  });
});
