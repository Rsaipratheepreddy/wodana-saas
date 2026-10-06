import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { WorkbookSheet } from "@/lib/linked-imports/xlsx-workbook";
import { LinkedImportDialog } from "./linked-import-dialog";

const WS = "11111111-1111-4111-8111-111111111111";
const ITEM = "33333333-3333-4333-8333-333333333333", PICTURED = "44444444-4444-4444-8444-444444444444";
// A collection workbook: a category title over its heading row, a drawing link, a picture per row, and a hidden template tab.
const sheets: WorkbookSheet[] = [
  { name: "Living", rows: [["", "SOFA"], ["ITEM", "DESCRIPTION", "RENDER", "PRICE (AED)", "Technical Drawing"], ["SOFA", "Aria Sofa", "", "23500", "Aria drawing"],
    ["SOFA", "Luna Sofa", "", "ENQUIRE", ""]], links: { "2:4": "https://drive.example/aria.pdf" },
  images: [{ row: 2, col: 2, path: "xl/media/a.png", type: "image/png", size: 10 }, { row: 3, col: 2, path: "xl/media/b.png", type: "image/png", size: 10 }] },
  { name: "Template", rows: [["DESCRIPTION", "PRICE (AED)"]], hidden: true },
];
vi.mock("@/lib/linked-imports/import-file", async (original) => ({
  ...(await original<typeof import("@/lib/linked-imports/import-file")>()),
  readImportFile: vi.fn(async () => sheets),
  readImportImage: vi.fn(async () => new File(["png"], "a.png", { type: "image/png" })),
}));

describe("linked import of a collection workbook", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("chooses the shown tabs, sends titles and links, and adds each new item's picture after the import", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      calls.push({ url: String(url), method: init?.method ?? "GET", body });
      const json = (value: unknown) => ({ ok: true, status: 200, json: async () => value });
      if (String(url).includes("/picker")) return json({ configured: false, apiKey: "", appId: "" });
      if (String(url).includes("/preview")) return json({ fingerprint: "f".repeat(64), skippedTabs: [], summary: { added: 2, changed: 0, unchanged: 0, errors: 0, missing: 0 }, rows: [] });
      if (String(url).includes("/api/catalog-images/")) return json({ id: "x" });
      if (init?.method === "POST") return json({ link: { id: "22222222-2222-4222-8222-222222222222", target: "catalog", name: "Collection", source: "upload", mapping: { columns: {} }, version: 1, schedule: "off" },
        runs: [], rows: [], canManage: true, records: [{ sheet: "Living", line: 3, recordId: ITEM, images: 0 }, { sheet: "Living", line: 4, recordId: PICTURED, images: 1 }] });
      return json({ links: [], canManage: true, connections: [], locations: [], currency: "AED" });
    }));
    render(<DesignSystemProvider><LinkedImportDialog catalogId="55555555-5555-4555-8555-555555555555" isOpen onClose={() => undefined} onImported={() => undefined} target="catalog" workspaceId={WS} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Import" });
    await userEvent.upload(within(dialog).getByLabelText("Upload a spreadsheet"), new File(["x"], "Collection.xlsx"));
    const tabs = await within(dialog).findByRole("list", { name: "Tabs" });
    expect(within(tabs).getByRole("checkbox", { name: "Living" })).toBeChecked();
    expect(within(tabs).getByRole("checkbox", { name: "Template" })).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: "Review" }));
    await waitFor(() => expect(calls.some((call) => call.url.includes("/preview"))).toBe(true));
    const preview = calls.find((call) => call.url.includes("/preview"))!.body as Record<string, unknown>;
    expect(preview).toMatchObject({ target: "catalog", mapping: { tabs: ["Living"], columns: { ITEM: "name", DESCRIPTION: "description", "PRICE (AED)": "price", "Technical Drawing": "technicalDrawing" } } });
    // The picture column (RENDER) isn't guessed, so it isn't sent.
    expect(preview.sheets).toEqual([{ name: "Living", titles: { 1: "SOFA" }, links: { "2:3": "https://drive.example/aria.pdf" },
      rows: [[], ["ITEM", "DESCRIPTION", "PRICE (AED)", "Technical Drawing"], ["SOFA", "Aria Sofa", "23500", "Aria drawing"], ["SOFA", "Luna Sofa", "ENQUIRE", ""]] }]);
    await userEvent.click(await within(dialog).findByRole("button", { name: "Import" }));
    // Only the item without a picture gets one.
    await waitFor(() => expect(calls.filter((call) => call.url.includes("/api/catalog-images/"))).toHaveLength(1));
    const upload = calls.find((call) => call.url.includes("/api/catalog-images/"))!;
    expect(upload.url).toMatch(new RegExp(`/api/catalog-images/items/${ITEM}/[0-9a-f-]{36}\\?workspaceId=${WS}`));
    expect((upload.body as FormData).get("file")).toBeInstanceOf(File);
  });
});
