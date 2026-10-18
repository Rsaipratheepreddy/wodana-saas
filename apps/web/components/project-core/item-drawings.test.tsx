import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ItemDrawing, ItemDrawingsState, ItemDrawingVersion } from "@/lib/project-core/items";
import { ItemDrawings } from "./item-drawings";

afterEach(() => vi.unstubAllGlobals());

const PROJECT = "11111111-1111-4111-8111-111111111111";
const version = (over: Partial<ItemDrawingVersion> = {}): ItemDrawingVersion => ({
  id: "v1", number: 1, status: "with_lead_designer", name: "wardrobe.png", mimeType: "image/png", byteSize: 10, hasPreview: true, sha256: "a".repeat(64), note: "Sliding doors",
  quantity: "2", unit: "nos", width: "2400", height: "2700", depth: "600", dimensionUnit: "mm", byName: "Tara Technical", at: "2026-10-12T09:00:00.000Z",
  reviewedByName: null, reviewedAt: null, reviewNote: "", clientNote: "", clientDecidedAt: null, ...over,
});
const item = (over: Partial<ItemDrawing>): ItemDrawing => ({
  lineId: "l1", title: "Wardrobe", area: "Bedroom", quantity: "2", unit: "nos", needed: true, state: "waiting", version: 0, number: 0, current: null, versions: [], locked: null,
  signature: null, plan: null, supplies: null, canSignOffSupplies: false, canUpload: false, canReview: false, ...over,
});
const state = (items: ItemDrawing[]): ItemDrawingsState => ({ dimensionUnit: "mm", units: ["mm", "cm", "m", "in", "ft"], canUpload: true, canReview: true, canPlan: false, items });

function mount(data: ItemDrawingsState) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return { ok: true, json: async () => data }; }));
  return calls;
}

it("shows one chip per item, and the lead designer returns a drawing with the reason in a review that previews it", async () => {
  const waiting = version();
  const calls = mount(state([
    item({ lineId: "l1", state: "with_lead_designer", version: 1, number: 1, current: waiting, versions: [waiting], canReview: true }),
    item({ lineId: "l2", title: "Sofa", needed: false, state: "not_needed" }),
    item({ lineId: "l3", title: "Vanity", state: "signed", version: 3, number: 1, locked: { versionId: "v9", number: 1, at: "2026-10-14T09:00:00.000Z", quantity: "1", unit: "nos",
      width: "900", height: null, depth: "500", dimensionUnit: "mm" }, signature: { versionId: "v9", signerName: "Maya", signedAt: "2026-10-14T09:00:00.000Z", device: "Safari on iPhone", fingerprint: "b".repeat(64) } }),
  ]));
  const user = userEvent.setup();
  render(<ItemDrawings workspaceId="w" projectId={PROJECT} />);
  const grid = await screen.findByRole("table", { name: "Shop drawings" });
  expect(within(grid).getByText("With the lead designer")).toBeInTheDocument();
  expect(within(grid).getByText("Not needed")).toBeInTheDocument();
  expect(within(grid).getByText("Signed")).toBeInTheDocument();
  expect(within(grid).getByText(/Signed by Maya/)).toBeInTheDocument();
  // No approval from the list: the review opens first, with the drawing.
  await user.click(within(grid).getByRole("button", { name: "Review" }));
  const dialog = await screen.findByRole("dialog", { name: /Check Wardrobe/ });
  expect(within(dialog).getByRole("img", { name: "wardrobe.png" })).toHaveAttribute("src", expect.stringContaining(`projects/${PROJECT}/item-drawings/files/v1`));
  expect(within(dialog).getByText("2,400 × 2,700 × 600 mm")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("radio", { name: "Return" }));
  expect(within(dialog).getByRole("button", { name: "Return" })).toBeDisabled();
  await user.type(within(dialog).getByRole("textbox", { name: /What needs to change/ }), "Doors should slide");
  await user.click(within(dialog).getByRole("button", { name: "Return" }));
  await waitFor(() => expect(calls.some((call) => call.init?.method === "POST")).toBe(true));
  const posted = calls.find((call) => call.init?.method === "POST")!;
  expect(posted.url).toContain(`projects/${PROJECT}/items`);
  expect(JSON.parse(String(posted.init!.body))).toEqual({ commandId: expect.any(String), action: "review_drawing", versionId: "v1", version: 1, decision: "return", reason: "Doors should slide" });
});

it("uploads a version with the item's quantity and the sizes in the workspace's unit, checked against the item's version", async () => {
  const calls = mount(state([item({ lineId: "l1", state: "changes_asked", version: 2, number: 1, canUpload: true, current: version({ status: "returned", reviewNote: "Mirror" }) })]));
  const user = userEvent.setup();
  render(<ItemDrawings workspaceId="w" projectId={PROJECT} />);
  await user.click(await screen.findByRole("button", { name: "Upload a new version" }));
  const dialog = await screen.findByRole("dialog", { name: /Shop drawing for Wardrobe/ });
  expect(within(dialog).getByRole("button", { name: "Upload" })).toBeDisabled();
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(["%PDF-1.4"], "wardrobe-v2.pdf", { type: "application/pdf" }));
  await user.click(within(dialog).getByRole("button", { name: "Upload" }));
  await waitFor(() => expect(calls.some((call) => call.init?.method === "POST")).toBe(true));
  const posted = calls.find((call) => call.init?.method === "POST")!;
  expect(posted.url).toContain(`projects/${PROJECT}/items/l1/drawing-versions/`);
  const form = posted.init!.body as FormData;
  expect((form.get("file") as File).name).toBe("wardrobe-v2.pdf");
  expect(JSON.parse(String(form.get("meta")))).toEqual({ version: 2, quantity: "2", width: "2400", height: "2700", depth: "600", dimensionUnit: "mm", note: "" });
});
