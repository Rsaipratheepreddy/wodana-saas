import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/i18n-provider";
import type { PortalProject, PortalSite, PortalView } from "@/lib/client-portal/types";
import { PortalApp } from "./portal-app";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }) }));

const site: PortalSite = {
  slug: "studio",
  brand: { name: "Studio Interiors", logoUrl: null, primaryColor: "#0F5C4A", secondaryColor: "#C8A165", headingFont: "alta", bodyFont: "montserrat" },
  welcomeTitle: "Welcome home", welcomeText: "Everything about your villa, in one place.",
  support: { phone: "+15550100100", email: "care@studio.example", whatsapp: "" },
  region: { locale: "en-US", currency: "USD", timeZone: "America/New_York", country: "US" },
  signIn: { channels: ["whatsapp", "email"], demo: false }, gallerySlug: null,
};

const project = (patch: Partial<PortalProject> = {}): PortalProject => ({
  id: "c1", title: "Villa 12", reference: "PRJ-0042", role: "approver", status: "active", paused: false,
  sections: { progress: true, moodboard: true, decisions: true, payments: true, documents: true, warranty: false, messages: true },
  manager: "Omar Manager", stage: { number: 2, total: 5, name: "Production" }, handoverDate: "2026-12-01", handedOverOn: null, warrantyUntil: null,
  rooms: [{ id: "k1", name: "Kitchen" }], unread: 0,
  next: [{ kind: "materials", id: "r1", title: "R1", due: null }],
  latestUpdate: { id: "u1", at: "2026-09-25T09:00:00.000Z", text: "Cabinets are in the factory." },
  progress: { stages: [{ name: "Design", state: "done", startedOn: "2026-09-01", finishedOn: "2026-09-10" }, { name: "Production", state: "current", startedOn: "2026-09-11", finishedOn: null },
    { name: "Installation", state: "upcoming", startedOn: null, finishedOn: null }], updates: [{ id: "u1", at: "2026-09-25T09:00:00.000Z", text: "Cabinets are in the factory." }],
    photoDays: [{ on: "2026-09-25", photos: [{ id: "p1" }] }], issues: [], canReportIssue: true, siteAccess: [] },
  moodboard: { canAdd: true, boards: [{ id: "b1", title: "Kitchen concept", room: "Kitchen", number: 2, status: "client_review", mimeType: "image/png", sharedAt: "2026-09-20T09:00:00.000Z",
    hasImage: true, reaction: null, comments: [] }],
    pins: [{ id: "pin1", title: "Warm oak", note: "Like this grain", link: null, room: null, addedAt: "2026-09-21T09:00:00.000Z", feeling: "love", fromClient: false, mine: false, author: null,
      photos: [{ id: "a1" }], reaction: "like", comments: [{ id: "cm1", text: "Glad you like it.", at: "2026-09-22T09:00:00.000Z", fromClient: false, mine: false, author: null }] }] },
  decisions: { quotes: [], designs: [], requests: [], definition: null, handovers: [],
    materials: { id: "r1", number: 1, status: "sent", sentAt: "2026-09-24T09:00:00.000Z", decidedAt: null, decidedBy: null, canDecide: true,
      items: [{ id: "m1", name: "Oak veneer", specification: "Crown cut", quantity: "12.0000", unit: "m²", areas: ["Kitchen"], decision: null, note: "" },
        { id: "m2", name: "Brass handles", specification: "", quantity: null, unit: "", areas: [], decision: null, note: "" }] } },
  payments: { currency: "USD", showAmounts: true, milestones: [
    { id: "p3", title: "Before installation", amount: "2000.0000", paid: "0.0000", left: "2000.0000", dueDate: "2026-09-20", status: "overdue",
      invoice: { id: "11111111-1111-4111-8111-111111111113", number: "INV-3", issueDate: "2026-09-10" }, receipts: [], payUrl: null, report: null, canReport: true },
    { id: "p1", title: "Advance", amount: "5000.0000", paid: "5000.0000", left: "0.0000", dueDate: null, status: "paid",
      invoice: { id: "11111111-1111-4111-8111-111111111111", number: "INV-1", issueDate: "2026-09-20" },
      receipts: [{ id: "22222222-2222-4222-8222-222222222221", amount: "5000.0000", receivedOn: "2026-09-21" }], payUrl: null, report: null, canReport: false },
    { id: "p2", title: "Before production", amount: "5000.0000", paid: "0.0000", left: "5000.0000", dueDate: "2026-10-01", status: "upcoming", invoice: null, receipts: [],
      payUrl: "https://pay.example.com/p2", report: null, canReport: true }] },
  documents: [], warranty: null, messages: { requests: [], unread: 0 },
  ...patch,
});

const view = (patch: Partial<PortalView> = {}, projects = [project()]): PortalView => ({ contact: { name: "Maya", nameConfirmed: true, phone: "+15550100001" }, today: "2026-09-27", projects, ...patch });

type Reply = { status?: number; body: unknown };
function mount(respond: (url: string, body: Record<string, unknown> | null) => Reply) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    const reply = respond(url, body);
    return { ok: (reply.status ?? 200) < 400, status: reply.status ?? 200, json: async () => reply.body };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const sent = (fetcher: ReturnType<typeof mount>, action: string) => fetcher.mock.calls.filter(([url]) => String(url).endsWith(`/${action}`))
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

describe("client portal", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("signs in with a code by WhatsApp, can send it by email instead, and opens the project", async () => {
    let signedIn = false;
    const fetcher = mount((url, body) => {
      if (url.endsWith("/view")) return signedIn ? { body: view() } : { status: 401, body: { message: "Sign in to continue." } };
      if (url.endsWith("/challenge")) return { body: { challengeId: "ch1", channel: body?.channel, expiresIn: 300, resendAfter: 0 } };
      if (url.endsWith("/login")) { signedIn = true; return { body: { ok: true, needsName: false } }; }
      return { body: {} };
    });
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    expect(await screen.findByRole("heading", { name: "Welcome home" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /Mobile number/ }), "2025550123");
    await user.click(screen.getByRole("button", { name: "Send code by WhatsApp" }));
    expect(await screen.findByRole("heading", { name: "Enter your code" })).toBeInTheDocument();
    expect(sent(fetcher, "challenge")).toEqual([{ phone: "+12025550123", channel: "whatsapp" }]);
    await user.click(screen.getByRole("button", { name: "Send it by email instead" }));
    await waitFor(() => expect(sent(fetcher, "challenge").at(-1)).toEqual({ phone: "+12025550123", channel: "email" }));
    await user.type(screen.getByRole("textbox", { name: /Code/ }), "123456");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Villa 12" })).toBeInTheDocument();
    expect(sent(fetcher, "login")).toEqual([{ challengeId: "ch1", code: "123456" }]);
  });

  it("stays light with the tenant's logo and surface on top, whatever the device prefers", async () => {
    mount((url) => (url.endsWith("/view") ? { status: 401, body: {} } : { body: {} }));
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("dark"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const branded = { ...site, brand: { ...site.brand, primaryColor: "#E4E3DE", secondaryColor: "#000000", logoUrl: "/api/auth/tenant-logo/studio?v=1" } };
    render(<PortalApp site={branded} />);
    expect(await screen.findByRole("heading", { name: "Welcome home" })).toBeInTheDocument();
    const root = document.querySelector<HTMLElement>("[data-portal-root]")!;
    expect(root).toHaveAttribute("data-wd-theme", "light");
    expect(root.style.getPropertyValue("--wd-workspace-brand-surface-light")).toBe("#E4E3DE");
    expect(root.style.getPropertyValue("--wd-workspace-action-light-primary")).toBe("#000000");
    expect(root.style.getPropertyValue("--wd-workspace-font-heading")).toContain("Montserrat");
    expect(within(screen.getByRole("banner")).getByRole("img", { name: "Studio Interiors" })).toHaveAttribute("src", "/api/auth/tenant-logo/studio?v=1");
    expect(within(screen.getByRole("contentinfo")).getByText("Powered by Wodana")).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).queryByText("Powered by Wodana")).not.toBeInTheDocument();
  });

  it("lets a client who typed the wrong number start again", async () => {
    mount((url) => (url.endsWith("/view") ? { status: 401, body: {} } : { body: { challengeId: "ch1", channel: "whatsapp", expiresIn: 300, resendAfter: 30 } }));
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    await user.type(await screen.findByRole("textbox", { name: /Mobile number/ }), "2025550123");
    await user.click(screen.getByRole("button", { name: "Send code by WhatsApp" }));
    expect(await screen.findByRole("button", { name: /Send a new code in \d+ s/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Not you? Change number" }));
    expect(await screen.findByRole("heading", { name: "Welcome home" })).toBeInTheDocument();
  });

  it("asks a first-time client to confirm their name", async () => {
    const fetcher = mount((url) => (url.endsWith("/view") ? { body: view({ contact: { name: "Maya", nameConfirmed: false, phone: "+15550100001" } }) } : { body: { ok: true } }));
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    const name = await screen.findByRole("textbox", { name: /Your name/ });
    await user.clear(name);
    await user.type(name, "Maya Client");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(sent(fetcher, "command")).toEqual([expect.objectContaining({ action: "confirm_name", name: "Maya Client", commandId: expect.any(String) })]));
  });

  it("shows where the project stands and what's needed, and only the sections the team shares", async () => {
    mount(() => ({ body: view() }));
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    expect(await screen.findByText("Stage 2 of 5 · \u2068Production\u2069")).toBeInTheDocument();
    expect(screen.getByText("Cabinets are in the factory.")).toBeInTheDocument();
    expect(screen.getByText("Your project manager: \u2068Omar Manager\u2069")).toBeInTheDocument();
    expect(screen.getByText("Handover planned for Dec 1, 2026 · in 65 days")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Material list to sign off/ })).toBeInTheDocument();
    const tabs = screen.getByRole("tablist", { name: "Sections" });
    // Documents has nothing in it, so it isn't a tab; a count shows the decision that waits.
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Home", "Progress", "Moodboard", "Decisions1", "Payments", "Messages"]);
    expect(tabs).toHaveAttribute("data-layout", "scroll");
    await user.click(within(tabs).getByRole("tab", { name: "Payments" }));
    // One row per payment, overdue first, with its invoice to print and what was received.
    const rows = await screen.findAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Before installation");
    expect(within(rows[0]).getByText("Overdue")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("link", { name: "Invoice \u2068INV-3\u2069" }))
      .toHaveAttribute("href", "/portal/studio/print?case=c1&invoice=11111111-1111-4111-8111-111111111113");
    expect(screen.getByText(/Received .*5,000\.00.* on Sep 21, 2026/).closest("a")).toHaveAttribute("href", "/portal/studio/print?case=c1&receipt=22222222-2222-4222-8222-222222222221");
    expect(screen.queryByText("Invoices")).toBeNull();
    expect(screen.getByRole("link", { name: /Pay/ })).toHaveAttribute("href", "https://pay.example.com/p2");
    await user.click(within(tabs).getByRole("tab", { name: "Progress" }));
    expect(await screen.findByRole("img", { name: /Site photo 1/ })).toHaveAttribute("src", "/api/client-portal/studio/files/photo/p1?preview=1");
  });

  it("hides amounts when the tenant keeps them out, and says so when a project is paused", async () => {
    const hidden = project({ payments: { ...project().payments!, showAmounts: false, milestones: project().payments!.milestones.map((item) => ({ ...item, amount: null, paid: null, left: null,
      receipts: item.receipts.map((receipt) => ({ ...receipt, amount: null })) })) } });
    mount(() => ({ body: view({}, [hidden, project({ id: "c2", title: "Beach house", paused: true })]) }));
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    await user.click(within(await screen.findByRole("tablist", { name: "Sections" })).getByRole("tab", { name: "Payments" }));
    expect(await screen.findByText("Received on Sep 21, 2026")).toBeInTheDocument();
    expect(screen.queryAllByText(/\$5,000\.00/)).toEqual([]);
    await user.click(screen.getByRole("button", { name: /Project/ }));
    await user.click(await screen.findByRole("option", { name: "Beach house" }));
    expect(await screen.findByText("Your project page is paused")).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Sections" })).toBeNull();
  });

  it("signs the material list off item by item with a code bound to that revision", async () => {
    const fetcher = mount((url) => url.endsWith("/challenge") ? { body: { challengeId: "ch9", channel: "whatsapp", expiresIn: 300, resendAfter: 30 } }
      : url.endsWith("/command") ? { body: { ok: true } } : { body: view() });
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    await user.click(await screen.findByRole("button", { name: /Material list to sign off/ }));
    const dialog = await screen.findByRole("dialog", { name: "Material list · R1" });
    expect(within(dialog).getByRole("button", { name: "Continue" })).toBeDisabled();
    await user.click(within(within(dialog).getByRole("radiogroup", { name: "Decision for Oak veneer" })).getByRole("radio", { name: "Approve" }));
    await user.click(within(within(dialog).getByRole("radiogroup", { name: "Decision for Brass handles" })).getByRole("radio", { name: "Change it" }));
    await user.type(within(dialog).getByRole("textbox", { name: /What would you like instead/ }), "Black handles");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(sent(fetcher, "challenge")).toEqual([{ purpose: "materials:c1:r1:submit", channel: "whatsapp" }]));
    await user.type(await within(dialog).findByRole("textbox", { name: /Code/ }), "654321");
    await user.click(within(dialog).getByRole("button", { name: "Send my decision" }));
    await waitFor(() => expect(sent(fetcher, "command")).toEqual([expect.objectContaining({ action: "materials_decision", caseId: "c1", revisionId: "r1", challengeId: "ch9", code: "654321",
      decisions: [{ itemId: "m1", decision: "approved", note: "" }, { itemId: "m2", decision: "rejected", note: "Black handles" }] })]));
    expect(await screen.findByText("Thank you. Your decision was sent to your project team.")).toBeInTheDocument();
  });

  it("carries the tenant's brand colours and fonts through the design tokens, and the footer is theirs", async () => {
    mount(() => ({ status: 401, body: {} }));
    const { container } = render(<PortalApp site={site} />);
    await screen.findByRole("heading", { name: "Welcome home" });
    const root = container.querySelector("[data-portal-root]") as HTMLElement;
    expect(root.style.getPropertyValue("--wd-workspace-action-light-primary")).toMatch(/^#[0-9A-F]{6}$/);
    expect(root.style.getPropertyValue("--wd-workspace-font-heading")).toContain("Alta");
    expect(root.style.getPropertyValue("--wd-workspace-font-body")).toContain("montserrat");
    expect(screen.getByText("Studio Interiors")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /care@studio\.example/ })).toHaveAttribute("href", "mailto:care@studio.example");
    expect(screen.getByText("Powered by Wodana")).toBeInTheDocument();
  });

  it("opens from an invitation link with the client's number ready, and says when the link has expired", async () => {
    const fetcher = mount((url) => (url.endsWith("/view") ? { status: 401, body: {} } : { body: { challengeId: "ch1", channel: "whatsapp", expiresIn: 300, resendAfter: 30 } }));
    const user = userEvent.setup();
    const first = render(<PortalApp site={site} invite={{ status: "valid", name: "Maya", phone: "+12025550123" }} />);
    await user.click(await screen.findByRole("button", { name: "Send code by WhatsApp" }));
    await waitFor(() => expect(sent(fetcher, "challenge")).toEqual([{ phone: "+12025550123", channel: "whatsapp" }]));
    first.unmount();
    render(<PortalApp site={site} invite={{ status: "expired" }} />);
    expect(await screen.findByText("This invite link has expired. Sign in with your mobile number, or ask your project team for a new one.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Mobile number/ })).toHaveValue("");
  });

  it("reads right to left in Arabic, with user text and names isolated", async () => {
    mount(() => ({ body: view() }));
    const { container } = render(<I18nProvider language="ar"><PortalApp site={site} /></I18nProvider>);
    await screen.findByRole("heading", { name: "Villa 12" });
    expect(container.querySelector("[data-portal-root]")).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("heading", { name: "Villa 12" })).toHaveAttribute("dir", "auto");
    expect(screen.getByText("Cabinets are in the factory.")).toHaveAttribute("dir", "auto");
    expect(screen.getByText(/⁨Omar Manager⁩/)).toBeInTheDocument();
  });

  it("says a finished project is completed (an adjective, not the verb) in Arabic", async () => {
    mount(() => ({ body: view({}, [project({ status: "completed", handoverDate: null, handedOverOn: "2026-09-28", warrantyUntil: "2027-09-27" })]) }));
    render(<I18nProvider language="ar"><PortalApp site={site} /></I18nProvider>);
    expect(await screen.findByText(/^مكتمل/)).toBeInTheDocument();
    expect(screen.queryByText(/إكمال/)).toBeNull();
    expect(screen.getByText(/^تم التسليم في/)).toBeInTheDocument();
  });

  it("names the product's own stages in the client's language and a tenant's own stage as they wrote it", async () => {
    const staged = project({ stage: { number: 2, total: 3, name: "Delivery and installation" }, progress: { ...project().progress!,
      stages: [{ name: "Kickoff", state: "done", startedOn: null, finishedOn: null }, { name: "Delivery and installation", state: "current", startedOn: null, finishedOn: null },
        { name: "Villa blessing", state: "upcoming", startedOn: null, finishedOn: null }] } });
    mount(() => ({ body: view({}, [staged]) }));
    const user = userEvent.setup();
    render(<I18nProvider language="ar"><PortalApp site={site} /></I18nProvider>);
    expect(await screen.findByText(/التوريد والتركيب/)).toBeInTheDocument();
    await user.click(within(screen.getByRole("tablist")).getAllByRole("tab")[1]);
    expect(await screen.findByText("الانطلاق")).toBeInTheDocument();
    expect(screen.getByText("Villa blessing")).toBeInTheDocument();
  });

  it("goes straight to the code step when a code is already on its way, and says so as information", async () => {
    mount((url) => (url.endsWith("/view") ? { status: 401, body: {} }
      : { status: 429, body: { message: "A code is on its way. You can ask for another in a few seconds.", retryAfter: 20 } }));
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    await user.type(await screen.findByRole("textbox", { name: /Mobile number/ }), "2025550123");
    await user.click(screen.getByRole("button", { name: "Send code by WhatsApp" }));
    const notice = await screen.findByText("A code is on its way. You can ask for another in a few seconds.");
    expect(notice.closest("[data-tone]")).toHaveAttribute("data-tone", "info");
  });

  it("says when a finished project was handed over and until when its warranty runs", async () => {
    mount(() => ({ body: view({}, [project({ status: "completed", handoverDate: null, handedOverOn: "2026-09-28", warrantyUntil: "2027-09-27" })]) }));
    render(<PortalApp site={site} />);
    expect(await screen.findByText("Handed over on Sep 28, 2026 · warranty until Sep 27, 2027")).toBeInTheDocument();
    expect(screen.queryByText(/Handover planned/)).toBeNull();
  });

  it("likes a board, comments on an idea and adds the client's own idea with a photo", async () => {
    const fetcher = mount((url) => (url.includes("/uploads/") ? { body: { id: url.split("/").at(-1), name: "sofa.jpg", mimeType: "image/jpeg", hasPreview: true } }
      : url.endsWith("/command") ? { body: { ok: true } } : { body: view() }));
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    await user.click(within(await screen.findByRole("tablist", { name: "Sections" })).getByRole("tab", { name: "Moodboard" }));
    await user.click(await screen.findByRole("button", { name: "I like Kitchen concept" }));
    await waitFor(() => expect(sent(fetcher, "command")).toEqual([expect.objectContaining({ action: "react", caseId: "c1", targetKind: "design", targetId: "b1", reaction: "like" })]));
    // Liked already: pressing it again takes the like back.
    expect(screen.getByRole("button", { name: "I like Warm oak" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Open Warm oak" }));
    const pin = await screen.findByRole("dialog", { name: "Warm oak" });
    expect(within(pin).getByText("Your design team")).toBeInTheDocument();
    await user.type(within(pin).getByRole("textbox", { name: "Comment" }), "Could it be lighter?");
    await user.click(within(pin).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sent(fetcher, "command").at(-1)).toEqual(expect.objectContaining({ action: "board_comment", targetKind: "pin", targetId: "pin1", text: "Could it be lighter?" })));
    await user.click(within(pin).getByRole("button", { name: "Close dialog" }));
    await user.click(await screen.findByRole("button", { name: "Add an idea" }));
    const idea = await screen.findByRole("dialog", { name: "Add an idea" });
    await user.upload(within(idea).getByLabelText("Add photos"), new File(["x"], "sofa.jpg", { type: "image/jpeg" }));
    expect(await within(idea).findByText("Added")).toBeInTheDocument();
    await user.type(within(idea).getByRole("textbox", { name: "What do you like about it?" }), "This sofa");
    await user.click(within(idea).getByRole("button", { name: "Add to moodboard" }));
    await waitFor(() => expect(sent(fetcher, "command").at(-1)).toEqual(expect.objectContaining({ action: "add_inspiration", caseId: "c1", note: "This sofa",
      uploadIds: [expect.stringMatching(/^[0-9a-f-]{36}$/)] })));
    const upload = fetcher.mock.calls.find(([url]) => String(url).includes("/uploads/"))!;
    expect(String(upload[0])).toMatch(/^\/api\/client-portal\/studio\/cases\/c1\/uploads\/[0-9a-f-]{36}$/);
  });

  it("tells the team the client has paid, with the bank reference", async () => {
    const fetcher = mount((url) => (url.endsWith("/command") ? { body: { ok: true } } : { body: view() }));
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    await user.click(within(await screen.findByRole("tablist", { name: "Sections" })).getByRole("tab", { name: "Payments" }));
    const [overdue] = await screen.findAllByRole("listitem");
    await user.click(within(overdue).getByRole("button", { name: "I've paid" }));
    const dialog = await screen.findByRole("dialog", { name: "Before installation" });
    expect(within(dialog).getByRole("button", { name: "Send" })).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox", { name: "Bank reference" }), "TT-4455");
    await user.type(within(dialog).getByRole("textbox", { name: /Amount paid/ }), "2000");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sent(fetcher, "command")).toEqual([expect.objectContaining({ action: "report_payment", caseId: "c1", paymentId: "p3", paidOn: "2026-09-27",
      amount: "2000", reference: "TT-4455", uploadIds: [] })]));
    expect(await screen.findByText("Thank you. We'll check your payment and let you know.")).toBeInTheDocument();
  });

  it("confirms site access for a delivery day, or asks to move it with why (D-29)", async () => {
    const delivery = { id: "sa1", date: "2026-10-03", items: "Oak veneer, Brass handles", status: "waiting" as const, clientReason: null, clientDate: null, movedFrom: null, moveReason: null,
      chargeable: false, version: 1 };
    const waiting = project({ next: [{ kind: "site_access", id: "sa1", title: delivery.items, due: delivery.date }], progress: { ...project().progress!, siteAccess: [delivery] } });
    const fetcher = mount((url) => (url.endsWith("/command") ? { body: { ok: true } } : { body: view({}, [waiting]) }));
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    await user.click(await screen.findByRole("button", { name: /Confirm site access for Oct 3, 2026/ }));
    let dialog = await screen.findByRole("dialog", { name: "Confirm site access for Oct 3, 2026" });
    expect(within(dialog).getByText("Oak veneer, Brass handles")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(sent(fetcher, "command")).toEqual([expect.objectContaining({ action: "site_access", caseId: "c1", requestId: "sa1", decision: "confirm", version: 1 })]));
    expect(await screen.findByText("Thank you. Your project team knows someone will let them in.")).toBeInTheDocument();

    // Or the day doesn't work: they say why before sending.
    await user.click(screen.getByRole("button", { name: /Confirm site access for Oct 3, 2026/ }));
    dialog = await screen.findByRole("dialog", { name: "Confirm site access for Oct 3, 2026" });
    await user.click(within(dialog).getByRole("button", { name: "Ask to move" }));
    expect(within(dialog).getByRole("button", { name: "Send" })).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox", { name: /Why doesn't the day work/ }), "We travel that week");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sent(fetcher, "command").at(-1)).toEqual(expect.objectContaining({ action: "site_access", decision: "move", reason: "We travel that week", preferredDate: null })));
  });

  it("shows the team's days as cards under the stage and progress, with photos full size, a reaction and a question", async () => {
    const card = { id: "d1", date: "2026-09-26", sentAt: "2026-09-26T15:00:00.000Z", summary: "The kitchen carcasses are in and level.", noWork: false,
      hero: { id: "ph1", area: "Kitchen", phase: "after" as const, pairId: "ph0" }, photos: [{ id: "ph0", area: "Kitchen", phase: "before" as const, pairId: "ph1" }],
      completed: ["Fit kitchen carcasses"], advanced: [{ title: "Tile the family room", progress: 50 }], next: ["Template the worktop"], notes: ["Handles arrive Thursday"],
      reactions: { like: 0, love: 1 }, mine: { like: false, love: false } };
    const daily = project({ progress: { ...project().progress!, percent: 42, cards: [card], weeks: [{ id: "w1", weekEnding: "2026-09-25", digest: "This week on Villa 12: 3 days of progress." }] } });
    const fetcher = mount((url) => (url.endsWith("/command") ? { body: { ok: true } } : { body: view({}, [daily]) }));
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    await user.click(within(await screen.findByRole("tablist", { name: "Sections" })).getByRole("tab", { name: "Progress" }));
    expect(await screen.findByText("42% complete")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "How far the project is" })).toHaveAttribute("aria-valuenow", "42");
    const day = screen.getByRole("article", { name: "Progress on Sep 26, 2026" });
    expect(within(day).getByText("The kitchen carcasses are in and level.")).toBeInTheDocument();
    expect(within(day).getByText("Fit kitchen carcasses")).toBeInTheDocument();
    expect(within(day).getByText("Template the worktop")).toBeInTheDocument();
    expect(within(day).getByText("Handles arrive Thursday")).toBeInTheDocument();
    expect(screen.getByText("This week on Villa 12: 3 days of progress.")).toBeInTheDocument();
    // The photos open full size, one after another.
    await user.click(within(day).getByRole("button", { name: "Open photo 1" }));
    const lightbox = await screen.findByRole("dialog", { name: "Sep 26, 2026" });
    expect(within(lightbox).getByRole("img", { name: "Kitchen · After" })).toHaveAttribute("src", "/api/client-portal/studio/files/photo/ph1");
    await user.click(within(lightbox).getByRole("button", { name: "Next photo" }));
    expect(within(lightbox).getByRole("img", { name: "Kitchen · Before" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(within(day).getByRole("button", { name: "Like (0)" }));
    await waitFor(() => expect(sent(fetcher, "command")).toEqual([expect.objectContaining({ action: "progress_react", caseId: "c1", reportId: "d1", reaction: "like", on: true })]));
    await user.click(within(day).getByRole("button", { name: "Ask a question" }));
    const dialog = await screen.findByRole("dialog", { name: "Ask about Sep 26, 2026" });
    await user.type(within(dialog).getByRole("textbox", { name: /Your question/ }), "Is the worktop sealed?");
    await user.click(within(dialog).getByRole("button", { name: "Send question" }));
    await waitFor(() => expect(sent(fetcher, "command").at(-1)).toEqual(expect.objectContaining({ action: "progress_question", caseId: "c1", reportId: "d1", text: "Is the worktop sealed?" })));
    expect(await screen.findByText("Thank you. Your project manager will answer under Messages.")).toBeInTheDocument();
  });

  it("reports an issue while the work is on and shows what the team decided", async () => {
    const reported = project({ progress: { ...project().progress!, issues: [{ id: "is1", number: 1, raisedOn: "2026-09-26", description: "Chipped panel", area: "Kitchen",
      status: "declined", reason: "That's the sample, not your panel.", files: [{ id: "f1", name: "chip.jpg", mimeType: "image/jpeg", hasPreview: true }] }] } });
    const fetcher = mount((url) => (url.endsWith("/command") ? { body: { ok: true } } : { body: view({}, [reported]) }));
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    await user.click(within(await screen.findByRole("tablist", { name: "Sections" })).getByRole("tab", { name: "Progress" }));
    expect(await screen.findByText("Chipped panel")).toBeInTheDocument();
    expect(screen.getByText("Not taken up")).toBeInTheDocument();
    expect(screen.getByText("That's the sample, not your panel.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Photo: chip.jpg" })).toHaveAttribute("src", "/api/client-portal/studio/files/asset/f1?preview=1");
    await user.click(screen.getByRole("button", { name: "Report an issue" }));
    const dialog = await screen.findByRole("dialog", { name: "Report an issue" });
    await user.type(within(dialog).getByRole("textbox", { name: /What's wrong/ }), "Scratch on the worktop");
    await user.click(within(dialog).getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(sent(fetcher, "command")).toEqual([expect.objectContaining({ action: "report_issue", caseId: "c1", description: "Scratch on the worktop", uploadIds: [] })]));
  });

  it("counts unread replies, marks them read when the thread opens, and shows the team has seen the client's message", async () => {
    const thread = { id: "t1", number: 1, title: "Reading light", detail: "Can we add one?", status: "open", createdAt: "2026-09-20T09:00:00.000Z", resolution: "",
      files: [{ id: "f2", name: "plan.pdf", mimeType: "application/pdf", hasPreview: false }], lastAt: "2026-09-22T09:00:00.000Z", seenByTeam: false, unread: 1,
      comments: [{ id: "c9", at: "2026-09-22T09:00:00.000Z", text: "Yes, we'll add it.", fromClient: false, files: [] }] };
    const fetcher = mount((url) => (url.endsWith("/command") ? { body: { ok: true } }
      : { body: view({}, [project({ unread: 1, messages: { requests: [thread], unread: 1 } })]) }));
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    const tabs = await screen.findByRole("tablist", { name: "Sections" });
    expect(within(tabs).getByRole("tab", { name: /Messages/ })).toHaveTextContent("Messages1");
    expect(screen.getByRole("button", { name: /New reply from your team/ })).toBeInTheDocument();
    await user.click(within(tabs).getByRole("tab", { name: /Messages/ }));
    await user.click(await screen.findByRole("button", { name: /Reading light/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reading light" });
    expect(within(dialog).getByRole("link", { name: /plan\.pdf/ })).toHaveAttribute("href", "/api/client-portal/studio/files/asset/f2");
    await waitFor(() => expect(sent(fetcher, "command")).toEqual([expect.objectContaining({ action: "read_thread", caseId: "c1", requestId: "t1" })]));
    expect(within(dialog).queryByText("Seen by your project team")).toBeNull();
  });
});
