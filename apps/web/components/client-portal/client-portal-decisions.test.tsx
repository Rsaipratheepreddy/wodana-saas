import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortalProject, PortalQuote, PortalSite, PortalView } from "@/lib/client-portal/types";
import { PortalApp } from "./portal-app";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/commercial/quotation-document", () => ({ QuotationDocument: ({ quote }: { quote: { title: string } }) => <article aria-label="Quotation document">{quote.title}</article> }));

const site: PortalSite = {
  slug: "studio", brand: { name: "Studio", logoUrl: null, primaryColor: null, secondaryColor: null, headingFont: null, bodyFont: null }, welcomeTitle: "", welcomeText: "",
  support: { phone: "", email: "", whatsapp: "" }, region: { locale: "en-US", currency: "USD", timeZone: "UTC", country: "US" }, signIn: { channels: ["whatsapp", "email"], demo: false }, gallerySlug: null,
};
const quote: PortalQuote = {
  id: "q1", number: 2, kind: "quotation", direction: null, status: "issued", title: "Kitchen", currency: "USD", validUntil: "2026-10-30", issuedAt: "2026-09-20T09:00:00.000Z",
  total: 1000, discount: 0, taxRate: 0, terms: "", exclusions: "", inclusions: "", hash: "h".repeat(64), expired: false, canDecide: true, cover: null, presentation: null, brand: null,
  rooms: [], paymentTerms: [], decision: null,
  lines: [{ id: "a", deductsLineId: null, room: "Kitchen", title: "Cabinets", specification: "", material: "", finish: "", variantLabel: null, photo: null, dimensions: null, pricingMode: "item",
    quantity: 1, unit: "nos", rate: 1000, optional: false, optionPrice: null, materialRows: [], customMaterials: [] },
  { id: "c", deductsLineId: null, room: "Kitchen", title: "Wine fridge", specification: "", material: "", finish: "", variantLabel: null, photo: null, dimensions: null, pricingMode: "item",
    quantity: 1, unit: "nos", rate: 300, optional: true, optionPrice: 315, materialRows: [], customMaterials: [] }],
};
const base: PortalProject = {
  id: "c1", title: "Villa 12", reference: null, role: "approver", status: "active", paused: false,
  sections: { progress: false, moodboard: false, decisions: true, payments: false, documents: false, warranty: true, meetings: false, designs: false, messages: true },
  manager: null, stage: null, handoverDate: null, handedOverOn: null, warrantyUntil: null, rooms: [], unread: 0, next: [], latestUpdate: null, progress: null, moodboard: null,
  decisions: { quotes: [quote], designs: [], requests: [], definition: null, materials: null,
    handovers: [{ id: "k1", revision: 1, title: "Villa handover", status: "issued", areas: [], issuedAt: "2026-09-26T09:00:00.000Z", decidedOn: null, decidedBy: null, note: "",
      documents: [{ id: "d1", kind: "manual", title: "Care guide", mimeType: "application/pdf" }], canDecide: true }] },
  payments: null, documents: null, messages: { requests: [], unread: 0 },
  warranty: { rooms: [{ id: "a1", name: "Kitchen", until: "2027-08-31", active: true, items: [{ id: "l1", title: "Cabinets", until: "2027-08-31", active: true }] }], claims: [],
    areas: [{ id: "a1", name: "Kitchen" }], lines: [{ id: "l1", title: "Cabinets", areaId: "a1" }], canClaim: true },
};
const view: PortalView = { contact: { name: "Maya", nameConfirmed: true, phone: "+15550100001" }, today: "2026-09-27", projects: [base] };

function mount() {
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>>(async (url) => ({ ok: true, status: 200, json: async () => (String(url).endsWith("/challenge")
    ? { challengeId: "ch1", channel: "whatsapp", expiresIn: 300, resendAfter: 30 } : String(url).endsWith("/command") ? { ok: true } : view) }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const bodies = (fetcher: ReturnType<typeof mount>, action: string) => fetcher.mock.calls.filter(([url]) => String(url).endsWith(`/${action}`))
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

describe("client portal decisions", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("accepts a quotation with the options chosen, confirmed by a code for that exact revision", async () => {
    const fetcher = mount();
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    await user.click(within(await screen.findByRole("navigation", { name: "Sections" })).getByRole("button", { name: /^Decisions/ }));
    await user.click(await screen.findByRole("button", { name: /Kitchen · V2/ }));
    const dialog = await screen.findByRole("dialog", { name: "Kitchen · V2" });
    expect(within(dialog).getByRole("link", { name: "Print or save as PDF" })).toHaveAttribute("href", expect.stringContaining(`/portal/studio/print?case=c1&quote=q1&snapshot=${"h".repeat(64)}`));
    await user.click(within(dialog).getByRole("checkbox", { name: /Wine fridge/ }));
    expect(within(dialog).getByText("\u2068$1,315.00\u2069")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(bodies(fetcher, "challenge")).toEqual([{ purpose: "quote:c1:q1:accept", channel: "whatsapp" }]));
    await user.type(await within(dialog).findByRole("textbox", { name: /Code/ }), "111222");
    await user.click(within(dialog).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(bodies(fetcher, "command")).toEqual([expect.objectContaining({ action: "quote_decision", caseId: "c1", quoteId: "q1", decision: "accept",
      selectedOptionLineIds: ["c"], hash: "h".repeat(64), challengeId: "ch1", code: "111222" })]));
  });

  it("asks for a reason before declining", async () => {
    mount();
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    await user.click(within(await screen.findByRole("navigation", { name: "Sections" })).getByRole("button", { name: /^Decisions/ }));
    await user.click(await screen.findByRole("button", { name: /Kitchen · V2/ }));
    const dialog = await screen.findByRole("dialog", { name: "Kitchen · V2" });
    await user.click(within(dialog).getByRole("button", { name: "Decline" }));
    expect(within(dialog).getByRole("button", { name: "Continue" })).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox", { name: /Why are you declining/ }), "Over budget");
    expect(within(dialog).getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("accepts a handover with what's still to finish", async () => {
    const fetcher = mount();
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    await user.click(within(await screen.findByRole("navigation", { name: "Sections" })).getByRole("button", { name: /^Decisions/ }));
    await user.click(await screen.findByRole("button", { name: /Villa handover · R1/ }));
    const dialog = await screen.findByRole("dialog", { name: "Villa handover · R1" });
    expect(within(dialog).getByRole("link", { name: /Care guide/ })).toHaveAttribute("href", "/api/client-portal/studio/files/handover/d1");
    await user.click(within(dialog).getByRole("button", { name: "Accept handover" }));
    await user.type(within(dialog).getByRole("textbox", { name: /Anything still to finish/ }), "Touch up paint{enter}Fix one hinge");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await user.type(await within(dialog).findByRole("textbox", { name: /Code/ }), "333444");
    await user.click(within(dialog).getByRole("button", { name: "Accept handover" }));
    await waitFor(() => expect(bodies(fetcher, "command")).toEqual([expect.objectContaining({ action: "handover_decision", packId: "k1", decision: "accept",
      outstanding: ["Touch up paint", "Fix one hinge"], challengeId: "ch1", code: "333444" })]));
  });

  it("reports a problem under warranty, and writes to the team", async () => {
    const fetcher = mount();
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    const tabs = await screen.findByRole("navigation", { name: "Sections" });
    await user.click(within(tabs).getByRole("button", { name: /^Warranty/ }));
    // One line per room: how many items and until when; opening it lists them.
    expect(await screen.findByText("1 item · until Aug 31, 2027")).toBeInTheDocument();
    expect(screen.getByText("Cabinets")).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: "Report a problem" }));
    const dialog = await screen.findByRole("dialog", { name: "Report a problem" });
    await user.type(within(dialog).getByRole("textbox", { name: /What's wrong/ }), "Drawer won't close");
    await user.click(within(dialog).getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(bodies(fetcher, "command").at(-1)).toMatchObject({ action: "warranty_claim", caseId: "c1", description: "Drawer won't close" }));
    await user.click(within(tabs).getByRole("button", { name: /^Messages/ }));
    await user.click(await screen.findByRole("button", { name: "New message" }));
    const message = await screen.findByRole("dialog", { name: "New message" });
    await user.type(within(message).getByRole("textbox", { name: /Subject/ }), "Paint");
    await user.type(within(message).getByRole("textbox", { name: /Message/ }), "Which white is it?");
    await user.click(within(message).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(bodies(fetcher, "command").at(-1)).toMatchObject({ action: "request", caseId: "c1", title: "Paint", detail: "Which white is it?" }));
  });
});
