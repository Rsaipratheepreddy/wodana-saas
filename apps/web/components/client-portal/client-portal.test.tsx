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
  sections: { progress: true, decisions: true, payments: true, documents: true, warranty: false, messages: true },
  manager: "Omar Manager", stage: { number: 2, total: 5, name: "Production" }, handoverDate: "2026-12-01",
  next: [{ kind: "materials", id: "r1", title: "R1", due: null }],
  latestUpdate: { id: "u1", at: "2026-09-25T09:00:00.000Z", text: "Cabinets are in the factory." },
  progress: { stages: [{ name: "Design", state: "done", startedOn: "2026-09-01", finishedOn: "2026-09-10" }, { name: "Production", state: "current", startedOn: "2026-09-11", finishedOn: null },
    { name: "Installation", state: "upcoming", startedOn: null, finishedOn: null }], updates: [{ id: "u1", at: "2026-09-25T09:00:00.000Z", text: "Cabinets are in the factory." }],
    photoDays: [{ on: "2026-09-25", photos: [{ id: "p1" }] }] },
  decisions: { quotes: [], designs: [], requests: [], definition: null, handovers: [],
    materials: { id: "r1", number: 1, status: "sent", sentAt: "2026-09-24T09:00:00.000Z", decidedAt: null, decidedBy: null, canDecide: true,
      items: [{ id: "m1", name: "Oak veneer", specification: "Crown cut", quantity: "12.0000", unit: "m²", areas: ["Kitchen"], decision: null, note: "" },
        { id: "m2", name: "Brass handles", specification: "", quantity: null, unit: "", areas: [], decision: null, note: "" }] } },
  payments: { currency: "USD", showAmounts: true, schedule: [
    { id: "p1", title: "Advance", amount: "5000.0000", paid: "5000.0000", dueDate: null, status: "paid", invoiceNumber: "INV-1", payUrl: null },
    { id: "p2", title: "Before production", amount: "5000.0000", paid: "0.0000", dueDate: "2026-10-01", status: "upcoming", invoiceNumber: null, payUrl: "https://pay.example.com/p2" }],
    invoices: [{ id: "i1", number: "INV-1", milestone: "Advance", issueDate: "2026-09-20", dueDate: "2026-09-27", currency: "USD", total: "5000.0000", paid: "5000.0000", balance: "0.0000",
      status: "paid", receipts: [{ amount: "5000.0000", receivedOn: "2026-09-21" }] }] },
  documents: [], warranty: null, messages: { requests: [] },
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
    expect(await screen.findByText("Stage 2 of 5 · Production")).toBeInTheDocument();
    expect(screen.getByText("Cabinets are in the factory.")).toBeInTheDocument();
    expect(screen.getByText("Your project manager: Omar Manager")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Material list to sign off/ })).toBeInTheDocument();
    const tabs = screen.getByRole("tablist", { name: "Sections" });
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Home", "Progress", "Decisions", "Payments", "Documents", "Messages"]);
    await user.click(within(tabs).getByRole("tab", { name: "Payments" }));
    expect(await screen.findByText("INV-1 · Advance")).toBeInTheDocument();
    expect(screen.getAllByText("$5,000.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Pay/ })).toHaveAttribute("href", "https://pay.example.com/p2");
    await user.click(within(tabs).getByRole("tab", { name: "Progress" }));
    expect(await screen.findByRole("img", { name: /Site photo 1/ })).toHaveAttribute("src", "/api/client-portal/studio/files/photo/p1?preview=1");
  });

  it("hides amounts when the tenant keeps them out, and says so when a project is paused", async () => {
    const hidden = project({ payments: { ...project().payments!, showAmounts: false, schedule: project().payments!.schedule.map((item) => ({ ...item, amount: null, paid: null })),
      invoices: [{ ...project().payments!.invoices[0], total: null, paid: null, balance: null,
      receipts: [{ amount: null, receivedOn: "2026-09-21" }] }] } });
    mount(() => ({ body: view({}, [hidden, project({ id: "c2", title: "Beach house", paused: true })]) }));
    const user = userEvent.setup();
    render(<PortalApp site={site} />);
    await user.click(within(await screen.findByRole("tablist", { name: "Sections" })).getByRole("tab", { name: "Payments" }));
    expect(await screen.findByText("Received on Sep 21, 2026")).toBeInTheDocument();
    expect(screen.queryAllByText("$5,000.00")).toEqual([]);
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

  it("reads right to left in Arabic", async () => {
    mount(() => ({ body: view() }));
    const { container } = render(<I18nProvider language="ar"><PortalApp site={site} /></I18nProvider>);
    await screen.findByRole("heading", { name: "Villa 12" });
    expect(container.querySelector("[data-portal-root]")).toHaveAttribute("dir", "rtl");
  });
});
