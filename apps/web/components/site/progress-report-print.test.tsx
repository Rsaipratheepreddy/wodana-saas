import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { DayCard, ProgressReport } from "@/lib/site/types";
import { PeriodReportPrint } from "./progress-print";
import { SiteUpdates } from "./site-updates";
import { SiteTodayCards } from "./site-today-cards";

const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
// What only the team sees: none of it may be printed, even if it reached the page.
const INTERNAL = { crew: [{ trade: "INTERNAL-CREW Carpenters", people: 4 }], issues: [{ description: "INTERNAL-ISSUE socket", internal: true }], cost: "INTERNAL-COST 4200" };
const report = {
  brand: { name: "Studio Interiors", logoUrl: null },
  project: { name: "Villa 12", reference: "PRJ-7", stage: "Carpentry", stageNumber: 3, stageCount: 6, progress: 42, handoverDate: "2026-11-01" },
  from: "2026-10-01", to: "2026-10-12",
  days: [
    { date: "2026-10-05", summary: "The kitchen carcasses are in.", noWork: false, photos: [{ id: "ph1", area: "Kitchen", phase: "after", pairId: null }, { id: "ph2", area: null, phase: null, pairId: null }],
      completed: ["Fit kitchen carcasses"], advanced: [{ title: "Wardrobe doors", progress: 50 }], next: ["Template the worktop"], notes: ["Handles arrive Thursday"], ...INTERNAL },
    { date: "2026-10-06", summary: "", noWork: true, photos: [], completed: [], advanced: [], next: [], notes: [] },
  ],
  ...INTERNAL,
} as unknown as ProgressReport;
const card: DayCard = {
  date: "2026-10-12", status: "submitted", clientVisible: false, people: 3, crew: [{ trade: "Carpenters", people: 3, source: "report" }],
  reports: [{ id: "r1", authorId: "u2", authorName: "Sara Supervisor", status: "submitted", version: 2, submittedAt: "2026-10-12T15:00:00.000Z", decidedAt: null, decidedByName: null, decisionNote: "",
    late: false, backdated: false, delivery: "pending", sentAt: null, hidden: false, noWorkReason: "", notes: "", clientSummary: "", safety: "none", safetyNote: "", forecast: "none", impact: "",
    recoveryOwnerName: null, recoveryOn: null, waitingFor: [], reactions: { like: 0, love: 0 } }],
  work: [{ id: "w1", reportId: "r1", kind: "task", title: "Fit carcasses", workItemId: "t1", number: 4, progress: 100, previous: 50, stageId: null, stageName: null, packageName: null, area: null,
    quantity: null, unit: "", note: "", hidden: false }],
  photos: [], issues: [], materials: [], next: [], stageIds: [], trades: ["Carpenters"],
};
const mount = (respond: (url: string) => unknown) => {
  const fetcher = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => respond(String(url)) }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const show = (node: React.ReactNode) => render(<DesignSystemProvider timeZone="UTC" locale="en-GB">{node}</DesignSystemProvider>);

describe("progress report PDF and the day cards elsewhere", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("prints a cover with the project and period, then one section per day with its photos, and nothing internal", async () => {
    const fetcher = mount(() => report);
    show(<PeriodReportPrint workspaceId="w" projectId={PID} from="2026-10-01" to="2026-10-12" />);
    const sheet = await screen.findByRole("article", { name: "Progress report" });
    expect(fetcher.mock.calls[0][0]).toBe(`/api/site/projects/${PID}/progress-report?workspaceId=w&from=2026-10-01&to=2026-10-12`);
    expect(within(sheet).getByRole("heading", { level: 1, name: "Progress report" })).toBeInTheDocument();
    expect(sheet).toHaveTextContent("PRJ-7 · Villa 12");
    expect(sheet).toHaveTextContent("1 Oct 2026 – 12 Oct 2026");
    expect(sheet).toHaveTextContent("Stage 3 of 6");
    expect(sheet).toHaveTextContent("42% complete");
    const days = within(sheet).getAllByRole("heading", { level: 2 });
    expect(days.map((heading) => heading.textContent)).toEqual(["5 Oct 2026", "6 Oct 2026"]);
    const first = within(sheet).getByRole("region", { name: "5 Oct 2026" });
    expect(within(first).getByText("Fit kitchen carcasses")).toBeInTheDocument();
    expect(within(first).getByText("Wardrobe doors: 50%")).toBeInTheDocument();
    expect(within(first).getAllByRole("img")).toHaveLength(2);
    expect(within(first).getByRole("img", { name: "Kitchen · After" })).toHaveAttribute("src", expect.stringContaining("/photos/ph1"));
    expect(within(sheet).getByRole("region", { name: "6 Oct 2026" })).toHaveTextContent("No work on site this day.");
    expect(sheet.textContent).not.toMatch(/INTERNAL/);
  });

  it("shows the Overview's latest days as compact day cards, each opening its day on the Site tab", async () => {
    mount((url) => (url.includes("/days") ? { from: "2026-10-12", to: "2026-10-12", today: "2026-10-12", cards: [card], missing: [], stages: [], trades: [] } : {}));
    show(<SiteUpdates workspaceId="w" projectId={PID} fallback={<p>Loading lines</p>} />);
    const day = await screen.findByRole("article");
    expect(within(day).getByText("Fit carcasses")).toBeInTheDocument();
    expect(within(day).getByRole("link", { name: "Open" })).toHaveAttribute("href", `/workspace/projects/${PID}/site?day=2026-10-12`);
    expect(screen.queryByText("Loading lines")).not.toBeInTheDocument();
  });

  it("gives the site team today's card on Home, or Add today's report where nobody has reported", async () => {
    mount(() => ({ today: "2026-10-12", hour: 17, dueTime: "18:00", sites: [
      { projectId: PID, reference: "PRJ-7", name: "Villa 12", report: { id: "r1", status: "submitted" }, arriving: 0, snags: 0, card },
      { projectId: "9c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a19", reference: "PRJ-8", name: "Penthouse", report: null, arriving: 0, snags: 0, card: null },
    ] }));
    show(<SiteTodayCards workspaceId="w" />);
    const section = await screen.findByRole("region", { name: "Today on site" });
    expect(within(section).getByRole("article")).toHaveTextContent("Fit carcasses");
    expect(within(section).getByText("No report yet · due by 18:00")).toBeInTheDocument();
    await waitFor(() => expect(within(section).getByRole("link", { name: "Add today's report" })).toHaveAttribute("href",
      "/workspace/projects/9c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a19/site?new=report"));
  });
});
