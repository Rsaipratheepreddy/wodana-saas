import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { livePrice, type FoundItem } from "../catalog-core/catalog-v2.service";
import type { Supplier } from "../purchasing/suppliers";
import { searchTerms } from "../search/search-terms";
import { ToolInputError } from "./ai-tool";
import { toolContext } from "./ai-tool-context";
import { AiToolRegistry } from "./ai-tools.registry";
import { validateToolInput } from "./tool-kit";
import type { ToolServices } from "./tool-services";

const WS = "11111111-1111-4111-8111-111111111111";
const SOFA = "22222222-2222-4222-8222-222222222222";
const TABLE = "22222222-2222-4222-8222-333333333333";
const STOCK = "33333333-3333-4333-8333-333333333333";
const MARBLE = "44444444-4444-4444-8444-444444444444";
const actor = { subject: "sub", email: "sam@example.com", displayName: "Sam", provider: "local" };

const item = (patch: Partial<FoundItem>): FoundItem => ({
  id: SOFA, catalogId: "c-1", catalogName: "Core collection", code: "HAR-3", name: "Harriet sofa 3 seater", itemType: "product", unitCode: "pcs", categoryName: "Sofas",
  description: "Sofa", technicalDrawingUrl: "https://drive.example.com/harriet.pdf", productionDays: 21, size: { width: "220.00", depth: "95.00", height: null, unit: "cm" },
  attributes: [{ label: "Fabric", value: "Boucle" }, { label: "Website link", value: "https://shop.example.com/harriet" }, { label: "Supplier phone", value: "+1 555 0100 200" }],
  price: { status: "active", method: "fixed", amount: "4200.00", currency: "USD", per: "pcs" }, cost: { amount: "2100.00", currency: "USD", supplier: null }, ...patch,
});

const supplier = (patch: Partial<Supplier> = {}): Supplier & { companies: string[] } => ({
  id: MARBLE, code: "STONE-CO", name: "Stone Co", legalName: null, categories: ["Marble", "Granite"], approval: "approved", preferredFor: ["Marble"], approvalNote: "", approvalAt: null,
  approvalByName: null, paymentTerms: "credit", advancePercent: null, creditDays: 30, termsNote: "", retentionPercent: "0", deal: "none", dealPercent: null, dealNote: "",
  contactName: "Rami", phone: "+15550100999", email: "sales@stone.example", locality: "Industrial area", entityIds: ["e-1"], taxRegistrationNumber: null, currency: null,
  notes: "Slabs and cutting", status: "active", archivedReason: null, version: 1,
  attributes: [{ name: "Approval status", value: "Nominated for marble" }, { name: "Alt contact", value: "call +1 555 0100 777" }, { name: "Bank IBAN", value: "XX00 1234" }],
  companies: ["Studio LLC"], ...patch,
});

function setup(granted: string[], options: { canViewCosts?: boolean } = {}) {
  const services = {
    catalog: { findItems: vi.fn(async () => ({ canViewCosts: options.canViewCosts ?? true, items: [item({}), item({ id: TABLE, name: "Lyla dining table", code: "LYL", price: { status: "draft" }, cost: null })] })) },
    inventory: { lookup: vi.fn(async () => ({ items: [{ id: STOCK, code: "MRB-01", name: "Carrara marble slab", unit: "sqm", catalogItemId: null, onHand: "40", held: "12", free: "28", forProjects: "0",
      places: [{ place: "Main warehouse", onHand: "40", held: "12", free: "28", forProjects: "0" }], reorderPoints: [{ place: null, reorderAt: "30", onOrder: "0", low: true, short: true }], low: true }] })) },
    suppliers: { find: vi.fn(async () => ({ suppliers: [supplier()] })) },
  };
  const registry = AiToolRegistry.catalogue(services as unknown as ToolServices);
  const { context, sources } = toolContext({ actor, workspaceId: WS, runId: "run-1", asker: { userId: "u-1", membershipId: "m-1", permissions: new Set(granted), timeZone: "UTC", locale: "en" } });
  const run = (name: string, args: Record<string, unknown>) => {
    const tool = registry.get(name)!;
    return tool.run!(context, validateToolInput(tool.parameters, args)) as Promise<{ data: Record<string, unknown> }>;
  };
  return { services, registry, run, sources };
}

describe("Woddy's product, stock and supplier tools", () => {
  it("are offered only to people whose own permissions open the module, and check the cost permission", () => {
    const { registry } = setup([]);
    const names = (granted: string[]) => registry.offered(new Set(granted)).map((tool) => tool.name).filter((name) => ["search_catalog", "check_stock", "search_suppliers"].includes(name));
    expect(names([])).toEqual([]);
    expect(names(["catalog.view"])).toEqual(["search_catalog"]);
    expect(names(["stock.view"])).toEqual(["check_stock"]);
    expect(names(["purchasing.view"])).toEqual(["check_stock"]);
    expect(names(["vendors.view"])).toEqual(["search_suppliers"]);
    expect(names(["catalog.view", "stock.receive", "vendors.view"])).toEqual(["search_catalog", "check_stock", "search_suppliers"]);
    expect(registry.permissionCodes).toEqual(expect.arrayContaining(["catalog.view", "vendors.view", "stock.view", "commercial.costs.view", "supplier_offers.view"]));
    for (const name of ["search_catalog", "check_stock", "search_suppliers"]) expect(registry.get(name)).toMatchObject({ kind: "read", confirmation: "none" });
  });

  it("check their input: a search text is required, kept short, and the number of results is capped", async () => {
    const { registry, run, services } = setup(["catalog.view"]);
    const schema = registry.get("search_catalog")!.parameters;
    expect(() => validateToolInput(schema, {})).toThrow(/text is required/);
    expect(() => validateToolInput(schema, { text: "x".repeat(121) })).toThrow(/longer than 120/);
    expect(() => validateToolInput(schema, { text: "sofa", limit: 2.5 })).toThrow(/integer/);
    await expect(run("search_catalog", { text: "a" })).rejects.toThrow(ToolInputError);
    await run("search_catalog", { text: " Harriet sofa ", limit: 50 });
    expect(services.catalog.findItems).toHaveBeenCalledWith(actor, WS, { search: "Harriet sofa", limit: 10 });
  });

  it("give a product's live selling price, size, drawing, website and attributes, and say when the price is on request", async () => {
    const { run, sources } = setup(["catalog.view"]);
    const { data } = await run("search_catalog", { text: "Harriet sofa" });
    const [sofa, table] = data.items as Array<Record<string, unknown>>;
    expect(sofa).toMatchObject({
      source: "S1", name: "Harriet sofa 3 seater", code: "HAR-3", category: "Sofas", kind: "product", sellingPrice: { amount: "4200.00", currency: "USD", per: "pcs" },
      size: "W 220 × D 95 cm", technicalDrawing: "https://drive.example.com/harriet.pdf", websiteLink: "https://shop.example.com/harriet", attributes: [{ Fabric: "Boucle" }],
    });
    // A draft price is never stated: the item is price on request.
    expect(table).toMatchObject({ sellingPrice: null, priceNote: expect.stringMatching(/^Price on request: .*draft/) });
    // Contact details in a product's extra columns stay out.
    expect(JSON.stringify(data)).not.toContain("0100 200");
    expect(sources[0]).toEqual({ key: "S1", type: "catalog_item", id: SOFA, label: "Harriet sofa 3 seater", href: "/workspace/catalogs" });
  });

  it("never show what an item costs the firm without the cost permission, even when a cost came back", async () => {
    const hidden = await setup(["catalog.view"]).run("search_catalog", { text: "Harriet" });
    expect(JSON.stringify(hidden.data)).not.toContain("2100");
    expect((hidden.data.items as Array<Record<string, unknown>>)[0]).not.toHaveProperty("cost");
    // The catalogue's own check refused costs: still hidden.
    const refused = await setup(["catalog.view", "commercial.costs.view"], { canViewCosts: false }).run("search_catalog", { text: "Harriet" });
    expect(JSON.stringify(refused.data)).not.toContain("2100");
    const shown = await setup(["catalog.view", "commercial.costs.view"]).run("search_catalog", { text: "Harriet" });
    expect((shown.data.items as Array<Record<string, unknown>>)[0]).toMatchObject({ cost: { amount: "2100.00", currency: "USD" } });
  });

  it("say plainly when the module refuses the person", async () => {
    const { run, services } = setup(["catalog.view", "stock.view", "vendors.view"]);
    services.catalog.findItems.mockRejectedValueOnce(new ForbiddenException("Permissions required: catalog.view"));
    await expect(run("search_catalog", { text: "sofa" })).rejects.toThrow("No access: this person can't view the catalogue.");
    services.inventory.lookup.mockRejectedValueOnce(new ForbiddenException("Any permission required"));
    await expect(run("check_stock", { text: "marble" })).rejects.toThrow("No access: this person can't view stock.");
    services.suppliers.find.mockRejectedValueOnce(new ForbiddenException("Permissions required: vendors.view"));
    await expect(run("search_suppliers", { text: "marble" })).rejects.toThrow("No access: this person can't view suppliers.");
  });

  it("give stock on hand, held, free and where, with the low-stock flag", async () => {
    const { run, sources } = setup(["stock.view"]);
    const { data } = await run("check_stock", { text: "marble" });
    expect(data.items).toEqual([{
      source: "S1", name: "Carrara marble slab", code: "MRB-01", unit: "sqm", onHand: "40", held: "12", free: "28",
      places: [{ place: "Main warehouse", onHand: "40", held: "12", free: "28", forProjects: "0" }], lowStock: true, reorderPoints: [{ place: null, reorderAt: "30", onOrder: "0", low: true, short: true }],
    }]);
    expect(sources[0]).toMatchObject({ type: "stock_item", href: `/workspace/inventory?item=${STOCK}` });
  });

  it("give a supplier's terms, approval and companies, but only whether a phone or email is on file", async () => {
    const { run, sources } = setup(["vendors.view"]);
    const { data } = await run("search_suppliers", { text: "marble" });
    expect((data.suppliers as unknown[])[0]).toMatchObject({
      name: "Stone Co", supplies: ["Marble", "Granite"], approval: "Approved", preferredFor: ["Marble"], paymentTerms: "On credit, 30 days", contactPerson: "Rami",
      hasPhone: true, hasEmail: true, companies: ["Studio LLC"], attributes: [{ "Approval status": "Nominated for marble" }],
    });
    const text = JSON.stringify(data);
    for (const secret of ["+15550100999", "sales@stone.example", "0100 777", "XX00"]) expect(text).not.toContain(secret);
    expect(sources[0]).toMatchObject({ type: "supplier", href: `/workspace/purchasing/suppliers?supplier=${MARBLE}` });
  });
});

describe("a live price as the customer sees it", () => {
  it("works out cost-plus, keeps tiers and leaves assemblies to the quotation", () => {
    const entry = { id: "p", price: null, rate: null, minimumCharge: null, cost: null, markupPercent: null, currency: "USD" };
    expect(livePrice({ ...entry, method: "cost_plus", cost: "100", markupPercent: "35" }, "pcs", [])).toEqual({ status: "active", method: "cost_plus", currency: "USD", per: "pcs", amount: "135.00" });
    expect(livePrice({ ...entry, method: "cost_plus", cost: "100", markupPercent: "35", currency: "KWD" }, "pcs", [])).toMatchObject({ amount: "135.000" });
    expect(livePrice({ ...entry, method: "per_measure", rate: "80", minimumCharge: "500" }, "sqm", [])).toMatchObject({ amount: "80.00", per: "sqm", minimumCharge: "500.00" });
    expect(livePrice({ ...entry, method: "tiered" }, "pcs", [{ fromQuantity: "1", price: "20" }, { fromQuantity: "10", price: "18" }])).toMatchObject({ amount: "20.00", tiers: [{ fromQuantity: "1", price: "20.00" }, { fromQuantity: "10", price: "18.00" }] });
    expect(livePrice({ ...entry, method: "assembly_rollup" }, "pcs", [])).toMatchObject({ amount: null, note: expect.stringMatching(/quotation/) });
  });
});

describe("search words", () => {
  it("match each word anywhere, drop filler and plurals, and escape LIKE characters", () => {
    expect(searchTerms("Is the Harriet sofa in stock?")).toEqual(["%harriet%", "%sofa%", "%stock%"]);
    expect(searchTerms("dining tables")).toEqual(["%dining%", "%table%"]);
    expect(searchTerms("glass")).toEqual(["%glass%"]);
    expect(searchTerms("100%_oak\\")).toEqual(["%100\\%\\_oak\\\\%"]);
    expect(searchTerms("  ")).toEqual([]);
  });
});
