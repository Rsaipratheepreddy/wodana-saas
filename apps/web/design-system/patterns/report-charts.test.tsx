import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColumnChart, DonutChart, FunnelSteps, Gauge, KpiFigure, RankedBars, TrendLines } from "./report-charts";

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
});
