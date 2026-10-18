import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AmountList, CheckList, KpiStrip, KpiTile, StateChip } from "./record-summary";

describe("record summary pattern", () => {
  it("renders KPI tiles as terms and values; a tile with a target opens it", () => {
    const press = vi.fn();
    render(<KpiStrip label="Where it stands">
      <KpiTile label="Stage" value="Production" detail="Stage 4 of 9" href="#stages" />
      <KpiTile label="Late" value={2} tone="danger" onPress={press} />
      <KpiTile label="Paid" value="90%" />
    </KpiStrip>);
    const strip = screen.getByLabelText("Where it stands");
    expect(within(strip).getAllByRole("term").map((term) => term.textContent)).toEqual(["Stage", "Late", "Paid"]);
    expect(within(strip).getByRole("link", { name: "Production" })).toHaveAttribute("href", "#stages");
    expect(screen.getByText("Stage 4 of 9")).toBeInTheDocument();
    expect(screen.getByText("Late").closest(".wd-kpi-tile")).toHaveAttribute("data-tone", "danger");
    fireEvent.click(within(strip).getByRole("button", { name: "2" }));
    expect(press).toHaveBeenCalled();
    expect(screen.getByText("Paid").closest(".wd-kpi-tile")).not.toHaveAttribute("data-link");
  });

  it("shows a state as one chip with its icon and word", () => {
    render(<><StateChip state="done" /><StateChip state="missing" /><StateChip state="waiting" label="Waiting for Finance" /></>);
    for (const [text, tone] of [["Done", "success"], ["Missing", "warning"], ["Waiting for Finance", "warning"]]) {
      const chip = screen.getByText(text).closest(".wd-badge")!;
      expect(chip).toHaveAttribute("data-tone", tone);
      expect(chip.querySelector("svg")).not.toBeNull();
    }
  });

  it("lists to-dos as checklist rows and amounts with a total", () => {
    render(<><CheckList label="Checks" items={[{ id: "a", label: "BOQ", done: true }, { id: "b", label: "Payment", done: false, action: <a href="#pay">Open</a> }]} />
      <AmountList label="Commission" rows={[{ id: "1", label: "Sam", detail: "Sales", amount: "AED 10.00" }]} total={{ label: "Total", amount: "AED 10.00" }} /></>);
    const rows = within(screen.getByRole("list", { name: "Checks" })).getAllByRole("listitem");
    expect(rows[0]).toHaveAttribute("data-done");
    expect(rows[0]).toHaveTextContent("BOQ · Done");
    expect(rows[1]).not.toHaveAttribute("data-done");
    expect(within(rows[1]).getByRole("link", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByText("Total").closest("div")).toHaveAttribute("data-total");
  });

  it("lays out with logical properties only, and has no progress bars", () => {
    const css = readFileSync(join(__dirname, "../styles/page.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const summary = css.slice(css.indexOf(".wd-kpi-strip"), css.indexOf(".wd-amount-list > [data-total]"));
    expect(summary).not.toMatch(/(^|[\s;{])(margin|padding|border)-(left|right)\s*:|(^|[\s;{])(left|right)\s*:|text-align:\s*(left|right)/);
  });
});
