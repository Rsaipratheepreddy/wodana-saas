import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { periodPresets, presetOf, presetPeriod, type GeneralLedgerReport, type JournalDetail, type LedgerOverview, type ReportEntity, type TrialBalanceReport } from "@/lib/books/reports-client";
import { canOpen, accessRuleForPath, meetsRule } from "@/lib/workspace/access";
import { resolveWorkspaceRoute } from "@/lib/workspace/route-map";
import { productNavigation, workspaceModules } from "@/components/workspace/workspace-navigation";
import { scopeWorkspaceNavigation } from "@/lib/workspace/module-rollout";
import { JournalSheet } from "../journal-sheet";
import { ledgerApi } from "@/lib/books/reports-client";
import { LedgerArea } from "./ledger-area";
import { ReportPicker } from "./report-picker";

const WS = "11111111-1111-4111-8111-111111111111";
const ENTITY = "22222222-2222-4222-8222-222222222222";
const SECOND = "33333333-3333-4333-8333-333333333333";
const BANK = "44444444-4444-4444-8444-444444444444";
const JOURNAL = "55555555-5555-4555-8555-555555555555";

const replace = vi.fn();
const push = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push }), usePathname: () => "/workspace/ledger", useSearchParams: () => search }));
// A2's editor and import have their own tests; here they only need to open with the right journal and company.
vi.mock("../journals", () => ({
  ManualJournalEditor: ({ legalEntityId, journalId }: { legalEntityId: string; journalId?: string | null }) => <p>{`Editor ${legalEntityId} ${journalId ?? "new"}`}</p>,
  OpeningBalanceImport: ({ legalEntityId }: { legalEntityId: string }) => <p>{`Opening import ${legalEntityId}`}</p>,
}));

const entity = (id: string, name: string, currency = "AED"): ReportEntity => ({
  id, code: name.slice(0, 4).toUpperCase(), name, currency, locale: "en-AE", countryCode: "AE", timeZone: "Asia/Dubai", enabled: true, fiscalYearStartMonth: 1,
  startDate: "2026-01-01", lockDate: null, templateCode: "AE", templateVersion: 1, today: "2026-10-08",
});
const main = entity(ENTITY, "Studio Interiors");
const overview: LedgerOverview = {
  entities: [main, entity(SECOND, "Studio Trading", "USD")], entity: main, canManage: true, canPost: true, openIssues: 3,
  balances: { cash: "118500.0000", receivables: "63000.0000", payables: "11000.0000", vatDue: "7500.0000", profitThisYear: "-2000.0000" },
  vatPeriod: { from: "2026-10-01", to: "2026-12-31" }, fiscalYear: { from: "2026-01-01", to: "2026-10-08" },
};
const scope = { legalEntityId: ENTITY, from: "2026-01-01", to: "2026-10-08" };
const trialBalance: TrialBalanceReport = {
  report: "trial-balance", scope, entity: main, generatedAt: "2026-10-08T00:00:00Z", balanced: true, fiscalYearStart: "2026-01-01",
  rows: [
    { accountId: BANK, code: "1100", name: "Bank", type: "asset", subtype: "bank", opening: "0.0000", debit: "120500.0000", credit: "2000.0000", closing: "118500.0000" },
    { accountId: "66666666-6666-4666-8666-666666666666", code: "4100", name: "Project revenue", type: "income", subtype: "revenue", opening: "0.0000", debit: "0.0000", credit: "118500.0000", closing: "-118500.0000" },
  ],
  totals: { opening: "0.0000", debit: "120500.0000", credit: "120500.0000", closing: "0.0000" },
};
const bankLedger: GeneralLedgerReport = {
  report: "general-ledger", scope, entity: main, generatedAt: "2026-10-08T00:00:00Z",
  account: { id: BANK, code: "1100", name: "Bank", type: "asset", subtype: "bank", isControl: false },
  opening: "0.0000", debit: "120500.0000", credit: "2000.0000", closing: "118500.0000",
  rows: [{ lineId: "l1", journalId: JOURNAL, journalNumber: "STUD-JV-000004", journalDate: "2026-10-08", kind: "auto", description: "Receipt", sourceLabel: "RCPT-1",
    sourceHref: "/workspace/finance/client-invoices?invoice=1", partyName: "Villa 12 Owner", debit: "105000.0000", credit: "0.0000", balance: "105000.0000" }],
};
const journal: JournalDetail = {
  entity: main,
  journal: { id: JOURNAL, number: "STUD-JV-000004", journalDate: "2026-10-08", eventDate: "2026-10-08", late: false, kind: "auto", sourceType: "receipt", sourceEvent: "verified",
    sourceLabel: "RCPT-1", sourceHref: "/workspace/finance/client-invoices?invoice=1", description: "", currency: "AED", total: "105000.0000", functionalCurrency: "AED", rate: "1",
    reversesJournalId: null, reversedByJournalId: null, postedByName: null, postedAt: "2026-10-08T10:00:00Z" },
  lines: [
    { id: "a", position: 0, accountId: BANK, accountCode: "1100", accountName: "Bank", debit: "105000.0000", credit: "0.0000", docAmount: "105000.0000", description: "", projectId: null,
      projectName: null, partyType: null, partyId: null, partyName: null, taxCode: null, taxBase: null, taxRegion: null },
    { id: "b", position: 1, accountId: "77777777-7777-4777-8777-777777777777", accountCode: "1200", accountName: "Trade receivables", debit: "0.0000", credit: "105000.0000", docAmount: "105000.0000",
      description: "", projectId: null, projectName: null, partyType: "client", partyId: "c", partyName: "Villa 12 Owner", taxCode: null, taxBase: null, taxRegion: null },
  ],
};

const capabilities = { accrual: true, cash: true, drillDown: true, cashAccounts: true, forecast: true };
const company = { id: ENTITY, code: "STUD", name: "Studio Interiors", currency: "AED", locale: "en-AE", timeZone: "Asia/Dubai", countryCode: "AE", today: "2026-10-08",
  fiscalYearStartMonth: 1, ledgerOn: true };
const header = { source: "ledger", sourceLabel: null, basis: "accrual", currency: "AED", legalEntityId: ENTITY, projectId: null, generatedAt: "2026-10-08T00:00:00Z", notes: [] };
const zeroSection = (key: string, label: string) => ({ key, label, rows: [], total: ["0.0000"] });
const pnlResponse = {
  statement: { ...header, statement: "profit_and_loss", columns: [{ key: "current", from: "2026-01-01", to: "2026-10-08", role: "current" }],
    sections: [{ key: "revenue", label: "Revenue", total: ["118500.0000"], rows: [{ key: "production", label: "Production and fit-out", amounts: ["118500.0000"],
      rows: [{ key: "account:r", label: "Project revenue", code: "4100", accountId: "66666666-6666-4666-8666-666666666666", amounts: ["118500.0000"] }] }] },
      zeroSection("cost_of_sales", "Cost of sales"), zeroSection("operating_expenses", "Operating expenses"), zeroSection("other_income", "Other income"),
      zeroSection("other_expenses", "Other expenses")],
    totals: { revenue: ["118500.0000"], costOfSales: ["0.0000"], grossProfit: ["118500.0000"], grossMarginPercent: ["100.0"], operatingExpenses: ["0.0000"],
      operatingProfit: ["118500.0000"], otherIncome: ["0.0000"], otherExpenses: ["0.0000"], netProfit: ["118500.0000"], netMarginPercent: ["100.0"] } },
  company, companies: [company], source: { source: "ledger", label: null, chosen: false, capabilities }, period: { from: "2026-01-01", to: "2026-10-08" }, comparison: null, compare: "none",
};
const cashFlowResponse = { ...pnlResponse, statement: { ...header, statement: "cash_flow", basis: "cash", columns: [{ key: "m0", from: "2026-10-01", to: "2026-10-08", role: "month" }],
  sections: [{ key: "cash_in", label: "Cash in", rows: [], total: ["0.0000"] }, { key: "cash_out", label: "Cash out", rows: [], total: ["0.0000"] }],
  netCashFlow: ["0.0000"], opening: ["0.0000"], closing: ["0.0000"], accounts: [], forecast: null } };

function mount(answers: { overview?: LedgerOverview } = {}) {
  const fetcher = vi.fn(async (url: string) => {
    const path = new URL(url, "http://localhost").pathname.replace("/api/books/reports/", "");
    if (path.startsWith("/api/books/statements/")) return { ok: true, status: 200, json: async () => (path.endsWith("cash-flow") ? cashFlowResponse : pnlResponse) };
    const body = path === "overview" ? answers.overview ?? overview
      : path === "trial-balance" ? trialBalance
      : path.startsWith("accounts/") ? bankLedger
      : path.startsWith("journals/") ? journal
      : path === "journals" ? { scope, entity: main, project: null, total: 1, limit: 200, offset: 0, journals: [journal.journal] }
      : path === "/api/books/manual-journals" ? { journals: [], canPost: true, me: "u" }
      : { message: "Unknown" };
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const wrap = (node: React.ReactNode) => <DesignSystemProvider locale="en-AE" currency="AED">{node}</DesignSystemProvider>;

describe("the Ledger area", () => {
  beforeEach(() => { replace.mockClear(); push.mockClear(); search = new URLSearchParams(); });

  it("has one title, the five tabs and the key balances, each opening the report behind it", async () => {
    const user = userEvent.setup();
    mount();
    render(wrap(<LedgerArea workspaceId={WS} section="overview" sub={null} />));
    expect(screen.getByRole("heading", { level: 1, name: "Ledger" })).toBeInTheDocument();
    for (const tab of ["Overview", "Reports", "Journals", "Accounts", "Needs attention"]) expect(screen.getByRole("tab", { name: new RegExp(tab) })).toBeInTheDocument();
    const cash = (await screen.findByRole("heading", { name: "Cash" })).closest("section") as HTMLElement;
    expect(within(cash).getByText(/118,500\.00/)).toBeInTheDocument();
    expect(screen.getByText(/7,500\.00/)).toBeInTheDocument();
    // A loss shows in brackets and as bad news.
    const profit = screen.getByRole("heading", { name: "Profit this year" }).closest("section") as HTMLElement;
    expect(profit).toHaveAttribute("data-tone", "danger");
    expect(within(profit).getByText(/\(.*2,000\.00\)/)).toBeInTheDocument();
    await user.click(within(screen.getByRole("heading", { name: "Clients owe" }).closest("section") as HTMLElement).getByRole("button"));
    expect(push).toHaveBeenCalledWith(`/workspace/ledger/reports/ar-ageing?entity=${ENTITY}&to=2026-10-08`);
  });

  it("reads like an accounting home: six-month trends, what needs someone with its action, and the latest journals", async () => {
    mount({ overview: { ...overview,
      trend: { days: ["2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-08"], cash: ["0", "1000", "5000", "9000", "100000", "118500"],
        receivables: ["0", "0", "0", "0", "20000", "63000"], payables: ["0", "0", "0", "0", "0", "11000"], vat: ["0", "0", "0", "0", "100", "7500"] },
      attention: { overdueReceivables: "21000.0000", overduePayables: "0.0000", manualWaiting: 2, unbalanced: false },
      recent: [{ ...journal.journal, partyName: "Amira Hassan" }] } });
    render(wrap(<LedgerArea workspaceId={WS} section="overview" sub={null} />));
    const cash = (await screen.findByRole("heading", { name: "Cash" })).closest("section") as HTMLElement;
    expect(within(cash).getByRole("img", { name: "Cash, last six months" })).toBeInTheDocument();
    const todo = screen.getByRole("region", { name: "To do" });
    expect(within(todo).getByText("3 records couldn't post")).toBeInTheDocument();
    expect(within(todo).getByText("2 journals waiting for approval")).toBeInTheDocument();
    expect(within(todo).getByText("Clients are overdue")).toBeInTheDocument();
    expect(within(todo).queryByText("Supplier bills are overdue")).not.toBeInTheDocument();
    expect(within(todo).getByRole("link", { name: "Chase" })).toHaveAttribute("href", `/workspace/ledger/reports/ar-ageing?entity=${ENTITY}&to=2026-10-08`);
    expect(within(todo).getAllByRole("link", { name: "Review" })[1]).toHaveAttribute("href", `/workspace/ledger/journals?entity=${ENTITY}&view=manual`);
    const recent = screen.getByRole("region", { name: "Latest journals" });
    // Every journal reads "<event>: <whom>"; its references sit in the muted line.
    expect(within(recent).getByRole("link", { name: "Client payment received: Amira Hassan" })).toHaveAttribute("href", `/workspace/ledger/journals/${JOURNAL}?entity=${ENTITY}`);
    expect(within(recent).getByText(/RCPT-1 · STUD-JV-000004/)).toBeInTheDocument();
    expect(within(recent).getByRole("link", { name: "All journals" })).toHaveAttribute("href", `/workspace/ledger/journals?entity=${ENTITY}`);
  });

  it("says when tax lines have no region, so the VAT due leaves them out, with the way to set it", async () => {
    mount({ overview: { ...overview, balances: { ...overview.balances!, vatDue: "0.0000" }, vatMissingRegion: { lines: 3, label: "Emirate" } } });
    render(wrap(<LedgerArea workspaceId={WS} section="overview" sub={null} />));
    expect(await screen.findByText("3 tax lines have no Emirate")).toBeInTheDocument();
    expect(screen.getByText("They're in no box, so the tax due leaves them out.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set the Emirate" })).toHaveAttribute("href", "/workspace/settings/ledger");
  });

  it("switches tabs in place and shows the attention count", async () => {
    const user = userEvent.setup();
    mount();
    const history = vi.spyOn(window.history, "replaceState");
    render(wrap(<LedgerArea workspaceId={WS} section="overview" sub={null} />));
    expect(await screen.findByRole("tab", { name: /Needs attention.*3/ })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Reports/ }));
    expect(history).toHaveBeenLastCalledWith(null, "", "/workspace/ledger/reports");
    expect(await screen.findByRole("table", { name: "Profit and loss" })).toBeInTheDocument();
    history.mockRestore();
  });

  it("picks the report, company and period, keeping them in the address", async () => {
    const user = userEvent.setup();
    const fetcher = mount();
    const history = vi.spyOn(window.history, "replaceState");
    search = new URLSearchParams({ entity: ENTITY, from: "2026-01-01", to: "2026-10-08" });
    render(wrap(<LedgerArea workspaceId={WS} section="reports" sub="trial-balance" />));
    await screen.findByRole("table", { name: "Trial balance" });
    expect(String(fetcher.mock.calls.find(([url]) => String(url).includes("/trial-balance?"))?.[0])).toContain(`entity=${ENTITY}&from=2026-01-01&to=2026-10-08`);
    // The period reads as the preset it is.
    expect(screen.getByRole("button", { name: /Period/ })).toHaveTextContent("Year to date");
    await user.click(screen.getByRole("button", { name: /Report/ }));
    await user.click(await screen.findByRole("option", { name: "Balance sheet" }));
    expect(history).toHaveBeenLastCalledWith(null, "", `/workspace/ledger/reports/balance-sheet?entity=${ENTITY}&from=2026-01-01&to=2026-10-08`);
    await user.click(screen.getByRole("button", { name: /Company/ }));
    await user.click(await screen.findByRole("option", { name: "Studio Trading" }));
    expect(replace).toHaveBeenLastCalledWith(`/workspace/ledger/reports/balance-sheet?entity=${SECOND}`, { scroll: false });
    history.mockRestore();
  });

  it("drills from a report to the account's ledger, the journal and the record it came from", async () => {
    mount();
    search = new URLSearchParams({ entity: ENTITY, from: "2026-01-01", to: "2026-10-08" });
    const { unmount } = render(wrap(<LedgerArea workspaceId={WS} section="reports" sub="trial-balance" />));
    const grid = await screen.findByRole("table", { name: "Trial balance" });
    expect(within(grid).getByRole("link", { name: "Bank" })).toHaveAttribute("href", `/workspace/ledger/accounts/${BANK}?entity=${ENTITY}&from=2026-01-01&to=2026-10-08`);
    unmount();

    render(wrap(<LedgerArea workspaceId={WS} section="accounts" sub={BANK} />));
    const ledger = await screen.findByRole("table", { name: "General ledger" });
    expect(within(ledger).getByRole("link", { name: "STUD-JV-000004" })).toHaveAttribute("href", `/workspace/ledger/journals/${JOURNAL}?entity=${ENTITY}&from=2026-01-01&to=2026-10-08`);
    expect(within(ledger).getByRole("link", { name: "RCPT-1" })).toHaveAttribute("href", "/workspace/finance/client-invoices?invoice=1");
    expect(within(ledger).getByText("Opening balance")).toBeInTheDocument();
  });

  it("shows a journal with its lines, accounts and source", async () => {
    mount();
    render(wrap(<JournalSheet api={ledgerApi(WS)} journalId={JOURNAL} scope={{ entity: ENTITY, from: "", to: "" }} onClose={() => undefined} />));
    const lines = await screen.findByRole("table", { name: "Journal lines" });
    expect(within(lines).getByRole("link", { name: "1200 Trade receivables" })).toHaveAttribute("href", `/workspace/ledger/accounts/77777777-7777-4777-8777-777777777777?entity=${ENTITY}`);
    expect(within(lines).getByText(/Villa 12 Owner/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "RCPT-1" })).toHaveAttribute("href", "/workspace/finance/client-invoices?invoice=1");
  });

  it("lists a project's journals, and starts a manual journal or opens one a notice links to", async () => {
    const user = userEvent.setup();
    const fetcher = mount();
    search = new URLSearchParams({ project: "88888888-8888-4888-8888-888888888888" });
    const { unmount } = render(wrap(<LedgerArea workspaceId={WS} section="journals" sub={null} />));
    expect(await screen.findByRole("table", { name: "Journals" })).toBeInTheDocument();
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("/journals?") && String(url).includes("project=88888888-8888-4888-8888-888888888888"))).toBe(true));
    await user.click(screen.getByRole("button", { name: "New journal" }));
    expect(await screen.findByText(`Editor ${ENTITY} new`)).toBeInTheDocument();
    unmount();

    search = new URLSearchParams({ manual: JOURNAL });
    render(wrap(<LedgerArea workspaceId={WS} section="journals" sub={null} />));
    expect(await screen.findByText(`Editor ${ENTITY} ${JOURNAL}`)).toBeInTheDocument();
  });

  it("asks to turn the Ledger on when no company has it, and still gives the P&L and cash flow from where the books live", async () => {
    const user = userEvent.setup();
    const off = { entities: [], entity: null, canManage: true, canPost: true, openIssues: 0, balances: null, vatPeriod: null, fiscalYear: null };
    mount({ overview: off });
    const { unmount } = render(wrap(<LedgerArea workspaceId={WS} section="overview" sub={null} />));
    expect(await screen.findByText("The Ledger is off")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Turn on Ledger" })).toHaveAttribute("href", "/workspace/settings/ledger");
    expect(screen.getByRole("link", { name: "Profit and loss" })).toHaveAttribute("href", "/workspace/ledger/reports/profit-and-loss");
    unmount();
    render(wrap(<LedgerArea workspaceId={WS} section="reports" sub={null} />));
    expect(await screen.findByRole("table", { name: "Profit and loss" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Report/ }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["Profit and loss", "Cash flow"]);
  });

  it("doesn't offer turning it on to someone who can't set it up", async () => {
    mount({ overview: { entities: [], entity: null, canManage: false, canPost: false, openIssues: 0, balances: null, vatPeriod: null, fiscalYear: null } });
    render(wrap(<LedgerArea workspaceId={WS} section="overview" sub={null} />));
    expect(await screen.findByText("The Ledger is off")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("link", { name: "Turn on Ledger" })).not.toBeInTheDocument());
  });
});

describe("Ledger periods, access and navigation", () => {
  it("works out the presets from the company's day and financial year", () => {
    expect(presetPeriod("year", "2026-10-08", 1)).toEqual({ from: "2026-01-01", to: "2026-10-08" });
    expect(presetPeriod("year", "2026-03-08", 4)).toEqual({ from: "2025-04-01", to: "2026-03-08" });
    expect(presetPeriod("last-year", "2026-03-08", 4)).toEqual({ from: "2024-04-01", to: "2025-03-31" });
    expect(presetPeriod("last-quarter", "2026-02-10", 1)).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(presetPeriod("last-month", "2026-01-15", 1)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetOf("2026-10-01", "2026-10-08", "2026-10-08", 1)).toBe("month");
    expect(presetOf("2026-02-01", "2026-03-04", "2026-10-08", 1)).toBe("custom");
    // The calendar year is offered only when the financial year starts later than January.
    expect(periodPresets(1)).not.toContain("calendar-year");
    expect(periodPresets(4)).toContain("calendar-year");
    expect(presetPeriod("calendar-year", "2026-10-08", 4)).toEqual({ from: "2026-01-01", to: "2026-10-08" });
  });

  it("reads point-in-time reports at a date: today or the end of the last month, quarter or financial year", async () => {
    const user = userEvent.setup();
    const onScope = vi.fn();
    render(wrap(<ReportPicker entities={[main]} entity={main} scope={{ entity: ENTITY, from: "2026-01-01", to: "2026-10-08" }} onScope={onScope} pointInTime />));
    const asAt = screen.getByRole("button", { name: /As at/ });
    expect(asAt).toHaveTextContent("Today");
    await user.click(asAt);
    expect((await screen.findAllByRole("option")).map((option) => option.textContent))
      .toEqual(["Today", "End of last month", "End of last quarter", "End of last financial year", "Another date"]);
    await user.click(screen.getByRole("option", { name: "End of last month" }));
    expect(onScope).toHaveBeenLastCalledWith({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("opens the Ledger to books.view, by address too, with Settings › Ledger for whoever sets it up", () => {
    expect(canOpen("ledger", { permissions: ["books.view"] })).toBe(true);
    expect(canOpen("ledger", { permissions: ["payables.view"] })).toBe(false);
    expect(meetsRule(accessRuleForPath("/workspace/ledger/reports/vat"), { permissions: ["receivables.view"] })).toBe(false);
    expect(meetsRule(accessRuleForPath("/workspace/ledger/journals"), { permissions: ["books.view"] })).toBe(true);
    const scoped = (permissions: string[]) => scopeWorkspaceNavigation(workspaceModules, permissions, ["member"]);
    const sidebar = (permissions: string[]) => productNavigation(scoped(permissions)).flatMap((section) => section.items.map((item) => item.id));
    expect(sidebar(["books.view"])).toContain("ledger");
    expect(sidebar(["payables.view"])).not.toContain("ledger");
    const settings = (permissions: string[]) => scoped(permissions).flatMap((module) => module.navigation.flatMap((group) => group.items.map((item) => item.href)));
    expect(settings(["books.manage"])).toContain("/workspace/settings/ledger");
    expect(settings(["books.view"])).toContain("/workspace/settings/ledger");
    expect(settings(["payables.view"])).not.toContain("/workspace/settings/ledger");
    expect(resolveWorkspaceRoute(`/workspace/ledger/accounts/${BANK}`)).toMatchObject({ id: "ledger", nav: "ledger", settings: false });
    expect(resolveWorkspaceRoute("/workspace/settings/ledger")).toMatchObject({ id: "settings:ledger-settings", label: "Ledger", settings: true });
  });
});
