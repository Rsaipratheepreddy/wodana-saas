import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { ledgerApi, type AgeingReport, type BalanceSheetReport, type ReportEntity, type TrialBalanceReport, type VatReport } from "@/lib/books/reports-client";
import { AgeingView, BalanceSheetView, TrialBalanceView, VatView } from "./report-views";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/ledger", useSearchParams: () => new URLSearchParams() }));

const WS = "11111111-1111-4111-8111-111111111111";
const ENTITY = "22222222-2222-4222-8222-222222222222";
const entity: ReportEntity = { id: ENTITY, code: "MAIN", name: "Studio Interiors", currency: "AED", locale: "en-AE", countryCode: "AE", timeZone: "Asia/Dubai", enabled: true,
  fiscalYearStartMonth: 1, startDate: "2026-01-01", lockDate: null, templateCode: "AE", templateVersion: 1, today: "2026-10-31" };
const scope = { entity: ENTITY, from: "2026-10-01", to: "2026-10-31" };
const base = { scope: { legalEntityId: ENTITY, from: "2026-10-01", to: "2026-10-31" }, entity, generatedAt: "2026-10-31T00:00:00Z" };
const wrap = (node: React.ReactNode) => <DesignSystemProvider locale="en-AE" currency="AED">{node}</DesignSystemProvider>;

describe("Ledger report views", () => {
  it("lays out the trial balance as a statement: accounts by type, subtotals, the total under a double rule, each account opening its ledger", () => {
    const report: TrialBalanceReport = { ...base, report: "trial-balance", balanced: true, fiscalYearStart: "2026-01-01",
      rows: [
        { accountId: "a1", code: "1100", name: "Bank", type: "asset", subtype: "bank", opening: "0.0000", debit: "120500.0000", credit: "2000.0000", closing: "118500.0000" },
        { accountId: "a2", code: "4100", name: "Project revenue", type: "income", subtype: "revenue", opening: "0.0000", debit: "0.0000", credit: "118500.0000", closing: "-118500.0000" },
      ],
      totals: { opening: "0.0000", debit: "120500.0000", credit: "120500.0000", closing: "0.0000" } };
    render(wrap(<TrialBalanceView report={report} scope={scope} />));
    const table = screen.getByRole("table", { name: "Trial balance" });
    expect(within(table).getByRole("link", { name: "Bank" })).toHaveAttribute("href", `/workspace/ledger/accounts/a1?entity=${ENTITY}&from=2026-10-01&to=2026-10-31`);
    const income = within(table).getByText("Total income").closest("tr") as HTMLElement;
    expect(income).toHaveAttribute("data-kind", "subtotal");
    // A credit balance reads the locale's accounting way, in brackets, and is marked negative.
    expect(within(income).getByText("(118,500.00)")).toHaveAttribute("data-negative");
    const total = within(table).getByText("Total").closest("tr") as HTMLElement;
    expect(total).toHaveAttribute("data-kind", "result");
    expect(within(total).getAllByText("120,500.00")).toHaveLength(2);
    expect(within(total).getAllByText("–")).toHaveLength(2);
  });

  it("lays out the balance sheet with sub-sections opening to their accounts", async () => {
    const user = userEvent.setup();
    const report: BalanceSheetReport = { ...base, report: "balance-sheet", balanced: true, currentYearEarnings: "100.0000", retainedEarnings: "0.0000", fiscalYearStart: "2026-01-01",
      sections: [
        { key: "assets", label: "Assets", lines: [], total: "1100.0000", sections: [
          { key: "current_assets", label: "Current assets", lines: [{ accountId: "bank", code: "1100", name: "Bank", amount: "1100.0000" }], sections: [], total: "1100.0000" },
          { key: "non_current_assets", label: "Non-current assets", lines: [], sections: [], total: "0.0000" }] },
        { key: "liabilities", label: "Liabilities", lines: [], total: "1000.0000", sections: [
          { key: "current_liabilities", label: "Current liabilities", lines: [{ accountId: "ap", code: "2100", name: "Trade payables", amount: "1000.0000" }], sections: [], total: "1000.0000" }] },
        { key: "equity", label: "Equity", lines: [{ accountId: null, code: null, name: "Current year earnings", amount: "100.0000" }], sections: [], total: "100.0000" },
      ],
      totals: { assets: "1100.0000", liabilities: "1000.0000", equity: "100.0000", liabilitiesAndEquity: "1100.0000" } };
    render(wrap(<BalanceSheetView report={report} scope={scope} />));
    const table = screen.getByRole("table", { name: "Balance sheet" });
    expect(within(table).getByRole("link", { name: "Bank" })).toBeInTheDocument();
    expect(within(table).queryByText("Non-current assets")).not.toBeInTheDocument();
    await user.click(within(table).getByRole("button", { name: "Hide the lines of Current assets" }));
    expect(within(table).queryByRole("link", { name: "Bank" })).not.toBeInTheDocument();
    expect(within(within(table).getByText("Total liabilities and equity").closest("tr") as HTMLElement).getByText("1,100.00")).toBeInTheDocument();
  });

  it("shows the VAT return boxes, the review list, and the lines behind a box", async () => {
    const user = userEvent.setup();
    const report: VatReport = { ...base, report: "vat", layout: { code: "AE_VAT201", name: "VAT return (VAT 201)", regionLabel: "Emirate" }, lines: null,
      boxes: [
        { box: "1b", label: "Standard rated supplies in Dubai", section: "sales", amount: "120000.0000", vat: "6000.0000", adjustment: "0.0000", computed: false },
        { box: "14", label: "Payable tax for the period", section: "net", amount: null, vat: "7500.0000", adjustment: null, computed: true },
      ],
      review: [{ reason: "foreign_supplier_without_reverse_charge", journalId: "j9", journalNumber: "MAIN-JV-000011", journalDate: "2026-10-12", accountCode: null, accountName: null,
        taxCode: null, partyName: "Milan Lighting", amount: "3000.0000", sourceLabel: "BILL-NORC", sourceHref: "/workspace/finance?bill=9" }] };
    const fetcher = vi.fn(async (url: string) => ({ url, ok: true, status: 200, json: async () => ({ ...report, lines: [{ box: "1b", lineId: "l1", journalId: "j1", journalNumber: "MAIN-JV-000004",
      journalDate: "2026-10-05", accountId: "v", accountCode: "2200", accountName: "VAT output", taxCode: "SR", region: "DXB", amount: "100000.0000", vat: "5000.0000",
      sourceLabel: "INV-1", sourceHref: "/workspace/finance/client-invoices?invoice=1" }] }) }));
    vi.stubGlobal("fetch", fetcher);
    render(wrap(<VatView report={report} scope={scope} api={ledgerApi(WS)} />));
    const boxes = screen.getByRole("table", { name: "VAT return (VAT 201)" });
    expect(within(within(boxes).getByText("Payable tax for the period").closest("tr") as HTMLElement).getByText("7,500.00")).toBeInTheDocument();
    const review = screen.getByRole("table", { name: "To review" });
    expect(within(review).getByText("Supplier abroad without reverse charge")).toBeInTheDocument();
    expect(within(review).getByRole("link", { name: "BILL-NORC" })).toHaveAttribute("href", "/workspace/finance?bill=9");
    await user.click(within(boxes).getByText("Standard rated supplies in Dubai"));
    const lines = await screen.findByRole("table", { name: "Box 1b" });
    await waitFor(() => expect(within(lines).getByRole("link", { name: "MAIN-JV-000004" })).toHaveAttribute("href", `/workspace/ledger/journals/j1?entity=${ENTITY}&from=2026-10-01&to=2026-10-31`));
    expect(fetcher.mock.calls[0]?.[0]).toContain("box=1b");
  });

  it("reconciles ageing to the control account with the line not linked to a party", () => {
    const zero = { current: "0.0000", "1_30": "0.0000", "31_60": "0.0000", "61_90": "0.0000", over_90: "0.0000" };
    const report: AgeingReport = { ...base, report: "ar-ageing", side: "receivable", reconciled: true, unlinked: "1000.0000",
      rows: [{ partyType: "client", partyId: "c", partyName: "Office Co", buckets: { ...zero, "1_30": "62000.0000" }, total: "62000.0000" }],
      totals: { ...zero, "1_30": "62000.0000", total: "62000.0000" }, control: { accountId: "ar", code: "1200", name: "Trade receivables", balance: "63000.0000" } };
    render(wrap(<AgeingView report={report} scope={scope} />));
    const grid = screen.getByRole("table", { name: "Receivables ageing" });
    expect(within(within(grid).getByText("Not linked to a party").closest("tr") as HTMLElement).getByText("1,000.00")).toBeInTheDocument();
    expect(within(grid).getByRole("link", { name: "Trade receivables" })).toHaveAttribute("href", `/workspace/ledger/accounts/ar?entity=${ENTITY}&from=2026-10-01&to=2026-10-31`);
  });
});
