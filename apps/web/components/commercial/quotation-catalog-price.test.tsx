import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuoteLine } from "@/lib/commercial/types";
import { QuotationCatalogPrice } from "./quotation-catalog-price";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/commercial/client", async () => ({ ...await vi.importActual("@/lib/commercial/client"), jsonRequest: request }));
const line: QuoteLine = {
  id: "line", room: "Living", title: "Joinery", specification: "", material: "", finish: "",
  quantity: 2, unit: "nos", unitCost: 0, rate: 0, pricingMode: "item",
  catalogLinks: [{ role: "work", recordId: "work", version: 4, snapshot: {
    id: "work", name: "Joinery", code: "J", kind: "work", version: 4, catalogId: "catalog", commerce: { pricingMode: "fixed" },
  } }],
};
afterEach(() => request.mockReset());

describe("quotation catalogue price", () => {
  it("checks the backend price and stages an authoritative resolve for save", async () => {
    const snapshot = { status: "resolved", source: "catalog", mode: "fixed", catalogId: "catalog", work: { id: "work", version: 4 }, unitLabel: "nos", quantity: 2, currency: "AED", pricingDate: "2026-09-17", taxRate: 5, resolvedAt: "2026-09-17T00:00:00Z", rateCard: { appliedUnitRate: 350 } };
    request.mockResolvedValue({ status: "resolved", code: "resolved", message: "Selling rate resolved", snapshot });
    const apply = vi.fn().mockReturnValue(true);
    render(<QuotationCatalogPrice line={line} currency="AED" taxRate={5} workspaceId="workspace" caseId="case" readOnly={false} canOverride={false} onApply={apply} />);
    expect(screen.queryByRole("button", { name: "Override" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check price" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(line, "AED", 5, { catalogPrice: snapshot, catalogPriceRequest: { action: "resolve" }, rate: 350 }));
    expect(request).toHaveBeenCalledWith(expect.stringContaining("/cases/case/catalog-price?workspaceId=workspace"), "POST", { catalogId: "catalog", workId: "work", workVersion: 4, unitLabel: "nos", quantity: 2, currency: "AED", taxRate: 5 });
  });

  it("requires permission and a reason for a manual override", async () => {
    const apply = vi.fn().mockReturnValue(true);
    render(<QuotationCatalogPrice line={line} currency="AED" taxRate={5} workspaceId="workspace" caseId="case" readOnly={false} canOverride onApply={apply} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Override" }));
    await user.type(screen.getByLabelText("Override rate for Joinery"), "425");
    await user.type(screen.getByLabelText("Override reason for Joinery"), "Client-approved custom finish");
    await user.click(screen.getByRole("button", { name: "Use override" }));
    expect(apply).toHaveBeenCalledWith(line, "AED", 5, { rate: 425, pricingMode: "item", catalogPriceRequest: { action: "override", reason: "Client-approved custom finish" } });
    expect(request).not.toHaveBeenCalled();
  });

  it("shows the persisted rate version and effective date on demand", async () => {
    const priced = { ...line, rate: 350, catalogPrice: {
      status: "resolved" as const, source: "catalog" as const, mode: "fixed" as const, catalogId: "catalog", work: { id: "work", version: 4 },
      unitLabel: "nos", quantity: 2, currency: "AED", pricingDate: "2026-09-17", taxRate: 5, resolvedAt: "2026-09-17T00:00:00Z",
      rateCard: { id: "rate", version: 3, amount: 350, baseUnitRate: 350, appliedUnitRate: 350, effectiveFrom: "2026-01-01", taxIncluded: false, costIncludes: "labour", reference: "Joinery 2026" },
    } };
    render(<QuotationCatalogPrice line={priced} currency="AED" taxRate={5} workspaceId="workspace" caseId="case" readOnly canOverride={false} onApply={vi.fn()} />);
    await userEvent.click(screen.getByText("Price details"));
    expect(screen.getByText("Joinery 2026 · v3")).toBeInTheDocument();
    expect(screen.getByText(/Effective 1 Jan 2026/)).toBeInTheDocument();
  });
});
