import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortalProject, PortalSite, PortalView } from "@/lib/client-portal/types";
import { ClientView } from "./client-view";

const W = "4f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const C = "6f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const site: PortalSite = {
  slug: "studio", brand: { name: "Studio Interiors", logoUrl: null, primaryColor: "#0F5C4A", secondaryColor: null, headingFont: null, bodyFont: null },
  welcomeTitle: "", welcomeText: "", support: { phone: "", email: "", whatsapp: "" },
  region: { locale: "en-US", currency: "USD", timeZone: "UTC", country: "US" }, signIn: { channels: ["email"], demo: false }, gallerySlug: null,
};
const project: PortalProject = {
  id: C, title: "Villa 12", reference: "PRJ-0042", role: "approver", status: "active", paused: false,
  sections: { progress: false, decisions: true, payments: false, documents: false, warranty: false, messages: false },
  manager: "Omar Manager", stage: { number: 2, total: 5, name: "Production" }, handoverDate: null,
  next: [{ kind: "materials", id: "r1", title: "R1", due: null }], latestUpdate: null, progress: null,
  decisions: { quotes: [], designs: [], requests: [], definition: null, handovers: [],
    materials: { id: "r1", number: 1, status: "sent", sentAt: "2026-09-24T09:00:00.000Z", decidedAt: null, decidedBy: null, canDecide: true,
      items: [{ id: "m1", name: "Oak veneer", specification: "Crown cut", quantity: "12.0000", unit: "m²", areas: ["Kitchen"], decision: null, note: "" }] } },
  payments: null, documents: null, warranty: null, messages: null,
};
const view: PortalView = { contact: { name: "Maya Client", nameConfirmed: true, phone: "" }, today: "2026-09-27", projects: [project] };

describe("client view", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows the case's portal exactly as the client sees it, and leaves every decision to the client", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      return { ok: true, status: 200, json: async () => ({ site, view, preview: true }) };
    }));
    const user = userEvent.setup();
    render(<ClientView workspaceId={W} caseId={C} />);
    expect(await screen.findByRole("heading", { name: "Villa 12" })).toBeInTheDocument();
    expect(screen.getByText("Client view")).toBeInTheDocument();
    expect(screen.getByText("Maya Client")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Close client view" })).toHaveAttribute("href", `/workspace/pre-projects/cases/${C}/overview`);
    expect(calls).toEqual([{ url: `/api/client-portal-admin/cases/${C}/preview?workspaceId=${W}`, method: "GET" }]);
    // The client's own decision, as they would take it: it stops at the code, which only the client can get.
    await user.click(screen.getByRole("button", { name: /Material list to sign off/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Approve" }));
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByText("This is a preview. Only the client can decide here.")).toBeInTheDocument();
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });
});
