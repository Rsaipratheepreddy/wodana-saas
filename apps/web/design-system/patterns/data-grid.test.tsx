import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "../foundations/provider";
import { DataGrid, type DataGridColumn } from "./data-grid";

type Row = { id: string; name: string; stage: string };
const columns: DataGridColumn<Row>[] = [{ accessorKey: "name", header: "Name", meta: { primary: true } }, { accessorKey: "stage", header: "Stage", meta: { editable: true, validate: (value) => value ? undefined : "Stage is required" } }];
const rows: Row[] = [{ id: "1", name: "Palm Villa", stage: "Design" }];

describe("DataGrid", () => {
  it("announces a loading list while keeping placeholder rows decorative", () => {
    render(<DesignSystemProvider><DataGrid ariaLabel="Customer organizations" columns={columns} data={[]} getRowId={(row) => row.id} isLoading /></DesignSystemProvider>);
    expect(screen.getByRole("status", { name: "Loading Customer organizations" })).toBeInTheDocument();
    expect(screen.queryByText("No records found")).not.toBeInTheDocument();
    // No count while loading: "0 records" under the placeholders would be untrue (m21).
    expect(screen.queryByText("0 records")).not.toBeInTheDocument();
  });
  it("doesn't tell people to adjust filters on a grid that has none", () => {
    const { unmount } = render(<DesignSystemProvider><DataGrid ariaLabel="Viewed as you" columns={columns} data={[]} getRowId={(row) => row.id} showToolbar={false} emptyTitle="Nobody has viewed as you" /></DesignSystemProvider>);
    expect(screen.getByText("Nobody has viewed as you")).toBeInTheDocument();
    expect(screen.queryByText("Create a record or adjust the current filters.")).not.toBeInTheDocument();
    unmount();
    render(<DesignSystemProvider><DataGrid ariaLabel="Customers" columns={columns} data={[]} getRowId={(row) => row.id} /></DesignSystemProvider>);
    expect(screen.getByText("Create a record or adjust the current filters.")).toBeInTheDocument();
  });
  it("exports filtered rows across pages and selected rows from the table options menu", async () => {
    const user = userEvent.setup(), onExport = vi.fn();
    const data = [{id:'1',name:'Palm A',stage:'New'}, {id:'2',name:'Palm B',stage:'New'}, {id:'3',name:'Villa',stage:'New'}];
    render(<DesignSystemProvider><DataGrid ariaLabel="Export records" columns={columns} data={data} getRowId={row => row.id} pageSize={1} onExport={onExport}/></DesignSystemProvider>);
    expect(screen.queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search records" }), "Palm");
    await user.click(screen.getByRole("button", { name: "Table options" }));
    await user.click(screen.getByRole("button", { name: "Export filtered rows" }));
    expect(onExport).toHaveBeenLastCalledWith(data.slice(0,2));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("checkbox", { name: "Select row 1" }));
    await user.click(screen.getByRole("button", { name: "Table options" }));
    await user.click(screen.getByRole("button", { name: "Export selected rows" }));
    expect(onExport).toHaveBeenLastCalledWith([data[0]]);
  });
  it("protects the first column and resets hidden columns to the configured default", async () => {
    const user = userEvent.setup();
    render(<DesignSystemProvider><DataGrid ariaLabel="Columns" columns={columns} data={rows} getRowId={row => row.id} initialColumnVisibility={{ stage: false }}/></DesignSystemProvider>);
    expect(screen.queryByRole("columnheader", { name: "Stage" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Table options" }));
    expect(screen.getByRole("checkbox", { name: "Name" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Stage" }));
    await user.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(screen.getByRole("checkbox", { name: "Stage" })).not.toBeChecked();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("columnheader", { name: "Stage" })).not.toBeInTheDocument();
  });
  it("sorts across pages from the table options menu and keeps row numbers in display order", async () => {
    const user = userEvent.setup();
    const data = [{id:'1',name:'Zebra',stage:'New'}, {id:'2',name:'Alpha',stage:'New'}, {id:'3',name:'Beta',stage:'New'}];
    render(<DesignSystemProvider><DataGrid ariaLabel="Sorted records" columns={columns} data={data} getRowId={row => row.id} pageSize={2}/></DesignSystemProvider>);
    await user.click(screen.getByRole("button", { name: "Table options" }));
    await user.click(screen.getByRole("button", { name: /Sort by/ }));
    await user.click(screen.getByRole("option", { name: "Name" }));
    await user.keyboard("{Escape}");
    const table = screen.getByRole("table", { name: "Sorted records" });
    expect(within(table).getAllByRole("row").slice(1).map(row => row.textContent)).toEqual(['1AlphaNew','2BetaNew']);
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(within(table).getAllByRole("row").slice(1).map(row => row.textContent)).toEqual(['3ZebraNew']);
  });
  it("opens a full row by click or keyboard while keeping selection independent", async () => {
    const user=userEvent.setup(),open=vi.fn();
    render(<DesignSystemProvider><DataGrid ariaLabel="Catalogs" columns={[{accessorKey:"name",header:"Name"},{accessorKey:"stage",header:"Stage"}]} data={rows} getRowId={r=>r.id} onRowAction={open}/></DesignSystemProvider>);
    await user.click(screen.getByRole("cell",{name:"Design"}));
    expect(open).toHaveBeenCalledWith(rows[0]);
    open.mockClear();
    await user.click(screen.getByRole("checkbox",{name:"Select row 1"}));
    expect(open).not.toHaveBeenCalled();
    screen.getByRole("row",{name:/Palm Villa/}).focus();
    await user.keyboard("{Enter}");
    expect(open).toHaveBeenCalledWith(rows[0]);
  });
  it("opens the inspector from the primary cell", async () => {
    const user = userEvent.setup();
    render(<DesignSystemProvider><DataGrid ariaLabel="Projects" columns={columns} data={rows} getRowId={(row) => row.id} renderInspector={(row) => <span>Inspector: {row.name}</span>} /></DesignSystemProvider>);
    await user.click(screen.getByRole("button", { name: "Palm Villa" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Inspector: Palm Villa");
  });
  it("never nests a cell's own link or button inside the row's open button (M1)", async () => {
    const user = userEvent.setup(), open = vi.fn(), start = vi.fn();
    const own: DataGridColumn<Row>[] = [{ accessorKey: "name", header: "Name", meta: { primary: true, interactive: true, renderCell: (row) => row.id === "1"
      ? <a href={`/records/${row.id}`}>{row.name}</a> : <button type="button" onClick={start}>{row.name}</button> } }, { accessorKey: "stage", header: "Stage" }];
    const { container } = render(<DesignSystemProvider><DataGrid ariaLabel="Own links" columns={own} data={[...rows, { id: "2", name: "Lead", stage: "New" }]} getRowId={(row) => row.id} onRowAction={open} /></DesignSystemProvider>);
    expect(container.querySelector("button button, button a, a button, a a")).toBeNull();
    expect(screen.getByRole("link", { name: "Palm Villa" })).toHaveAttribute("href", "/records/1");
    await user.click(screen.getByRole("button", { name: "Lead" }));
    expect(start).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    await user.click(screen.getByRole("cell", { name: "Design" }));
    expect(open).toHaveBeenCalledWith(rows[0]);
  });
  it("commits inline edits with Enter", async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    render(<DesignSystemProvider><DataGrid ariaLabel="Projects" columns={columns} data={rows} getRowId={(row) => row.id} onCellUpdate={update} /></DesignSystemProvider>);
    await user.click(screen.getByRole("button", { name: "Design" }));
    const input = screen.getByRole("textbox", { name: "Edit stage" });
    await user.clear(input);
    await user.type(input, "Production{Enter}");
    expect(update).toHaveBeenCalledWith(rows[0], "stage", "Production");
  });
  it("does not submit twice when Enter and blur happen during a save", async () => {
    const user=userEvent.setup();let resolve!:()=>void;
    const update=vi.fn(()=>new Promise<void>(done=>{resolve=done;}));
    render(<DesignSystemProvider><DataGrid ariaLabel="Pending edits" columns={columns} data={rows} getRowId={r=>r.id} onCellUpdate={update}/></DesignSystemProvider>);
    await user.click(screen.getByRole("button",{name:"Design"}));
    const input=screen.getByRole("textbox",{name:"Edit stage"});
    await user.clear(input);await user.type(input,"Production{Enter}");fireEvent.blur(input);
    expect(update).toHaveBeenCalledTimes(1);
    await act(async()=>resolve());
    await waitFor(()=>expect(screen.queryByRole("textbox",{name:"Edit stage"})).not.toBeInTheDocument());
  });
  it("keeps a failed edit available for correction and retry",async()=>{
    const user=userEvent.setup(),update=vi.fn().mockRejectedValueOnce(new Error("Someone updated this record")).mockResolvedValue(undefined);
    render(<DesignSystemProvider><DataGrid ariaLabel="Failed edits" columns={columns} data={rows} getRowId={r=>r.id} onCellUpdate={update}/></DesignSystemProvider>);
    await user.click(screen.getByRole("button",{name:"Design"}));
    const input=screen.getByRole("textbox",{name:"Edit stage"});await user.clear(input);await user.type(input,"Production{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone updated");expect(input).toHaveValue("Production");
    await user.keyboard("{Enter}");await waitFor(()=>expect(screen.queryByRole("textbox",{name:"Edit stage"})).not.toBeInTheDocument());expect(update).toHaveBeenCalledTimes(2);
  });
  it("virtualizes a 10,000-row dataset", () => {
    const largeRows = Array.from({ length: 10_000 }, (_, index) => ({ id: String(index), name: `Project ${index}`, stage: "Design" }));
    render(<DesignSystemProvider><DataGrid ariaLabel="Large projects" columns={columns} data={largeRows} getRowId={(row) => row.id} pageSize={10_000} virtualizeAfter={100} /></DesignSystemProvider>);
    expect(screen.getByRole("table", { name: "Large projects" })).toBeInTheDocument();
    expect(screen.getAllByRole("row").length).toBeLessThan(100);
  });
  it("filters a chosen column without requiring product-specific code", async () => {
    const user = userEvent.setup();
    render(<DesignSystemProvider><DataGrid ariaLabel="Projects" columns={columns} data={rows} getRowId={(row) => row.id} /></DesignSystemProvider>);
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.type(screen.getByRole("textbox", { name: "Contains" }), "missing");
    expect(screen.queryByText("Palm Villa")).not.toBeInTheDocument();
    expect(screen.getByText("No records found")).toBeInTheDocument();
  });
  it("supports a non-selectable directory table", () => {
    render(<DesignSystemProvider><DataGrid ariaLabel="Directory" columns={columns} data={rows} getRowId={(row) => row.id} selectable={false} showFooter={false} /></DesignSystemProvider>);
    expect(screen.getByRole("table", { name: "Directory" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/per page/)).not.toBeInTheDocument();
  });
  it("has one table look: the shared frame, with column lines only for sheets that ask", () => {
    const { container, rerender } = render(<DesignSystemProvider><DataGrid ariaLabel="Compact projects" columns={columns} data={rows} getRowId={(row) => row.id} selectable={false} /></DesignSystemProvider>);
    const grid = container.querySelector(".wd-data-grid");
    expect(grid).not.toHaveAttribute("data-appearance");
    expect(grid).not.toHaveAttribute("data-grid-lines");
    expect(grid?.querySelector(".wd-table-scroll > table.wd-table")).not.toBeNull();
    rerender(<DesignSystemProvider><DataGrid gridLines ariaLabel="Compact projects" columns={columns} data={rows} getRowId={(row) => row.id} selectable={false} /></DesignSystemProvider>);
    expect(container.querySelector(".wd-data-grid")).toHaveAttribute("data-grid-lines", "true");
    expect(screen.getByRole("table", { name: "Compact projects" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
