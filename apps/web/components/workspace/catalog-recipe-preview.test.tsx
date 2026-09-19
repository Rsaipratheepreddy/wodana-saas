import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blankCatalogRecord, type CatalogPageData, type CatalogRecord } from "@/lib/workspace/catalog";
import { CatalogRecipePreview } from "./catalog-recipe-preview";

afterEach(() => vi.unstubAllGlobals());

const record = (kind: CatalogRecord["kind"], id: string, code: string, name: string, configuration: CatalogRecord["configuration"] = {}): CatalogRecord => ({
  ...blankCatalogRecord(kind),
  id,
  code,
  name,
  version: 1,
  catalogId: "catalog",
  configuration,
});

describe("catalogue recipe preview", () => {
  it("calls the exposed preview API and renders the resolved measurement", async () => {
    const template = record("construction", "template", "ICT-WARD", "Wardrobe recipe", { recordRole: "template", sellingBasis: "width_height" });
    const execution = record("execution", "execution", "EXEC-FACTORY", "Factory", { fabrication: "factory" });
    const data: CatalogPageData = {
      workspaceId: "10000000-0000-4000-a000-000000000001",
      canManage: false,
      starter: { count: 0, version: "1", market: "AE" },
      items: [template, execution],
    };
    const fetchMock = vi.fn(async (_input: string | URL | Request) => ({
      ok: true,
      json: async () => ({
        status: "needs_configuration",
        measurement: { quantity: 72, unit: "Square foot" },
        lines: [], changes: [], warnings: [], issues: ["Add components"],
        directCost: null, costBasis: null, priceBeforeTax: null, taxAmount: null, priceAfterTax: null,
        estimateNote: "Survey-backed estimate.",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CatalogRecipePreview data={data} initialTemplateId={template.id} onEdit={vi.fn()} />);
    expect(await screen.findByText("72")).toBeVisible();
    expect(screen.getByText("Square foot")).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/workspace/catalog/preview?workspaceId=${data.workspaceId}`);
  });
});
