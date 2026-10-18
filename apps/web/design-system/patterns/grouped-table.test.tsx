import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GroupedTable } from "./grouped-table";

type Row = { id: string; name: string; qty: string };
const columns = [
  { id: "name", label: "Material", render: (row: Row) => row.name },
  { id: "qty", label: "Needed", align: "end" as const, render: (row: Row) => row.qty },
];
const sections = [
  { id: "p1", label: "PRJ-0001 · Villa 12", emptyMessage: "", rows: [{ id: "a", name: "Oak 14mm", qty: "46 m²" }, { id: "b", name: "Matt lacquer", qty: "12 l" }] },
  { id: "p2", label: "PRJ-0002 · Marina flat", emptyMessage: "", rows: [{ id: "c", name: "Fluted panelling", qty: "8.5 m²" }] },
];

describe("GroupedTable", () => {
  it("shows one row of column headers, then a group row per section above its rows", () => {
    render(<GroupedTable<Row> ariaLabel="To order" columns={columns} sections={sections} getRowId={(row) => row.id} selectable={false} />);
    const table = screen.getByRole("table", { name: "To order" });
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent?.trim());
    expect(headers.slice(0, 2)).toEqual(["Material", "Needed"]);
    expect(headers).toContain("PRJ-0001 · Villa 122");
    expect(within(table).getByRole("columnheader", { name: "Needed" })).toHaveAttribute("data-align", "end");
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 2 + 2 + 1);
  });

  it("collapses a group and selects a whole group or the whole table", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    const { rerender } = render(<GroupedTable<Row> ariaLabel="To order" columns={columns} sections={sections} getRowId={(row) => row.id} getRowLabel={(row) => row.name} onSelectionChange={onSelectionChange} selectedIds={new Set()} />);
    await user.click(screen.getByRole("button", { name: "Collapse PRJ-0001 · Villa 12" }));
    expect(screen.queryByText("Oak 14mm")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand PRJ-0001 · Villa 12" })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("checkbox", { name: "Select all prj-0002 · marina flat" }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(["c"]));
    await user.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(["a", "b", "c"]));
    rerender(<GroupedTable<Row> ariaLabel="To order" columns={columns} sections={sections} getRowId={(row) => row.id} getRowLabel={(row) => row.name} onSelectionChange={onSelectionChange} selectedIds={new Set(["c"])} />);
    expect(screen.getByRole("checkbox", { name: "Select all" })).toBePartiallyChecked();
  });
});
