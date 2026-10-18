import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CatalogStructure } from "@/lib/workspace/catalog-v2";
import { clipperBookmarklet, fromMm, suggestedCode, type ItemFit, type ProductClip } from "@/lib/workspace/product-sourcing";
import { DesignLinkCard } from "./design-link-card";
import { FitCheckList } from "./fit-check-panel";
import { ProductClipDialog } from "./product-clip-dialog";

const structure: CatalogStructure = { categories: [], attributes: [], units: [{ code: "pcs", label: "Piece", kind: "count" }] };
const clip: ProductClip = {
  id: "c1", catalogId: "k1", sourceUrl: "https://shop.example.com/halden", finalUrl: "https://shop.example.com/halden", host: "shop.example.com", pageTitle: "Halden",
  aiStatus: "used", aiModel: "m", status: "review", catalogItemId: null, savedAt: null, fetchedAt: "2026-10-06T00:00:00Z", version: 1,
  fields: [
    { field: "name", proposedValue: "Halden 3-seat sofa", source: "structured_data", confidence: 0.95, evidence: null, model: null, decision: "pending", finalValue: null, confirmedBy: null, confirmedByName: null, confirmedAt: null },
    { field: "sku", proposedValue: "HAL 3", source: "structured_data", confidence: 0.95, evidence: null, model: null, decision: "pending", finalValue: null, confirmedBy: null, confirmedByName: null, confirmedAt: null },
    { field: "width", proposedValue: "228", source: "structured_data", confidence: 0.95, evidence: null, model: null, decision: "pending", finalValue: null, confirmedBy: null, confirmedByName: null, confirmedAt: null },
    { field: "finish", proposedValue: "Matt lacquer", source: "ai", confidence: 0.85, evidence: "Finish: matt lacquer", model: "m", decision: "pending", finalValue: null, confirmedBy: null, confirmedByName: null, confirmedAt: null },
  ],
  images: [{ id: "img1", position: 0, hasPreview: true }, { id: "img2", position: 1, hasPreview: true }], defaults: { unit: "cm", currency: "GBP" },
};

type Call = { url: string; method: string; body: unknown };
function mount(answer: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const { status, body } = answer(call);
    return { ok: status < 400, status, json: async () => body };
  }));
  return calls;
}
const ui = (node: React.ReactNode) => render(<DesignSystemProvider>{node}</DesignSystemProvider>);

describe("product clipper", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a link, shows where each value came from, and saves the reviewed item with the chosen pictures", async () => {
    const calls = mount((call) => call.url.includes("/vendors") ? { status: 200, body: { data: [] } }
      : call.url.includes("/save") ? { status: 200, body: { ...clip, status: "saved", itemId: "item-1" } } : { status: 200, body: clip });
    const saved = vi.fn();
    ui(<ProductClipDialog catalogId="k1" initialUrl="https://shop.example.com/halden" isOpen onClose={() => undefined} onSaved={saved} structure={structure} workspaceId="w" />);
    await userEvent.click(screen.getByRole("button", { name: "Read page" }));
    expect(await screen.findByDisplayValue("Halden 3-seat sofa")).toBeInTheDocument();
    expect(screen.getByDisplayValue("HAL-3")).toBeInTheDocument(); // the code comes from the shop's SKU
    expect(screen.getByText(/AI · 85%/)).toHaveAttribute("title", "Finish: matt lacquer");
    expect(screen.queryByText("From the page text")).not.toBeInTheDocument(); // product data needs no note
    const read = calls.find((call) => call.url.includes("/product-sourcing/clips?"))!;
    expect(read.body).toMatchObject({ catalogId: "k1", url: "https://shop.example.com/halden" });

    await userEvent.click(screen.getByRole("button", { name: "Picture 2" })); // leave the second picture out
    const name = screen.getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Halden sofa");
    await userEvent.click(screen.getByRole("button", { name: "Add to catalog" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("item-1"));
    const save = calls.find((call) => call.url.includes("/clips/c1/save"))!;
    expect(save.body).toMatchObject({ version: 1, code: "HAL-3", itemType: "product", unitCode: "pcs", imageIds: ["img1"],
      values: { name: "Halden sofa", width: "228", finish: "Matt lacquer", dimension_unit: "cm", currency: "GBP", colour: null } });
  });

  it("says why a link can't be read", async () => {
    mount((call) => call.url.includes("/vendors") ? { status: 200, body: { data: [] } } : { status: 422, body: { message: "This address is not on the public internet." } });
    ui(<ProductClipDialog catalogId="k1" initialUrl="http://169.254.169.254/" isOpen onClose={() => undefined} onSaved={() => undefined} structure={structure} workspaceId="w" />);
    await userEvent.click(screen.getByRole("button", { name: "Read page" }));
    expect(await screen.findByText("This address is not on the public internet.")).toBeInTheDocument();
  });

  it("builds the browser button and catalog codes", () => {
    expect(clipperBookmarklet("https://palm.wodana.ai")).toBe(`javascript:(()=>{location.href="https://palm.wodana.ai/workspace/catalogs?clip="+encodeURIComponent(location.href)})()`);
    expect(suggestedCode(null, "Halden 3-seat sofa (oak)")).toBe("HALDEN-3-SEAT-SOFA-OAK");
    expect(fromMm(254, "in")).toBe(10);
  });
});

describe("Canva link card", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("shows the stored thumbnail and opens in Canva", async () => {
    mount(() => ({ status: 200, body: { id: "p1", url: "https://www.canva.com/design/DAF1/view", provider: "canva", title: "Living room moodboard", hasImage: true, status: "ok", host: "www.canva.com" } }));
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = ui(<DesignLinkCard url="https://www.canva.com/design/DAF1/view" workspaceId="w" />);
    expect(await screen.findByText("Living room moodboard")).toBeInTheDocument();
    expect(container.querySelector("img")?.getAttribute("src")).toContain("/api/workspace/product-sourcing/link-previews/p1/image");
    await userEvent.click(screen.getByRole("button", { name: "Open in Canva" }));
    expect(open).toHaveBeenCalledWith("https://www.canva.com/design/DAF1/view", "_blank", "noopener,noreferrer");
  });
});

describe("fit check", () => {
  afterEach(() => vi.unstubAllGlobals());
  const failing: ItemFit = {
    itemId: "i1", name: "Halden sofa", size: { width: "228", depth: "95", height: "82", diagonalDepth: null, unit: "cm", version: 1 }, inputsHash: "a".repeat(64), blocksOrdering: true, override: null,
    result: { status: "does_not_fit", reason: null, clearanceMm: 20, routes: [{ route: "Main", status: "does_not_fit", points: [{ pointId: "p", label: "Apartment door", kind: "door", route: "Main", status: "does_not_fit", way: "straight", spareMm: -20, missing: [] }] }] },
  };
  it("shows the failing door and records an override with a reason", async () => {
    let overridden = false;
    const calls = mount((call) => call.url.includes("/overrides") ? (overridden = true, { status: 200, body: failing })
      : { status: 200, body: { items: [overridden ? { ...failing, blocksOrdering: false, override: { id: "o", reason: "Arms come off", context: "ordering", overriddenBy: "u", overriddenByName: "Dana", overriddenAt: "" } } : failing] } });
    ui(<FitCheckList canOverride caseId="case" context="ordering" itemIds={["i1"]} workspaceId="w" />);
    expect((await screen.findAllByText("Doesn't fit")).length).toBe(2);
    expect(screen.getByText("-2 cm")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Override" }));
    await userEvent.type(screen.getByRole("textbox", { name: /Reason/ }), "Arms come off");
    await userEvent.click(screen.getAllByRole("button", { name: "Override" }).at(-1)!);
    await waitFor(() => expect(screen.getByText("Overridden")).toBeInTheDocument());
    expect(calls.find((call) => call.url.includes("/overrides"))!.body).toMatchObject({ itemId: "i1", inputsHash: "a".repeat(64), reason: "Arms come off", context: "ordering" });
  });
});
