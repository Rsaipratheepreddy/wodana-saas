import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ProjectCashFlow, ProjectPnl } from "@/lib/project-core/types";
import { ProjectMoneySummary } from "./project-money-summary";

const pnl = (patch: Partial<ProjectPnl> = {}): ProjectPnl => ({
  projectId: "p1", reference: "PRJ-0007", name: "Villa 7", asOf: "2026-10-11", currency: "AED", contractCurrency: "AED", comparable: true,
  contract: { baselineNet: "100000.0000", baselineTotal: "105000.0000", variationsNet: "10000.0000", variationsTotal: "10500.0000",
    variations: [{ sealId: "s2", label: "VO-1", net: "10000.0000", total: "10500.0000", acceptedAt: "2026-09-15T06:00:00.000Z" }], net: "110000.0000", total: "115500.0000" },
  revenue: { invoicedNet: "40000.0000", invoicedTotal: "42000.0000", received: "52000.0000" },
  categories: [
    { category: "materials", budget: "16000.0000", actual: "9600.0000", committed: "9500.0000", remaining: "0.0000", forecast: "19100.0000", variance: "-3100.0000", usedPercent: "119.4", over: true },
    { category: "factory", budget: "36000.0000", actual: "4000.0000", committed: "0.0000", remaining: "32000.0000", forecast: "36000.0000", variance: "0.0000", usedPercent: "11.1", over: false },
    { category: "site_expenses", budget: null, actual: "650.0000", committed: "0.0000", remaining: "0.0000", forecast: "650.0000", variance: null, usedPercent: null, over: false },
  ],
  totals: { budget: "52000.0000", actual: "14250.0000", committed: "9500.0000", remaining: "32000.0000", forecast: "55750.0000" },
  margin: { toDate: "25750.0000", toDatePercent: "64.4", forecast: "54250.0000", forecastPercent: "49.3", target: "55.0" },
  flags: [{ code: "over_budget", category: "materials", amount: "3100.0000" }, { code: "below_target", forecastPercent: "49.3", target: "55.0" }, { code: "estimate_incomplete", count: 1 }],
  estimate: { lines: 6, missing: 1 }, uncosted: 0, marginHidden: false,
  basis: { source: "operational", ledger: { company: "Studio LLC", currency: "AED", revenue: "40000.0000", cost: "13450.0000", revenueDifference: "0.0000", costDifference: "-800.0000",
    matches: false, journals: "/workspace/ledger/journals?project=p1" } },
  ...patch,
});
const cash = (patch: Partial<ProjectCashFlow> = {}): ProjectCashFlow => ({
  projectId: "p1", currency: "AED", timeZone: "Asia/Dubai", asOf: "2026-10-11",
  months: [
    { month: "2026-08", in: "42000.0000", out: "0.0000", net: "42000.0000", cumulativeIn: "42000.0000", cumulativeOut: "0.0000", balance: "42000.0000" },
    { month: "2026-09", in: "0.0000", out: "2750.0000", net: "-2750.0000", cumulativeIn: "42000.0000", cumulativeOut: "2750.0000", balance: "39250.0000" },
    { month: "2026-10", in: "10000.0000", out: "5200.0000", net: "4800.0000", cumulativeIn: "52000.0000", cumulativeOut: "7950.0000", balance: "44050.0000" },
  ],
  wallet: { received: "52000.0000", paid: "7950.0000", balance: "44050.0000" },
  upcoming: {
    buckets: [
      { key: "overdue", from: null, to: "2026-10-10", in: "0.0000", out: "0.0000", net: "0.0000" },
      { key: "days_0_30", from: "2026-10-11", to: "2026-11-10", in: "21500.0000", out: "5845.0000", net: "15655.0000" },
      { key: "days_31_60", from: "2026-11-11", to: "2026-12-10", in: "10500.0000", out: "9500.0000", net: "1000.0000" },
      { key: "days_61_90", from: "2026-12-11", to: "2027-01-09", in: "0.0000", out: "2500.0000", net: "-2500.0000" },
    ],
    undated: { in: "0.0000", out: "300.0000" }, items: [],
  },
  spendingLock: { guard: "strict", available: "8200.0000", state: "clear" }, unconverted: 0,
  ...patch,
});
function mount(respond: { pnl?: () => unknown; cash?: () => unknown; status?: number }) {
  const fetcher = vi.fn(async (url: string) => {
    const status = respond.status ?? 200;
    const body = url.includes("/money/pnl") ? (respond.pnl ?? (() => pnl()))() : (respond.cash ?? (() => cash()))();
    return { ok: status < 400, status, json: async () => body };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const view = () => render(<DesignSystemProvider locale="en" timeZone="Asia/Dubai"><ProjectMoneySummary workspaceId="w" projectId="p1" /></DesignSystemProvider>);
const fact = (label: string) => screen.getByText(label, { selector: "dt" }).closest("div")!;
const grid = (name: string) => screen.findByRole("grid", { name }).catch(() => screen.findByRole("table", { name }));

describe("Money › Summary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("leads with the six key figures and the flags, then says where the figures come from", async () => {
    const fetcher = mount({});
    view();
    await grid("Costs by category");
    expect(fact("Contract value")).toHaveTextContent(/110,000\.00.*10,000\.00 from variations/);
    expect(fact("Received")).toHaveTextContent(/52,000\.00.*42,000\.00 invoiced/);
    expect(fact("Spent")).toHaveTextContent(/14,250\.00.*of AED\s?52,000\.00 planned/);
    expect(fact("Committed")).toHaveTextContent(/9,500\.00/);
    expect(fact("Margin to date")).toHaveTextContent(/25,750\.00.*64\.4% of invoiced/);
    expect(fact("Forecast margin")).toHaveTextContent(/54,250\.00.*49\.3% at completion, target 55%/);
    const flags = screen.getByRole("list", { name: "Flags" });
    expect(within(flags).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringMatching(/Materials over by AED\s?3,100\.00/), "Margin 49.3% below the 55% target", "1 quoted lines have no cost"]);
    expect(screen.getByText("From Wodana's records")).toBeInTheDocument();
    expect(screen.getByText(/The Ledger differs by -?AED\s?-?800\.00/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ledger journals" })).toHaveAttribute("href", "/workspace/ledger/journals?project=p1");
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual(expect.arrayContaining([
      "/api/project-core/projects/p1/money/pnl?workspaceId=w", "/api/project-core/projects/p1/money/cash-flow?workspaceId=w"]));
  });

  it("lays the P&L out by category against the quotation's estimate", async () => {
    mount({});
    view();
    const table = await grid("Costs by category");
    const row = (name: string) => within(table).getByText(name).closest("tr")!;
    expect(row("Materials")).toHaveTextContent(/16,000\.00.*9,600\.00.*9,500\.00.*19,100\.00.*3,100\.00 over/);
    expect(row("Factory")).toHaveTextContent(/36,000\.00.*4,000\.00.*36,000\.00/);
    expect(row("Site expenses")).toHaveTextContent(/—.*650\.00/);
    expect(screen.getByText("Expected cost").closest("div")).toHaveTextContent(/55,750\.00/);
    expect(screen.getByRole("group", { name: "Spend against the estimate" })).toBeInTheDocument();
  });

  it("shows the cash: the wallet, money by month, what's due in 90 days and what has no date", async () => {
    mount({});
    view();
    const months = await grid("Cash by month");
    expect(fact("Project cash")).toHaveTextContent(/44,050\.00.*52,000\.00 in, AED\s?7,950\.00 out/);
    expect(fact("Due in")).toHaveTextContent(/32,000\.00/);
    expect(fact("Due out")).toHaveTextContent(/17,845\.00/);
    // Newest month first; months are named in the person's locale.
    expect(within(months).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([
      expect.stringMatching(/Oct 2026.*10,000\.00.*5,200\.00.*4,800\.00.*44,050\.00/),
      expect.stringMatching(/Sep 2026.*0\.00.*2,750\.00.*-.*2,750\.00.*39,250\.00/),
      expect.stringMatching(/Aug 2026.*42,000\.00/),
    ]);
    const due = await grid("Due in the next 90 days");
    expect(within(due).getByText("Next 30 days").closest("tr")).toHaveTextContent(/21,500\.00.*5,845\.00.*15,655\.00/);
    expect(within(due).getByText("61–90 days").closest("tr")).toHaveTextContent(/2,500\.00/);
    expect(screen.getByText(/0\.00 in and AED\s?300\.00 out have no date yet/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Money in and out" })).toBeInTheDocument();
    expect(screen.queryByText(/New orders are stopped/)).toBeNull();
  });

  it("says when the spending guard stops new orders", async () => {
    mount({ cash: () => cash({ spendingLock: { guard: "strict", available: "-1200.0000", state: "locked" } }) });
    view();
    expect(await screen.findByText(/New orders are stopped: -?AED\s?-?1,200\.00 in hand\./)).toBeInTheDocument();
  });

  it("shows a project's own team its costs without any margin", async () => {
    mount({ pnl: () => pnl({ marginHidden: true, margin: { toDate: null, toDatePercent: null, forecast: null, forecastPercent: null, target: null },
      flags: [{ code: "over_budget", category: "materials", amount: "3100.0000" }] }) });
    view();
    await grid("Costs by category");
    expect(screen.queryByText("Margin to date")).toBeNull();
    expect(screen.queryByText("Forecast margin")).toBeNull();
    expect(fact("Spent")).toHaveTextContent(/14,250\.00/);
  });

  it("says when there's no margin because the project and its costs are in different currencies, and when the Ledger matches", async () => {
    mount({ pnl: () => pnl({ comparable: false, contractCurrency: "USD", margin: { toDate: null, toDatePercent: null, forecast: null, forecastPercent: null, target: null }, flags: [],
      basis: { source: "operational", ledger: { company: "Studio LLC", currency: "AED", revenue: "1", cost: "1", revenueDifference: null, costDifference: "0.0000", matches: true, journals: "/x" } } }) });
    view();
    expect(await screen.findByText(/The project is in USD and costs are in AED/)).toBeInTheDocument();
    expect(screen.getByText("Matches the Ledger")).toBeInTheDocument();
  });

  it("offers a retry when the figures don't load", async () => {
    mount({ status: 503, pnl: () => ({ message: "The service is unavailable." }), cash: () => ({ message: "The service is unavailable." }) });
    view();
    expect(await screen.findByText("The service is unavailable.")).toBeInTheDocument();
    mount({});
    await userEvent.click(screen.getByRole("button", { name: /Try again|Retry/ }));
    expect(await grid("Costs by category")).toBeInTheDocument();
  });

  it("shows the empty states before anything was spent or paid", async () => {
    mount({ pnl: () => pnl({ categories: [], flags: [{ code: "no_estimate" }] }), cash: () => cash({ months: [], upcoming: { ...cash().upcoming, buckets: cash().upcoming.buckets.map((bucket) => ({ ...bucket, in: "0.0000", out: "0.0000", net: "0.0000" })), undated: { in: "0.0000", out: "0.0000" } } }) });
    view();
    expect(await screen.findByText("No costs yet")).toBeInTheDocument();
    expect(screen.getByText("No money in or out yet")).toBeInTheDocument();
    expect(screen.getByText("The quotation has no cost estimate")).toBeInTheDocument();
    expect(screen.queryByRole("grid", { name: "Due in the next 90 days" })).toBeNull();
  });
});
