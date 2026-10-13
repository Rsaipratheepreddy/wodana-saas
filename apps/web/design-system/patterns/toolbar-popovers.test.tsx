import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "../foundations/provider";
import { DataGrid, type DataGridColumn } from "./data-grid";

type Row = { id: string; name: string; stage: string };
const columns: DataGridColumn<Row>[] = [
  { accessorKey: "name", header: "Name", meta: { primary: true } },
  { accessorKey: "stage", header: "Stage", meta: { filterOptions: [{ id: "Design", label: "Design" }, { id: "Build", label: "Build" }] } },
];
const rows: Row[] = [{ id: "1", name: "Palm Villa", stage: "Design" }, { id: "2", name: "Marina Flat", stage: "Build" }];

function Grid() {
  return <DesignSystemProvider><button type="button">Outside</button><DataGrid ariaLabel="Projects" columns={columns} data={rows} getRowId={(row) => row.id} /></DesignSystemProvider>;
}

describe("toolbar popovers close the right way round", () => {
  it("Table options: a checkbox label inside keeps it open; outside and Esc close it", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await user.click(screen.getByRole("button", { name: "Table options" }));
    const panel = await screen.findByRole("dialog", { name: "Table options" });
    // The label text, not only the box.
    await user.click(within(panel).getByRole("checkbox", { name: "Stage" }).closest("label")!);
    expect(screen.getByRole("dialog", { name: "Table options" })).toBeInTheDocument();
    expect(within(panel).getByRole("checkbox", { name: "Stage" })).not.toBeChecked();
    await user.click(within(panel).getByRole("checkbox", { name: "Stage" }));
    expect(screen.getByRole("dialog", { name: "Table options" })).toBeInTheDocument();
    await user.click(screen.getByText("Outside"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Table options" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Table options" }));
    await screen.findByRole("dialog", { name: "Table options" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Table options" })).not.toBeInTheDocument());
  });

  it("Filter: choosing in its dropdowns keeps the panel open and filters; outside closes; the button counts filters in use", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await user.click(screen.getByRole("button", { name: "Filter" }));
    const panel = await screen.findByRole("dialog", { name: "Filter records" });
    await user.click(within(panel).getByRole("button", { name: /Column/ }));
    await user.click(await screen.findByRole("option", { name: "Stage" }));
    expect(screen.getByRole("dialog", { name: "Filter records" })).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: /Filter by stage/ }));
    await user.click(await screen.findByRole("option", { name: "Build" }));
    expect(screen.getByRole("dialog", { name: "Filter records" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Filter by stage/ })).toHaveTextContent("Build");
    expect(screen.queryByText("Palm Villa")).not.toBeInTheDocument();
    expect(screen.getByText("Marina Flat")).toBeInTheDocument();
    await user.click(screen.getByText("Outside"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filter records" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Filter (1)" })).toHaveTextContent("1");
    // Clear filters empties them, keeps the panel open, and the count goes; Esc closes it.
    await user.click(screen.getByRole("button", { name: "Filter (1)" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Filter records" })).getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("dialog", { name: "Filter records" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filter records" })).not.toBeInTheDocument());
    expect(screen.getByText("Palm Villa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).not.toHaveTextContent("1");
  });

  it("an icon-only (compact) toolbar hides the Filter word but still shows the count beside the icon", () => {
    const css = readFileSync(join(__dirname, "../styles/system.css"), "utf8");
    expect(css).toContain(".wd-record-toolbar[data-compact] .wd-record-controls > button > span:not(.wd-count-chip),");
    expect(css).toContain(".wd-record-toolbar[data-compact] .wd-record-controls > button.wd-filter-button:has(> .wd-count-chip) { inline-size: auto; }");
  });
});
