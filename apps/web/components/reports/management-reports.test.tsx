import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/design-system";
import type { Dashboard, DashboardId, Kpi } from "@/lib/reports/management";
import { chartHasData, ManagementReports, presetRange } from "./management-reports";
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
  "production-delivery": page("production-delivery", [
    { code: "work_orders_made", unit: "count", value: "3", count: 3, targetable: false, previous: previous("1", "200.0") },
    { code: "on_time_rate", unit: "percent", value: "50.0", count: 3, targetable: true, extra: { late: 1 }, previous: previous("100.0", "-50.0") },
    { code: "work_orders_delivered", unit: "count", value: "1", count: 1, targetable: false, previous: previous("0", null) },
    { code: "installations_done", unit: "count", value: "0", count: 0, targetable: false, previous: previous("0", null) },
    { code: "work_orders_status", unit: "count", value: "6", count: 6, targetable: false,
      chart: { type: "bars", dimension: "step", unit: "count", items: [{ key: "scheduled", label: "", value: "1", count: 1 }, { key: "ready", label: "Ready to send", value: "3", count: 3 }] } },
    { code: "factory_load", unit: "hours", value: "66.0", count: 2, targetable: false,
      chart: { type: "columns", dimension: "week", seriesDimension: "centre", categories: [{ key: "2026-09-14", label: "2026-09-14" }], series: [{ id: "w1", label: "Joinery" }], values: [["16.0"]], unit: "hours" } },
    { code: "production_attention", unit: "count", value: "6", count: 6, targetable: false, chart: { type: "list", bucket: "period=1" } },
  ], { tiles: ["work_orders_made", "on_time_rate", "work_orders_delivered", "installations_done"], charts: ["work_orders_status", "factory_load"], attention: "production_attention" },
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
  finance: page("finance", [
    { code: "cash_in", unit: "money", value: "30450.00", count: 3, targetable: true, notes: { basis: "records" }, previous: previous("1050.00", "2800.0") },
    { code: "cash_out", unit: "money", value: "5300.00", count: 2, targetable: false, previous: previous("1000.00", "430.0", "lower") },
    { code: "revenue_mix", unit: "money", value: "29000.00", count: 3, targetable: false, extra: { design_fees: "10000.00", production: "19000.00" }, previous: previous("1000.00", "2800.0") },
    { code: "refunds", unit: "count", value: "2", count: 2, amount: "1300.00", targetable: false, previous: previous("1", "100.0", "lower") },
  ], { tiles: ["cash_in", "cash_out", "revenue_mix", "refunds"], charts: [], attention: "finance_attention" }, { kpi: "finance_attention", total: 0, records: [] }),
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

  it("names why each thing needs attention and opens the whole list", async () => {
    const user = userEvent.setup();
    const fetcher = mount();
    render(<ManagementReports workspaceId={WS} initialDashboard="production-delivery" />);
    const list = (await screen.findByRole("heading", { name: "Needs attention · 6" })).closest("section") as HTMLElement;
    expect(within(list).getByText("Permit expired")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "PRJ-2" })).toHaveAttribute("href", "/workspace/projects/p2/overview");
    // On time fell 50 %: bad news. A step the firm named in its own words keeps its name.
    expect(within(tile("Made on time")).getByText(/^50% vs /).closest("small")).toHaveAttribute("data-tone", "danger");
    expect(within(tile("Made on time")).getByText("1 late")).toBeInTheDocument();
    expect(within(tile("Open work orders")).getByText("Ready to send")).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Show all" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("kpi=production_attention"))).toBe(true));
  });

  it("says what a figure is read from, and that nothing needs attention", async () => {
    mount();
    render(<ManagementReports workspaceId={WS} initialDashboard="finance" />);
    expect(within((await screen.findByRole("heading", { name: "Cash in" })).closest("section") as HTMLElement).getByText("From Wodana's records")).toBeInTheDocument();
    // Cash out went up: bad news, as lower is better.
    expect(within(tile("Cash out")).getByText(/^430% vs /).closest("small")).toHaveAttribute("data-tone", "danger");
    expect(within(tile("Revenue")).getByText("Design fees $10K · production $19K")).toBeInTheDocument();
    expect(screen.getByText("Nothing needs attention")).toBeInTheDocument();
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
