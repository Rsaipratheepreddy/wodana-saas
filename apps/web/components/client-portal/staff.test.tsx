import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PortalContact, PortalSettings, PortalSite, ProjectPortal } from "@/lib/client-portal/types";
import { ProjectPortalControl } from "./project-portal-control";
import { PortalSettingsPage } from "./settings/portal-settings-page";

const W = "4f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const P = "5f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const C = "6f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const site: PortalSite = {
  slug: "studio", brand: { name: "Studio Interiors", logoUrl: null, primaryColor: "#0F5C4A", secondaryColor: null, headingFont: null, bodyFont: null }, welcomeTitle: "", welcomeText: "",
  support: { phone: "", email: "", whatsapp: "" }, region: { locale: "en-US", currency: "USD", timeZone: "UTC", country: "US" }, signIn: { channels: ["email"], demo: false }, gallerySlug: null,
};
const settings: PortalSettings = {
  workspaceId: W, slug: "studio", enabled: false, version: 3, sections: { progress: true, decisions: true, payments: true, documents: true, warranty: true, messages: true },
  progress: { stageNames: true, dates: true, updates: true, photos: true }, invoiceAmounts: true, welcomeTitle: "Welcome home", welcomeText: "", support: { phone: "", email: "", whatsapp: "" },
};
const contact: PortalContact = { id: "7f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d", name: "Maya", confirmedName: null, phone: "+12025550123", email: "maya@example.com", role: "approver", active: true,
  testContact: false, lastSignedInAt: "2026-09-26T09:00:00.000Z", version: 2, signedIn: true };

function mount(respond: (url: string, method: string, body: Record<string, unknown> | null) => unknown) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    return { ok: true, status: 200, json: async () => respond(String(url), init?.method ?? "GET", body) };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const writes = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method && init.method !== "GET")
  .map(([url, init]) => ({ url: String(url), method: init!.method, body: JSON.parse(String(init!.body)) }));

describe("client portal settings", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("turns the portal on, chooses what clients see and saves it version-checked, with a preview in the real brand", async () => {
    const fetcher = mount((_url, method, body) => ({ settings: method === "PUT" ? { ...settings, ...body, version: 4 } : settings, site, canManage: true, demo: false }));
    const user = userEvent.setup();
    render(<DesignSystemProvider><PortalSettingsPage workspaceId={W} /></DesignSystemProvider>);
    await user.click(await screen.findByRole("switch", { name: "Clients can sign in" }));
    const sections = screen.getByRole("region", { name: "What clients see" });
    await user.click(within(sections).getByRole("switch", { name: "Payments" }));
    await user.click(screen.getByRole("switch", { name: "Stage names" }));
    await user.type(screen.getByRole("textbox", { name: /Email/ }), "care@studio.example");
    expect(screen.getByText("Welcome home", { selector: "p" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(fetcher)).toEqual([{ url: `/api/client-portal-admin/settings?workspaceId=${W}`, method: "PUT", body: expect.objectContaining({
      version: 3, enabled: true, sections: expect.objectContaining({ payments: false, decisions: true }), progress: expect.objectContaining({ stageNames: false }),
      support: { phone: "", email: "care@studio.example", whatsapp: "" } }) }]));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("narrows or pauses one project's portal and lists who can sign in", async () => {
    const portal: ProjectPortal = { enabled: true, sections: ["progress", "decisions", "payments"], access: { sections: null, paused: false, pausedAt: null, version: 0 },
      contacts: [contact], caseId: C, canManage: true };
    const fetcher = mount((url, method, body) => (url.includes("/contacts") ? { contacts: [contact], canManage: true, demo: false }
      : method === "PUT" ? { ...portal, access: { sections: body?.sections ?? null, paused: body?.paused === true, pausedAt: null, version: 1 } } : portal));
    const user = userEvent.setup();
    render(<DesignSystemProvider><ProjectPortalControl workspaceId={W} projectId={P} /></DesignSystemProvider>);
    expect(await screen.findByText("Progress, Decisions, Payments · 1 contacts")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Client portal" });
    await user.click(within(dialog).getByRole("checkbox", { name: "Payments" }));
    expect(await within(dialog).findByText("Maya")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(fetcher).at(-1)).toEqual({ url: `/api/client-portal-admin/projects/${P}?workspaceId=${W}`, method: "PUT",
      body: { version: 0, sections: ["progress", "decisions"], paused: false } }));
  });
});
