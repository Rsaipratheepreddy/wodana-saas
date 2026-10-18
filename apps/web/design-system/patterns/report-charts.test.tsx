import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColumnChart, DonutChart, FunnelSteps, Gauge, KpiFigure, RankedBars, ReportPanel, TrendLines } from "./report-charts";

const months = [{ key: "2026-08", label: "Aug" }, { key: "2026-09", label: "Sep" }];

describe("report charts", () => {
  it("stacks columns, opens a part's records and keeps the exact values in a table", () => {
    const open = vi.fn();
    render(<ColumnChart ariaLabel="Sales Won" categories={months} series={[{ id: "design", label: "Design Fee" }, { id: "main", label: "Proposal 2" }]}
      values={[[0, 18000], [5000, 20000]]} format={(value) => `$${value}`} onSelect={open} />);
    fireEvent.click(screen.getByRole("button", { name: "Sep · Design Fee: $18000. Open the records" }));
    expect(open).toHaveBeenCalledWith("2026-09", "design");
    // An empty part draws nothing to click.
    expect(screen.queryByRole("button", { name: /Aug · Design Fee/ })).toBeNull();
    const table = screen.getByRole("table", { name: "Sales Won" });
    expect(within(table).getByRole("row", { name: "Sep $18000 $20000" })).toBeInTheDocument();
  });

  it("draws a line over the columns, point to point, each point opening its own records", () => {
    const column = vi.fn(), point = vi.fn();
    const { container } = render(<ColumnChart ariaLabel="Cash collected" categories={[...months, { key: "2026-10", label: "Oct" }]} series={[{ id: "e1", label: "Studio" }]}
      values={[[1000, 29000, 0]]} format={(value) => `$${value}`} onSelect={column} line={{ id: "invoiced", label: "Invoiced", values: [0, 30000, null] }} onSelectLine={point} />);
    fireEvent.click(screen.getByRole("button", { name: "Sep · Invoiced: $30000. Open the records" }));
    expect(point).toHaveBeenCalledWith("2026-09");
    fireEvent.click(screen.getByRole("button", { name: "Sep: $29000. Open the records" }));
    expect(column).toHaveBeenCalledWith("2026-09", null);
    // Aug → Sep is a segment; Sep → Oct isn't (no point in October).
    expect(container.querySelectorAll(".wd-column-chart-point")).toHaveLength(2);
    expect(container.querySelectorAll(".wd-column-chart-segment")).toHaveLength(1);
    // The line is named in the legend and its values are in the table.
    expect(container.querySelector(".wd-report-legend")).toHaveTextContent("Invoiced");
    expect(within(screen.getByRole("table", { name: "Cash collected" })).getByRole("row", { name: "Oct $0 —" })).toBeInTheDocument();
  });

  it("draws each row's own target across its bar", () => {
    const { container } = render(<RankedBars ariaLabel="Lead time by path"
      items={[{ key: "a", label: "A", value: 1, display: "1 days", marker: 0 }, { key: "b", label: "B", value: 4, display: "4 days", marker: 4 }, { key: "c", label: "C", value: 0, display: "0 days" }]} />);
    expect(container.querySelectorAll(".wd-ranked-bars-target")).toHaveLength(2);
    expect(screen.getByText("Target")).toBeInTheDocument();
  });

  it("ranks bars with a target marker and names each row for screen readers", () => {
    const open = vi.fn();
    render(<RankedBars ariaLabel="Won by Account Manager" target={{ value: 25000, display: "$25,000" }} onSelect={open}
      items={[{ key: "ali", label: "Ali", value: 30000, display: "$30,000", detail: "2" }, { key: "sara", label: "Sara", value: 8000, display: "$8,000" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Sara: $8,000. Open the records" }));
    expect(open).toHaveBeenCalledWith("sara");
    expect(screen.getByText("Target $25,000")).toBeInTheDocument();
  });

  it("leaves a gap in a line for a period without a figure, and opens a period from its label", () => {
    const open = vi.fn();
    const { container } = render(<TrendLines ariaLabel="Response rate" categories={[...months, { key: "2026-10", label: "Oct" }]} series={[{ id: "rate", label: "Rate" }]}
      values={[[50, null, 80]]} format={(value) => `${value}%`} maxValue={100} onSelect={open} />);
    expect(container.querySelectorAll("polyline")).toHaveLength(0);
    expect(container.querySelectorAll(".wd-trend-dot")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Oct. Open the records" }));
    expect(open).toHaveBeenCalledWith("2026-10");
    expect(within(screen.getByRole("table", { name: "Response rate" })).getByRole("row", { name: "Sep —" })).toBeInTheDocument();
  });

  it("draws a gauge, a donut and a funnel with their values named", () => {
    render(<>
      <Gauge ariaLabel="Response rate" percent={33.3} display="33.3%" target={90} tone="danger" />
      <DonutChart ariaLabel="Package mix" segments={[{ key: "a", label: "Concept", value: 1, display: "1", secondary: "$10,000" }, { key: "b", label: "Bespoke", value: 1, display: "1" }]} />
      <FunnelSteps ariaLabel="Conversion" steps={[{ key: "lead", label: "Leads", value: 5, display: "5" }, { key: "won", label: "Won", value: 1, display: "1", rate: "20%" }]} />
    </>);
    expect(screen.getByRole("img", { name: "Response rate" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Package mix: Concept 1, Bespoke 1" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Conversion" })).toHaveTextContent("20%");
  });
});

describe("KPI figure", () => {
  it("shows Actual, Target, % achieved and gap in the target's tone", () => {
    const { container } = render(<KpiFigure label="Sales Won" value="$38,000" targetable target={{ target: "$40,000", percent: "95%", gap: "$2,000", tone: "warning" }} />);
    expect(container.querySelector(".wd-kpi-figure")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByText("$40,000")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
    expect(screen.getByText("$2,000")).toBeInTheDocument();
  });

  it("says when no target is set, and never shows a zero for data that isn't recorded", () => {
    const open = vi.fn();
    render(<><KpiFigure label="New leads" value="5" targetable onOpen={open} /><KpiFigure label="Profit margin" value={null} noData targetable onOpen={open} /></>);
    expect(screen.getByText("No target set")).toBeInTheDocument();
    expect(screen.getByText("Not enough data yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New leads. Open the records" }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Profit margin. Open the records" })).toBeNull();
  });

  it("sets the figure against the period before, coloured by whether that is good news", () => {
    render(<>
      <KpiFigure label="Cash in" value="$30K" comparison={{ direction: "up", change: "12%", tone: "success", against: "Aug 1 – 20", previous: "$27K" }} note="From Wodana's records" />
      <KpiFigure label="Refunds" value="2" comparison={{ direction: "flat", change: "0%", against: "Aug 1 – 20", previous: "2" }} />
      <KpiFigure label="Stock value" value="$3.9K" comparison={{ direction: "down", change: null, against: "Aug 1 – 20", previous: "$0" }} />
      <ReportPanel title="Needs attention" action={<button type="button">Show all</button>}><p>List</p></ReportPanel>
    </>);
    expect(screen.getByText("12% vs Aug 1 – 20").closest("small")).toHaveAttribute("data-tone", "success");
    expect(screen.getByText("12% vs Aug 1 – 20").closest("small")).toHaveAttribute("title", "Was $27K in Aug 1 – 20");
    expect(screen.getByText("Same as Aug 1 – 20")).toBeInTheDocument();
    expect(screen.getAllByText("Was $0 in Aug 1 – 20").length).toBeGreaterThan(0);
    expect(screen.getByText("From Wodana's records")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Needs attention" }).closest("section")).toHaveTextContent("Show all");
  });
});
