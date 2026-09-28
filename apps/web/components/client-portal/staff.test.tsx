import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ClientAccess, PortalContact, PortalSettings, PortalSite, ProjectPortal } from "@/lib/client-portal/types";
import { ProjectPortalControl } from "./project-portal-control";
import { PortalSettingsPage } from "./settings/portal-settings-page";

const W = "4f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const P = "5f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const C = "6f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const G = "7f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const PARTY = "8f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const PORTAL_URL = "https://app.example.com/portal/studio";
const site: PortalSite = {
  slug: "studio", brand: { name: "Studio Interiors", logoUrl: null, primaryColor: "#0F5C4A", secondaryColor: null, headingFont: null, bodyFont: null }, welcomeTitle: "", welcomeText: "",
  support: { phone: "", email: "", whatsapp: "" }, region: { locale: "en-US", currency: "USD", timeZone: "UTC", country: "US" }, signIn: { channels: ["email"], demo: false }, gallerySlug: null,
};
const settings: PortalSettings = {
  workspaceId: W, slug: "studio", enabled: false, version: 3, sections: { progress: true, decisions: true, payments: true, documents: true, warranty: true, messages: true },
  progress: { stageNames: true, dates: true, updates: true, photos: true }, invoiceAmounts: true, welcomeTitle: "Welcome home", welcomeText: "", support: { phone: "", email: "", whatsapp: "" },
};
const contact: PortalContact = { id: G, name: "Maya", confirmedName: null, phone: "+12025550123", email: "maya@example.com", role: "approver", active: true,
  testContact: false, demoCode: false, lastSignedInAt: "2026-09-26T09:00:00.000Z", version: 2, signedIn: true };
const client = (patch: Partial<ClientAccess> = {}): ClientAccess => ({
  name: "Maya Client", phone: "+12025550123", email: "maya@example.com", grantId: null, partyId: PARTY, status: "not_invited", invitedAt: null, expiresAt: null, delivery: null,
  lastVisitAt: null, version: 0, resendAfter: 0, blocked: null, demoCode: false, ...patch,
});
const portalOf = (patch: Partial<ProjectPortal> = {}): ProjectPortal => ({
  enabled: true, sections: ["progress", "decisions", "payments"], access: { sections: null, paused: false, pausedAt: null, version: 0 }, contacts: [contact], caseId: C, canManage: true,
  canSetDemoCode: false, portalUrl: PORTAL_URL, client: client(), ...patch,
});

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
const contactsReply = { contacts: [contact], canManage: true, demo: false };

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
    const portal = portalOf();
    const fetcher = mount((url, method, body) => (url.includes("/contacts") ? contactsReply
      : method === "PUT" ? { ...portal, access: { sections: body?.sections ?? null, paused: body?.paused === true, pausedAt: null, version: 1 } } : portal));
    const user = userEvent.setup();
    render(<DesignSystemProvider><ProjectPortalControl workspaceId={W} projectId={P} /></DesignSystemProvider>);
    expect(await screen.findByText("Progress, Decisions, Payments · 1 contact")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Client portal" });
    await user.click(within(dialog).getByRole("checkbox", { name: "Payments" }));
    expect(await within(dialog).findByText("Maya")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(fetcher).at(-1)).toEqual({ url: `/api/client-portal-admin/projects/${P}?workspaceId=${W}`, method: "PUT",
      body: { version: 0, sections: ["progress", "decisions"], paused: false } }));
  });
});

describe("inviting the project's client", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("invites the client with one safe command, shows they were invited, then copies the portal link", async () => {
    const invited = portalOf({ client: client({ grantId: G, status: "invited", invitedAt: "2026-09-27T10:00:00.000Z", delivery: "sent", version: 1, resendAfter: 120 }) });
    const fetcher = mount((url, method) => (url.includes("/contacts") ? contactsReply : method === "POST" && url.includes("/invite") ? invited : portalOf()));
    const user = userEvent.setup();
    render(<DesignSystemProvider><ProjectPortalControl workspaceId={W} projectId={P} /></DesignSystemProvider>);
    expect(await screen.findByText("Not invited")).toBeInTheDocument();
    expect(screen.getByText("Maya Client")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Invite client" }));
    await waitFor(() => expect(writes(fetcher)).toEqual([{ url: `/api/client-portal-admin/projects/${P}/invite?workspaceId=${W}`, method: "POST",
      body: { commandId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/), version: 0 } }]));
    expect(await screen.findByText("Invite sent to maya@example.com.")).toBeInTheDocument();
    expect(screen.getByText("Invited")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite client" })).not.toBeInTheDocument();
    // Another invite waits a couple of minutes.
    expect(screen.getByRole("button", { name: "Resend invite" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "More client portal actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Copy portal link" }));
    expect(await screen.findByText("Portal link copied.")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(PORTAL_URL);
  });

  it("says the email didn't leave when delivery is off, so staff copy the link instead", async () => {
    const saved = portalOf({ client: client({ grantId: G, status: "invited", invitedAt: "2026-09-27T10:00:00.000Z", delivery: "suppressed", version: 1, resendAfter: 120 }) });
    mount((url, method) => (url.includes("/contacts") ? contactsReply : method === "POST" ? saved : portalOf()));
    const user = userEvent.setup();
    render(<DesignSystemProvider><ProjectPortalControl workspaceId={W} projectId={P} /></DesignSystemProvider>);
    await user.click(await screen.findByRole("button", { name: "Invite client" }));
    expect(await screen.findByText("The invite was saved but the email didn't go out. Copy the portal link and send it to the client.")).toBeInTheDocument();
    expect(screen.getByText("Email not sent")).toBeInTheDocument();
  });

  it("is blocked until the client has an email, and points at the client record", async () => {
    mount((url) => (url.includes("/contacts") ? contactsReply : portalOf({ client: client({ email: null, blocked: "no_email" }) })));
    render(<DesignSystemProvider><ProjectPortalControl workspaceId={W} projectId={P} /></DesignSystemProvider>);
    expect(await screen.findByText("No email")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add an email to the client" })).toHaveAttribute("href", `/workspace/crm/customers?record=${PARTY}`);
    expect(screen.queryByRole("button", { name: "Invite client" })).not.toBeInTheDocument();
  });

  it("hides the invite while the portal is off or the project is paused", async () => {
    mount((url) => (url.includes("/contacts") ? contactsReply : portalOf({ enabled: false, client: client({ blocked: "portal_off" }) })));
    render(<DesignSystemProvider><ProjectPortalControl workspaceId={W} projectId={P} /></DesignSystemProvider>);
    expect(await screen.findByText("Off for the workspace · 1 contact")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite client" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More client portal actions" })).not.toBeInTheDocument();
  });

  it("shows an active client's last visit and takes their access away after confirming", async () => {
    const active = client({ grantId: G, status: "active", lastVisitAt: "2026-09-27T09:00:00.000Z", version: 3 });
    const revoked = portalOf({ client: client({ grantId: G, status: "revoked", version: 4 }) });
    const fetcher = mount((url, method) => (url.includes("/contacts") ? contactsReply : method === "POST" && url.includes("/revoke") ? revoked : portalOf({ client: active })));
    const user = userEvent.setup();
    render(<DesignSystemProvider locale="en-US" timeZone="UTC"><ProjectPortalControl workspaceId={W} projectId={P} /></DesignSystemProvider>);
    expect(await screen.findByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Last visit Sep 27, 2026")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More client portal actions" }));
    expect(await screen.findByRole("menuitem", { name: "Resend invite" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Revoke access" }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke access for Maya Client?" });
    await user.click(within(dialog).getByRole("button", { name: "Revoke access" }));
    await waitFor(() => expect(writes(fetcher)).toEqual([{ url: `/api/client-portal-admin/projects/${P}/revoke?workspaceId=${W}`, method: "POST",
      body: { commandId: expect.any(String), version: 3 } }]));
    expect(await screen.findByText("Access revoked")).toBeInTheDocument();
    expect(screen.getByText("Maya Client can't sign in any more.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite client" })).toBeInTheDocument();
  });

  it("lets a workspace admin set a demonstration code for the client with one safe command, shows Demo access, then clears it", async () => {
    const invited = client({ grantId: G, status: "invited", invitedAt: "2026-09-27T10:00:00.000Z", delivery: "sent", version: 1 });
    let demo = false;
    const fetcher = mount((url, method, body) => {
      if (url.includes("/demo-code")) { demo = body?.code !== null; return { contacts: [{ ...contact, demoCode: demo }], canManage: true, demo: false }; }
      if (url.includes("/contacts")) return contactsReply;
      return portalOf({ canSetDemoCode: true, client: { ...invited, demoCode: demo, version: demo ? 2 : 1 } });
    });
    const user = userEvent.setup();
    render(<DesignSystemProvider><ProjectPortalControl workspaceId={W} projectId={P} /></DesignSystemProvider>);
    expect(await screen.findByText("Invited")).toBeInTheDocument();
    expect(screen.queryByText("Demo access")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More client portal actions" }));
    expect(screen.queryByRole("menuitem", { name: "Clear demo code" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("menuitem", { name: "Set demo code" }));
    const dialog = await screen.findByRole("dialog", { name: "Set demo code for Maya Client" });
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox", { name: "Demo code" }), "12a3456");
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(writes(fetcher)).toEqual([{ url: `/api/client-portal-admin/cases/${C}/contacts/${G}/demo-code?workspaceId=${W}`, method: "POST",
      body: { commandId: expect.any(String), version: 1, code: "123456" } }]));
    expect(await screen.findByText("Maya Client signs in with the demo code.")).toBeInTheDocument();
    expect(screen.getByText("Demo access")).toBeInTheDocument();
    // Clearing is one action away and version-checked against the contact as it is now.
    await user.click(screen.getByRole("button", { name: "More client portal actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Clear demo code" }));
    await waitFor(() => expect(writes(fetcher).at(-1)).toEqual({ url: `/api/client-portal-admin/cases/${C}/contacts/${G}/demo-code?workspaceId=${W}`, method: "POST",
      body: { commandId: expect.any(String), version: 2, code: null } }));
    expect(await screen.findByText("The demo code was cleared.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Demo access")).not.toBeInTheDocument());
  });

  it("offers no demo code to someone without the portal admin permission", async () => {
    mount((url) => (url.includes("/contacts") ? contactsReply : portalOf({ client: client({ grantId: G, status: "invited", version: 1 }) })));
    const user = userEvent.setup();
    render(<DesignSystemProvider><ProjectPortalControl workspaceId={W} projectId={P} /></DesignSystemProvider>);
    expect(await screen.findByText("Invited")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More client portal actions" }));
    expect(await screen.findByRole("menuitem", { name: "Revoke access" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Set demo code" })).not.toBeInTheDocument();
  });
});
