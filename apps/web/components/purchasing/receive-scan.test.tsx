import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { ReceiveScan } from "./receive-scan";

const nav = { query: "", replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }), usePathname: () => "/workspace/receive", useSearchParams: () => new URLSearchParams(nav.query) }));

const orderId = "6d0f2b67-6f6a-4a22-8cb0-3f2d5d77a33a";
const moveId = "7e1f3c78-7a7b-4b33-9dc1-4a3e6e88b44b";

function serve(routes: Record<string, unknown>) {
  const fetcher = vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((path) => String(url).includes(path));
    return { ok: Boolean(key), status: key ? 200 : 404, json: async () => (key ? routes[key] : { message: "Not found" }) };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const mount = () => render(<DesignSystemProvider><ReceiveScan workspaceId="w" /></DesignSystemProvider>);

describe("receiving on a phone (D-46)", () => {
  beforeEach(() => { nav.query = ""; nav.replace.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());

  it("without a camera reader, says to scan with the phone's camera and finds an order or a move by its number", async () => {
    serve({
      "/deliveries": { expected: [{ id: orderId, number: "FAC-PO-2026-00003" }], inspection: [], received: [], locations: [], canReceive: true, canInspect: false, userId: "u", unmatched: [], requireSitePhoto: false },
      "/transfers": { transfers: [{ id: moveId, number: 12, status: "in_transit" }], locations: [], canManage: false, canAdjust: false, canReceive: true },
    });
    const user = userEvent.setup();
    mount();
    expect(screen.getByRole("heading", { name: "Receive" })).toBeInTheDocument();
    expect(await screen.findByText("Scan the code with your phone's camera, or enter the number.")).toBeInTheDocument();
    const number = screen.getByRole("textbox", { name: "Order or move number" });
    await user.type(number, "fac-po-2026-00003");
    await user.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/workspace/receive?order=${orderId}`));
    await user.clear(number);
    await user.type(number, "Move 12{Enter}");
    await waitFor(() => expect(nav.replace).toHaveBeenLastCalledWith(`/workspace/receive?move=${moveId}`));
    await user.clear(number);
    await user.type(number, "PO-404{Enter}");
    expect(await screen.findByText("No order or move on its way has that number.")).toBeInTheDocument();
  });

  it("opens the order a scanned code names, ready to receive", async () => {
    nav.query = `order=${orderId}`;
    serve({ [`/orders/${orderId}/receiving`]: { order: { id: orderId, number: "FAC-PO-2026-00003", deliverTo: "site", currency: "USD", projects: [] }, lines: [], places: [], defaultPlace: null,
      requireInspection: false, receiveTolerancePercent: "0", requireSitePhoto: false } });
    mount();
    expect(await screen.findByRole("dialog", { name: "Receive FAC-PO-2026-00003" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Order or move number" })).toBeNull();
  });
});
