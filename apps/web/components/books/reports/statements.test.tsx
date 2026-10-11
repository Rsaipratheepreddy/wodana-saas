import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { statementsApi, type CashFlowStatement, type ProfitAndLossStatement, type StatementResponse } from "@/lib/books/statements-client";
import { CashFlowBody, CashFlowReport, ProfitAndLossBody, ProfitAndLossReport } from "./statements";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/ledger", useSearchParams: () => new URLSearchParams() }));

const WS = "11111111-1111-4111-8111-111111111111";
const ENTITY = "22222222-2222-4222-8222-222222222222";
const REVENUE = "33333333-3333-4333-8333-333333333333";
const BANK = "44444444-4444-4444-8444-444444444444";
const wrap = (node: React.ReactNode) => <DesignSystemProvider locale="en-AE" currency="AED">{node}</DesignSystemProvider>;
const scope = { entity: ENTITY, from: "2026-10-01", to: "2026-10-31" };
const capabilities = { accrual: true, cash: true, drillDown: true, cashAccounts: true, forecast: true };
const company = { id: ENTITY, code: "MAIN", name: "Studio Interiors", currency: "AED", locale: "en-AE", timeZone: "Asia/Dubai", countryCode: "AE", today: "2026-10-31",
  fiscalYearStartMonth: 1, ledgerOn: true };
const header = { source: "ledger" as const, sourceLabel: null, currency: "AED", legalEntityId: ENTITY, projectId: null, generatedAt: "2026-10-31T00:00:00Z", notes: [] };

const pnl: ProfitAndLossStatement = {
  ...header, statement: "profit_and_loss", basis: "accrual",
  columns: [{ key: "current", from: "2026-10-01", to: "2026-10-31", role: "current" }, { key: "current", from: "2026-09-01", to: "2026-09-30", role: "comparison" }],
  sections: [
    { key: "revenue", label: "Revenue", total: ["130000.0000", "100000.0000"], rows: [
      { key: "design_fees", label: "Design fees", amounts: ["20000.0000", "0.0000"], rows: [{ key: `account:${REVENUE}`, label: "Project revenue", code: "4100", accountId: REVENUE, amounts: ["20000.0000", "0.0000"] }] },
      { key: "production", label: "Production and fit-out", amounts: ["110000.0000", "100000.0000"], rows: [{ key: `account:${REVENUE}`, label: "Project revenue", code: "4100", accountId: REVENUE, amounts: ["110000.0000", "100000.0000"] }] },
    ] },
    { key: "cost_of_sales", label: "Cost of sales", total: ["30300.0000", "50000.0000"], rows: [
      { key: "materials", label: "Materials", amounts: ["30000.0000", "50000.0000"], rows: [{ key: "account:m", label: "Project materials", code: "5100", accountId: "m", amounts: ["30000.0000", "50000.0000"] }] },
      { key: "other_costs", label: "Other costs", amounts: ["300.0000", "0.0000"], rows: [] },
    ] },
    { key: "operating_expenses", label: "Operating expenses", total: ["20000.0000", "0.0000"], rows: [{ key: "account:rent", label: "Rent", code: "6120", accountId: "rent", amounts: ["20000.0000", "0.0000"] }] },
    { key: "other_income", label: "Other income", total: ["0.0000", "0.0000"], rows: [] },
    { key: "other_expenses", label: "Other expenses", total: ["0.0000", "0.0000"], rows: [] },
  ],
  totals: { revenue: ["130000.0000", "100000.0000"], costOfSales: ["30300.0000", "50000.0000"], grossProfit: ["99700.0000", "50000.0000"], grossMarginPercent: ["76.7", "50.0"],
    operatingExpenses: ["20000.0000", "0.0000"], operatingProfit: ["79700.0000", "50000.0000"], otherIncome: ["0.0000", "0.0000"], otherExpenses: ["0.0000", "0.0000"],
    netProfit: ["79700.0000", "50000.0000"], netMarginPercent: ["61.3", "50.0"] },
};
const pnlResponse: StatementResponse<ProfitAndLossStatement> = {
  statement: pnl, company, companies: [company], source: { source: "ledger", label: null, chosen: false, capabilities },
  period: { from: "2026-10-01", to: "2026-10-31" }, comparison: { from: "2026-09-01", to: "2026-09-30" }, compare: "previous_period",
};

const flow: CashFlowStatement = {
  ...header, statement: "cash_flow", basis: "cash",
  columns: [{ key: "m0", from: "2026-09-01", to: "2026-09-30", role: "month" }, { key: "m1", from: "2026-10-01", to: "2026-10-31", role: "month" }],
  sections: [
    { key: "cash_in", label: "Cash in", total: ["5000.0000", "71000.0000"], rows: [
      { key: "client_payments", label: "Client payments", amounts: ["0.0000", "50000.0000"] }, { key: "client_advances", label: "Client advances", amounts: ["0.0000", "21000.0000"] },
      { key: "other_receipts", label: "Other receipts", amounts: ["5000.0000", "0.0000"] }] },
    { key: "cash_out", label: "Cash out", total: ["0.0000", "53800.0000"], rows: [
      { key: "supplier_payments", label: "Supplier payments", amounts: ["0.0000", "31500.0000"] }, { key: "tax", label: "Tax", amounts: ["0.0000", "22300.0000"] }] },
  ],
  netCashFlow: ["5000.0000", "17200.0000"], opening: ["100000.0000", "105000.0000"], closing: ["105000.0000", "122200.0000"],
  accounts: [{ key: `account:${BANK}`, label: "Bank", accountId: BANK, opening: ["100000.0000", "105000.0000"], closing: ["105000.0000", "122200.0000"] }],
  forecast: { columns: [{ key: "f0", from: "2026-11-01", to: "2026-11-30", role: "forecast" }, { key: "f1", from: "2026-12-01", to: "2026-12-30", role: "forecast" },
    { key: "f2", from: "2026-12-31", to: "2027-01-29", role: "forecast" }],
    receipts: ["105000.0000", "0.0000", "0.0000"], payments: ["10500.0000", "0.0000", "200000.0000"], net: ["94500.0000", "0.0000", "-200000.0000"],
    closing: ["216700.0000", "216700.0000", "16700.0000"] },
};
const flowResponse: StatementResponse<CashFlowStatement> = { ...pnlResponse, statement: flow, comparison: null, compare: "none", period: { from: "2026-09-01", to: "2026-10-31" } };

describe("company statements", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lays out the P&L with categories, totals, gross and net profit and margins, comparison, change and change %", async () => {
    const user = userEvent.setup();
    render(wrap(<ProfitAndLossBody response={pnlResponse} scope={scope} />));
    const table = screen.getByRole("table", { name: "Profit and loss" });
    const heads = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(heads[1]).toMatch(/Oct 2026/);
    expect(heads[2]).toMatch(/Sep.*2026.*Previous period/);
    expect(heads.slice(3)).toEqual(["Change", "Change %"]);
    // Revenue categories open to their accounts, each opening its ledger for the period.
    expect(within(table).getAllByRole("link", { name: "Project revenue" })[0]).toHaveAttribute("href", `/workspace/ledger/accounts/${REVENUE}?entity=${ENTITY}&from=2026-10-01&to=2026-10-31`);
    const production = within(table).getByText("Production and fit-out").closest("tr") as HTMLElement;
    expect(within(production).getByText("110,000.00")).toBeInTheDocument();
    expect(within(production).getByText("10,000.00")).toBeInTheDocument();
    expect(within(production).getByText("10.0%")).toBeInTheDocument();
    // Cost of sales categories start closed and open on demand.
    expect(within(table).queryByRole("link", { name: "Project materials" })).not.toBeInTheDocument();
    await user.click(within(table).getByRole("button", { name: "Show the lines of Materials" }));
    expect(within(table).getByRole("link", { name: "Project materials" })).toBeInTheDocument();
    const gross = within(table).getByText("Gross profit").closest("tr") as HTMLElement;
    expect(gross).toHaveAttribute("data-kind", "result");
    expect(within(gross).getByText("99,700.00")).toBeInTheDocument();
    expect(within(gross).getByText("99.4%")).toBeInTheDocument();
    expect(within(within(table).getByText("Gross margin").closest("tr") as HTMLElement).getByText("76.7%")).toBeInTheDocument();
    expect(within(within(table).getByText("Net margin").closest("tr") as HTMLElement).getByText("61.3%")).toBeInTheDocument();
    // Empty optional sections stay out; the source is one muted line.
    expect(within(table).queryByText("Other income")).not.toBeInTheDocument();
    expect(screen.getByTestId("statement-source")).toHaveTextContent("Wodana Ledger · Accrual · AED");
  });

  it("reads the P&L through the statements API with the period, comparison and basis, and exports the same figures as CSV", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => ({ ...pnlResponse, statement: { ...pnl, notes: ["From payments, invoices and bills recorded in Wodana"] },
      source: { ...pnlResponse.source, source: "operational_cash" } }), url }));
    vi.stubGlobal("fetch", fetcher);
    const onScope = vi.fn();
    render(wrap(<ProfitAndLossReport api={statementsApi(WS)} scope={{ ...scope, basis: "", compare: "previous_period" }} onScope={onScope}
      picker={{ report: "profit-and-loss", onReport: vi.fn(), reports: ["profit-and-loss", "cash-flow"] }} />));
    await screen.findByRole("table", { name: "Profit and loss" });
    expect(String(fetcher.mock.calls[0][0])).toBe(`/api/books/statements/profit-and-loss?entity=${ENTITY}&from=2026-10-01&to=2026-10-31&compare=previous_period&workspaceId=${WS}`);
    expect(screen.getByTestId("statement-source")).toHaveTextContent("Operational cash · Accrual · AED · From payments, invoices and bills recorded in Wodana");
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href",
      `/api/books/statements/profit-and-loss?entity=${ENTITY}&from=2026-10-01&to=2026-10-31&compare=previous_period&format=csv&workspaceId=${WS}`);
    await user.click(screen.getByRole("radio", { name: "Cash" }));
    expect(onScope).toHaveBeenLastCalledWith({ basis: "cash" });
    await user.click(screen.getByRole("button", { name: /Compare with/ }));
    await user.click(await screen.findByRole("option", { name: "Same period last year" }));
    expect(onScope).toHaveBeenLastCalledWith({ compare: "previous_year" });
  });

  it("says why a statement didn't load and retries", async () => {
    const user = userEvent.setup();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++calls === 1
      ? { ok: false, status: 409, json: async () => ({ message: "Zoho Books isn't connected for this company. Choose where the books live in Settings › Ledger." }) }
      : { ok: true, status: 200, json: async () => pnlResponse })));
    render(wrap(<ProfitAndLossReport api={statementsApi(WS)} scope={{ ...scope, basis: "", compare: "" }} onScope={vi.fn()} picker={{}} />));
    expect(await screen.findByText(/Zoho Books isn't connected/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Try again|Retry/ }));
    expect(await screen.findByRole("table", { name: "Profit and loss" })).toBeInTheDocument();
  });

  it("lays out the cash flow by month with opening and closing cash, cash per account, the chart and the 90-day forecast", async () => {
    const user = userEvent.setup();
    render(wrap(<CashFlowBody response={flowResponse} scope={{ entity: ENTITY, from: "2026-09-01", to: "2026-10-31" }} />));
    const table = screen.getByRole("table", { name: "Cash flow" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["", expect.stringMatching(/^Sep/), "Oct 2026"]);
    expect(within(within(table).getByText("Opening cash").closest("tr") as HTMLElement).getByText("100,000.00")).toBeInTheDocument();
    expect(within(within(table).getByText("Net cash flow").closest("tr") as HTMLElement).getByText("17,200.00")).toBeInTheDocument();
    const closing = within(table).getByText("Closing cash").closest("tr") as HTMLElement;
    expect(within(closing).getByText("122,200.00")).toBeInTheDocument();
    await user.click(within(table).getByRole("button", { name: "Show the lines of Closing cash" }));
    expect(within(table).getByRole("link", { name: "Bank" })).toHaveAttribute("href", `/workspace/ledger/accounts/${BANK}?entity=${ENTITY}&from=2026-09-01&to=2026-10-31`);
    expect(screen.getByRole("table", { name: "Cash in and out by month" })).toBeInTheDocument();
    const forecast = screen.getByRole("table", { name: "Next 90 days" });
    expect(within(forecast).getAllByRole("columnheader").map((cell) => cell.textContent?.slice(0, 12))).toEqual(["", "Next 30 days", "31–60 days", "61–90 days"].map((text) => expect.stringContaining(text)));
    const projected = within(forecast).getByText("Projected cash").closest("tr") as HTMLElement;
    expect(within(projected).getByText("16,700.00")).toBeInTheDocument();
    expect(within(within(forecast).getByText("Net").closest("tr") as HTMLElement).getByText("(200,000.00)")).toHaveAttribute("data-negative");
  });

  it("reads the cash flow for the company and period, with its CSV", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => flowResponse }));
    vi.stubGlobal("fetch", fetcher);
    render(wrap(<CashFlowReport api={statementsApi(WS)} scope={{ entity: ENTITY, from: "2026-09-01", to: "2026-10-31", basis: "cash", compare: "previous_year" }} onScope={vi.fn()}
      picker={{ report: "cash-flow", onReport: vi.fn(), reports: ["profit-and-loss", "cash-flow"] }} />));
    await screen.findByRole("table", { name: "Cash flow" });
    await waitFor(() => expect(String((fetcher.mock.calls[0] as unknown[])[0])).toBe(`/api/books/statements/cash-flow?entity=${ENTITY}&from=2026-09-01&to=2026-10-31&workspaceId=${WS}`));
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", `/api/books/statements/cash-flow?entity=${ENTITY}&from=2026-09-01&to=2026-10-31&format=csv&workspaceId=${WS}`);
  });

  it("says when no money moved, with the next step", () => {
    const empty = { ...flowResponse, statement: { ...flow, forecast: null, sections: flow.sections.map((section) => ({ ...section, rows: [], total: ["0.0000", "0.0000"] })),
      closing: ["0.0000", "0.0000"], opening: ["0.0000", "0.0000"], netCashFlow: ["0.0000", "0.0000"], accounts: [] } };
    render(wrap(<CashFlowBody response={empty} scope={scope} />));
    expect(screen.getByText("No money moved in this period")).toBeInTheDocument();
    expect(screen.getByText("Choose another period")).toBeInTheDocument();
  });
});
