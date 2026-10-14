import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/design-system";
import type { Dashboard, DashboardId, Kpi } from "@/lib/reports/management";
import { chartHasData, chartRows, ManagementReports, presetRange } from "./management-reports";
import { ReportTargetsSettings } from "./report-targets-settings";

const WS = "11111111-1111-4111-8111-111111111111";
const replace = vi.fn();
const ask = vi.fn();
let search = new URLSearchParams();
let aiEnabled = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), usePathname: () => "/workspace/reports", useSearchParams: () => search }));
vi.mock("@/components/crm/woddy-chat", () => ({ useWoddy: () => ({ ask }) }));

const previous = (value: string | null, change: string | null, better: "higher" | "lower" | "neutral" = "higher") => ({ from: "2026-08-01", to: "2026-08-20", value, change, better });
const page = (dashboard: DashboardId, kpis: Kpi[], layout: Dashboard["layout"], attention: Dashboard["attention"] = null): Dashboard => ({
  dashboard, currency: "USD", timeZone: "UTC", from: "2026-09-01", to: "2026-09-20", generatedAt: "2026-09-20T12:00:00Z", kpis, layout, attention,
});

const DASHBOARDS: Record<string, Dashboard> = {
  "owner-overview": page("owner-overview", [
    { code: "sales_won", unit: "money", value: "38000.00", count: 3, amount: "38000.00", targetable: true, target: { target: "40000.0000", percent: "95.0", gap: "2000.0000", tone: "warning" },
      previous: previous("19000.00", "100.0"),
      chart: { type: "columns", dimension: "month", seriesDimension: "series", categories: [{ key: "2026-08", label: "2026-08" }, { key: "2026-09", label: "2026-09" }],
        series: [{ id: "design", label: "Design Fee" }, { id: "main", label: "Proposal 2" }], values: [["0", "18000"], ["5000", "20000"]], unit: "money" } },
    { code: "revenue_collected", unit: "money", value: "10000.00", count: 2, targetable: true, previous: previous("12000.00", "-16.7") },
    { code: "deals_closed", unit: "count", value: "1", count: 1, amount: "30000.00", targetable: true, previous: previous("1", "0.0") },
    { code: "profit_margin", unit: "percent", value: null, count: 0, targetable: true, previous: previous(null, null) },
    { code: "active_projects", unit: "count", value: "0", count: 0, targetable: false,
      chart: { type: "bars", dimension: "stage", unit: "count", items: [{ key: "design", label: "design", value: "0", count: 0 }] } },
    { code: "delayed_items", unit: "count", value: "1", count: 1, targetable: false, chart: { type: "list", bucket: "period=1" } },
  ], { tiles: ["sales_won", "revenue_collected", "deals_closed", "profit_margin"], charts: ["sales_won", "active_projects"], attention: "delayed_items" },
  { kpi: "delayed_items", total: 1, records: [{ id: "p1", kind: "project", reference: "PRJ-1", title: "Villa", client: "Amira", owner: "Ali", ownerId: "m1",
    at: "2026-09-15T00:00:00Z", amount: null, measure: "5", detail: "promise_date", href: "/workspace/projects/p1/overview" }] }),
  // PLM-131: every KPI on Palm's tab.
  "production-delivery": page("production-delivery", [
    { code: "late_work_orders", unit: "count", value: "4", count: 4, targetable: false, extra: { clientDate: 3 }, chart: { type: "list", bucket: "period=1" } },
    { code: "ready_upcoming", unit: "count", value: "4", count: 4, targetable: false, extra: { thisWeek: 3, nextWeek: 1 },
      chart: { type: "columns", dimension: "day", seriesDimension: "state", categories: [{ key: "2026-09-14", label: "2026-09-14" }, { key: "2026-09-15", label: "2026-09-15" }],
        series: [{ id: "ready", label: "" }, { id: "planned", label: "" }], values: [["0", "1"], ["1", "0"]], unit: "count" } },
    { code: "open_snags", unit: "count", value: "3", count: 3, targetable: false, extra: { over30: 1 },
      chart: { type: "columns", dimension: "projectGroup", seriesDimension: "age", categories: [{ key: "p1", label: "PRJ-1" }],
        series: [{ id: "days_0_7", label: "" }, { id: "days_8_30", label: "" }, { id: "days_31_plus", label: "" }], values: [["1"], ["1"], ["1"]], unit: "count" } },
    { code: "fo_lead_time", unit: "percent", value: "50.0", count: 2, targetable: true, target: { target: "80.0000", percent: "62.5", gap: "30.0000", tone: "danger" },
      previous: previous(null, null),
      chart: { type: "bars", dimension: "path", unit: "days", items: [{ key: "take_home_now", label: "", value: "1.0", count: 1, extra: { target: "0.0", onTime: "0.0" } },
        { key: "in_stock_delivery", label: "", value: "4.0", count: 1, extra: { target: "4.0", onTime: "100.0" } }] } },
    { code: "work_orders_status", unit: "count", value: "7", count: 7, targetable: false,
      chart: { type: "columns", dimension: "step", seriesDimension: "late", categories: [{ key: "scheduled", label: "" }, { key: "ready", label: "Ready to send" }],
        series: [{ id: "on_track", label: "" }, { id: "late", label: "" }], values: [["0", "3"], ["1", "0"]], unit: "count" } },
    { code: "bookings", unit: "count", value: "2", count: 2, targetable: false,
      chart: { type: "calendar", dimension: "day", seriesDimension: "kind", month: "2026-09", weekStart: 1,
        entries: [{ day: "2026-09-18", series: "delivery", count: 1 }, { day: "2026-09-18", series: "installation", count: 1 }] } },
    { code: "production_attention", unit: "count", value: "6", count: 6, targetable: false, chart: { type: "list", bucket: "period=1" } },
  ], { tiles: ["late_work_orders", "ready_upcoming", "open_snags", "fo_lead_time"], charts: ["work_orders_status", "ready_upcoming", "bookings", "open_snags", "fo_lead_time"],
    attention: "production_attention" },
  { kpi: "production_attention", total: 6, records: [{ id: "x:1", kind: "project", reference: "PRJ-2", title: "access · N-1", client: "Amira", owner: "Sara", ownerId: "m2",
    at: "2026-09-10T00:00:00Z", amount: null, measure: "10", detail: "permit_expired", href: "/workspace/projects/p2/overview" }] }),
  "sales-pipeline": page("sales-pipeline", [
    { code: "new_leads", unit: "count", value: "5", count: 5, targetable: true, previous: previous("4", "25.0") },
  ], { tiles: ["new_leads"], charts: [], attention: "sales_attention" },
  { kpi: "sales_attention", total: 2, records: [
    { id: "o5", kind: "opportunity", reference: "O-5", title: "Job O5", client: "Amira", owner: "Ali", ownerId: "m1", at: "2026-09-02T15:00:00Z", amount: null, measure: "18", detail: "stuck_deal",
      href: "/workspace/crm/opportunities?record=o5" },
    { id: "o5", kind: "opportunity", reference: "O-5", title: "Job O5", client: "Amira", owner: "Ali", ownerId: "m1", at: "2026-09-19T14:00:00Z", amount: null, measure: "1",
      detail: "follow_up_overdue", href: "/workspace/crm/opportunities?record=o5" }] }),
  // PLM-132: every KPI on Palm's tab, with two lists.
  finance: {
    ...page("finance", [
      { code: "cash_collected", unit: "money", value: "29000.00", count: 4, amount: "29000.00", targetable: true, target: { target: "30000.0000", percent: "96.7", gap: "1000.0000", tone: "warning" },
        extra: { invoiced: "30000.00" }, previous: previous("1000.00", "2800.0") },
      { code: "refunds", unit: "count", value: "2", count: 2, amount: "1300.00", targetable: false, previous: previous("1", "100.0", "lower"),
        chart: { type: "bars", dimension: "reason", unit: "count", items: [{ key: "damaged", label: "Damaged", value: "1", count: 1, amount: "300.00" }] } },
      { code: "joinery_balances_due", unit: "money", value: "5000.00", count: 1, targetable: false, extra: { overdue: 1 }, notes: { amountsIncludeTax: true }, chart: { type: "list", bucket: "period=1" } },
      { code: "payables_due", unit: "money", value: "6800.00", count: 3, targetable: false, extra: { overdueCount: 1 }, notes: { amountsIncludeTax: true } },
      { code: "collected_invoiced", unit: "money", value: "29000.00", count: 4, targetable: false,
        chart: { type: "columns", dimension: "month", seriesDimension: "entity", categories: [{ key: "2026-08", label: "2026-08" }, { key: "2026-09", label: "2026-09" }],
          series: [{ id: "e1", label: "Studio" }], values: [["1000.00", "29000.00"]], unit: "money", line: { id: "invoiced", label: "", values: ["0.00", "30000.00"] } } },
      { code: "receivables_ageing", unit: "money", value: "16000.00", count: 2, targetable: false, notes: { amountsIncludeTax: true },
        chart: { type: "columns", dimension: "age", seriesDimension: "entity", categories: [{ key: "not_due", label: "not_due" }, { key: "overdue_1_30", label: "overdue_1_30" }],
          series: [{ id: "e1", label: "Studio" }], values: [["5000.00", "11000.00"]], unit: "money" } },
      { code: "finance_requests_open", unit: "count", value: "2", count: 2, targetable: false,
        chart: { type: "columns", dimension: "kind", seriesDimension: "wait", categories: [{ key: "invoice", label: "invoice" }, { key: "payable", label: "payable" }],
          series: [{ id: "days_0_2", label: "" }, { id: "days_8_plus", label: "" }], values: [["1", "0"], ["0", "1"]], unit: "count" } },
      { code: "commissions", unit: "money", value: "820.00", count: 3, targetable: false, notes: { notRecorded: "commission_payments" },
        chart: { type: "bars", dimension: "am", unit: "money", items: [{ key: "m1", label: "Ali Manager", value: "720.00", count: 2 }] } },
    ], { tiles: ["cash_collected", "refunds", "joinery_balances_due", "payables_due"], charts: ["collected_invoiced", "receivables_ageing", "finance_requests_open", "refunds", "commissions"],
      attention: null, lists: ["joinery_balances_due", "payables_due"] }),
    lists: [
      { kpi: "joinery_balances_due", total: 1, records: [{ id: "p1:Balance", kind: "project_money", reference: "PRJ-1", title: "Balance", client: "Amira", owner: "Ali", ownerId: "m1",
        at: "2026-09-18T04:00:00Z", amount: "5000.000000", measure: "2", detail: "overdue", href: "/workspace/projects/p1/money" }] },
      { kpi: "payables_due", total: 6, records: [{ id: "r2", kind: "finance_request", reference: "FR-0002", title: "Timber Co", client: null, owner: null, ownerId: null,
        at: "2026-09-05T14:00:00Z", amount: "800.000000", measure: null, detail: "requested", href: "/workspace/finance/requests?request=r2" }] },
    ],
  },
  // PLM-133: every KPI on Palm's tab, with the low stock list.
  stock: {
    ...page("stock", [
      { code: "low_stock", unit: "count", value: "1", count: 1, targetable: false, extra: { short: 1 },
        chart: { type: "bars", dimension: "level", unit: "count", items: [{ key: "short", label: "short", value: "1", count: 1 }] } },
      { code: "reserved_available", unit: "money", value: "700.00", count: 2, targetable: false, extra: { available: "3200.00" },
        chart: { type: "columns", dimension: "place", seriesDimension: "series", categories: [{ key: "w1", label: "Core Collection" }, { key: "s1", label: "Showroom" }],
          series: [{ id: "reserved", label: "" }, { id: "available", label: "" }], values: [["700.00", "0.00"], ["2800.00", "400.00"]], unit: "money" } },
      { code: "best_sellers", unit: "money", value: "2000.00", count: 2, targetable: false, previous: previous("0.00", null),
        chart: { type: "bars", dimension: "item", unit: "money", items: [{ key: "k1", label: "Sofa", value: "1700.00", count: 1, extra: { quantity: "2" } }] } },
      { code: "lead_source_won", unit: "money", value: "30000.00", count: 2, targetable: true, target: { target: "26666.6667", percent: "112.5", gap: "-3333.3333", tone: "success" },
        previous: previous("0.00", null) },
      { code: "lead_sources", unit: "money", value: "30000.00", count: 3, targetable: false,
        chart: { type: "bars", dimension: "pairGroup", unit: "money", items: [{ key: "website/form", label: "", value: "30000.00", count: 2, extra: { leads: 2, won: 2 } }] } },
      { code: "form_links", unit: "count", value: "2", count: 2, targetable: false,
        chart: { type: "bars", dimension: "linkGroup", unit: "count", items: [{ key: "f1|showroom-door", label: "Website enquiry · showroom-door", value: "1", count: 1 }] } },
      { code: "spam_by_source", unit: "count", value: "0", count: 0, targetable: false, chart: { type: "bars", dimension: "sourceChannel", unit: "count", items: [] } },
    ], { tiles: ["low_stock", "reserved_available", "best_sellers", "lead_source_won"], charts: ["reserved_available", "best_sellers", "lead_sources", "form_links", "spam_by_source"],
      attention: null, lists: ["low_stock"] }),
    lists: [{ kpi: "low_stock", total: 1, records: [{ id: "s1:p1", kind: "stock_item", reference: "SKU-Hinge", title: "Hinge", client: null, owner: null, ownerId: null, at: null,
      amount: null, measure: "8.0000", detail: null, href: "/workspace/inventory/history?item=s1" }] }],
  },
};

function mount() {
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
    void _init;
    const path = new URL(url, "http://localhost").pathname;
    const body = path.endsWith("/ai-settings") ? { enabled: aiEnabled, available: true, version: 1 }
      : path.endsWith("/options") ? { accountManagers: [{ id: "m1", label: "Ali Manager" }], enquiryTypes: [{ id: "full_id", label: "Full ID" }], packages: [], clientTypes: [],
        sources: [{ id: "website", label: "Website" }], channels: {}, regions: [{ id: "dubai", label: "Dubai" }], entities: [{ id: "e1", label: "Studio" }, { id: "e2", label: "Factory Co" }], countryCode: "AE" }
      : path.endsWith("/records") ? { total: 1, truncated: false, currency: "USD", records: [{ id: "o1", kind: "opportunity", reference: "O-17", title: "Villa", client: "Amira", owner: "Ali",
          ownerId: "m1", at: "2026-09-05T14:00:00Z", amount: "10000.000000", measure: null, detail: "design", href: "/workspace/crm/opportunities?record=o1" }] }
      : path.endsWith("/targets") ? { year: 2026, kpis: [{ code: "sales_won_value", unit: "money", direction: "higher", additive: true, perMember: true }, { code: "response_rate", unit: "percent", direction: "higher", additive: false, perMember: true }],
          targets: [{ id: "t1", kpi: "sales_won_value", month: "2026-01", membershipId: null, target: "60000", version: 1 }], accountManagers: [{ id: "m1", label: "Ali Manager" }] }
      : DASHBOARDS[path.split("/").pop() ?? ""];
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const tile = (name: string) => screen.getByRole("heading", { name }).closest("section") as HTMLElement;

describe("management dashboards", () => {
  beforeEach(() => { replace.mockClear(); search = new URLSearchParams(); });

  it("QA-009: renders the same markup on the server and in the first client render; the print period follows once hydrated", async () => {
    mount();
    // The server knows neither the browser's clock nor its date formatting ("1 – 12 Oct" in Node, "1–12 Oct" in a browser).
    const html = renderToString(<ManagementReports workspaceId={WS} initialDashboard="owner-overview" />);
    expect(html).toMatch(/<p class="[^"]*printPeriod[^"]*"><\/p>/);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => { hydrateRoot(container, <ManagementReports workspaceId={WS} initialDashboard="owner-overview" />, { onRecoverableError: (error) => { throw error; } }); });
    expect(errors.mock.calls.filter(([message]) => /hydrat/i.test(String(message)))).toEqual([]);
    await waitFor(() => expect(container.querySelector("p[class*=printPeriod]")).toHaveTextContent(/^Overview · /));
    errors.mockRestore();
    container.remove();
  });

  it("shows four figures against the period before, two charts and the list that needs attention", async () => {
    const user = userEvent.setup();
    const fetcher = mount();
    render(<ManagementReports workspaceId={WS} initialDashboard="owner-overview" />);
    const won = (await screen.findByRole("heading", { name: "Sales won" })).closest("section") as HTMLElement;
    // Compact money in the figure; the target in one line; up 100 % on 1–20 August, good news.
    expect(within(won).getByRole("button", { name: "Sales won. Open the records" })).toHaveTextContent("$38K");
    expect(won).toHaveAttribute("data-tone", "warning");
    expect(within(won).getByText("95%")).toBeInTheDocument();
    expect(within(won).getByText(/^100% vs /).closest("small")).toHaveAttribute("title", expect.stringMatching(/^Was \$19K in /));
    expect(within(won).getByText(/^100% vs /).closest("small")).toHaveAttribute("data-tone", "success");
    expect(within(tile("Revenue collected")).getByText(/^16\.7% vs /).closest("small")).toHaveAttribute("data-tone", "danger");
    expect(within(tile("Profit margin")).getByText("Not enough data yet")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Sales won", "Revenue collected", "Deals closed", "Profit margin", "Sales won by month", "Projects by stage", "Needs attention · 1"]);
    // A chart with nothing to show says so and points to where the work starts.
    const stages = tile("Projects by stage");
    expect(within(stages).getByText("Nothing to show for this period")).toBeInTheDocument();
    expect(within(stages).getByRole("link", { name: "Open opportunities" })).toHaveAttribute("href", "/workspace/crm/opportunities");
    // The attention list links each record.
    expect(within(tile("Needs attention · 1")).getByRole("link", { name: "PRJ-1" })).toHaveAttribute("href", "/workspace/projects/p1/overview");
    // The period is this month to date by default; the server receives it.
    expect(String(fetcher.mock.calls.find(([url]) => String(url).includes("/owner-overview?"))?.[0])).toMatch(/from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}/);

    await user.click(within(tile("Sales won by month")).getByRole("button", { name: "Sep 26 · Design fee: $18K. Open the records" }));
    expect(await screen.findByRole("link", { name: "O-17" })).toHaveAttribute("href", "/workspace/crm/opportunities?record=o1");
    const records = String(fetcher.mock.calls.find(([url]) => String(url).includes("/records?"))?.[0]);
    expect(decodeURIComponent(records)).toContain("bucket=month=2026-09;series=design");
    expect(records).toContain("kpi=sales_won");
  });

  it("PLM-131: shows every Production and delivery KPI with its graph, and names why each thing needs attention", async () => {
    const user = userEvent.setup();
    const fetcher = mount();
    render(<ManagementReports workspaceId={WS} initialDashboard="production-delivery" />);
    const list = (await screen.findByRole("heading", { name: "Needs attention · 6" })).closest("section") as HTMLElement;
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent).filter((text) => !/\d{4}$/.test(text ?? ""))).toEqual([
      "Late jobs", "Ready this week and next", "Open snags", "Furniture Only on target",
      "Production schedule", "Ready this week and next", "Deliveries and installations", "Open snags by age", "Furniture Only lead time by path", "Needs attention · 6"]);
    // Late jobs is a red figure; its records open from it.
    expect(tile("Late jobs")).toHaveAttribute("data-tone", "danger");
    const [ready, timeline] = screen.getAllByRole("heading", { name: "Ready this week and next" }).map((heading) => heading.closest("section") as HTMLElement);
    expect(within(ready).getByText("3 this week · 1 next week")).toBeInTheDocument();
    expect(within(timeline).getByRole("button", { name: "Sep 15 · Ready: 1. Open the records" })).toBeInTheDocument();
    expect(within(tile("Open snags")).getByText("1 over 30 days")).toBeInTheDocument();
    // Furniture Only on target against its target: 62.5 %, red; each path against its own lead time.
    const onTarget = tile("Furniture Only on target");
    expect(onTarget).toHaveAttribute("data-tone", "danger");
    expect(within(onTarget).getByText("62.5%")).toBeInTheDocument();
    const paths = tile("Furniture Only lead time by path");
    expect(within(paths).getByRole("button", { name: "A · Take home now: 1 days. Open the records" })).toBeInTheDocument();
    expect(paths.querySelectorAll(".wd-ranked-bars-target")).toHaveLength(2);
    expect(within(paths).getByText("Target")).toBeInTheDocument();
    // The production schedule keeps the firm's own word for a step, on track against late.
    const schedule = tile("Production schedule");
    expect(within(schedule).getAllByText("Ready to send").length).toBeGreaterThan(0);
    expect(within(schedule).getByRole("button", { name: "Scheduled · Late: 1. Open the records" })).toBeInTheDocument();
    // The logistics calendar: a day's chips, and the day opens what is booked on it.
    const calendar = tile("Deliveries and installations");
    expect(within(calendar).getByText("Delivery · 1")).toBeInTheDocument();
    expect(within(calendar).getByText("Installation · 1")).toBeInTheDocument();
    await user.click(within(calendar).getByRole("button", { name: /18.* · 2 items$/ }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => decodeURIComponent(String(url)).includes("kpi=bookings&bucket=day=2026-09-18"))).toBe(true));
    await user.keyboard("{Escape}");
    expect(within(list).getByText("Permit expired")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "PRJ-2" })).toHaveAttribute("href", "/workspace/projects/p2/overview");
    await user.click(within(list).getByRole("button", { name: "Show all" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("kpi=production_attention"))).toBe(true));
  });

  it("PLM-132: shows every Finance KPI, cash collected against invoiced, and the lists by due date", async () => {
    const user = userEvent.setup();
    const fetcher = mount();
    render(<ManagementReports workspaceId={WS} initialDashboard="finance" />);
    const collected = (await screen.findByRole("heading", { name: "Cash collected" })).closest("section") as HTMLElement;
    expect(collected).toHaveAttribute("data-tone", "warning");
    expect(within(collected).getByText("Invoiced $30K")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Cash collected", "Refunds", "Joinery balances due", "Payables due",
      "Cash collected and invoiced by month", "Receivables by age", "Finance requests by type and age", "Refunds by reason", "Commissions due by account manager",
      "Joinery balances due · 1", "Payables due · 6"]);
    // What clients owe and what is owed to suppliers include tax, and say so; commission payments aren't recorded.
    expect(within(tile("Joinery balances due")).getByText("Includes tax")).toBeInTheDocument();
    expect(within(tile("Receivables by age")).getByText("Includes tax")).toBeInTheDocument();
    expect(within(tile("Commissions due by account manager")).getByText("Paid commissions aren't recorded yet")).toBeInTheDocument();
    // A column opens the month's payments to that company; a point of the line opens what was invoiced.
    const byMonth = tile("Cash collected and invoiced by month");
    await user.click(within(byMonth).getByRole("button", { name: "Sep 26 · Invoiced: $30K. Open the records" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => decodeURIComponent(String(url)).includes("kpi=collected_invoiced&bucket=month=2026-09;series=invoiced"))).toBe(true));
    await user.keyboard("{Escape}");
    await user.click(within(byMonth).getByRole("button", { name: "Sep 26: $29K. Open the records" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => decodeURIComponent(String(url)).includes("bucket=month=2026-09;entity=e1"))).toBe(true));
    await user.keyboard("{Escape}");
    // The lists link each record; the rest open from Show all.
    expect(within(tile("Joinery balances due · 1")).getByRole("link", { name: "PRJ-1" })).toHaveAttribute("href", "/workspace/projects/p1/money");
    const payables = tile("Payables due · 6");
    expect(within(payables).getByRole("link", { name: "FR-0002" })).toHaveAttribute("href", "/workspace/finance/requests?request=r2");
    expect(within(payables).getByText("Requested")).toBeInTheDocument();
    await user.click(within(payables).getByRole("button", { name: "Show all" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("kpi=payables_due"))).toBe(true));
  });

  it("PLM-133: shows Stock and marketing — low stock in red, places, best sellers, sources, forms and spam", async () => {
    mount();
    render(<ManagementReports workspaceId={WS} initialDashboard="stock" />);
    const low = (await screen.findByRole("heading", { name: "Low stock" })).closest("section") as HTMLElement;
    expect(low).toHaveAttribute("data-tone", "danger");
    expect(within(low).getByText("1 short")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stock and marketing" })).toBeInTheDocument();
    expect(within(tile("Won value from enquiries")).getByText("112.5%")).toBeInTheDocument();
    expect(within(tile("Reserved stock")).getByText("Available $3.2K")).toBeInTheDocument();
    expect(within(tile("Reserved and available stock")).getByRole("button", { name: "Showroom · Available: $400. Open the records" })).toBeInTheDocument();
    expect(within(tile("Best-selling Furniture Only items")).getByText("2 sold")).toBeInTheDocument();
    const sources = tile("Enquiries and won value by source");
    expect(within(sources).getByRole("button", { name: "Website · form: $30K. Open the records" })).toBeInTheDocument();
    expect(within(sources).getByText("2 enquiries")).toBeInTheDocument();
    expect(within(tile("Enquiries by form and QR code")).getByText("Website enquiry · showroom-door")).toBeInTheDocument();
    expect(within(tile("Spam by source and channel")).getByText("Nothing to show for this period")).toBeInTheDocument();
    expect(within(tile("Low stock · 1")).getByRole("link", { name: "SKU-Hinge" })).toHaveAttribute("href", "/workspace/inventory/history?item=s1");
  });

  it("exports each chart's figures with the page", () => {
    const name = (dimension: string, key: string, fallback: string) => fallback || `${dimension}:${key}`;
    const money = (_unit: string, text: string) => `$${Number(text)}`;
    expect(chartRows({ type: "columns", dimension: "month", seriesDimension: "entity", categories: [{ key: "2026-09", label: "2026-09" }], series: [{ id: "e1", label: "Studio" }],
      values: [["29000.00"]], unit: "money", line: { id: "invoiced", label: "Invoiced", values: ["30000.00"] } }, "Cash", name, money))
      .toEqual([["Cash · month:2026-09", "$29000"], ["Cash · month:2026-09 · Invoiced", "$30000"]]);
    expect(chartRows({ type: "calendar", dimension: "day", seriesDimension: "kind", month: "2026-09", weekStart: 1, entries: [{ day: "2026-09-18", series: "delivery", count: 2 }] },
      "Bookings", name, money)).toEqual([["Bookings · 2026-09-18 · kind:delivery", "2"]]);
  });

  it("keeps the period and two filters in one row, in the address, and only the tabs a member may open", async () => {
    const user = userEvent.setup();
    mount();
    render(<ManagementReports workspaceId={WS} initialDashboard="owner-overview" dashboards={["owner-overview", "sales-pipeline", "design-projects", "finance"]} />);
    await screen.findByRole("heading", { name: "Sales won" });
    const toolbar = screen.getByRole("group", { name: "Filters" });
    expect(within(toolbar).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Period/), expect.stringMatching(/Account manager/), expect.stringMatching(/Enquiry type/)]));
    // No region filter, and no company filter where it isn't offered.
    expect(within(toolbar).queryByRole("button", { name: /Emirate|Region|Company/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Production and delivery" })).toBeNull();
    await user.click(within(toolbar).getByRole("button", { name: /Account manager/ }));
    await user.click(await screen.findByRole("option", { name: "Ali Manager" }));
    expect(replace).toHaveBeenCalledWith("/workspace/reports?accountManager=m1", { scroll: false });
  });

  it("keeps only the filters a dashboard offers when switching to it", async () => {
    const user = userEvent.setup();
    mount();
    search = new URLSearchParams("accountManager=m1&enquiryType=full_id");
    render(<ManagementReports workspaceId={WS} initialDashboard="owner-overview" />);
    await screen.findByRole("heading", { name: "Sales won" });
    // Finance offers the company (there are two) and the account manager; the enquiry type filter doesn't follow.
    await user.click(screen.getByRole("button", { name: "Finance" }));
    expect(replace).toHaveBeenLastCalledWith("/workspace/reports/finance?accountManager=m1", { scroll: false });
    expect(await within(screen.getByRole("group", { name: "Filters" })).findByRole("button", { name: /Company/ })).toBeInTheDocument();
  });

  it("lists stuck deals and overdue follow-ups on Sales, most days first", async () => {
    mount();
    render(<ManagementReports workspaceId={WS} initialDashboard="sales-pipeline" />);
    const list = (await screen.findByRole("heading", { name: "Needs attention · 2" })).closest("section") as HTMLElement;
    const rows = within(list).getAllByRole("row").slice(1);
    expect(rows.map((row) => [within(row).getByRole("link").textContent, row.textContent?.includes("No stage change") ? "stuck" : "follow-up"])).toEqual([["O-5", "stuck"], ["O-5", "follow-up"]]);
    expect(within(list).getAllByText("Follow-up overdue")).toHaveLength(1);
  });

  it("offers Woddy on the Overview only when AI is on and the person may use it", async () => {
    const user = userEvent.setup();
    mount();
    aiEnabled = true;
    const { unmount } = render(<ManagementReports workspaceId={WS} initialDashboard="owner-overview" access={{ permissions: ["ai.suggestions.use"] }} />);
    const woddy = await screen.findByRole("group", { name: "Ask Woddy" });
    expect(within(woddy).getAllByRole("button")).toHaveLength(3);
    await user.click(within(woddy).getByRole("button", { name: "Which deals are stuck, and why?" }));
    expect(ask).toHaveBeenCalledWith("Which deals are stuck, and why?");
    unmount();
    // Without the permission, or with AI off, nothing is offered.
    const { unmount: second } = render(<ManagementReports workspaceId={WS} initialDashboard="owner-overview" access={{ permissions: [] }} />);
    await screen.findByRole("heading", { name: "Sales won" });
    expect(screen.queryByRole("group", { name: "Ask Woddy" })).toBeNull();
    second();
    aiEnabled = false;
    render(<ManagementReports workspaceId={WS} initialDashboard="owner-overview" access={{ permissions: ["ai.suggestions.use"] }} />);
    await screen.findByRole("heading", { name: "Sales won" });
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/ai-settings"))).toBe(true));
    expect(screen.queryByRole("group", { name: "Ask Woddy" })).toBeNull();
    aiEnabled = true;
  });

  it("works out the period presets from the local day, and knows an empty chart", () => {
    expect(presetRange("month", "2026-09-20")).toEqual({ from: "2026-09-01", to: "2026-09-20" });
    expect(presetRange("last-month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("quarter", "2026-08-15")).toEqual({ from: "2026-07-01", to: "2026-08-15" });
    expect(presetRange("last-12", "2026-09-20")).toEqual({ from: "2025-10-01", to: "2026-09-20" });
    expect(chartHasData({ type: "lines", dimension: "month", categories: [], series: [], values: [[null, "0"]], unit: "money" })).toBe(false);
    expect(chartHasData({ type: "columns", dimension: "month", categories: [], series: [], values: [["0", "3"]], unit: "count" })).toBe(true);
  });
});

describe("report targets settings", () => {
  it("edits a month's target and saves only what changed, with its version", async () => {
    const user = userEvent.setup();
    const fetcher = mount();
    render(<ToastProvider><ReportTargetsSettings workspaceId={WS} /></ToastProvider>);
    const grid = await screen.findByRole("table", { name: "Report targets" });
    const row = within(grid).getByText("Sales won").closest("tr") as HTMLElement;
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
