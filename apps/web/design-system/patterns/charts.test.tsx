import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { BarChart, MiniBars, ProgressRing, Sparkline, SplitBar } from "./charts";

const weeks = [{ label: "1 Sep", value: 2 }, { label: "8 Sep", value: 5 }, { label: "15 Sep", value: 0 }, { label: "22 Sep", value: 4 }];

it("summarises every chart for screen readers and keeps the exact values", () => {
  render(<><Sparkline points={weeks} label="Enquiries trend" /><MiniBars points={weeks} label="Enquiries, last 4 weeks" /></>);
  expect(screen.getByRole("img", { name: "Enquiries trend" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Enquiries, last 4 weeks" })).toBeInTheDocument();
  const table = screen.getByRole("table", { name: "Enquiries, last 4 weeks" });
  expect(within(table).getByRole("row", { name: "8 Sep 5" })).toBeInTheDocument();
});

it("highlights the current bar and shows exact values on keyboard focus", () => {
  render(<BarChart ariaLabel="Enquiries per week" data={weeks} formatValue={point => `${point.value} enquiries`} />);
  const plot = screen.getByRole("img", { name: "Enquiries per week" });
  const columns = plot.querySelectorAll(".wd-bar-chart-column");
  expect(columns[3]).toHaveAttribute("data-current");
  fireEvent.focus(plot);
  expect(plot).toHaveTextContent("4 enquiries");
  fireEvent.keyDown(plot, { key: "ArrowLeft" });
  expect(plot).toHaveTextContent("0 enquiries");
  expect(screen.getByText("15 Sep: 0 enquiries")).toBeInTheDocument();
  fireEvent.keyDown(plot, { key: "Home" });
  expect(screen.getByText("1 Sep: 2 enquiries")).toBeInTheDocument();
  fireEvent.pointerEnter(columns[1]);
  expect(plot).toHaveTextContent("5 enquiries");
});

it("names every part of a split bar with its value, including empty parts", () => {
  render(<SplitBar label="Storage by area" segments={[{ id: "projects", label: "Projects", value: 9, display: "9 GB" }, { id: "catalog", label: "Catalog", value: 0, display: "0 B" }]} total={20} />);
  expect(screen.getByRole("img", { name: "Storage by area: Projects 9 GB, Catalog 0 B" })).toBeInTheDocument();
  expect(screen.getByText("Catalog")).toBeInTheDocument();
});

it("caps a progress ring at its target", () => {
  const { container } = render(<ProgressRing value={150} max={100} label="All received">100%</ProgressRing>);
  expect(screen.getByRole("img", { name: "All received" })).toBeInTheDocument();
  expect(container.querySelector(".wd-progress-ring-value")).toHaveAttribute("stroke-dasharray", "100 100");
});
