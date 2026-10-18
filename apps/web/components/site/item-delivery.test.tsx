import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ItemDeliveriesState, ItemDelivery } from "@/lib/project-core/items";
import { ItemDeliveries } from "./item-delivery";

afterEach(() => vi.unstubAllGlobals());

const PROJECT = "11111111-1111-4111-8111-111111111111";
const item = (over: Partial<ItemDelivery>): ItemDelivery => ({
  lineId: "l1", title: "Sofa", area: "Living", quantity: "1", unit: "nos", state: "pending", version: 0, deliveredAt: null, deliveredByName: null, installedAt: null, installedByName: null,
  note: "", photos: [], canRecord: true, ...over,
});

function mount(states: ItemDeliveriesState[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let index = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const data = init?.method === "POST" ? states[Math.min(++index, states.length - 1)] : states[index];
    return { ok: true, json: async () => data };
  }));
  return calls;
}

it("blocks delivered without a photo with one message, then records it once a photo of the item is added", async () => {
  const photo = { id: "p1", name: "sofa.jpg", hasPreview: true, byName: "Sami Site", at: "2026-10-15T09:00:00.000Z" };
  const calls = mount([
    { canRecord: true, items: [item({}), item({ lineId: "l2", title: "Wardrobe", state: "installed", version: 2, installedByName: "Sami Site", installedAt: "2026-10-14T09:00:00.000Z",
      photos: [photo, { ...photo, id: "p2" }], canRecord: false })] },
    { canRecord: true, items: [item({ photos: [photo] })] },
    { canRecord: true, items: [item({ state: "delivered", version: 1, photos: [photo], deliveredByName: "Sami Site", deliveredAt: "2026-10-15T09:00:00.000Z" })] },
  ]);
  const user = userEvent.setup();
  render(<ItemDeliveries workspaceId="w" projectId={PROJECT} />);
  const table = await screen.findByRole("table", { name: "Item deliveries" });
  expect(within(table).getByText("Not delivered")).toBeInTheDocument();
  expect(within(table).getByText("Delivered and installed")).toBeInTheDocument();
  // The photos as thumbnails, each opening the photo.
  const thumbs = within(table).getByRole("list", { name: "Photos of Wardrobe" });
  expect(within(thumbs).getAllByRole("link")).toHaveLength(2);
  expect(within(thumbs).getAllByRole("link")[0]).toHaveAttribute("href", expect.stringContaining(`projects/${PROJECT}/item-photos/p1`));

  await user.click(within(table).getByRole("button", { name: "Record delivery" }));
  let dialog = await screen.findByRole("dialog", { name: "Sofa" });
  expect(within(dialog).getByText("Add a photo of the item on site first.")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Mark delivered" })).toBeDisabled();
  await user.upload(dialog.querySelector('input[type="file"]') as HTMLInputElement, new File(["jpeg"], "sofa.jpg", { type: "image/jpeg" }));
  await waitFor(() => expect(calls.some((call) => call.url.includes(`items/l1/delivery-photos/`))).toBe(true));
  dialog = await screen.findByRole("dialog", { name: "Sofa" });
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Mark delivered" })).toBeEnabled());
  expect(within(dialog).queryByText("Add a photo of the item on site first.")).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Mark delivered" }));
  await waitFor(() => expect(calls.filter((call) => call.init?.method === "POST" && call.url.includes(`projects/${PROJECT}/items?`))).toHaveLength(1));
  const posted = calls.find((call) => call.init?.method === "POST" && call.url.includes(`projects/${PROJECT}/items?`))!;
  expect(JSON.parse(String(posted.init!.body))).toEqual({ commandId: expect.any(String), action: "mark_delivered", lineId: "l1", version: 0, note: "" });
  expect(await screen.findByText("Delivered")).toBeInTheDocument();
});
