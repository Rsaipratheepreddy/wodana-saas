import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { Profitability, ProfitabilityRow } from "@/lib/project-core/types";
import { ProjectsProfitability } from "./projects-profitability";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/workspace/projects/profitability", useSearchParams: () => new URLSearchParams() }));

const P7 = "11111111-1111-4111-8111-111111111117";
const P9 = "11111111-1111-4111-8111-111111111119";
const P3 = "11111111-1111-4111-8111-111111111113";
const row = (patch: Partial<ProfitabilityRow>): ProfitabilityRow => ({
  projectId: P7, reference: "PRJ-0007", name: "Villa 7", clientName: "Maya Client", status: "active", href: `/workspace/projects/${P7}/money`,
  contractCurrency: "AED", contractNet: "110000.0000", variationsNet: "10000.0000", revenue: "40000.0000", received: "52000.0000", cost: "19800.0000", committed: "14000.0000",
  forecastCost: "65800.0000", budget: "60000.0000", margin: "20200.0000", marginPercent: "50.5", forecastMargin: "44200.0000", forecastMarginPercent: "40.2",
  flags: [{ code: "over_budget", category: "materials", amount: "3100.0000" }, { code: "below_target", forecastPercent: "40.2", target: "45.0" }], comparable: true, ...patch,
});
const state = (patch: Partial<Profitability> = {}): Profitability => ({
  currency: "AED", marginHidden: false, target: "45.0", categories: ["materials", "factory", "subcontract_labour", "site_expenses", "other"],
  rows: [
    row({}),
    row({ projectId: P9, reference: "PRJ-0009", name: "Villa 9", clientName: "Omar", contractNet: "20000.0000", revenue: "20000.0000", cost: "25000.0000", committed: "0.0000",
      forecastCost: "25000.0000", margin: "-5000.0000", marginPercent: "-25.0", forecastMargin: "-5000.0000", forecastMarginPercent: "-25.0", href: `/workspace/projects/${P9}/money`,
      flags: [{ code: "forecast_loss", amount: "5000.0000" }] }),
    row({ projectId: P3, reference: "PRJ-0003", name: "Office 3", clientName: "Lina", status: "completed", flags: [], href: `/workspace/projects/${P3}/money` }),
  ],
  ...patch,
});
const mount = (respond: () => unknown, status = 200) => {
  const fetcher = vi.fn(async (_url: string) => ({ ok: status < 400, status, json: async () => respond() }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const view = () => render(<DesignSystemProvider locale="en" timeZone="UTC"><ProjectsProfitability workspaceId="w" /></DesignSystemProvider>);
const grid = () => screen.findByRole("grid", { name: "Projects profitability" }).catch(() => screen.findByRole("table", { name: "Projects profitability" }));
const names = (table: HTMLElement) => within(table).getAllByRole("link").map((link) => link.textContent);

describe("Projects › Profitability", () => {
  afterEach(() => { vi.unstubAllGlobals(); router.push.mockClear(); });

  it("lists running projects with contract value, revenue, cost, margins and what needs a look, each opening its Money", async () => {
    const fetcher = mount(() => state());
    view();
    const table = await grid();
    expect(screen.getByRole("heading", { level: 1, name: "Profitability" })).toBeInTheDocument();
    expect(String(fetcher.mock.calls[0][0])).toBe("/api/project-core/profitability?workspaceId=w");
    expect(names(table)).toEqual(["Villa 7", "Villa 9"]);
    const villa7 = within(table).getByRole("link", { name: "Villa 7" }).closest("tr")!;
    expect(villa7).toHaveTextContent(/110,000\.00.*40,000\.00.*19,800\.00.*14,000\.00.*50\.5%.*40\.2%.*44,200\.00/);
    expect(villa7).toHaveTextContent(/Materials over by AED\s?3,100\.00/);
    expect(villa7).toHaveTextContent("Margin 40.2% below the 45% target");
    expect(within(table).getByRole("link", { name: "Villa 7" })).toHaveAttribute("href", `/workspace/projects/${P7}/money`);
    expect(within(table).getByRole("link", { name: "Villa 9" }).closest("tr")).toHaveTextContent(/Expected loss of AED\s?5,000\.00/);
  });

  it("sorts by forecast margin and shows closed projects on their own tab", async () => {
    mount(() => state());
    view();
    const table = await grid();
    const sort = table.querySelector<HTMLElement>('th[data-column="forecast"] .wd-sort-button');
    // Highest first, then lowest first: the loss-making project rises to the top.
    await userEvent.click(sort!);
    expect(names(table)).toEqual(["Villa 7", "Villa 9"]);
    await userEvent.click(sort!);
    expect(names(table)).toEqual(["Villa 9", "Villa 7"]);
    await userEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Closed" }));
    expect(names(await grid())).toEqual(["Office 3"]);
    await userEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "All" }));
    expect(names(await grid())).toHaveLength(3);
  });

  it("finds a project by name, reference or client", async () => {
    mount(() => state());
    view();
    const table = await grid();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search projects" }), "omar");
    expect(names(table)).toEqual(["Villa 9"]);
  });

  it("leaves margins out for people who see only their projects' costs", async () => {
    mount(() => state({ marginHidden: true, target: null, rows: [row({ margin: null, marginPercent: null, forecastMargin: null, forecastMarginPercent: null,
      flags: [{ code: "over_budget", category: "materials", amount: "3100.0000" }] })] }));
    view();
    const table = await grid();
    expect(table.querySelector('th[data-column="margin"]')).toBeNull();
    expect(table.querySelector('th[data-column="forecast"]')).toBeNull();
    expect(within(table).getByRole("link", { name: "Villa 7" }).closest("tr")).toHaveTextContent(/19,800\.00/);
  });

  it("says what went wrong and offers a retry", async () => {
    mount(() => ({ message: "You don't see project costs." }), 403);
    view();
    expect(await screen.findByText("You don't see project costs.")).toBeInTheDocument();
    mount(() => state());
    await userEvent.click(screen.getByRole("button", { name: /Try again|Retry/ }));
    expect(names(await grid())).toEqual(["Villa 7", "Villa 9"]);
  });
});
