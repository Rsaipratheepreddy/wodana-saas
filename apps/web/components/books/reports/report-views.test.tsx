import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { ledgerApi, type AgeingReport, type ProfitAndLossReport, type ReportEntity, type VatReport } from "@/lib/books/reports-client";
import { AgeingView, ProfitAndLossView, VatView } from "./report-views";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/ledger", useSearchParams: () => new URLSearchParams() }));

const WS = "11111111-1111-4111-8111-111111111111";
const ENTITY = "22222222-2222-4222-8222-222222222222";
const entity: ReportEntity = { id: ENTITY, code: "MAIN", name: "Studio Interiors", currency: "AED", locale: "en-AE", countryCode: "AE", timeZone: "Asia/Dubai", enabled: true,
  fiscalYearStartMonth: 1, startDate: "2026-01-01", lockDate: null, templateCode: "AE", templateVersion: 1, today: "2026-10-31" };
const scope = { entity: ENTITY, from: "2026-10-01", to: "2026-10-31" };
const base = { scope: { legalEntityId: ENTITY, from: "2026-10-01", to: "2026-10-31" }, entity, generatedAt: "2026-10-31T00:00:00Z" };
const wrap = (node: React.ReactNode) => <DesignSystemProvider locale="en-AE" currency="AED">{node}</DesignSystemProvider>;

describe("Ledger report views", () => {
  it("lays out the P&L with its subtotals, each account opening its ledger", () => {
    const report: ProfitAndLossReport = { ...base, report: "profit-and-loss",
      sections: [
        { key: "revenue", label: "Revenue", lines: [{ accountId: "a1", code: "4100", name: "Project revenue", amount: "160000.0000" }], sections: [], total: "160000.0000" },
        { key: "cost_of_sales", label: "Cost of sales", lines: [{ accountId: "a2", code: "5100", name: "Project materials", amount: "13000.0000" }], sections: [], total: "13000.0000" },
        { key: "operating_expenses", label: "Operating expenses", lines: [], sections: [], total: "0.0000" },
        { key: "other_income", label: "Other income", lines: [], sections: [], total: "0.0000" },
        { key: "other_expenses", label: "Other expenses", lines: [], sections: [], total: "0.0000" },
      ],
      totals: { revenue: "160000.0000", costOfSales: "13000.0000", grossProfit: "147000.0000", operatingExpenses: "0.0000", operatingProfit: "147000.0000", otherIncome: "0.0000",
        otherExpenses: "0.0000", netProfit: "147000.0000" } };
    render(wrap(<ProfitAndLossView report={report} scope={scope} />));
    const grid = screen.getByRole("table", { name: "Profit and loss" });
    expect(within(grid).getByRole("link", { name: "4100 Project revenue" })).toHaveAttribute("href", `/workspace/ledger/accounts/a1?entity=${ENTITY}&from=2026-10-01&to=2026-10-31`);
    const gross = within(grid).getByText("Gross profit").closest("tr") as HTMLElement;
    expect(within(gross).getByText("147,000.00")).toBeInTheDocument();
    expect(within(grid).getByText("Net profit")).toBeInTheDocument();
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
    expect(within(grid).getByRole("link", { name: "1200 Trade receivables" })).toHaveAttribute("href", `/workspace/ledger/accounts/ar?entity=${ENTITY}&from=2026-10-01&to=2026-10-31`);
  });
});
