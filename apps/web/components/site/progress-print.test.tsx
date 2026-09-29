import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { portalDayPrint, portalWeekPrint } from "@/lib/client-portal/progress-print";
import type { PortalSite, PortalView } from "@/lib/client-portal/types";
import type { ClientView } from "@/lib/site/types";
import { PortalProgressPrint } from "../client-portal/portal-progress-print";
import { DailyReportPrint } from "./progress-print";

const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
const RID = "5b2d1c7e-1c4d-4a9e-9d64-3b6f0f2d7a22";
// What a report holds that is only the team's: none of it may be printed.
const INTERNAL = { notesForTeam: "INTERNAL-NOTE crew lead left early", workforce: [{ trade: "INTERNAL-CREW Carpenters", people: 4 }], cost: "INTERNAL-COST 4200",
  issues: [{ description: "INTERNAL-BLOCKER cracked slab", internal: true }], authorName: "INTERNAL-PERSON Dana Karim" };

const view = {
  reportId: RID, date: "2026-09-25",
  project: { name: "Villa 12", reference: "PRJ-7", stage: "Production", stageNumber: 3, stageCount: 6, progress: 42, handoverDate: "2026-11-01", daysToHandover: 37 },
  brand: { name: "Studio Interiors", logoUrl: null, accentColor: null }, summary: "The kitchen carcasses are in.", noWork: false,
  hero: { id: "ph1", area: "Kitchen", phase: "after", pairId: "ph0" },
  photos: [{ id: "ph2", area: "Living room", phase: null, pairId: null }, { id: "ph0", area: "Kitchen", phase: "before", pairId: "ph1" }],
  completed: ["Fit kitchen carcasses"], advanced: [{ title: "Tile the family room", progress: 50 }], next: ["Template the worktop"], notes: ["Handles arrive Thursday"],
  ...INTERNAL,
} as unknown as ClientView;

const site: PortalSite = {
  slug: "studio", brand: { name: "Studio Interiors", logoUrl: null, primaryColor: null, secondaryColor: null, headingFont: null, bodyFont: null },
  welcomeTitle: "", welcomeText: "", support: { phone: "", email: "", whatsapp: "" },
  region: { locale: "en-US", currency: "USD", timeZone: "UTC", country: "US" }, signIn: { channels: ["email"], demo: false }, gallerySlug: null,
};
const portal = {
  contact: { name: "Maya", nameConfirmed: true, phone: "+15550100001" }, today: "2026-09-27",
  projects: [{ id: "c1", title: "Villa 12", reference: "PRJ-7", progress: {
    cards: [{ id: RID, date: "2026-09-25", sentAt: "2026-09-25T15:00:00.000Z", summary: "The kitchen carcasses are in.", noWork: false,
      hero: { id: "ph1", area: "Kitchen", phase: "after", pairId: null }, photos: [], completed: ["Fit kitchen carcasses"], advanced: [], next: ["Template the worktop"], notes: [],
      reactions: { like: 1, love: 0 }, mine: { like: true, love: false }, stage: { number: 3, total: 6, name: "Production" }, percent: 42, ...INTERNAL }],
    weeks: [{ id: "6c3e2d8f-2d5e-4b0f-8e75-4c7f1f3e8b33", weekEnding: "2026-09-26", digest: "This week on Villa 12: 3 days of progress." }] } }],
} as unknown as PortalView;

const printed = () => screen.getByRole("article");
const noInternal = () => { for (const secret of ["INTERNAL", "Dana Karim", "4200", "cracked"]) expect(printed().textContent, secret).not.toContain(secret); };

describe("a day's progress on A4", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prints the team's day as the client's card: brand, project, stage, words, lists and photos by room, three to a row", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ view, sent: true }) })));
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<DesignSystemProvider timeZone="UTC"><DailyReportPrint workspaceId="w" projectId={PID} reportId={RID} /></DesignSystemProvider>);
    const document = await screen.findByRole("article", { name: "Progress on Sep 25, 2026" });
    expect(within(document).getByRole("heading", { level: 1, name: "Daily progress" })).toBeInTheDocument();
    expect(within(document).getByText("Studio Interiors")).toBeInTheDocument();
    expect(within(document).getByText("PRJ-7 · Villa 12")).toBeInTheDocument();
    // The tab (and a saved PDF) is named after the document, not the product (m15).
    expect(globalThis.document.title).toBe("Progress on Sep 25, 2026 · PRJ-7 · Studio Interiors");
    expect(within(document).getByText("Stage 3 of 6 · Production")).toBeInTheDocument();
    expect(within(document).getByText("42% complete")).toBeInTheDocument();
    expect(within(document).getByText("The kitchen carcasses are in.")).toBeInTheDocument();
    expect(within(within(document).getByRole("region", { name: "Completed today" })).getByText("Fit kitchen carcasses")).toBeInTheDocument();
    expect(within(document).getByText("Tile the family room: 50%")).toBeInTheDocument();
    expect(within(within(document).getByRole("region", { name: "Next up" })).getByText("Template the worktop")).toBeInTheDocument();
    expect(within(document).getByText("Handles arrive Thursday")).toBeInTheDocument();
    // Photos by room, a before ahead of its after, full size through the team's photo route.
    const photos = within(document).getByRole("region", { name: "Photos" });
    expect(within(photos).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Kitchen", "Living room"]);
    expect(within(photos).getAllByRole("img").map((image) => image.getAttribute("alt"))).toEqual(["Kitchen · Before", "Kitchen · After", "Living room"]);
    expect(within(photos).getByRole("img", { name: "Kitchen · After" })).toHaveAttribute("src", `/api/site/projects/${PID}/photos/ph1?workspaceId=w`);
    noInternal();
    await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("prints the client's day from their own portal view only, with photos through their session", () => {
    const data = portalDayPrint(portal, site, RID)!;
    // Built field by field: nothing the card carries beyond the client's card reaches the page.
    expect(Object.keys(data).sort()).toEqual(["advanced", "brand", "completed", "date", "next", "noWork", "notes", "percent", "photos", "project", "stage", "summary"]);
    expect(JSON.stringify(data)).not.toMatch(/INTERNAL|Dana Karim|reactions/);
    render(<DesignSystemProvider timeZone="UTC"><PortalProgressPrint site={site} kind="day" data={data} /></DesignSystemProvider>);
    expect(within(printed()).getByText("Stage 3 of 6 · Production")).toBeInTheDocument();
    expect(within(printed()).getByRole("img", { name: "Kitchen · After" })).toHaveAttribute("src", "/api/client-portal/studio/files/photo/ph1");
    noInternal();
    expect(portalDayPrint(portal, site, "11111111-1111-4111-8111-111111111111")).toBeNull();
  });

  it("prints the client's week from its roll-up", () => {
    const data = portalWeekPrint(portal, site, "6c3e2d8f-2d5e-4b0f-8e75-4c7f1f3e8b33")!;
    render(<DesignSystemProvider timeZone="UTC"><PortalProgressPrint site={site} kind="week" data={data} /></DesignSystemProvider>);
    expect(within(printed()).getByRole("heading", { level: 1, name: "Weekly progress" })).toBeInTheDocument();
    expect(within(printed()).getByText("Week ending Sep 26, 2026")).toBeInTheDocument();
    expect(within(printed()).getByText("This week on Villa 12: 3 days of progress.")).toBeInTheDocument();
    expect(within(printed()).queryByRole("region", { name: "Photos" })).not.toBeInTheDocument();
  });
});
