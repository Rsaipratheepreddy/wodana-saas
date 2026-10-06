import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../components/actions";
import { EmptyState } from "../components/status";
import { DesignSystemProvider } from "../foundations/provider";
import { DataGrid, type DataGridColumn } from "./data-grid";
import { GroupedTable } from "./grouped-table";

type Row = { id: string; name: string };
const columns: DataGridColumn<Row>[] = Array.from({ length: 8 }, (_, index) => ({ id: `c${index}`, header: `Column ${index}`, accessorKey: "name", size: 220 }));

// The frame is narrower than its table (8 × 220px): the empty state must use the frame's visible width.
const visibleWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get");
afterEach(() => visibleWidth.mockReset());

describe("empty states inside a wide table (L7)", () => {
  it("sticks the DataGrid's empty state to the visible frame, not the scrollable table width", () => {
    visibleWidth.mockImplementation(function (this: HTMLElement) { return this.classList.contains("wd-table-scroll") ? 640 : 0; });
    render(<DesignSystemProvider><DataGrid ariaLabel="Enquiries" columns={columns} data={[]} getRowId={(row) => row.id} keepEmptyTable
      emptyContent={<EmptyState title="Your enquiries will appear here" action={<Button variant="primary">New enquiry</Button>} />} /></DesignSystemProvider>);
    const frame = screen.getByRole("table", { name: "Enquiries" }).closest(".wd-table-scroll") as HTMLElement;
    expect(frame.style.getPropertyValue("--wd-table-visible-inline-size")).toBe("640px");
    const state = screen.getByText("Your enquiries will appear here").closest(".wd-table-viewport-state");
    expect(state).not.toBeNull();
    expect(state?.closest("td")).toHaveClass("wd-table-viewport-cell");
    expect(state).toContainElement(screen.getByRole("button", { name: "New enquiry" }));
    // The rule that keeps it in view: sticky at the inline start, as wide as the visible frame.
    const css = readFileSync(join(__dirname, "../styles/record-tables.css"), "utf8");
    expect(css).toMatch(/\.wd-table-viewport-state \{ position: sticky; inset-inline-start: 0;[^}]*inline-size: var\(--wd-table-visible-inline-size, 100%\)/);
  });

  it("does the same for a GroupedTable section's empty message", () => {
    visibleWidth.mockImplementation(function (this: HTMLElement) { return this.classList.contains("wd-grouped-table-scroll") ? 480 : 0; });
    render(<GroupedTable<Row> ariaLabel="To order" columns={[{ id: "name", label: "Material", render: (row) => row.name }]} getRowId={(row) => row.id} selectable={false}
      sections={[{ id: "p1", label: "Villa 12", emptyMessage: "Nothing to order", rows: [] }]} />);
    const frame = screen.getByRole("table", { name: "To order" }).closest(".wd-grouped-table-scroll") as HTMLElement;
    expect(frame.style.getPropertyValue("--wd-table-visible-inline-size")).toBe("480px");
    expect(screen.getByText("Nothing to order")).toHaveClass("wd-table-viewport-state");
  });
});
