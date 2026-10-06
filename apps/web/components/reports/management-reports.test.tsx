import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/design-system";
import type { Dashboard } from "@/lib/reports/management";
import { ManagementReports, presetRange } from "./management-reports";
import { ReportTargetsSettings } from "./report-targets-settings";

const WS = "11111111-1111-4111-8111-111111111111";
const replace = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), usePathname: () => "/workspace/reports", useSearchParams: () => search }));

const dashboard: Dashboard = {
  dashboard: "owner-overview", currency: "USD", timeZone: "UTC", from: "2026-09-01", to: "2026-09-20", generatedAt: "2026-09-20T12:00:00Z",
  kpis: [
    { code: "sales_won", unit: "money", value: "38000.00", count: 3, amount: "38000.00", targetable: true, target: { target: "40000.0000", percent: "95.0", gap: "2000.0000", tone: "warning" },
      extra: { designValue: "18000.00", mainValue: "20000.00" },
      chart: { type: "columns", dimension: "month", seriesDimension: "series", categories: [{ key: "2026-08", label: "2026-08" }, { key: "2026-09", label: "2026-09" }],
        series: [{ id: "design", label: "Design Fee" }, { id: "main", label: "Proposal 2" }], values: [["0", "18000"], ["5000", "20000"]], unit: "money" } },
    { code: "profit_margin", unit: "percent", value: null, count: 0, targetable: true },
    { code: "outstanding", unit: "money", value: "26000.00", count: 2, targetable: false, notes: { amountsIncludeTax: true },
      chart: { type: "bars", dimension: "age", unit: "money", items: [{ key: "overdue_1_30", label: "overdue_1_30", value: "21000.00", count: 1 }] } },
    { code: "net_revenue", unit: "money", value: "8700.00", count: 3, amount: "8700.00", targetable: true, extra: { collected: "10000.00", refunded: "1300.00" } },
    { code: "cancellations_refunds", unit: "count", value: "2", count: 2, amount: "7200.00", targetable: false, extra: { refundCount: 2, refundValue: "1300.00" },
      chart: { type: "columns", dimension: "month", seriesDimension: "series", categories: [{ key: "2026-09", label: "2026-09" }],
        series: [{ id: "cancelled", label: "Cancelled" }, { id: "refund", label: "Refunded" }], values: [["7200"], ["1300"]], unit: "money" } },
  ],
};

function mount() {
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
    void _init;
    const path = new URL(url, "http://localhost").pathname;
    const body = path.endsWith("/options") ? { accountManagers: [{ id: "m1", label: "Ali Manager" }], enquiryTypes: [{ id: "full_id", label: "Full ID" }], packages: [], clientTypes: [],
        sources: [{ id: "website", label: "Website" }], channels: { website: [{ id: "form", label: "Form" }] }, regions: [{ id: "dubai", label: "Dubai" }], entities: [], countryCode: "AE" }
      : path.endsWith("/records") ? { total: 1, truncated: false, currency: "USD", records: [{ id: "o1", kind: "opportunity", reference: "O-17", title: "Villa", client: "Amira", owner: "Ali",
          ownerId: "m1", at: "2026-09-05T14:00:00Z", amount: "10000.000000", measure: null, detail: "design", href: "/workspace/crm/opportunities?record=o1" }] }
      : path.endsWith("/targets") ? { year: 2026, kpis: [{ code: "sales_won_value", unit: "money", direction: "higher", additive: true, perMember: true }, { code: "response_rate", unit: "percent", direction: "higher", additive: false, perMember: true }],
          targets: [{ id: "t1", kpi: "sales_won_value", month: "2026-01", membershipId: null, target: "60000", version: 1 }], accountManagers: [{ id: "m1", label: "Ali Manager" }] }
      : dashboard;
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("management dashboards", () => {
  beforeEach(() => { replace.mockClear(); search = new URLSearchParams(); });

  it("shows each KPI against its target, says when data is missing, and opens the records behind a figure", async () => {
    const user = userEvent.setup();
    const fetcher = mount();
    render(<ManagementReports workspaceId={WS} initialDashboard="owner-overview" />);
    const won = (await screen.findByRole("heading", { name: "Sales Won" })).closest("section") as HTMLElement;
    expect(won).toHaveAttribute("data-tone", "warning");
    expect(within(won).getByText("95%")).toBeInTheDocument();
    expect(within(won).getByText("$40,000")).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "Profit margin" }).closest("section") as HTMLElement).getByText("Not enough data yet")).toBeInTheDocument();
    expect(screen.getByText("Includes tax")).toBeInTheDocument();
    // Net revenue is collected less refunds; cancelled deals and refunds are their own figure (never in Won).
    expect(within(screen.getByRole("heading", { name: "Net revenue" }).closest("section") as HTMLElement).getByText("Collected $10,000 · Refunded $1,300")).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "Cancellations and refunds" }).closest("section") as HTMLElement)
      .getByText("$7,200 cancelled · 2 refunds paid, $1,300")).toBeInTheDocument();
    // The period is this month to date by default; the server receives it.
    expect(String(fetcher.mock.calls.find(([url]) => String(url).includes("/owner-overview?"))?.[0])).toMatch(/from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}/);

    await user.click(within(won).getByRole("button", { name: "Sep 26 · Design Fee: $18K. Open the records" }));
    expect(await screen.findByRole("link", { name: "O-17" })).toHaveAttribute("href", "/workspace/crm/opportunities?record=o1");
    const records = String(fetcher.mock.calls.find(([url]) => String(url).includes("/records?"))?.[0]);
    expect(decodeURIComponent(records)).toContain("bucket=month=2026-09;series=design");
    expect(records).toContain("kpi=sales_won");
  });

  it("keeps the filters in the address", async () => {
    const user = userEvent.setup();
    mount();
    render(<ManagementReports workspaceId={WS} initialDashboard="owner-overview" />);
    await screen.findByRole("heading", { name: "Sales Won" });
    await user.click(screen.getByRole("button", { name: /Account Manager/ }));
    await user.click(await screen.findByRole("option", { name: "Ali Manager" }));
    expect(replace).toHaveBeenCalledWith("/workspace/reports?accountManager=m1", { scroll: false });
    await user.click(screen.getByRole("button", { name: "Sales and pipeline" }));
    expect(replace).toHaveBeenLastCalledWith("/workspace/reports/sales-pipeline", { scroll: false });
  });

  it("works out the period presets from the local day", () => {
    expect(presetRange("month", "2026-09-20")).toEqual({ from: "2026-09-01", to: "2026-09-20" });
    expect(presetRange("last-month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("quarter", "2026-08-15")).toEqual({ from: "2026-07-01", to: "2026-08-15" });
    expect(presetRange("last-12", "2026-09-20")).toEqual({ from: "2025-10-01", to: "2026-09-20" });
  });
});

describe("report targets settings", () => {
  it("edits a month's target and saves only what changed, with its version", async () => {
    const user = userEvent.setup();
    const fetcher = mount();
    render(<ToastProvider><ReportTargetsSettings workspaceId={WS} /></ToastProvider>);
    const grid = await screen.findByRole("table", { name: "Report targets" });
    const row = within(grid).getByText("Sales Won – value").closest("tr") as HTMLElement;
    await user.dblClick(within(row).getByText("60000"));
    const input = within(row).getByRole("textbox");
    await user.clear(input);
    await user.type(input, "65000{Enter}");
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT")).toBe(true));
    const put = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT")!;
    expect(JSON.parse(String((put[1] as RequestInit).body)).changes).toEqual([{ kpi: "sales_won_value", month: "2026-01", membershipId: null, target: "65000", version: 1 }]);
  });
});
