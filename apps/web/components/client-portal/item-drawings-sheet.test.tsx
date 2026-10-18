import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalItemDrawing, PortalProject, PortalSite, PortalView } from "@/lib/client-portal/types";
import { PortalApp } from "./portal-app";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const CASE = "6f1c2b9e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const V1 = "11111111-1111-4111-8111-111111111111", V2 = "22222222-2222-4222-8222-222222222222", V3 = "33333333-3333-4333-8333-333333333333";
const site: PortalSite = {
  slug: "studio", brand: { name: "Studio", logoUrl: null, primaryColor: null, secondaryColor: null, headingFont: null, bodyFont: null }, welcomeTitle: "", welcomeText: "",
  support: { phone: "", email: "", whatsapp: "" }, region: { locale: "en-US", currency: "USD", timeZone: "UTC", country: "US" }, signIn: { channels: ["whatsapp", "email"], demo: false }, gallerySlug: null,
};
const drawing = (over: Partial<PortalItemDrawing>): PortalItemDrawing => ({
  lineId: "l1", versionId: V1, title: "Kitchen cabinets", area: "Kitchen", number: 1, status: "with_client", name: "cabinets.pdf", mimeType: "application/pdf", hasPreview: false,
  quantity: "4.5", unit: "m", width: "4500", height: "2400", depth: "600", dimensionUnit: "mm", decidedAt: null, note: "", signedBy: null, signedAt: null, canSign: true, ...over,
});
const project: PortalProject = {
  id: CASE, title: "Villa 12", reference: null, role: "approver", status: "active", paused: false,
  sections: { progress: false, moodboard: false, decisions: true, payments: false, boq: false, documents: false, warranty: false, meetings: false, designs: false, messages: false },
  manager: null, stage: null, handoverDate: null, handedOverOn: null, warrantyUntil: null, rooms: [], unread: 0, latestUpdate: null, progress: null, moodboard: null,
  next: [{ kind: "item_drawings", id: V1, title: "2", due: null }],
  decisions: { quotes: [], designs: [], requests: [], definition: null, materials: null, handovers: [],
    itemDrawings: { canSign: true, items: [drawing({}), drawing({ lineId: "l2", versionId: V2, title: "Wardrobe", quantity: "2", unit: "nos", width: "2400", height: null, depth: null }),
      drawing({ lineId: "l3", versionId: V3, title: "Vanity", status: "signed", canSign: false, signedBy: "Maya", signedAt: "2026-10-10T09:00:00.000Z" })] } },
  payments: null, documents: null, messages: null, warranty: null,
};
const view: PortalView = { contact: { name: "Maya", nameConfirmed: true, phone: "+15550100001" }, today: "2026-10-17", projects: [project] };
const batch = (ids: string[]) => {
  const hex = createHash("sha256").update(`${CASE}:${[...ids].sort().join(",")}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

afterEach(() => vi.unstubAllGlobals());

it("signs two items' shop drawings at once, with a code bound to exactly those two", async () => {
  const fetcher = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (String(url).endsWith("/challenge")
    ? { challengeId: "ch1", channel: "whatsapp", expiresIn: 300, resendAfter: 30 } : String(url).endsWith("/command") ? { ok: true, signed: 2 } : view) }));
  vi.stubGlobal("fetch", fetcher);
  const bodies = (action: string) => fetcher.mock.calls.filter(([url]) => String(url).endsWith(`/${action}`)).map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
  const user = userEvent.setup();
  render(<PortalApp site={site} />);
  await user.click(within(await screen.findByRole("navigation", { name: "Sections" })).getByRole("button", { name: /^Decisions/ }));
  await user.click(await screen.findByRole("button", { name: /3 items/ }));
  const dialog = await screen.findByRole("dialog", { name: "Shop drawings" });
  const table = within(dialog).getByRole("table", { name: "Shop drawings" });
  expect(within(table).getAllByText("Waiting for your signature")).toHaveLength(2);
  expect(within(table).getByText("Signed")).toBeInTheDocument();
  expect(within(table).getByText(/Wardrobe/).closest("tr")).toHaveTextContent("2,400 mm");
  await user.click(within(dialog).getByRole("button", { name: "Sign all 2" }));
  await waitFor(() => expect(bodies("challenge")).toEqual([{ purpose: `item_drawings:${CASE}:${batch([V1, V2])}:sign`, channel: "whatsapp" }]));
  await user.type(await within(dialog).findByRole("textbox", { name: /Code/ }), "111222");
  await user.click(within(dialog).getByRole("button", { name: "Sign 2 drawings" }));
  await waitFor(() => expect(bodies("command")).toEqual([expect.objectContaining({ action: "item_drawings_sign", caseId: CASE, versionIds: [V1, V2], challengeId: "ch1", code: "111222",
    commandId: expect.any(String), device: expect.any(String) })]));
});
