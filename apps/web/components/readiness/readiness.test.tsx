import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { ProjectReadiness } from "../project-core/project-readiness";
import { CatalogReadinessView, ReadinessSettingsDialog } from "../catalog/catalog-readiness";
import { CatalogPage } from "../catalog/catalog-page";
import type { ProjectReadiness as Readiness } from "@/lib/readiness/types";

afterEach(() => vi.unstubAllGlobals());

const answer = (body: unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => { void url; void init; return { ok: true, status: 200, json: async () => body }; });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};

const project: Readiness = {
  caseId: "case", columns: ["picture", "drawing", "materials", "production", "delivery"],
  rows: [
    { id: "l1", title: "Sofa", quantity: "1", unit: "pcs", areaName: "Living", catalogItemId: "11111111-1111-4111-8111-111111111111", catalogId: "22222222-2222-4222-8222-222222222222",
      code: "SOFA-1", catalogImageId: null, imageAssetId: null, missing: 1,
      cells: { picture: { state: "missing" }, size: { state: "done" }, drawing: { state: "done", note: "catalogue_drawing" }, materials: { state: "done", note: "from_sheet", detail: "Wood, fabric" },
        labour: { state: "not_needed" }, selection: { state: "not_needed" }, purchase: { state: "not_needed" }, production: { state: "not_needed" }, delivery: { state: "waiting", note: "not_installed" } } },
    { id: "l2", title: "Wardrobe", quantity: "2", unit: "pcs", areaName: "Bedroom", catalogItemId: null, catalogId: null, code: null, catalogImageId: null, imageAssetId: null, missing: 3,
      cells: { picture: { state: "missing" }, size: { state: "done" }, drawing: { state: "missing" }, materials: { state: "missing" }, labour: { state: "missing" },
        selection: { state: "not_needed" }, purchase: { state: "not_needed" }, production: { state: "waiting", note: "in_production" }, delivery: { state: "waiting", note: "not_installed" } } },
    { id: "l3", title: "Cleaning", quantity: "1", unit: "lot", areaName: null, catalogItemId: null, catalogId: null, code: null, catalogImageId: null, imageAssetId: null, missing: 0,
      cells: { picture: { state: "not_needed" }, size: { state: "not_needed" }, drawing: { state: "not_needed" }, materials: { state: "not_needed" }, labour: { state: "not_needed" },
        selection: { state: "not_needed" }, purchase: { state: "not_needed" }, production: { state: "not_needed" }, delivery: { state: "not_needed" } } },
  ],
};

describe("a project's item readiness", () => {
  it("shows each column's state with its missing count, and opens the place to fill a missing cell", async () => {
    answer(project);
    const onView = vi.fn();
    render(<DesignSystemProvider><ProjectReadiness workspaceId="w" projectId="p" version={1} onView={onView} /></DesignSystemProvider>);
    expect(await screen.findByRole("columnheader", { name: /Picture \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Technical drawing \(1\)/ })).toBeInTheDocument();
    expect(screen.getByText("From sheet").parentElement).toHaveAttribute("title", "Wood, fabric");
    expect(screen.getByText("Catalogue drawing")).toBeInTheDocument();
    expect(screen.getByText("In production")).toBeInTheDocument();
    // The sofa's missing picture opens its catalogue item at the Photos tab; the wardrobe has no catalogue item to open.
    const sofa = screen.getByRole("row", { name: /Sofa/ });
    expect(within(sofa).getByRole("link", { name: "Fill Picture" })).toHaveAttribute("href",
      "/workspace/catalogs?catalog=22222222-2222-4222-8222-222222222222&item=11111111-1111-4111-8111-111111111111&tab=photos");
    const wardrobe = screen.getByRole("row", { name: /Wardrobe/ });
    expect(within(wardrobe).queryByRole("link", { name: "Fill Picture" })).toBeNull();
    fireEvent.click(within(wardrobe).getByRole("button", { name: "Fill Technical drawing" }));
    expect(onView).toHaveBeenCalledWith("drawings");
    fireEvent.click(within(wardrobe).getByRole("button", { name: "Fill Materials" }));
    expect(onView).toHaveBeenLastCalledWith("materials");
    expect(within(wardrobe).getByRole("link", { name: "Open Production" })).toHaveAttribute("href", "/workspace/factory?project=p");
  });

  it("shows only the items missing something when asked", async () => {
    answer(project);
    render(<DesignSystemProvider><ProjectReadiness workspaceId="w" projectId="p" version={1} onView={vi.fn()} /></DesignSystemProvider>);
    expect(await screen.findByText("Cleaning")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("button", { name: /Filter by missing/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Missing anything (2)" }));
    await waitFor(() => expect(screen.queryByText("Cleaning")).toBeNull());
    expect(screen.getByText("Sofa")).toBeInTheDocument();
    expect(screen.getByText("Wardrobe")).toBeInTheDocument();
  });

  it("says when the project has no items", async () => {
    answer({ caseId: "c", columns: ["picture"], rows: [] });
    render(<DesignSystemProvider><ProjectReadiness workspaceId="w" projectId="p" version={1} onView={vi.fn()} /></DesignSystemProvider>);
    expect(await screen.findByText("No items")).toBeInTheDocument();
  });
});

describe("the catalogue's readiness", () => {
  const catalog = {
    columns: ["picture", "size", "price", "drawing", "materials", "labour"], canManage: true,
    settings: { columns: ["picture", "size", "price", "drawing", "materials", "labour"], materialAttributes: ["materials_needed"], labourAttributes: [], version: 0, saved: false },
    rows: [{ id: "i1", catalogId: "k1", code: "WR-1", name: "Wardrobe", itemType: "assembly", unitCode: "pcs", categoryName: null, image: null, missing: 2,
      cells: { picture: { state: "done" }, size: { state: "missing" }, price: { state: "waiting", note: "in_review" }, drawing: { state: "done" }, materials: { state: "done", note: "components" }, labour: { state: "missing" } } }],
  };

  it("opens the item's panel at the tab where a missing fact is filled", async () => {
    const fetcher = answer(catalog);
    const onOpen = vi.fn();
    render(<DesignSystemProvider><CatalogReadinessView catalogId="k1" categoryId={null} onOpen={onOpen} onSearchChange={vi.fn()} onViewChange={vi.fn()} reloadKey={0} search=""
      structure={null} typeLabel={(type) => type} views={[{ id: "items", label: "Items" }, { id: "readiness", label: "Readiness" }]} workspaceId="w" /></DesignSystemProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Fill Trades & hours" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "i1", name: "Wardrobe" }), "components");
    fireEvent.click(screen.getByRole("button", { name: "Open Price" }));
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: "i1" }), "prices");
    expect(String(fetcher.mock.calls[0][0])).toContain("/api/workspace/catalogs/k1/readiness?");
  });

  it("saves the firm's settings with a request id and the version it read", async () => {
    const fetcher = answer({});
    const onSaved = vi.fn();
    render(<DesignSystemProvider><ReadinessSettingsDialog workspaceId="w" settings={catalog.settings as never} onClose={vi.fn()} onSaved={onSaved} structure={{ categories: [], units: [],
      attributes: [{ id: "a1", code: "materials_needed", label: "Materials Needed", valueType: "text", required: false, choices: [], unitCode: null, categoryId: null },
        { id: "a2", code: "hours_needed", label: "Hours Needed", valueType: "text", required: false, choices: [], unitCode: null, categoryId: null }] }} /></DesignSystemProvider>);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Picture" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Trades & hours from" })).getByRole("checkbox", { name: "Hours Needed" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain("/api/workspace/catalogs/readiness/settings?");
    expect(JSON.parse(String(init!.body))).toMatchObject({ version: 0, columns: ["size", "price", "drawing", "materials", "labour"], materialAttributes: ["materials_needed"], labourAttributes: ["hours_needed"] });
    expect(JSON.parse(String(init!.body)).requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("the catalogue page opened from a project's readiness", () => {
  it("opens the linked item's panel at the linked tab and tidies the address", async () => {
    const item = { id: "33333333-3333-4333-8333-333333333333", code: "SOFA-1", name: "Sofa", itemType: "product", unitCode: "pcs", categoryId: null, version: 1, description: null,
      wastePercent: null, purchaseRoundTo: null, values: {}, components: [], prices: [], suppliers: [], canViewCosts: false };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => String(url).includes("/structure") ? { categories: [], attributes: [], units: [] }
      : String(url).includes(`/items/${item.id}`) ? item : String(url).includes("/items") ? { items: [] } : { size: null, defaultUnit: "cm", source: null } })));
    window.history.replaceState(null, "", `/workspace/catalogs?catalog=k1&item=${item.id}&tab=prices`);
    render(<DesignSystemProvider><CatalogPage workspaceId="w" canManage currency="USD" initialCatalogs={[{ id: "k1", code: "core", name: "Core", purpose: "sell", itemCount: 1, version: 1 }]} /></DesignSystemProvider>);
    const panel = await screen.findByRole("dialog", { name: "Catalog item" });
    expect(await within(panel).findByRole("tab", { name: "Prices", selected: true })).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});
