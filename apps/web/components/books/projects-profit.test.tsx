import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { ProjectsProfit, type ProjectsProfitRow, type ProjectsProfitState } from "./projects-profit";

const P12 = "11111111-1111-4111-8111-111111111112";
const P14 = "11111111-1111-4111-8111-111111111114";
const MAIN = "22222222-2222-4222-8222-222222222222";
const TRADING = "22222222-2222-4222-8222-333333333333";
const costs = (patch: Partial<ProjectsProfitRow["costs"]> = {}) => ({ materials: "0.0000", subcontract: "0.0000", labour: "0.0000", siteExpenses: "0.0000", priceVariance: "0.0000",
  other: "0.0000", cogs: "0.0000", ...patch });
const row = (patch: Partial<ProjectsProfitRow>): ProjectsProfitRow => ({
  projectId: P12, reference: "PRJ-0012", name: "Villa 12", clientName: "Maya Client", status: "active", revenue: "90000.0000",
  costs: costs({ materials: "15000.0000", subcontract: "20000.0000", labour: "8000.0000" }), totalCost: "43000.0000", profit: "47000.0000", marginPercent: "52.22",
  quotedValue: "100000.0000", quoteCurrency: "AED", quotedCost: "70000.0000", quotedMarginPercent: "30.00", marginVsQuote: "22.22", committed: "1000.0000", committedCurrency: "AED",
  links: { project: `/workspace/projects/${P12}/money`, journals: `/workspace/ledger/journals?project=${P12}` }, ...patch,
});
const state = (patch: Partial<Extract<ProjectsProfitState, { enabled: true }>> = {}): ProjectsProfitState => ({
  enabled: true, companies: [{ id: MAIN, name: "Studio Interiors LLC" }], company: { id: MAIN, name: "Studio Interiors LLC" }, currency: "AED", from: null, to: "2026-10-08",
  marginHidden: false,
  rows: [row({}), row({ projectId: P14, reference: "PRJ-0014", name: "Villa 14", clientName: "Omar", revenue: "20000.0000", costs: costs({ materials: "25000.0000" }), totalCost: "25000.0000",
    profit: "-5000.0000", marginPercent: "-25.00", quotedMarginPercent: "25.00", marginVsQuote: "-50.00", committed: "0.0000",
    links: { project: `/workspace/projects/${P14}/money`, journals: `/workspace/ledger/journals?project=${P14}` } })],
  ...patch,
});
const mount = (respond: (url: string) => unknown) => {
  const fetcher = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => respond(url) }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const grid = () => screen.findByRole("grid", { name: "Projects profit" }).catch(() => screen.findByRole("table", { name: "Projects profit" }));
const header = (table: HTMLElement, column: string) => table.querySelector<HTMLElement>(`th[data-column="${column}"]`);
const sortBy = (table: HTMLElement, column: string) => userEvent.click(header(table, column)!.querySelector<HTMLElement>(".wd-sort-button")!);
const names = (table: HTMLElement) => within(table).getAllByRole("link").filter((link) => link.getAttribute("href")?.endsWith("/money")).map((link) => link.textContent);

describe("Projects profit", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows each project's revenue, costs by type, profit, margin against the quote and committed spend, opening the project and its journals", async () => {
    const fetcher = mount(() => state());
    render(<DesignSystemProvider locale="en" timeZone="UTC"><ProjectsProfit workspaceId="w" from="2026-10-01" to="2026-10-31" /></DesignSystemProvider>);
    const table = await grid();
    expect(String(fetcher.mock.calls[0][0])).toBe("/api/books/projects/profit?workspaceId=w&from=2026-10-01&to=2026-10-31");
    const villa12 = within(table).getByRole("link", { name: "Villa 12" }).closest("tr")!;
    expect(villa12).toHaveTextContent(/PRJ-0012 · Maya Client/);
    expect(villa12).toHaveTextContent(/90,000\.00.*15,000\.00.*20,000\.00.*8,000\.00.*43,000\.00.*47,000\.00.*52\.22%.*\+22\.22 pts.*1,000\.00/);
    expect(within(villa12).getByRole("link", { name: "Villa 12" })).toHaveAttribute("href", `/workspace/projects/${P12}/money`);
    expect(within(villa12).getByRole("link", { name: "Journals for Villa 12" })).toHaveAttribute("href", `/workspace/ledger/journals?project=${P12}`);
    const villa14 = within(table).getByRole("link", { name: "Villa 14" }).closest("tr")!;
    expect(villa14).toHaveTextContent(/-25%.*-50 pts/);
  });

  it("sorts by any figure and filters by name", async () => {
    mount(() => state());
    render(<DesignSystemProvider locale="en" timeZone="UTC"><ProjectsProfit workspaceId="w" /></DesignSystemProvider>);
    const table = await grid();
    expect(names(table)).toEqual(["Villa 12", "Villa 14"]);
    await sortBy(table, "profit");
    const sorted = header(table, "profit")!.getAttribute("aria-sort");
    expect(sorted).toMatch(/ascending|descending/);
    expect(names(table)).toEqual(sorted === "ascending" ? ["Villa 14", "Villa 12"] : ["Villa 12", "Villa 14"]);
    await sortBy(table, "profit");
    expect(names(table)).toEqual(sorted === "ascending" ? ["Villa 12", "Villa 14"] : ["Villa 14", "Villa 12"]);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search projects" }), "omar");
    expect(names(await grid())).toEqual(["Villa 14"]);
  });

  it("leaves out profit and margin for people who only see their projects' costs", async () => {
    mount(() => state({ marginHidden: true, rows: [row({ profit: null, marginPercent: null, quotedCost: null, quotedMarginPercent: null, marginVsQuote: null })] }));
    render(<DesignSystemProvider locale="en" timeZone="UTC"><ProjectsProfit workspaceId="w" /></DesignSystemProvider>);
    const table = await grid();
    expect(header(table, "totalCost")).toHaveTextContent("Total cost");
    expect(within(table).getByRole("link", { name: "Villa 12" }).closest("tr")).toHaveTextContent(/43,000\.00/);
    for (const column of ["profit", "margin", "vsQuote"]) expect(header(table, column)).toBeNull();
  });

  it("switches company when the firm keeps more than one set of books", async () => {
    const fetcher = mount((url) => state(url.includes(TRADING) ? { company: { id: TRADING, name: "Studio Trading LLC" }, rows: [] } : {
      companies: [{ id: MAIN, name: "Studio Interiors LLC" }, { id: TRADING, name: "Studio Trading LLC" }] }));
    render(<DesignSystemProvider locale="en" timeZone="UTC"><ProjectsProfit workspaceId="w" /></DesignSystemProvider>);
    await grid();
    await userEvent.click(screen.getByRole("button", { name: /Studio Interiors LLC/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Studio Trading LLC" }));
    expect(await screen.findByText("No project has revenue or costs in the Ledger for this period")).toBeInTheDocument();
    expect(String(fetcher.mock.calls.at(-1)![0])).toContain(`entity=${TRADING}`);
  });

  it("points to the Ledger's setup when it isn't on, and offers a retry when the read fails", async () => {
    mount(() => ({ enabled: false, companies: [], rows: [] }));
    const { unmount } = render(<DesignSystemProvider locale="en" timeZone="UTC"><ProjectsProfit workspaceId="w" /></DesignSystemProvider>);
    expect(await screen.findByText("The Ledger isn't on yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up the Ledger" })).toHaveAttribute("href", "/workspace/settings/ledger");
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ message: "Any permission required" }) })));
    render(<DesignSystemProvider locale="en" timeZone="UTC"><ProjectsProfit workspaceId="w" /></DesignSystemProvider>);
    expect(await screen.findByText("Any permission required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry|Try again/ })).toBeInTheDocument();
  });
});
